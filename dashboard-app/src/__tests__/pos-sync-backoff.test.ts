import { describe, it, expect } from 'vitest'
import { syncBackoffMs, shouldAttemptSync, lsItemMethod } from '@/lib/pos-offline-db'

// PRR-02: transient sync_queue items must never be stranded. After 5 fast
// retries they degrade to slow retries with exponential backoff — they are
// still attempted, just less often, until they sync or become terminal.

describe('syncBackoffMs — retry schedule', () => {
  it('fast retries (0-4) have no backoff', () => {
    for (let r = 0; r < 5; r++) expect(syncBackoffMs(r)).toBe(0)
  })

  it('retry 5 starts slow mode at 60s', () => {
    expect(syncBackoffMs(5)).toBe(60_000)
  })

  it('backoff doubles: 60s, 120s, 240s', () => {
    expect(syncBackoffMs(6)).toBe(120_000)
    expect(syncBackoffMs(7)).toBe(240_000)
  })

  it('backoff caps at 5 minutes', () => {
    expect(syncBackoffMs(8)).toBe(300_000)
    expect(syncBackoffMs(20)).toBe(300_000)
    expect(syncBackoffMs(1000)).toBe(300_000)
  })
})

describe('shouldAttemptSync — attempt gating', () => {
  const NOW = 1_700_000_000_000

  it('terminal error classes are never attempted', () => {
    expect(shouldAttemptSync({ retries: 0, error_class: 'STALE_WRITE_CONFLICT' as never }, NOW)).toBe(false)
    expect(shouldAttemptSync({ retries: 0, error_class: 'TERMINAL_NON_RETRYABLE' as never }, NOW)).toBe(false)
  })

  it('fresh items are always attempted', () => {
    expect(shouldAttemptSync({ retries: 0 }, NOW)).toBe(true)
    expect(shouldAttemptSync({ retries: 4 }, NOW)).toBe(true)
  })

  it('items past the fast cap are NOT abandoned — attempted after backoff elapses', () => {
    const item = { retries: 5, last_attempt_at: NOW - 61_000 }
    expect(shouldAttemptSync(item, NOW)).toBe(true)
  })

  it('items past the fast cap wait out their backoff window', () => {
    const item = { retries: 5, last_attempt_at: NOW - 30_000 }
    expect(shouldAttemptSync(item, NOW)).toBe(false)
  })

  it('exactly at the backoff boundary is attempted', () => {
    const item = { retries: 5, last_attempt_at: NOW - 60_000 }
    expect(shouldAttemptSync(item, NOW)).toBe(true)
  })

  it('legacy items without last_attempt_at are attempted immediately (migration path)', () => {
    // Items queued before this fix have no timestamp — they must recover, not stay stuck
    expect(shouldAttemptSync({ retries: 5 }, NOW)).toBe(true)
    expect(shouldAttemptSync({ retries: 12 }, NOW)).toBe(true)
  })

  it('emergency save-order items without method replay as POST, not PATCH (405 fix)', () => {
    // /api/pos/save-order only exports POST. Items queued by the localStorage
    // emergency fallback before the fix carry no method — a PATCH default made
    // them 405 forever. APP_API items must default to POST.
    expect(lsItemMethod({ table: 'pos_orders', transport: 'APP_API', endpoint: '/api/pos/save-order' })).toBe('POST')
    // explicit methods are always respected
    expect(lsItemMethod({ method: 'PATCH', transport: 'APP_API' })).toBe('PATCH')
    expect(lsItemMethod({ method: 'DELETE' })).toBe('DELETE')
    // legacy PostgREST items keep the historical PATCH default
    expect(lsItemMethod({ table: 'pos_orders', endpoint: 'pos_orders?id=eq.x' })).toBe('PATCH')
    // garbage method falls back by transport
    expect(lsItemMethod({ method: 'PUT', transport: 'APP_API' })).toBe('POST')
  })

  it('a 4-hour soak with flaky network never permanently strands an item', () => {
    // Simulate: item fails every attempt for 4 hours. It must still be
    // scheduled for attempts throughout — count them.
    let attempts = 0
    let retries = 5
    let lastAttempt = 0
    const start = NOW
    for (let t = start; t < start + 4 * 3600_000; t += 10_000) {
      if (shouldAttemptSync({ retries, last_attempt_at: lastAttempt }, t)) {
        attempts++
        retries++
        lastAttempt = t
      }
    }
    // With a 5-min cap, 4 hours guarantees dozens of attempts — never zero
    expect(attempts).toBeGreaterThan(40)
  })
})
