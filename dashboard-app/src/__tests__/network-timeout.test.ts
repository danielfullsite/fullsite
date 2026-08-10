import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { fetchWithTimeout, isFetchAbort } from '@/lib/fetch-with-timeout'
import { proxy } from '@/proxy'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('bounded network requests', () => {
  it('aborts a request that never settles', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        }, { once: true })
      })
    )))

    const request = fetchWithTimeout('https://example.invalid', {}, 25)
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(25)

    await rejection
  })

  it('propagates a caller abort without waiting for the timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        }, { once: true })
      })
    )))
    const caller = new AbortController()
    const request = fetchWithTimeout('https://example.invalid', { signal: caller.signal }, 5_000)
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' })

    caller.abort()

    await rejection
    expect(isFetchAbort(await request.catch(error => error))).toBe(true)
  })

  it('releases protected navigation when auth validation stalls', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        }, { once: true })
      })
    )))
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-key'
    const request = new NextRequest('https://app.fullsite.mx/', {
      headers: { cookie: 'fs-at=test-session' },
    })
    const navigation = proxy(request)

    await vi.advanceTimersByTimeAsync(5_000)
    const response = await navigation

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('guards every raw request on the login-to-dashboard path', () => {
    const login = readFileSync(new URL('../app/login/page.tsx', import.meta.url), 'utf8')
    const proxy = readFileSync(new URL('../proxy.ts', import.meta.url), 'utf8')
    const data = readFileSync(new URL('../lib/data.ts', import.meta.url), 'utf8')

    expect(login).toContain('fetchWithTimeout(`${supabaseUrl}/auth/v1/token')
    expect(proxy).toContain('fetchWithTimeout(`${supabaseUrl}/auth/v1/user`')
    expect(data).toContain('const res = await fetchWithTimeout(url')
  })
})
