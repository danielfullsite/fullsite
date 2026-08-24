import { describe, expect, it } from 'vitest'

import { canCleanupAllOrders } from '@/lib/order-cleanup-auth'

describe('destructive order cleanup owner gate', () => {
  it('allows Daniel at AMALAY with an administrative role', () => {
    expect(canCleanupAllOrders({ clientId: 'amalay', staffName: 'Daniel', role: 'admin', staffId: 'daniel-id' })).toBe(true)
  })

  it.each([
    { clientId: 'amalay', staffName: 'Daniela', role: 'admin' },
    { clientId: 'amalay', staffName: 'Eduardo', role: 'gerente' },
    { clientId: 'amalay', staffName: 'Daniel', role: 'mesero' },
    { clientId: 'otro', staffName: 'Daniel', role: 'admin' },
  ])('rejects non-owner identity %#', identity => {
    expect(canCleanupAllOrders(identity)).toBe(false)
  })
})
