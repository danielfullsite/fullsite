import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ventasFullsitePrimero } from '@/lib/pos-daily'

const SB = 'https://x.supabase.co'
const H = { apikey: 'k', Authorization: 'Bearer k' }

beforeEach(() => vi.unstubAllGlobals())

describe('chat: ventas SQL de Fullsite antes que espejo Wansoft', () => {
  it('reemplaza una fecha solapada por el agregado vivo y conserva sólo historia no cubierta', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('wansoft_daily')) return Response.json([
        { fecha: '2026-10-01', ventas_dia: 10 },
        { fecha: '2026-09-01', ventas_dia: 99 },
      ])
      if (url.includes('fs_ventas_diarias')) return Response.json([
        { fecha: '2026-10-01', ventas_dia: 42, ventas_brutas: 42, descuentos: 0, propinas_total: 0, tickets_count: 1, personas_restaurant: 1, efectivo: 42, tarjeta: 0 },
      ])
      throw new Error(`URL inesperada: ${url}`)
    }))

    const r = await ventasFullsitePrimero(SB, H, 'amalay', 30, 'fecha,ventas_dia')
    expect(r.dias.map(d => [d.fecha, d.ventas_dia])).toEqual([['2026-10-01', 42], ['2026-09-01', 99]])
    expect(r.fuente).toBe('fullsite+historico')
  })

  it('no inventa ventas actuales si falla SQL: conserva historia como historia', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('wansoft_daily')) return Response.json([{ fecha: '2026-09-01', ventas_dia: 99 }])
      if (url.includes('fs_ventas_diarias')) return new Response('{}', { status: 500 })
      if (url.includes('pos_orders')) return new Response('{}', { status: 500 })
      throw new Error(`URL inesperada: ${url}`)
    }))

    const r = await ventasFullsitePrimero(SB, H, 'amalay', 30, 'fecha,ventas_dia')
    expect(r.fuente).toBe('historico')
    expect(r.determinado).toBe(true)
    expect(r.dias).toHaveLength(1)
  })
})
