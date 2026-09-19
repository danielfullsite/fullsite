/**
 * P0_PURCHASE_NUMERIC_NAN — un número tiene que ser un número.
 *
 * Medido en runtime el 2026-09-18 contra el Preview, con lectura de vuelta a la
 * base: una OC creada con `quantity_ordered: "NaN"` devolvió HTTP 200 y quedó
 * guardada con `subtotal = NaN` y `total = NaN`. La fila se ve normal hasta que
 * alguien suma.
 *
 * La causa está en PostgreSQL, no en JavaScript: el tipo `numeric` ordena NaN
 * por ENCIMA de todo número, así que `NaN <= 0` es FALSE y la guarda de
 * cantidad de la RPC lo dejaba pasar. Lo mismo `+Infinity`. Sólo `-Infinity`
 * caía, porque sí es menor que cero.
 *
 * Estas pruebas cubren la capa de ruta. La RPC se prueba aparte, contra un
 * clúster de verdad (`scratchpad/nan-cert.cjs`), porque el comportamiento que
 * falla es de PostgreSQL y un mock no lo reproduciría.
 *
 * TODAS fallan contra el código que hoy está en producción: la ruta pasaba
 * `lines` tal cual al servidor sin mirar los números.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const withPOSAuth = vi.fn()
const unauthorized = () => Response.json({ error: 'No autorizado' }, { status: 401 })
vi.mock('@/lib/api-auth', () => ({ withPOSAuth, unauthorized }))
vi.mock('@/lib/pos-db-policy', () => ({ isManager: (r: string) => r === 'gerente' || r === 'admin' }))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const peticion = (cuerpo: unknown) => new Request('https://app.fullsite.mx/api/pos/purchase-orders', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
}) as never

const LINEA = { ingredient_id: 'uuid-1', quantity_ordered: 1, unit: 'kg', unit_cost: 10 }
const HEADER = { supplier: 'Prov' }

beforeEach(() => {
  vi.clearAllMocks()
  withPOSAuth.mockResolvedValue({ clientId: 'cert-lab', role: 'gerente', staffId: 's1', staffName: 'CERT' })
  process.env.SUPABASE_SERVICE_KEY = 'x'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ejemplo.supabase.co'
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ order_id: 'oc-1', total: 10 }) })
})

const postear = async (cuerpo: unknown) => {
  const { POST } = await import('../app/api/pos/purchase-orders/route')
  return POST(peticion(cuerpo))
}

describe('cantidad: nada que no sea un número finito y positivo', () => {
  const inválidos: [string, unknown][] = [
    ['la cadena "NaN"', 'NaN'],
    ['el número NaN', NaN],
    ['la cadena "Infinity"', 'Infinity'],
    ['el número Infinity', Infinity],
    ['la cadena "-Infinity"', '-Infinity'],
    ['el número -Infinity', -Infinity],
    ['texto', 'tres'],
    ['cadena vacía', ''],
    ['sólo espacios', '   '],
    ['null', null],
    ['booleano', true],
    ['un objeto', {}],
    ['un arreglo', [1]],
    ['cero', 0],
    ['negativo', -5],
  ]
  for (const [qué, valor] of inválidos) {
    it(`${qué} → 400 INVALID_QUANTITY, sin tocar la base`, async () => {
      const res = await postear({ header: HEADER, lines: [{ ...LINEA, quantity_ordered: valor }] })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('INVALID_QUANTITY')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  }

  it('acepta decimales legítimos', async () => {
    const res = await postear({ header: HEADER, lines: [{ ...LINEA, quantity_ordered: 8.7 }] })
    expect(res.status).toBe(200)
  })

  it('acepta una cantidad que viene como cadena numérica', async () => {
    const res = await postear({ header: HEADER, lines: [{ ...LINEA, quantity_ordered: '8.7' }] })
    expect(res.status).toBe(200)
  })
})

describe('costo: finito y no negativo — cero sí es válido', () => {
  const inválidos: [string, unknown][] = [
    ['la cadena "NaN"', 'NaN'],
    ['el número NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['texto', 'gratis'],
    ['cadena vacía', ''],
    ['null', null],
    ['negativo', -0.01],
  ]
  for (const [qué, valor] of inválidos) {
    it(`${qué} → 400 INVALID_UNIT_COST, sin tocar la base`, async () => {
      const res = await postear({ header: HEADER, lines: [{ ...LINEA, unit_cost: valor }] })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('INVALID_UNIT_COST')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  }

  it('costo 0 es legítimo — hay renglones de cortesía', async () => {
    const res = await postear({ header: HEADER, lines: [{ ...LINEA, unit_cost: 0 }] })
    expect(res.status).toBe(200)
  })
})

describe('una línea mala entre varias tumba la orden completa', () => {
  it('la segunda de tres con NaN → 400 y ninguna escritura', async () => {
    const res = await postear({ header: HEADER, lines: [
      LINEA, { ...LINEA, quantity_ordered: 'NaN' }, { ...LINEA, quantity_ordered: 3 },
    ] })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('INVALID_QUANTITY')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('el error dice QUÉ renglón, para que la pantalla lo pueda señalar', async () => {
    const res = await postear({ header: HEADER, lines: [
      LINEA, LINEA, { ...LINEA, unit_cost: 'Infinity' },
    ] })
    expect(await res.json()).toMatchObject({ error: 'INVALID_UNIT_COST', renglon: 3 })
  })

  it('una línea que no es objeto se rechaza señalando su posición', async () => {
    const res = await postear({ header: HEADER, lines: [LINEA, 'no soy una línea'] })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'INVALID_LINE', renglon: 2 })
  })
})

describe('el orden de las guardas no deja colar nada', () => {
  it('tenant en el cuerpo se rechaza ANTES de mirar los números', async () => {
    const res = await postear({ client_id: 'cert-lab', header: HEADER, lines: [{ ...LINEA, quantity_ordered: 'NaN' }] })
    expect((await res.json()).error).toBe('CLIENT_ID_NOT_ACCEPTED')
  })

  it('una orden entera de líneas válidas sí llega al servidor', async () => {
    const res = await postear({ header: HEADER, lines: [
      { ...LINEA, quantity_ordered: 2, unit_cost: 10 },
      { ...LINEA, quantity_ordered: 0.5, unit_cost: 4 },
    ] })
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).p_lines).toHaveLength(2)
  })
})

describe('el alta de ingrediente ya se defendía — que siga así', () => {
  const postearIng = async (cuerpo: unknown) => {
    const { POST } = await import('../app/api/pos/ingredientes/route')
    return POST(peticion(cuerpo))
  }
  for (const [qué, valor] of [['NaN', 'NaN'], ['Infinity', 'Infinity'], ['texto', 'caro'], ['negativo', -1]] as const) {
    it(`costo ${qué} → 400 sin llamar al servidor`, async () => {
      const res = await postearIng({ name: 'Harina', unit: 'kg', cost_per_unit: valor })
      expect(res.status).toBe(400)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  }

  it('un costo normal pasa', async () => {
    const res = await postearIng({ name: 'Harina', unit: 'kg', cost_per_unit: 12.5 })
    expect(res.status).toBe(200)
  })
})
