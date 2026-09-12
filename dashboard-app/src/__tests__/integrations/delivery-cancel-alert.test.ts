import { describe, expect, it } from 'vitest'
import { cancellationMessage, detectExternalCancellations, type CancelWatchOrder } from '@/lib/integrations/delivery-cancel-alert'

const order = (overrides: Partial<CancelWatchOrder> = {}): CancelWatchOrder => ({
  id: 'o1', status: 'preparando', platform: 'ubereats', platform_order_id: 'uber-1', customer_name: 'Ana', total: 250, ...overrides,
})

describe('alerta por cancelación externa', () => {
  it('detecta la transición a cancelada cuando cocina estaba trabajando', () => {
    const [alert] = detectExternalCancellations([order()], [order({ status: 'cancelada' })])
    expect(alert).toMatchObject({ id: 'o1', previousStatus: 'preparando', kitchenInProgress: true })
    expect(cancellationMessage(alert)).toMatch(/avisa a cocina/i)
  })

  it('no alerta en la primera lectura, por cancelación local ni por una ya avisada', () => {
    const cancelled = order({ status: 'cancelada' })
    expect(detectExternalCancellations([], [cancelled])).toEqual([])
    expect(detectExternalCancellations([order()], [cancelled], new Set(['o1']))).toEqual([])
    expect(detectExternalCancellations([order()], [cancelled], new Set(), new Set(['o1']))).toEqual([])
  })

  it('no pierde cancelaciones simultáneas', () => {
    const before = [order({ id: 'a' }), order({ id: 'b' })]
    const after = before.map(item => ({ ...item, status: 'cancelada' }))
    expect(detectExternalCancellations(before, after).map(item => item.id)).toEqual(['a', 'b'])
  })
})
