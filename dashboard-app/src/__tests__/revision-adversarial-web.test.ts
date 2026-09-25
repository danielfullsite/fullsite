/**
 * Revisión adversarial independiente del bloque POS (2026-09-24) — lado web.
 *
 * Cada prueba es la COPIA INVERTIDA de un ataque que el revisor reprodujo contra 917131c4 (él
 * afirmaba el comportamiento inseguro; aquí se afirma la defensa). Sintético: fetch
 * interceptado, dos tenants, secretos de relleno.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createRequire } from 'module'
import path from 'path'
import { createHmac } from 'crypto'

const requerir = createRequire(import.meta.url)
const pedro = requerir(path.resolve(__dirname, '../../../electron-app/local-server/core/recibo-offline.js')) as {
  firmarRecibo: (llave: string, c: Record<string, unknown>) => string
}

beforeEach(() => {
  vi.resetModules()
  vi.unstubAllEnvs()
  process.env.OFFLINE_RECEIPT_ROOT = '5a'.repeat(32)
  process.env.SHIFT_TOKEN_SECRET = 'secreto-sintetico-de-prueba-de-al-menos-32-caracteres'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sb.fixture.test'
  process.env.SUPABASE_SERVICE_KEY = 'service-fixture'
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

/** Base falsa: pos_aprobaciones_usadas (PK jti, CHECK de longitud), pos_orders, pos_terminals, pos_staff. */
function baseFalsa(o: { terminales?: string[]; personal?: Record<string, { name: string; role: string }>; caida?: boolean } = {}) {
  const usadas = new Map<string, { client_id: string; operacion: string }>()
  const orden = {
    id: 'O1', client_id: 'tenant-a', status: 'enviada', order_revision: 1, updated_at: '2026-09-24T00:00:00Z', closed_at: null as string | null,
    items: [{ id: 'i1', nombre: 'Taco', subtotal: 100, cantidad: 1 }, { id: 'i2', nombre: 'Ribeye', subtotal: 900, cantidad: 1 },
      { id: 'i3', nombre: 'Vino', subtotal: 1500, cantidad: 1 }],
    subtotal: 2500, descuento: 0, iva: 0, total: 2500, pagos: [],
  } as Record<string, unknown>
  const auditoria: unknown[] = []
  const parches: unknown[] = []
  const fetchFalso = vi.fn(async (u: string, init?: RequestInit) => {
    const m = init?.method || 'GET'
    if (o.caida && (u.includes('/pos_terminals') || u.includes('/pos_staff'))) return new Response('{}', { status: 500 })
    if (u.includes('/pos_aprobaciones_usadas') && m === 'POST') {
      const b = JSON.parse(String(init!.body))
      if (b.operacion.length > 300 || b.jti.length > 200) return new Response(JSON.stringify({ code: '23514' }), { status: 400 })
      if (usadas.has(b.jti)) return new Response(JSON.stringify({ code: '23505' }), { status: 409 })
      usadas.set(b.jti, { client_id: b.client_id, operacion: b.operacion }); return new Response(null, { status: 201 })
    }
    if (u.includes('/pos_aprobaciones_usadas') && m === 'GET') {
      const jti = decodeURIComponent(u.match(/jti=eq\.([^&]+)/)![1])
      const r = usadas.get(jti); return Response.json(r ? [r] : [])
    }
    if (u.includes('/pos_terminals?')) {
      const dev = decodeURIComponent(new URL(u).searchParams.get('device_id')!.slice(3))
      return Response.json((o.terminales ?? ['POS-CAJA']).includes(dev) ? [{ device_id: dev }] : [])
    }
    if (u.includes('/pos_staff?')) {
      const id = decodeURIComponent(new URL(u).searchParams.get('id')?.slice(3) ?? '')
      const p = (o.personal ?? { g1: { name: 'Gerente', role: 'gerente' } })[id]
      return Response.json(p ? [p] : [])
    }
    if (u.includes('/pos_orders') && m === 'GET') return Response.json([JSON.parse(JSON.stringify(orden))])
    if (u.includes('/pos_orders') && m === 'PATCH') {
      const p = JSON.parse(String(init!.body)); parches.push(p)
      Object.assign(orden, p, p.items ? { items: JSON.parse(p.items) } : {})
      return Response.json([JSON.parse(JSON.stringify(orden))])
    }
    if (u.includes('/pos_audit_log')) { auditoria.push(JSON.parse(String(init!.body))); return new Response(null, { status: 201 }) }
    if (u.includes('/clients?')) return Response.json([{ pos_settings: {} }])
    return Response.json([])
  })
  return { usadas, orden, auditoria, parches, fetchFalso }
}

