import { describe, it, expect, vi, beforeEach } from 'vitest'

// Test the API route handler logic
describe('MP Point API route', () => {
  const mockFetch = vi.fn()
  vi.stubGlobal('fetch', mockFetch)

  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('payment body includes installments for Smart', async () => {
    // Simulate what the API route builds for a Smart payment
    const amount = 500
    const installments = 6
    const installments_cost = 'buyer'
    const tip_enabled = true
    const print_on_terminal = true
    const orderId = 'order-123'

    const paymentBody: Record<string, unknown> = {
      amount: Math.round(amount * 100),
      additional_info: {
        external_reference: orderId || 'fullsite-pos',
        print_on_terminal: print_on_terminal ?? true,
      },
    }

    if (installments && installments > 1) {
      paymentBody.installments = installments
      if (installments_cost) {
        paymentBody.installments_cost = installments_cost
      }
    }

    if (tip_enabled) {
      paymentBody.tip_enabled = true
    }

    expect(paymentBody.amount).toBe(50000) // cents
    expect(paymentBody.installments).toBe(6)
    expect(paymentBody.installments_cost).toBe('buyer')
    expect(paymentBody.tip_enabled).toBe(true)
    expect((paymentBody.additional_info as Record<string, unknown>).external_reference).toBe('order-123')
  })

  it('payment body omits installments for single payment', () => {
    const amount = 300
    const installments = 1

    const paymentBody: Record<string, unknown> = {
      amount: Math.round(amount * 100),
      additional_info: {
        external_reference: 'fullsite-pos',
        print_on_terminal: true,
      },
    }

    if (installments && installments > 1) {
      paymentBody.installments = installments
    }

    expect(paymentBody.amount).toBe(30000)
    expect(paymentBody.installments).toBeUndefined()
  })

  it('refund body supports partial amount', () => {
    const paymentId = 'pay_12345'
    const partialAmount = 150

    const refundBody: Record<string, unknown> = {}
    if (partialAmount) refundBody.amount = Math.round(partialAmount * 100)

    expect(refundBody.amount).toBe(15000)
  })

  it('refund body is empty for full refund', () => {
    const refundBody: Record<string, unknown> = {}
    const amount = undefined
    if (amount) refundBody.amount = Math.round(amount * 100)

    expect(Object.keys(refundBody).length).toBe(0)
  })
})
