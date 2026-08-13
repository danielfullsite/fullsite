import { describe, it, expect, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as healthGet, POST as healthPost } from '@/app/api/integrations/rappi/health/route'
import { POST as rappiWebhookPost } from '@/app/api/integrations/rappi/webhook/route'
import { readFileSync } from 'node:fs'
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
})
