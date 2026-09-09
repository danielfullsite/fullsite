import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/bridge-url', () => ({ getBridgeUrl: () => 'http://127.0.0.1:7718' }))
vi.mock('@/lib/local-network-fetch', () => ({ localNetworkFetch: vi.fn() }))
import { localNetworkFetch } from '@/lib/local-network-fetch'
import {
  reservarCobroExterno, confirmarCobroExterno, rechazarCobroExterno, marcarCobroExternoIncierto,
  type FinanzasDeCaja, type PagoDeCaja,
} from '@/lib/pedro-finanzas'

// EN AMALAY LA TARJETA NO SE COBRA DESDE EL POS.
//
// Se pasa en la terminal del banco, que es un aparato aparte, y el cajero registra el
// resultado a mano en el punto de venta. Son dos actos manuales, no una integración —
// Daniel lo confirmó el 2026-09-08: "ellos lo cobran en el POS y en la terminal
// manualmente".
//
// El dominio de Caja ya sabía hacer esto desde antes: `financial-domain.js:219` acepta
// `cash` y `external`, con evidencia obligatoria, resultado incierto y recuperación, y
// tiene ocho pruebas. Lo único que faltaba era la pantalla, y por faltar la pantalla el
// producto figuraba como "no cobra con tarjeta" — que habría bloqueado el cierre por una
// razón falsa.
//
// LO QUE ESTAS PRUEBAS PROTEGEN
//
// El tercer resultado. Si la terminal aprueba y se va la luz antes de que alguien vea el
// voucher, el cobro no se puede dar por bueno ni por malo. `RESERVING` incluye 'unknown'
// (financial-domain.js:6), así que el importe sigue apartado, nadie lo cobra dos veces, y
// se resuelve después con el número de autorización. Adivinar ahí es como se cobra dos
// veces o se regala una comida.

const fetchLocal = vi.mocked(localNetworkFetch)

/** Almacen minimo de navegador. El carril de node no trae localStorage, y este codigo
 *  sólo necesita eso — no hay DOM de por medio. Ponerlo aquí deja la prueba en el carril
 *  donde viven las otras 3,014, en vez de en el de jsdom, que este entorno no ejecuta. */
function almacen(): Storage {
  const datos = new Map<string, string>()
  return {
    get length() { return datos.size },
    key: (i: number) => [...datos.keys()][i] ?? null,
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => { datos.set(k, String(v)) },
    removeItem: (k: string) => { datos.delete(k) },
    clear: () => datos.clear(),
  } as Storage
}

const CUENTA = { account_id: 'o1:full', total_cents: 20000, paid_cents: 0, reserved_cents: 0, balance_cents: 20000 }
const finanzas = (over: Partial<FinanzasDeCaja> = {}): FinanzasDeCaja => ({
  order_id: 'o1', turno_id: 't1', currency: 'MXN', revision: 3, order_revision: 5,
  total_cents: 20000, paid_cents: 0, reserved_cents: 0, balance_cents: 20000,
  status: 'open', accounts: [CUENTA], payments: [], ...over,
})
const pagoDeTerminal = (over: Partial<PagoDeCaja> = {}): PagoDeCaja => ({
  payment_id: 'pago-1', account_id: 'o1:full', amount_cents: 20000,
  method: 'external', status: 'pending', provider: 'Terminal bancaria', ...over,
})

/** Captura lo que se le mandó a Caja y devuelve un recibo válido.
 *  El recibo tiene que devolver el MISMO command_id que recibió: `pedro-comandos.ts:60`
 *  rechaza cualquier confirmación cuya identidad no coincida con el intento. */
function capturar() {
  const enviado: Record<string, unknown>[] = []
  fetchLocal.mockImplementation(async (_url, init) => {
    const cmd = JSON.parse(String(init?.body))
    enviado.push(cmd)
    return Response.json({ results: [{ event: { command_id: cmd.command_id, result: { financial_order: finanzas({ revision: 4 }) } } }] })
  })
  return enviado
}

beforeEach(() => {
  vi.stubGlobal('localStorage', almacen())
  vi.stubGlobal('sessionStorage', almacen())
  vi.clearAllMocks()
  localStorage.setItem('fullsite_client_id', 'test-tenant')
  sessionStorage.setItem('pos_actor_session', JSON.stringify({
    actor_token: 'synthetic-actor', staff: { id: 'cajero-1', name: 'Test', role: 'gerente' },
    expires_at: Date.now() + 100000, offline: true,
  }))
})

describe('apartar el importe antes de pasar la tarjeta', () => {
  it('reserva como pago externo, con el nombre de la terminal', async () => {
    const enviado = capturar()
    await reservarCobroExterno(finanzas(), 'o1:full', 20000, 'Terminal bancaria')
    const cmd = enviado[0] as Record<string, unknown>
    expect(cmd.command_type).toBe('FINANCIAL_PAYMENT_START')
    expect(cmd.method).toBe('external')
    expect(cmd.provider).toBe('Terminal bancaria')
    expect(cmd.amount_cents).toBe(20000)
  })

  it('no permite apartar más de lo que la cuenta debe', () => {
    capturar()
    expect(() => reservarCobroExterno(finanzas(), 'o1:full', 25000, 'Terminal bancaria'))
      .toThrow(/supera el saldo/i)
    expect(fetchLocal).not.toHaveBeenCalled()
  })

  it('no permite apartar lo que otra terminal ya tiene apartado', () => {
    // Es el caso de dos cajeros cobrando la misma cuenta a la vez.
    capturar()
    const conReserva = finanzas({ accounts: [{ ...CUENTA, reserved_cents: 15000 }] })
    expect(() => reservarCobroExterno(conReserva, 'o1:full', 10000, 'Terminal bancaria'))
      .toThrow(/supera el saldo/i)
    expect(fetchLocal).not.toHaveBeenCalled()
  })

  it('exige decir en qué terminal se cobra', () => {
    capturar()
    expect(() => reservarCobroExterno(finanzas(), 'o1:full', 20000, '   '))
      .toThrow(/terminal/i)
    expect(fetchLocal).not.toHaveBeenCalled()
  })
})

