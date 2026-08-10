// BUG-019-C — server-only secure public QR order creation.
//
// SECURITY CONTRACT:
// - Server-only (reads SUPABASE_SERVICE_KEY inside functions; never NEXT_PUBLIC_*).
// - The browser submits ONLY untrusted intent: token, menu_item_id, qty, modifier_ids,
//   notes, customer_name, personas, submission_id. Everything authoritative
//   (client_id/location_id/mesa, prices, tax, totals, status, waiter, turno) is
//   resolved/derived server-side. Any browser-supplied price/total is ignored.
// - Creates exactly one canonical pos_orders row with status='abierta'. NO kitchen
//   side effects: no inventory reconcile, no comanda_batch, no print job, no Bridge
//   ORDER_SENT, no KDS-sent. Staff review + the existing canonical send do all that later.
// - Idempotent by a deterministic order id derived from a validated high-entropy
//   submission_id, so a lost-response retry never creates a second order. Uses the
//   pos_orders PK as the boundary (NOT the print/comanda idempotency).
import { calcItemSubtotal } from './pos-calculations'
import { resolveTableByToken, PublicMenuConfigError } from './public-menu'
import type { ResolvedTable } from './table-token'
import type { OrderItem } from './pos-data'

export const MAX_QTY = 99
export const MAX_LINES = 100
export const MAX_NOTES = 280
export const MAX_NAME = 80
export const MAX_PERSONAS = 50

export interface SubmissionLine { menu_item_id: string; qty: number; modifier_ids?: string[]; notas?: string }
export interface PublicSubmission {
  submission_id: string
  items: SubmissionLine[]
  customer_name?: string
  personas?: number
}
export interface PublicOrderResult {
  status: number
  body: { order_id?: string; status?: string; mesa?: number; total?: number; error?: string }
}

interface MenuItemRow { id: string; client_id: string; name: string; price: number; active: boolean; category_id: string }
interface ModifierRow { id: string; client_id: string; group_id: string; name: string; price: number; active: boolean }

// submission_id: normalize a UUID / 32–64 hex to lowercase hex (dashes stripped).
export function normalizeSubmissionId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const hex = raw.toLowerCase().replace(/-/g, '')
  return /^[0-9a-f]{32,64}$/.test(hex) ? hex : null
}
// 'qr-' namespaces the id away from gen_random_uuid() order ids -> cannot collide with a real order.
export function publicOrderId(submissionHex: string): string { return `qr-${submissionHex}` }

// Pure repricing/validation. menuById/modsById are tenant-scoped rows; allowedGroups maps
// item_id -> Set(group_id) allowed for that item (item-level ∪ category-level). ivaRate is the
// tenant's canonical rate (clients.iva_rate, resolved server-side — NOT the client-side global,
// which is 0 outside the POS bootstrap). Returns server-canonical OrderItem[] + totals, or a
// rejection reason. Browser prices/totals are never read.
export function priceSubmission(
  lines: SubmissionLine[],
  menuById: Map<string, MenuItemRow>,
  modsById: Map<string, ModifierRow>,
  allowedGroups: Map<string, Set<string>>,
  genId: () => string,
  ivaRate: number,
): { ok: true; items: OrderItem[]; subtotal: number; iva: number; total: number } | { ok: false; error: string } {
  if (!Array.isArray(lines) || lines.length === 0) return { ok: false, error: 'empty_order' }
  if (lines.length > MAX_LINES) return { ok: false, error: 'too_many_lines' }

  const items: OrderItem[] = []
  for (const line of lines) {
    const item = menuById.get(line?.menu_item_id)
    if (!item || !item.active || item.price <= 0) return { ok: false, error: 'invalid_item' }
    const qty = line.qty
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return { ok: false, error: 'invalid_quantity' }

    const modIds = Array.isArray(line.modifier_ids) ? line.modifier_ids : []
    const allowed = allowedGroups.get(item.id) ?? new Set<string>()
    const modNames: string[] = []
    let precioExtra = 0
    for (const mid of modIds) {
      const mod = modsById.get(mid)
      // foreign / inactive / not valid for this item's groups -> reject
      if (!mod || !mod.active || !allowed.has(mod.group_id)) return { ok: false, error: 'invalid_modifier' }
      precioExtra += Number(mod.price ?? 0)
      modNames.push(mod.name)
    }

    const notas = typeof line.notas === 'string' ? line.notas.slice(0, MAX_NOTES) : ''
    const subtotal = calcItemSubtotal(item.price, precioExtra, qty)
    items.push({
      id: genId(), menuItemId: item.id, nombre: item.name, precio: item.price,
      cantidad: qty, modificadores: modNames, notas, precioExtra, subtotal,
    })
  }

  const subtotal = items.reduce((s, it) => s + it.subtotal, 0)
  const iva = subtotal * ivaRate
  return { ok: true, items, subtotal, iva, total: subtotal + iva }
}

