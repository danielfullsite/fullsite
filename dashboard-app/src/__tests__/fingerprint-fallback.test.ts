import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createServer } from 'http'
import { AddressInfo } from 'net'
import { getFingerprintUrl, setFingerprintUrl } from '@/lib/fingerprint-url'

// Scenario: fingerprint-service (DigitalPersona proxy, port 7718) is DOWN.
// Contract under test: the POS login must degrade to PIN with zero operator lockout.
//   1. The /health probe fails fast (bounded by AbortSignal.timeout) instead of hanging.
//   2. layout.tsx wires probe failure to biometricAvailable=false (PIN-only UI).
//   3. If the service dies mid-session, the post-PIN /list check fails closed to the
//      registration screen, which always offers "Saltar por ahora" → setUnlocked(true).
// Same structural-assertion convention as offline-sw.test.ts.

const LAYOUT_PATH = join(__dirname, '../app/pos/layout.tsx')
const layoutSrc = readFileSync(LAYOUT_PATH, 'utf-8')

afterEach(() => setFingerprintUrl(null))

describe('fingerprint-url module', () => {
  it('defaults to the local DigitalPersona service on port 7718', () => {
    expect(getFingerprintUrl()).toBe('http://127.0.0.1:7718')
  })

  it('supports per-client override and reset', () => {
    setFingerprintUrl('http://127.0.0.1:9999')
    expect(getFingerprintUrl()).toBe('http://127.0.0.1:9999')
    setFingerprintUrl(null)
    expect(getFingerprintUrl()).toBe('http://127.0.0.1:7718')
  })
})

describe('health probe behavior when service is down', () => {
  it('fetch to a dead port rejects quickly instead of hanging (probe pattern from layout.tsx)', async () => {
    // Reserve a port that is guaranteed closed: bind, read the port, close.
    const port: number = await new Promise((resolve) => {
      const srv = createServer()
      srv.listen(0, '127.0.0.1', () => {
        const p = (srv.address() as AddressInfo).port
        srv.close(() => resolve(p))
      })
    })

    const started = Date.now()
    // Exact probe pattern used at login mount: 1s abort budget.
    await expect(
      fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })
    ).rejects.toThrow()
    // Must fail fast — connection refused, not a hung socket.
    expect(Date.now() - started).toBeLessThan(1500)
  })
})

describe('layout.tsx wiring — service down can never block PIN login', () => {
  it('health probe failure sets biometricAvailable=false (PIN-only fallback)', () => {
    // The mount probe must catch and mark biometric unavailable.
    expect(layoutSrc).toMatch(/\.catch\(\(\)\s*=>\s*setBiometricAvailable\(false\)\)/)
    // Probe is time-bounded so the login screen never hangs on a dead service.
    expect(layoutSrc).toMatch(/\/health`,\s*\{\s*signal:\s*AbortSignal\.timeout\(1000\)/)
  })

  it('biometric login failure is caught and surfaces an error instead of throwing', () => {
    expect(layoutSrc).toContain("console.warn('[fingerprint] Login failed:'")
    expect(layoutSrc).toContain("setSessionError('Error al leer huella. Intenta de nuevo.')")
  })

  it('post-PIN /list check fails closed when service dies mid-session', () => {
    // If /list is unreachable, serviceHasTemplates=false → registration screen (never a crash).
    expect(layoutSrc).toMatch(/catch\s*\{\s*serviceHasTemplates\s*=\s*false\s*\}/)
    // The /list probe is also time-bounded (2s).
    expect(layoutSrc).toMatch(/\/list`,\s*\{\s*signal:\s*AbortSignal\.timeout\(2000\)/)
  })

  it('registration screen always offers a skip path that unlocks the POS', () => {
    // skipRegister must exist and unlock without any fingerprint-service dependency.
    const skipIdx = layoutSrc.indexOf('const skipRegister')
    expect(skipIdx).toBeGreaterThan(-1)
    const skipBody = layoutSrc.slice(skipIdx, skipIdx + 400)
    expect(skipBody).toContain('setShowFingerprintRegister(false)')
    expect(skipBody).toContain('setUnlocked(true)')
    expect(layoutSrc).toContain('Saltar por ahora')
  })

  it('PIN submit path does not depend on the fingerprint service to authenticate', () => {
    // handleSubmit authenticates via /api/pos/pin (online) or pos_staff_cache (offline);
    // the only fingerprint reference inside it is the post-auth enrollment check,
    // which is guarded by biometricAvailable (false when the service is down).
    const submitIdx = layoutSrc.indexOf('const handleSubmit')
    const unlockIdx = layoutSrc.indexOf('const unlock', submitIdx)
    expect(submitIdx).toBeGreaterThan(-1)
    expect(layoutSrc.slice(submitIdx)).toContain("apiUrl('/api/pos/pin')")
    expect(layoutSrc.slice(submitIdx)).toContain("localStorage.getItem('pos_staff_cache')")
    // Enrollment check is opt-in on biometricAvailable
    expect(layoutSrc.slice(unlockIdx)).toContain('if (biometricAvailable)')
  })
})
