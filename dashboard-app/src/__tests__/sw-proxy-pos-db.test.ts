// El proxy /api/pos/db se cachea con la politica de la consulta que lleva adentro.
//
// P0 del barrido 2026-09-10 (offline-queue LENTE-1): la terminal con PIN consulta
// pos_orders y pos_turnos por `/api/pos/db?path=...`; para el SW el pathname era
// `/api/pos/db` y NEVER_CACHE no lo veia. Cada 200 iba al cache dinamico y, sin
// red, `ignoreSearch` devolvia cualquier `/api/pos/db?...` como 200 sin marca:
// una orden cobrada reaparecia abierta; un turno cerrado en Caja resucitaba.
//
// Estas pruebas EJECUTAN sw.js en un contexto falso (no solo leen su fuente) y
// disparan el handler de fetch con peticiones reales.

import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

type Handler = (event: { request: Request; respondWith: (p: Promise<Response>) => void; waitUntil: (p: Promise<unknown>) => void }) => void

function cargarSW(opts: { fetchFalla: boolean; cache: Map<string, Response> }) {
  const listeners: Record<string, Handler> = {}
  const matches: { url: string; ignoreSearch: boolean }[] = []
  const caches = {
    async open() { return { async put() {}, async match() { return undefined } } },
    async keys() { return [] },
    async delete() { return true },
    async match(req: Request | string, o?: { ignoreSearch?: boolean }) {
      const url = typeof req === 'string' ? req : req.url
      matches.push({ url, ignoreSearch: !!o?.ignoreSearch })
      if (opts.cache.has(url)) return opts.cache.get(url)!.clone()
      if (o?.ignoreSearch) {
        const base = url.split('?')[0]
        for (const [k, v] of opts.cache) if (k.split('?')[0] === base) return v.clone()
      }
      return undefined
    },
  }
  const ctx = {
    self: { addEventListener: (n: string, h: Handler) => { listeners[n] = h }, skipWaiting() {}, clients: { claim() {} } },
    caches,
    fetch: async () => { if (opts.fetchFalla) throw new TypeError('Failed to fetch'); return new Response('[]', { status: 200 }) },
    console: { log() {}, warn() {} },
    URL, Response, Headers, Request, AbortController, setTimeout, clearTimeout, Promise,
  }
  vm.createContext(ctx)
  vm.runInContext(readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8'), ctx)
  return { onFetch: listeners.fetch, matches }
}

async function despachar(sw: ReturnType<typeof cargarSW>, url: string) {
  let respuesta: Promise<Response> | null = null
  const request = new Request(url, { method: 'GET' })
  sw.onFetch({ request, respondWith: (p) => { respuesta = p }, waitUntil() {} })
  return respuesta ? await (respuesta as Promise<Response>) : null
}

const ORIGEN = 'https://app.fullsite.mx'
const proxy = (consulta: string) => `${ORIGEN}/api/pos/db?path=${encodeURIComponent(consulta)}`

describe('el proxy de la terminal hereda la politica de la consulta', () => {
  let cache: Map<string, Response>
  beforeEach(() => { cache = new Map() })

  it('REGRESION: pos_orders y pos_mesas por proxy NO se interceptan (el fetch falla limpio, como el directo)', async () => {
    const sw = cargarSW({ fetchFalla: true, cache })
    expect(await despachar(sw, proxy('pos_orders?client_id=eq.amalay&mesa=eq.5&status=in.(enviada)'))).toBeNull()
    expect(await despachar(sw, proxy('pos_mesas?client_id=eq.amalay'))).toBeNull()
    expect(sw.matches).toHaveLength(0)
  })

  it('REGRESION: sin red, pos_turnos por proxy solo sirve el match EXACTO y lo marca como guardado', async () => {
    const otraConsulta = proxy('pos_staff?client_id=eq.amalay')
    cache.set(otraConsulta, new Response('[{"pin":"1234"}]', { status: 200 }))
    const sw = cargarSW({ fetchFalla: true, cache })
    const res = await despachar(sw, proxy('pos_turnos?client_id=eq.amalay&status=eq.abierto'))
    expect(res).not.toBeNull()
    expect(res!.status, 'nada exacto en cache: 503, nunca la respuesta de otra consulta').toBe(503)
    expect(sw.matches.every(m => !m.ignoreSearch), 'una consulta REST jamas se empata ignorando el query').toBe(true)

    const exacta = proxy('pos_turnos?client_id=eq.amalay&status=eq.abierto')
    cache.set(exacta, new Response('[{"id":"t1"}]', { status: 200 }))
    const sw2 = cargarSW({ fetchFalla: true, cache })
    const res2 = await despachar(sw2, exacta)
    expect(res2!.status).toBe(200)
    expect(res2!.headers.get('X-Fullsite-Stale'), 'lo guardado se entrega MARCADO').toBe('1')
  })

  it('con red, el proxy responde de la red (200 sin marca)', async () => {
    const sw = cargarSW({ fetchFalla: false, cache })
    const res = await despachar(sw, proxy('pos_menu_items?client_id=eq.amalay'))
    expect(res!.status).toBe(200)
    expect(res!.headers.get('X-Fullsite-Stale')).toBeNull()
  })

  it('la version del cache subio: el cache dinamico envenenado se purga al activar', () => {
    const src = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8')
    const v = Number(src.match(/CACHE_VERSION = 'v(\d+)'/)![1])
    expect(v).toBeGreaterThanOrEqual(48)
  })
})
