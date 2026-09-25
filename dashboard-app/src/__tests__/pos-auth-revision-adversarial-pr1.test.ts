// Revisión adversarial de PR1 (F-01), 2026-09-23 — PR1-REVIEW.md, hallazgos N-1, N-3 y N-4.
//
// N-1 · La huella de bundles viejos contaba en el throttle compartido por (restaurante, IP).
//       Todas las terminales comparten IP pública: 8 toques sin F5 bloqueaban el PIN del
//       gerente para todo el restaurante. Un `fingerprint_id` ya no consulta a nadie, así
//       que no hay nada que adivinar: no debe contar.
// N-3 · /api/pos/time-clock era un oráculo de PIN sin límite (cualquier shift token del
//       tenant probaba PINs y un acierto devolvía el nombre del empleado).
// N-4 · `offline_approved: true` es una afirmación del cliente. Con POS_APPROVAL_STRICT=true
//       debe fallar cerrado; sin la bandera sigue como hoy, auditado.
//
// Ids, PINs y tenants inventados. `fetch` simulado: nada sale a la red. El throttle es el
// real (pin-throttle.ts) en su modo en memoria: el RPC responde !ok.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const SECRET = 'fixture-secret-0123456789abcdef0123456789abcdef'

type Fila = { id: string; client_id: string; name: string; role: string; pin: string; active: boolean }
const STAFF: Fila[] = [
  { id: 'a-mesero', client_id: 'tenant-a', name: 'Mesero A', role: 'mesero', pin: '1111', active: true },
  { id: 'a-gerente', client_id: 'tenant-a', name: 'Gerente A', role: 'gerente', pin: '2222', active: true },
]

function stubSupabase() {
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const u = String(input)
    if (u.includes('/rpc/pos_pin_throttle')) return new Response('{}', { status: 503 }) // → throttle en memoria
    if (u.includes('/auth/v1/user')) return new Response('{}', { status: 401 })
    if (u.includes('/rest/v1/clients')) return new Response(JSON.stringify([{ pos_settings: {} }]), { status: 200 })
    if (u.includes('/rest/v1/pos_time_clock')) {
      if (init?.method === 'POST') return new Response(JSON.stringify([{ ts: '2026-09-23T12:00:00Z' }]), { status: 201 })
      return new Response('[]', { status: 200 })
    }
    if (u.includes('/rest/v1/pos_staff')) {
      const q = new URL(u).searchParams
      const rows = STAFF.filter((r) => {
        for (const [k, v] of q.entries()) {
          if (k === 'select' || k === 'limit') continue
          const val = String((r as unknown as Record<string, unknown>)[k])
          if (v.startsWith('eq.') && val !== v.slice(3)) return false
          if (v.startsWith('in.(') && !v.slice(4, -1).split(',').includes(val)) return false
        }
        return true
      })
      return new Response(JSON.stringify(rows.slice(0, 1)), { status: 200 })
    }
    return new Response('[]', { status: 200 })
  })
}

