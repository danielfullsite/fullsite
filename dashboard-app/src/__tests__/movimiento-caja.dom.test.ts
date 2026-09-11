import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
const { send, approve } = vi.hoisted(() => ({ send: vi.fn(), approve: vi.fn() }))
vi.mock('@/lib/pedro-turnos', () => ({ registrarMovimientoCaja: send }))
vi.mock('@/lib/pedro-actor', () => ({ autorizarOperacionConPinEnCaja: approve }))
import MovimientoDeCaja from '@/components/pos/MovimientoDeCaja'
beforeEach(() => { approve.mockResolvedValue({ actor_token: 'synthetic' }) })
afterEach(() => { cleanup(); vi.resetAllMocks() })
const enter = (amount: string, reason: string) => {
  fireEvent.change(screen.getByLabelText('Importe del movimiento'), { target: { value: amount } })
  fireEvent.change(screen.getByLabelText('Motivo del movimiento'), { target: { value: reason } })
  fireEvent.change(screen.getByLabelText('PIN de autorización'), { target: { value: '1234' } })
}
it('recuperar un recibo anterior preserva el nuevo borrador y exige otra confirmación', async () => {
  send.mockRejectedValueOnce(new Error('Sin confirmación de Caja'))
    .mockResolvedValueOnce({ recovered: true, movement: { type: 'retiro', amount_cents: 2000, reason: 'Proveedor' } })
    .mockResolvedValueOnce({ recovered: false, movement: { type: 'deposito', amount_cents: 500, reason: 'Cambio' } })
  render(React.createElement(MovimientoDeCaja, { turnoId: 'turno' }))
  enter('20', 'Proveedor')
  fireEvent.click(screen.getByText('Confirmar movimiento'))
  await screen.findByText('Sin confirmación de Caja')
  fireEvent.change(screen.getByLabelText('Tipo de movimiento'), { target: { value: 'deposito' } })
  enter('5', 'Cambio')
  fireEvent.click(screen.getByText('Confirmar movimiento'))
  await screen.findByText(/Se recuperó el movimiento anterior: retiro de \$20.00. Proveedor/)
  expect((screen.getByLabelText('Importe del movimiento') as HTMLInputElement).value).toBe('5')
  expect((screen.getByLabelText('Motivo del movimiento') as HTMLInputElement).value).toBe('Cambio')
  expect(send).toHaveBeenCalledTimes(2)
  enter('5', 'Cambio')
  fireEvent.click(screen.getByText('Confirmar movimiento'))
  await screen.findByText(/Movimiento confirmado: deposito de \$5.00. Cambio/)
  expect((screen.getByLabelText('Importe del movimiento') as HTMLInputElement).value).toBe('')
})
it('PIN rechazado no registra movimiento y conserva los datos para corregir', async () => {
  approve.mockRejectedValueOnce(new Error('PIN no autorizado'))
  render(React.createElement(MovimientoDeCaja, { turnoId: 'turno' }))
  enter('20', 'Proveedor')
  fireEvent.click(screen.getByText('Confirmar movimiento'))
  await screen.findByText('PIN no autorizado')
  expect(send).not.toHaveBeenCalled()
  expect((screen.getByLabelText('Importe del movimiento') as HTMLInputElement).value).toBe('20')
})
