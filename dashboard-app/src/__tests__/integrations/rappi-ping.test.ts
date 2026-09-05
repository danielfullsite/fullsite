// Rappi — PING de disponibilidad por tienda.
//
// Contrato oficial (dev-portal.rappi.com/en/webhook-events/, confirmado 2026-08-29):
//   recibe  { "store_id": 999 }
//   responde { "status": "OK", "description": "Store on" }
//   · `status` OBLIGATORIO. null o distinto de "OK" => Rappi da la tienda por NO disponible.
//   · "This Ping must be implemented for each store and not on a central server."
//
// Lo que estaba mal, y estas pruebas fijan:
//   1. el webhook respondía `{ok:true, event:'ping'}` — sin `status`, o sea "no disponible"
//      cada 3 minutos;
//   2. `/health` respondía `{status:'OK'}` SIEMPRE, sin mirar nada, desde un endpoint
//      central. Mentir que la tienda opera hace que Rappi mande órdenes que terminan
//      en la DLQ como `unmapped_store`.

import { describe, it, expect, vi } from 'vitest'
import {
  responderPing, extraerStoreId, esPing, PING_OK,
} from '@/lib/integrations/rappi/ping'

const mapeada = async (id: string) => (id === '999' ? 'amalay' : null)

describe('Rappi PING — la forma exacta que exige el contrato', () => {
  it('tienda mapeada responde status OK con la descripción documentada', async () => {
    const r = await responderPing('999', mapeada)
    expect(r).toEqual({ status: 'OK', description: 'Store on' })
  })

  it('el campo status SIEMPRE viene — su ausencia es "no disponible" para Rappi', async () => {
    for (const id of ['999', '404', null]) {
      const r = await responderPing(id, mapeada)
      expect(r.status).toBeDefined()
      expect(r.status).not.toBeNull()
    }
  })
})

describe('Rappi PING — falla CERRADO', () => {
  it('REGRESION: tienda no mapeada NO responde OK', async () => {
    // Antes, /health respondia OK siempre. Rappi mandaba ordenes de tiendas que
    // no sabemos atender y acababan en la DLQ como unmapped_store.
    const r = await responderPing('404', mapeada)
    expect(r.status).toBe('UNAVAILABLE')
    expect(r.description).toMatch(/not mapped/i)
  })

  it('sin store_id no se afirma nada sobre ninguna tienda', async () => {
    const r = await responderPing(null, mapeada)
    expect(r.status).toBe('UNAVAILABLE')
    expect(r.description).toMatch(/missing store_id/i)
  })

  it('si la consulta del mapeo falla, tampoco se dice que sí', async () => {
    const revienta = vi.fn().mockRejectedValue(new Error('supabase caido'))
    const r = await responderPing('999', revienta)
    expect(r.status).toBe('UNAVAILABLE')
    expect(r.description).toMatch(/lookup failed/i)
  })

  it('es POR TIENDA: la misma corrida responde distinto según el store_id', async () => {
    expect((await responderPing('999', mapeada)).status).toBe('OK')
    expect((await responderPing('1000', mapeada)).status).toBe('UNAVAILABLE')
  })
})

describe('Rappi PING — extracción del store_id', () => {
  it('lee el numérico que manda Rappi', () => {
    expect(extraerStoreId({ store_id: 999 })).toBe('999')
  })

  it('acepta la variante camelCase y el string', () => {
    expect(extraerStoreId({ storeId: '999' })).toBe('999')
    expect(extraerStoreId({ store_id: ' 999 ' })).toBe('999')
  })

  it('devuelve null cuando no viene', () => {
    expect(extraerStoreId({})).toBeNull()
    expect(extraerStoreId(null)).toBeNull()
    expect(extraerStoreId({ store_id: null })).toBeNull()
    expect(extraerStoreId({ store_id: '' })).toBeNull()
  })

  it('el store_id 0 no se pierde por ser falsy', () => {
    expect(extraerStoreId({ store_id: 0 })).toBe('0')
  })
})

describe('Rappi PING — reconocerlo', () => {
  it('lo detecta por el tipo de evento', () => {
    expect(esPing({}, 'PING')).toBe(true)
    expect(esPing({}, 'ping')).toBe(true)
  })

  it('lo detecta por el sobre documentado, que sólo trae store_id', () => {
    expect(esPing({ store_id: 999 }, null)).toBe(true)
  })

  it('no confunde una orden con un PING', () => {
    expect(esPing({ store_id: 999, order_detail: {} }, 'NEW_ORDER')).toBe(false)
    expect(esPing({ order_detail: {} }, null)).toBe(false)
  })
})

describe('Rappi PING — la constante', () => {
  it('PING_OK es literalmente lo que pide el portal', () => {
    expect(PING_OK).toEqual({ status: 'OK', description: 'Store on' })
  })
})