beforeEach(() => {
  vi.resetModules() // throttle en memoria limpio por prueba
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://fixture.local'
  process.env.SUPABASE_SERVICE_KEY = 'fixture-service'
  process.env.SHIFT_TOKEN_SECRET = SECRET
  delete process.env.POS_FALLBACK_CLIENT_ID
  delete process.env.MANAGER_PINS_CLIENT_ID
  vi.stubEnv('POS_APPROVAL_STRICT', '')
  stubSupabase()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const pinReq = (body: Record<string, unknown>) =>
  new Request('http://x/api/pos/pin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '200.1.1.1' },
    body: JSON.stringify(body),
  }) as never

describe('N-1 · la huella no gasta el presupuesto de intentos del restaurante', () => {
  it('20 toques de huella (bundles sin F5, misma IP) y luego el PIN correcto del gerente → entra', async () => {
    const { POST } = await import('@/app/api/pos/pin/route')
    for (let i = 0; i < 20; i++) {
      const r = await POST(pinReq({ client_id: 'tenant-a', fingerprint_id: 'a-gerente', pin: '___fingerprint___' }))
      expect(r.status, `toque ${i + 1}`).toBe(401)
      expect((await r.json()).code).toBe('biometria_no_verificada')
    }
    const ok = await POST(pinReq({ client_id: 'tenant-a', pin: '2222', manager: true }))
    expect(ok.status).toBe(200)
    // Desde el bloque POS (revisión adversarial V3) una aprobación trae SU token (15 min, jti,
    // terminal) y ya no una sesión de 8 h del gerente.
    expect(typeof (await ok.json()).approvalToken).toBe('string')
  })

  it('CONTROL: los PINs incorrectos SÍ siguen contando y bloquean (429)', async () => {
    const { POST } = await import('@/app/api/pos/pin/route')
    const estados: number[] = []
    for (let i = 0; i < 10; i++) estados.push((await POST(pinReq({ client_id: 'tenant-a', pin: '9999' }))).status)
    expect(estados).toContain(429)
  })
})

async function tokenDe(staffId: string, rol: string, cid = 'tenant-a') {
  const { issueShiftToken } = await import('@/lib/shift-token')
  return issueShiftToken(staffId, cid, rol, 'Fixture')
}

function reqConToken(url: string, token: string, body: Record<string, unknown>) {
  return {
    headers: new Headers({ authorization: `Bearer ${token}`, 'x-forwarded-for': '200.1.1.1', 'content-type': 'application/json' }),
    cookies: { get: () => undefined },
    json: async () => body,
    url,
  } as never
}

describe('N-3 · /api/pos/time-clock deja de ser un oráculo de PIN', () => {
  it('30 PINs incorrectos con token de mesero → termina en 429', async () => {
    const token = await tokenDe('a-mesero', 'mesero')
    const { POST } = await import('@/app/api/pos/time-clock/route')
    const estados: number[] = []
    for (let i = 0; i < 30; i++) {
      const r = await POST(reqConToken('http://x/api/pos/time-clock', token, { pin: String(3000 + i) }))
      estados.push(r.status)
    }
    expect(estados).toContain(429)
    expect(estados[estados.length - 1]).toBe(429)
  })

  it('un PIN incorrecto no revela nombres ni si el PIN existe en otro lado', async () => {
    const token = await tokenDe('a-mesero', 'mesero')
    const { POST } = await import('@/app/api/pos/time-clock/route')
    const r = await POST(reqConToken('http://x/api/pos/time-clock', token, { pin: '9999' }))
    expect(r.status).toBeGreaterThanOrEqual(400)
    const crudo = JSON.stringify(await r.json())
    for (const s of STAFF) expect(crudo).not.toContain(s.name)
    expect(crudo).not.toContain('staff_name')
  })

  it('CONTROL: el PIN correcto sigue checando entrada', async () => {
    const token = await tokenDe('a-mesero', 'mesero')
    const { POST } = await import('@/app/api/pos/time-clock/route')
    const r = await POST(reqConToken('http://x/api/pos/time-clock', token, { pin: '2222' }))
    expect(r.status).toBe(200)
    expect((await r.json()).type).toBe('entrada')
  })
})

describe('N-4 · offline_approved deja de ser prueba en modo estricto', () => {
  it('STRICT=true: mesero afirmando offline_approved → rechazado', async () => {
    vi.stubEnv('POS_APPROVAL_STRICT', 'true')
    const { verifyManagerApproval } = await import('@/lib/manager-approval')
    const r = await verifyManagerApproval({ offlineApproved: true, clientId: 'tenant-a', solicitanteRol: 'mesero' })
    expect(r.ok).toBe(false)
  })

  it('STRICT=true: tampoco lo salva un gerente como solicitante — sin prueba del servidor no hay aprobación', async () => {
    vi.stubEnv('POS_APPROVAL_STRICT', 'true')
    const { verifyManagerApproval } = await import('@/lib/manager-approval')
    const r = await verifyManagerApproval({ offlineApproved: true, clientId: 'tenant-a', solicitanteRol: 'gerente' })
    expect(r.ok).toBe(false)
  })

  it('STRICT=true: token de mesero como approval_token + offline_approved → rechazado', async () => {
    vi.stubEnv('POS_APPROVAL_STRICT', 'true')
    const { verifyManagerApproval } = await import('@/lib/manager-approval')
    const approvalToken = await tokenDe('a-mesero', 'mesero')
    const r = await verifyManagerApproval({ approvalToken, offlineApproved: true, clientId: 'tenant-a', solicitanteRol: 'mesero' })
    expect(r.ok).toBe(false)
  })

  it('STRICT=true: gerente con token firmado válido → aceptado (online)', async () => {
    vi.stubEnv('POS_APPROVAL_STRICT', 'true')
    const { verifyManagerApproval } = await import('@/lib/manager-approval')
    const approvalToken = await tokenDe('a-gerente', 'gerente')
    const r = await verifyManagerApproval({ approvalToken, clientId: 'tenant-a', solicitanteRol: 'mesero' })
    // Desde 2026-09-24 el modo lleva marcas (`:v1`, `:sin_terminal`) cuando la aprobación es
    // de la forma vieja; sigue siendo una aprobación ONLINE aceptada, que es lo que se prueba.
    expect(r.ok).toBe(true)
    expect(r.mode.startsWith('online:gerente')).toBe(true)
  })

  it('STRICT=true: token de gerente de OTRO restaurante → rechazado', async () => {
    vi.stubEnv('POS_APPROVAL_STRICT', 'true')
    const { verifyManagerApproval } = await import('@/lib/manager-approval')
    const approvalToken = await tokenDe('b-gerente', 'gerente', 'tenant-b')
    const r = await verifyManagerApproval({ approvalToken, offlineApproved: true, clientId: 'tenant-a', solicitanteRol: 'gerente' })
    expect(r.ok).toBe(false)
  })

  it('NO estricto (hoy): offline_approved pasa, pero queda marcado con el rol real para auditoría', async () => {
    const { verifyManagerApproval, apruebaSospechosa } = await import('@/lib/manager-approval')
    const r = await verifyManagerApproval({ offlineApproved: true, clientId: 'tenant-a', solicitanteRol: 'mesero' })
    expect(r).toMatchObject({ ok: true, mode: 'offline_device_trust:mesero' })
    expect(apruebaSospechosa(r)).toBe(true)
  })

  it('cancel-item (copia propia de la política): STRICT=true + offline_approved de mesero → 403', async () => {
    vi.stubEnv('POS_APPROVAL_STRICT', 'true')
    const token = await tokenDe('a-mesero', 'mesero')
    const { POST } = await import('@/app/api/pos/cancel-item/route')
    const r = await POST(reqConToken('http://x/api/pos/cancel-item', token, {
      order_id: 'o-1', item_id: 'i-1', operation_id: 'op-1', offline_approved: true, manager: 'Gerente A',
    }))
    expect(r.status).toBe(403)
    expect((await r.json()).error).toBe('MANAGER_APPROVAL_REQUIRED')
  })

  it('reopen-order: STRICT=true + offline_approved de mesero → 403 sin tocar la orden', async () => {
    vi.stubEnv('POS_APPROVAL_STRICT', 'true')
    const llamadas: string[] = []
    const base = globalThis.fetch
    vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
      llamadas.push(`${init?.method || 'GET'} ${u}`)
      // reopen-order lee la cuenta antes de verificar (la aprobación se amarra a su cierre).
      if ((init?.method || 'GET') === 'GET' && u.includes('/pos_orders?')) return Response.json([{ status: 'pagada', closed_at: '2026-09-24T00:00:00Z' }])
      return base(u, init)
    })
    const token = await tokenDe('a-mesero', 'mesero')
    const { POST } = await import('@/app/api/pos/reopen-order/route')
    const r = await POST(reqConToken('http://x/api/pos/reopen-order', token, { order_id: 'o-1', offline_approved: true, manager: 'Gerente A' }))
    expect(r.status).toBe(403)
    expect(llamadas.some((l) => l.startsWith('PATCH') && l.includes('pos_orders'))).toBe(false)
  })
})
