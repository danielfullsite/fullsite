import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('@/lib/bridge-url', () => ({ getBridgeUrl: () => 'http://127.0.0.1:7718' }))
vi.mock('@/lib/local-network-fetch', () => ({ localNetworkFetch: vi.fn() }))
import { localNetworkFetch } from '@/lib/local-network-fetch'
import { ejecutarComandoCaja } from '@/lib/pedro-comandos'
import { centavosDeTexto, leerFinanzasCaja, reservarEfectivoCaja } from '@/lib/pedro-finanzas'
const fetchLocal = vi.mocked(localNetworkFetch)
const stored = () => Object.keys(localStorage).filter(k => k.startsWith('pos_comando_pendiente:'))
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear()
  localStorage.setItem('fullsite_client_id', 'test-tenant')
  sessionStorage.setItem('pos_actor_session', JSON.stringify({ actor_token: 'synthetic-actor',
    staff: { id: 'employee', name: 'Test', role: 'gerente' }, expires_at: Date.now() + 100000, offline: true }))
})
it('losing a committed ACK then reloading/retrying reuses its exact ID and fields and accepts a durable duplicate', async () => {
  let initial: Record<string, unknown>
  fetchLocal.mockImplementationOnce(async (_url, init) => {
    initial = JSON.parse(String(init?.body))
    expect(stored()).toHaveLength(1)
    expect(new Headers(init?.headers).get('x-fullsite-actor')).toBe('synthetic-actor')
    expect(localStorage.getItem(stored()[0])).not.toContain('synthetic-actor')
    throw new Error('Connection disappeared after fsync')
  })
  await expect(ejecutarComandoCaja('reserve:order:A', 'FINANCIAL_PAYMENT_START', { payment_id: 'first', amount_cents: 2900 })).rejects.toMatchObject({ incierto: true })
  fetchLocal.mockImplementationOnce(async (_url, init) => {
    const retried = JSON.parse(String(init?.body))
    expect(retried).toEqual(initial)
    return Response.json({ results: [{ duplicate: true, receipt: { command_id: retried.command_id, sequence: 9 }, result: { financial_order: { revision: 2 } } }] })
  })
  // A new render generated another payment ID. The original request survives.
  const result = await ejecutarComandoCaja('reserve:order:A', 'FINANCIAL_PAYMENT_START', { payment_id: 'new-render', amount_cents: 5800 })
  expect(result.duplicate).toBe(true); expect(stored()).toHaveLength(0)
  expect(result.recovered).toBe(true)
  expect(result.command.payment_id).toBe('first')
  expect(result.command.amount_cents).toBe(2900)
})
it('one-operation PIN approval is sent only in the header and never changes the logged-in employee', async () => {
  const originalSession = sessionStorage.getItem('pos_actor_session')
  const approval = { actor_token: 'synthetic-manager', staff: { id: 'manager', name: 'Manager', role: 'admin' }, expires_at: Date.now() + 100000, offline: true }
  fetchLocal.mockImplementationOnce(async (_url, init) => {
    expect(new Headers(init?.headers).get('x-fullsite-actor')).toBe(approval.actor_token)
    expect(localStorage.getItem(stored()[0])).not.toContain(approval.actor_token)
    throw new Error('Lost connection')
  })
  await expect(ejecutarComandoCaja('void:o', 'ORDER_VOID', { reason: 'Cliente se retira' }, { actor: approval })).rejects.toMatchObject({ incierto: true })
  expect(sessionStorage.getItem('pos_actor_session')).toBe(originalSession)
  expect(localStorage.getItem(stored()[0])).not.toContain(approval.actor_token)
  await expect(ejecutarComandoCaja('void:o', 'ORDER_VOID', {}, { actor: { ...approval, expires_at: 0 } })).rejects.toMatchObject({ code: 'ACTOR_REQUIRED' })
  expect(fetchLocal).toHaveBeenCalledTimes(1)
})
it('HTTP 200 containing rejection never reports success and releases a definitively rejected request', async () => {
  fetchLocal.mockResolvedValue(Response.json({ results: [{ error: 'Otra terminal modificó la cuenta', code: 'FINANCIAL_REVISION_CONFLICT' }] }))
  await expect(ejecutarComandoCaja('split:o', 'FINANCIAL_SPLIT', {})).rejects.toMatchObject({ code: 'FINANCIAL_REVISION_CONFLICT', incierto: false })
  expect(stored()).toHaveLength(0)
})
it('a missing or unrelated receipt preserves the pending operation and cannot close a sale', async () => {
  fetchLocal.mockResolvedValue(Response.json({ results: [{ event: { payload: { command_id: 'different' } }, result: { financial_order: { status: 'settled' } } }] }))
  await expect(ejecutarComandoCaja('payment:o', 'FINANCIAL_PAYMENT_RESULT', {})).rejects.toMatchObject({ code: 'ACK_UNKNOWN', incierto: true })
  expect(stored()).toHaveLength(1)
})
it('no prepared employee session means no request or optimistic reservation', async () => {
  sessionStorage.clear()
  await expect(ejecutarComandoCaja('payment:o', 'FINANCIAL_PAYMENT_START', {})).rejects.toMatchObject({ code: 'ACTOR_REQUIRED' })
  expect(fetchLocal).not.toHaveBeenCalled(); expect(stored()).toHaveLength(0)
})
it('Caja unavailable or legacy state cannot become a confirmed financial balance', async () => {
  for (const state of [{ authoritative: false, write_authority: 'caja', financial_orders: [] },
    { authoritative: true, write_authority: 'legacy', financial_orders: [] }, { authoritative: true, write_authority: 'caja' }]) {
    fetchLocal.mockResolvedValue(Response.json(state))
    await expect(leerFinanzasCaja('order')).rejects.toMatchObject({ code: 'CAJA_UNAVAILABLE' })
  }
})
it('cash text retains cents exactly and rejects malformed or subcent amounts', () => {
  expect(centavosDeTexto('29')).toBe(2900); expect(centavosDeTexto(' 0.01 ')).toBe(1); expect(centavosDeTexto('58.10')).toBe(5810)
  for (const bad of ['', '-1', 'NaN', '1e3', '1.001', '9007199254740991']) expect(() => centavosDeTexto(bad)).toThrow()
})
it('a reservation at another terminal prevents collecting the unavailable portion', () => {
  const order = { order_id: 'o', revision: 3, accounts: [{ account_id: 'a', balance_cents: 5800, reserved_cents: 2900 }] }
  expect(() => reservarEfectivoCaja(order as never, 'a', 5800)).toThrow('saldo disponible')
  expect(fetchLocal).not.toHaveBeenCalled()
})
