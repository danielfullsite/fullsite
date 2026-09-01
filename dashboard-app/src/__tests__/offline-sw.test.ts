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

  it('never registers a service worker — it unregisters (offline paused, P0 login iOS)', async () => {
    // registerServiceWorker() quedó neutralizado: en vez de register('/sw.js'),
    // desregistra los SW existentes y borra sus cachés. Verificamos el contrato en
    // la fuente para que nadie lo vuelva a poner a registrar sin revertir a propósito.
    const fs = await import('fs')
    const path = await import('path')
    const src = fs.readFileSync(path.resolve(__dirname, '../lib/service-worker.ts'), 'utf-8')
    const fn = src.slice(src.indexOf('export async function registerServiceWorker'))
    const body = fn.slice(0, fn.indexOf('\n}\n') + 2)
    expect(body).not.toContain("navigator.serviceWorker.register(")
    expect(body).toContain('getRegistrations()')
    expect(body).toContain('unregister()')
  })
})

// El Service Worker está DESACTIVADO a propósito (kill switch) por el P0 de login iOS
// 2026-08-31: un SW viejo servía navegaciones con bandera `redirected` → Safari/Chrome
// iOS "Response served by service worker has redirections" al iniciar sesión. Estos
// tests fijan el contrato del kill switch para que el offline no regrese por accidente
// sin una reversión deliberada.
describe('sw.js kill switch', () => {
  const readSw = async () => {
    const fs = await import('fs')
    const path = await import('path')
    return fs.readFileSync(path.resolve(__dirname, '../../public/sw.js'), 'utf-8')
  }

  it('sw.js file exists in public/', async () => {
    const fs = await import('fs')
    const path = await import('path')
    expect(fs.existsSync(path.resolve(__dirname, '../../public/sw.js'))).toBe(true)
  })

  it('self-destructs: skipWaiting + unregister + clears all caches on activate', async () => {
    const content = await readSw()
    expect(content).toContain("self.addEventListener('install'")
    expect(content).toContain("self.addEventListener('activate'")
    expect(content).toContain('self.skipWaiting()')
    expect(content).toContain('self.registration.unregister()')
    expect(content).toContain('caches.keys()')
    expect(content).toContain('caches.delete(')
  })

  it('does NOT intercept navigations — no fetch handler, no route/asset caching', async () => {
    const content = await readSw()
    // Sin fetch handler el navegador va directo a la red para TODA navegación → nunca
    // puede volver a servir una respuesta redirigida y romper el login.
    expect(content).not.toContain("self.addEventListener('fetch'")
    expect(content).not.toContain('STATIC_ASSETS')
    expect(content).not.toContain('navigationFromCache')
  })

  it('documents that it is an intentional kill switch (P0 login iOS)', async () => {
    const content = await readSw()
    expect(content.toUpperCase()).toContain('KILL SWITCH')
  })
})
