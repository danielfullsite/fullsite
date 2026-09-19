import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ provision: vi.fn(), activate: vi.fn(), audit: vi.fn(), createUser: vi.fn(), listUsers: vi.fn(), updateUser: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/platform-auth', () => ({ requirePlatformAdmin2FA: vi.fn(async () => ({ ctx: { userId: 'admin', email: 'admin@fixture.invalid' } })) }))
vi.mock('@/lib/platform-writes', () => ({ rateLimit: vi.fn(() => null), auditLog: mocks.audit }))
vi.mock('@/lib/provision-tenant', () => ({ provisionTenant: mocks.provision, activateProvisionedTenant: mocks.activate }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { admin: { createUser: mocks.createUser, listUsers: mocks.listUsers, updateUserById: mocks.updateUser } }, from: mocks.from }) }))
import { POST } from '@/app/api/platform/onboard/route'
import { POST as legacyPOST } from '@/app/api/onboarding/route'

type User = { id: string; email: string; password?: string; app_metadata: Record<string, unknown> }
type Membership = { id: string; user_id: string; client_id: string; role: string }
let users: User[], memberships: Membership[], failure: string | null
const request = () => POST(new NextRequest('http://local/api/platform/onboard', { method: 'POST', body: JSON.stringify({ clientId: 'new-tenant', email: 'owner@fixture.invalid', password: 'fixture-owner-password' }) }))
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'fixture-only')
  users = []; memberships = []; failure = null
  mocks.provision.mockResolvedValue({ created: { clients: 1 }, staffPins: [], staffSetupRequired: true, activationPending: true })
  mocks.activate.mockResolvedValue(undefined)
  mocks.audit.mockResolvedValue(true)
  mocks.createUser.mockImplementation(async (input: User) => {
    const existing = users.find(user => user.email === input.email)
    if (existing) return { data: { user: null }, error: { message: 'email exists' } }
    const user = { ...input, id: `user-${users.length}` }; users.push(user)
    return { data: { user }, error: null }
  })
  mocks.listUsers.mockImplementation(async () => ({ data: { users }, error: failure === 'list' ? { message: 'failed' } : null }))
  mocks.updateUser.mockImplementation(async (id: string, update: Partial<User>) => {
    if (failure === 'metadata') return { error: { message: 'failed' } }
    Object.assign(users.find(user => user.id === id)!, update)
    return { error: null }
  })
  mocks.from.mockImplementation(() => {
    const filters: Record<string, string> = {}
    const result = () => {
      const user = users.find(item => item.id === filters.user_id)
      const category = user?.email.startsWith('local-server+') ? 'service' : 'owner'
      return { data: memberships.filter(row => Object.entries(filters).every(([key, value]) => row[key as keyof Membership] === value)), error: failure === `${category}_read` ? { message: 'failed' } : null }
    }
    const builder: any = {
      select: () => builder,
      eq: (key: string, value: string) => { filters[key] = value; return builder },
      limit: async () => result(),
      then: (resolve: (value: unknown) => void, reject: (error: unknown) => void) => Promise.resolve(result()).then(resolve, reject),
      insert: async (row: Omit<Membership, 'id'>) => {
        const category = row.role === 'local_server' ? 'service' : 'owner'
        if (failure === `${category}_insert`) return { error: { message: 'failed' } }
        memberships.push({ ...row, id: `membership-${memberships.length}` })
        return { error: null }
      },
    }
    return builder
  })
})
afterEach(() => vi.unstubAllEnvs())

