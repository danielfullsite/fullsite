import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  localStorage.clear()
  Reflect.deleteProperty(navigator, 'serviceWorker')
  vi.resetModules()
})

it('the installed Electron release disables older SWs without changing the operator rollback flag', async () => {
  const unregister = vi.fn().mockResolvedValue(true)
  const register = vi.fn()
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
    register, getRegistrations: vi.fn().mockResolvedValue([{ unregister }]),
  } })
  localStorage.setItem('FULLSITE_UI_PACKAGE', 'verified-release')
  const { registerServiceWorker } = await import('@/lib/service-worker')
  expect(await registerServiceWorker()).toBeNull()
  expect(unregister).toHaveBeenCalledOnce()
  expect(register).not.toHaveBeenCalled()
  expect(localStorage.getItem('FULLSITE_OFFLINE_DISABLED')).toBeNull()
})
