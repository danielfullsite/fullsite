import { createElement } from 'react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
vi.mock('@/lib/bridge-url', () => ({ getBridgeUrl: () => 'http://127.0.0.1:7718' }))
vi.mock('@/lib/local-network-fetch', () => ({ localNetworkFetch: vi.fn() }))
vi.mock('@/lib/pedro-actor', () => ({ ingresarConPinEnCaja: vi.fn() }))
import { localNetworkFetch } from '@/lib/local-network-fetch'
import { ingresarConPinEnCaja } from '@/lib/pedro-actor'
import { leerCorteCaja } from '@/lib/pedro-reportes'
import CorteDeCaja from '@/components/pos/CorteDeCaja'
const network = vi.mocked(localNetworkFetch)
const session = { staff: { id: 'manager', name: 'Gerente', role: 'gerente' }, actor_token: 'fixture-only', expires_at: Date.now() + 600000, offline: true }
const state = () => ({ authoritative: true, write_authority: 'caja', sequence: 8, order_snapshot_complete: true,
  cash_ledger_version: 1, cash_movements: [],
  financial_orders: [], salon_orders: [], kds_orders: [], turn_summaries: [], turno: { id: 'turn', opened_at: '2026-09-08T14:00:00Z', opening_cash_cents: 50000 } })
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Cloud must not be consulted') }))
  network.mockImplementation(async () => Response.json(state()))
  vi.mocked(ingresarConPinEnCaja).mockResolvedValue(session)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('requires Caja manager authorization, ignores the old access flag and reads X without sending a command', async () => {
  sessionStorage.setItem('corte_access', '1')
  render(createElement(CorteDeCaja))
  expect(screen.queryByText('Venta cobrada', { selector: 'dt' })).toBeNull()
  fireEvent.change(screen.getByLabelText('PIN de gerente'), { target: { value: 'fixture-pin' } })
  fireEvent.click(screen.getByRole('button', { name: 'Consultar corte' }))
  await screen.findByText('Venta cobrada', { selector: 'dt' })
  expect(ingresarConPinEnCaja).toHaveBeenCalledWith('fixture-pin', 'gerente')
  expect(network.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
  expect(screen.getByRole('link', { name: 'Ir al cierre de turno (Z)' }).getAttribute('href')).toBe('/pos/turno')
  expect(fetch).not.toHaveBeenCalled()
})
it('clears previously shown amounts when Caja stops responding, without cloud or IDB fallback', async () => {
  render(createElement(CorteDeCaja))
  fireEvent.change(screen.getByLabelText('PIN de gerente'), { target: { value: 'fixture-pin' } })
  fireEvent.click(screen.getByRole('button', { name: 'Consultar corte' }))
  await screen.findByText('Venta cobrada', { selector: 'dt' })
  network.mockRejectedValue(new TypeError('network unavailable'))
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar corte' }))
  await waitFor(() => expect(screen.queryByText('Venta cobrada', { selector: 'dt' })).toBeNull())
  expect(screen.getByRole('alert').textContent).toMatch(/no está disponible/)
  expect(fetch).not.toHaveBeenCalled()
})
it('works without WAN while Caja is available and blocks expired or lower-role report sessions', async () => {
  await expect(leerCorteCaja(session)).resolves.toMatchObject({ expectedCash: 50000 })
  await expect(leerCorteCaja({ ...session, expires_at: 0 })).rejects.toThrow('PIN de gerente')
  await expect(leerCorteCaja({ ...session, staff: { ...session.staff, role: 'mesero' } })).rejects.toThrow('PIN de gerente')
  expect(network).toHaveBeenCalledTimes(1)
  expect(fetch).not.toHaveBeenCalled()
})
