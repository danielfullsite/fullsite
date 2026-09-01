// La IA decia "no hubo ventas" cuando en realidad no habia podido leerlas.
//
// HALLADO el 2026-09-01 barriendo la familia del 2026-08-31 (una respuesta fallida
// convertida en dato vacio). En `pos-daily.ts`:
//
//   orders = res.ok ? await res.json() : []
//   if (orders.length === 0) return []
//
// Esa funcion alimenta el chat de IA, el coach y la voz. Con un 401 o un timeout, la
// lista quedaba vacia y el chat respondia que no hubo ventas — AFIRMANDOLO.
//
// Es la misma clase que el dashboard que truncaba en 5,000 ordenes y acusaba
// falsamente al POS de estar caido. Un numero equivocado dicho con seguridad es peor
// que no tener el numero.
//
// COMPATIBILIDAD: `buildDailyFromOrders` conserva su contrato de siempre — devuelve
// `[]` y NUNCA lanza — porque el chat no puede fallar y hay seis llamadas vivas que
// dependen de eso. Lo nuevo es `buildDailyConEstado`.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildDailyFromOrders, buildDailyConEstado } from '@/lib/pos-daily'

const SB = 'https://x.supabase.co'
const H = { apikey: 'k', Authorization: 'Bearer k' }

const ORDEN = {
  created_at: '2026-09-01T20:00:00Z',
  total: 500, subtotal: 431, descuento: 0, propina: 0,
  mesero: 'Ana', metodo_pago: 'efectivo', personas: 2, items: '[]',
}

function stubFetch(modo: 'ok' | 'vacio' | 'http401' | 'red') {
  vi.stubGlobal('fetch', async () => {
    if (modo === 'red') throw new TypeError('Failed to fetch')
    if (modo === 'http401') return { ok: false, status: 401, json: async () => ({}) } as unknown as Response
    return { ok: true, json: async () => (modo === 'vacio' ? [] : [ORDEN]) } as unknown as Response
  })
}

beforeEach(() => vi.unstubAllGlobals())

describe('No poder leer las ventas NO es "no hubo ventas"', () => {
  it('REGRESION: un 401 devuelve determinado=false, no una lista vacia inocente', async () => {
    stubFetch('http401')
    const r = await buildDailyConEstado(SB, H, 'amalay', 14)

    expect(r.determinado).toBe(false)
    expect(r.dias).toEqual([])
    if (!r.determinado) expect(r.motivo).toContain('401')
  })

  it('un fallo de red tambien', async () => {
    stubFetch('red')
    const r = await buildDailyConEstado(SB, H, 'amalay', 14)

    expect(r.determinado).toBe(false)
    if (!r.determinado) expect(r.motivo).toMatch(/conexion/i)
  })

  it('CERO ventas de verdad SI es determinado — la distincion es el punto', async () => {
    // Un dia sin ventas es un hecho valido y la IA debe poder decirlo.
    stubFetch('vacio')
    const r = await buildDailyConEstado(SB, H, 'amalay', 14)

    expect(r.determinado, 'una lista vacia CONFIRMADA es un dato, no un fallo').toBe(true)
    expect(r.dias).toEqual([])
  })

  it('con ventas reales devuelve los dias agregados', async () => {
    stubFetch('ok')
    const r = await buildDailyConEstado(SB, H, 'amalay', 14)

    expect(r.determinado).toBe(true)
    expect(r.dias.length).toBeGreaterThan(0)
  })

  it('sin clientId no consulta nada y no truena', async () => {
    stubFetch('ok')
    const r = await buildDailyConEstado(SB, H, '', 14)
    expect(r.determinado).toBe(true)
    expect(r.dias).toEqual([])
  })
})

describe('El contrato viejo NO se rompio — el chat no puede fallar', () => {
  it('buildDailyFromOrders sigue devolviendo [] y NUNCA lanza ante un 401', async () => {
    // Seis llamadas vivas dependen de esto. Si lanzara, tumbaria el chat.
    stubFetch('http401')
    await expect(buildDailyFromOrders(SB, H, 'amalay', 14)).resolves.toEqual([])
  })

  it('tampoco lanza ante un fallo de red', async () => {
    stubFetch('red')
    await expect(buildDailyFromOrders(SB, H, 'amalay', 14)).resolves.toEqual([])
  })

  it('y sigue devolviendo los dias cuando todo va bien', async () => {
    stubFetch('ok')
    const dias = await buildDailyFromOrders(SB, H, 'amalay', 14)
    expect(dias.length).toBeGreaterThan(0)
  })
})

describe('El chat le dice a la IA que NO tiene el dato', () => {
  const chat = readFileSync(join(process.cwd(), 'src/app/api/chat/route.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('usa la version con estado', () => {
    expect(chat).toContain('buildDailyConEstado(')
    expect(chat).toContain('ventasDeterminadas')
  })

  it('REGRESION: ante un fallo, el contexto PROHIBE afirmar que no hubo ventas', () => {
    // Sin esta instruccion explicita, el modelo ve una lista vacia y concluye cero.
    const i = chat.indexOf('let dailyContext')
    const bloque = chat.slice(i, i + 700)
    expect(bloque).toContain('ventasDeterminadas')
    expect(bloque).toMatch(/NO PUDIERON CONSULTAR|no se pudieron consultar/i)
    expect(bloque).toMatch(/no digas que no hubo ventas/i)
  })

  it('el motivo del fallo llega al contexto, no se traga', () => {
    const i = chat.indexOf('let dailyContext')
    expect(chat.slice(i, i + 700)).toContain('motivoVentas')
  })
})
