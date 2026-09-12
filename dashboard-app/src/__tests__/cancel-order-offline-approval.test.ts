import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('la aprobación firmada de anulación sobrevive el encolado offline', () => {
  it('forma parte del mismo voidPayload que se manda y se encola', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/pos/page.tsx'), 'utf8')
    const start = source.indexOf('const cancellationApprovalToken = consumeManagerApproval(managerName)')
    const end = source.indexOf('setOrderItems(renglones)', start)
    const cancellationFlow = source.slice(start, end)

    expect(start).toBeGreaterThan(-1)
    expect(cancellationFlow).toMatch(/const voidPayload = \{[\s\S]*approval_token: cancellationApprovalToken/)
    expect(cancellationFlow).toContain("queueOperation('pos_orders', 'POST', voidPayload, '/api/pos/save-order'")
  })
})
