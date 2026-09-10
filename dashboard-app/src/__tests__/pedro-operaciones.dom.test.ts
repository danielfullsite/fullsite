import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('@/lib/bridge-url', () => ({ getBridgeUrl: () => 'http://127.0.0.1:7718' }))
vi.mock('@/lib/local-network-fetch', () => ({ localNetworkFetch: vi.fn() }))
vi.mock('@/lib/pedro-catalogo', () => ({ leerCatalogoCaja: vi.fn(async () => ({ catalog_revision: 'prepared-catalog' })) }))
import { localNetworkFetch } from '@/lib/local-network-fetch'
import { actorDeCaja } from '@/lib/pedro-actor'
import { anularCuentaEnCaja, enviarCuentaEnCaja, guardarCuentaEnCaja, GuardadoAnteriorRecuperado, firmaBorradorParaCaja, moverCuentaEnCaja, type CuentaParaGuardar, type OrdenConfirmada } from '@/lib/pedro-operaciones'
const request = vi.mocked(localNetworkFetch)
const line = { id: 'line-one', menuItemId: 'coffee', nombre: 'Café', cantidad: 1, precio: 50, subtotal: 50, precioExtra: 0, modificadores: [], modifier_ids: ['hot'], notas: '' }
const order: OrdenConfirmada = { id: 'order-one', order_revision: 1, total_cents: 5800, turno_id: 'turn-one', items: [line] }
const draft: CuentaParaGuardar = { id: order.id, turnoId: order.turno_id, revision: 0, mesa: 1, personas: 1, notas: '', discount: 0, items: [line] }
const employee = { staff: { id: 'waiter', name: 'Mesero', role: 'mesero' }, actor_token: 'synthetic-waiter-token', expires_at: Date.now() + 600000, offline: true }
const authorizer = { staff: { id: 'approver', name: 'Encargado', role: 'admin' }, actor_token: 'synthetic-approval-token', expires_at: Date.now() + 600000, offline: true }
const success = (command: Record<string, unknown>, operational_order: OrdenConfirmada, duplicate = false) => Response.json({ results: [{
  ...(duplicate ? { duplicate: true, receipt: { command_id: command.command_id, sequence: 9 } } : { event: { payload: command } }), result: { operational_order },
}] })
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear()
  sessionStorage.setItem('pos_actor_session', JSON.stringify(employee))
})
it('moving a table uses only Caja and one PIN approval, without logging in as the approver', async () => {
  request.mockImplementationOnce(async (url, init) => {
    expect(url).toBe('http://127.0.0.1:7718/auth/pin')
    expect(JSON.parse(String(init?.body))).toEqual({ pin: '987654' })
    return Response.json(authorizer)
  }).mockImplementationOnce(async (url, init) => {
    expect(url).toBe('http://127.0.0.1:7718/events')
    expect(new Headers(init?.headers).get('x-fullsite-actor')).toBe(authorizer.actor_token)
    const command = JSON.parse(String(init?.body))
    expect(command).toMatchObject({ command_type: 'ORDER_MOVE', order_id: order.id, turno_id: order.turno_id, expected_revision: 1, mesa: 2 })
    expect(command).not.toHaveProperty('pin'); expect(command).not.toHaveProperty('role')
    expect(JSON.stringify(localStorage)).not.toContain('987654')
    expect(JSON.stringify(localStorage)).not.toContain(authorizer.actor_token)
    return success(command, { ...order, order_revision: 2, mesa: 2 })
  })
  expect(await moverCuentaEnCaja(order, 2, '987654')).toMatchObject({ id: order.id, mesa: 2, order_revision: 2 })
  expect(actorDeCaja()).toEqual(employee)
  expect(request).toHaveBeenCalledTimes(2)
})
it('a refused PIN cannot send a command or queue a cloud fallback', async () => {
  request.mockResolvedValueOnce(Response.json({ code: 'INVALID_PIN', error: 'PIN inválido' }, { status: 401 }))
  await expect(anularCuentaEnCaja(order, 'Cliente se retira', '987654')).rejects.toMatchObject({ code: 'INVALID_PIN' })
  expect(request).toHaveBeenCalledTimes(1)
  expect(Object.keys(localStorage)).toHaveLength(0)
  expect(actorDeCaja()).toEqual(employee)
})
it('Caja decides the cancellation permission; a correct PIN alone cannot cancel an order', async () => {
  request.mockResolvedValueOnce(Response.json(employee)).mockResolvedValueOnce(Response.json({ results: [{ error: 'Permiso requerido: pos.orders.cancel', code: 'PERMISSION_DENIED' }] }))
  await expect(anularCuentaEnCaja(order, 'Cliente se retira', '987654')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
  expect(order).not.toHaveProperty('status')
  expect(Object.keys(localStorage)).toHaveLength(0)
  expect(actorDeCaja()).toEqual(employee)
})
it('a lost save receipt cannot confirm or replace the new draft', async () => {
  let first: Record<string, unknown> = {}
  request.mockImplementationOnce(async (_url, init) => { first = JSON.parse(String(init?.body)); throw new Error('Lost after commit') })
  await expect(guardarCuentaEnCaja(draft)).rejects.toMatchObject({ incierto: true })
  request.mockImplementationOnce(async (_url, init) => {
    expect(JSON.parse(String(init?.body))).toEqual(first)
    return success(first, order, true)
  })
  const editedDraft = { ...draft, notas: 'Sin azúcar', items: [{ ...line, cantidad: 2, subtotal: 100 }] }
  let recovered: unknown
  try { await guardarCuentaEnCaja(editedDraft) } catch (error) { recovered = error }
  expect(recovered).toBeInstanceOf(GuardadoAnteriorRecuperado)
  expect((recovered as GuardadoAnteriorRecuperado).orden.items[0].cantidad).toBe(1)
  expect(editedDraft.items[0].cantidad).toBe(2)
  expect(editedDraft.notas).toBe('Sin azúcar')
  expect(Object.keys(localStorage)).toHaveLength(0)
})
it('recovering an unchanged save accepts its receipt even when the read revision advanced', async () => {
  let first: Record<string, unknown> = {}
  request.mockImplementationOnce(async (_url, init) => { first = JSON.parse(String(init?.body)); throw new Error('Lost after commit') })
  await expect(guardarCuentaEnCaja(draft)).rejects.toMatchObject({ incierto: true })
  request.mockImplementationOnce(async () => success(first, order, true))
  await expect(guardarCuentaEnCaja({ ...draft, revision: 1 })).resolves.toMatchObject({ id: order.id, order_revision: 1 })
})
it('an old send receipt does not label newly saved consumption as sent; the next send gets a new command', async () => {
  let first: Record<string, unknown> = {}
  request.mockImplementationOnce(async (_url, init) => { first = JSON.parse(String(init?.body)); throw new Error('Lost after send commit') })
  await expect(enviarCuentaEnCaja(order)).rejects.toMatchObject({ incierto: true })
  request.mockImplementationOnce(async (_url, init) => {
    expect(JSON.parse(String(init?.body))).toEqual(first)
    return success(first, { ...order, order_revision: 2 }, true)
  })
  const moreConsumption = { ...order, order_revision: 3, items: [{ ...line, cantidad: 2, subtotal: 100 }] }
  await expect(enviarCuentaEnCaja(moreConsumption)).rejects.toThrow('Los cambios guardados después siguen pendientes de enviar')
  request.mockImplementationOnce(async (_url, init) => {
    const command = JSON.parse(String(init?.body))
    expect(command.command_id).not.toBe(first.command_id)
    expect(command.expected_revision).toBe(3)
    return success(command, { ...moreConsumption, order_revision: 4 })
  })
  await expect(enviarCuentaEnCaja(moreConsumption)).resolves.toMatchObject({ order_revision: 4 })
})

it('a cancelled order can recover its lost receipt with a new approval and the same original command', async () => {
  let original: Record<string, unknown> = {}
  request.mockResolvedValueOnce(Response.json(authorizer)).mockImplementationOnce(async (_url, init) => {
    original = JSON.parse(String(init?.body)); throw new Error('Connection lost after void commit')
  })
  await expect(anularCuentaEnCaja(order, 'Cliente se retira', '987654')).rejects.toMatchObject({ incierto: true })
  request.mockResolvedValueOnce(Response.json(authorizer)).mockImplementationOnce(async (_url, init) => {
    expect(JSON.parse(String(init?.body))).toEqual(original)
    return success(original, { ...order, order_revision: 2, status: 'cancelada' }, true)
  })
  await expect(anularCuentaEnCaja(order, 'Motivo vuelto a escribir', '987654')).resolves.toMatchObject({ status: 'cancelada' })
  expect(Object.keys(localStorage)).toHaveLength(0)
  expect(actorDeCaja()).toEqual(employee)
})

it('server normalization does not masquerade as a draft edit, while a new item during send is preserved as different intent', () => {
  const before = { ...draft, items: [{ ...line, modificadores: ['Sin azúcar'], notas: 'Extra caliente', modifier_ids: ['hot', 'large'] }] }
  const confirmed = { ...before, items: [{ ...before.items[0], modificadores: ['Caliente', 'Grande'], notas: 'Sin azúcar · Extra caliente', modifier_ids: ['large', 'hot'], sent_quantity: 1 }] }
  expect(firmaBorradorParaCaja(before)).toBe(firmaBorradorParaCaja(confirmed))
  const changedWhileSending = { ...confirmed, items: [...confirmed.items, { ...line, id: 'second-line' }] }
  expect(firmaBorradorParaCaja(changedWhileSending)).not.toBe(firmaBorradorParaCaja(confirmed))
})

const financial = { order_id: order.id, turno_id: order.turno_id, currency: 'MXN' as const, revision: 5, order_revision: 1,
  total_cents: 5800, paid_cents: 1000, reserved_cents: 2000, balance_cents: 4800, status: 'open' as const,
  accounts: [{ account_id: 'full', total_cents: 5800, paid_cents: 1000, reserved_cents: 2000, balance_cents: 4800 }], payments: [] }
const dual = (command: Record<string, unknown>, revision = 2) => Response.json({ results: [{ event: { payload: command }, result: {
  operational_order: { ...order, order_revision: revision }, financial_order: { ...financial, revision: 6, order_revision: revision },
} }] })
it('an additive save selects the single account and sends the receipt financial revision for the incremental round', async () => {
  request.mockImplementationOnce(async (_url, init) => {
    const command = JSON.parse(String(init?.body))
    expect(command).toMatchObject({ command_type: 'ORDER_SAVE', expected_financial_revision: 5, account_id: 'full' })
    expect(command).not.toHaveProperty('payments')
    return dual(command)
  }).mockImplementationOnce(async (_url, init) => {
    const command = JSON.parse(String(init?.body))
    expect(command).toMatchObject({ command_type: 'ORDER_SEND', expected_revision: 2, expected_financial_revision: 6 })
    return dual(command, 3)
  })
  const saved = await guardarCuentaEnCaja({ ...draft, financial })
  expect(saved.financial_order).toMatchObject({ paid_cents: 1000, reserved_cents: 2000, balance_cents: 4800 })
  await enviarCuentaEnCaja(saved)
})
it('split additions require an explicit existing destination and reject settled accounts before any command', async () => {
  const split = { ...financial, accounts: [...financial.accounts, { ...financial.accounts[0], account_id: 'second' }] }
  await expect(guardarCuentaEnCaja({ ...draft, financial: split })).rejects.toThrow('Selecciona la cuenta')
  await expect(guardarCuentaEnCaja({ ...draft, financial: split, accountId: 'foreign' })).rejects.toThrow('Selecciona la cuenta')
  await expect(guardarCuentaEnCaja({ ...draft, financial: { ...financial, status: 'settled' } })).rejects.toThrow('ya no admite')
  expect(request).not.toHaveBeenCalled()
  request.mockImplementationOnce(async (_url, init) => {
    const command = JSON.parse(String(init?.body)); expect(command.account_id).toBe('second'); return dual(command)
  })
  await guardarCuentaEnCaja({ ...draft, financial: split, accountId: 'second' })
})
it('lost additive ACK recovers the original account and refuses to confirm a newly selected destination', async () => {
  const split = { ...financial, accounts: [...financial.accounts, { ...financial.accounts[0], account_id: 'second' }] }
  let original: Record<string, unknown> = {}
  request.mockImplementationOnce(async (_url, init) => { original = JSON.parse(String(init?.body)); throw new Error('Lost') })
  await expect(guardarCuentaEnCaja({ ...draft, financial: split, accountId: 'full' })).rejects.toMatchObject({ incierto: true })
  request.mockImplementationOnce(async (_url, init) => {
    expect(JSON.parse(String(init?.body))).toEqual(original); return dual(original)
  })
  await expect(guardarCuentaEnCaja({ ...draft, financial: { ...split, revision: 9 }, accountId: 'second' })).rejects.toBeInstanceOf(GuardadoAnteriorRecuperado)
  expect(Object.keys(localStorage)).toHaveLength(0)
})
it('an incomplete dual receipt retains the same intent until both canonical revisions agree', async () => {
  let original: Record<string, unknown> = {}
  request.mockImplementationOnce(async (_url, init) => { original = JSON.parse(String(init?.body)); return success(original, order) })
  await expect(guardarCuentaEnCaja({ ...draft, financial })).rejects.toMatchObject({ incierto: true })
  expect(Object.keys(localStorage)).toHaveLength(1)
  request.mockImplementationOnce(async (_url, init) => { expect(JSON.parse(String(init?.body))).toEqual(original); return dual(original) })
  await expect(guardarCuentaEnCaja({ ...draft, financial: { ...financial, status: 'settled' } })).resolves.toMatchObject({ financial_order: { reserved_cents: 2000 } })
})
it('a financial conflict preserves the caller draft without a legacy fallback', async () => {
  request.mockResolvedValueOnce(Response.json({ results: [{ code: 'FINANCIAL_REVISION_CONFLICT', error: 'Recarga el saldo' }] }))
  const current = { ...draft, financial, items: [{ ...line, cantidad: 3 }] }
  await expect(guardarCuentaEnCaja(current)).rejects.toMatchObject({ code: 'FINANCIAL_REVISION_CONFLICT' })
  expect(current.items[0].cantidad).toBe(3)
  expect(request).toHaveBeenCalledTimes(1)
})
