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

  it('bounds runtime network-first requests so WAN loss cannot freeze a mesa navigation', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const swPath = path.resolve(__dirname, '../../public/sw.js')
    const content = fs.readFileSync(swPath, 'utf-8')

    expect(content).toContain('const NETWORK_TIMEOUT_MS = 2500')
    expect(content).toContain('const controller = new AbortController()')
    expect(content).toContain('const response = await fetchWithTimeout(request)')
  })

  it('serves cached HTML navigation immediately and refreshes it in the background', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const swPath = path.resolve(__dirname, '../../public/sw.js')
    const content = fs.readFileSync(swPath, 'utf-8')

    expect(content).toContain('navigationFromCache(request, event)')
    expect(content).toContain('event.waitUntil(refresh)')
    // La version se FIJABA en 'v42', asi que esta prueba se rompia en cada bump y
    // empujaba a no subirla — justo lo contrario de lo que hay que hacer: sin bump,
    // las terminales no adoptan el SW nuevo. Ahora se exige que exista y que no
    // RETROCEDA. (Subida a v43 el 2026-08-31 al marcar las respuestas de cache.)
    const version = /const CACHE_VERSION = 'v(\d+)'/.exec(content)
    expect(version, 'sw.js debe declarar CACHE_VERSION').not.toBeNull()
    expect(Number(version![1])).toBeGreaterThanOrEqual(43)
  })

  it('strips the redirect flag on navigations (Safari iOS login bug 2026-08-31)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(path.resolve(__dirname, '../../public/sw.js'), 'utf-8')
    // El helper existe y networkFirstWithCache lo aplica al fetch de red — sin esto
    // Safari rechaza la respuesta redirigida del login ("has redirections").
    expect(content).toContain('function stripRedirect(')
    expect(content).toContain('stripRedirect(await fetchWithTimeout(request))')
  })
})