describe('registrar lo que contestó la terminal', () => {
  it('aprobado guarda la evidencia que el dominio va a comparar', async () => {
    // requireEvidence (financial-domain.js:82-88) compara proveedor, estado, importe y
    // moneda contra el intento reservado. Si algo no cuadra, rechaza el comando.
    const enviado = capturar()
    await confirmarCobroExterno(finanzas(), pagoDeTerminal(), 'AUTH-99231')
    const cmd = enviado[0] as { status: string; evidence: Record<string, unknown> }
    expect(cmd.status).toBe('accepted')
    expect(cmd.evidence).toEqual({
      kind: 'provider_result', provider: 'Terminal bancaria', status: 'accepted',
      reference: 'AUTH-99231', amount_cents: 20000, currency: 'MXN',
    })
  })

  it('rechazado también lleva referencia, para que quede rastro', async () => {
    const enviado = capturar()
    await rechazarCobroExterno(finanzas(), pagoDeTerminal(), 'DECLINADA-51')
    const cmd = enviado[0] as { status: string; evidence: Record<string, unknown> }
    expect(cmd.status).toBe('rejected')
    expect(cmd.evidence).toMatchObject({ status: 'rejected', reference: 'DECLINADA-51' })
  })

  it('el estado del sobre y el de la evidencia siempre coinciden', async () => {
    // Si se desincronizan, el dominio rechaza el comando y el cajero ve un error que no
    // entiende. Se comprueba en los tres caminos.
    for (const [fn, esperado] of [
      [confirmarCobroExterno, 'accepted'], [rechazarCobroExterno, 'rejected'], [marcarCobroExternoIncierto, 'unknown'],
    ] as const) {
      vi.clearAllMocks()
      const enviado = capturar()
      await fn(finanzas(), pagoDeTerminal(), 'REF-1')
      const cmd = enviado[0] as { status: string; evidence: { status: string } }
      expect(cmd.status).toBe(esperado)
      expect(cmd.evidence.status).toBe(esperado)
    }
  })

  it('sin referencia no se registra nada — ni siquiera se llama a Caja', () => {
    capturar()
    for (const fn of [confirmarCobroExterno, rechazarCobroExterno, marcarCobroExternoIncierto]) {
      expect(() => fn(finanzas(), pagoDeTerminal(), '  ')).toThrow(/referencia|autorización/i)
    }
    expect(fetchLocal).not.toHaveBeenCalled()
  })

  it('un pago en efectivo no se puede resolver por este camino', () => {
    capturar()
    expect(() => confirmarCobroExterno(finanzas(), pagoDeTerminal({ method: 'cash', provider: undefined }), 'X'))
      .toThrow(/no se hizo con terminal/i)
    expect(fetchLocal).not.toHaveBeenCalled()
  })
})

describe('el resultado incierto, que es el que evita cobrar dos veces', () => {
  it('«no sé qué pasó» NO es un rechazo', async () => {
    const enviado = capturar()
    await marcarCobroExternoIncierto(finanzas(), pagoDeTerminal(), 'sin voucher, se fue la luz')
    const cmd = enviado[0] as { status: string }
    expect(cmd.status).toBe('unknown')
    expect(cmd.status).not.toBe('rejected')
  })

  it('un cobro incierto se puede resolver después con el voucher', async () => {
    // RESERVING incluye 'unknown', así que el importe sigue apartado y el intento sigue
    // vivo. Cuando aparece el voucher se cierra con su número de autorización.
    const enviado = capturar()
    const incierto = pagoDeTerminal({ status: 'unknown' })
    await confirmarCobroExterno(finanzas(), incierto, 'AUTH-77104')
    const cmd = enviado[0] as { payment_id: string; status: string; evidence: { reference: string } }
    expect(cmd.payment_id).toBe('pago-1')
    expect(cmd.status).toBe('accepted')
    expect(cmd.evidence.reference).toBe('AUTH-77104')
  })

  it('si se pierde la confirmación, el reintento manda EXACTAMENTE el mismo comando', async () => {
    // Es el caso peor de todos: la terminal aprobó, Caja registró, y se cayó la red justo
    // antes del acuse. El cajero vuelve a darle. Si el reintento llevara otro command_id,
    // Caja lo tomaría como un segundo cobro — y el cliente pagaría dos veces.
    let primero: Record<string, unknown> | undefined
    fetchLocal.mockImplementationOnce(async (_url, init) => {
      primero = JSON.parse(String(init?.body))
      throw new Error('la red se cayó después del fsync')
    })
    await expect(confirmarCobroExterno(finanzas(), pagoDeTerminal(), 'AUTH-1'))
      .rejects.toMatchObject({ incierto: true })

    const reintento = capturar()
    await confirmarCobroExterno(finanzas(), pagoDeTerminal(), 'AUTH-1')
    expect(reintento[0]).toEqual(primero)
  })
})
