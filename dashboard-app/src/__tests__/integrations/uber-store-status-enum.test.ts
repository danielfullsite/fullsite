// Uber — el enum de estado de tienda: ONLINE no es ACTIVE.
//
// Evidencia de campo: corrida de certificación 33447286178 (2026-08-31).
// GET /v1/delivery/store/{id}/status devolvió, textual:
//
//   { "is_open": false, "status": "ONLINE" }
//
// Ese `is_open:false` lo calculábamos NOSOTROS comparando `status === 'ACTIVE'`.
// En el mismo instante, GET /v1/delivery/store/{id} devolvía
// `orderability: { status:"ONLINE", is_visible:true, is_orderable:true }` — o sea la
// tienda estaba abierta y la reportábamos cerrada.
//
// El mismo desajuste ya había mordido del lado de la escritura (el GET devuelve
// PAUSED, el POST espera OFFLINE), documentado en CERTIFICATION.md. Estas pruebas
// existen para que la tercera vez no exista.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { normalizeStoreOpen, rawStoreStatus } from '@/lib/integrations/uber-eats/store-status'

beforeEach(() => vi.restoreAllMocks())

describe('Uber — estado de tienda: valores que Uber sí manda', () => {
  it('REGRESION: ONLINE es ABIERTA (antes daba cerrada)', () => {
    // El caso exacto de la corrida 33447286178.
    expect(normalizeStoreOpen({ status: 'ONLINE' })).toBe(true)
  })

  it('PAUSED es cerrada — el valor que devuelve el GET al pausar', () => {
    expect(normalizeStoreOpen({ status: 'PAUSED' })).toBe(false)
  })

  it('OFFLINE es cerrada — el valor que espera el POST', () => {
    expect(normalizeStoreOpen({ status: 'OFFLINE' })).toBe(false)
  })

  it('ACTIVE sigue siendo abierta — no se rompe lo que ya funcionaba', () => {
    expect(normalizeStoreOpen({ store_status: 'ACTIVE' })).toBe(true)
  })

  it('no distingue mayúsculas ni espacios', () => {
    expect(normalizeStoreOpen({ status: ' online ' })).toBe(true)
    expect(normalizeStoreOpen({ status: 'Paused' })).toBe(false)
  })
})

describe('Uber — precedencia de las fuentes', () => {
  it('el is_open explícito de Uber gana sobre el texto del estado', () => {
    expect(normalizeStoreOpen({ is_open: false, status: 'ONLINE' })).toBe(false)
    expect(normalizeStoreOpen({ is_open: true, status: 'PAUSED' })).toBe(true)
  })

  it('store_status tiene prioridad sobre status', () => {
    expect(normalizeStoreOpen({ store_status: 'PAUSED', status: 'ONLINE' })).toBe(false)
  })
})

describe('Uber — un enum desconocido NO se asume cerrado', () => {
  it('devuelve null, no false — así es como este bug pasó meses invisible', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(normalizeStoreOpen({ status: 'SUSPENDED_BY_UBER' })).toBeNull()
  })

  it('deja rastro en consola para que alguien lo vea', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    normalizeStoreOpen({ status: 'ALGO_NUEVO' })
    expect(warn).toHaveBeenCalled()
  })

  it('sin datos, o vacío, también es desconocido', () => {
    expect(normalizeStoreOpen(null)).toBeNull()
    expect(normalizeStoreOpen(undefined)).toBeNull()
    expect(normalizeStoreOpen({})).toBeNull()
    expect(normalizeStoreOpen({ status: '' })).toBeNull()
  })
})

describe('Uber — la etiqueta cruda se conserva para la evidencia', () => {
  it('devuelve lo que Uber dijo, sin traducir', () => {
    expect(rawStoreStatus({ status: 'ONLINE' })).toBe('ONLINE')
    expect(rawStoreStatus({ store_status: 'PAUSED', status: 'ONLINE' })).toBe('PAUSED')
    expect(rawStoreStatus(null)).toBeUndefined()
  })
})
