// RAPPI YA RECIBIÓ SU 200: SI NO INGERIMOS, NADIE REINTENTA.
//
// El webhook contesta `200 {accepted:true}` y deja la ingesta en `after()`.
// Con eso, cada camino que descartaba una orden sin escribirla es una orden de
// un cliente perdida en silencio (barrido 3, 2026-09-12, integraciones P0):
//
//   · RAPPI_ORDER_ID_MISSING  → `return` seco, sin fila en la DLQ
//   · RAPPI_STORE_ID_MISSING  → `return` seco, sin fila en la DLQ
//   · excepción en la ingesta → `if (dev) console.log`, en producción ni eso
//
// Estas pruebas ejercen `processRappiOrder` de verdad, con la frontera de red
// simulada, y exigen una fila en `integration_webhook_dlq` en los tres casos.
import { describe, it, expect, beforeEach, vi } from 'vitest'

process.env.SUPABASE_SERVICE_KEY = 'service-key-sintetica'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging.supabase.co'

const llamadas: { url: string; method: string; body: unknown }[] = []
beforeEach(() => {
  vi.resetModules()
  llamadas.length = 0
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    llamadas.push({ url: String(url), method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : null })
    // Sin mapeos y sin órdenes previas: la lectura devuelve vacío.
    return { ok: true, status: 200, json: async () => [], text: async () => '[]' } as unknown as Response
  })
})

const enDLQ = () => llamadas.filter(l => l.url.includes('integration_webhook_dlq') && l.method === 'POST')

describe('ningún descarte de Rappi se pierde en silencio', () => {
  it('REGRESION: una orden sin id de plataforma queda en la cola de rezagados con su payload', async () => {
    const { processRappiOrder } = await import('@/lib/integrations/rappi/ingest')
    const r = await processRappiOrder({ cosa: 'payload con forma inesperada' }, 'webhook')
    expect(r.action).toBe('dlq')
    expect(r.reason).toBe('RAPPI_ORDER_ID_MISSING')
    const filas = enDLQ()
    expect(filas, 'tiene que haber UNA fila en la DLQ').toHaveLength(1)
    expect((filas[0].body as Record<string, unknown>).failure_reason).toBe('RAPPI_ORDER_ID_MISSING')
    expect((filas[0].body as Record<string, unknown>).payload).toEqual({ cosa: 'payload con forma inesperada' })
  })

  it('REGRESION: una orden sin tienda también queda registrada, con su id de plataforma', async () => {
    const { processRappiOrder } = await import('@/lib/integrations/rappi/ingest')
    const r = await processRappiOrder({ id: 'RAPPI-123' }, 'webhook')
    expect(r.reason).toBe('RAPPI_STORE_ID_MISSING')
    const filas = enDLQ()
    expect(filas).toHaveLength(1)
    expect((filas[0].body as Record<string, unknown>).failure_reason).toBe('RAPPI_STORE_ID_MISSING')
  })

  it('la tienda sin mapear sigue yendo a la DLQ como antes', async () => {
    const { processRappiOrder } = await import('@/lib/integrations/rappi/ingest')
    const r = await processRappiOrder({ id: 'RAPPI-9', store_id: 'tienda-desconocida' }, 'webhook')
    expect(r.reason).toBe('UNMAPPED_STORE')
    expect(enDLQ()).toHaveLength(1)
    expect(String((enDLQ()[0].body as Record<string, unknown>).failure_reason)).toContain('unmapped_store')
  })

  it('si hasta la DLQ falla, se registra y NO se lanza (el 200 ya salió)', async () => {
    const errores: unknown[] = []
    vi.stubGlobal('console', { ...console, error: (...a: unknown[]) => errores.push(a) })
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes('integration_webhook_dlq')) throw new TypeError('PostgREST caído')
      return { ok: true, status: 200, json: async () => [], text: async () => '[]' } as unknown as Response
    })
    const { processRappiOrder } = await import('@/lib/integrations/rappi/ingest')
    await expect(processRappiOrder({ cosa: 1 }, 'webhook')).resolves.toMatchObject({ action: 'dlq' })
    expect(errores.length, 'el fallo de la DLQ tiene que quedar en el log de la función').toBeGreaterThan(0)
  })

  it('REGRESION (fuente): el catch del webhook registra en producción y encola, no sólo en dev', async () => {
    const src = await import('node:fs').then(fs => fs.readFileSync(new URL('../../app/api/integrations/rappi/webhook/route.ts', import.meta.url), 'utf8'))
    const i = src.indexOf('} catch (e) {')
    const bloque = src.slice(i, i + 900)
    expect(bloque).toMatch(/console\.error\('\[rappi-webhook\] ingest-error'/)
    expect(bloque).toMatch(/cuarentenarOrdenDeRappi\(order,/)
    expect(bloque).not.toMatch(/if \(dev\) console\.log\(`\[rappi-webhook\] ingest-error/)
  })
})
