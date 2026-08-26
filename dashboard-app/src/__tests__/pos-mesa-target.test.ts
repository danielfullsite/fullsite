import { beforeEach, describe, expect, it } from 'vitest'

import {
  POS_TARGET_MESA_KEY,
  clearMesaTarget,
  peekMesaTarget,
  resolveMesa,
  setMesaTarget,
} from '@/lib/pos-navigation'

/**
 * Regresión de campo (2026-08-23): abrir una mesa estando offline.
 *
 * Los dos intentos previos fallaron por el mismo motivo de fondo — la mesa viajaba
 * dentro del query string:
 *   · window.location.href → recarga dura → depende del SW + gate de auth → no abría nada
 *   · router.push          → resolvía el shell cacheado sin ?mesa= → caía a la mesa 1
 *
 * El contrato que se prueba aquí: la mesa viaja FUERA del query, así que sobrevive
 * aunque el query llegue vacío.
 */

function makeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed))
  return {
    setItem: (k: string, v: string) => { map.set(k, v) },
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    removeItem: (k: string) => { map.delete(k) },
  }
}

describe('POS mesa target — sobrevive offline', () => {
  let storage: ReturnType<typeof makeStorage>

  beforeEach(() => { storage = makeStorage() })

  it('EL BUG: sin query y sin target, /pos caía a la mesa 1', () => {
    // Comportamiento histórico preservado para acceso directo a /pos sin intención.
    expect(resolveMesa(null, storage)).toBe(1)
  })

  it('EL FIX: con el query perdido, la mesa parqueada gana sobre el default', () => {
    setMesaTarget(52, storage)
    // Offline el shell cacheado resuelve sin ?mesa= → queryMesa es null.
    expect(resolveMesa(null, storage)).toBe(52)
  })

  it('el query manda cuando sí sobrevivió, aunque haya un target viejo', () => {
    setMesaTarget(52, storage)
    expect(resolveMesa('7', storage)).toBe(7)
  })

  it('un query inválido cae al target, no al default', () => {
    setMesaTarget(12, storage)
    expect(resolveMesa('', storage)).toBe(12)
    expect(resolveMesa('abc', storage)).toBe(12)
  })

  it('rechaza mesas no válidas en vez de parquear basura', () => {
    setMesaTarget(0, storage)
    setMesaTarget(-3, storage)
    setMesaTarget(2.5, storage)
    expect(peekMesaTarget(storage)).toBe(0)
    expect(resolveMesa(null, storage)).toBe(1)
  })

  it('peek no consume: se puede leer durante render sin efectos', () => {
    setMesaTarget(31, storage)
    expect(peekMesaTarget(storage)).toBe(31)
    expect(peekMesaTarget(storage)).toBe(31)
  })

  it('clear evita que una visita posterior reabra una mesa vieja', () => {
    setMesaTarget(44, storage)
    clearMesaTarget(storage)
    expect(peekMesaTarget(storage)).toBe(0)
    expect(resolveMesa(null, storage)).toBe(1)
  })

  it('usa una clave con el prefijo pos_ del resto del POS', () => {
    setMesaTarget(9, storage)
    expect(storage.getItem(POS_TARGET_MESA_KEY)).toBe('9')
    expect(POS_TARGET_MESA_KEY).toBe('pos_target_mesa')
  })

  it('no truena si sessionStorage está bloqueado (modo privado)', () => {
    const hostile = {
      setItem: () => { throw new Error('QuotaExceededError') },
      getItem: () => { throw new Error('SecurityError') },
      removeItem: () => { throw new Error('SecurityError') },
    }
    expect(() => setMesaTarget(5, hostile)).not.toThrow()
    expect(() => clearMesaTarget(hostile)).not.toThrow()
    expect(peekMesaTarget(hostile)).toBe(0)
    // Degrada al comportamiento de hoy, no a una pantalla rota.
    expect(resolveMesa('8', hostile)).toBe(8)
    expect(resolveMesa(null, hostile)).toBe(1)
  })
})

/**
 * Candado contra el flip-flop.
 *
 * Este handler ya cambió de método varias veces (router.push ↔ window.location.href),
 * cada vez arreglando una mitad y rompiendo la otra, y nunca hubo una prueba que se
 * pusiera roja al hacerlo. Las pruebas de arriba cubren el helper pero NO el cableado:
 * si alguien borra la línea `setMesaTarget(mesaNum)` del handler, todas siguen verdes
 * y el bug vuelve en silencio.
 *
 * Estas guardas leen el fuente, siguiendo la convención que ya usan offline-sw.test.ts,
 * network-timeout.test.ts y pos-db-policy.test.ts.
 */
describe('POS mesa target — cableado real de las páginas', () => {
  const read = async (rel: string) => {
    const fs = await import('fs')
    const path = await import('path')
    return fs.readFileSync(path.resolve(__dirname, rel), 'utf-8')
  }

  it('la página de mesas parquea la mesa ANTES de navegar', async () => {
    const src = await read('../app/pos/mesas/page.tsx')
    expect(src, 'falta el import de setMesaTarget').toContain("from '@/lib/pos-navigation'")

    const park = src.indexOf('setMesaTarget(mesaNum)')
    const push = src.indexOf('router.push(`/pos?mesa=${mesaNum}`)')
    expect(park, 'handleMesaClick ya no parquea la mesa — el bug offline vuelve').toBeGreaterThan(-1)
    expect(push, 'handleMesaClick ya no navega por cliente').toBeGreaterThan(-1)
    expect(park, 'parquear DESPUÉS de navegar llega tarde: /pos ya resolvió la mesa').toBeLessThan(push)
  })

  it('la página de mesas NO vuelve a la navegación dura para abrir mesa', async () => {
    const src = await read('../app/pos/mesas/page.tsx')
    // 'about:blank' (cerrar la app) es legítimo; lo prohibido es mandar a /pos con recarga.
    expect(src).not.toContain("window.location.href = `/pos?mesa=")
    expect(src).not.toMatch(/window\.location\.(href|assign|replace)\s*\(?\s*[`'"]\/pos\?mesa=/)
  })

  it('/pos resuelve la mesa por el canal que sobrevive, no por el default crudo', async () => {
    const src = await read('../app/pos/page.tsx')
    expect(src).toContain("resolveMesa(searchParams.get('mesa'))")
    // El `|| 1` crudo sobre el query era exactamente lo que hacía caer a la mesa 1.
    expect(src).not.toContain("(Number(searchParams.get('mesa')) || 1)")
  })

  it('/pos suelta el target una vez usado, para no reabrir una mesa vieja', async () => {
    const src = await read('../app/pos/page.tsx')
    expect(src).toContain('clearMesaTarget()')
  })
})
