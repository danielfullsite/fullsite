/**
 * Inventory Operations — Single transactional module
 *
 * ALL stock changes MUST go through recordMovement().
 * Direct writes to pos_inventory or pos_ingredients.cost_per_unit
 * are forbidden outside this module.
 *
 * Flow:
 *   1. Validate inputs (no negative qty on entries, no negative costs)
 *   2. Idempotency check (has this exact movement been recorded?)
 *   3. Load current stock + cost for all affected ingredients
 *   4. Detect anomalies (negative stock = halt)
 *   5. Calculate new stock and (for entries) new weighted average cost
 *   6. INSERT into pos_inventory_movements (immutable ledger) with full audit trail
 *   7. PATCH pos_inventory.stock + pos_ingredients.cost_per_unit (materialized state)
 *
 * If step 7 fails, step 6 still exists as a record. The stock can always
 * be reconciled from the ledger: SUM(quantity) GROUP BY ingredient_id.
 *
 * Cost Policy: Weighted Average Cost (Costo Promedio Ponderado)
 *   - stock > 0: new_cost = (stock * cost + qty * purchase_cost) / (stock + qty)
 *   - stock = 0: new_cost = purchase_cost
 *   - purchase_cost = 0: cost unchanged (entry without price)
 *   - stock < 0 (legacy anomaly): movement halted, requires manual fix
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const headers = (extra?: Record<string, string>) => ({
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  ...extra,
})

// ── Types ─────────────────────────────────────────────────────────────

export type MovementType =
  | 'entry'          // Entrada manual (dashboard)
  | 'invoice_entry'  // Entrada por CFDI (dashboard)
  | 'waste'          // Merma (dashboard or POS)
  | 'adjustment'     // Toma física (dashboard or POS)
  | 'deduction'      // Venta POS (auto-deducción por receta)
  | 'restock'        // Recepción de factura (POS)
  | 'transfer_out'   // Transferencia entre almacenes (salida)
  | 'transfer_in'    // Transferencia entre almacenes (entrada)
  | 'return'         // Devolución a proveedor
  | 'reversal'       // Reversa de un movimiento anterior

export interface MovementLine {
  ingredient_id: string       // FK to pos_ingredients.id
  quantity: number            // positive = stock goes UP, negative = stock goes DOWN
  unit_cost?: number          // purchase unit cost (for entries). Omit for waste/deduction.
  notes?: string              // per-line notes (e.g., motivo de merma, supplier info)
}

export interface MovementRequest {
  client_id: string
  movement_type: MovementType
  lines: MovementLine[]
  actor: string                    // who did this (user name, system, etc.)
  idempotency_key: string          // unique key to prevent double-submit
  metadata?: Record<string, unknown>  // extra context (warehouse, supplier, etc.)
}

export interface MovementResult {
  success: boolean
  movements_created: number
  stock_updates: number
  cost_updates: number
  errors: string[]
  was_duplicate: boolean
  details: {
    ingredient_id: string
    stock_before: number
    stock_after: number
    cost_before: number
    cost_after: number
  }[]
}

// ── Internals ─────────────────────────────────────────────────────────

interface InventoryRow {
  id: number
  ingredient_id: string
  stock: number
}

interface IngredientRow {
  id: string
  cost_per_unit: number
}

const ENTRY_TYPES: MovementType[] = ['entry', 'invoice_entry', 'restock', 'transfer_in']

// ── Core function ─────────────────────────────────────────────────────

export async function recordMovement(req: MovementRequest): Promise<MovementResult> {
  const result: MovementResult = {
    success: false,
    movements_created: 0,
    stock_updates: 0,
    cost_updates: 0,
    errors: [],
    was_duplicate: false,
    details: [],
  }

  // ── 0. Validate ──────────────────────────────────────────────────

  if (!req.lines.length) {
    result.errors.push('No movement lines provided')
    return result
  }

  const isEntry = ENTRY_TYPES.includes(req.movement_type)

  for (const line of req.lines) {
    if (!line.ingredient_id) {
      result.errors.push('Missing ingredient_id in movement line')
      return result
    }
    if (line.quantity === 0) {
      result.errors.push(`Zero quantity for ${line.ingredient_id}`)
      return result
    }
    // Entries must have positive quantity
    if (isEntry && line.quantity < 0) {
      result.errors.push(`Negative quantity on entry for ${line.ingredient_id}. Use 'return' or 'waste' for outflows.`)
      return result
    }
    // No negative costs ever
    if (line.unit_cost !== undefined && line.unit_cost < 0) {
      result.errors.push(`Negative unit_cost for ${line.ingredient_id}`)
      return result
    }
  }

  // ── 1. Idempotency check ────────────────────────────────────────

  const dupeCheck = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_inventory_movements?client_id=eq.${req.client_id}&notes=like.*${encodeURIComponent(req.idempotency_key)}*&limit=1`,
    { headers: headers() }
  )
  if (dupeCheck.ok) {
    const existing = await dupeCheck.json()
    if (existing.length > 0) {
      result.success = true
      result.was_duplicate = true
      return result
    }
  }

  // ── 2. Load current stock + cost for all affected ingredients ───

  const ingredientIds = [...new Set(req.lines.map(l => l.ingredient_id))]
  const stockMap = new Map<string, InventoryRow>()
  const costMap = new Map<string, number>()

  // Load pos_inventory (stock)
  for (let i = 0; i < ingredientIds.length; i += 50) {
    const chunk = ingredientIds.slice(i, i + 50)
    const filter = `ingredient_id=in.(${chunk.join(',')})`
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_inventory?client_id=eq.${req.client_id}&${filter}&select=id,ingredient_id,stock`,
      { headers: headers() }
    )
    if (res.ok) {
      const rows: InventoryRow[] = await res.json()
      for (const row of rows) {
        stockMap.set(row.ingredient_id, { ...row, stock: Number(row.stock) || 0 })
      }
    }
  }

  // Load pos_ingredients (cost) — only needed for entries with cost
  if (isEntry) {
    for (let i = 0; i < ingredientIds.length; i += 50) {
      const chunk = ingredientIds.slice(i, i + 50)
      const filter = `id=in.(${chunk.join(',')})`
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_ingredients?client_id=eq.${req.client_id}&${filter}&select=id,cost_per_unit`,
        { headers: headers() }
      )
      if (res.ok) {
        const rows: IngredientRow[] = await res.json()
        for (const row of rows) {
          costMap.set(row.id, Number(row.cost_per_unit) || 0)
        }
      }
    }
  }

  // Check for missing ingredients (no pos_inventory row)
  const missing = ingredientIds.filter(id => !stockMap.has(id))
  if (missing.length > 0) {
    result.errors.push(`No pos_inventory row for: ${missing.join(', ')}`)
    return result
  }

  // ── 3. Detect anomalies ─────────────────────────────────────────

  for (const line of req.lines) {
    const current = stockMap.get(line.ingredient_id)!
    if (current.stock < 0) {
      result.errors.push(
        `ANOMALY: ${line.ingredient_id} has negative stock (${current.stock}). ` +
        `Fix via manual adjustment before recording new movements.`
      )
      return result
    }
  }

  // ── 4. Calculate new stock and cost per line ────────────────────

  interface ComputedLine {
    ingredient_id: string
    quantity: number
    stock_before: number
    stock_after: number
    cost_before: number
    cost_after: number
    unit_cost: number
    notes: string
  }

  const computed: ComputedLine[] = []

  for (const line of req.lines) {
    const current = stockMap.get(line.ingredient_id)!
    const stockBefore = current.stock
    const costBefore = costMap.get(line.ingredient_id) ?? 0
    const purchaseCost = line.unit_cost ?? 0

    let stockAfter: number
    let costAfter = costBefore

    if (isEntry) {
      // Entries: stock goes up
      stockAfter = stockBefore + line.quantity

      // Weighted average cost calculation
      if (purchaseCost > 0) {
        if (stockBefore <= 0) {
          // Rule 2: stock=0, adopt new cost
          costAfter = purchaseCost
        } else {
          // Rule 1: weighted average
          costAfter = (stockBefore * costBefore + line.quantity * purchaseCost) / stockAfter
        }
      }
      // Rule 3: purchaseCost=0, cost unchanged (costAfter = costBefore)
    } else {
      // Waste, deduction, return, etc.: stock goes down (quantity is negative)
      stockAfter = Math.max(0, stockBefore + line.quantity)
    }

    computed.push({
      ingredient_id: line.ingredient_id,
      quantity: line.quantity,
      stock_before: stockBefore,
      stock_after: stockAfter,
      cost_before: costBefore,
      cost_after: costAfter,
      unit_cost: purchaseCost,
      notes: line.notes || '',
    })
  }

  // ── 5. INSERT movements (ledger) with full audit trail ──────────

  const movementRows = computed.map(c => ({
    client_id: req.client_id,
    ingredient_id: c.ingredient_id,
    movement_type: req.movement_type,
    quantity: c.quantity,
    actor: req.actor,
    notes: [
      c.notes,
      `stock:${c.stock_before}→${c.stock_after}`,
      c.unit_cost > 0 ? `cost:${c.cost_before}→${c.cost_after}@${c.unit_cost}` : null,
      `[key:${req.idempotency_key}]`,
    ].filter(Boolean).join(' '),
  }))

  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_inventory_movements`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify(movementRows),
  })

  if (!insertRes.ok) {
    const text = await insertRes.text()
    result.errors.push(`Failed to insert movements: ${insertRes.status} ${text.slice(0, 200)}`)
    return result
  }

  result.movements_created = computed.length

  // ── 6. PATCH stock + cost ───────────────────────────────────────

  for (const c of computed) {
    const current = stockMap.get(c.ingredient_id)!

    // Update stock
    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_inventory?id=eq.${current.id}&client_id=eq.${req.client_id}`,
      {
        method: 'PATCH',
        headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
        body: JSON.stringify({ stock: c.stock_after, updated_at: new Date().toISOString() }),
      }
    )

    if (patchRes.ok) {
      result.stock_updates++
    } else {
      result.errors.push(`Stock update failed for ${c.ingredient_id}: ${patchRes.status}`)
    }

    // Update cost (only if it changed)
    if (isEntry && c.cost_after !== c.cost_before && c.unit_cost > 0) {
      const costRes = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_ingredients?id=eq.${c.ingredient_id}&client_id=eq.${req.client_id}`,
        {
          method: 'PATCH',
          headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
          body: JSON.stringify({ cost_per_unit: c.cost_after }),
        }
      )

      if (costRes.ok) {
        result.cost_updates++
      } else {
        result.errors.push(`Cost update failed for ${c.ingredient_id}: ${costRes.status}`)
      }
    }

    result.details.push({
      ingredient_id: c.ingredient_id,
      stock_before: c.stock_before,
      stock_after: c.stock_after,
      cost_before: c.cost_before,
      cost_after: c.cost_after,
    })
  }

  result.success = result.movements_created > 0
  return result
}

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Generate a deterministic idempotency key from the operation context.
 * Same inputs = same key = second call is a no-op.
 */
