// BUG-019 / Client-#2 clonable POS: the POS server routes must reach the DB under the
// CALLER's Supabase JWT (RLS) so a tenant needs NO server-side service_role key. The
// service key is only a legacy-kiosk fallback; with neither, routes fail closed (503).
/* eslint-disable @typescript-eslint/no-explicit-any -- request test doubles */
import { describe, it, expect, beforeEach } from 'vitest'
import { posDbAuth } from '@/lib/api-auth'

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  delete process.env.SUPABASE_SERVICE_KEY
})

const req = (cookie?: string) =>
  ({ cookies: { get: (k: string) => (k === 'fs-at' && cookie ? { value: cookie } : undefined) } }) as any

describe('posDbAuth — clonable POS DB access', () => {
  it('prefers the caller Supabase JWT from the auth context (RLS path, no service key)', () => {
    const d = posDbAuth({ supabaseJwt: 'user-jwt' } as any, req())
    expect(d?.via).toBe('user_jwt')
    expect(d?.token).toBe('user-jwt')
    expect(d?.apikey).not.toBe(d?.token) // apikey = anon, bearer = user JWT → RLS applies (not a service bypass)
  })

  it('falls back to the fs-at cookie JWT when the context carries none', () => {
    const d = posDbAuth(null, req('cookie-jwt'))
    expect(d?.via).toBe('user_jwt')
    expect(d?.token).toBe('cookie-jwt')
  })

  it('uses the service_role key ONLY when there is no caller JWT (legacy kiosk)', () => {
    process.env.SUPABASE_SERVICE_KEY = 'svc-key'
    const d = posDbAuth(null, req())
    expect(d?.via).toBe('service_role')
    expect(d?.token).toBe('svc-key')
  })

  it('fails closed (null → 503) when neither a caller JWT nor a service key exists', () => {
    expect(posDbAuth(null, req())).toBeNull()
  })

  it('the caller JWT wins even if a service key is present (never bypass RLS when a session exists)', () => {
    process.env.SUPABASE_SERVICE_KEY = 'svc-key'
    const d = posDbAuth({ supabaseJwt: 'user-jwt' } as any, req())
    expect(d?.via).toBe('user_jwt')
  })
})
