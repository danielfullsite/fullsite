import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function workers() {
  const registration = Object.assign(new EventTarget(), {
    scope: '/', installing: null, update: vi.fn().mockResolvedValue(undefined),
    unregister: vi.fn().mockResolvedValue(true),
  })
  const container = Object.assign(new EventTarget(), {
    register: vi.fn().mockResolvedValue(registration),
    getRegistrations: vi.fn().mockResolvedValue([registration]),
    controller: { postMessage: vi.fn() },
  })
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container })
  return { container, registration }
}

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); localStorage.clear() })
afterEach(async () => {
  localStorage.setItem('FULLSITE_OFFLINE_DISABLED', '1')
  await (await import('@/lib/service-worker')).registerServiceWorker()
  vi.useRealTimers()
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'serviceWorker')
})

describe('one service worker lifecycle per page', () => {
  it('rollback unregisters existing workers and never registers a new one', async () => {
    const { container, registration } = workers()
    localStorage.setItem('FULLSITE_OFFLINE_DISABLED', '1')
    const { registerServiceWorker, precacheUrls, updateServiceWorker } = await import('@/lib/service-worker')
    expect(await registerServiceWorker()).toBeNull()
    await precacheUrls(['/pos'])
    await updateServiceWorker()
    expect(container.register).not.toHaveBeenCalled()
    expect(registration.unregister).toHaveBeenCalledOnce()
    expect(container.controller.postMessage).not.toHaveBeenCalled()
    expect(registration.update).not.toHaveBeenCalled()
  })

  it('concurrent mounts share registration, updates and sync dispatch', async () => {
    const { container, registration } = workers()
    const sync = vi.fn()
    window.addEventListener('sw-sync-requested', sync)
    try {
      const { registerServiceWorker } = await import('@/lib/service-worker')
      const results = await Promise.all([registerServiceWorker(), registerServiceWorker(), registerServiceWorker()])
      expect(results).toEqual([registration, registration, registration])
      expect(container.register).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
      expect(registration.update).toHaveBeenCalledOnce()
      container.dispatchEvent(new MessageEvent('message', { data: { type: 'SYNC_REQUESTED' } }))
      expect(sync).toHaveBeenCalledOnce()
      localStorage.setItem('FULLSITE_OFFLINE_DISABLED', '1')
      await registerServiceWorker()
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
      container.dispatchEvent(new MessageEvent('message', { data: { type: 'SYNC_REQUESTED' } }))
      expect(registration.update).toHaveBeenCalledOnce()
      expect(sync).toHaveBeenCalledOnce()
    } finally { window.removeEventListener('sw-sync-requested', sync) }
  })

  it('rollback wins against a registration that is still in flight', async () => {
    const { container, registration } = workers()
    let complete!: (value: typeof registration) => void
    container.register.mockReturnValue(new Promise(resolve => { complete = resolve }))
    const { registerServiceWorker } = await import('@/lib/service-worker')
    const starting = registerServiceWorker()
    localStorage.setItem('FULLSITE_OFFLINE_DISABLED', '1')
    const disabling = registerServiceWorker()
    complete(registration)
    expect(await starting).toBeNull()
    expect(await disabling).toBeNull()
    expect(registration.unregister).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
    expect(registration.update).not.toHaveBeenCalled()
  })

  it('a failed registration can retry when connectivity returns', async () => {
    const { container, registration } = workers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    container.register.mockRejectedValueOnce(new Error('network unavailable'))
    const { registerServiceWorker } = await import('@/lib/service-worker')
    expect(await registerServiceWorker()).toBeNull()
    expect(await registerServiceWorker()).toBe(registration)
    expect(container.register).toHaveBeenCalledTimes(2)
  })
})