function sbConfig(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_KEY || ''
  if (!url || !key) throw new PublicMenuConfigError('SUPABASE_SERVICE_KEY not configured')
  return { url, key }
}
async function sbGet<T>(path: string): Promise<T[]> {
  const { url, key } = sbConfig()
  const res = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store' })
  if (!res.ok) throw new Error(`supabase read failed: ${res.status}`)
  return (await res.json()) as T[]
}

export async function createPublicOrder(token: string, submission: PublicSubmission, genId: () => string): Promise<PublicOrderResult> {
  const table: ResolvedTable | null = await resolveTableByToken(token)
  if (!table) return { status: 404, body: { error: 'not_found' } } // fail closed, generic

  const subHex = normalizeSubmissionId(submission?.submission_id)
  if (!subHex) return { status: 400, body: { error: 'invalid_submission' } }
  const orderId = publicOrderId(subHex)
  const cid = table.client_id
  const ecid = encodeURIComponent(cid)

  // Fetch tenant-scoped menu context + canonical tax rate needed to validate + reprice.
  const [menuItems, mods, itemGroups, catMods, clientRows] = await Promise.all([
    sbGet<MenuItemRow>(`pos_menu_items?client_id=eq.${ecid}&active=is.true&select=id,client_id,name,price,active,category_id`),
    sbGet<ModifierRow>(`pos_modifiers?client_id=eq.${ecid}&active=is.true&select=id,client_id,group_id,name,price,active`),
    sbGet<{ item_id: string; group_id: string }>(`pos_item_modifier_groups?client_id=eq.${ecid}&select=item_id,group_id`),
    sbGet<{ category_id: string; modifier_group_id: string }>(`pos_category_modifiers?client_id=eq.${ecid}&select=category_id,modifier_group_id`),
    sbGet<{ iva_rate: number | null }>(`clients?id=eq.${ecid}&select=iva_rate&limit=1`),
  ])
  const ivaRate = Number(clientRows[0]?.iva_rate ?? 0.16) // canonical per-tenant rate (fallback 0.16)
  const menuById = new Map(menuItems.map(i => [i.id, i]))
  const modsById = new Map(mods.map(m => [m.id, m]))
  const catGroups = new Map<string, Set<string>>()
  for (const cm of catMods) { const s = catGroups.get(cm.category_id) ?? new Set(); s.add(cm.modifier_group_id); catGroups.set(cm.category_id, s) }
  const allowedGroups = new Map<string, Set<string>>()
  for (const it of menuItems) allowedGroups.set(it.id, new Set(catGroups.get(it.category_id) ?? []))
  for (const ig of itemGroups) { const s = allowedGroups.get(ig.item_id) ?? new Set(); s.add(ig.group_id); allowedGroups.set(ig.item_id, s) }

  const priced = priceSubmission(submission.items, menuById, modsById, allowedGroups, genId, ivaRate)
  if (!priced.ok) return { status: 400, body: { error: priced.error } }

  const personas = Number.isInteger(submission.personas) && submission.personas! >= 1 && submission.personas! <= MAX_PERSONAS ? submission.personas! : 1
  const customerName = typeof submission.customer_name === 'string' ? submission.customer_name.slice(0, MAX_NAME) : ''

  const row = {
    id: orderId,
    client_id: cid,          // server-derived from token
    location_id: table.location_id,
    mesa: table.mesa,
    status: 'abierta',       // NEVER 'enviada' — no kitchen side effects
    mesero: 'QR',            // review marker, not a real waiter; canonical send sets the real one
    turno_id: null,          // external unopened order; resolved by the canonical staff send
    personas,
    customer_name: customerName,
    subtotal: priced.subtotal,
    iva: priced.iva,
    total: priced.total,
    descuento: 0,
    items: JSON.stringify(priced.items),
    order_revision: 0,
    comanda_batches: {},     // no comanda batch until staff send
  }

  const { url, key } = sbConfig()
  // ignore-duplicates = ON CONFLICT DO NOTHING: a replay never overwrites an existing
  // (possibly staff-edited/sent) order. Idempotent by the deterministic PK.
  const res = await fetch(`${url}/rest/v1/pos_orders`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify(row),
  })
  if (!res.ok && res.status !== 409) return { status: 502, body: { error: 'create_failed' } }
  const created = (await res.json().catch(() => [])) as Array<{ id: string; status: string; mesa: number; total: number }>
  if (created.length > 0) {
    const o = created[0]
    return { status: 201, body: { order_id: o.id, status: o.status, mesa: o.mesa, total: o.total } }
  }
  // Duplicate: return the existing order unchanged (idempotent success).
  const existing = await sbGet<{ id: string; status: string; mesa: number; total: number }>(
    `pos_orders?id=eq.${encodeURIComponent(orderId)}&select=id,status,mesa,total&limit=1`)
  const o = existing[0]
  return { status: 200, body: o ? { order_id: o.id, status: o.status, mesa: o.mesa, total: o.total } : { error: 'not_found' } }
}
