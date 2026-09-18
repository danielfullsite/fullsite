/**
 * RECEPCIÓN DE OC · un error no puede parecerse a un éxito.
 *
 * El defecto que estas pruebas cierran se vio completo en el laboratorio el
 * 2026-09-18: con el RPC `pos_scoped_child` ausente, el GET de renglones
 * contestaba 503, `getPurchaseOrderItems` lo convertía en `[]`, y la recepción
 * seguía adelante como si la orden no tuviera productos. Resultado: la OC quedó
 * marcada **«recibida»**, su total recalculado a **$0.00**, el inventario
 * intacto, y **ni un error en pantalla**. Llega el proveedor, el almacenista
 * recibe, y el sistema registra que recibió nada por cero pesos.
 *
 * El fail-open no estaba sólo en el GET. `receiveOrderItems` disparaba los PATCH
 * sin mirar una sola respuesta y devolvía `true`; el resultado de
 * `updatePurchaseOrderStatus` se ignoraba; y no había try/catch alrededor de
 * nada, así que el toast de éxito salía pasara lo que pasara.
 *
 * Tres igualdades que el producto daba por buenas y no lo son:
 *
 *     ERROR                  ≠ LISTA VACÍA
 *     ESCRITURA NO REVISADA  ≠ ESCRITURA CONFIRMADA
 *     CONFIRMACIÓN PARCIAL   ≠ ÉXITO
 *
 * Lo que NO se prueba aquí es atomicidad, porque no la hay ni hace falta: los
 * tres pasos toleran reintento —cantidad absoluta, inventario idempotente por
 * `po:<orderId>`, estado idempotente— así que lo que importa es que el flujo se
 * DETENGA y se pueda repetir, no que se deshaga.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
vi.stubGlobal('localStorage', {
  getItem: (k: string) => (k === 'fullsite_client_id' ? 'cert-lab' : null),
  setItem: () => {}, removeItem: () => {},
})

const respuesta = (status: number, cuerpo: unknown = null) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => cuerpo,
  text: async () => JSON.stringify(cuerpo),
})

let pos: typeof import('../lib/pos-data')

beforeEach(async () => {
  vi.clearAllMocks()
  pos = await import('../lib/pos-data')
})
afterEach(() => vi.clearAllMocks())

// ── A · leer renglones ────────────────────────────────────────────────────────
describe('A · un error de lectura no es una orden sin productos', () => {
  for (const status of [401, 403, 409, 500, 503]) {
    it(`HTTP ${status} LANZA en vez de devolver []`, async () => {
      fetchMock.mockResolvedValue(respuesta(status, { error: 'x' }))
      await expect(pos.getPurchaseOrderItems('oc-1')).rejects.toThrow(/RENGLONES_ILEGIBLES/)
    })
  }

  it('un fallo de transporte LANZA', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(pos.getPurchaseOrderItems('oc-1')).rejects.toThrow(/RENGLONES_ILEGIBLES/)
  })

  it('una respuesta que no es arreglo LANZA', async () => {
    fetchMock.mockResolvedValue(respuesta(200, { message: 'algo' }))
    await expect(pos.getPurchaseOrderItems('oc-1')).rejects.toThrow(/RENGLONES_ILEGIBLES/)
  })
})

// ── B · vacío verdadero ──────────────────────────────────────────────────────
describe('B · una lista vacía de verdad se conserva vacía', () => {
  it('HTTP 200 con [] devuelve [] y NO lanza', async () => {
    fetchMock.mockResolvedValue(respuesta(200, []))
    await expect(pos.getPurchaseOrderItems('oc-1')).resolves.toEqual([])
  })

  it('HTTP 200 con renglones los devuelve tal cual', async () => {
    const filas = [{ id: 1, order_id: 'oc-1', ingredient_id: 'harina', ingredient_name: 'Harina',
      quantity_ordered: 5, quantity_received: null, unit: 'kg', unit_cost: 10, total_cost: 50 }]
    fetchMock.mockResolvedValue(respuesta(200, filas))
    await expect(pos.getPurchaseOrderItems('oc-1')).resolves.toEqual(filas)
  })
})

// ── C · guardar cantidades ───────────────────────────────────────────────────
describe('C · una cantidad que no se guardó no está guardada', () => {
  it('si un PATCH falla, LANZA nombrando el renglón', async () => {
    fetchMock
      .mockResolvedValueOnce(respuesta(204))
      .mockResolvedValueOnce(respuesta(503, { error: 'SCOPED_PROXY_UNAVAILABLE' }))
    await expect(pos.receiveOrderItems('oc-1', [
      { item_id: 1, quantity_received: 5 }, { item_id: 2, quantity_received: 3 },
    ])).rejects.toThrow(/CANTIDAD_NO_CONFIRMADA: renglón 2/)
  })

  it('NO sigue intentando los renglones que faltan tras el primer fallo', async () => {
    fetchMock.mockResolvedValue(respuesta(500, {}))
    await expect(pos.receiveOrderItems('oc-1', [
      { item_id: 1, quantity_received: 5 }, { item_id: 2, quantity_received: 3 }, { item_id: 3, quantity_received: 1 },
    ])).rejects.toThrow(/CANTIDAD_NO_CONFIRMADA/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('un fallo de transporte también LANZA', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(pos.receiveOrderItems('oc-1', [{ item_id: 1, quantity_received: 5 }]))
      .rejects.toThrow(/CANTIDAD_NO_CONFIRMADA/)
  })

  it('con todas confirmadas devuelve true', async () => {
    fetchMock.mockResolvedValue(respuesta(204))
    await expect(pos.receiveOrderItems('oc-1', [
      { item_id: 1, quantity_received: 5 }, { item_id: 2, quantity_received: 3 },
    ])).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('la cantidad viaja como valor ABSOLUTO — por eso el reintento es seguro', async () => {
    fetchMock.mockResolvedValue(respuesta(204))
    await pos.receiveOrderItems('oc-1', [{ item_id: 1, quantity_received: 5 }])
    await pos.receiveOrderItems('oc-1', [{ item_id: 1, quantity_received: 5 }])
    for (const llamada of fetchMock.mock.calls) {
      expect(JSON.parse(llamada[1].body)).toEqual({ quantity_received: 5 })
    }
  })
})

// ── E · el estado de la cabecera ─────────────────────────────────────────────
describe('E · el estado de la orden se revisa', () => {
  it('devuelve false cuando el PATCH no fue aceptado', async () => {
    fetchMock.mockResolvedValue(respuesta(503, {}))
    await expect(pos.updatePurchaseOrderStatus('oc-1', 'recibida', { received_by: 'X' })).resolves.toBe(false)
  })

  it('devuelve true cuando sí lo fue', async () => {
    fetchMock.mockResolvedValue(respuesta(204))
    await expect(pos.updatePurchaseOrderStatus('oc-1', 'recibida', { received_by: 'X' })).resolves.toBe(true)
  })
})

// ── El contrato, leído del código que lo implementa ──────────────────────────
describe('el fail-open no puede volver por descuido', () => {
  const fuente = () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const { fileURLToPath } = require('node:url') as typeof import('node:url')
    return readFileSync(fileURLToPath(new URL('../lib/pos-data.ts', import.meta.url)), 'utf8')
  }
  const pagina = () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const { fileURLToPath } = require('node:url') as typeof import('node:url')
    return readFileSync(fileURLToPath(new URL('../app/pos/compras/page.tsx', import.meta.url)), 'utf8')
  }

  it('getPurchaseOrderItems ya no traduce error a lista vacía', () => {
    const s = fuente()
    const i = s.indexOf('export async function getPurchaseOrderItems')
    const cuerpo = s.slice(i, s.indexOf('\n}', i))
    expect(cuerpo).not.toMatch(/if\s*\(!res\.ok\)\s*return\s*\[\]/)
    expect(cuerpo).toMatch(/RENGLONES_ILEGIBLES/)
  })

  it('receiveOrderItems ya no devuelve true sin revisar', () => {
    const s = fuente()
    const i = s.indexOf('export async function receiveOrderItems')
    const cuerpo = s.slice(i, s.indexOf('\n}', i))
    expect(cuerpo).toMatch(/res\.ok/)
    expect(cuerpo).toMatch(/CANTIDAD_NO_CONFIRMADA/)
  })

  it('F · la confirmación tiene try/catch/finally y el éxito va al final', () => {
    const s = pagina()
    const i = s.indexOf('const handleConfirmReception')
    const cuerpo = s.slice(i, i + 5200)
    expect(cuerpo).toMatch(/try\s*\{/)
    expect(cuerpo).toMatch(/catch\s*\(error\)/)
    expect(cuerpo).toMatch(/finally\s*\{[^}]*setSavingReception\(false\)/)
    // El estado de la cabecera se revisa y detiene el flujo.
    expect(cuerpo).toMatch(/if\s*\(!cabecera\)\s*throw/)
    // El toast de éxito aparece DESPUÉS de que se revisó la cabecera.
    expect(cuerpo.indexOf('if (!cabecera) throw')).toBeLessThan(cuerpo.indexOf('Recepcion completa'))
  })

  it('el modal no abre ni confirma cuando no se pudieron leer los renglones', () => {
    const s = pagina()
    const i = s.indexOf('const openReception')
    const cuerpo = s.slice(i, i + 1400)
    expect(cuerpo).toMatch(/catch/)
    expect(cuerpo).toMatch(/No se pudieron leer los productos/)
    // Y el botón no puede confirmar una orden sin renglones.
    expect(s).toMatch(/disabled=\{!receptionBy\.trim\(\) \|\| savingReception \|\| receptionItems\.length === 0\}/)
  })

  it('el error queda visible y el modal no se cierra', () => {
    const s = pagina()
    expect(s).toMatch(/setReceptionError\(/)
    expect(s).toMatch(/\{receptionError && \(/)
    // En el catch NO se limpia la orden en curso: el modal sigue abierto.
    const i = s.indexOf('catch (error)')
    const cuerpo = s.slice(i, i + 1200)
    expect(cuerpo).not.toMatch(/setReceptionPO\(null\)/)
  })
})
