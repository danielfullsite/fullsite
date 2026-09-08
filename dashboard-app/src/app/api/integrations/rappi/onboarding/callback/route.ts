import { type NextRequest, NextResponse } from 'next/server'
import { isRappiProvisioningEvent, verifyRappiOnboardingSignature } from '@/lib/integrations/rappi/onboarding-signature'
import {
  collectUnintegrated,
  exchangeMerchantCode,
  fetchIntegrationStatus,
  getIntegratorPublicApiToken,
  provisionStores,
} from '@/lib/integrations/rappi/self-onboarding'

export const dynamic = 'force-dynamic'

function esc(v: unknown): string {
  return JSON.stringify(v, null, 2).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function htmlPage(title: string, bodyHtml: string, status = 200): NextResponse {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>`
    + `<style>body{font:14px/1.5 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;color:#111}`
    + `h1{font-size:18px}pre{background:#f5f5f5;padding:12px;border-radius:8px;overflow:auto;font-size:12px}`
    + `.ok{color:#0a7d32}.err{color:#b00020}</style></head><body>${bodyHtml}</body></html>`
  const res = new NextResponse(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
  // Clear the one-time PKCE cookies regardless of outcome.
  const clear = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/api/integrations/rappi/onboarding', maxAge: 0 }
  res.cookies.set('rap_so_v', '', clear)
  res.cookies.set('rap_so_s', '', clear)
  return res
}

// GET serves three roles on this whitelisted URL:
//   1. ?code= present  → OAuth2 redirect from Portal Partners: exchange the code for the
//      merchant id_token, then provision the merchant's un-integrated stores.
//   2. no params       → plain health/status (used by Rappi to verify the callback).
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  const oauthError = request.nextUrl.searchParams.get('error')

  if (!code && !oauthError) {
    return NextResponse.json({
      status: 'ok',
      service: 'fullsite-rappi-self-onboarding-callback',
      event: 'STORE_PROVISIONING_STATUS',
    })
  }

  if (oauthError) {
    return htmlPage('Rappi onboarding — error', `<h1 class="err">Portal Partners devolvió un error</h1><pre>${esc({ error: oauthError, description: request.nextUrl.searchParams.get('error_description') })}</pre>`, 400)
  }

  const cookieVerifier = request.cookies.get('rap_so_v')?.value
  const cookieState = request.cookies.get('rap_so_s')?.value
  if (!cookieVerifier || !cookieState) {
    return htmlPage('Rappi onboarding — sesión expirada', '<h1 class="err">Sesión de autorización no encontrada o expirada</h1><p>Vuelve a iniciar en <code>/api/integrations/rappi/onboarding/authorize?secret=…</code> y completa el login sin cerrar la pestaña.</p>', 400)
  }
  if (!state || state !== cookieState) {
    return htmlPage('Rappi onboarding — estado inválido', '<h1 class="err">Validación de <code>state</code> fallida</h1><p>Posible CSRF o sesión cruzada. Reinicia el flujo.</p>', 400)
  }

  try {
    const merchantIdToken = await exchangeMerchantCode(code as string, cookieVerifier)
    const integratorToken = await getIntegratorPublicApiToken()
    const { stores, raw: statusRaw } = await fetchIntegrationStatus(integratorToken, merchantIdToken)
    const toProvision = collectUnintegrated(stores)

    if (toProvision.length === 0) {
      return htmlPage('Rappi onboarding — sin pendientes', `<h1 class="ok">No hay tiendas por provisionar</h1><p>Todas las tiendas del merchant ya están integradas (o no hay tiendas).</p><pre>${esc(statusRaw)}</pre>`)
    }

    const { status, raw: provisionRaw } = await provisionStores(integratorToken, merchantIdToken, toProvision)
    const ok = status === 202 || status === 200
    return htmlPage(
      ok ? 'Rappi onboarding — provisión enviada' : 'Rappi onboarding — provisión rechazada',
      `<h1 class="${ok ? 'ok' : 'err'}">Provisión ${ok ? 'aceptada (202)' : `HTTP ${status}`}</h1>`
      + `<p>Tiendas enviadas a provisionar: <b>${toProvision.map(s => `${s.store_id}`).join(', ')}</b>.</p>`
      + `<p>El resultado final llega por el webhook <code>STORE_PROVISIONING_STATUS</code>.</p>`
      + `<h2>Respuesta</h2><pre>${esc(provisionRaw)}</pre>`
      + `<h2>integration-status</h2><pre>${esc(statusRaw)}</pre>`,
      ok ? 200 : 502,
    )
  } catch (error) {
    const detail = error instanceof Error ? (error as Error & { payload?: unknown }).payload ?? error.message : String(error)
    return htmlPage('Rappi onboarding — falló', `<h1 class="err">No se pudo completar el self-onboarding</h1><pre>${esc(detail)}</pre>`, 502)
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const verification = verifyRappiOnboardingSignature(rawBody, request.headers.get('rappi-signature'))
  if (!verification.ok) {
    const status = verification.reason === 'NO_SECRET_CONFIGURED' ? 503 : 401
    return NextResponse.json({ ok: false, error: verification.reason }, { status })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_JSON' }, { status: 400 })
  }

  if (!isRappiProvisioningEvent(payload)) {
    return NextResponse.json({ ok: false, error: 'INVALID_STORE_PROVISIONING_STATUS' }, { status: 422 })
  }

  // Do not log merchant tokens, webhook secrets, or full upstream bodies. This
  // summary is enough to correlate Rappi certification attempts by batch/store.
  console.info('[rappi-self-onboarding]', {
    batchId: payload.batchId,
    integrationId: payload.integrationId,
    operation: payload.operation,
    results: payload.results.map(({ storeId, status, httpCode }) => ({ storeId, status, httpCode })),
    timestamp: payload.timestamp,
  })

  return NextResponse.json({ ok: true, accepted: true, batchId: payload.batchId })
}
