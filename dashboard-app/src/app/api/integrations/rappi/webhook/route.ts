import { type NextRequest, NextResponse, after } from 'next/server'
import { verifyRappiSignature } from '@/lib/integrations/rappi/signature'
import { processRappiOrder, cuarentenarOrdenDeRappi, resolveClientId } from '@/lib/integrations/rappi/ingest'
import { esPing, extraerStoreId, responderPing } from '@/lib/integrations/rappi/ping'

// Webhook de Rappi (push-first). Verifica firma HMAC sobre el body CRUDO, ACK 200
// INMEDIATO (RAPPI-002: antes de cualquier I/O), y procesa la orden en background
// (after) por el camino canónico (dedup + mapping tienda→tenant + persistencia).
// Rappi reintenta si no recibe 2xx a tiempo → el ACK rápido evita duplicados.

export const dynamic = 'force-dynamic'

// Missing configuration must not enable signature-format discovery in production.
const isDev = () => (process.env.RAPPI_ENV || 'prod').toLowerCase() !== 'prod'

// Rappi puede envolver la orden en { order } o { data }; processRappiOrder tolera la forma.
function extractOrder(payload: unknown): unknown {
  if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>
    if (o.order && typeof o.order === 'object') return o.order
    if (o.data && typeof o.data === 'object') return o.data
  }
  return payload
}

// Browser/monitor health check. Rappi deliveries still require a signed POST.
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'fullsite-rappi-webhook',
    version: '1.0.0',
    accepts: ['POST'],
  })
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const header = request.headers.get('rappi-signature')

  const dev = isDev()
  const sig = verifyRappiSignature(rawBody, header, { allowFormatDiscovery: dev })
  if (!sig.ok) {
    if (dev) {
      console.log(
        `[rappi-webhook] verify-fail reason=${sig.reason} hasHeader=${Boolean(header)} ` +
        `bodyLen=${rawBody.length}`,
      )
    }
    const status = sig.reason === 'NO_SECRET_CONFIGURED' ? 503 : 401
    return NextResponse.json({ ok: false, error: sig.reason || 'UNAUTHORIZED' }, { status })
  }
  if (dev) console.log(`[rappi-webhook] verify-ok format=${sig.matchedFormat} bodyLen=${rawBody.length}`)

  let payload: unknown = null
  try {
    payload = rawBody ? JSON.parse(rawBody) : null
  } catch {
    payload = null
  }

  const eventType = (payload && typeof payload === 'object'
    ? (payload as Record<string, unknown>).event ?? (payload as Record<string, unknown>).type
    : null) as string | null

  // El PING de Rappi es por tienda y exige el campo `status`.
  if (esPing(payload, eventType)) {
    return NextResponse.json(await responderPing(extraerStoreId(payload), resolveClientId))
  }

  // RAPPI-002: ACK 200 primero; la ingesta corre en background (no bloquea a Rappi).
  const order = extractOrder(payload)
  after(async () => {
    try {
      const result = await processRappiOrder(order, 'webhook')
      if (dev) console.log(`[rappi-webhook] ingest action=${result.action} order=${result.orderId ?? ''} reason=${result.reason ?? ''}`)
    } catch (e) {
      // EN PRODUCCIÓN TAMBIÉN. Este catch sólo escribía en consola `if (dev)`, así
      // que cualquier excepción de la ingesta —falta de service key, PostgREST
      // caído, inserción rechazada— desaparecía: Rappi ya tiene su 200 y no
      // reintenta. Ahora queda en el log de la función Y en la cola de rezagados.
      // (Barrido 3, 2026-09-12.)
      console.error('[rappi-webhook] ingest-error', e instanceof Error ? e.message : 'unknown')
      try { await cuarentenarOrdenDeRappi(order, `INGEST_THREW: ${e instanceof Error ? e.message : 'unknown'}`, 'webhook') }
      catch (dlqError) { console.error('[rappi-webhook] tampoco se pudo encolar', dlqError instanceof Error ? dlqError.message : dlqError, { order }) }
    }
  })

  return NextResponse.json({ ok: true, accepted: true })
}
