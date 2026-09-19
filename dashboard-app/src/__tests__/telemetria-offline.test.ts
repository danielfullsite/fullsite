/**
 * TELEMETRÍA DE OBSERVACIÓN — oráculos A–L del field cert.
 *
 * Lo que se puede probar sin la base compartida se prueba aquí. Los oráculos que
 * exigen la tabla desplegada (A, H, L y la mitad de E) quedan marcados y se
 * corren en runtime contra `fullsite-cert-lab-v2` DESPUÉS de aplicar la
 * migración — no antes, porque un PASS sin la tabla no probaría nada.
 *
 * La regla dura que vigila todo el archivo:
 *
 *     LA TELEMETRÍA NO PUEDE FALLAR, DEMORAR NI CAMBIAR UNA OPERACIÓN DE NEGOCIO.
 *
 * Por eso varias pruebas rompen la telemetría a propósito y exigen que la
 * operación siga igual.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── dobles ───────────────────────────────────────────────────────────────────
const withPOSAuth = vi.fn()
const unauthorized = () => Response.json({ error: 'No autorizado' }, { status: 401 })
vi.mock('@/lib/api-auth', () => ({ withPOSAuth, unauthorized }))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const peticion = (cuerpo: unknown) => new Request('https://app.fullsite.mx/api/pos/telemetry', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
}) as never

const postear = async (cuerpo: unknown) => {
  const { POST } = await import('../app/api/pos/telemetry/route')
  return POST(peticion(cuerpo))
}

const EVENTO_OK = {
  event_id: 'e-1',
  event_type: 'command_queued',
  observed_at: new Date().toISOString(),
  payload: { queue_depth_after_commit: 3 },
}

beforeEach(() => {
  vi.clearAllMocks()
  withPOSAuth.mockResolvedValue({
    clientId: 'fullsite-cert-lab-v2',
    staffId: 'fullsite-cert-lab-v2-staff-gerente',
    staffName: 'CERT-GERENTE',
    role: 'gerente',
    authType: 'shift_token',
  })
  process.env.SUPABASE_SERVICE_KEY = 'x'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ejemplo.supabase.co'
  fetchMock.mockResolvedValue({ ok: true, status: 201, text: async () => '' })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('A · el endpoint acepta una sesión POS autenticada por shift token', () => {
  it('shift token de gerente → 200', async () => {
    const res = await postear(EVENTO_OK)
    expect(res.status).toBe(200)
  })

  it('shift token de MESERO también observa — un mesero encolando offline es lo que hay que ver', async () => {
    withPOSAuth.mockResolvedValue({ clientId: 'cert', staffId: 's-mesero', staffName: 'X', role: 'mesero', authType: 'shift_token' })
    expect((await postear(EVENTO_OK)).status).toBe(200)
  })

  it('sin sesión → 401 y sin tocar la base', async () => {
    withPOSAuth.mockResolvedValue(null)
    expect((await postear(EVENTO_OK)).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('B · el cuerpo NO puede elegir inquilino', () => {
  for (const [caso, cid] of [['ajeno', 'amalay'], ['el propio', 'fullsite-cert-lab-v2']] as const) {
    it(`client_id ${caso} en el cuerpo → 400, sin llegar a la base`, async () => {
      const res = await postear({ ...EVENTO_OK, client_id: cid })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('CLIENT_ID_NOT_ACCEPTED')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  }

  it('el client_id que viaja a la base es el de la SESIÓN', async () => {
    await postear(EVENTO_OK)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).client_id).toBe('fullsite-cert-lab-v2')
  })
})

describe('C · nunca se persiste el nombre de una persona', () => {
  it('staffName no aparece en ninguna parte de lo enviado', async () => {
    await postear(EVENTO_OK)
    const enviado = fetchMock.mock.calls[0][1].body as string
    expect(enviado).not.toContain('CERT-GERENTE')
  })

  it('el actor es el staffId estable, no el nombre', async () => {
    await postear(EVENTO_OK)
    const cuerpo = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(cuerpo.payload.actor).toBe('fullsite-cert-lab-v2-staff-gerente')
    expect(cuerpo.payload).not.toHaveProperty('staffName')
  })

  it('aunque el cliente MANDE un nombre en el payload, el actor lo sobrescribe la sesión', async () => {
    await postear({ ...EVENTO_OK, payload: { actor: 'Otra Persona' } })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).payload.actor).toBe('fullsite-cert-lab-v2-staff-gerente')
  })
})

describe('D · identidad de terminal: provisionada o nada', () => {
  it('un terminal_id provisionado se persiste tal cual', async () => {
    await postear({ ...EVENTO_OK, terminal_id: 'pos2-caja' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).terminal_id).toBe('pos2-caja')
    expect((await (await postear({ ...EVENTO_OK, terminal_id: 'pos2-caja' })).json()).terminal_identity_state).toBe('PROVISIONED')
  })

  for (const [caso, valor] of [['ausente', undefined], ['vacío', '   '], ['no-texto', 42], ['null', null]] as const) {
    it(`terminal_id ${caso} → null y UNKNOWN, jamás un id inventado`, async () => {
      const res = await postear({ ...EVENTO_OK, terminal_id: valor })
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).terminal_id).toBeNull()
      expect((await res.json()).terminal_identity_state).toBe('UNKNOWN')
    })
  }
})

describe('E · un event_id repetido es UN solo hecho', () => {
  it('el INSERT pide ignorar duplicados y no actualizar nada', async () => {
    await postear(EVENTO_OK)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('on_conflict=client_id,event_id')
    expect(init.headers.Prefer).toContain('resolution=ignore-duplicates')
  })
  // La otra mitad —que la BASE colapse el duplicado— ya está probada en
  // scratchpad/telemetria-schema-cert.cjs contra un clúster real: mismo
  // (tenant,event_id) no duplica, y el MISMO event_id de otro inquilino sí entra.
})

describe('validación de entrada', () => {
  const malos: [string, unknown][] = [
    ['event_id vacío', { ...EVENTO_OK, event_id: '   ' }],
    ['event_id ausente', { ...EVENTO_OK, event_id: undefined }],
    ['event_id kilométrico', { ...EVENTO_OK, event_id: 'x'.repeat(201) }],
    ['event_type fuera de la lista', { ...EVENTO_OK, event_type: 'offline_entered' }],
    ['event_type de negocio', { ...EVENTO_OK, event_type: 'orders.item.added.v1' }],
    ['observed_at ilegible', { ...EVENTO_OK, observed_at: 'ayer' }],
    ['payload que es arreglo', { ...EVENTO_OK, payload: [1, 2] }],
    ['payload gigante', { ...EVENTO_OK, payload: { x: 'y'.repeat(5000) } }],
  ]
  for (const [caso, cuerpo] of malos) {
    it(`${caso} → 400 sin tocar la base`, async () => {
      expect((await postear(cuerpo)).status).toBe(400)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  }

  it('observed_at MUY viejo se acepta: la telemetría offline llega tarde por definición', async () => {
    const hace3dias = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()
    expect((await postear({ ...EVENTO_OK, observed_at: hace3dias })).status).toBe(200)
  })

  it('observed_at en el futuro lejano se rechaza: desordena la reconstrucción', async () => {
    const manana = new Date(Date.now() + 26 * 3600 * 1000).toISOString()
    const res = await postear({ ...EVENTO_OK, observed_at: manana })
    expect((await res.json()).error).toBe('OBSERVED_AT_IN_FUTURE')
  })

  it('los cuatro tipos del contrato se aceptan', async () => {
    for (const t of ['command_queued', 'reconnect_detected', 'queue_drain_started', 'queue_drain_completed']) {
      fetchMock.mockClear()
      expect((await postear({ ...EVENTO_OK, event_type: t })).status).toBe(200)
    }
  })
})

describe('el endpoint no puede tumbar nada', () => {
  it('sin service key → 503, nunca 500', async () => {
    delete process.env.SUPABASE_SERVICE_KEY
    expect((await postear(EVENTO_OK)).status).toBe(503)
  })

  it('si la base falla → 503 y no lanza', async () => {
    fetchMock.mockRejectedValue(new Error('sin red'))
    expect((await postear(EVENTO_OK)).status).toBe(503)
  })
})
