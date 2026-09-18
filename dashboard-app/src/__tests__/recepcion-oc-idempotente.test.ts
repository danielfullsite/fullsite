/**
 * RECEPCIÓN DE OC · el efecto de negocio tiene que ser idempotente, no sólo el asiento.
 *
 * Estas pruebas nacen de un FAIL reproducido en runtime, no de una sospecha.
 * Laboratorio de certificación, 2026-09-18, tenant fullsite-cert-lab-v2, S0=100, Q=5:
 *
 *   primera recepción  → pos_inventory.stock = 105   · 1 movimiento
 *   reintento (misma identidad de operación) → stock = **110** · **1** movimiento
 *
 * El índice único sobre (client_id, movement_operation_key, movement_operation_line)
 * hizo exactamente lo que prometía: un solo asiento. Y el inventario subió dos
 * veces igual, porque el PATCH de stock iba ANTES, sin guarda, con un valor
 * absoluto calculado desde una lectura que el intento anterior ya había movido.
 *
 * Por eso lo que se prueba aquí NO es «se escribió el movimiento», sino la forma
 * de la petición que hace imposible el doble efecto: una sola operación
 * transaccional, con una identidad que depende del HECHO (la recepción de esa
 * OC) y de nada más.
 *
 * El oráculo de verdad —que el stock quede en 105 tras el reintento— vive en el
 * runtime, contra Postgres. Aquí se fija el contrato que lo hace posible; si
 * alguien vuelve a partir la operación en dos escrituras, o mete un timestamp en
 * la identidad, estas pruebas caen antes de llegar al laboratorio.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const recordMovement = vi.fn()
const confirmarMovimientoInventario = vi.fn()
const updateInventoryStock = vi.fn()
const logInventoryMovement = vi.fn()

vi.mock('../lib/inventory', () => ({ recordMovement, confirmarMovimientoInventario }))

vi.stubGlobal('localStorage', {
  getItem: (k: string) => (k === 'fullsite_client_id' ? 'cert-lab' : null),
  setItem: () => {}, removeItem: () => {},
})

const ok = () => ({ success: true, movements_created: 1, stock_updates: 1, cost_updates: 0,
  errors: [], was_duplicate: false, details: [] })

type Renglon = {
  id: number; order_id: string; ingredient_id: string; ingredient_name: string
  quantity_ordered: number; quantity_received: number | null
  unit: string; unit_cost: number; total_cost: number
}
const renglon = (id: number, ingrediente: string, pedido: number, recibido: number | null = null): Renglon => ({
  id, order_id: 'oc-1', ingredient_id: ingrediente, ingredient_name: ingrediente.toUpperCase(),
  quantity_ordered: pedido, quantity_received: recibido, unit: 'kg', unit_cost: 10, total_cost: pedido * 10,
})

/** Lo que identifica el HECHO, separado de quién lo capturó y de cómo llegó la lista. */
const huellaDelHecho = (req: any) => JSON.stringify({
  key: req.idempotency_key, tipo: req.movement_type, tenant: req.client_id,
  lineas: req.lines, metadata: req.metadata,
})

let restockFromPurchaseOrder: typeof import('../lib/pos-data').restockFromPurchaseOrder

beforeEach(async () => {
  vi.clearAllMocks()
  recordMovement.mockResolvedValue(ok())
  const mod = await import('../lib/pos-data')
  restockFromPurchaseOrder = mod.restockFromPurchaseOrder
})

describe('una recepción es UNA operación', () => {
  it('1 · una OC con un renglón llama recordMovement exactamente una vez', async () => {
    await restockFromPurchaseOrder('oc-1', [renglon(7, 'harina', 5)], 'CERT-GERENTE')
    expect(recordMovement).toHaveBeenCalledTimes(1)
    expect(recordMovement.mock.calls[0][0].lines).toHaveLength(1)
  })

  it('2 · una OC con N renglones llama recordMovement UNA vez, con N líneas', async () => {
    await restockFromPurchaseOrder('oc-1',
      [renglon(7, 'harina', 5), renglon(8, 'azucar', 3), renglon(9, 'sal', 2)], 'CERT-GERENTE')
    expect(recordMovement).toHaveBeenCalledTimes(1)
    const req = recordMovement.mock.calls[0][0]
    expect(req.lines).toHaveLength(3)
    expect(req.lines.map((l: any) => l.quantity)).toEqual([5, 3, 2])
  })

  it('4 · la llave de idempotencia es la ORDEN, no el renglón', async () => {
    await restockFromPurchaseOrder('oc-42', [renglon(7, 'harina', 5)], 'CERT-GERENTE')
    expect(recordMovement.mock.calls[0][0].idempotency_key).toBe('po:oc-42')
  })
})

