// Regresión — el borrado total de órdenes tiene que dejar rastro.
//
// El 2026-08-26 a las 02:49:03 esta ruta borró las 303 órdenes de AMALAY. La acción fue
// legítima: exige rol gerente, la autorización nominal de Daniel, el texto literal
// "BORRAR TODAS LAS ORDENES" y un digest que coincida con un respaldo recién bajado.
//
// El problema no fue el borrado. Fue que **no dejó ni una línea**.
//
// Sin rastro, el resultado era indistinguible de una pérdida de datos: `pos_orders` vacío
// contra 303 operaciones `COMMITTED` en `pos_save_operations`, sin nada que explicara la
// diferencia. Reconstruirlo tomó una investigación completa, y sólo se resolvió leyendo los
// registros de Supabase — que caducan a las 24 horas. Un día después habría sido
// irreconstruible.
//
// La propiedad que fija este archivo: si se borra, se registra.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const SERVICE = 'SERVICE_KEY_SENTINEL'
const URLBASE = 'https://staging.supabase.co'

type Llamada = { url: string; method: string; body: unknown }
let llamadas: Llamada[] = []
let ordenesEnBd: unknown[] = []

function instalarFetch(opts: { deleteOk?: boolean; auditOk?: boolean } = {}) {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = String(url)
    const method = init?.method ?? 'GET'
    llamadas.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (u.includes('/rest/v1/pos_orders') && method === 'GET') {
      return { ok: true, status: 200, json: async () => ordenesEnBd } as unknown as Response
    }
    if (u.includes('/rest/v1/pos_orders') && method === 'DELETE') {
      const ok = opts.deleteOk !== false
      return { ok, status: ok ? 204 : 500, text: async () => '' } as unknown as Response
    }
    if (u.includes('/rest/v1/pos_audit_log')) {
      const ok = opts.auditOk !== false
      return { ok, status: ok ? 201 : 500, text: async () => 'error simulado' } as unknown as Response
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
  })
}

let identidad: { clientId: string; staffId: string; staffName: string; role: string } | null = null
vi.mock('@/lib/api-auth', async (orig) => {
  const real = await orig<typeof import('@/lib/api-auth')>()
  return { ...real, withPOSAuth: async () => identidad }
})

const auditorias = () =>
  llamadas.filter(c => c.url.includes('/rest/v1/pos_audit_log') && c.method === 'POST')
    .map(c => c.body as { action: string; actor: string; details: Record<string, unknown> })

function pedir(body: unknown) {
  return { json: async () => body } as unknown as import('next/server').NextRequest
}

/** El digest que la ruta calcula sobre las órdenes leídas. */
async function digestDe(ordenes: unknown[]) {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(JSON.stringify(ordenes)).digest('hex')
}

beforeEach(() => {
  vi.resetModules()
  llamadas = []
  ordenesEnBd = [{ id: 'ord-1' }, { id: 'ord-2' }, { id: 'ord-3' }]
  identidad = { clientId: 'amalay', staffId: 'staff-daniel', staffName: 'Daniel', role: 'gerente' }
  process.env.NEXT_PUBLIC_SUPABASE_URL = URLBASE
  process.env.SUPABASE_SERVICE_KEY = SERVICE
  delete process.env.POS_ORDER_CLEANUP_STAFF_IDS
  instalarFetch()
})

describe('el borrado total de órdenes deja rastro', () => {
  it('EL BUG: un borrado exitoso escribe en pos_audit_log', async () => {
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')

    const res = await DELETE(pedir({ confirm: 'BORRAR TODAS LAS ORDENES', digest: await digestDe(ordenesEnBd) }))

    expect(res.status).toBe(200)
    const evs = auditorias()
    expect(evs, 'sin este renglón, el borrado es indistinguible de una pérdida').toHaveLength(1)
    expect(evs[0].action).toBe('orders_cleanup')
  })

  it('el rastro dice QUIÉN, CUÁNTAS y contra qué respaldo', async () => {
    const dig = await digestDe(ordenesEnBd)
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')

    await DELETE(pedir({ confirm: 'BORRAR TODAS LAS ORDENES', digest: dig }))

    const ev = auditorias()[0]
    expect(ev.actor).toBe('Daniel')
    expect(ev.details.deleted_count).toBe(3)
    expect(ev.details.backup_digest).toBe(dig)
    expect(ev.details.staff_id).toBe('staff-daniel')
    expect(ev.details.role).toBe('gerente')
  })

  it('el rastro va DESPUÉS del borrado, no antes', async () => {
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')

    await DELETE(pedir({ confirm: 'BORRAR TODAS LAS ORDENES', digest: await digestDe(ordenesEnBd) }))

    const iBorrado = llamadas.findIndex(c => c.method === 'DELETE')
    const iAuditoria = llamadas.findIndex(c => c.url.includes('pos_audit_log'))
    expect(iBorrado).toBeGreaterThan(-1)
    expect(iAuditoria, 'auditar un borrado que no ocurrió sería peor que no auditar')
      .toBeGreaterThan(iBorrado)
  })

  it('si la auditoría falla, el borrado NO se reporta como error', async () => {
    // El borrado ya ocurrió: convertirlo en 500 haría que el operador lo repita.
    instalarFetch({ auditOk: false })
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')

    const res = await DELETE(pedir({ confirm: 'BORRAR TODAS LAS ORDENES', digest: await digestDe(ordenesEnBd) }))

    expect(res.status).toBe(200)
  })

  it('un borrado que falla no deja rastro de algo que no pasó', async () => {
    instalarFetch({ deleteOk: false })
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')

    const res = await DELETE(pedir({ confirm: 'BORRAR TODAS LAS ORDENES', digest: await digestDe(ordenesEnBd) }))

    expect(res.status).toBe(500)
    expect(auditorias()).toHaveLength(0)
  })

  it('sin la confirmación literal no se borra ni se audita', async () => {
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')

    const res = await DELETE(pedir({ confirm: 'sí bórralo', digest: await digestDe(ordenesEnBd) }))

    expect(res.status).toBe(400)
    expect(llamadas.filter(c => c.method === 'DELETE')).toHaveLength(0)
    expect(auditorias()).toHaveLength(0)
  })

  it('si las órdenes cambiaron desde el respaldo, se aborta con 409', async () => {
    const dig = await digestDe(ordenesEnBd)
    ordenesEnBd = [...ordenesEnBd, { id: 'ord-4-llegó-después' }]
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')

    const res = await DELETE(pedir({ confirm: 'BORRAR TODAS LAS ORDENES', digest: dig }))

    expect(res.status).toBe(409)
    expect(llamadas.filter(c => c.method === 'DELETE')).toHaveLength(0)
  })

  it('otro restaurante no puede ejecutarlo — ni siquiera un gerente', async () => {
    identidad = { clientId: 'boruca', staffId: 's1', staffName: 'Daniel', role: 'gerente' }
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')

    const res = await DELETE(pedir({ confirm: 'BORRAR TODAS LAS ORDENES', digest: 'x' }))

    expect(res.status).toBe(403)
    expect(llamadas.filter(c => c.method === 'DELETE')).toHaveLength(0)
  })
})
