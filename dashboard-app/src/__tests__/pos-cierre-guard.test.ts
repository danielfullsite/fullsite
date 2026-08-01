import { describe, it, expect } from 'vitest'
import {
  filterOpenOrders,
  validateEscalationNota,
  withEscalationPayload,
  openOrderStatusLabel,
  OPEN_ORDER_STATUSES,
} from '@/lib/pos-cierre-guard'

const BASE = { mesa: 3, mesero: 'Omar', total: 150 }

describe('filterOpenOrders', () => {
  it('keeps enviada orders', () => {
    expect(filterOpenOrders([{ id: 'a', ...BASE, status: 'enviada' }])).toHaveLength(1)
  })

  it('keeps preparando orders', () => {
    expect(filterOpenOrders([{ id: 'a', ...BASE, status: 'preparando' }])).toHaveLength(1)
  })

  it('keeps lista orders', () => {
    expect(filterOpenOrders([{ id: 'a', ...BASE, status: 'lista' }])).toHaveLength(1)
  })

  it('drops cobrada orders', () => {
    expect(filterOpenOrders([{ id: 'a', ...BASE, status: 'cobrada' }])).toHaveLength(0)
  })

  it('drops cancelada orders', () => {
    expect(filterOpenOrders([{ id: 'a', ...BASE, status: 'cancelada' }])).toHaveLength(0)
  })

  it('filters mixed-status list correctly', () => {
    const mixed = [
      { id: 'a', ...BASE, status: 'enviada' },
      { id: 'b', ...BASE, status: 'cobrada' },
      { id: 'c', ...BASE, status: 'cancelada' },
      { id: 'd', ...BASE, status: 'lista' },
    ]
    const result = filterOpenOrders(mixed)
    expect(result).toHaveLength(2)
    expect(result.map((o) => o.id)).toEqual(['a', 'd'])
  })

  it('returns empty array for empty input', () => {
    expect(filterOpenOrders([])).toHaveLength(0)
  })

  it('preserves all OPEN_ORDER_STATUSES', () => {
    const orders = OPEN_ORDER_STATUSES.map((s, i) => ({ id: `o${i}`, ...BASE, status: s }))
    expect(filterOpenOrders(orders)).toHaveLength(OPEN_ORDER_STATUSES.length)
  })
})

describe('validateEscalationNota', () => {
  it('rejects empty string', () => {
    const r = validateEscalationNota('')
    expect(r.valid).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('rejects whitespace-only string', () => {
    expect(validateEscalationNota('   ').valid).toBe(false)
  })

  it('rejects string shorter than 10 chars', () => {
    const r = validateEscalationNota('corta')
    expect(r.valid).toBe(false)
    expect(r.error).toContain('5/10')
  })

  it('rejects string of exactly 9 chars', () => {
    expect(validateEscalationNota('123456789').valid).toBe(false)
  })

  it('accepts string of exactly 10 chars', () => {
    expect(validateEscalationNota('1234567890').valid).toBe(true)
  })

  it('accepts long nota', () => {
    expect(
      validateEscalationNota('Orden 5 quedó en cocina, cliente ya pagó y se fue').valid
    ).toBe(true)
  })

  it('accepts nota that reaches 10 chars only after trimming leading/trailing whitespace', () => {
    expect(validateEscalationNota('  1234567890  ').valid).toBe(true)
  })
})

describe('withEscalationPayload', () => {
  const base = { id: 'cierre-1', total_ventas: 5000 }
  const openOrders = [
    { id: 'order-1', mesa: 3, mesero: 'Omar', status: 'enviada' as const, total: 200 },
    { id: 'order-2', mesa: 7, mesero: 'Brayan', status: 'lista' as const, total: 350 },
  ]

  it('sets cierre_con_ordenes_abiertas=true when open orders exist', () => {
    const r = withEscalationPayload(base, openOrders, 'Eduardo', 'Nota de autorización')
    expect(r.cierre_con_ordenes_abiertas).toBe(true)
  })

  it('captures all order IDs in ordenes_pendientes', () => {
    const r = withEscalationPayload(base, openOrders, 'Eduardo', 'nota')
    expect(r.ordenes_pendientes).toEqual(['order-1', 'order-2'])
  })

  it('sets cierre_autorizado_por', () => {
    const r = withEscalationPayload(base, openOrders, 'Eduardo Esquivel', 'nota')
    expect(r.cierre_autorizado_por).toBe('Eduardo Esquivel')
  })

  it('sets cierre_nota', () => {
    const nota = 'Cliente abandonó la orden en mesa 7'
    const r = withEscalationPayload(base, openOrders, 'Eduardo', nota)
    expect(r.cierre_nota).toBe(nota)
  })

  it('sets cierre_con_ordenes_abiertas=false when no open orders', () => {
    const r = withEscalationPayload(base, [], null, null)
    expect(r.cierre_con_ordenes_abiertas).toBe(false)
  })

  it('sets empty ordenes_pendientes when no open orders', () => {
    const r = withEscalationPayload(base, [], null, null)
    expect(r.ordenes_pendientes).toEqual([])
  })

  it('does not mutate the original payload', () => {
    const snapshot = { ...base }
    withEscalationPayload(base, openOrders, 'Eduardo', 'nota')
    expect(base).toEqual(snapshot)
  })

  it('preserves all original payload fields', () => {
    const r = withEscalationPayload(base, openOrders, 'Eduardo', 'nota')
    expect(r.id).toBe('cierre-1')
    expect(r.total_ventas).toBe(5000)
  })

  it('accepts null authorizedBy and nota when no escalation occurred', () => {
    const r = withEscalationPayload(base, [], null, null)
    expect(r.cierre_autorizado_por).toBeNull()
    expect(r.cierre_nota).toBeNull()
  })
})

describe('openOrderStatusLabel', () => {
  it('returns label for enviada', () => {
    expect(openOrderStatusLabel('enviada')).toBe('Enviada a cocina')
  })

  it('returns label for preparando', () => {
    expect(openOrderStatusLabel('preparando')).toBe('En preparación')
  })

  it('returns label for lista', () => {
    expect(openOrderStatusLabel('lista')).toBe('Lista — sin cobrar')
  })
})
