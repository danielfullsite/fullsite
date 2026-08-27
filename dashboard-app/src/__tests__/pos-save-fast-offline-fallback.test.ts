import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('POS save-order offline fallback contract', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/lib/pos-data.ts'), 'utf8')

  it('does not block local KDS and printer delivery behind the old 7 second WAN timeout', () => {
    expect(source).toContain('setTimeout(() => controller.abort(), 1500)')
    expect(source).not.toContain('setTimeout(() => controller.abort(), 7000)')
  })

  it('keeps the idempotent replay fallback on network failure', () => {
    expect(source).toContain("return { ok: false, error: 'OFFLINE_QUEUED' }")
    expect(source).toContain('await queueForReplay()')
  })
})
