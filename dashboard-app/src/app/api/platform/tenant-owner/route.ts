import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requirePlatformAdmin2FA } from '@/lib/platform-auth'
import { auditLog, rateLimit } from '@/lib/platform-writes'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error
  const limited = rateLimit(gate.ctx)
  if (limited) return limited

  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!serviceKey) return Response.json({ error: 'Falta service key' }, { status: 503 })

  const body = await req.json().catch(() => ({})) as {
    clientId?: string
    email?: string
    password?: string
  }
  const clientId = body.clientId?.trim()
  const email = body.email?.trim().toLowerCase()
  const password = body.password ?? ''
  if (!clientId || !email || password.length < 8) {
    return Response.json({ error: 'Tenant, email y password de mínimo 8 caracteres requeridos' }, { status: 400 })
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey)
  const { data: tenant } = await supabase.from('clients').select('id,display_name').eq('id', clientId).maybeSingle()
  if (!tenant) return Response.json({ error: 'Tenant no encontrado' }, { status: 404 })

  const { data: users, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listError) return Response.json({ error: listError.message }, { status: 502 })
  const existing = users.users.find(user => user.email?.toLowerCase() === email)

  let userId: string | undefined
  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: {
        ...existing.user_metadata,
        client_id: clientId,
        display_name: tenant.display_name,
        role: 'dueño',
      },
      app_metadata: { ...existing.app_metadata, client_id: clientId, role: 'dueño' },
    })
    if (error) return Response.json({ error: error.message }, { status: 400 })
    userId = data.user.id
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { client_id: clientId, display_name: tenant.display_name, role: 'dueño' },
      app_metadata: { client_id: clientId, role: 'dueño' },
    })
    if (error) return Response.json({ error: error.message }, { status: 400 })
    userId = data.user?.id
  }

  if (!userId) return Response.json({ error: 'No se pudo resolver el usuario' }, { status: 500 })
  const { error: membershipError } = await supabase.from('client_users').upsert(
    { user_id: userId, client_id: clientId, role: 'dueño' },
    { onConflict: 'user_id,client_id' }
  )
  if (membershipError) return Response.json({ error: membershipError.message }, { status: 400 })

  await auditLog(gate.ctx, {
    action: existing ? 'tenant.owner_repaired' : 'tenant.owner_created',
    scope: 'tenant',
    target_tenant: clientId,
    detail: { email },
  })
  return Response.json({ ok: true, created: !existing, clientId, email })
}
