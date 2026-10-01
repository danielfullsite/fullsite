// Ordenes fantasma: un draft que se resucita solo.
//
// Caso real, AMALAY 2026-08-30, terminal Entrada: la Mesa 5 mostraba $1,784.08 de
// una orden que NO existia en Supabase (0 filas en pos_orders) y que venia desde
// agosto. Daniel: "sigue el bug de las ordenes que no deberian de estar".
//
// El bucle:
//   1. Al montar, orderItems se pre-llena de `pos_order_<mesa>` (TTL 8h).
//   2. El efecto de auto-guardado reescribia `pos_draft_<mesa>` con ts = Date.now().
//   3. loadMesaOrder ve 0 filas en la BD, borra pos_order_, y consulta el draft...
//      que acababa de rejuvenecer, asi que pasaba el TTL de 4h y se restauraba.
//   4. Restaurar dispara setOrderItems -> vuelve al paso 2.
//
// O sea: el TTL medía "desde la ultima vez que alguien ABRIO la mesa", no "desde
// que el mesero EDITO algo". En un restaurante donde tocan las mesas todo el dia,
// la orden no caducaba nunca.
//
// Estas pruebas ejercitan la regla de guardado sola, sin React: es la unica pieza
// que decide si el ts avanza.

import { describe, it, expect, beforeEach } from 'vitest'

const TTL_MS = 4 * 60 * 60 * 1000 // el TTL de restauracion en page.tsx

interface Item { id: string; nombre: string; cantidad: number }
interface Draft { items: Item[]; orderId: string; mesero: string; personas: number; ts: number }

const store = new Map<string, string>()
const ls = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
}

/**
 * Réplica exacta de la regla del efecto de auto-guardado en app/pos/page.tsx.
 * El ts sólo avanza cuando el contenido cambia de verdad.
 */
function guardarDraft(mesa: number, items: Item[], orderId: string, mesero: string, personas: number, ahora: number) {
  const payload = { items, orderId, mesero, personas }
  let ts = ahora
  const prevRaw = ls.getItem(`pos_draft_${mesa}`)
  if (prevRaw) {
    const prev = JSON.parse(prevRaw)
    const same = prev && typeof prev.ts === 'number' &&
      JSON.stringify({ items: prev.items, orderId: prev.orderId, mesero: prev.mesero, personas: prev.personas }) === JSON.stringify(payload)
    if (same) ts = prev.ts
  }
  ls.setItem(`pos_draft_${mesa}`, JSON.stringify({ ...payload, ts }))
}

const leer = (mesa: number): Draft => JSON.parse(ls.getItem(`pos_draft_${mesa}`)!)
const vigente = (d: Draft, ahora: number) => d.items.length > 0 && !!d.ts && ahora - d.ts < TTL_MS

const ITEMS: Item[] = [{ id: 'a', nombre: 'CEVICHE DE ATUN', cantidad: 1 }]

describe('Draft del POS — el ts mide edicion, no apertura de mesa', () => {
  beforeEach(() => store.clear())

  it('una edicion real sí avanza el ts — el mesero no pierde su orden', () => {
    const t0 = 1_000_000
    guardarDraft(5, ITEMS, 'o1', 'Aldo', 2, t0)
    // 3h despues el mesero AGREGA un platillo
    const t1 = t0 + 3 * 60 * 60 * 1000
    guardarDraft(5, [...ITEMS, { id: 'b', nombre: 'HEINEKEN', cantidad: 1 }], 'o1', 'Aldo', 2, t1)
    expect(leer(5).ts).toBe(t1)
    // y 3h mas tarde sigue vigente, porque el reloj se reinicio con la edicion
    expect(vigente(leer(5), t1 + 3 * 60 * 60 * 1000)).toBe(true)
  })

  it('reabrir la mesa sin tocar nada NO avanza el ts', () => {
    const t0 = 1_000_000
    guardarDraft(5, ITEMS, 'o1', 'Aldo', 2, t0)
    // alguien abre la mesa 3 veces a lo largo del dia; el efecto corre cada vez
    for (const t of [t0 + 3600_000, t0 + 7200_000, t0 + 10800_000]) {
      guardarDraft(5, ITEMS, 'o1', 'Aldo', 2, t)
    }
    expect(leer(5).ts).toBe(t0) // intacto
  })

  it('REGRESION: el draft caduca a las 4h aunque abran la mesa cada hora', () => {
    const t0 = 1_000_000
    guardarDraft(5, ITEMS, 'o1', 'Aldo', 2, t0)
    // El bucle del bug: cada apertura re-guardaba y reiniciaba el TTL.
    let ahora = t0
    for (let i = 0; i < 20; i++) {
      ahora += 60 * 60 * 1000 // una apertura por hora, 20 horas
      guardarDraft(5, ITEMS, 'o1', 'Aldo', 2, ahora)
    }
    // Antes del fix esto era `true` para siempre. Ahora caduca.
    expect(vigente(leer(5), ahora)).toBe(false)
  })

  it('el fantasma de AMALAY: 20 dias de aperturas y sigue caducado', () => {
    const t0 = 1_000_000
    guardarDraft(5, ITEMS, 'o1', 'Aldo Ruiz Ramirez', 2, t0)
    const veinteDias = t0 + 20 * 24 * 60 * 60 * 1000
    guardarDraft(5, ITEMS, 'o1', 'Aldo Ruiz Ramirez', 2, veinteDias)
    expect(vigente(leer(5), veinteDias)).toBe(false)
  })

  it('cambiar de mesero cuenta como edicion', () => {
    const t0 = 1_000_000
    guardarDraft(5, ITEMS, 'o1', 'Aldo', 2, t0)
    const t1 = t0 + 60_000
    guardarDraft(5, ITEMS, 'o1', 'Daniel', 2, t1)
    expect(leer(5).ts).toBe(t1)
  })

  it('cambiar la cantidad de un platillo cuenta como edicion', () => {
    const t0 = 1_000_000
    guardarDraft(5, ITEMS, 'o1', 'Aldo', 2, t0)
    const t1 = t0 + 60_000
    guardarDraft(5, [{ id: 'a', nombre: 'CEVICHE DE ATUN', cantidad: 2 }], 'o1', 'Aldo', 2, t1)
    expect(leer(5).ts).toBe(t1)
  })
})