async function ruta(nombre: string, sesion: string, cuerpo: Record<string, unknown>) {
  const { POST } = await import(`@/app/api/pos/${nombre}/route`)
  const r = await POST(new NextRequest(`https://app.test/api/pos/${nombre}`, {
    method: 'POST', headers: { authorization: `Bearer ${sesion}` }, body: JSON.stringify(cuerpo) }))
  return { status: r.status, body: await r.json() }
}
async function tokens() {
  const st = await import('@/lib/shift-token')
  return {
    mesero: await st.issueShiftToken('m1', 'tenant-a', 'mesero', 'Mesero', 'POS-M'),
    aprob: await st.issueApprovalToken('g1', 'tenant-a', 'gerente', 'Gerente', 'POS-M'),
    st,
  }
}

describe('V1 · una aprobación autoriza UN objeto', () => {
  it('cancelar: el mismo token y operation_id con OTRO platillo → 403 (antes cancelaba N)', async () => {
    vi.stubEnv('POS_APPROVAL_STRICT', 'true'); vi.stubEnv('POS_APROBACION_V2_ESTRICTA', 'true')
    const db = baseFalsa(); vi.stubGlobal('fetch', db.fetchFalso)
    const { mesero, aprob } = await tokens()
    const r1 = await ruta('cancel-item', mesero, { order_id: 'O1', item_id: 'i1', operation_id: 'OP-1', approval_token: aprob })
    const r2 = await ruta('cancel-item', mesero, { order_id: 'O1', item_id: 'i2', operation_id: 'OP-1', approval_token: aprob })
    const r3 = await ruta('cancel-item', mesero, { order_id: 'O1', item_id: 'i3', operation_id: 'OP-1', approval_token: aprob })
    expect(r1.status).toBe(200)
    expect([r2.status, r3.status]).toEqual([403, 403])
    expect(r2.body.error).toBe('APROBACION_REUSADA')
    expect(db.orden.total).toBe(2400)
  })

  it('V1b · operation_id larguísimo ya no apaga el registro: se resume y el reuso se detecta', async () => {
    const db = baseFalsa(); vi.stubGlobal('fetch', db.fetchFalso)
    const { mesero, aprob } = await tokens()
    const largo = (n: number) => 'X'.repeat(300) + n
    const r1 = await ruta('cancel-item', mesero, { order_id: 'O1', item_id: 'i1', operation_id: largo(1), approval_token: aprob })
    const r2 = await ruta('cancel-item', mesero, { order_id: 'O1', item_id: 'i2', operation_id: largo(2), approval_token: aprob })
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(403)
    expect(db.usadas.size).toBe(1)
    expect([...db.usadas.values()][0].operacion).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('V1b · un 4xx del registro (que no es «ya existe») es rechazo, no «sin registro»', async () => {
    const db = baseFalsa()
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) =>
      u.includes('/pos_aprobaciones_usadas') && init?.method === 'POST' ? new Response('{}', { status: 400 }) : db.fetchFalso(u, init)))
    const { aprob } = await tokens()
    const { verificarTokenDeAprobacion } = await import('@/lib/manager-approval')
    expect(await verificarTokenDeAprobacion(aprob, { clientId: 'tenant-a', minLevel: 4, terminalSolicitante: 'POS-M', operacion: 'x' }))
      .toMatchObject({ ok: false, error: 'APROBACION_INVALIDA' })
  })

  it('reabrir: el mismo token no reabre la cuenta otra vez tras re-cerrarla (se amarra al cierre)', async () => {
    const db = baseFalsa(); vi.stubGlobal('fetch', db.fetchFalso)
    const { mesero, aprob } = await tokens()
    db.orden.closed_at = '2026-09-24T01:00:00Z'; db.orden.status = 'pagada'
    expect((await ruta('reopen-order', mesero, { order_id: 'O1', approval_token: aprob })).status).toBe(200)
    // Se re-cierra (por menos) y se intenta reabrir con la MISMA aprobación.
    db.orden.closed_at = '2026-09-24T02:00:00Z'; db.orden.status = 'pagada'
    expect((await ruta('reopen-order', mesero, { order_id: 'O1', approval_token: aprob })).status).toBe(403)
  })

  it('reabrir una cuenta ya abierta es idempotente y no consume la aprobación', async () => {
    const db = baseFalsa(); vi.stubGlobal('fetch', db.fetchFalso)
    const { mesero, aprob } = await tokens()
    expect((await ruta('reopen-order', mesero, { order_id: 'O1', approval_token: aprob })).body).toMatchObject({ ok: true, already_open: true })
    expect(db.usadas.size).toBe(0)
    expect(db.parches).toHaveLength(0)
  })
})

