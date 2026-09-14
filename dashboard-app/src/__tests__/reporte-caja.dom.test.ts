import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
const read = vi.hoisted(() => vi.fn())
const authorize = vi.hoisted(() => vi.fn())
vi.mock('@/lib/pedro-reportes', () => ({ leerReporteCaja: read }))
vi.mock('@/lib/pedro-actor', () => ({
  autorizarOperacionConPinEnCaja: authorize,
  autorizarOperacionConHuellaEnCaja: vi.fn(),
  estadoHuellaEnCaja: vi.fn(async () => ({ disponible: false, motivo: 'Sin lector' })),
}))
import ReporteDeCaja from '@/components/pos/ReporteDeCaja'
import { prepararTransferenciaItem } from '@/lib/transferencia-item'
afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear() })
describe('corte confirmado en pantalla', () => {
  it('no muestra importes anteriores o ceros inventados cuando se pierde Caja', async () => {
    read.mockResolvedValueOnce({ closed:false, close:null, report:{ turno_id:'t',total_paid_cents:2900,
      deposits_cents:0,withdrawals_cents:0,cash_sales_cents:2900,opening_cash_cents:50000,expected_cash_cents:52900,balance_cents:8700,
      reserved_cents:0,settled_orders:0,open_orders:1 } }).mockRejectedValueOnce(new Error('Sin Caja'))
    render(React.createElement(ReporteDeCaja))
    await waitFor(() => expect(screen.getByText('$529.00')).toBeTruthy())
    fireEvent.click(screen.getByRole('button',{name:'Actualizar'}))
    await screen.findByRole('alert')
    expect(screen.queryByText('$529.00')).toBeNull()
    expect(screen.queryByText('$0.00')).toBeNull()
    expect(screen.getByText('Sin Caja')).toBeTruthy()
  })

  it('compacta el corte Z y conserva todos sus controles tactiles en 56px', async () => {
    read.mockResolvedValueOnce({ closed:true, close:{ counted_cash_cents:52800,difference_cents:-100 }, report:{ turno_id:'turno-z',total_paid_cents:2900,
      deposits_cents:0,withdrawals_cents:0,cash_sales_cents:2900,opening_cash_cents:50000,expected_cash_cents:52900,balance_cents:0,
      reserved_cents:0,settled_orders:1,open_orders:0 } })
    render(React.createElement(ReporteDeCaja))
    await screen.findByText('Contado: $528.00 · Diferencia: -$1.00')

    const main = screen.getByRole('main')
    expect(main.className).toBe('mx-auto max-w-4xl space-y-3 p-4 text-[var(--text-1)]')
    expect(screen.getByText('Importes confirmados por Caja. Consultar el corte X no cierra el turno.').className).toContain('text-[var(--text-2)]')
    expect(screen.getByText('Cobrado confirmado').className).toContain('text-[var(--text-2)]')
    expect(screen.getByText('Cobrado confirmado').parentElement?.className).toContain('p-3')
    for (const control of [
      screen.getByRole('link', { name: /Volver a mesas/ }),
      screen.getByRole('button', { name: 'Actualizar' }),
      screen.getByRole('link', { name: 'Ir a apertura y cierre Z' }),
    ]) expect(control.className).toContain('min-h-[56px]')
  })

  it('ofrece PIN y consulta fail-closed con controles tactiles de 56px', async () => {
    read.mockRejectedValueOnce(new Error('Permiso requerido'))
      .mockResolvedValueOnce({ closed:false, close:null, report:{ turno_id:'turno-x',total_paid_cents:0,
        deposits_cents:0,withdrawals_cents:0,cash_sales_cents:0,opening_cash_cents:50000,expected_cash_cents:50000,balance_cents:0,
        reserved_cents:0,settled_orders:0,open_orders:0 } })
    authorize.mockResolvedValueOnce({ actor_token: 'actor-firmado' })
    render(React.createElement(ReporteDeCaja))
    await screen.findByRole('alert')

    const pin = screen.getByLabelText('PIN de autorización')
    const submit = screen.getByRole('button', { name: 'Autorizar con PIN' })
    expect(pin.className).toContain('min-h-[56px]')
    expect(submit.className).toContain('min-h-[56px]')
    expect(screen.queryByText('$0.00')).toBeNull()
    fireEvent.change(pin, { target: { value: '1234' } })
    fireEvent.click(submit)
    await waitFor(() => expect(read).toHaveBeenLastCalledWith(undefined, 'actor-firmado'))
    expect(authorize).toHaveBeenCalledWith('1234')
  })
})
describe('identidad de transferencia ante respuesta perdida', () => {
  it('otra visita a la misma intención conserva el ID hasta confirmar', () => {
    const first=prepararTransferenciaItem('lab','o1','i1',7)
    const retry=prepararTransferenciaItem('lab','o1','i1',7)
    expect(retry.operationId).toBe(first.operationId)
    expect(prepararTransferenciaItem('otro','o1','i1',7).operationId).not.toBe(first.operationId)
    retry.confirmada()
    expect(prepararTransferenciaItem('lab','o1','i1',7).operationId).not.toBe(first.operationId)
  })
})
