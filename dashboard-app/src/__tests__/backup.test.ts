import { describe, it, expect, vi, beforeEach } from 'vitest'
import { formatBytes, getLastBackupTime } from '@/lib/backup'

// ─── localStorage mock ────────────────────────────────────────────────────

const store: Record<string, string> = {}
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, val: string) => { store[key] = val },
  removeItem: (key: string) => { delete store[key] },
  clear: () => { for (const k of Object.keys(store)) delete store[k] },
}
vi.stubGlobal('localStorage', localStorageMock)

beforeEach(() => localStorageMock.clear())

// ─── formatBytes ───────────────────────────────────────────────────────────

describe('formatBytes', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(10240)).toBe('10.0 KB')
  })

  it('formats megabytes', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(1024 * 1024 * 5.5)).toBe('5.5 MB')
  })
})

// ─── getLastBackupTime ─────────────────────────────────────────────────────

describe('getLastBackupTime', () => {
  it('returns null when no backup recorded', () => {
    expect(getLastBackupTime()).toBeNull()
  })

  it('returns date when backup was recorded', () => {
    const now = Date.now()
    localStorageMock.setItem('last_backup_time', now.toString())
    const result = getLastBackupTime()
    expect(result).toBeInstanceOf(Date)
    expect(result!.getTime()).toBe(now)
  })
})