describe('V2 · la llave de recibos y los recibos', () => {
  it('un gerente ya NO obtiene la llave de una terminal inventada ni de otra terminal', async () => {
    const db = baseFalsa(); vi.stubGlobal('fetch', db.fetchFalso)
    const { st } = await tokens()
    const gerenteEnM = await st.issueShiftToken('g1', 'tenant-a', 'gerente', 'Gerente', 'POS-M')
    const { POST } = await import('@/app/api/pos/terminal-receipt-key/route')
    for (const device_id of ['TERMINAL-INVENTADA', 'POS-CAJA']) {
      const r = await POST(new NextRequest('https://app.test/api/pos/terminal-receipt-key', { method: 'POST',
        headers: { authorization: `Bearer ${gerenteEnM}` }, body: JSON.stringify({ device_id }) }))
      expect(r.status, device_id).toBe(403)
    }
  })

  async function reciboCon(o: Record<string, unknown> = {}) {
    const { derivarLlaveDeTerminal } = await import('@/lib/recibo-offline')
    const key = derivarLlaveDeTerminal('tenant-a', 'POS-CAJA')!
    return { key, t: pedro.firmarRecibo(key, { cid: 'tenant-a', tid: 'POS-CAJA', req: 'POS-M', sub: 'g1', nam: 'Gerente', rol: 'gerente', ...o }) }
  }
  const verificar = async (t: string, minLevel = 4) =>
    (await import('@/lib/manager-approval')).verificarTokenDeAprobacion(t, { clientId: 'tenant-a', minLevel, terminalSolicitante: 'POS-M', operacion: 'reopen:O1:x' })

  it('un recibo que SE DICE admin no aprueba nivel admin si en la base es gerente', async () => {
    vi.stubGlobal('fetch', baseFalsa().fetchFalso)
    const { t } = await reciboCon({ rol: 'admin', nam: 'Dueño' })
    expect((await verificar(t, 5)).ok).toBe(false)
    const ok = await verificar((await reciboCon()).t, 4)
    expect(ok).toMatchObject({ ok: true, mode: 'offline_recibo:gerente', actor: 'Gerente' })
  })

  it('un recibo re-firmado con vigencia de 10 años → vencido', async () => {
    vi.stubGlobal('fetch', baseFalsa().fetchFalso)
    const { key, t } = await reciboCon()
    const [pre, pl] = t.split('.')
    const c = JSON.parse(Buffer.from(pl, 'base64url').toString()); c.exp = c.iat + 10 * 365 * 86400000
    const pl2 = Buffer.from(JSON.stringify(c)).toString('base64url')
    const eterno = `${pre}.${pl2}.${createHmac('sha256', Buffer.from(key, 'hex')).update(`${pre}.${pl2}`).digest('base64url')}`
    expect((await verificar(eterno)).ok).toBe(false)
  })

  it('aprobador DESPEDIDO (inactivo) → sus recibos dejan de valer', async () => {
    vi.stubGlobal('fetch', baseFalsa({ personal: {} }).fetchFalso)
    expect((await verificar((await reciboCon()).t)).ok).toBe(false)
  })

  it('terminal DESENROLADA → su llave queda revocada', async () => {
    vi.stubGlobal('fetch', baseFalsa({ terminales: [] }).fetchFalso)
    expect((await verificar((await reciboCon()).t)).ok).toBe(false)
  })

  it('base caída al verificar un recibo → 503 reintentable, no aceptado ni «terminal»', async () => {
    const db = baseFalsa({ caida: true }); vi.stubGlobal('fetch', db.fetchFalso)
    const { mesero } = await tokens()
    db.orden.closed_at = '2026-09-24T01:00:00Z'
    const r = await ruta('reopen-order', mesero, { order_id: 'O1', approval_token: (await reciboCon()).t })
    expect(r.status).toBe(503)
    expect(db.parches).toHaveLength(0)
  })
})

