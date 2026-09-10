import type { SupabaseClient, User } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { activateProvisionedTenant, provisionTenant, type ProvisionInput } from './provision-tenant'

/** Auth Admin only uses the SDK. Tenant rows and atomic membership/activation
 * belong to provision-tenant. Repeating an alta never resets an existing password
 * or moves an existing user's primary tenant. */
async function findUser(admin: SupabaseClient['auth']['admin'], email: string): Promise<User | null> {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: 1000 })
    if (error || !Array.isArray(data?.users)) throw new Error('No se pudo resolver el usuario existente')
    const user = data.users.find(user => user.email?.toLowerCase() === email.toLowerCase())
    if (user) return user
    if (data.users.length < 1000) return null
  }
}
async function resolveUser(admin: SupabaseClient['auth']['admin'], input: {
  clientId: string; email: string; password: string; name: string; service?: boolean
}) {
  const { data, error } = await admin.createUser({
    email: input.email, password: input.password, email_confirm: true,
    user_metadata: { client_id: input.clientId, display_name: input.name, ...(input.service ? { kind: 'local_server' } : {}) },
    app_metadata: { client_id: input.clientId, ...(input.service ? {} : { role: 'dueño' }) },
  })
  if (!error && data?.user?.id) return { userId: data.user.id, created: true }
  // Also recovers a create response lost after Auth committed it.
  const existing = await findUser(admin, input.email)
  if (!existing) throw new Error('No se pudo crear o recuperar el usuario de alta')
  if (input.service && (existing.app_metadata?.client_id !== input.clientId || existing.user_metadata?.kind !== 'local_server')) {
    throw new Error('La identidad del servicio existente no pertenece a esta instalación')
  }
  return { userId: existing.id, created: false }
}

export class InvalidOnboardingInput extends Error {}
export type OnboardTenantInput = ProvisionInput & { email: string; password: string; createLocalServer?: boolean }
export async function onboardTenant(admin: SupabaseClient['auth']['admin'], input: OnboardTenantInput) {
  const { email, password, createLocalServer = false, ...provisionInput } = input
  if (typeof input.clientId !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(input.clientId) || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || password.length < 8) {
    throw new InvalidOnboardingInput('Restaurante, email y contraseña de mínimo 8 caracteres requeridos')
  }
  const owner = await resolveUser(admin, { clientId: input.clientId, email: email.trim().toLowerCase(), password, name: input.display_name || input.clientId })
  let service: { userId: string; created: boolean } | undefined
  let localServer: { email: string; password: string } | null = null
  if (createLocalServer) {
    const svcEmail = `local-server+${input.clientId}@fullsite.local`
    const svcPassword = `ls-${randomUUID()}`
    service = await resolveUser(admin, { clientId: input.clientId, email: svcEmail, password: svcPassword, name: 'Local Server', service: true })
    if (service.created) localServer = { email: svcEmail, password: svcPassword }
  }
  const provision = await provisionTenant(provisionInput)
  // Memberships are committed together with activation, after every seed step.
  // Any missing Auth identity, conflicting role or incomplete skeleton rejects all.
  const activation = await activateProvisionedTenant(input.clientId, owner.userId, { serviceUserId: service?.userId })
  return {
    userId: owner.userId, owner_credentials: owner.created ? 'created' : 'existing_unchanged', clientId: input.clientId, provisioned: provision.created,
    staff_pins: provision.staffPins, staff_setup_required: activation.staff_setup_required,
    local_server: localServer,
    local_server_credentials: service ? service.created ? 'created' : 'existing_not_returned' : 'not_requested',
    activation,
  }
}
