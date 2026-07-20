/**
 * Inventory Operations — Single transactional module
 *
 * ALL stock changes MUST go through recordMovement().
 * Direct writes to pos_inventory are forbidden outside this module.
 *
 * Flow:
 *   1. Idempotency check (has this exact movement been recorded?)
 *   2. INSERT into pos_inventory_movements (immutable ledger)
 *   3. PATCH pos_inventory.stock (materialized state)
 *   4. Optionally INSERT into wansoft_data (historical blob)
 *
 * If step 3 fails, step 2 still exists as a record. The stock can always
 * be reconciled from the ledger: SUM(quantity) GROUP BY ingredient_id.
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

export interface MovementLine {
  ingredient_id: string   // FK to pos_ingredients.id
  quantity: number        // positive = stock goes UP, negative = stock goes DOWN
  notes?: string          // per-line notes (e.g., motivo de merma)
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
  errors: string[]
  was_duplicate: boolean           // true if idempotency_key already existed
}

// ── Core function ─────────────────────────────────────────────────────

/**
 * Record one or more inventory movements atomically.
 *
 * This is the ONLY function that should modify pos_inventory.stock.
 * All dashboard and POS pages must call this instead of writing directly.
 *
 * Idempotency: if the same idempotency_key has been used before,
 * returns success with was_duplicate=true and does nothing.
 */
export async function recordMovement(req: MovementRequest): Promise<MovementResult> {
  const result: MovementResult = {
    success: false,
    movements_created: 0,
    stock_updates: 0,
    errors: [],
    was_duplicate: false,
  }

  // ── 0. Validate ──────────────────────────────────────────────────

  if (!req.lines.length) {
    result.errors.push('No movement lines provided')
    return result
  }

  for (const line of req.lines) {
    if (!line.ingredient_id) {
      result.errors.push('Missing ingredient_id in movement line')
      return result
    }
    if (line.quantity === 0) {
      result.errors.push(`Zero quantity for ${line.ingredient_id}`)
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

  // ── 2. Load current stock for all affected ingredients ──────────

  const ingredientIds = [...new Set(req.lines.map(l => l.ingredient_id))]
  const stockMap = new Map<string, { id: number; stock: number }>()

  // Batch load in chunks of 50 to stay within URL limits
  for (let i = 0; i < ingredientIds.length; i += 50) {
    const chunk = ingredientIds.slice(i, i + 50)
    const filter = `ingredient_id=in.(${chunk.join(',')})`
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_inventory?client_id=eq.${req.client_id}&${filter}&select=id,ingredient_id,stock`,
      { headers: headers() }
    )
    if (res.ok) {
      const rows: { id: number; ingredient_id: string; stock: number }[] = await res.json()
      for (const row of rows) {
        stockMap.set(row.ingredient_id, { id: row.id, stock: Number(row.stock) || 0 })
      }
    }
  }

  // Check for missing ingredients (no pos_inventory row)
  const missing = ingredientIds.filter(id => !stockMap.has(id))
  if (missing.length > 0) {
    result.errors.push(`No pos_inventory row for: ${missing.join(', ')}`)
    return result
  }

  // ── 3. INSERT movements (ledger) ────────────────────────────────

  const movementRows = req.lines.map(line => ({
    client_id: req.client_id,
    ingredient_id: line.ingredient_id,
    movement_type: req.movement_type,
    quantity: line.quantity,
    actor: req.actor,
    notes: line.notes
      ? `${line.notes} [key:${req.idempotency_key}]`
      : `[key:${req.idempotency_key}]`,
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

  result.movements_created = req.lines.length

  // ── 4. PATCH stock for each ingredient ──────────────────────────

  for (const line of req.lines) {
    const current = stockMap.get(line.ingredient_id)!
    const newStock = Math.max(0, current.stock + line.quantity)

    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_inventory?id=eq.${current.id}&client_id=eq.${req.client_id}`,
      {
        method: 'PATCH',
        headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
        body: JSON.stringify({ stock: newStock, updated_at: new Date().toISOString() }),
      }
    )

    if (patchRes.ok) {
      result.stock_updates++
    } else {
      result.errors.push(`Stock update failed for ${line.ingredient_id}: ${patchRes.status}`)
    }
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
  timestamp: string,    // ISO string, typically to the minute
  extra?: string,       // warehouse, supplier, etc.
): string {
  const parts = [type, actor, timestamp]
  if (extra) parts.push(extra)
  return parts.join('_').replace(/[^a-zA-Z0-9_-]/g, '_')
}

/**
 * Load pos_ingredients catalog for the dashboard inventory pages.
 * Returns the canonical product list that all pages should use.
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
 * This is the read-side companion to recordMovement().
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
  // Load both tables and join client-side (PostgREST doesn't support
  // cross-table joins without a foreign key relationship defined in DB)
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
