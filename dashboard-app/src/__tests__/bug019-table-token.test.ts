// BUG-019-A — the shared table-token format guard. Public endpoints (BATCH B/C)
// call this BEFORE any DB lookup, so it must accept exactly the DB-generated shape
// (encode(gen_random_bytes(24),'hex') = 48 lowercase hex) and reject everything else,
// including injection-shaped and enumeration-shaped input.
import { describe, it, expect } from 'vitest'
import { isValidTableTokenFormat, TABLE_TOKEN_REGEX } from '@/lib/table-token'

// Mirrors encode(gen_random_bytes(24),'hex'): 48 lowercase hex chars.
const VALID = 'a'.repeat(48)
const VALID_MIXED = '0123456789abcdef0123456789abcdef0123456789abcdef'

describe('isValidTableTokenFormat', () => {
  it('accepts a 48-char lowercase-hex token', () => {
    expect(isValidTableTokenFormat(VALID)).toBe(true)
    expect(isValidTableTokenFormat(VALID_MIXED)).toBe(true)
  })

  it('rejects wrong length (47, 49, empty)', () => {
    expect(isValidTableTokenFormat('a'.repeat(47))).toBe(false)
    expect(isValidTableTokenFormat('a'.repeat(49))).toBe(false)
    expect(isValidTableTokenFormat('')).toBe(false)
  })

  it('rejects uppercase and non-hex characters', () => {
    expect(isValidTableTokenFormat('A'.repeat(48))).toBe(false)
    expect(isValidTableTokenFormat('g'.repeat(48))).toBe(false)
    expect(isValidTableTokenFormat('z'.repeat(48))).toBe(false)
  })

  it('rejects non-string input', () => {
    expect(isValidTableTokenFormat(undefined)).toBe(false)
    expect(isValidTableTokenFormat(null)).toBe(false)
    expect(isValidTableTokenFormat(123)).toBe(false)
    expect(isValidTableTokenFormat({})).toBe(false)
    expect(isValidTableTokenFormat(['a'.repeat(48)])).toBe(false)
  })

  it('rejects injection / enumeration-shaped strings', () => {
    expect(isValidTableTokenFormat("' or '1'='1")).toBe(false)
    expect(isValidTableTokenFormat('amalay')).toBe(false)
    expect(isValidTableTokenFormat('3')).toBe(false)
    expect(isValidTableTokenFormat(`${VALID} or true`)).toBe(false)
    expect(isValidTableTokenFormat(`${VALID}\n${VALID}`)).toBe(false)
  })

  it('is anchored so no substring/multiline match slips through', () => {
    expect(TABLE_TOKEN_REGEX.test(`x${VALID}`)).toBe(false)
    expect(TABLE_TOKEN_REGEX.test(`${VALID}x`)).toBe(false)
  })
})
