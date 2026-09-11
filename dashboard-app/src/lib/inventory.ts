import { freezeInventoryMovement, resolvePendingMovement, readPendingMovement } from './inventory-pending'

/**
 * Inventory mutations commit the exact operation receipt, ledger, stock and
 * weighted-average entry cost in one backend transaction. Reuse the same
 * idempotency_key and request after an uncertain response; there is no direct
 * REST fallback. Actor and tenant authority are verified on the server.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/**
 * Token del usuario logueado (JWT) para que RLS scope por SU tenant. Antes se usaba
 * la anon key cruda y las tablas pos_inventory/pos_ingredients (RLS solo-authenticated)
 * devolvían 0 filas salvo que el fetch-patch global la subiera al JWT. Leerlo aquí
 * directo blinda la página de Inventario para el usuario real (Billy ve sus insumos)
 * sin depender del patch. Cae a la anon key en SSR o si no hay sesión.
 */
function getAuthToken(): string {
  if (typeof window === 'undefined') return SUPABASE_KEY
  try {
    const hostname = new URL(SUPABASE_URL).hostname.split('.')[0]
    const stored = localStorage.getItem(`sb-${hostname}-auth-token`)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (parsed?.access_token) return parsed.access_token
    }
  } catch {}
  return SUPABASE_KEY
}

const headers = (extra?: Record<string, string>) => ({
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${getAuthToken()}`,
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
  | 'underflow_prevented'  // Alert: stock would have gone negative

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

// ── Transactional write contract ──────────────────────────────────────

export async function recordMovement(req: MovementRequest): Promise<MovementResult> {
  const failed = (message: string): MovementResult => ({ success: false, movements_created: 0,
    stock_updates: 0, cost_updates: 0, errors: [message], was_duplicate: false, details: [] })
  if (!req || !Array.isArray(req.lines) || !req.lines.length || !req.idempotency_key?.trim()) return failed('No movement lines or operation identity provided')
  if (req.lines.some(line => !line || !line.ingredient_id || !Number.isFinite(line.quantity) || line.quantity === 0 ||
    (line.unit_cost !== undefined && (!Number.isFinite(line.unit_cost) || line.unit_cost < 0)))) return failed('Invalid movement quantity or unit cost')
  const durable = typeof window !== 'undefined'
  if (durable) {
    try { req = await freezeInventoryMovement(req) } catch (error) { return failed(error instanceof Error ? error.message : 'INVENTORY_STORAGE_UNAVAILABLE') }
  }
  // Kiosk shift tokens and dashboard JWTs use the same authenticated endpoint.
  // The tenant hint selects a membership; it is verified by withPOSAuth.
  let token = getAuthToken()
  if (typeof window !== 'undefined') {
    try { token = localStorage.getItem('pos_shift_token') || token } catch {}
  }
  try {
    const response = await fetch('/api/pos/inventory/movement', {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        ...(token && token !== SUPABASE_KEY ? { Authorization: `Bearer ${token}` } : {}),
        'x-fullsite-tenant': req.client_id }, body: JSON.stringify(req),
    })
    const result = await response.json()
    if (!response.ok) {
      // These SQL errors prove this exact request rolled back. Authentication,
      // conflicting keys and network errors never authorize forgetting intent.
      // MOVEMENT_KEY_REUSED y LEGACY_MOVEMENT_REQUIRES_RECONCILIATION NO estan aqui a
      // proposito (contrato de inventory-pending.test): una llave en conflicto
      // prueba que ESTA request no aplicara, pero no autoriza olvidar lo que el
      // operador quiso capturar. Esa intencion la resuelve una persona desde la
      // recuperacion (descartar o corregir), no un catch.
      const rejected = ['INVALID_MOVEMENT_IDENTITY','INVALID_MOVEMENT_TYPE','INVALID_LINES','INVALID_LINE',
        'INVALID_QUANTITY_OR_COST','INGREDIENT_SCOPE_CONFLICT','INVENTORY_ROW_REQUIRED',
        'AMBIGUOUS_INVENTORY','SUBRECIPE_HAS_NO_STOCK','INVALID_CURRENT_STOCK_OR_COST','INSUFFICIENT_STOCK']
      if (durable && response.status === 409 && rejected.includes(result.error)) await resolvePendingMovement(req)
      return failed(typeof result.error === 'string' ? result.error : 'INVENTORY_UNCONFIRMED')
    }
    if (result.success !== true || !Array.isArray(result.details) || !Array.isArray(result.errors) ||
      typeof result.was_duplicate !== 'boolean' || !Number.isSafeInteger(result.movements_created) ||
      !Number.isSafeInteger(result.stock_updates) || !Number.isSafeInteger(result.cost_updates)) return failed('INVENTORY_UNCONFIRMED')
    // The caller clears the durable intent only after it finishes the form.
    // A reload between receipt and UI confirmation must still recover this key.
    return result as MovementResult
  } catch {
    return failed('INVENTORY_UNCONFIRMED: reintenta el mismo movimiento con la misma identidad')
  }
}

/** Finish a confirmed form operation. Never clear another tab's pending request. */
export async function confirmarMovimientoInventario(clientId: string, idempotencyKey: string): Promise<void> {
  if (typeof window === 'undefined') return
  const pending = await readPendingMovement(clientId)
  if (pending?.request.idempotency_key === idempotencyKey) await resolvePendingMovement(pending.request)
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