describe('el mismo hecho produce el mismo intent', () => {
  it('3 · los mismos renglones en distinto orden dan la MISMA huella', async () => {
    const a = [renglon(7, 'harina', 5), renglon(8, 'azucar', 3), renglon(9, 'sal', 2)]
    const b = [a[2], a[0], a[1]]   // la misma OC, cargada en otro orden
    await restockFromPurchaseOrder('oc-1', a, 'CERT-GERENTE')
    await restockFromPurchaseOrder('oc-1', b, 'CERT-GERENTE')
    const [r1, r2] = recordMovement.mock.calls.map(c => huellaDelHecho(c[0]))
    expect(r2).toBe(r1)
    // Y el orden canónico es el del id del renglón, no el del arreglo.
    expect(recordMovement.mock.calls[1][0].lines.map((l: any) => l.ingredient_id))
      .toEqual(['harina', 'azucar', 'sal'])
  })

  it('6 · reintentar la misma OC produce la misma petición lógica', async () => {
    const items = [renglon(7, 'harina', 5), renglon(8, 'azucar', 3)]
    await restockFromPurchaseOrder('oc-1', items, 'CERT-GERENTE')
    await restockFromPurchaseOrder('oc-1', items, 'CERT-GERENTE')
    const [r1, r2] = recordMovement.mock.calls.map(c => huellaDelHecho(c[0]))
    expect(r2).toBe(r1)
  })

  it('8 · otro actor NO cambia la identidad del hecho', async () => {
    const items = [renglon(7, 'harina', 5)]
    await restockFromPurchaseOrder('oc-1', items, 'ALMACENISTA-A')
    await restockFromPurchaseOrder('oc-1', items, 'ALMACENISTA-B')
    const [r1, r2] = recordMovement.mock.calls.map(c => huellaDelHecho(c[0]))
    expect(r2).toBe(r1)
    // El actor sí viaja: quién recibió es parte del registro, no de la identidad.
    expect(recordMovement.mock.calls[0][0].actor).toBe('ALMACENISTA-A')
    expect(recordMovement.mock.calls[1][0].actor).toBe('ALMACENISTA-B')
  })

  it('la metadata no lleva nada volátil', async () => {
    await restockFromPurchaseOrder('oc-1', [renglon(7, 'harina', 5)], 'CERT-GERENTE')
    const meta = recordMovement.mock.calls[0][0].metadata
    expect(meta).toEqual({ source: 'purchase_order_reception', purchase_order_id: 'oc-1' })
    for (const prohibido of ['timestamp', 'terminal_id', 'request_id', 'created_at', 'device_id']) {
      expect(Object.keys(meta)).not.toContain(prohibido)
    }
  })
})

describe('dos recepciones distintas son dos hechos', () => {
  it('7 · dos OC con el mismo ingrediente y cantidad llevan llaves distintas', async () => {
    await restockFromPurchaseOrder('oc-A', [renglon(7, 'harina', 5)], 'CERT-GERENTE')
    await restockFromPurchaseOrder('oc-B', [renglon(9, 'harina', 5)], 'CERT-GERENTE')
    const [kA, kB] = recordMovement.mock.calls.map(c => c[0].idempotency_key)
    expect(kA).toBe('po:oc-A')
    expect(kB).toBe('po:oc-B')
    expect(kA).not.toBe(kB)
  })
})

