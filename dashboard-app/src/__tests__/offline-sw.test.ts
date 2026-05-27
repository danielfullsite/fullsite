import { describe, it, expect, vi } from 'vitest'

// Test service worker registration module
describe('service-worker registration', () => {
  it('exports registerServiceWorker function', async () => {
    const { registerServiceWorker } = await import('@/lib/service-worker')
    expect(typeof registerServiceWorker).toBe('function')
  })

  it('returns null when service workers not supported', async () => {
    vi.stubGlobal('navigator', {})
    vi.resetModules()
    const { registerServiceWorker } = await import('@/lib/service-worker')
    const result = await registerServiceWorker()
    expect(result).toBeNull()
  })
})

// Test the service worker file itself exists and has correct structure
describe('sw.js structure', () => {
  it('sw.js file exists in public/', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const swPath = path.resolve(__dirname, '../../public/sw.js')
    expect(fs.existsSync(swPath)).toBe(true)
  })

  it('sw.js contains install, activate, and fetch handlers', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const swPath = path.resolve(__dirname, '../../public/sw.js')
    const content = fs.readFileSync(swPath, 'utf-8')

    expect(content).toContain("self.addEventListener('install'")
    expect(content).toContain("self.addEventListener('activate'")
    expect(content).toContain("self.addEventListener('fetch'")
    expect(content).toContain("self.addEventListener('sync'")
  })

  it('sw.js caches all POS routes', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const swPath = path.resolve(__dirname, '../../public/sw.js')
    const content = fs.readFileSync(swPath, 'utf-8')

    const requiredRoutes = ['/pos', '/pos/mesas', '/pos/cocina', '/pos/barra', '/pos/kds', '/pos/corte']
    for (const route of requiredRoutes) {
      expect(content).toContain(`'${route}'`)
    }
  })

  it('sw.js has NEVER_CACHE_PATTERNS for auth and payment', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const swPath = path.resolve(__dirname, '../../public/sw.js')
    const content = fs.readFileSync(swPath, 'utf-8')

    // The SW uses regex patterns in NEVER_CACHE_PATTERNS
    expect(content).toContain('NEVER_CACHE_PATTERNS')
    expect(content).toContain('auth')
    expect(content).toContain('mp-point')
  })
})
