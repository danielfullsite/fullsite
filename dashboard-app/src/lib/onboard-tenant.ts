// Alta común: completar configuración y ambas membresías antes de activar.
// Los adaptadores HTTP deben autenticar al administrador antes de invocarlo.
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { provisionTenant, activateProvisionedTenant, type ProvisionInput } from './provision-tenant'

export type TenantOnboardInput = Omit<ProvisionInput, 'template' | 'deferActivation'> & { email: string; password: string }
export async function onboardTenant(input: TenantOnboardInput) {
  const { clientId, email, password, display_name, accent_color, default_theme, logo_url, mesas, locations, vertical } = input
  if (typeof clientId !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(clientId) || typeof email !== 'string' || !email.includes('@') || typeof password !== 'string' || password.length < 6) throw new Error('Datos de alta inválidos')
  if (mesas !== undefined && (!Number.isInteger(mesas) || mesas < 0 || mesas > 500)) throw new Error('Mesas debe ser un entero entre 0 y 500')
  if (locations !== undefined && (!Array.isArray(locations) || locations.length > 100 || locations.some(location => !location || typeof location.name !== 'string' || !location.name.trim() || (location.address !== undefined && typeof location.address !== 'string')))) throw new Error('Sucursales inválidas')
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!serviceKey) throw new Error('Onboarding no configurado')
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey)
  const resolvedDisplayName = display_name || clientId

  let step = 'provision'
  try {
    // Configuración primero: el FK de client_users necesita un cliente. Un alta
    // nueva queda inactiva hasta confirmar AMBAS membresías al final.
    const provision = await provisionTenant({ clientId, display_name: resolvedDisplayName,
      accent_color, default_theme, logo_url, mesas, locations, vertical, deferActivation: true })

    async function findUser(address: string) {
      for (let page = 1; page <= 100; page++) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
        if (error) throw new Error('No se pudo consultar usuarios existentes')
        const found = data.users.find(user => user.email?.toLowerCase() === address.toLowerCase())
        if (found) return found
        if (data.users.length < 200) return null
      }
      throw new Error('Búsqueda de usuario excedió el límite; requiere soporte')
    }

    async function ensureMembership(userId: string, role: 'dueño' | 'local_server') {
      const { data: rows, error: readError } = await supabase.from('client_users')
        .select('id,role').eq('user_id', userId).eq('client_id', clientId).limit(2)
      if (readError || !Array.isArray(rows)) throw new Error(`No se pudo verificar membresía ${role}`)
      if (rows.length > 1 || (rows.length === 1 && rows[0].role !== role)) throw new Error(`Membresía ${role} en conflicto; requiere revisión`)
      if (rows.length === 1) return
      const { error } = await supabase.from('client_users').insert({ user_id: userId, client_id: clientId, role })
      if (error) throw new Error(`No se pudo crear membresía ${role}`)
      // Confirmación separada: una respuesta sin error no autoriza ok:true si
      // la membresía no puede leerse después.
      const { data: receipt, error: receiptError } = await supabase.from('client_users')
        .select('id,role').eq('user_id', userId).eq('client_id', clientId).limit(2)
      if (receiptError || !Array.isArray(receipt) || receipt.length !== 1 || receipt[0].role !== role) throw new Error(`Membresía ${role} no confirmada`)
    }

    step = 'owner_user'
    const { data: owner, error: ownerError } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { client_id: clientId, display_name: resolvedDisplayName },
      app_metadata: { client_id: clientId, role: 'dueño' },
    })
    const ownerUser = ownerError ? await findUser(email) : owner.user
    if (!ownerUser?.id) throw new Error('No se pudo crear/resolver el dueño')
    // Un dueño puede tener varios restaurantes. Reusar su cuenta no cambia la
    // contraseña, restaurante por defecto ni rol de una cuenta ya configurada.
    if (ownerError && !ownerUser.app_metadata?.role) {
      const { error } = await supabase.auth.admin.updateUserById(ownerUser.id, {
        app_metadata: { ...ownerUser.app_metadata, client_id: ownerUser.app_metadata?.client_id || clientId, role: 'dueño' },
      })
      if (error) throw new Error('No se pudo completar metadata del dueño')
    }
    step = 'owner_membership'
    await ensureMembership(ownerUser.id, 'dueño')

    step = 'service_user'
    const svcEmail = `local-server+${clientId}@fullsite.local`
    const svcPassword = `ls-${randomUUID()}`
    const { data: service, error: serviceError } = await supabase.auth.admin.createUser({
      email: svcEmail, password: svcPassword, email_confirm: true,
      user_metadata: { client_id: clientId, kind: 'local_server' },
      app_metadata: { client_id: clientId },
    })
    const serviceUser = serviceError ? await findUser(svcEmail) : service.user
    if (!serviceUser?.id) throw new Error('No se pudo crear/resolver la cuenta de Caja')
    if (serviceUser.app_metadata?.client_id !== clientId) throw new Error('Cuenta de Caja de otro restaurante')
    const { data: serviceScopes, error: scopeError } = await supabase.from('client_users')
      .select('client_id,role').eq('user_id', serviceUser.id)
    if (scopeError || !Array.isArray(serviceScopes) || serviceScopes.some(row => row.client_id !== clientId || row.role !== 'local_server')) throw new Error('La cuenta de Caja debe pertenecer sólo a este restaurante')
    let localServer: { email: string; password: string } | null = serviceError ? null : { email: svcEmail, password: svcPassword }
    if (serviceError && provision.activationPending) {
      // Recupera el secreto perdido por un fallo previo, sólo mientras el alta
      // sigue inactiva. Reintentar un restaurante operativo nunca rota su Caja.
      const { error } = await supabase.auth.admin.updateUserById(serviceUser.id, { password: svcPassword })
      if (error) throw new Error('No se pudo recuperar la credencial de Caja')
      localServer = { email: svcEmail, password: svcPassword }
    }
    step = 'service_membership'
    await ensureMembership(serviceUser.id, 'local_server')

    step = 'activation'
    await activateProvisionedTenant(clientId)
    return { ok: true, userId: ownerUser.id, clientId,
      provisioned: provision.created, staff_pins: provision.staffPins,
      staff_setup_required: provision.staffSetupRequired, local_server: localServer }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno'
    throw Object.assign(new Error(message), { step })
  }
}
