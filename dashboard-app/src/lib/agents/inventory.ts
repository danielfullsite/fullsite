/**
 * Inventory Agent
 *
 * Detecta: faltantes, stock bajo mínimo, artículos auto-86, consumo inesperado.
 *
 * Inputs:  pos_inventory_products, pos_ingredients (fallback)
 * Outputs: AgentEvent[]
 * Freq:    Cada hora
 */
import type { AgentEvent } from './types'

interface InventoryProduct {
  id: string
  name: string
  unit: string
  stock: number
  reorder_point: number
  category: string | null
  cost_per_unit: number | null
  active: boolean
}

interface Ingredient {
  id: string
  name: string
  unit: string
  cost_per_unit: number | null
  category: string | null
  active: boolean
}

interface InventoryRow {
  ingredient_id: string
  stock: number
  reorder_point: number | null
}

export async function runInventoryAgent(
  clientId: string,
  sbGet: <T>(table: string, query: string) => Promise<T[]>,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  const now = Date.now()

  // Try pos_inventory_products first (newer multi-tenant table)
  let products: { name: string; unit: string; stock: number; reorder_point: number; category: string | null; cost_per_unit: number | null }[] = []

  try {
    const rows = await sbGet<InventoryProduct>(
      'pos_inventory_products',
      `client_id=eq.${encodeURIComponent(clientId)}&active=eq.true&reorder_point=gt.0&select=id,name,unit,stock,reorder_point,category,cost_per_unit&order=stock.asc&limit=200`,
    )
    products = rows.map(r => ({
      name: r.name,
      unit: r.unit,
      stock: r.stock ?? 0,
      reorder_point: r.reorder_point ?? 0,
      category: r.category,
      cost_per_unit: r.cost_per_unit,
    }))
  } catch {
    // Fallback: pos_ingredients + pos_inventory join
    try {
      const [ingredients, inventory] = await Promise.all([
        sbGet<Ingredient>(
          'pos_ingredients',
          `client_id=eq.${encodeURIComponent(clientId)}&active=eq.true&select=id,name,unit,cost_per_unit,category&limit=300`,
        ),
        sbGet<InventoryRow>(
          'pos_inventory',
          `client_id=eq.${encodeURIComponent(clientId)}&select=ingredient_id,stock,reorder_point&limit=300`,
        ),
      ])
      const invMap = new Map(inventory.map(r => [r.ingredient_id, r]))
      products = ingredients
        .map(ing => {
          const inv = invMap.get(ing.id)
          return {
            name: ing.name,
            unit: ing.unit,
            stock: inv?.stock ?? 0,
            reorder_point: inv?.reorder_point ?? 0,
            category: ing.category,
            cost_per_unit: ing.cost_per_unit,
          }
        })
        .filter(p => p.reorder_point > 0)
    } catch {
      return events // No inventory data available
    }
  }

  if (products.length === 0) return events

  // ── 1. Out of stock (auto-86) ────────────────────────────────────────────
  const outOfStock = products.filter(p => p.stock <= 0)
  if (outOfStock.length > 0) {
    const names = outOfStock.slice(0, 5).map(p => p.name).join(', ')
    const more = outOfStock.length > 5 ? ` y ${outOfStock.length - 5} más` : ''
    events.push({
      client_id: clientId,
      agent_id: 'inventory',
      type: 'out_of_stock',
      severity: 'critical',
      title: `${outOfStock.length} ingrediente${outOfStock.length > 1 ? 's' : ''} sin stock — auto-86 activo`,
      explanation: `Sin existencias: ${names}${more}. Los platillos que los requieren no se pueden preparar.`,
      evidence: {
        items: outOfStock.map(p => ({ name: p.name, unit: p.unit, stock: p.stock, category: p.category })),
        count: outOfStock.length,
      },
      suggested_action: 'Verificar en cocina si hay stock físico no registrado. Notificar a meseros para desactivar platillos afectados.',
      confidence: 0.95,
      status: 'new',
      expires_at: new Date(now + 4 * 60 * 60 * 1000).toISOString(),
    })
  }

  // ── 2. Below reorder point ───────────────────────────────────────────────
  const belowReorder = products.filter(p => p.stock > 0 && p.stock <= p.reorder_point)
  if (belowReorder.length > 0) {
    const critical = belowReorder.filter(p => p.stock <= p.reorder_point * 0.5) // < 50% of minimum
    const warning  = belowReorder.filter(p => p.stock > p.reorder_point * 0.5)

    if (critical.length > 0) {
      const names = critical.slice(0, 4).map(p => `${p.name} (${p.stock.toFixed(1)} ${p.unit})`).join(', ')
      events.push({
        client_id: clientId,
        agent_id: 'inventory',
        type: 'critical_low_stock',
        severity: 'critical',
        title: `${critical.length} ingrediente${critical.length > 1 ? 's' : ''} en stock crítico`,
        explanation: `Stock muy por debajo del mínimo: ${names}${critical.length > 4 ? ` y ${critical.length - 4} más` : ''}. Se agotarán durante el servicio si no se reabasteció.`,
        evidence: {
          items: critical.map(p => ({ name: p.name, stock: p.stock, reorder_point: p.reorder_point, unit: p.unit })),
          count: critical.length,
        },
        suggested_action: 'Ordenar compra urgente o verificar con proveedor disponibilidad inmediata.',
        confidence: 0.95,
        status: 'new',
        expires_at: new Date(now + 8 * 60 * 60 * 1000).toISOString(),
      })
    }

    if (warning.length > 0 && warning.length <= 8) {
      const names = warning.slice(0, 4).map(p => p.name).join(', ')
      events.push({
        client_id: clientId,
        agent_id: 'inventory',
        type: 'low_stock',
        severity: 'warning',
        title: `${warning.length} ingrediente${warning.length > 1 ? 's' : ''} bajo el mínimo de reorden`,
        explanation: `${names}${warning.length > 4 ? ` y ${warning.length - 4} más` : ''} han bajado del punto de reorden. Considerar compra antes de que se agoten.`,
        evidence: {
          items: warning.slice(0, 8).map(p => ({ name: p.name, stock: p.stock, reorder_point: p.reorder_point, unit: p.unit })),
          count: warning.length,
        },
        suggested_action: 'Revisar OC sugerida o contactar proveedor.',
        confidence: 0.90,
        status: 'new',
        expires_at: new Date(now + 12 * 60 * 60 * 1000).toISOString(),
      })
    }
  }

  // ── 3. Near minimum (approaching reorder) ───────────────────────────────
  const nearMin = products.filter(
    p => p.stock > p.reorder_point && p.stock <= p.reorder_point * 1.5,
  )
  if (nearMin.length >= 3) {
    events.push({
      client_id: clientId,
      agent_id: 'inventory',
      type: 'approaching_minimum',
      severity: 'info',
      title: `${nearMin.length} ingredientes se acercan al mínimo de reorden`,
      explanation: `${nearMin.slice(0, 3).map(p => p.name).join(', ')}${nearMin.length > 3 ? ` y ${nearMin.length - 3} más` : ''} estarán bajo mínimo en el próximo turno si el consumo continúa al ritmo actual.`,
      evidence: {
        items: nearMin.slice(0, 6).map(p => ({ name: p.name, stock: p.stock, reorder_point: p.reorder_point, unit: p.unit })),
        count: nearMin.length,
      },
      suggested_action: 'Programar compra para mañana. Revisar el plan de menú del día.',
      confidence: 0.75,
      status: 'new',
      expires_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
    })
  }

  return events
}
