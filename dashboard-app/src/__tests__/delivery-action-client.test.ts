import { describe, expect, it, vi } from 'vitest'
import { applyDeliveryAction, type DeliveryActionRequest } from '@/lib/delivery-action-client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const base: DeliveryActionRequest = {
  localOrderId: 'local-1',
  platformOrderId: 'provider-1',
  platform: 'ubereats',
  action: 'ready',
  localPatch: { status: 'lista' },
  authHeaders: { authorization: 'Bearer shift' },
}

describe('acciones delivery: proveedor antes que estado local', () => {
  it('la pantalla usa el coordinador y ya no dispara Uber en segundo plano', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/app/pos/delivery/page.tsx'), 'utf8')
    expect(page).toContain('await applyDeliveryAction({')
    expect(page).not.toContain("fetch('/api/integrations/uber-eats/order'")
    expect(page).toContain('providerAlreadyConfirmed: result.retry === \'local_only\'')
  })

  it('HTTP no-ok del proveedor conserva la verdad local anterior', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ ok: false }, { status: 422 }))

    const result = await applyDeliveryAction(base, { fetcher })

    expect(result).toMatchObject({ ok: false, stage: 'provider', uncertain: false, retry: 'provider_then_local' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls.some(([url]) => String(url) === '/api/pos/delivery-orders')).toBe(false)
  })

  it('timeout del proveedor queda explícitamente incierto y no toca local', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))

    const pending = applyDeliveryAction(base, { fetcher, timeoutMs: 25 })
    await vi.advanceTimersByTimeAsync(25)
    const result = await pending
    vi.useRealTimers()

    expect(result).toMatchObject({ ok: false, stage: 'provider', uncertain: true, retry: 'provider_then_local' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('éxito del proveedor precede al PATCH local y Rappi también se sincroniza', async () => {
    const urls: string[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      urls.push(String(input))
      return Response.json({ ok: true })
    })

    const result = await applyDeliveryAction({ ...base, platform: 'rappi', action: 'cancel', reason: 'ITEM_UNAVAILABLE' }, { fetcher })

    expect(result).toEqual({ ok: true })
    expect(urls).toEqual(['/api/integrations/rappi/order', '/api/pos/delivery-orders'])
    const providerBody = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
    expect(providerBody).toMatchObject({ action: 'cancel', update_local_status: false })
  })

  it('si el proveedor confirmó pero falla local, el reintento no llama al proveedor otra vez', async () => {
    const first = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ error: 'DB_ERROR' }, { status: 502 }))
    const failed = await applyDeliveryAction(base, { fetcher: first })
    expect(failed).toMatchObject({ ok: false, stage: 'local', retry: 'local_only' })

    const retry = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ ok: true }))
    const recovered = await applyDeliveryAction({ ...base, providerAlreadyConfirmed: true }, { fetcher: retry })

    expect(recovered).toEqual({ ok: true })
    expect(retry).toHaveBeenCalledTimes(1)
    expect(String(retry.mock.calls[0][0])).toBe('/api/pos/delivery-orders')
  })
})
