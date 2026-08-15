import { type NextRequest, NextResponse } from 'next/server'
import { verifyRappiSignature } from '@/lib/integrations/rappi/signature'
import { processRappiOrder } from '@/lib/integrations/rappi/ingest'

// Webhook de Rappi (push-first). Verifica la firma HMAC sobre el body CRUDO, luego
// ingiere por el camino canónico (dedup + mapping tienda→tenant + persistencia).
// Ack 200 rápido: Rappi reintenta si no recibe 2xx. Contrato de firma: pestaña HMAC
// del Integrations Manager (t=<ts>,sign=<hex>, HMAC-SHA256 sobre raw body).

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

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const header = request.headers.get('rappi-signature')

  const sig = verifyRappiSignature(rawBody, header)
  if (!sig.ok) {
    if (isDev()) {
      // Diagnóstico DEV (sin exponer secretos): fija el contrato con el primer evento real.
      console.log(
        `[rappi-webhook] verify-fail reason=${sig.reason} hasHeader=${Boolean(header)} ` +
        `bodyLen=${rawBody.length} header="${(header || '').slice(0, 96)}"`,
      )
    }
    const status = sig.reason === 'NO_SECRET_CONFIGURED' ? 503 : 401
    return NextResponse.json({ ok: false, error: sig.reason || 'UNAUTHORIZED' }, { status })
  }

  if (isDev()) {
    console.log(`[rappi-webhook] verify-ok secret=${sig.matchedSecret} format=${sig.matchedFormat} bodyLen=${rawBody.length}`)
  }

  let payload: unknown = null
  try {
    payload = rawBody ? JSON.parse(rawBody) : null
  } catch {
    payload = null
  }

  // PING u otros eventos sin orden: ack sin ingerir.
  const eventType = (payload && typeof payload === 'object'
    ? (payload as Record<string, unknown>).event ?? (payload as Record<string, unknown>).type
    : null) as string | null
  if (eventType && /ping/i.test(eventType)) {
    return NextResponse.json({ ok: true, event: eventType })
  }

  try {
    const result = await processRappiOrder(extractOrder(payload), 'webhook')
    return NextResponse.json({ ok: true, action: result.action, order_id: result.orderId ?? null, reason: result.reason ?? null })
  } catch (e) {
    if (isDev()) console.log(`[rappi-webhook] ingest-error ${e instanceof Error ? e.message : 'unknown'}`)
    // Ack 200 igual (evita reintentos infinitos de Rappi); el fallo queda logueado/DLQ del lado ingest.
    return NextResponse.json({ ok: false, error: 'INGEST_FAILED' }, { status: 200 })
  }
}