describe('platform onboard no anuncia éxito parcial', () => {
  it('adaptador legacy exige secreto y reutiliza membresías confirmadas antes de éxito', async () => {
    vi.stubEnv('ONBOARDING_SECRET', 'synthetic-onboard-secret')
    const legacyRequest = (secret: string, mesas = 10) => legacyPOST(new NextRequest('http://local/api/onboarding', { method: 'POST', headers: { 'x-onboarding-secret': secret }, body: JSON.stringify({ clientId: 'new-tenant', email: 'owner@fixture.invalid', password: 'fixture-owner-password', mesas }) }))
    expect((await legacyRequest('wrong')).status).toBe(401)
    expect(mocks.provision).not.toHaveBeenCalled()
    expect((await legacyRequest('synthetic-onboard-secret', 500000)).status).toBe(500)
    expect(mocks.provision).not.toHaveBeenCalled()
    failure = 'service_insert'
    const failed = await legacyRequest('synthetic-onboard-secret')
    expect(failed.status).toBe(500)
    expect((await failed.json()).success).toBe(false)
    expect(mocks.activate).not.toHaveBeenCalled()
    failure = null
    const retry = await legacyRequest('synthetic-onboard-secret')
    expect(retry.status).toBe(200)
    expect(await retry.json()).toMatchObject({ success: true, ok: true, staff_setup_required: true })
    expect(memberships).toHaveLength(2)
    expect(mocks.activate).toHaveBeenCalledOnce()
  })
  for (const category of ['owner', 'service']) for (const operation of ['read', 'insert']) {
    it(`fallo ${category} ${operation} bloquea activación y permite retry sin duplicar`, async () => {
      failure = `${category}_${operation}`
      const failed = await request()
      expect(failed.status).toBe(500)
      expect((await failed.json()).ok).toBe(false)
      expect(mocks.activate).not.toHaveBeenCalled()
      expect(mocks.audit).not.toHaveBeenCalled()
      failure = null
      const retry = await request()
      expect(retry.status).toBe(200)
      expect((await retry.json()).staff_setup_required).toBe(true)
      expect(memberships.filter(row => row.role === 'dueño')).toHaveLength(1)
      expect(memberships.filter(row => row.role === 'local_server')).toHaveLength(1)
      expect(mocks.activate).toHaveBeenCalledOnce()
    })
  }
  it('una cuenta de Caja creada durante fallo recupera contraseña sólo mientras alta sigue inactiva', async () => {
    failure = 'service_insert'
    await request()
    const oldPassword = users.find(user => user.email.startsWith('local-server+'))!.password
    failure = null
    const response = await request(), body = await response.json()
    expect(response.status).toBe(200)
    expect(body.local_server.password).not.toBe(oldPassword)
    expect(users.find(user => user.email.startsWith('local-server+'))!.password).toBe(body.local_server.password)
    mocks.provision.mockResolvedValue({ created: {}, staffPins: [], staffSetupRequired: false, activationPending: false })
    mocks.updateUser.mockClear()
    const repeated = await request()
    expect((await repeated.json()).local_server).toBeNull()
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })
  it('reusar dueño de varios restaurantes conserva su identidad y contraseña actuales', async () => {
    users.push({ id: 'existing-owner', email: 'owner@fixture.invalid', password: 'unchanged', app_metadata: { client_id: 'first-tenant', role: 'dueño', platform_admin: false } })
    expect((await request()).status).toBe(200)
    expect(users[0].app_metadata.client_id).toBe('first-tenant')
    expect(users[0].password).toBe('unchanged')
    expect(memberships.some(row => row.user_id === 'existing-owner' && row.client_id === 'new-tenant')).toBe(true)
  })
  it('no acepta cuenta de Caja de otro tenant ni confirma metadata/activación fallidas', async () => {
    users.push({ id: 'wrong-service', email: 'local-server+new-tenant@fullsite.local', app_metadata: { client_id: 'other' } })
    expect((await request()).status).toBe(500)
    expect(mocks.activate).not.toHaveBeenCalled()
    users = [{ id: 'legacy-owner', email: 'owner@fixture.invalid', app_metadata: {} }]
    memberships = []; failure = 'metadata'
    expect((await request()).status).toBe(500)
    expect(mocks.activate).not.toHaveBeenCalled()
    failure = null
    mocks.activate.mockRejectedValue(new Error('activation failed'))
    expect((await request()).status).toBe(500)
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it('fallo de skeleton ocurre antes de crear usuarios y exige deferActivation', async () => {
    mocks.provision.mockRejectedValue(new Error('seed interrupted'))
    const response = await request()
    expect(response.status).toBe(500)
    expect((await response.json()).step).toBe('provision')
    expect(mocks.createUser).not.toHaveBeenCalled()
    expect(mocks.provision).toHaveBeenCalledWith(expect.objectContaining({ deferActivation: true }))
  })
})
