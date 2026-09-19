import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OnboardingTemplate } from '@/lib/onboarding-template'

type Row = Record<string, any>
const template: OnboardingTemplate = { menu: [{ idSuffix: 'cat', name: 'Menú', color: 'green', sort_order: 1, items: [{ idSuffix: 'item', name: 'Café', price: 50, sort_order: 1 }] }], paymentMethods: [{ name: 'Efectivo', type: 'cash', fiscal_code: '01', commission_pct: 0 }], roles: ['gerente', 'mesero'] }
let database: Record<string, Row[]>, failTable: string | null, failMethod: string | null
const calls: Array<{ table: string; method: string; rows?: Row[] }> = []

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.invalid')
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'fixture-only')
  database = {}; failTable = null; failMethod = null; calls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input), table = url.pathname.split('/').at(-1)!, method = init.method || 'GET'
    calls.push({ table, method })
    if (table === failTable && (!failMethod || method === failMethod)) return Response.json({ error: 'fixture failure' }, { status: 503 })
    const all = database[table] ||= []
    const filtered = all.filter(row => [...url.searchParams].every(([key, value]) => !value.startsWith('eq.') || String(row[key]) === value.slice(3)))
    if (method === 'GET') {
      const prefer = new Headers(init.headers).get('prefer')
      return Response.json(filtered, { headers: prefer === 'count=exact' ? { 'content-range': `0-0/${filtered.length}` } : {} })
    }
    const parsed = JSON.parse(String(init.body)), rows = Array.isArray(parsed) ? parsed : [parsed]
    calls.at(-1)!.rows = structuredClone(rows)
    if (method === 'PATCH') { for (const row of filtered) Object.assign(row, parsed); return Response.json(filtered) }
    const conflict = url.searchParams.get('on_conflict')?.split(',') || (table === 'pos_mutation_authority' ? ['client_id'] : ['id'])
    const inserted = []
    for (const row of rows) {
      const exists = all.find(old => conflict.every(key => row[key] !== undefined && old[key] === row[key]))
      const ignore = new Headers(init.headers).get('prefer')?.includes('ignore-duplicates')
      if (exists && ignore) continue
      if (exists) Object.assign(exists, row)
      else { const record = { id: row.id || `generated-${all.length}`, ...row }; all.push(record); inserted.push(record) }
    }
    return new Headers(init.headers).get('prefer') === 'return=minimal' ? new Response(null, { status: 201 }) : Response.json(inserted, { status: 201 })
  }))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
const provision = async (extra = {}) => (await import('@/lib/provision-tenant')).provisionTenant({ clientId: 'new-tenant', template, mesas: 2, ...extra })

describe('provisión reanudable', () => {
  it('no activa cliente hasta completar; personal de plantilla no permite login', async () => {
    const result = await provision({ deferActivation: true })
    expect(database.clients[0].active).toBe(false)
    expect(result.staffPins).toEqual([])
    expect(result.staffSetupRequired).toBe(true)
    expect(database.pos_staff.every(row => row.active === false && /^[1-9]\d{9}$/.test(row.pin))).toBe(true)
    const { deterministicPin10, activateProvisionedTenant } = await import('@/lib/provision-tenant')
    expect(database.pos_staff.every(row => row.pin !== deterministicPin10(`new-tenant:${row.role}`))).toBe(true)
    await activateProvisionedTenant('new-tenant')
    expect(database.clients[0].active).toBe(true)
  })
  it('fallo intermedio deja inactivo y retry conserva precios, branding y política editados', async () => {
    failTable = 'pos_payment_methods'; failMethod = 'POST'
    await expect(provision()).rejects.toThrow('pos_payment_methods')
    expect(database.clients[0].active).toBe(false)
    database.clients[0].accent_color = 'custom'
    database.pos_menu_items[0].price = 88
    database.pos_mutation_authority = [{ client_id: 'new-tenant', sale_authority: 'legacy' }]
    database.pos_item_inventory_policy = [{ client_id: 'new-tenant', menu_item_id: 'new-tenant-item', inventory_mode: 'recipe' }]
    failTable = null
    await provision()
    expect(database.clients[0].active).toBe(true)
    expect(database.clients[0].accent_color).toBe('custom')
    expect(database.pos_menu_items).toHaveLength(1)
    expect(database.pos_menu_items[0].price).toBe(88)
    expect(database.pos_mutation_authority[0].sale_authority).toBe('legacy')
    expect(database.pos_item_inventory_policy[0].inventory_mode).toBe('recipe')
    const pins = database.pos_staff.map(row => row.pin)
    const retry = await provision()
    expect(retry.created.clients).toBe(0)
    expect(database.pos_staff.map(row => row.pin)).toEqual(pins)
    expect(database.pos_mesas).toHaveLength(2)
    expect(retry.staffSetupRequired).toBe(true)
  })
  it('errores de lectura no se interpretan como tenant/staff vacío', async () => {
    failTable = 'clients'; failMethod = 'GET'
    await expect(provision()).rejects.toThrow('verify existing tenant')
    expect(calls.every(call => call.method === 'GET')).toBe(true)
    failTable = 'pos_staff'
    await expect(provision()).rejects.toThrow('count pos_staff')
    expect(database.clients[0].active).toBe(false)
    expect(database.pos_staff).toBeUndefined()
  })
  it('no reactiva restaurante deshabilitado ni pisa su personal previo', async () => {
    database.clients = [{ id: 'new-tenant', active: false, pos_settings: { custom: true } }]
    database.pos_staff = [{ id: 'existing', client_id: 'new-tenant', name: 'Ana', pin: 'old-private', active: true }]
    await expect(provision()).rejects.toThrow('explicit activation')
    expect(database.clients[0].active).toBe(false)
    expect(database.pos_staff[0].pin).toBe('old-private')
  })
  it('rechaza sucursal ya perteneciente a otro restaurante', async () => {
    database.client_locations = [{ id: 'shared-id', client_id: 'other', name: 'Ajena' }]
    await expect(provision({ locations: [{ id: 'shared-id', name: 'Intento' }] })).rejects.toThrow('another tenant')
    expect(database.client_locations[0].client_id).toBe('other')
    expect(database.clients[0].active).toBe(false)
  })
})
