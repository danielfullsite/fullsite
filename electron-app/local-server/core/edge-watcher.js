'use strict'
// ─── Fullsite Edge Agent v0 ──────────────────────────────────────────────────
// El experto que vive en el BORDE. Corre DENTRO de Pedro (la caja), sobre el
// estado local. 100% offline y determinista: cero nube, cero LLM. Los agentes de
// la nube enriquecen cuando hay internet; esto vigila aunque no lo haya.
//
// Dirección: "el experto que vive en tu restaurante" — el POS es el sensor, esto
// es el primer pedacito del experto, viviendo en el sensor. Ver
// docs/product/DIRECTION-EXPERTO-EN-TU-RESTAURANTE.md (jugada 2).
//
// v0 = reglas deterministas sobre kds_orders:
//   1. comanda_parada — enviada/preparando > N min sin salir de cocina
//   2. cancelaciones  — pico de items cancelados en una ventana reciente
// evaluate() es PURA (recibe snapshot + now) → testable y sin efectos.
// v1 (futuro): baselines desde la nube (ritmo de venta), print falló, enriquecimiento LLM online.

function parseItems(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') { try { return JSON.parse(raw) || [] } catch (e) { return [] } }
  return []
}

// órdenes que siguen "en cocina" (ni listas, ni entregadas, ni canceladas)
const ACTIVE_IN_KITCHEN = new Set(['enviada', 'preparando'])

/**
 * @param {object} snapshot  state.toSnapshot() — usa snapshot.kds_orders
 * @param {object} opts       { slowMinutes=15, cancelWindowMinutes=30, cancelThreshold=3 }
 * @param {number} now        Date.now() (inyectable para tests)
 * @returns {Array} alerts    [{ id, kind, level, message, ... }]
 */
function evaluate(snapshot, opts, now) {
  opts = opts || {}
  const slowMin = Number(opts.slowMinutes) || 15
  const cancelWindowMin = Number(opts.cancelWindowMinutes) || 30
  const cancelThreshold = Number(opts.cancelThreshold) || 3
  const nowMs = Number(now) || Date.now()
  const orders = (snapshot && Array.isArray(snapshot.kds_orders)) ? snapshot.kds_orders : []
  const alerts = []

  // ── Regla 1 — comanda parada: lleva demasiado tiempo en cocina sin salir ──
  for (const o of orders) {
    if (!o || !ACTIVE_IN_KITCHEN.has(o.status)) continue
    const created = Date.parse(o.created_at)
    const mins = Math.floor((nowMs - (isNaN(created) ? nowMs : created)) / 60000)
    if (mins >= slowMin) {
      const label = (o.mesa != null && o.mesa !== '') ? `Mesa ${o.mesa}` : 'Para llevar'
      alerts.push({
        id: `slow:${o.id || o.order_id}`,
        kind: 'comanda_parada',
        level: mins >= slowMin * 2 ? 'critical' : 'warn',
        mesa: (o.mesa != null && o.mesa !== '') ? o.mesa : null,
        mesero: o.mesero || null,
        minutes: mins,
        message: `${label} lleva ${mins} min sin salir de cocina.`,
        since: o.created_at || null,
      })
    }
  }

  // ── Regla 2 — pico de cancelaciones en la ventana reciente ──
  let cancels = 0
  const cutoff = nowMs - cancelWindowMin * 60000
  for (const o of orders) {
    if (!o) continue
    const upd = Date.parse(o.updated_at || o.created_at)
    if (!isNaN(upd) && upd < cutoff) continue // fuera de la ventana → ignora
    for (const it of parseItems(o.items)) if (it && it.cancelled === true) cancels++
  }
  if (cancels >= cancelThreshold) {
    alerts.push({
      id: 'cancels',
      kind: 'cancelaciones',
      level: cancels >= cancelThreshold * 2 ? 'critical' : 'warn',
      count: cancels,
      message: `${cancels} cancelaciones en los últimos ${cancelWindowMin} min — conviene revisar.`,
    })
  }

  // críticas primero, luego por magnitud desc
  alerts.sort((a, b) =>
    ((a.level === 'critical' ? 0 : 1) - (b.level === 'critical' ? 0 : 1)) ||
    ((b.minutes || b.count || 0) - (a.minutes || a.count || 0))
  )
  return alerts
}

module.exports = { evaluate, parseItems, ACTIVE_IN_KITCHEN }