describe('el camino viejo quedó fuera', () => {
  it('5 · no se toca el stock por separado ni se escribe el movimiento suelto', async () => {
    await restockFromPurchaseOrder('oc-1', [renglon(7, 'harina', 5)], 'CERT-GERENTE')
    expect(updateInventoryStock).not.toHaveBeenCalled()
    expect(logInventoryMovement).not.toHaveBeenCalled()
    // Y lo que sí se llamó lleva todo en una sola petición.
    expect(recordMovement).toHaveBeenCalledTimes(1)
  })

  it('el código fuente ya no contiene el patrón leer-sumar-PATCH en la recepción', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const ruta = fileURLToPath(new URL('../lib/pos-data.ts', import.meta.url))
    const fuente = readFileSync(ruta, 'utf8')
    const inicio = fuente.indexOf('export async function restockFromPurchaseOrder')
    const cuerpo = fuente.slice(inicio, fuente.indexOf('\n}', inicio))
    expect(cuerpo).not.toMatch(/updateInventoryStock/)
    expect(cuerpo).not.toMatch(/logInventoryMovement/)
    expect(cuerpo).not.toMatch(/getInventory\(/)
    expect(cuerpo).toMatch(/recordMovement/)
  })
})

describe('el intent durable se cierra', () => {
  /**
   * `recordMovement` congela la intención en IndexedDB ANTES de salir a la red,
   * para que un recargue a media operación no la pierda. Si nadie la cierra, la
   * SIGUIENTE recepción —de otra orden, legítima— choca contra el pendiente y
   * muere con INVENTORY_PENDING sin llegar siquiera a la red.
   *
   * Visto en el laboratorio el 2026-09-18: recibida la OC A, la OC B dejó de
   * aplicar inventario y su orden se quedó en «enviada». La primera versión de
   * este arreglo tenía ese hueco.
   */
  it('tras un recibo confirmado se libera el pendiente, con su misma llave', async () => {
    await restockFromPurchaseOrder('oc-1', [renglon(7, 'harina', 5)], 'CERT-GERENTE')
    expect(confirmarMovimientoInventario).toHaveBeenCalledTimes(1)
    expect(confirmarMovimientoInventario.mock.calls[0][1]).toBe('po:oc-1')
  })

  it('si el recibo NO se confirma, el pendiente NO se borra', async () => {
    recordMovement.mockResolvedValue({ ...ok(), success: false, errors: ['INVENTORY_UNCONFIRMED'] })
    await expect(restockFromPurchaseOrder('oc-1', [renglon(7, 'harina', 5)], 'CERT-GERENTE')).rejects.toThrow()
    expect(confirmarMovimientoInventario).not.toHaveBeenCalled()
  })

  it('dos recepciones legítimas seguidas: cada una cierra la suya', async () => {
    await restockFromPurchaseOrder('oc-A', [renglon(7, 'harina', 5)], 'CERT-GERENTE')
    await restockFromPurchaseOrder('oc-B', [renglon(9, 'harina', 5)], 'CERT-GERENTE')
    expect(confirmarMovimientoInventario.mock.calls.map(c => c[1])).toEqual(['po:oc-A', 'po:oc-B'])
  })
})

describe('sin confirmación no hay recepción', () => {
  it('si el movimiento no se confirma, la recepción LANZA', async () => {
    recordMovement.mockResolvedValue({ ...ok(), success: false, errors: ['INVENTORY_UNCONFIRMED'] })
    await expect(restockFromPurchaseOrder('oc-1', [renglon(7, 'harina', 5)], 'CERT-GERENTE'))
      .rejects.toThrow(/INVENTARIO_NO_CONFIRMADO/)
  })

  it('un renglón recibido en cero no tumba la recepción: sale de las líneas', async () => {
    await restockFromPurchaseOrder('oc-1',
      [renglon(7, 'harina', 5, 5), renglon(8, 'azucar', 3, 0)], 'CERT-GERENTE')
    const lineas = recordMovement.mock.calls[0][0].lines
    expect(lineas).toHaveLength(1)
    expect(lineas[0].ingredient_id).toBe('harina')
  })

  it('una recepción sin nada que aplicar no llama al contrato', async () => {
    await restockFromPurchaseOrder('oc-1', [renglon(7, 'harina', 3, 0)], 'CERT-GERENTE')
    expect(recordMovement).not.toHaveBeenCalled()
  })

  it('cuando no se recibió cantidad explícita, se usa la pedida', async () => {
    await restockFromPurchaseOrder('oc-1', [renglon(7, 'harina', 4, null)], 'CERT-GERENTE')
    expect(recordMovement.mock.calls[0][0].lines[0].quantity).toBe(4)
  })
})
