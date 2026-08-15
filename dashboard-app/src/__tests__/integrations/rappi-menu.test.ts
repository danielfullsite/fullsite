import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as rappiMenuGet, POST as rappiMenuPost } from '@/app/api/integrations/rappi/menu/route'
import { buildRappiDevTestMenu } from '@/lib/integrations/rappi/menu'
import { clearRappiTokenCacheForTests } from '@/lib/integrations/rappi/auth'

const ORIGINAL_ENV = { ...process.env }

function authedRequest(body: unknown = {}) {
  return new NextRequest('https://app.fullsite.mx/api/integrations/rappi/menu', {
    method: 'POST',
    headers: { Authorization: 'Bearer admin-secret' },
    body: JSON.stringify(body),
  })
}

function authedGet(url = 'https://app.fullsite.mx/api/integrations/rappi/menu?store_id=900173586') {
  return new NextRequest(url, {
    method: 'GET',
    headers: { Authorization: 'Bearer admin-secret' },
  })
}

describe('Rappi DEV menu upload route', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
    process.env.INTEGRATION_ADMIN_SECRET = 'admin-secret'
    process.env.RAPPI_ENV = 'dev'
    process.env.RAPPI_CLIENT_ID = 'test-client-id'
    process.env.RAPPI_CLIENT_SECRET = 'test-client-secret'
    process.env.RAPPI_STORE_ID = '900173586'
    delete process.env.RAPPI_API_BASE_URL
    delete process.env.RAPPI_LEGACY_API_BASE_URL
    clearRappiTokenCacheForTests()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...ORIGINAL_ENV }
    clearRappiTokenCacheForTests()
  })

  it('builds the minimal Fullsite DEV menu with centavo prices', () => {
    const menu = buildRappiDevTestMenu('store-123')

    expect(menu.storeId).toBe('store-123')
    expect(menu.items).toHaveLength(3)
    expect(new Set(menu.items.map(item => item.category.id)).size).toBe(2)
    expect(menu.items[0]).toMatchObject({
      sku: 'fullsite-dev-cafe-americano',
      price: 4500,
      type: 'PRODUCT',
      category: {
        id: 'fullsite-dev-cat-bebidas',
        name: 'Bebidas',
      },
    })
  })

  it('fails closed without the admin secret and never calls Rappi', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    delete process.env.INTEGRATION_ADMIN_SECRET

    const res = await rappiMenuPost(authedRequest({ dry_run: true }))

    expect(res.status).toBe(503)
    expect(fetchSpy).not.toHaveBeenCalled()
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: 'INTEGRATION_ADMIN_SECRET_REQUIRED' })
  })

  it('rejects unauthenticated callers and never calls Rappi', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const req = new NextRequest('https://app.fullsite.mx/api/integrations/rappi/menu', {
      method: 'POST',
      body: JSON.stringify({ dry_run: true }),
    })

    const res = await rappiMenuPost(req)

    expect(res.status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: 'UNAUTHORIZED' })
  })

  it('is DEV-only and will not upload menus when RAPPI_ENV is production', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    process.env.RAPPI_ENV = 'prod'

    const res = await rappiMenuPost(authedRequest({ dry_run: false }))

    expect(res.status).toBe(409)
    expect(fetchSpy).not.toHaveBeenCalled()
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: 'RAPPI_MENU_DEV_ONLY' })
  })

  it('dry-runs the seed payload without calling Rappi', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const res = await rappiMenuPost(authedRequest({ dry_run: true }))
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(payload).toMatchObject({
      ok: true,
      provider: 'rappi',
      action: 'upload_menu',
      dry_run: true,
      summary: {
        store_id_configured: true,
        category_count: 2,
        product_count: 3,
      },
    })
    expect(JSON.stringify(payload)).not.toContain('test-client-secret')
  })

  it('uploads the menu through the documented legacy DEV content endpoint', async () => {
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/restaurants/auth/v1/token/login/integrations')) {
        return Response.json({ access_token: 'TOKEN-123', expires_in: 86400 })
      }
      if (url.endsWith('/api/v2/restaurants-integrations-public-api/menu')) {
        const body = JSON.parse(String(init?.body))
        expect(body).toMatchObject({
          storeId: '900173586',
          items: expect.any(Array),
        })
        expect(body.items).toHaveLength(3)
        expect(body.items[0]).toMatchObject({
          category: {
            id: 'fullsite-dev-cat-bebidas',
            name: 'Bebidas',
          },
          name: 'Café americano',
          price: 4500,
          sku: 'fullsite-dev-cafe-americano',
          type: 'PRODUCT',
        })
        expect(new Headers(init?.headers).get('x-authorization')).toBe('Bearer TOKEN-123')
        return Response.json({ message: 'ok' })
      }
      return Response.json({ error: 'unexpected url' }, { status: 500 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    const res = await rappiMenuPost(authedRequest({ dry_run: false }))
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload).toMatchObject({
      ok: true,
      provider: 'rappi',
      action: 'upload_menu',
      dry_run: false,
      status_code: 200,
    })
    const calledUrls = fetchSpy.mock.calls.map(call => String(call[0]))
    expect(calledUrls).toContain('https://api.dev.rappi.com/restaurants/auth/v1/token/login/integrations')
    expect(calledUrls).toContain('https://microservices.dev.rappi.com/api/v2/restaurants-integrations-public-api/menu')
    expect(JSON.stringify(payload)).not.toContain('TOKEN-123')
    expect(JSON.stringify(payload)).not.toContain('test-client-secret')
  })

  it('reads the approved menu validation endpoint without leaking tokens', async () => {
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/restaurants/auth/v1/token/login/integrations')) {
        return Response.json({ access_token: 'TOKEN-123', expires_in: 86400 })
      }
      if (url.endsWith('/api/v2/restaurants-integrations-public-api/menu/approved/900173586')) {
        expect(new Headers(init?.headers).get('x-authorization')).toBe('Bearer TOKEN-123')
        return Response.json({ status: 'APPROVED', items: [{ sku: 'fullsite-dev-latte' }] })
      }
      return Response.json({ error: 'unexpected url' }, { status: 500 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    const res = await rappiMenuGet(authedGet('https://app.fullsite.mx/api/integrations/rappi/menu?store_id=900173586&mode=approved'))
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload).toMatchObject({
      ok: true,
      provider: 'rappi',
      action: 'read_menu',
      mode: 'approved',
      status_code: 200,
      upstream: { status: 'APPROVED', item_count: 1 },
    })
    expect(JSON.stringify(payload)).not.toContain('TOKEN-123')
  })

  it('returns only sanitized upstream errors', async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.endsWith('/restaurants/auth/v1/token/login/integrations')) {
        return Response.json({ access_token: 'TOKEN-123', expires_in: 86400 })
      }
      return Response.json({
        message: 'Menu rejected',
        client_secret: 'do-not-leak',
        access_token: 'do-not-leak',
      }, { status: 400 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    const res = await rappiMenuPost(authedRequest({ dry_run: false }))
    const payload = await res.json()

    expect(res.status).toBe(502)
    expect(payload).toMatchObject({
      ok: false,
      provider: 'rappi',
      action: 'upload_menu',
      status_code: 400,
      upstream: { message: 'Menu rejected' },
    })
    expect(JSON.stringify(payload)).not.toContain('do-not-leak')
    expect(JSON.stringify(payload)).not.toContain('TOKEN-123')
  })
})
