import { describe, it, expect } from 'vitest'
import { calcEfectivoEsperado, computeOrderSummary, summaryToArqueoInput, type ArqueoInput } from '@/lib/pos-arqueo'

// ── calcEfectivoEsperado ──────────────────────────────────────────────────────

describe('calcEfectivoEsperado', () => {
  const base: ArqueoInput = {
    fondoInicial: 500,
    ventasEfectivo: 1000,
    propinaEfectivo: 0,
    propinasNoEfectivo: 0,
    depositos: 0,
    retiros: 0,
  }

  it('sin propinas — solo fondo + ventas efectivo', () => {
    const { efectivoEsperado, diferencia, totalContado } = calcEfectivoEsperado(base, 1500)
    expect(efectivoEsperado).toBe(1500)
    expect(diferencia).toBe(0)
    expect(totalContado).toBe(1500)
  })

  it('propina en efectivo — suma al esperado', () => {
    const { efectivoEsperado } = calcEfectivoEsperado({ ...base, propinaEfectivo: 200 }, 1700)
    expect(efectivoEsperado).toBe(1700)
  })

  it('propina en tarjeta — resta del esperado (caja paga al mesero)', () => {
    const { efectivoEsperado } = calcEfectivoEsperado({ ...base, propinasNoEfectivo: 150 }, 1350)
    expect(efectivoEsperado).toBe(1350)
  })

  it('pago mixto: propina efectivo y tarjeta', () => {
    const { efectivoEsperado } = calcEfectivoEsperado({ ...base, propinaEfectivo: 100, propinasNoEfectivo: 200 })
    // 500 + 1000 + 100 - 200 = 1400
    expect(efectivoEsperado).toBe(1400)
  })

  it('depósitos y retiros afectan la caja', () => {
    const { efectivoEsperado } = calcEfectivoEsperado({ ...base, depositos: 300, retiros: 150 })
    // 500 + 1000 + 300 - 150 = 1650
    expect(efectivoEsperado).toBe(1650)
  })

  it('combinación completa — todos los campos', () => {
    const { efectivoEsperado } = calcEfectivoEsperado({
      fondoInicial: 500,
      ventasEfectivo: 2000,
      propinaEfectivo: 100,
      propinasNoEfectivo: 300,
      depositos: 200,
      retiros: 400,
    })
    // 500 + 2000 + 100 - 300 + 200 - 400 = 2100
    expect(efectivoEsperado).toBe(2100)
  })

  it('diferencia positiva — caja tiene más de lo esperado (sobrante)', () => {
    const { diferencia } = calcEfectivoEsperado(base, 1600)
    expect(diferencia).toBeGreaterThan(0)
    expect(diferencia).toBe(100)
  })

  it('diferencia negativa — caja tiene menos de lo esperado (faltante)', () => {
    const { diferencia } = calcEfectivoEsperado(base, 1400)
    expect(diferencia).toBeLessThan(0)
    expect(diferencia).toBe(-100)
  })

  it('sin totalContado — diferencia es 0 y totalContado es null', () => {
    const result = calcEfectivoEsperado(base)
    expect(result.diferencia).toBe(0)
    expect(result.totalContado).toBeNull()
  })
})

// ── computeOrderSummary ───────────────────────────────────────────────────────

describe('computeOrderSummary', () => {
  it('agrega órdenes cerradas y categoriza propinas', () => {
    const orders = [
      { status: 'cerrada', total: 500, metodo_pago: 'Efectivo', propina: 50, descuento: 0 },
      { status: 'cerrada', total: 300, metodo_pago: 'Tarjeta de crédito', propina: 30, descuento: 0 },
    ]
    const summary = computeOrderSummary(orders, [])
    expect(summary.totalVentas).toBe(800)
    expect(summary.efectivo).toBe(500)
    expect(summary.tarjeta).toBe(300)
    expect(summary.propinas).toBe(80)
    // Propina en efectivo: 50 (de la orden efectivo)
    expect(summary.propinaEfectivo).toBe(50)
    // Propina en tarjeta: 30 (de la orden de tarjeta, debe pagarse desde caja)
    expect(summary.propinasNoEfectivo).toBe(30)
  })

  it('descarta órdenes canceladas', () => {
    const orders = [
      { status: 'cancelada', total: 200, metodo_pago: 'Efectivo', propina: 0, descuento: 0 },
      { status: 'cerrada', total: 100, metodo_pago: 'Efectivo', propina: 0, descuento: 0 },
    ]
    const summary = computeOrderSummary(orders, [])
    expect(summary.totalVentas).toBe(100)
    expect(summary.cancelaciones).toBe(1)
  })

  it('agrega depósitos y retiros de movimientos de caja', () => {
    const orders: Parameters<typeof computeOrderSummary>[0] = []
    const movements = [
      { type: 'deposito', amount: 200 },
      { type: 'deposito', amount: 100 },
      { type: 'retiro', amount: 50 },
    ]
    const summary = computeOrderSummary(orders, movements)
    expect(summary.depositos).toBe(300)
    expect(summary.retiros).toBe(50)
  })

  it('split payments via pagos[] — atribuye propina a cada forma', () => {
    const orders = [
      {
        status: 'cerrada',
        total: 600,
        metodo_pago: null,
        propina: 60,
        descuento: 0,
        // POS stores split payments with `metodo` field (PagoFormaLike shape)
        pagos: [
          { metodo: 'Efectivo', monto: 300 },
          { metodo: 'Tarjeta de crédito', monto: 300 },
        ],
      },
    ]
    const summary = computeOrderSummary(orders, [])
    expect(summary.totalVentas).toBe(600)
    // Propina total = 60; split 50/50 → 30 efectivo, 30 no-efectivo
    expect(summary.propinaEfectivo).toBeCloseTo(30, 1)
    expect(summary.propinasNoEfectivo).toBeCloseTo(30, 1)
  })
})

// ── summaryToArqueoInput ──────────────────────────────────────────────────────

describe('summaryToArqueoInput', () => {
  it('mapea todos los campos correctamente', () => {
    const summary = {
      efectivo: 1000, tarjeta: 500, transferencias: 200, totalVentas: 1700,
      ticketsCount: 10, cancelaciones: 1, descuentos: 50,
      propinas: 120, propinaEfectivo: 80, propinasNoEfectivo: 40,
      depositos: 100, retiros: 50,
    }
    const input = summaryToArqueoInput(summary, 500)
    expect(input.fondoInicial).toBe(500)
    expect(input.ventasEfectivo).toBe(1000)
    expect(input.propinaEfectivo).toBe(80)
    expect(input.propinasNoEfectivo).toBe(40)
    expect(input.depositos).toBe(100)
    expect(input.retiros).toBe(50)
  })
})
