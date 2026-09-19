/**
 * CREAR UNA OC · el nombre de un producto no es su llave primaria.
 *
 * Reproducido el 2026-09-18 con el productor real: escribir «CERT RACE
 * INEXISTENTE» en el formulario hizo que la UI derivara
 * `cert_race_inexistente` (page.tsx:1118, `nombre → slug`), el RPC lo rechazara
 * con SCOPE_CONFLICT, y quedara una cabecera en la base con total $10 y CERO
 * renglones. El control con un id real pasó 3/3 con un hueco de 0 ms entre
 * ambas peticiones, así que nunca fue una carrera: era una referencia inventada.
 *
 * Dos defectos, y ninguno se arregla solo:
 *
 *   P0_PO_INVALID_INGREDIENT_REFERENCE — la UI fabricaba identidades de negocio
 *   P0_PO_CREATE_PARTIAL_COMMIT        — dos POST dejaban cabeceras huérfanas
 *
 * La atomicidad de verdad vive en PostgreSQL (`pos_create_purchase_order`) y se
 * certifica contra un clúster desechable. Lo que se fija aquí es el contrato del
 * cliente: que no haya forma de volver a inventar un id, que un catálogo
 * ilegible no se confunda con uno vacío, y que crear una orden sea UNA petición.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
vi.stubGlobal('localStorage', {
  getItem: (k: string) => (k === 'fullsite_client_id' ? 'cert-lab' : k === 'pos_shift_token' ? 'tok' : null),
  setItem: () => {}, removeItem: () => {},
})

const respuesta = (status: number, cuerpo: unknown = null) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => cuerpo, text: async () => JSON.stringify(cuerpo),
})

let pos: typeof import('../lib/pos-data')
beforeEach(async () => { vi.clearAllMocks(); pos = await import('../lib/pos-data') })

// ── D · catálogo ─────────────────────────────────────────────────────────────
describe('D · un catálogo que no cargó no es un catálogo vacío', () => {
  for (const status of [401, 403, 500, 503]) {
    it(`HTTP ${status} LANZA en vez de devolver []`, async () => {
      fetchMock.mockResolvedValue(respuesta(status, { error: 'x' }))
      await expect(pos.getIngredientCatalogStrict()).rejects.toThrow(/CATALOGO_ILEGIBLE/)
    })
  }
  it('un fallo de transporte LANZA', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(pos.getIngredientCatalogStrict()).rejects.toThrow(/CATALOGO_ILEGIBLE/)
  })
  it('un catálogo legítimamente vacío se conserva vacío', async () => {
    fetchMock.mockResolvedValue(respuesta(200, []))
    await expect(pos.getIngredientCatalogStrict()).resolves.toEqual([])
  })
  it('getIngredients() sigue devolviendo [] — no se cambió bajo sus nueve llamadores', async () => {
    fetchMock.mockResolvedValue(respuesta(503, {}))
    await expect(pos.getIngredients()).resolves.toEqual([])
  })
})

// ── C · alta explícita ───────────────────────────────────────────────────────
describe('C · la identidad del ingrediente la asigna el servidor', () => {
  it('el cliente NO manda ningún id', async () => {
    fetchMock.mockResolvedValue(respuesta(201, { id: 'a3f1e2d4-1111-2222-3333-444455556666', name: 'Harina', unit: 'kg' }))
    await pos.createIngredient({ name: 'Harina', unit: 'kg', cost_per_unit: 12 })
    const cuerpo = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(cuerpo).not.toHaveProperty('id')
    expect(cuerpo).not.toHaveProperty('ingredient_id')
    expect(cuerpo.name).toBe('Harina')
  })

  it('devuelve el ingrediente confirmado, con el id del servidor', async () => {
    const real = { id: 'a3f1e2d4-1111-2222-3333-444455556666', name: 'Harina', unit: 'kg' }
    fetchMock.mockResolvedValue(respuesta(201, real))
    await expect(pos.createIngredient({ name: 'Harina', unit: 'kg' })).resolves.toEqual(real)
  })

  it('va por la frontera autenticada, no a la tabla', async () => {
    fetchMock.mockResolvedValue(respuesta(201, { id: 'x', name: 'H', unit: 'kg' }))
    await pos.createIngredient({ name: 'H', unit: 'kg' })
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/api/pos/ingredientes')
    expect(url).not.toContain('/rest/v1/pos_ingredients')
  })

  it('un nombre repetido se propaga como error, no se traga', async () => {
    fetchMock.mockResolvedValue(respuesta(409, { error: 'INGREDIENT_NAME_TAKEN' }))
    await expect(pos.createIngredient({ name: 'Harina', unit: 'kg' })).rejects.toThrow('INGREDIENT_NAME_TAKEN')
  })

  it('una respuesta sin id NO se da por buena', async () => {
    fetchMock.mockResolvedValue(respuesta(200, { ok: true }))
    await expect(pos.createIngredient({ name: 'H', unit: 'kg' })).rejects.toThrow(/INGREDIENTE_NO_CONFIRMADO/)
  })
})

// ── A/H · crear la orden ─────────────────────────────────────────────────────
describe('A/H · crear una OC es UNA operación', () => {
  it('una sola petición lleva cabecera y renglones', async () => {
    fetchMock.mockResolvedValue(respuesta(200, { order_id: 'oc-1', total: 58 }))
    await pos.createPurchaseOrderAtomic({
      supplier: 'Prov',
      lines: [
        { ingredient_id: 'uuid-1', quantity_ordered: 2, unit: 'kg', unit_cost: 10 },
        { ingredient_id: 'uuid-2', quantity_ordered: 3, unit: 'kg', unit_cost: 5 },
      ],
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const cuerpo = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(cuerpo.header.supplier).toBe('Prov')
    expect(cuerpo.lines).toHaveLength(2)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/pos/purchase-orders')
  })

  it('el tenant NO viaja en el cuerpo: lo resuelve la sesión', async () => {
    fetchMock.mockResolvedValue(respuesta(200, { order_id: 'oc-1', total: 10 }))
    await pos.createPurchaseOrderAtomic({ supplier: 'P',
      lines: [{ ingredient_id: 'uuid-1', quantity_ordered: 1, unit: 'kg', unit_cost: 10 }] })
    const cuerpo = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(cuerpo.header).not.toHaveProperty('client_id')
  })

  it('devuelve el order_id que asignó el servidor', async () => {
    fetchMock.mockResolvedValue(respuesta(200, { order_id: 'oc-servidor', total: 10 }))
    await expect(pos.createPurchaseOrderAtomic({ supplier: 'P',
      lines: [{ ingredient_id: 'u', quantity_ordered: 1, unit: 'kg', unit_cost: 10 }] }))
      .resolves.toMatchObject({ order_id: 'oc-servidor' })
  })
})

// ── E/F/G · rechazo total ────────────────────────────────────────────────────
describe('E/F/G · cuando el servidor rechaza, no hay media orden', () => {
  for (const [caso, err] of [
    ['E · ingrediente de otro tenant', 'INGREDIENT_SCOPE_CONFLICT'],
    ['F · una línea inválida entre N', 'INVALID_QUANTITY'],
    ['G · id de orden repetido', 'ORDER_ID_TAKEN'],
    ['B · id derivado de texto', 'INGREDIENT_SCOPE_CONFLICT'],
  ] as const) {
    it(`${caso}: se propaga como error`, async () => {
      fetchMock.mockResolvedValue(respuesta(409, { error: err }))
      await expect(pos.createPurchaseOrderAtomic({ supplier: 'P',
        lines: [{ ingredient_id: 'x', quantity_ordered: 1, unit: 'kg', unit_cost: 1 }] }))
        .rejects.toThrow(err)
    })
  }

  it('una respuesta sin order_id NO se declara éxito', async () => {
    fetchMock.mockResolvedValue(respuesta(200, { ok: true }))
    await expect(pos.createPurchaseOrderAtomic({ supplier: 'P',
      lines: [{ ingredient_id: 'x', quantity_ordered: 1, unit: 'kg', unit_cost: 1 }] }))
      .rejects.toThrow(/ORDEN_NO_CONFIRMADA/)
  })

  it('sin conexión LANZA', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(pos.createPurchaseOrderAtomic({ supplier: 'P',
      lines: [{ ingredient_id: 'x', quantity_ordered: 1, unit: 'kg', unit_cost: 1 }] }))
      .rejects.toThrow(/ORDEN_NO_CONFIRMADA/)
  })
})

// ── B · el contrato, leído del código ────────────────────────────────────────
describe('B · la derivación de ids no puede volver', () => {
  const pagina = () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const { fileURLToPath } = require('node:url') as typeof import('node:url')
    return readFileSync(fileURLToPath(new URL('../app/pos/compras/page.tsx', import.meta.url)), 'utf8')
  }

  it('ya no existe `nombre → slug → ingredient_id` en compras', () => {
    expect(pagina()).not.toMatch(/ingredient_id:\s*item\.name\.toLowerCase\(\)/)
  })

  it('el renglón lleva una identidad aparte del nombre', () => {
    const s = pagina()
    expect(s).toMatch(/ingredient_id:\s*string/)
    expect(s).toMatch(/elegirIngrediente/)
  })

  it('no se puede enviar sin identidad real en cada renglón', () => {
    expect(pagina()).toMatch(/items\.every\(i => i\.ingredient_id/)
  })

  it('no se puede enviar con el catálogo caído', () => {
    expect(pagina()).toMatch(/!!catalogo && !catalogoError/)
  })

  it('los dos paneles usan el camino transaccional', () => {
    const s = pagina()
    expect(s).not.toMatch(/await createPurchaseOrder\(/)
    expect((s.match(/createPurchaseOrderAtomic\(/g) || []).length).toBeGreaterThanOrEqual(2)
  })

  it('el alta de ingrediente es una acción aparte y explícita', () => {
    const s = pagina()
    expect(s).toMatch(/Crear nuevo ingrediente/)
    expect(s).toMatch(/crearIngrediente/)
  })
})
