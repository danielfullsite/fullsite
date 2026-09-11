import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requirePlatformAdmin2FA } from '@/lib/platform-auth'
import { rateLimit, auditLog } from '@/lib/platform-writes'
import { onboardTenant, InvalidOnboardingInput } from '@/lib/onboard-tenant'
import { isVerticalId } from '@/lib/vertical-presets'

// ── Control Plane · POST /api/platform/onboard ───────────────────────────────
// Dar de alta un tenant desde la super-admin console. Admin-gated (requirePlatformAdmin2FA)
// + service_role + audit + rate-limit. Reusa los MISMOS pasos que /api/onboarding:
//   1. Auth user (Supabase admin createUser) con client_id en user_metadata Y app_metadata.
//   2. Skeleton pendiente que preserva configuración existente.
//   3. Membresías y activación atómicas después de completar el skeleton.
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
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'JSON inválido' }, { status: 400 })
  const { clientId, email, password, display_name, accent_color, default_theme, logo_url, mesas, locations, vertical } = body
  if (!clientId || !email || !password) {
    return Response.json({ error: 'clientId, email y password requeridos' }, { status: 400 })
  }
  if (vertical !== undefined && !isVerticalId(vertical)) {
    return Response.json({ error: `vertical inválido: ${vertical}` }, { status: 400 })
  }
  if (locations && (!Array.isArray(locations) || locations.length > 100 || locations.some(location => typeof location?.name !== 'string' || !location.name.trim()))) {
    return Response.json({ error: 'Sucursales inválidas (máximo 100 y todas requieren nombre)' }, { status: 400 })
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey)
  try {
    const result = await onboardTenant(supabase.auth.admin, {
      clientId, email, password, display_name: display_name || clientId,
      accent_color, default_theme, logo_url, mesas, locations, vertical,
      createLocalServer: true,
    })
    const audited = await auditLog(gate.ctx, {
      action: 'tenant.create', scope: 'tenant', target_tenant: clientId,
      detail: { provisioned: result.provisioned, activation: result.activation },
    })
    if (!result.activation.active) {
      return Response.json({ ok: false, error: 'El restaurante permanece inactivo; el alta no reactiva una suspensión', ...result, audited }, { status: 409 })
    }
    return Response.json({ ok: true, ...result, audited })
  } catch (err) {
    console.error('[platform/onboard] alta incompleta')
    return Response.json({ error: err instanceof Error ? err.message : 'No se pudo completar el alta' }, { status: err instanceof InvalidOnboardingInput ? 400 : 500 })
  }
}
