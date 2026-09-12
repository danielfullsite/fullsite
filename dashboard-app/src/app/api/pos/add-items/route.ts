import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { hasPermission } from '@/lib/pos-permissions'

type AppendItem = Record<string, unknown> & {
  id?: unknown
  menuItemId?: unknown
  nombre?: unknown
  precio?: unknown
  precioExtra?: unknown
  cantidad?: unknown
  subtotal?: unknown
  _comboId?: unknown
  _comboGroupId?: unknown
}

type MenuRow = { id?: unknown; name?: unknown; price?: unknown }
type ComboRow = { id?: unknown; price?: unknown; items?: unknown }

const TIEMPO_ITEM_ID = '__tiempo__'
const ACTIVE_ORDER_STATUSES = new Set(['abierta', 'enviada', 'preparando', 'lista', 'entregada'])

function cents(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) : null
}

function sameStaffName(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown) => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('es-MX')
  return normalize(left) !== '' && normalize(left) === normalize(right)
}

function jsonArray(value: unknown): Array<Record<string, unknown>> | null {
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : null
  } catch { return null }
}

function matchesComboSlots(definition: Array<Record<string, unknown>>, group: AppendItem[]): boolean {
  if (definition.length !== group.length) return false
  const allowedBySlot = definition.map(slot => {
    const allowed = new Set<string>()
    if (typeof slot.menu_item_id === 'string') allowed.add(slot.menu_item_id)
    for (const substitution of jsonArray(slot.substitutions) ?? []) {
      if (typeof substitution.id === 'string') allowed.add(substitution.id)
    }
    return allowed
  })
  const itemToSlot = Array<number>(group.length).fill(-1)
  const assignSlot = (slotIndex: number, seenItems: Set<number>): boolean => {
    for (let itemIndex = 0; itemIndex < group.length; itemIndex++) {
      if (seenItems.has(itemIndex) || !allowedBySlot[slotIndex].has(String(group[itemIndex].menuItemId))) continue
      seenItems.add(itemIndex)
      if (itemToSlot[itemIndex] === -1 || assignSlot(itemToSlot[itemIndex], seenItems)) {
        itemToSlot[itemIndex] = slotIndex
        return true
      }
    }
    return false
  }
  return definition.every((_, slotIndex) => assignSlot(slotIndex, new Set()))
}

function validateShape(items: AppendItem[]): string | null {
  const ids = new Set<string>()
  for (const item of items) {
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    const menuItemId = typeof item.menuItemId === 'string' ? item.menuItemId.trim() : ''
    const quantity = Number(item.cantidad)
    const price = cents(item.precio)
    const extra = cents(item.precioExtra)
    const subtotal = cents(item.subtotal)
    if (!id || id.length > 200 || ids.has(id) || !menuItemId || menuItemId.length > 200 ||
      !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000 ||
      price === null || extra === null || subtotal === null) return 'INVALID_ITEM'
    ids.add(id)
    if (subtotal !== (price + extra) * quantity) return 'INVALID_ITEM_SUBTOTAL'
    if (menuItemId === TIEMPO_ITEM_ID && (price !== 0 || extra !== 0 || subtotal !== 0 || quantity !== 1)) {
      return 'INVALID_TIME_SEPARATOR'
    }
  }
  return null
}

