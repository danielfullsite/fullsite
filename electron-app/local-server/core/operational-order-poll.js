'use strict'

// Nunca publica una lista truncada como snapshot completo. El caller comparte
// su AbortSignal/deadline con autenticación, turno y todas estas páginas.
async function readOperationalOrders({ supabaseUrl, restaurantId, branchId, turnoId, headers, signal, fetchImpl = fetch, pageSize = 500, maxPages = 20 }) {
  if (!turnoId) return []
  const orders = []
  for (let page = 0; page < maxPages; page++) {
    signal?.throwIfAborted()
    const query = new URLSearchParams({
      client_id: `eq.${restaurantId}`, turno_id: `eq.${turnoId}`, select: '*',
      order: 'created_at.asc,id.asc', limit: String(pageSize), offset: String(page * pageSize),
    })
    if (branchId) query.set('location_id', `eq.${branchId}`)
    const response = await fetchImpl(`${supabaseUrl}/rest/v1/pos_orders?${query}`, { headers, signal })
    if (!response.ok) throw new Error(`Snapshot de órdenes incompleto: página ${page + 1}, HTTP ${response.status}`)
    const rows = await response.json()
    if (!Array.isArray(rows)) throw new Error(`Snapshot de órdenes inválido: página ${page + 1}`)
    orders.push(...rows)
    if (rows.length < pageSize) return orders
  }
  throw new Error(`Snapshot de órdenes excede el límite de ${maxPages * pageSize}; requiere reconciliación`)
}

module.exports = { readOperationalOrders }
