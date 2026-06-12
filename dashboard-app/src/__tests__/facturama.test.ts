import { describe, it, expect } from 'vitest'
import { buildCfdiBody, facturamaBaseUrl, type CfdiRequestRow } from '@/lib/facturama'

const baseReq: CfdiRequestRow = {
  id: 'CFDI-TEST1',
  rfc: 'xaxx010101000',
  razon_social: 'Empresa de Prueba',
  regimen_fiscal: '616',
  uso_cfdi: 'S01',
  codigo_postal: '66220',
  email: 'test@test.com',
  subtotal: null,
  iva: null,
  total: 580,
}

describe('buildCfdiBody', () => {
  it('arma CFDI 4.0 de Ingreso con receptor en mayúsculas', () => {
    const body = buildCfdiBody(baseReq, '66220')
    expect(body.CfdiType).toBe('I')
    expect(body.Currency).toBe('MXN')
    expect(body.PaymentMethod).toBe('PUE')
    expect(body.ExpeditionPlace).toBe('66220')
    expect(body.Receiver.Rfc).toBe('XAXX010101000')
    expect(body.Receiver.Name).toBe('EMPRESA DE PRUEBA')
    expect(body.Receiver.FiscalRegime).toBe('616')
    expect(body.Receiver.TaxZipCode).toBe('66220')
  })

  it('desglosa IVA desde el total y cuadra el item', () => {
    const body = buildCfdiBody(baseReq, '66220')
    const item = body.Items[0]
    expect(item.Subtotal).toBe(500) // 580 / 1.16
    expect(item.Taxes[0].Total).toBe(80)
    expect(item.Taxes[0].Base).toBe(500)
    expect(item.Taxes[0].Rate).toBe(0.16)
    expect(item.Total).toBe(580)
    expect(item.TaxObject).toBe('02')
    expect(item.Subtotal + item.Taxes[0].Total).toBeCloseTo(item.Total, 2)
  })

  it('cuadra montos con centavos que no dividen exacto', () => {
    const body = buildCfdiBody({ ...baseReq, total: 123.45 }, '66220')
    const item = body.Items[0]
    expect(item.Subtotal).toBe(106.42)
    expect(item.Taxes[0].Total).toBe(17.03)
    expect(item.Subtotal + item.Taxes[0].Total).toBeCloseTo(123.45, 2)
  })

  it('acepta forma de pago explícita', () => {
    const body = buildCfdiBody(baseReq, '66220', '04')
    expect(body.PaymentForm).toBe('04')
  })

  it('truena sin monto total', () => {
    expect(() => buildCfdiBody({ ...baseReq, total: 0 }, '66220')).toThrow()
    expect(() => buildCfdiBody({ ...baseReq, total: null }, '66220')).toThrow()
  })
})

describe('facturamaBaseUrl', () => {
  it('usa sandbox por default', () => {
    expect(facturamaBaseUrl()).toBe('https://apisandbox.facturama.mx')
  })
})
