import { describe, it, expect, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as healthGet, POST as healthPost } from '@/app/api/integrations/rappi/health/route'
import { POST as rappiWebhookPost } from '@/app/api/integrations/rappi/webhook/route'
import { GET as rappiStatusGet } from '@/app/api/integrations/rappi/status/route'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Rappi readiness endpoints', () => {
  const savedSecret = process.env.RAPPI_WEBHOOK_SECRET

  afterEach(() => {
    if (savedSecret === undefined) delete process.env.RAPPI_WEBHOOK_SECRET
    else process.env.RAPPI_WEBHOOK_SECRET = savedSecret
  })

  it('health endpoint responds OK for Rappi connectivity checks', async () => {
    const getRes = await healthGet()
    const postRes = await healthPost()
    expect(getRes.status).toBe(200)
    expect(postRes.status).toBe(200)
    await expect(getRes.json()).resolves.toMatchObject({ status: 'OK', provider: 'rappi' })
  })

  it('webhook fails closed when the Rappi webhook secret is not configured', async () => {
    delete process.env.RAPPI_WEBHOOK_SECRET
    const req = new NextRequest('https://app.fullsite.mx/api/integrations/rappi/webhook', {
      method: 'POST',
      body: JSON.stringify({ id: 'rappi-order-1' }),
    })
    const res = await rappiWebhookPost(req)
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: 'RAPPI_WEBHOOK_NOT_CONFIGURED' })
  })

  it('webhook does not ingest orders while the signature contract is pending', async () => {
    process.env.RAPPI_WEBHOOK_SECRET = 'test-rappi-secret'
    const req = new NextRequest('https://app.fullsite.mx/api/integrations/rappi/webhook', {
      method: 'POST',
      headers: { 'Rappi-Signature': 't=1,sign=test' },
      body: JSON.stringify({ id: 'rappi-order-1' }),
    })
    const res = await rappiWebhookPost(req)
    expect(res.status).toBe(501)
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: 'RAPPI_SIGNATURE_CONTRACT_PENDING' })
  })
})

describe('/delivery security contract', () => {
  it('does not perform direct browser Supabase REST reads', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/delivery/page.tsx'), 'utf8')
    expect(source).not.toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    expect(source).not.toContain('/rest/v1/')
    expect(source).toContain('/api/pos/delivery-orders')
  })

  it('keeps POS delivery operations server-mediated and tenant-scoped', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/pos/delivery/page.tsx'), 'utf8')
    expect(source).not.toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    expect(source).not.toContain('/rest/v1/delivery_orders')
    expect(source).not.toContain('getClientId(')
    expect(source).toContain('/api/pos/delivery-orders')
  })

  it('keeps the legacy Rappi scraper removed or free of hardcoded credentials', () => {
    const scriptPath = join(process.cwd(), '../.github/scripts/rappi_cron_local.sh')
    if (!existsSync(scriptPath)) return
    const source = readFileSync(scriptPath, 'utf8')
    expect(source).not.toMatch(/export\s+RAPPI_USER\s*=\s*"[^"$]+"/)
    expect(source).not.toMatch(/export\s+RAPPI_PASSWORD\s*=\s*"[^"$]+"/)
    expect(source).toContain('RAPPI_USER / RAPPI_PASSWORD must be provided by the environment')
  })

  it('does not allow integration audit writes through the browser anon key', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/integrations/audit-logger.ts'), 'utf8')
    expect(source).not.toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    expect(source).toContain('SUPABASE_SERVICE_KEY')
  })
})

describe('Rappi admin status route', () => {
  const savedSecret = process.env.INTEGRATION_ADMIN_SECRET

  afterEach(() => {
    if (savedSecret === undefined) delete process.env.INTEGRATION_ADMIN_SECRET
    else process.env.INTEGRATION_ADMIN_SECRET = savedSecret
  })

  it('requires an admin secret before reporting integration config', async () => {
    process.env.INTEGRATION_ADMIN_SECRET = 'admin-secret'
    const req = new NextRequest('https://app.fullsite.mx/api/integrations/rappi/status')
    const res = await rappiStatusGet(req)
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: 'UNAUTHORIZED' })
  })

  it('reports only redacted config booleans to an authorized operator', async () => {
    process.env.INTEGRATION_ADMIN_SECRET = 'admin-secret'
    process.env.RAPPI_CLIENT_ID = 'client-id'
    process.env.RAPPI_CLIENT_SECRET = 'client-secret'
    const req = new NextRequest('https://app.fullsite.mx/api/integrations/rappi/status', {
      headers: { Authorization: 'Bearer admin-secret' },
    })
    const res = await rappiStatusGet(req)
    expect(res.status).toBe(200)
    const payload = await res.json()
    expect(payload).toMatchObject({
      ok: true,
      provider: 'rappi',
      client_id_configured: true,
      client_secret_configured: true,
    })
    expect(JSON.stringify(payload)).not.toContain('client-secret')
    expect(JSON.stringify(payload)).not.toContain('client-id')
  })
})
