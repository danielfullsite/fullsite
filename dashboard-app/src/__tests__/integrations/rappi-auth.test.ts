import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildRappiAuthHeaders,
  clearRappiTokenCacheForTests,
  getRappiAccessToken,
  rappiBaseUrl,
  rappiConfigStatus,
  RappiConfigError,
} from '@/lib/integrations/rappi/auth'

const ORIGINAL_ENV = { ...process.env }

describe('Rappi OAuth client_credentials', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
    process.env.RAPPI_ENV = 'dev'
    process.env.RAPPI_CLIENT_ID = 'test-client-id'
    process.env.RAPPI_CLIENT_SECRET = 'test-client-secret'
    delete process.env.RAPPI_API_BASE_URL
    clearRappiTokenCacheForTests()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...ORIGINAL_ENV }
    clearRappiTokenCacheForTests()
  })

  it('uses the Rappi DEV base URL by default', () => {
    expect(rappiBaseUrl()).toBe('https://api.dev.rappi.com')
    expect(rappiConfigStatus()).toMatchObject({
      env: 'dev',
      client_id_configured: true,
      client_secret_configured: true,
    })
  })

  it('builds the exact x-authorization header Rappi requires', async () => {
    const fetchSpy = vi.fn(async () => Response.json({ access_token: 'TOKEN-123', expires_in: 86400 }))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(buildRappiAuthHeaders()).resolves.toEqual({ 'x-authorization': 'Bearer TOKEN-123' })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.dev.rappi.com/restaurants/auth/v1/token/login/integrations')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ client_id: 'test-client-id', client_secret: 'test-client-secret' })
  })

  it('caches the token and avoids extra auth calls before expiry', async () => {
    const fetchSpy = vi.fn(async () => Response.json({ access_token: 'TOKEN-CACHED', expires_in: 86400 }))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(getRappiAccessToken()).resolves.toBe('TOKEN-CACHED')
    await expect(getRappiAccessToken()).resolves.toBe('TOKEN-CACHED')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('fails closed without client id or secret and never calls Rappi', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    delete process.env.RAPPI_CLIENT_SECRET

    await expect(getRappiAccessToken()).rejects.toBeInstanceOf(RappiConfigError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
