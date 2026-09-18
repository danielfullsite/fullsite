/**
 * EL TENANT NUNCA ES ENTRADA DEL CLIENTE.
 *
 * La primera versión de estas rutas rechazaba un `client_id` DISTINTO al de la
 * sesión y aceptaba el que coincidía. Parece inofensivo y no lo es: aceptar el
 * campo enseña que el campo se manda, y el día que alguien lo lea en vez de
 * compararlo, el tenant vuelve a venir del cuerpo. Es la forma exacta de la fuga
 * cross-tenant que ya se cerró una vez en este producto (`withPOSAuth` ya no
 * adivina el tenant de un usuario con varias membresías).
 *
 * Hay UNA fuente de verdad —`withPOSAuth`— y el campo no se admite en ningún
 * nivel del cuerpo: raíz, header, o cualquier línea. Coincida o no.
 *
 * Y el estado tampoco: una orden nueva nace en borrador. Si el caller pudiera
 * mandar `status`, podría crear una OC ya «recibida» —con lo que eso implica
 * para inventario y para cuentas por pagar— sin que nadie recibiera nada.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const withPOSAuth = vi.fn()
const unauthorized = () => Response.json({ error: 'UNAUTHORIZED' }, { status: 401 })
vi.mock('@/lib/api-auth', () => ({ withPOSAuth, unauthorized }))
vi.mock('@/lib/pos-db-policy', () => ({ isManager: (r: string) => r === 'gerente' || r === 'admin' }))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const peticion = (cuerpo: unknown) => new Request('https://app.fullsite.mx/api/pos/x', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
}) as never

const LINEA = { ingredient_id: 'uuid-1', quantity_ordered: 1, unit: 'kg', unit_cost: 10 }
// El header limpio ya NO lleva `created_by`: la procedencia la pone la sesión.
const HEADER = { supplier: 'Prov' }

beforeEach(() => {
  vi.clearAllMocks()
  withPOSAuth.mockResolvedValue({ clientId: 'cert-lab', role: 'gerente', staffId: 's1' })
  process.env.SUPABASE_SERVICE_KEY = 'x'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ejemplo.supabase.co'
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ order_id: 'oc-1', total: 10, id: 'ing-1' }) })
})

describe('C · /api/pos/purchase-orders no acepta el tenant del cuerpo', () => {
  const casos: [string, unknown][] = [
    ['en la raíz, COINCIDIENDO con la sesión', { client_id: 'cert-lab', header: HEADER, lines: [LINEA] }],
    ['en la raíz, de otro tenant', { client_id: 'otro', header: HEADER, lines: [LINEA] }],
    ['en el header, coincidiendo', { header: { ...HEADER, client_id: 'cert-lab' }, lines: [LINEA] }],
    ['en el header, ajeno', { header: { ...HEADER, client_id: 'otro' }, lines: [LINEA] }],
    ['en una línea, coincidiendo', { header: HEADER, lines: [{ ...LINEA, client_id: 'cert-lab' }] }],
    ['en una línea, ajeno', { header: HEADER, lines: [{ ...LINEA, client_id: 'otro' }] }],
    ['en la segunda de dos líneas', { header: HEADER, lines: [LINEA, { ...LINEA, client_id: 'cert-lab' }] }],
  ]
  for (const [donde, cuerpo] of casos) {
    it(`${donde} → rechazado`, async () => {
      const { POST } = await import('../app/api/pos/purchase-orders/route')
      const res = await POST(peticion(cuerpo))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('CLIENT_ID_NOT_ACCEPTED')
      expect(fetchMock).not.toHaveBeenCalled()   // ni siquiera llega a la base
    })
  }

  it('sin client_id en ningún lado, pasa', async () => {
    const { POST } = await import('../app/api/pos/purchase-orders/route')
    const res = await POST(peticion({ header: HEADER, lines: [LINEA] }))
    expect(res.status).toBe(200)
    // Y el tenant que viaja al RPC es el de la SESIÓN.
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).p_client_id).toBe('cert-lab')
  })
})

describe('A · el estado de una OC nueva no lo elige quien llama', () => {
  for (const status of ['recibida', 'borrador', 'enviada', 'pagada']) {
    it(`header.status="${status}" → rechazado`, async () => {
      const { POST } = await import('../app/api/pos/purchase-orders/route')
      const res = await POST(peticion({ header: { ...HEADER, status }, lines: [LINEA] }))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('STATUS_NOT_ACCEPTED')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  }
})

describe('C · /api/pos/ingredientes tampoco acepta el tenant del cuerpo', () => {
  for (const [donde, cid] of [['coincidiendo', 'cert-lab'], ['ajeno', 'otro']] as const) {
    it(`client_id ${donde} → rechazado`, async () => {
      const { POST } = await import('../app/api/pos/ingredientes/route')
      const res = await POST(peticion({ name: 'Harina', unit: 'kg', client_id: cid }))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('CLIENT_ID_NOT_ACCEPTED')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  }

  it('sin client_id, el tenant sale de la sesión', async () => {
    const { POST } = await import('../app/api/pos/ingredientes/route')
    const res = await POST(peticion({ name: 'Harina', unit: 'kg', cost_per_unit: 10 }))
    expect(res.status).toBe(200)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).p_client_id).toBe('cert-lab')
  })

  it('el cliente no puede proponer un id', async () => {
    const { POST } = await import('../app/api/pos/ingredientes/route')
    await POST(peticion({ name: 'Harina', unit: 'kg' }))
    const enviado = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(enviado).not.toHaveProperty('p_id')
    expect(Object.values(enviado)).not.toContain('harina')
  })
})

describe('E · CREATED_BY es procedencia, no entrada del cliente', () => {
  it('CREATED_BY_FROM_AUTH · el nombre viene de la sesión', async () => {
    withPOSAuth.mockResolvedValue({ clientId: 'cert-lab', role: 'gerente', staffId: 's1', staffName: 'CERT-GERENTE' })
    const { POST } = await import('../app/api/pos/purchase-orders/route')
    await POST(peticion({ header: HEADER, lines: [LINEA] }))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).p_created_by).toBe('CERT-GERENTE')
  })

  it('sin nombre en la sesión, cae al id del staff — nunca al cuerpo', async () => {
    withPOSAuth.mockResolvedValue({ clientId: 'cert-lab', role: 'gerente', staffId: 'staff-42' })
    const { POST } = await import('../app/api/pos/purchase-orders/route')
    await POST(peticion({ header: HEADER, lines: [LINEA] }))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).p_created_by).toBe('staff-42')
  })

  it('CLIENT_CREATED_BY_REJECTED · afirmar ser otra persona se rechaza', async () => {
    const { POST } = await import('../app/api/pos/purchase-orders/route')
    const res = await POST(peticion({ header: { ...HEADER, created_by: 'Otra Persona' }, lines: [LINEA] }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('CREATED_BY_NOT_ACCEPTED')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('tampoco se acepta aunque coincida con el actor de la sesión', async () => {
    const { POST } = await import('../app/api/pos/purchase-orders/route')
    const res = await POST(peticion({ header: { ...HEADER, created_by: 'CERT-GERENTE' }, lines: [LINEA] }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('CREATED_BY_NOT_ACCEPTED')
  })
})

describe('D · CLIENT_CANNOT_OVERRIDE_TAX', () => {
  for (const campo of ['iva', 'total', 'subtotal', 'iva_rate', 'tax_rate']) {
    it(`header.${campo} → rechazado`, async () => {
      const { POST } = await import('../app/api/pos/purchase-orders/route')
      const res = await POST(peticion({ header: { ...HEADER, [campo]: 0.99 }, lines: [LINEA] }))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('AMOUNTS_NOT_ACCEPTED')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  }

  it('lo que viaja al servidor no lleva importes ni tasa', async () => {
    const { POST } = await import('../app/api/pos/purchase-orders/route')
    await POST(peticion({ header: HEADER, lines: [LINEA] }))
    const enviado = JSON.parse(fetchMock.mock.calls[0][1].body)
    for (const campo of ['iva', 'total', 'subtotal', 'iva_rate', 'tax_rate']) {
      expect(enviado.p_header).not.toHaveProperty(campo)
    }
  })
})

describe('autoridad', () => {
  it('sin sesión: 401 en ambas rutas', async () => {
    withPOSAuth.mockResolvedValue(null)
    for (const ruta of ['purchase-orders', 'ingredientes']) {
      const { POST } = await import(`../app/api/pos/${ruta}/route`)
      expect((await POST(peticion({ header: HEADER, lines: [LINEA], name: 'X', unit: 'kg' }))).status).toBe(401)
    }
  })

  it('sin rol de gerente: 403 en ambas rutas', async () => {
    withPOSAuth.mockResolvedValue({ clientId: 'cert-lab', role: 'mesero', staffId: 's2' })
    for (const ruta of ['purchase-orders', 'ingredientes']) {
      const { POST } = await import(`../app/api/pos/${ruta}/route`)
      const res = await POST(peticion({ header: HEADER, lines: [LINEA], name: 'X', unit: 'kg' }))
      expect(res.status).toBe(403)
      expect((await res.json()).error).toBe('MANAGER_REQUIRED')
    }
  })
})
