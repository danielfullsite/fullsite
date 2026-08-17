import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requirePlatformAdmin2FA } from '@/lib/platform-auth'
import { rateLimit, auditLog } from '@/lib/platform-writes'
import { provisionTenant } from '@/lib/provision-tenant'
import { randomUUID } from 'crypto'

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
  }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 })
  }
  const { clientId, email, password, display_name, accent_color, default_theme, logo_url, mesas } = body
  if (!clientId || !email || !password) {
    return Response.json({ error: 'clientId, email y password requeridos' }, { status: 400 })
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey)
  const resolvedDisplayName = display_name || clientId

  try {
    // 1. Auth user con client_id en user_metadata + app_metadata (idempotente:
    //    si el email ya existe, reusamos el usuario existente).
    let userId: string | undefined
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { client_id: clientId, display_name: resolvedDisplayName },
      // CRÍTICO: el proxy resuelve el rol SERVER-SIDE desde app_metadata.role (no
      // desde user_metadata ni client_users, que son falsificables). Sin role='dueño'
      // aquí, el dueño de cada cliente nuevo cae a rol mínimo y rebota a /pos en vez
      // del dashboard (era el bug de daniel@fullsite.mx). app_metadata NO es
      // user-writable, por eso es la fuente de verdad del enforcement.
      app_metadata: { client_id: clientId, role: 'dueño' },
    })
    if (authError) {
      // Idempotencia: si ya existe, buscarlo por email y continuar.
      const { data: list } = await supabase.auth.admin.listUsers()
      const existing = list?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase())
      if (!existing) {
        return Response.json({ error: authError.message }, { status: 400 })
      }
      userId = existing.id
      // Backfill: un usuario PRE-EXISTENTE pudo crearse sin app_metadata.role (cuentas
      // viejas). Lo seteamos ahora sin pisar platform_admin ni otras claves.
      try {
        await supabase.auth.admin.updateUserById(existing.id, {
          app_metadata: { ...(existing.app_metadata || {}), client_id: clientId, role: (existing.app_metadata?.role as string) || 'dueño' },
        })
      } catch { /* no bloquear el onboarding por esto */ }
    } else {
      userId = authData.user?.id
    }
    if (!userId) {
      return Response.json({ error: 'No se pudo crear/resolver el usuario' }, { status: 500 })
    }

    // 2. client_users owner mapping (idempotente vía upsert por user_id+client_id).
    try {
      await supabase
        .from('client_users')
        .upsert(
          { user_id: userId, client_id: clientId, role: 'dueño' },
          { onConflict: 'user_id,client_id', ignoreDuplicates: true }
        )
    } catch {
      // Tabla puede no existir — OK, user_metadata.client_id es fallback.
    }

    // 3. Skeleton completo (idempotente).
    const provision = await provisionTenant({
      clientId,
      display_name: resolvedDisplayName,
      accent_color,
      default_theme,
      logo_url,
      mesas,
    })

    const audited = await auditLog(gate.ctx, {
      action: 'tenant.create',
      scope: 'tenant',
      target_tenant: clientId,
      detail: provision.created,
    })

    // ── Service-account del Local Server offline (esqueleton) ──────────────────
    // Usuario Supabase miembro SOLO de este client_id → el Local Server (Node) lo
    // usa para leer pos_orders con JWT authenticated (RLS lo scopea a este tenant),
    // sin la god service_role key en la terminal. Idempotente.
    const svcEmail = `local-server+${clientId}@fullsite.local`
    let localServer: { email: string; password: string } | null = null
    try {
      const svcPassword = `ls-${randomUUID()}`
      const { data: svcData, error: svcErr } = await supabase.auth.admin.createUser({
        email: svcEmail, password: svcPassword, email_confirm: true,
        user_metadata: { client_id: clientId, kind: 'local_server' },
        app_metadata: { client_id: clientId },
      })
      let svcId = svcData?.user?.id
      if (svcErr) {
        const { data: list } = await supabase.auth.admin.listUsers()
        svcId = list?.users?.find(u => u.email?.toLowerCase() === svcEmail.toLowerCase())?.id
      }
      if (svcId) {
        await supabase.from('client_users').upsert(
          { user_id: svcId, client_id: clientId, role: 'local_server' },
          { onConflict: 'user_id,client_id', ignoreDuplicates: true }
        )
        // Solo devolvemos el password si el usuario es NUEVO (createUser sin error).
        if (!svcErr) localServer = { email: svcEmail, password: svcPassword }
      }
    } catch (e) { console.error('[onboard] service-account', e) }

    return Response.json({
      ok: true,
      userId,
      clientId,
      provisioned: provision.created,
      audited,
      // Credenciales del Local Server (solo al crear). Guárdalas en el setup del
      // servidor local del restaurante. Si es null, ya existía (rota el password).
      local_server: localServer,
    })
  } catch (err) {
    console.error('[platform/onboard] error', err)
    return Response.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}
