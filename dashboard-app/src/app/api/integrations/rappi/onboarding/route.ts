import { type NextRequest, NextResponse, after } from 'next/server'
import { verifyRappiSignature } from '@/lib/integrations/rappi/signature'
import { procesarAprovisionamiento, validarPayload } from '@/lib/integrations/rappi/onboarding'

// Callback de self-onboarding de Rappi — evento STORE_PROVISIONING_STATUS.
//
// Rodrigo Murguía (TAM de Integraciones, Rappi) condicionó el aprovisionamiento de
// Fullsite_PROD a que este callback existiera en DEV.
//
// Mismo contrato que el webhook de órdenes y por las mismas razones: firma HMAC
// sobre el body CRUDO, ACK 2xx INMEDIATO antes de cualquier I/O, y el trabajo en
// background con `after`. Rappi reintenta si no recibe 2xx a tiempo — por eso el
// ACK va primero y el proceso es idempotente por batchId.

export const dynamic = 'force-dynamic'

const isDev = () => (process.env.RAPPI_ENV || 'dev').toLowerCase() !== 'prod'

// Health check para navegador y monitores. Las entregas reales exigen POST firmado.
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'fullsite-rappi-onboarding',
    version: '1.0.0',
    event: 'STORE_PROVISIONING_STATUS',
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
        `[rappi-onboarding] verify-fail reason=${sig.reason} hasHeader=${Boolean(header)} ` +
        `bodyLen=${rawBody.length}`,
      )
    }
    const status = sig.reason === 'NO_SECRET_CONFIGURED' ? 503 : 401
    return NextResponse.json({ ok: false, error: sig.reason || 'UNAUTHORIZED' }, { status })
  }

  let crudo: unknown = null
  try {
    crudo = rawBody ? JSON.parse(rawBody) : null
  } catch {
    crudo = null
  }

  const validado = validarPayload(crudo)
  if (!validado.ok) {
    // 400 y no 2xx: un payload deforme no se debe reintentar, y Rappi necesita
    // saber que lo mandó mal en vez de creer que quedó procesado.
    if (dev) console.log(`[rappi-onboarding] payload inválido: ${validado.motivo}`)
    return NextResponse.json({ ok: false, error: 'INVALID_PAYLOAD', reason: validado.motivo }, { status: 400 })
  }

  const { payload } = validado
  const correlationId = crypto.randomUUID()

  // El trabajo va DESPUÉS del ACK. Si truena, Rappi ya recibió su 2xx y no
  // reintenta — por eso el evento se registra dentro y queda en la bitácora
  // para reproceso, en vez de perderse.
  after(async () => {
    try {
      const resumen = await procesarAprovisionamiento(payload, correlationId)
      console.log(
        `[rappi-onboarding] batch=${resumen.batchId} op=${resumen.operation} ` +
        `total=${resumen.total} mapeadas=${resumen.mapeadas.length} ` +
        `sinMapeo=${resumen.sinMapeo.length} fallidas=${resumen.fallidas.length} ` +
        `duplicado=${resumen.duplicado}`,
      )
      if (resumen.sinMapeo.length) {
        // No es un error del callback: es trabajo humano pendiente. Se nombra
        // fuerte porque si nadie lo hace, las órdenes de esas tiendas no entran.
        console.warn(
          `[rappi-onboarding] SIN MAPEO — estas tiendas de Rappi no están ligadas a ` +
          `ningún client_id de Fullsite y sus órdenes se rechazarán: ` +
          `${resumen.sinMapeo.join(', ')}. Crear la fila en integration_store_mappings.`,
        )
      }
    } catch (e) {
      console.error(`[rappi-onboarding] fallo procesando batch=${payload.batchId}:`, e)
    }
  })

  return NextResponse.json({
    ok: true,
    received: true,
    batchId: payload.batchId,
    operation: payload.operation,
    stores: payload.results.length,
  })
}
