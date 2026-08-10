// BUG-019-E — deterministic print-intent identity (pure helpers, no DOM/DB).
import { describe, it, expect } from 'vitest'
import { comandaJobId, nextReprintSeq } from '@/lib/print-queue'

const O = '11111111-1111-1111-1111-111111111111'
const B1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const B2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

describe('comandaJobId — deterministic identity', () => {
  it('is stable for the same (order, station, batch, reprint_seq)', () => {
    expect(comandaJobId(O, 'cocina', B1, 0)).toBe(comandaJobId(O, 'cocina', B1, 0))
  })
  it('differs by station (fan-out = one intent per station)', () => {
    expect(comandaJobId(O, 'cocina', B1, 0)).not.toBe(comandaJobId(O, 'barra', B1, 0))
  })
  it('differs by batch (additions = new intent)', () => {
    expect(comandaJobId(O, 'cocina', B1, 0)).not.toBe(comandaJobId(O, 'cocina', B2, 0))
  })
  it('differs by reprint_seq (operator reprint = new intent)', () => {
    expect(comandaJobId(O, 'cocina', B1, 0)).not.toBe(comandaJobId(O, 'cocina', B1, 1))
  })
  it('technical retry reuses the SAME id (reprint_seq unchanged)', () => {
    const first = comandaJobId(O, 'cocina', B1, 0)
    const retry = comandaJobId(O, 'cocina', B1, 0) // same tuple on retry
    expect(retry).toBe(first)
  })
})

describe('nextReprintSeq', () => {
  it('starts reprints at 1 (0 is the automatic send)', () => {
    expect(nextReprintSeq([])).toBe(1)
    expect(nextReprintSeq([0])).toBe(1)
  })
  it('increments past the current max', () => {
    expect(nextReprintSeq([0, 1])).toBe(2)
    expect(nextReprintSeq([0, 1, 2])).toBe(3)
  })
})
