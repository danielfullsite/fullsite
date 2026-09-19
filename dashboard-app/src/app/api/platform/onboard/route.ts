import { NextRequest } from 'next/server'
import { requirePlatformAdmin2FA } from '@/lib/platform-auth'
import { rateLimit, auditLog } from '@/lib/platform-writes'
import { onboardTenant } from '@/lib/onboard-tenant'
import { isVerticalId } from '@/lib/vertical-presets'

// ── Control Plane · POST /api/platform/onboard ───────────────────────────────
// Dar de alta un tenant desde la super-admin console. Admin-gated (requirePlatformAdmin2FA)
// + service_role + audit + rate-limit. Reusa los MISMOS pasos que /api/onboarding:
//   1. Auth user (Supabase admin createUser) con client_id en user_metadata Y app_metadata.
//   2. client_users owner row.
//   3. provisionTenant(...) — skeleton completo, idempotente.
// Idempotente + fail-closed: sin service key → 503.
// Body: { clientId, email, password, display_name, accent_color, default_theme, logo_url, mesas }

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error
  const limited = rateLimit(gate.ctx)
  if (limited) return limited

  // Fail-closed: full provisioning + Auth Admin requiere service_role.
  // (requirePlatformAdmin2FA ya devuelve 503 si falta, pero lo re-afirmamos para el SDK.)
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!serviceKey) {
    return Response.json({ error: 'Onboarding no configurado (falta service key)' }, { status: 503 })
  }

  let body: {
    clientId?: string
    email?: string
    password?: string
    display_name?: string
    accent_color?: string
    default_theme?: 'light' | 'dark'
    logo_url?: string
    mesas?: number
    locations?: Array<{ id?: string; name: string; address?: string }>
    vertical?: string
  }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 })
  }
  const { clientId, email, password, display_name, accent_color, default_theme, logo_url, mesas, locations, vertical } = body
  if (typeof clientId !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(clientId) || typeof email !== 'string' || !email.includes('@') || typeof password !== 'string' || password.length < 6) {
    return Response.json({ error: 'clientId, email y password requeridos' }, { status: 400 })
  }
  if (vertical !== undefined && !isVerticalId(vertical)) {
    return Response.json({ error: `vertical inválido: ${vertical}` }, { status: 400 })
  }
  if (mesas !== undefined && (!Number.isInteger(mesas) || mesas < 0 || mesas > 500)) {
    return Response.json({ error: 'mesas debe ser entero entre 0 y 500' }, { status: 400 })
  }
  if (locations && (!Array.isArray(locations) || locations.length > 100 || locations.some(location => typeof location?.name !== 'string' || !location.name.trim() || (location.address !== undefined && typeof location.address !== 'string')))) {
    return Response.json({ error: 'Sucursales inválidas (máximo 100 y todas requieren nombre)' }, { status: 400 })
  }

  try {
    const result = await onboardTenant({ clientId, email, password, display_name, accent_color, default_theme, logo_url, mesas, locations, vertical })
    const audited = await auditLog(gate.ctx, { action: 'tenant.create', scope: 'tenant', target_tenant: clientId, detail: result.provisioned })
    return Response.json({ ...result, audited })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno'
    const step = error && typeof error === 'object' && 'step' in error ? error.step : 'provision'
    console.error('[platform/onboard]', { step, clientId, error: message })
    return Response.json({ ok: false, error: message, step, retryable: true, clientId }, { status: 500 })
  }
}