export function makeIdempotencyKey(
  type: MovementType,
  actor: string,
  timestamp: string,
  extra?: string,
): string {
  const parts = [type, actor, timestamp]
  if (extra) parts.push(extra)
  return parts.join('_').replace(/[^a-zA-Z0-9_-]/g, '_')
}

/**
 * Load pos_ingredients catalog for the dashboard inventory pages.
 */
export async function loadIngredientsCatalog(clientId: string): Promise<{
  id: string
  name: string
  unit: string
  cost_per_unit: number
  category: string | null
  yield_factor: number
}[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_ingredients?client_id=eq.${clientId}&active=eq.true&order=name.asc&limit=2000&select=id,name,unit,cost_per_unit,category,yield_factor`,
    { headers: headers() }
  )
  if (!res.ok) return []
  return res.json()
}

/**
 * Load current stock levels joined with ingredient info.
 */
export async function loadInventoryWithStock(clientId: string): Promise<{
  ingredient_id: string
  name: string
  unit: string
  cost_per_unit: number
  category: string | null
  stock: number
  reorder_point: number
}[]> {
  const [ingredientsRes, inventoryRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/pos_ingredients?client_id=eq.${clientId}&active=eq.true&order=name.asc&limit=2000&select=id,name,unit,cost_per_unit,category`,
      { headers: headers() }
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/pos_inventory?client_id=eq.${clientId}&order=ingredient_id.asc&limit=2000&select=ingredient_id,stock,reorder_point`,
      { headers: headers() }
    ),
  ])

  if (!ingredientsRes.ok || !inventoryRes.ok) return []

  const ingredients: { id: string; name: string; unit: string; cost_per_unit: number; category: string | null }[] = await ingredientsRes.json()
  const inventory: { ingredient_id: string; stock: number; reorder_point: number }[] = await inventoryRes.json()

  const stockMap = new Map(inventory.map(i => [i.ingredient_id, i]))

  return ingredients
    .filter(ing => stockMap.has(ing.id))
    .map(ing => {
      const inv = stockMap.get(ing.id)!
      return {
        ingredient_id: ing.id,
        name: ing.name,
        unit: ing.unit,
        cost_per_unit: Number(ing.cost_per_unit) || 0,
        category: ing.category,
        stock: Number(inv.stock) || 0,
        reorder_point: Number(inv.reorder_point) || 0,
      }
    })
}
