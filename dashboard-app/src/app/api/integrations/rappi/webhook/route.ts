import { type NextRequest, NextResponse, after } from 'next/server'
import { verifyRappiSignature } from '@/lib/integrations/rappi/signature'
import { processRappiOrder } from '@/lib/integrations/rappi/ingest'

// Webhook de Rappi (push-first). Verifica firma HMAC sobre el body CRUDO, ACK 200
// INMEDIATO (RAPPI-002: antes de cualquier I/O), y procesa la orden en background
// (after) por el camino canónico (dedup + mapping tienda→tenant + persistencia).
// Rappi reintenta si no recibe 2xx a tiempo → el ACK rápido evita duplicados.

export const dynamic = 'force-dynamic'

const isDev = () => (process.env.RAPPI_ENV || 'dev').toLowerCase() !== 'prod'

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
        `bodyLen=${rawBody.length} header="${(header || '').slice(0, 96)}"`,
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

  // PING u otros eventos sin orden: ACK sin ingerir.
  if (eventType && /ping/i.test(eventType)) {
    return NextResponse.json({ ok: true, event: eventType })
  }

  // RAPPI-002: ACK 200 primero; la ingesta corre en background (no bloquea a Rappi).
  const order = extractOrder(payload)
  after(async () => {
    try {
      const result = await processRappiOrder(order, 'webhook')
      if (dev) console.log(`[rappi-webhook] ingest action=${result.action} order=${result.orderId ?? ''} reason=${result.reason ?? ''}`)
    } catch (e) {
      if (dev) console.log(`[rappi-webhook] ingest-error ${e instanceof Error ? e.message : 'unknown'}`)
    }
  })

  return NextResponse.json({ ok: true, accepted: true })
}
