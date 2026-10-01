import { describe, expect, it } from 'vitest'
import { runInventoryAgent } from '@/lib/agents/inventory'

const NOW = new Date().toISOString()
const OLD = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString()

describe('inventory agent — calidad de dato antes de recomendar', () => {
  it('no llama auto-86 ni agotado físico a un stock obsoleto', async () => {
    const events = await runInventoryAgent('amalay', async (table) => {
      if (table === 'pos_inventory_products') return [{
        id: 'ing-1', name: 'Harina', unit: 'KG', stock: 0, reorder_point: 5,
        category: 'Abarrotes', cost_per_unit: 10, active: true, updated_at: OLD,
      }] as never
      return [] as never
    })
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('inventory_data_stale')
    expect(events[0].title).not.toMatch(/auto-86|sin stock/i)
    expect(events[0].suggested_action).toMatch(/toma física|sincroniza/i)
  })

  it('sólo alerta stock cero cuando la fila fue observada recientemente', async () => {
    const events = await runInventoryAgent('amalay', async () => [{
      id: 'ing-1', name: 'Harina', unit: 'KG', stock: 0, reorder_point: 5,
      category: 'Abarrotes', cost_per_unit: 10, active: true, updated_at: NOW,
    }] as never)
    const zero = events.find(e => e.type === 'out_of_stock')!
    expect(zero).toBeTruthy()
    expect(zero.title).toMatch(/stock registrado en cero/i)
    expect(zero.title).not.toMatch(/auto-86/i)
  })

  it('separa filas actuales de obsoletas en una misma corrida', async () => {
    const events = await runInventoryAgent('amalay', async () => [
      { id: 'old', name: 'Viejo', unit: 'PZ', stock: 0, reorder_point: 5, category: null, cost_per_unit: 1, active: true, updated_at: OLD },
      { id: 'fresh', name: 'Actual', unit: 'PZ', stock: 0, reorder_point: 5, category: null, cost_per_unit: 1, active: true, updated_at: NOW },
    ] as never)
    expect(events.map(e => e.type)).toEqual(expect.arrayContaining(['inventory_data_stale', 'out_of_stock']))
    expect(events.find(e => e.type === 'out_of_stock')?.evidence).toMatchObject({ count: 1 })
  })
})
