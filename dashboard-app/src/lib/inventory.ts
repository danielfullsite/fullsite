/**
 * Canonical manual inventory boundary. A single authenticated RPC commits the
 * movement ledger, stock, weighted cost and exact idempotency receipt together.
 * No REST write fallback. Unknown/lost responses remain unsuccessful until the
 * same immutable request is retried. Stock is currently tenant-wide; metadata
 * warehouse/location does not claim separate branch stock.
 * Contract: docs/architecture/INVENTORY-ATOMIC-2026-09-08.md
 */
import { inventoryRequestError, isExactInventoryReceipt, isInventoryReceiptAbsent } from './inventory-movement-contract'
import type { InventoryReceipt } from './inventory-movement-contract'
import { inventoryActorScope, retainInventoryIntent, releaseInventoryIntent } from './inventory-pending-intent'

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
  location_id?: string               // validated provenance; stock remains tenant-wide
}

export interface MovementResult {
  receipt?: InventoryReceipt
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

// ── Core function ─────────────────────────────────────────────────────

export async function recordMovement(req: MovementRequest): Promise<MovementResult> {
  const failure = (error: string): MovementResult => ({ success: false, movements_created: 0,
    stock_updates: 0, cost_updates: 0, errors: [error], was_duplicate: false, details: [] })
  const invalid = inventoryRequestError(req)
  if (invalid) return failure(invalid)
  // Freeze caller intent before awaiting auth/network; undefined optional fields
  // have the same representation in the request, receipt and retry comparison.
  let request: MovementRequest = JSON.parse(JSON.stringify(req))
  let token = getAuthToken()
  if (token === SUPABASE_KEY && typeof window !== 'undefined') {
    try { token = localStorage.getItem('pos_shift_token') || token } catch {}
  }
  const scope = inventoryActorScope(token, request.client_id)
  if (!scope) return failure('INVENTORY_AUTH_REQUIRED')
  let fresh: boolean, sameIntent: boolean
  try {
    const pending = await retainInventoryIntent(scope, request)
    request = pending.request; fresh = pending.fresh; sameIntent = pending.sameIntent
  } catch (error) {
    return failure(error instanceof Error ? error.message : 'INVENTORY_DURABLE_STORAGE_REQUIRED')
  }
  try {
    const response = await fetch('/api/pos/inventory-movement' + (sameIntent ? '' : '?receipt_only=true'), {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`,
        'x-fullsite-tenant': request.client_id, 'x-fullsite-inventory-actor': JSON.parse(scope)[2] },
      body: JSON.stringify(request), signal: AbortSignal.timeout(20_000),
    })
    const receipt: unknown = await response.json()
    if (!response.ok) {
      const code = receipt && typeof receipt === 'object' && 'error' in receipt && typeof receipt.error === 'string'
        ? receipt.error : `INVENTORY_HTTP_${response.status}`
      const outcome = receipt && typeof receipt === 'object' && 'outcome' in receipt ? receipt.outcome : undefined
      // A database rejection settles the intent. An auth/validation rejection
      // settles only a fresh attempt: after ambiguity, that response cannot
      // prove a previous call did not commit before the token expired.
      if (sameIntent && (outcome === 'rejected' || (fresh && outcome === 'not_executed'))) await releaseInventoryIntent(scope, request)
      return failure(code)
    }
    // A changed form may discover an already committed original, but must never
    // execute that old payload or infer cancellation from an absent receipt.
    if (!sameIntent && isInventoryReceiptAbsent(receipt, request)) return failure('INVENTORY_PENDING_OTHER_OPERATION')
    if (!isExactInventoryReceipt(receipt, request)) return failure('INVENTORY_RECEIPT_MISMATCH')
    const verifiedScope = JSON.stringify([receipt.actor.client_id, receipt.actor.auth_type, receipt.actor.id])
    if (verifiedScope !== scope) return failure('INVENTORY_RECEIPT_MISMATCH')
    await releaseInventoryIntent(scope, request)
    if (!sameIntent) return { ...failure('INVENTORY_PREVIOUS_OPERATION_CONFIRMED_REVIEW_CURRENT'), receipt }
    return { success: true, movements_created: receipt.movements_created,
      stock_updates: receipt.stock_updates, cost_updates: receipt.cost_updates,
      errors: [], was_duplicate: receipt.was_duplicate, details: receipt.details, receipt }
  } catch {
    // The database may have committed before a response was lost. Never invent
    // failure compensation or a second key: retry the identical request.
    return failure(sameIntent ? 'INVENTORY_RESULT_UNKNOWN_RETRY_SAME_KEY' : 'INVENTORY_PENDING_OTHER_OPERATION')
  }
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
