import { describe, expect, it } from 'vitest'

describe('Rappi webhook health check', () => {
  it('returns a browser-readable 200 response without weakening POST authentication', async () => {
    const route = await import('@/app/api/integrations/rappi/webhook/route')

    expect(typeof route.GET).toBe('function')

    const response = await route.GET()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: 'fullsite-rappi-webhook',
      version: '1.0.0',
      accepts: ['POST'],
    })
  })
})
