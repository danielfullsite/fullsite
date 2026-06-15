import { describe, it, expect } from 'vitest'
import { buildCfdiBody, buildPaymentComplementBody } from '@/lib/facturama'

describe('CFDI Build', () => {
  const req = { id: '1', rfc: 'ABC123456789', razon_social: 'Test SA', regimen_fiscal: '601', uso_cfdi: 'G03', codigo_postal: '64000', email: 'test@test.com', subtotal: null, iva: null, total: 1160 }
  
  it('normal CFDI has correct structure', () => {
    const body = buildCfdiBody(req, '64000')
    expect(body.CfdiType).toBe('I')
    expect(body.Currency).toBe('MXN')
    expect(body.Items[0].Subtotal).toBeCloseTo(1000, 0)
    expect(body.Items[0].Taxes[0].Total).toBeCloseTo(160, 0)
    expect(body.Items[0].Total).toBe(1160)
    expect(body.Receiver.Rfc).toBe('ABC123456789')
  })
  
  it('público general includes GlobalInformation', () => {
    const pubReq = { ...req, rfc: 'XAXX010101000' }
    const body = buildCfdiBody(pubReq, '64000')
    expect(body.GlobalInformation).toBeDefined()
    expect(body.GlobalInformation!.Periodicity).toBe('01')
  })
  
  it('throws on zero total', () => {
    expect(() => buildCfdiBody({ ...req, total: 0 }, '64000')).toThrow()
  })
  
  it('payment complement has correct structure', () => {
    const comp = buildPaymentComplementBody({
      relatedUuid: 'uuid-test', receiverRfc: 'ABC123', receiverName: 'Test',
      receiverFiscalRegime: '601', receiverTaxZipCode: '64000',
      amount: 500, paymentForm: '03', paymentDate: '2026-06-15',
      installment: 1, previousBalance: 1000,
    }, '64000')
    expect(comp.CfdiType).toBe('P')
    expect(comp.Currency).toBe('XXX')
    expect(comp.Complemento.Payments[0].Amount).toBe(500)
    expect(comp.Complemento.Payments[0].RelatedDocuments[0].ImpSaldoInsoluto).toBe(500)
  })
})
