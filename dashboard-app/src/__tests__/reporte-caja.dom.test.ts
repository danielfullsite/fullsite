import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
const read = vi.hoisted(() => vi.fn())
vi.mock('@/lib/pedro-reportes', () => ({ leerReporteCaja: read }))
vi.mock('@/lib/pedro-actor', () => ({ autorizarOperacionConPinEnCaja: vi.fn() }))
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
