import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const doubles = vi.hoisted(() => ({
  read: vi.fn(), close: vi.fn(), open: vi.fn(), audit: vi.fn(),
  move: vi.fn(), authorize: vi.fn(), readUncertain: vi.fn(),
}))

vi.mock('@/lib/pedro-turnos', () => ({
  leerTurnosCaja: doubles.read,
  cerrarTurnoCaja: doubles.close,
  registrarMovimientoCaja: doubles.move,
}))
vi.mock('@/lib/pos-data', () => ({ openTurno: doubles.open, logAudit: doubles.audit }))
vi.mock('@/lib/pedro-actor', () => ({ autorizarOperacionConPinEnCaja: doubles.authorize }))
vi.mock('@/lib/pedro-impresion', () => ({
  leerImpresionesInciertasCaja: doubles.readUncertain,
  resolverImpresionCaja: vi.fn(),
}))
vi.mock('@/lib/pedro-cajon', () => ({ resolverCajonCaja: vi.fn() }))

import TurnoDeCaja from '@/components/pos/TurnoDeCaja'

const turno = {
  id: 'turno-1', opening_cash_cents: 50000, opened_at: '2026-09-13T12:00:00.000Z',
  opened_by: 'Caja', opening_reconciliation: null,
}
const cierre = {
  id: 'cierre-1', turno_id: 'turno-anterior', opening_cash_cents: 40000,
  cash_sales_cents: 17400, total_paid_cents: 17400, expected_cash_cents: 57400,
  counted_cash_cents: 57400, difference_cents: 0, closed_at: '2026-09-12T22:00:00.000Z', closed_by: 'Gerente',
}

beforeEach(() => {
  vi.clearAllMocks()
  doubles.read.mockResolvedValue({ turno, cierres: [cierre] })
  doubles.readUncertain.mockResolvedValue([])
  doubles.authorize.mockResolvedValue({ actor_token: 'actor' })
})
afterEach(cleanup)

it('reparte las cuatro operaciones en pestañas táctiles dentro de un solo viewport', async () => {
  const { container } = render(createElement(TurnoDeCaja))
  await screen.findByText('Turno abierto y compartido con las terminales.')

  const main = container.querySelector('main') as HTMLElement
  expect(main.className).toContain('h-dvh')
  expect(main.className).toContain('overflow-hidden')

  for (const nombre of ['Turno', 'Retiro / Depósito', 'Último cierre', 'Verificaciones']) {
    const tab = screen.getByRole('tab', { name: nombre })
    expect(tab.className).toContain('min-h-[56px]')
  }

  fireEvent.click(screen.getByRole('tab', { name: 'Verificaciones' }))
  for (const nombre of ['Revisar papel incierto', 'Revisar cajón incierto']) {
    const region = screen.getByRole('region', { name: nombre })
    expect(region.closest('main')).toBe(main)
  }
})

it('mantiene el borrador de movimiento montado al cambiar de pestaña', async () => {
  render(createElement(TurnoDeCaja))
  await screen.findByText('Turno abierto y compartido con las terminales.')

  fireEvent.click(screen.getByRole('tab', { name: 'Retiro / Depósito' }))
  const amount = screen.getByLabelText('Importe del movimiento') as HTMLInputElement
  const reason = screen.getByLabelText('Motivo del movimiento') as HTMLInputElement
  const pin = screen.getByLabelText('PIN de autorización') as HTMLInputElement
  fireEvent.change(amount, { target: { value: '20' } })
  fireEvent.change(reason, { target: { value: 'Resguardo' } })
  fireEvent.change(pin, { target: { value: '1234' } })

  fireEvent.click(screen.getByRole('tab', { name: 'Turno' }))
  expect(document.querySelector('#panel-turno-movimiento')?.hasAttribute('hidden')).toBe(true)
  fireEvent.click(screen.getByRole('tab', { name: 'Retiro / Depósito' }))
  expect(amount.value).toBe('20')
  expect(reason.value).toBe('Resguardo')
  expect(pin.value).toBe('1234')
})

it('un cierre confirmado muestra inmediatamente el último cierre', async () => {
  const nuevoCierre = { ...cierre, id: 'cierre-nuevo', turno_id: turno.id, counted_cash_cents: 65900, expected_cash_cents: 65900 }
  doubles.close.mockResolvedValue(nuevoCierre)
  render(createElement(TurnoDeCaja))
  await screen.findByText('Turno abierto y compartido con las terminales.')

  fireEvent.change(screen.getByLabelText('Efectivo contado al cierre'), { target: { value: '659' } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar cierre de turno' }))

  await screen.findByRole('region', { name: 'Último cierre confirmado' })
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Último cierre' }).getAttribute('aria-selected')).toBe('true'))
  expect(doubles.close).toHaveBeenCalledWith(turno.id, 65900, '')
  expect((screen.getByRole('tab', { name: 'Retiro / Depósito' }) as HTMLButtonElement).disabled).toBe(true)
})

it('la ruta Caja no vuelve a apilar verificaciones fuera del shell', () => {
  const page = readFileSync(join(__dirname, '..', 'app', 'pos', 'turno', 'page.tsx'), 'utf8')
  expect(page).not.toMatch(/import ImpresionesInciertasDeCaja/)
  expect(page).toMatch(/if \(mode === 'caja'\) return <TurnoDeCaja\s*\/>/)
})
