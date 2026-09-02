import { describe, it, expect } from 'vitest'

// Regresión: TypeError "Invalid response status code 204" en /api/pos/db.
// PostgREST responde 204 con Prefer: return=minimal; construir un Response con
// body string (aunque sea "") y status 204/205/304 truena en Node/undici.
// El proxy debe pasar body null en esos status.

function buildProxyResponse(text: string, status: number): Response {
  const bodyless = status === 204 || status === 205 || status === 304
  return new Response(bodyless ? null : text, { status })
}

describe('proxy PostgREST — status sin body', () => {
  it.each([204, 205, 304])('status %i no truena y va sin body', (status) => {
    const res = buildProxyResponse('', status)
    expect(res.status).toBe(status)
    expect(res.body).toBeNull()
  })

  it('status 200 conserva el body', async () => {
    const res = buildProxyResponse('[{"ok":true}]', 200)
    expect(await res.text()).toBe('[{"ok":true}]')
  })

  it('reproduce el bug: Response con body string y 204 lanza', () => {
    expect(() => new Response('', { status: 204 })).toThrow()
  })
})