export async function POST(request: NextRequest) {
  try {
    const auth = await withPOSAuth(request)
    if (!auth) return unauthorized()
    const clientId = auth.clientId
    const body = await request.json()
    const { order_id, items } = body

    if (!order_id || typeof order_id !== 'string') {
      return Response.json({ ok: false, error: 'INVALID_ORDER_ID' }, { status: 400 })
    }
    if (!Array.isArray(items) || items.length === 0 || items.length > 200) {
      return Response.json({ ok: false, error: 'INVALID_ITEMS' }, { status: 400 })
    }
    const shapeError = validateShape(items as AppendItem[])
    if (shapeError) return Response.json({ ok: false, error: shapeError }, { status: 400 })

    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.SUPABASE_SERVICE_KEY
    if (!sbKey) {
      return Response.json({ ok: false, error: 'SERVER_CONFIG_ERROR' }, { status: 500 })
    }

    const serviceHeaders = {
      apikey: sbKey,
      Authorization: `Bearer ${sbKey}`,
      'Content-Type': 'application/json',
    }

    // Ownership is resolved from the tenant-scoped row, never from the request.
    // This endpoint is online-only (the offline queue uses save-order), so these
    // authority reads do not change the offline replay contract.
    const orderRes = await fetch(
      `${sbUrl}/rest/v1/pos_orders?id=eq.${encodeURIComponent(order_id)}` +
        `&client_id=eq.${encodeURIComponent(clientId)}&select=id,mesero,status&limit=1`,
      { headers: serviceHeaders, cache: 'no-store' },
    )
    if (!orderRes.ok) return Response.json({ ok: false, error: 'ORDER_AUTHORITY_UNAVAILABLE' }, { status: 503 })
    const orderRows = await orderRes.json() as Array<{ id?: unknown; mesero?: unknown; status?: unknown }>
    const order = Array.isArray(orderRows) ? orderRows[0] : null
    if (!order) return Response.json({ ok: false, error: 'ORDER_NOT_FOUND' }, { status: 404 })
    if (!ACTIVE_ORDER_STATUSES.has(String(order.status))) {
      return Response.json({ ok: false, error: 'ORDER_NOT_OPEN' }, { status: 409 })
    }
    const waiterScoped = hasPermission(auth.role, 'ver_cuentas_propias')
      && !hasPermission(auth.role, 'ver_todas_cuentas')
    if (waiterScoped && (!auth.staffName || !sameStaffName(order.mesero, auth.staffName))) {
      return Response.json({ ok: false, error: 'ORDER_NOT_OWNED' }, { status: 403 })
    }

    const appendItems = items as AppendItem[]
    const menuIds = [...new Set(appendItems
      .map(item => String(item.menuItemId))
      .filter(id => id !== TIEMPO_ITEM_ID))]
    const menuRes = menuIds.length === 0 ? null : await fetch(
      `${sbUrl}/rest/v1/pos_menu_items?client_id=eq.${encodeURIComponent(clientId)}` +
        `&active=eq.true&id=in.(${menuIds.map(encodeURIComponent).join(',')})&select=id,name,price`,
      { headers: serviceHeaders, cache: 'no-store' },
    )
    if (menuRes && !menuRes.ok) return Response.json({ ok: false, error: 'MENU_AUTHORITY_UNAVAILABLE' }, { status: 503 })
    const menuRows = menuRes ? await menuRes.json() as MenuRow[] : []
    const menu = new Map<string, { name: string; priceCents: number }>()
    for (const row of Array.isArray(menuRows) ? menuRows : []) {
      if (typeof row.id !== 'string' || cents(row.price) === null) continue
      menu.set(row.id, { name: String(row.name ?? ''), priceCents: cents(row.price)! })
    }
    if (menuIds.some(id => !menu.has(id))) {
      return Response.json({ ok: false, error: 'MENU_ITEM_NOT_FOUND' }, { status: 409 })
    }

    const comboItems = appendItems.filter(item => item._comboId !== undefined || item._comboGroupId !== undefined)
    if (comboItems.some(item => typeof item._comboId !== 'string' || typeof item._comboGroupId !== 'string')) {
      return Response.json({ ok: false, error: 'INVALID_COMBO_EVIDENCE' }, { status: 400 })
    }
    if (comboItems.length > 0) {
      const comboIds = [...new Set(comboItems.map(item => String(item._comboId)))]
      const comboRes = await fetch(
        `${sbUrl}/rest/v1/pos_combos?client_id=eq.${encodeURIComponent(clientId)}` +
          `&active=eq.true&id=in.(${comboIds.map(encodeURIComponent).join(',')})&select=id,price,items`,
        { headers: serviceHeaders, cache: 'no-store' },
      )
      if (!comboRes.ok) return Response.json({ ok: false, error: 'COMBO_AUTHORITY_UNAVAILABLE' }, { status: 503 })
      const combos = new Map<string, ComboRow>()
      for (const combo of (await comboRes.json()) as ComboRow[]) {
        if (typeof combo.id === 'string') combos.set(combo.id, combo)
      }
      const groups = new Map<string, AppendItem[]>()
      for (const item of comboItems) {
        const key = `${item._comboId}:${item._comboGroupId}`
        groups.set(key, [...(groups.get(key) ?? []), item])
      }
      for (const group of groups.values()) {
        const combo = combos.get(String(group[0]._comboId))
        const definition = jsonArray(combo?.items)
        const comboPrice = cents(combo?.price)
        if (!combo || !definition || comboPrice === null || group.length !== definition.length ||
          group.some(item => Number(item.cantidad) !== 1) ||
          group.reduce((sum, item) => sum + (cents(item.subtotal) ?? 0), 0) !== comboPrice) {
          return Response.json({ ok: false, error: 'INVALID_COMBO_PRICE' }, { status: 409 })
        }
        if (!matchesComboSlots(definition, group)) {
          return Response.json({ ok: false, error: 'INVALID_COMBO_ITEM' }, { status: 409 })
        }
      }
    }

    const sanitizedItems = appendItems.map(item => {
      if (item.menuItemId === TIEMPO_ITEM_ID) return item
      const catalog = menu.get(String(item.menuItemId))!
      const isCombo = typeof item._comboId === 'string'
      if (!isCombo && cents(item.precio) !== catalog.priceCents) return null
      return { ...item, nombre: catalog.name || item.nombre }
    })
    if (sanitizedItems.some(item => item === null)) {
      return Response.json({ ok: false, error: 'MENU_PRICE_CHANGED' }, { status: 409 })
    }

    const res = await fetch(`${sbUrl}/rest/v1/rpc/r1_add_items`, {
      method: 'POST',
      headers: {
        ...serviceHeaders,
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ p_client_id: clientId, p_order_id: order_id, p_items: sanitizedItems }),
    })

    if (!res.ok) {
      console.error('[add-items] RPC error:', res.status, await res.text())
      return Response.json({ ok: false, error: 'RPC_FAILED' }, { status: 502 })
    }

    return Response.json(await res.json())
  } catch (err) {
    console.error('[add-items] error:', err)
    return Response.json({ ok: false, error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
