// Mover un item con la mesa destino ilegible partia la cuenta en dos.
//
// HALLADO el 2026-09-01 barriendo la familia de fallos del 2026-08-31: una respuesta
// fallida convertida en dato vacio.
//
//   const targetRows = targetRes.ok ? await targetRes.json() : []
//   const target = hasTarget ? targetRows[0] : null
//
// Ante un 401 o un 500 al leer la mesa DESTINO, `target` quedaba null — que es
// indistinguible de "esa mesa no tiene cuenta abierta". El paso 5 se iba entonces al
// `else`: CREAR UNA ORDEN NUEVA.
//
// Con la mesa destino ya ocupada, el efecto real era: el item se quitaba de la orden
// origen (paso 4, que si corria) y aparecia una SEGUNDA cuenta en esa mesa. Cuenta
// partida en dos, y el mesero sin saber cual cobrar.
//
// LA REGLA: si no se puede leer el destino, no se mueve nada. Se aborta ANTES del
// PATCH del origen, asi que no queda nada a medias que deshacer.

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/api-auth', () => ({
  withPOSAuth: vi.fn(async () => ({ clientId: 'amalay', role: 'gerente', staffName: 'Ana' })),
  unauthorized: () => Response.json({ error: 'no' }, { status: 401 }),
}))

const ORDEN_ORIGEN = {
  id: 'src-1',
  items: JSON.stringify([{ id: 'i1', nombre: 'Taco', precio: 50 }]),
  updated_at: '2026-09-01T10:00:00Z',
  order_revision: 1,
}

let llamadas: { url: string; method: string }[] = []

/** `destinoOk` decide si la lectura de la mesa destino responde bien. */
function stubFetch(destinoOk: boolean) {
  llamadas = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = String(url)
    const method = init?.method || 'GET'
    llamadas.push({ url: u, method })

    // Lectura de la orden ORIGEN (por id) — siempre bien.
    if (method === 'GET' && u.includes('id=eq.src-1')) {
      return { ok: true, json: async () => [ORDEN_ORIGEN] } as unknown as Response
    }
    // Lectura de la mesa DESTINO (por mesa) — la que se rompe en la prueba.
    if (method === 'GET' && u.includes('mesa=eq.')) {
      return destinoOk
        ? ({ ok: true, json: async () => [] } as unknown as Response)
        : ({ ok: false, status: 500, json: async () => ({}) } as unknown as Response)
    }
    return { ok: true, json: async () => [{ id: 'x', updated_at: '2026-09-01T10:00:01Z' }] } as unknown as Response
  })
}

const req = (body: Record<string, unknown>) => ({
  headers: { get: () => null },
  json: async () => body,
}) as unknown as import('next/server').NextRequest

const cuerpo = { source_order_id: 'src-1', item_id: 'i1', target_mesa: 7, mesero: 'Ana' }

// Nota: la lectura del ORIGEN si estaba bien manejada en esta misma ruta
// (`SOURCE_READ_FAILED`, 502). Solo la del DESTINO caia al `: []`. Eso es lo que
// delata que fue un descuido y no una decision de diseno.

beforeEach(() => {
  vi.unstubAllGlobals()
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'k'
})

const mutaciones = () => llamadas.filter(l => l.method === 'PATCH' || l.method === 'POST')

describe('Si no se puede leer la mesa destino, no se mueve nada', () => {
  it('REGRESION: un 500 al leer el destino aborta con TARGET_READ_FAILED', async () => {
    stubFetch(false)
    const { POST } = await import('@/app/api/pos/transfer-item/route')

    const res = await POST(req(cuerpo))
    const body = await res.json()

    expect(res.status).toBe(502)
    expect(body.error).toBe('TARGET_READ_FAILED')
  })

  it('REGRESION: y NO toca la orden origen — nada a medias', async () => {
    // Esto es lo que de verdad importa. Antes el item ya se habia quitado del origen
    // cuando se descubria el problema.
    stubFetch(false)
    const { POST } = await import('@/app/api/pos/transfer-item/route')

    await POST(req(cuerpo))

    expect(mutaciones(), `no debe haber escrituras: ${JSON.stringify(mutaciones())}`).toHaveLength(0)
  })

  it('REGRESION: y NO crea una orden nueva en la mesa destino', async () => {
    // El efecto visible del bug: una segunda cuenta en una mesa que ya tenia una.
    stubFetch(false)
    const { POST } = await import('@/app/api/pos/transfer-item/route')

    await POST(req(cuerpo))

    expect(llamadas.filter(l => l.method === 'POST')).toHaveLength(0)
  })
})

describe('El camino bueno no se rompio', () => {
  it('con el destino legible y VACIO, si procede a mover', async () => {
    // Destino legible y sin cuenta = crear orden nueva es lo CORRECTO aqui.
    stubFetch(true)
    const { POST } = await import('@/app/api/pos/transfer-item/route')

    const res = await POST(req(cuerpo))

    expect(res.status).not.toBe(502)
    expect(mutaciones().length, 'debe haber escrituras cuando todo se leyo bien').toBeGreaterThan(0)
  })
})
