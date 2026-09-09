import { createElement } from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import InstallPrompt from '@/components/InstallPrompt'

afterEach(() => {
  cleanup()
  localStorage.clear()
  Reflect.deleteProperty(navigator, 'serviceWorker')
})

it('mounting the install prompt cannot undo the offline rollback flag', async () => {
  const unregister = vi.fn().mockResolvedValue(true)
  const register = vi.fn().mockResolvedValue({ scope: '/' })
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
    register, getRegistrations: vi.fn().mockResolvedValue([{ unregister }]),
  } })
  localStorage.setItem('FULLSITE_OFFLINE_DISABLED', '1')
  localStorage.setItem('pwa_prompt_dismissed', '1')
  render(createElement(InstallPrompt))
  await waitFor(() => expect(unregister).toHaveBeenCalledOnce())
  expect(register).not.toHaveBeenCalled()
})
