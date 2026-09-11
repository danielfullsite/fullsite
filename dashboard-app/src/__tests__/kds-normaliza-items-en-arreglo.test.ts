// El DELTA ORDER_SENT trae `items` como ARREGLO; el KDS web tiene que pintarlo.
//
// Barrido 2026-09-10 (kds LENTE-3): normalizeOrder solo aceptaba `items` string
// (forma del SNAPSHOT). Un DELTA de una orden NUEVA llegaba con items '[]' y el
// filtro del KDS no pintaba la comanda ni sonaba hasta reconectar.
import { describe, it, expect } from 'vitest'
import { normalizeOrder } from '@/hooks/useKdsWsClient'

describe('normalizeOrder', () => {
  it('REGRESION: items en arreglo (DELTA del POS) se serializan, no se descartan', () => {
    const o = normalizeOrder({ order_id: 'o1', mesa: 4, items: [{ id: 'i1', nombre: 'Tacos', station: 'cocina' }] })
    expect(JSON.parse(o.items)).toHaveLength(1)
    expect(o.id).toBe('o1')
  })
  it('items string (SNAPSHOT) se conservan tal cual', () => {
    const o = normalizeOrder({ id: 'o1', items: '[{"id":"i1"}]' })
    expect(o.items).toBe('[{"id":"i1"}]')
  })
  it('sin items en el payload se conservan los de la orden existente', () => {
    const existing = normalizeOrder({ id: 'o1', items: '[{"id":"i1"}]' })
    const o = normalizeOrder({ id: 'o1', status: 'lista' }, existing)
    expect(o.items).toBe('[{"id":"i1"}]')
    expect(o.status).toBe('lista')
  })
})
