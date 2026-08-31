// Envío a cocina — el eslabón que decide si la comanda existe para el cocinero.
//
// Caso de campo, AMALAY 2026-08-30, terminal Entrada: la orden se guardaba en
// Supabase pero la comanda no imprimía ni salía en el KDS, y el mesero no
// recibía ni un aviso. El código anterior (`retryFetch`) devolvía `Promise<void>`
// y estaba documentado como "NUNCA rechaza (best-effort)": tras 4 intentos
// fallidos se rendía en silencio y quien llamaba no podía saberlo.
//
// En la caja ese envío es redundante (Pedro es local, y el KDS además consulta
// Supabase). En un POS secundario es el ÚNICO camino a la cocina. Por eso estas
// pruebas insisten en dos cosas que el código viejo no cumplía:
//   1. un HTTP no-2xx es un FALLO, no un éxito;
//   2. el resultado es observable por el que llama.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendOrderToKitchen, kitchenFailureMessage } from '@/lib/kitchen-bridge'

const ORDEN = {
  command_id: 'op-1',
  command_type: 'ORDER_SENT',
  order_id: 'ord-1',
  mesa: 5,
  mesero: 'Daniel',
  status: 'enviada',
  items: [],
  personas: 2,
  total: 249.4,
  client_id: 'amalay',
}

/** Sin backoff real: el reloj lo controlamos nosotros. */
function sinEspera() {
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
    fn()
    return 0 as unknown as ReturnType<typeof setTimeout>
  }) as typeof setTimeout)
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => vi.restoreAllMocks())

describe('Cocina — rama ONLINE', () => {
  it('un 200 confirma la comanda al primer intento', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const r = await sendOrderToKitchen(ORDEN)

    expect(r.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(r.url).toBe('http://127.0.0.1:7717/events')
  })

  it('postea al bridge con POST y JSON — el contrato de /events no cambia', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await sendOrderToKitchen(ORDEN)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:7717/events')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toMatchObject({ command_type: 'ORDER_SENT', mesa: 5 })
    expect(init.targetAddressSpace).toBe('local')
  })

  it('REGRESION: un HTTP 500 es FALLO, no éxito', async () => {
    // El código viejo sólo reintentaba y luego se rendía sin avisar: un 500
    // repetido se veía exactamente igual que una comanda entregada.
    sinEspera()
    const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    const r = await sendOrderToKitchen(ORDEN)

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('http')
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1) // reintentó
  })

  it('un 502 pasajero se recupera: falla una vez y confirma a la segunda', async () => {
    sinEspera()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const r = await sendOrderToKitchen(ORDEN)

    expect(r.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('registra url y status de cada intento fallido — antes no quedaba rastro', async () => {
    sinEspera()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))

    const r = await sendOrderToKitchen(ORDEN)

    expect(r.ok).toBe(false)
    expect(r.attempts.length).toBeGreaterThan(0)
    expect(r.attempts[0].status).toBe(503)
    expect(console.error).toHaveBeenCalled()
  })
})

describe('Cocina — rama OFFLINE (sin WAN, con LAN)', () => {
  it('sin internet la comanda SIGUE llegando: la LAN no depende de la WAN', async () => {
    // Éste es el corazón del diseño offline. navigator.onLine=false no debe
    // impedir el envío: Pedro vive en la LAN. Ver
    // docs/offline/OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md §4.
    vi.stubGlobal('navigator', { onLine: false })
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const r = await sendOrderToKitchen(ORDEN)

    expect(r.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('si la LAN también está caída, lo reporta como fallo de red', async () => {
    sinEspera()
    vi.stubGlobal('navigator', { onLine: false })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const r = await sendOrderToKitchen(ORDEN)

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('network')
    expect(r.attempts.every(a => a.status === null)).toBe(true)
  })

  it('NUNCA lanza — un throw aquí tumbaría el flujo de envío de la orden', async () => {
    sinEspera()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('cualquier cosa')))
    await expect(sendOrderToKitchen(ORDEN)).resolves.toBeDefined()
  })
})

describe('Cocina — presupuesto de tiempo', () => {
  it('respeta la fecha límite en vez de dejar al mesero esperando', async () => {
    // Reloj falso que salta más allá del deadline en cuanto se consulta.
    let t = 0
    const now = () => { t += 5_000; return t }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const r = await sendOrderToKitchen(ORDEN, { deadlineMs: 1_000, now })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('deadline')
  })
})

describe('Cocina — el mensaje al mesero', () => {
  const base = { ok: false as const, url: 'http://127.0.0.1:7717/events', attempts: [] }

  it('dice que la orden SÍ se guardó — para que no la recapture y duplique', () => {
    const msg = kitchenFailureMessage({ ...base, reason: 'network' })
    expect(msg).toMatch(/se guardó/i)
    expect(msg).toMatch(/NO llegó a cocina/i)
  })

  it('distingue sin conexión de respuesta con error', () => {
    expect(kitchenFailureMessage({ ...base, reason: 'network' })).toMatch(/no hay conexión/i)
    expect(kitchenFailureMessage({
      ...base, reason: 'http', attempts: [{ attempt: 0, status: 503, error: 'HTTP 503' }],
    })).toMatch(/503/)
  })

  it('siempre termina diciendo qué hacer: avisar a cocina', () => {
    for (const reason of ['network', 'http', 'deadline'] as const) {
      expect(kitchenFailureMessage({ ...base, reason })).toMatch(/avisa a cocina/i)
    }
  })
})
