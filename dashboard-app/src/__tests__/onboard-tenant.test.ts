import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
const mocks = vi.hoisted(() => ({ provision: vi.fn(), activate: vi.fn() }))
vi.mock('@/lib/provision-tenant', () => ({ provisionTenant: mocks.provision, activateProvisionedTenant: mocks.activate }))
import { onboardTenant, InvalidOnboardingInput } from '@/lib/onboard-tenant'
const input = { clientId: 'test-cafe', email: 'owner@example.com', password: 'synthetic-password', createLocalServer: true }
function admin() {
  return { createUser: vi.fn(async ({ email }: { email: string }) => ({ data: { user: { id: email.startsWith('local-server') ? 'service-id' : 'owner-id' } }, error: null })), listUsers: vi.fn(), updateUserById: vi.fn() }
}
const asAdmin = (value: ReturnType<typeof admin>) => value as unknown as SupabaseClient['auth']['admin']
beforeEach(() => {
  vi.clearAllMocks()
  mocks.provision.mockResolvedValue({ created: { clients: 1 }, staffPins: [] })
  mocks.activate.mockResolvedValue({ active: true, provisioning_state: 'complete', activated: true, staff_setup_required: true })
})
describe('alta: Auth, skeleton pendiente, membresías/activación atómicas', () => {
  it('completa el skeleton antes de activar y entrega credencial nueva sólo tras confirmar', async () => {
    const auth = admin(), order: string[] = []
    mocks.provision.mockImplementation(async () => { order.push('skeleton'); return { created: { clients: 1 }, staffPins: [] } })
    mocks.activate.mockImplementation(async () => { order.push('activate-memberships'); return { active: true } })
    const result = await onboardTenant(asAdmin(auth), input)
    expect(order).toEqual(['skeleton', 'activate-memberships'])
    expect(mocks.activate).toHaveBeenCalledWith('test-cafe', 'owner-id', { serviceUserId: 'service-id' })
    expect(result.local_server?.password).toMatch(/^ls-[0-9a-f-]{36}$/)
    expect(result.local_server_credentials).toBe('created')
    expect(auth.createUser.mock.calls[0][0]).toMatchObject({ app_metadata: { client_id: 'test-cafe', role: 'dueño' } })
  })
  it('una falla del skeleton nunca concede membresía ni activa', async () => {
    mocks.provision.mockRejectedValueOnce(new Error('seed failed'))
    await expect(onboardTenant(asAdmin(admin()), input)).rejects.toThrow('seed failed')
    expect(mocks.activate).not.toHaveBeenCalled()
  })
  it('un rechazo atómico de membresía no produce éxito parcial', async () => {
    mocks.activate.mockRejectedValueOnce(new Error('MEMBERSHIP_ROLE_CONFLICT'))
    await expect(onboardTenant(asAdmin(admin()), input)).rejects.toThrow('MEMBERSHIP_ROLE_CONFLICT')
  })
  it('recupera Auth fuera de la primera página sin cambiar password ni tenant primario', async () => {
    const auth = admin()
    auth.createUser.mockResolvedValue({ data: { user: undefined as never }, error: { message: 'exists' } as never })
    auth.listUsers.mockImplementation(async ({ page }: { page: number }) => ({ data: { users: page === 1 ? Array.from({ length: 1000 }, (_, i) => ({ id: `u${i}`, email: `u${i}@example.com` })) : [{ id: 'existing-owner', email: input.email, app_metadata: { client_id: 'other', role: 'mesero' } }] }, error: null }))
    const result = await onboardTenant(asAdmin(auth), { ...input, createLocalServer: false })
    expect(result.userId).toBe('existing-owner')
    expect(auth.listUsers).toHaveBeenCalledTimes(2)
    expect(auth.updateUserById).not.toHaveBeenCalled()
    expect(mocks.activate).toHaveBeenCalledWith('test-cafe', 'existing-owner', { serviceUserId: undefined })
  })
  it('no reutiliza una identidad de servicio que pertenece a otro restaurante', async () => {
    const auth = admin()
    auth.createUser.mockResolvedValueOnce({ data: { user: { id: 'owner-id' } }, error: null }).mockResolvedValueOnce({ data: { user: undefined as never }, error: {} as never })
    auth.listUsers.mockResolvedValue({ data: { users: [{ id: 'wrong', email: 'local-server+test-cafe@fullsite.local', app_metadata: { client_id: 'other' }, user_metadata: { kind: 'local_server' } }] }, error: null })
    await expect(onboardTenant(asAdmin(auth), input)).rejects.toThrow('no pertenece')
    expect(mocks.provision).not.toHaveBeenCalled()
  })
  it('identifica credencial existente sin rotarla durante un reintento', async () => {
    const auth = admin()
    auth.createUser.mockResolvedValueOnce({ data: { user: { id: 'owner-id' } }, error: null }).mockResolvedValueOnce({ data: { user: undefined as never }, error: {} as never })
    auth.listUsers.mockResolvedValue({ data: { users: [{ id: 'svc', email: 'local-server+test-cafe@fullsite.local', app_metadata: { client_id: input.clientId }, user_metadata: { kind: 'local_server' } }] }, error: null })
    const result = await onboardTenant(asAdmin(auth), input)
    expect(result.local_server).toBeNull()
    expect(result.local_server_credentials).toBe('existing_not_returned')
    expect(auth.updateUserById).not.toHaveBeenCalled()
  })
  it('lectura Auth fallida no equivale a usuario inexistente', async () => {
    const auth = admin()
    auth.createUser.mockRejectedValueOnce(new Error('network failure'))
    await expect(onboardTenant(asAdmin(auth), input)).rejects.toThrow('network failure')
    expect(mocks.provision).not.toHaveBeenCalled()
  })
  it('rechaza identidad inválida antes de Auth o datos', async () => {
    const auth = admin()
    await expect(onboardTenant(asAdmin(auth), { ...input, clientId: '../other' })).rejects.toBeInstanceOf(InvalidOnboardingInput)
    expect(auth.createUser).not.toHaveBeenCalled()
    expect(mocks.provision).not.toHaveBeenCalled()
  })
})

it('la necesidad de configurar personal viene del estado persistido, incluso sin PINs nuevos', async () => {
  mocks.provision.mockResolvedValue({ created: { clients: 0 }, staffPins: [] })
  mocks.activate.mockResolvedValue({ active: true, activated: false, provisioning_state: 'complete', staff_setup_required: true })
  expect((await onboardTenant(asAdmin(admin()), input)).staff_setup_required).toBe(true)
})