describe('V3 · una aprobación no entrega sesión', () => {
  it('aprobacion:true (lo que manda la Caja) → approvalToken y NINGÚN shiftToken', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (u.includes('/rpc/pos_pin_throttle')) return Response.json({ allowed: true })
      if (u.includes('/clients?')) return Response.json([{ pos_settings: {} }])
      if (u.includes('/pos_staff?')) return Response.json([{ id: 'g1', name: 'Gerente', role: 'gerente', pin: '4102', pin_hash: null }])
      return new Response(null, { status: 201 })
    }))
    const { POST } = await import('@/app/api/pos/pin/route')
    const r = await POST(new NextRequest('https://app.test/api/pos/pin', { method: 'POST', headers: { 'x-forwarded-for': '10.1.1.1' },
      body: JSON.stringify({ pin: '4102', client_id: 'tenant-a', device_id: 'POS-M', aprobacion: true }) }))
    const b = await r.json()
    expect(typeof b.approvalToken).toBe('string')
    expect(b.shiftToken).toBeUndefined()
    expect(JSON.stringify(b)).not.toContain('4102')
  })
})

describe('E5 · revisión de credencial', () => {
  it('cambia cuando cambia el PIN; no revela el PIN; sin secreto no existe', async () => {
    const { revisionDeCredencial } = await import('@/lib/revision-de-credencial')
    const a = revisionDeCredencial('g1', '4102', null)!
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(revisionDeCredencial('g1', '7777', null)).not.toBe(a)
    expect(revisionDeCredencial('g1', '4102', 'ab'.repeat(32)), 'el backfill del hash no la cambia').toBe(a)
    expect(revisionDeCredencial('g2', '4102', null), 'otra persona, otra revisión').not.toBe(a)
    delete process.env.SHIFT_TOKEN_SECRET
    vi.resetModules()
    expect((await import('@/lib/revision-de-credencial')).revisionDeCredencial('g1', '4102', null)).toBeNull()
  })
  it('el roster incompleto (tope de filas) → 503: un roster parcial borraría a gente válida', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ id: 'g1', role: 'gerente', pin: '4102' }]),
      { status: 206, headers: { 'content-range': '0-0/7' } })))
    const { st } = await tokens()
    const { GET } = await import('@/app/api/pos/staff-roster/route')
    const r = await GET(new NextRequest('https://app.test/api/pos/staff-roster', { headers: { authorization: `Bearer ${await st.issueShiftToken('s1', 'tenant-a', 'mesero', 'M')}` } }))
    expect(r.status).toBe(503)
  })
})
