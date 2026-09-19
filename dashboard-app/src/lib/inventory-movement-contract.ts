import type { MovementRequest, MovementResult } from './inventory'

/** Manual inventory only. Sales depletion and paired transfers need their own
 * source receipt; a browser-supplied type cannot authorize those operations. */
export const MANUAL_MOVEMENT_TYPES = ['entry', 'invoice_entry', 'restock', 'waste', 'adjustment', 'return'] as const
const entries = new Set(['entry', 'invoice_entry', 'restock'])
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9

export function inventoryRequestError(input: unknown): string | null {
  if (!object(input) || !text(input.client_id, 200) || !text(input.actor, 200) || !text(input.idempotency_key, 240)) return 'INVENTORY_INVALID_REQUEST'
  if (Object.keys(input).some(k => !['client_id', 'actor', 'idempotency_key', 'movement_type', 'lines', 'metadata', 'location_id'].includes(k))) return 'INVENTORY_INVALID_REQUEST'
  if (!(MANUAL_MOVEMENT_TYPES as readonly unknown[]).includes(input.movement_type)) return 'INVENTORY_SOURCE_RECEIPT_REQUIRED'
  if (input.location_id !== undefined && !text(input.location_id, 200)) return 'INVENTORY_INVALID_LOCATION'
  if (input.metadata !== undefined && !object(input.metadata)) return 'INVENTORY_INVALID_METADATA'
  if (entries.has(String(input.movement_type)) && object(input.metadata) && input.metadata.cfdi_uuid !== undefined
    && (typeof input.metadata.cfdi_uuid !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(input.metadata.cfdi_uuid))) return 'INVENTORY_INVALID_INVOICE_ID'
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 500) return 'INVENTORY_INVALID_LINES'
  for (const line of input.lines) {
    if (!object(line) || Object.keys(line).some(k => !['ingredient_id', 'quantity', 'unit_cost', 'notes'].includes(k)) || !text(line.ingredient_id, 200) || !number(line.quantity) || line.quantity === 0) return 'INVENTORY_INVALID_LINE'
    if (entries.has(String(input.movement_type)) && line.quantity < 0) return 'INVENTORY_INVALID_DIRECTION'
    if (['waste', 'return'].includes(String(input.movement_type)) && line.quantity > 0) return 'INVENTORY_INVALID_DIRECTION'
    if (line.unit_cost !== undefined && (!number(line.unit_cost) || line.unit_cost < 0)) return 'INVENTORY_INVALID_COST'
    if (!entries.has(String(input.movement_type)) && line.unit_cost !== undefined && line.unit_cost !== 0) return 'INVENTORY_INVALID_COST'
    if (line.notes !== undefined && (typeof line.notes !== 'string' || line.notes.length > 2000)) return 'INVENTORY_INVALID_NOTES'
  }
  try { if (JSON.stringify(input).length > 256_000) return 'INVENTORY_REQUEST_TOO_LARGE' } catch { return 'INVENTORY_INVALID_REQUEST' }
  return null
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (object(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
  return JSON.stringify(value)
}

export interface InventoryReceipt {
  version: 1
  committed: true
  operation_id: string
  client_id: string
  idempotency_key: string
  stock_scope: 'tenant'
  request_echo: MovementRequest
  actor: { client_id: string; id: string; name: string; role: string; auth_type: string }
  movements_created: number
  stock_updates: number
  cost_updates: number
  was_duplicate: boolean
  details: (MovementResult['details'][number] & { movement_id: string; quantity: number })[]
}

export function isInventoryReceiptAbsent(value: unknown, request: MovementRequest): value is {
  version: 1; found: false; client_id: string; idempotency_key: string; request_echo: MovementRequest; actor: InventoryReceipt['actor']
} {
  return object(value) && value.version === 1 && value.found === false && value.client_id === request.client_id
    && value.idempotency_key === request.idempotency_key && canonical(value.request_echo) === canonical(request)
    && object(value.actor) && value.actor.client_id === request.client_id && text(value.actor.id, 200)
}

/** An HTTP 200, a generic ok, or a receipt for another command is not success. */
export function isExactInventoryReceipt(value: unknown, request: MovementRequest): value is InventoryReceipt {
  if (!object(value) || value.version !== 1 || value.committed !== true || value.stock_scope !== 'tenant' || typeof value.was_duplicate !== 'boolean') return false
  if (!text(value.operation_id, 36) || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value.operation_id)) return false
  if (value.client_id !== request.client_id || value.idempotency_key !== request.idempotency_key || canonical(value.request_echo) !== canonical(request)) return false
  if (!object(value.actor) || value.actor.client_id !== request.client_id || !text(value.actor.id, 200) || typeof value.actor.name !== 'string'
    || !['gerente', 'admin', 'dueño'].includes(String(value.actor.role)) || !['shift_token', 'supabase_session'].includes(String(value.actor.auth_type))) return false
  if (value.movements_created !== request.lines.length || value.stock_updates !== new Set(request.lines.map(l => l.ingredient_id)).size || !Number.isInteger(value.cost_updates) || (value.cost_updates as number) < 0 || (value.cost_updates as number) > (value.stock_updates as number)) return false
  if (!Array.isArray(value.details) || value.details.length !== request.lines.length) return false
  const ids = new Set<string>()
  const balances = new Map<string, { stock: number; cost: number }>(), changedCosts = new Set<string>()
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-9, Math.abs(a) * Number.EPSILON * 4)
  for (let i = 0; i < value.details.length; i++) {
    const d: unknown = value.details[i], line = request.lines[i]
    if (!object(d) || d.ingredient_id !== line.ingredient_id || d.quantity !== line.quantity || typeof d.movement_id !== 'string' || !/^[1-9][0-9]*$/.test(d.movement_id) || ids.has(d.movement_id)) return false
    ids.add(d.movement_id)
    if (['stock_before', 'stock_after', 'cost_before', 'cost_after'].some(k => typeof d[k] !== 'number' || !Number.isFinite(d[k]) || (d[k] as number) < 0)) return false
    const expected = (d.stock_before as number) + line.quantity
    if (!close(expected, d.stock_after as number)) return false
    const previous = balances.get(line.ingredient_id)
    if (previous && (!close(previous.stock, d.stock_before as number) || !close(previous.cost, d.cost_before as number))) return false
    const expectedCost = entries.has(request.movement_type) && (line.unit_cost ?? 0) > 0
      ? ((d.stock_before as number) * (d.cost_before as number) + line.quantity * line.unit_cost!) / (d.stock_after as number)
      : d.cost_before as number
    if (!close(expectedCost, d.cost_after as number)) return false
    if (d.cost_before !== d.cost_after) changedCosts.add(line.ingredient_id)
    balances.set(line.ingredient_id, { stock: d.stock_after as number, cost: d.cost_after as number })
  }
  return value.cost_updates === changedCosts.size
}
