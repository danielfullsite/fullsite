import { createElement } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
vi.mock('@/lib/bridge-url', () => ({ getBridgeUrl: () => 'http://127.0.0.1:7718' }))
vi.mock('@/lib/local-network-fetch', () => ({ localNetworkFetch: vi.fn() }))
import { localNetworkFetch } from '@/lib/local-network-fetch'
import { abrirFinanzasCaja, avisoAntesDeCobrarCaja } from '@/lib/pedro-finanzas'
import CobroDeCaja from '@/components/pos/CobroDeCaja'
const network = vi.mocked(localNetworkFetch)
const saved = { id: 'order', turno_id: 'turn', order_revision: 3, total_cents: 11600, items: [{ id: 'line', cantidad: 2, sent_quantity: 0 }] }
const finance = { order_id: saved.id, turno_id: 'turn', currency: 'MXN', revision: 1, order_revision: 3, total_cents: 11600,
  paid_cents: 0, balance_cents: 11600, reserved_cents: 0, status: 'open', payments: [], accounts: [{ account_id: 'order:full', total_cents: 11600, paid_cents: 0, reserved_cents: 0, balance_cents: 11600 }] }
const state = (financial_orders: unknown[] = []) => Response.json({ authoritative: true, write_authority: 'caja', financial_orders })
beforeEach(() => {
  cleanup(); vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear()
  sessionStorage.setItem('pos_actor_session', JSON.stringify({ staff: { id: 'cashier', name: 'Caja', role: 'cajero' }, actor_token: 'synthetic', expires_at: Date.now() + 60000, offline: true }))
})
it('the helper cannot create a financial journal or POST while saved consumption is not completely sent', async () => {
  network.mockImplementation(async () => state())
  for (const items of [saved.items, [{ id: 'line', cantidad: 2, sent_quantity: 1 }], undefined]) {
    await expect(abrirFinanzasCaja({ ...saved, items })).rejects.toMatchObject({ code: 'ORDER_SEND_REQUIRED' })
  }
  expect(network.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
  expect(Object.keys(localStorage)).toHaveLength(0)
})
it('the payment screen explains the prerequisite and disables opening instead of freezing the unsent order', async () => {
  network.mockImplementation(async () => state())
  render(createElement(CobroDeCaja, { order: saved, onClose: () => {}, onChanged: () => {} }))
  await screen.findByText('Conectado con Caja')
  expect(screen.getByText(/Envía todos los productos guardados a cocina/)).toBeTruthy()
  const prepare = screen.getByRole('button', { name: 'Preparar cuenta para cobrar' }) as HTMLButtonElement
  expect(prepare.disabled).toBe(true)
  fireEvent.click(prepare)
  expect(network.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
})
it('sent food remains payable while kitchen preparation is pending', async () => {
  const sent = { ...saved, items: [{ id: 'line', cantidad: 2, sent_quantity: 2 }], preparation_status: 'enviada' }
  expect(avisoAntesDeCobrarCaja(sent)).toBeNull()
  network.mockResolvedValueOnce(state()).mockImplementationOnce(async (_url, init) => {
    const command = JSON.parse(String(init?.body))
    expect(command.command_type).toBe('FINANCIAL_OPEN')
    return Response.json({ results: [{ event: { payload: command }, result: { financial_order: finance } }] })
  })
  await expect(abrirFinanzasCaja(sent)).resolves.toMatchObject({ total_cents: 11600, balance_cents: 11600 })
})
it('a previously opened account remains recoverable even with an old UI snapshot of send progress', async () => {
  network.mockResolvedValueOnce(state([finance]))
  await expect(abrirFinanzasCaja(saved)).resolves.toMatchObject({ order_id: 'order', revision: 1 })
  expect(network).toHaveBeenCalledTimes(1)
})

it('an existing financial account uses fresh send progress, blocks new money, and still resolves a pending payment', async () => {
  const pending = { payment_id: 'pending-cash', account_id: 'order:full', amount_cents: 1000, method: 'cash', status: 'pending' }
  const reserved = { ...finance, reserved_cents: 1000, accounts: [{ ...finance.accounts[0], reserved_cents: 1000 }], payments: [pending] }
  network.mockImplementation(async (_url, init) => {
    if (init?.method === 'POST') {
      const command = JSON.parse(String(init.body))
      expect(command).toMatchObject({ command_type: 'FINANCIAL_PAYMENT_RESULT', payment_id: pending.payment_id })
      return Response.json({ results: [{ event: { payload: command }, result: { financial_order: reserved } }] })
    }
    return Response.json({ authoritative: true, write_authority: 'caja', financial_orders: [reserved], salon_orders: [saved] })
  })
  render(createElement(CobroDeCaja, { order: { ...saved, items: [{ cantidad: 2, sent_quantity: 2 }] }, onClose: () => {}, onChanged: () => {} }))
  await screen.findByText('Cobro por confirmar · $10.00')
  expect((screen.getByRole('button', { name: 'Preparar cobro en efectivo' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Cobrar con terminal bancaria' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText('Reservado')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Efectivo recibido pending-cash'), { target: { value: '10' } })
  fireEvent.click(screen.getByRole('button', { name: /Confirmar efectivo recibido/ }))
  await vi.waitFor(() => expect(network.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true))
})

it('opening uses the full fresh operational receipt rather than an old modal total or revision', async () => {
  const fresh = { ...saved, order_revision: 9, total_cents: 17400, items: [{ cantidad: 3, sent_quantity: 3 }] }
  network.mockImplementation(async (_url, init) => {
    if (init?.method === 'POST') {
      const command = JSON.parse(String(init.body))
      expect(command).toMatchObject({ command_type: 'FINANCIAL_OPEN', expected_order_revision: 9, total_cents: 17400 })
      return Response.json({ results: [{ event: { payload: command }, result: { financial_order: { ...finance, total_cents: 17400 } } }] })
    }
    return Response.json({ authoritative: true, write_authority: 'caja', financial_orders: [], salon_orders: [fresh] })
  })
  render(createElement(CobroDeCaja, { order: saved, onClose: () => {}, onChanged: () => {} }))
  const button = await screen.findByRole('button', { name: 'Preparar cuenta para cobrar' })
  await vi.waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(button)
  await vi.waitFor(() => expect(network.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true))
})
