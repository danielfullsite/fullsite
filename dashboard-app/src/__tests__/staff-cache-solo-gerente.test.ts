import { beforeEach, describe, expect, it, vi } from 'vitest'

const authState = vi.hoisted(() => ({ role: 'mesero' }))

vi.mock('@/lib/api-auth', () => ({
  POS_ROLE_LVL: { mesero: 1, cajero: 2, capitan: 3, gerente: 4, admin: 5 },
  withPOSAuth: vi.fn(async () => ({ clientId: 'amalay', role: authState.role })),
  unauthorized: vi.fn(() => Response.json({ error: 'unauthorized' }, { status: 401 })),
}))

beforeEach(() => {
  vi.resetModules()
  vi.unstubAllGlobals()
  authState.role = 'mesero'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.invalid'
  process.env.SUPABASE_SERVICE_KEY = 'service-role'
})

describe('el padrón offline no se entrega a roles operativos', () => {
  it.each(['mesero', 'cajero', 'capitan'])('rechaza a %s sin consultar personal', async role => {
    authState.role = role
    const outbound = vi.fn()
    vi.stubGlobal('fetch', outbound)
    const { GET } = await import('@/app/api/pos/staff-cache/route')

    const res = await GET(new Request('http://test/api/pos/staff-cache') as never)

    expect(res.status).toBe(403)
    expect(outbound).not.toHaveBeenCalled()
  })

  it('un gerente recibe sólo hashes, nunca PINes en claro', async () => {
    authState.role = 'gerente'
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([
      { id: 'm1', name: 'Mesero', role: 'mesero', pin: '1234' },
    ])))
    const { GET } = await import('@/app/api/pos/staff-cache/route')

    const res = await GET(new Request('http://test/api/pos/staff-cache') as never)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.staff[0]).toMatchObject({ id: 'm1', name: 'Mesero', role: 'mesero' })
    expect(body.staff[0].pin).toBeUndefined()
    expect(body.staff[0].pinHash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(body)).not.toContain('1234')
  })
})
