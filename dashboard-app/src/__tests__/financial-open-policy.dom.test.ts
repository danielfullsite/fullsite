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
