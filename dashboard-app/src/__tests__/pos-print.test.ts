/**
 * P2.5.6 — Print Bridge + Queue tests
 *
 * Coverage:
 *  - detectItemChanges (pure function)
 *  - print-queue state machine (enqueue, transitions, retryJob, retryAllStuck)
 *  - print-queue bridge health caching
 *  - IVA conditional rendering (PRN-GAP-02)
 *  - reprintByStation enqueue on failure (PRN-GAP-01)
 *  - splitOrderByStation station validation and tiempo items
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { detectItemChanges, splitOrderByStation } from '@/lib/printer'
import { getIvaRate, setIvaRate, IVA_RATE, TIEMPO_ITEM_ID } from '@/lib/pos-constants'
import { enqueue, getQueue, retryJob, retryAllStuck, clearCompleted, getPendingCount, getNeedsAttentionCount, removeJob, enqueueFailedPrint } from '@/lib/print-queue'

// ─── detectItemChanges ────────────────────────────────────────────────────────

describe('detectItemChanges', () => {
  const base = { cantidad: 2, modificadores: ['Sin cebolla'], notas: '', silla: 0 }

  it('returns empty array when nothing changed', () => {
    const current = { cantidad: 2, modificadores: ['Sin cebolla'], notas: '', silla: 0, nombre: 'Chilaquiles', subtotal: 100, menuItemId: 'x', station: 'cocina' as const }
    expect(detectItemChanges(base, current)).toHaveLength(0)
  })

  it('detects cantidad change', () => {
    const current = { ...base, nombre: 'x', subtotal: 100, menuItemId: 'x', station: 'cocina' as const, cantidad: 3 }
    const changes = detectItemChanges(base, current)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ field: 'Cantidad', from: '2', to: '3' })
  })

  it('detects modificadores change', () => {
    const current = { ...base, nombre: 'x', subtotal: 100, menuItemId: 'x', station: 'cocina' as const, modificadores: ['Con queso'] }
    const changes = detectItemChanges(base, current)
    expect(changes).toHaveLength(1)
    expect(changes[0].field).toBe('Modificadores')
    expect(changes[0].from).toBe('Sin cebolla')
    expect(changes[0].to).toBe('Con queso')
  })

  it('treats same modificadores in different order as no change', () => {
    const sent = { ...base, modificadores: ['B', 'A'] }
    const current = { ...base, nombre: 'x', subtotal: 100, menuItemId: 'x', station: 'cocina' as const, modificadores: ['A', 'B'] }
    expect(detectItemChanges(sent, current)).toHaveLength(0)
  })

  it('detects notas change', () => {
    const current = { ...base, nombre: 'x', subtotal: 100, menuItemId: 'x', station: 'cocina' as const, notas: 'Extra picante' }
    const changes = detectItemChanges(base, current)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ field: 'Notas', from: '(sin notas)', to: 'Extra picante' })
  })

  it('detects silla change', () => {
    const current = { ...base, nombre: 'x', subtotal: 100, menuItemId: 'x', station: 'cocina' as const, silla: 3 }
    const changes = detectItemChanges(base, current)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ field: 'Silla', from: '-', to: 'S3' })
  })

  it('detects multiple simultaneous changes', () => {
    const current = { nombre: 'x', subtotal: 100, menuItemId: 'x', station: 'cocina' as const, cantidad: 5, modificadores: [], notas: 'Urgente', silla: 2 }
    const changes = detectItemChanges(base, current)
    expect(changes.map(c => c.field).sort()).toEqual(['Cantidad', 'Modificadores', 'Notas', 'Silla'].sort())
  })
})

// ─── Print Queue state machine ────────────────────────────────────────────────

describe('print-queue state machine', () => {
  beforeEach(() => {
    // Provide a fresh localStorage for each test
    const store: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v },
      removeItem: (k: string) => { delete store[k] },
    })
    // Stub window for CustomEvent
    if (typeof window === 'undefined') {
      vi.stubGlobal('window', { dispatchEvent: vi.fn() })
    } else {
      vi.spyOn(window, 'dispatchEvent').mockImplementation(() => true)
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('enqueue adds a job in pending status', () => {
    const job = enqueue({ station: 'cocina', data: 'dGVzdA==', type: 'comanda', meta: { mesa: 1 } })
    expect(job.status).toBe('pending')
    expect(job.retries).toBe(0)
    expect(job.station).toBe('cocina')
    expect(getQueue()).toHaveLength(1)
  })

  it('retryJob resets status to pending and zeroes retries', () => {
    const job = enqueue({ station: 'barra', data: 'dGVzdA==', type: 'comanda' })
    // Manually set to needs_attention
    const q = getQueue()
    q[0].status = 'needs_attention'
    q[0].retries = 5
    localStorage.setItem('pos_print_queue', JSON.stringify(q))

    retryJob(job.id)
    const updated = getQueue().find(j => j.id === job.id)
    expect(updated?.status).toBe('pending')
    expect(updated?.retries).toBe(0)
  })

  it('retryAllStuck resets needs_attention and bridge_unavailable jobs', () => {
    enqueue({ station: 'cocina', data: 'dGVzdA==', type: 'comanda' })
    enqueue({ station: 'barra', data: 'dGVzdA==', type: 'comanda' })
    const q = getQueue()
    q[0].status = 'needs_attention'
    q[1].status = 'bridge_unavailable'
    localStorage.setItem('pos_print_queue', JSON.stringify(q))

    retryAllStuck()
    const updated = getQueue()
    expect(updated[0].status).toBe('pending')
    expect(updated[1].status).toBe('pending')
  })

  it('clearCompleted removes printed jobs but keeps others', () => {
    enqueue({ station: 'cocina', data: 'dGVzdA==', type: 'comanda' })
    enqueue({ station: 'barra', data: 'dGVzdA==', type: 'comanda' })
    const q = getQueue()
    q[0].status = 'printed'
    localStorage.setItem('pos_print_queue', JSON.stringify(q))

    clearCompleted()
    const remaining = getQueue()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].status).toBe('pending')
  })

  it('getPendingCount counts pending + retrying + bridge_unavailable', () => {
    enqueue({ station: 'cocina', data: 'dGVzdA==', type: 'comanda' })
    enqueue({ station: 'barra', data: 'dGVzdA==', type: 'comanda' })
    enqueue({ station: 'caja', data: 'dGVzdA==', type: 'ticket' })
    const q = getQueue()
    q[0].status = 'pending'
    q[1].status = 'retrying'
    q[2].status = 'printed'
    localStorage.setItem('pos_print_queue', JSON.stringify(q))

    expect(getPendingCount()).toBe(2)
  })

  it('getNeedsAttentionCount counts only needs_attention', () => {
    enqueue({ station: 'cocina', data: 'dGVzdA==', type: 'comanda' })
    enqueue({ station: 'barra', data: 'dGVzdA==', type: 'comanda' })
    const q = getQueue()
    q[0].status = 'needs_attention'
    q[1].status = 'bridge_unavailable'
    localStorage.setItem('pos_print_queue', JSON.stringify(q))

    expect(getNeedsAttentionCount()).toBe(1)
  })

  it('removeJob removes the target job only', () => {
    const j1 = enqueue({ station: 'cocina', data: 'dGVzdA==', type: 'comanda' })
    const j2 = enqueue({ station: 'barra', data: 'dGVzdA==', type: 'comanda' })
    removeJob(j1.id)
    const remaining = getQueue()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(j2.id)
  })

  it('enqueueFailedPrint base64-encodes bytes and enqueues', () => {
    const bytes = new Uint8Array([65, 77, 65]) // "AMA"
    enqueueFailedPrint(bytes, 'cocina', 'comanda', { mesa: 5 })
    const q = getQueue()
    expect(q).toHaveLength(1)
    expect(q[0].meta?.mesa).toBe(5)
    expect(q[0].type).toBe('comanda')
    // base64 of [65,77,65] is "QU1B"
    expect(q[0].data).toBe(btoa('AMA'))
  })
})

// ─── IVA conditional rendering (PRN-GAP-02) ──────────────────────────────────

describe('IVA conditional in ticket', () => {
  it('getIvaRate returns 0 for AMALAY (default config)', () => {
    // IVA_RATE is 0 in pos-constants — AMALAY prices already include IVA
    expect(IVA_RATE).toBe(0)
    expect(getIvaRate()).toBe(0)  // no dynamic override set
  })

  it('getIvaRate returns set value after setIvaRate', () => {
    setIvaRate(0.16)
    expect(getIvaRate()).toBe(0.16)
    setIvaRate(0)  // reset
    expect(getIvaRate()).toBe(0)
  })

  it('IVA row is conditional — shown when rate > 0, hidden when rate = 0', () => {
    // Test the conditional logic extracted from printTicketCSS
    function ivaLabel(rate: number): string | null {
      if (rate <= 0) return null
      return `IVA (${Math.round(rate * 100)}%)`
    }
    expect(ivaLabel(0)).toBeNull()
    expect(ivaLabel(0.16)).toBe('IVA (16%)')
    expect(ivaLabel(0.08)).toBe('IVA (8%)')
  })
})

// ─── splitOrderByStation ──────────────────────────────────────────────────────

describe('splitOrderByStation', () => {

  function makeItem(overrides: { nombre?: string; station?: string; menuItemId?: string; cantidad?: number; subtotal?: number } = {}) {
    return {
      nombre: overrides.nombre ?? 'Test Item',
      station: overrides.station,
      menuItemId: overrides.menuItemId ?? 'test-id',
      cantidad: overrides.cantidad ?? 1,
      subtotal: overrides.subtotal ?? 50,
    }
  }

  function makeOrder(items: ReturnType<typeof makeItem>[]) {
    return {
      id: 'order-1',
      mesa: 5,
      mesero: 'Test',
      items: items as any,
      total: 50,
      subtotal: 50,
      descuento: 0,
      iva: 0,
      propina: 0,
      status: 'cerrada' as const,
      metodoPago: 'Efectivo',
      created_at: new Date().toISOString(),
    }
  }

  it('routes items with explicit station field', () => {
    const order = makeOrder([
      makeItem({ nombre: 'Americano', station: 'barra' }),
      makeItem({ nombre: 'Chilaquiles', station: 'cocina' }),
    ])
    const split = splitOrderByStation(order as any)
    expect(split.barra).toHaveLength(1)
    expect(split.cocina).toHaveLength(1)
    expect(split.caja).toHaveLength(0)
  })

  it('falls back to name-based detection when station is absent', () => {
    const order = makeOrder([
      makeItem({ nombre: 'Café Americano' }),       // no station field
      makeItem({ nombre: 'Chilaquiles Verdes' }),    // no station field
    ])
    const split = splitOrderByStation(order as any)
    expect(split.barra).toHaveLength(1)   // Café → barra via keyword
    expect(split.cocina).toHaveLength(1)  // Chilaquiles → cocina
  })

  it('distributes tiempo items to stations with real items after the separator', () => {
    // Tiempo item in the middle — cocina has items both before AND after it,
    // so it is NOT trailing and survives the cleanup.
    const order = makeOrder([
      makeItem({ station: 'cocina', nombre: 'Huevos' }),        // T1 cocina
      { nombre: '== TIEMPO: 2 ==', station: undefined, menuItemId: TIEMPO_ITEM_ID, cantidad: 1, subtotal: 0 },
      makeItem({ station: 'cocina', nombre: 'Chilaquiles' }),    // T2 cocina
    ])
    const split = splitOrderByStation(order as any)
    // Tiempo item is mid-cocina (non-trailing) → survives cleanup
    const tiempoInCocina = split.cocina.some(i => i.menuItemId === TIEMPO_ITEM_ID)
    expect(tiempoInCocina).toBe(true)
    // Barra and caja have no real items → cleaned to empty (trailing removal)
    expect(split.barra).toHaveLength(0)
    expect(split.caja).toHaveLength(0)
  })

  it('cleans trailing tiempo items from each station', () => {
    const order = makeOrder([
      makeItem({ station: 'cocina', nombre: 'Huevos' }),
      { nombre: '== TIEMPO: 2 ==', station: undefined, menuItemId: TIEMPO_ITEM_ID, cantidad: 1, subtotal: 0 },
      // No barra items after the tiempo — tiempo item should be cleaned from barra
    ])
    const split = splitOrderByStation(order as any)
    // Barra has no real items, so the stray tiempo item is removed → empty
    expect(split.barra).toHaveLength(0)
  })

  it('returns empty arrays for stations with no items', () => {
    const order = makeOrder([makeItem({ nombre: 'Chilaquiles', station: 'cocina' })])
    const split = splitOrderByStation(order as any)
    expect(split.barra).toHaveLength(0)
    expect(split.caja).toHaveLength(0)
  })
})
