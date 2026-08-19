// Uber Eats — Menu management API.
// POST /api/integrations/uber-eats/menu → upload full menu
// PATCH /api/integrations/uber-eats/menu → mark OOS / restore items

import { type NextRequest, NextResponse } from 'next/server'
import { uploadMenu, markItemsOOS, restoreItems, updateItem, type UberItemUpdate } from '@/lib/integrations/uber-eats/menu'
import { withPOSAuth } from '@/lib/api-auth'
import { sameOriginOnly } from '@/lib/api-guard'
import { storeBelongsToClient } from '@/lib/integrations/uber-eats/ownership'

// BLINDAJE B1 (P0-3): antes SIN auth → cualquiera sobrescribía el menú Uber (precios,
// 86) de cualquier restaurante. Ahora sesión + verificación de propiedad del store.

export async function POST(request: NextRequest) {
  const originBlock = sameOriginOnly(request); if (originBlock) return originBlock
  const auth = await withPOSAuth(request)
  if (!auth) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const correlationId = crypto.randomUUID()
  try {
    const { store_id, menu } = await request.json() as { store_id: string; menu: Parameters<typeof uploadMenu>[1] }
    if (!store_id || !menu) return NextResponse.json({ error: 'store_id and menu required' }, { status: 400 })
    if (!(await storeBelongsToClient(store_id, auth.clientId))) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    const result = await uploadMenu(store_id, menu, correlationId)
    return NextResponse.json({ ...result, correlation_id: correlationId }, { status: result.ok ? 200 : 422 })
  } catch {
    return NextResponse.json({ ok: false, error: 'Error interno', correlation_id: correlationId }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const originBlock = sameOriginOnly(request); if (originBlock) return originBlock
  const auth = await withPOSAuth(request)
  if (!auth) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const correlationId = crypto.randomUUID()
  try {
    const { store_id, action, items, item_ids, item_id, patch } = await request.json() as {
      store_id: string
      action: 'oos' | 'restore' | 'update'
      items?: Parameters<typeof markItemsOOS>[1]
      item_ids?: string[]
      item_id?: string
      patch?: UberItemUpdate
    }
    if (!store_id) return NextResponse.json({ error: 'store_id required' }, { status: 400 })
    if (!(await storeBelongsToClient(store_id, auth.clientId))) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    if (action === 'oos' && items?.length) {
      const result = await markItemsOOS(store_id, items, correlationId)
      return NextResponse.json({ ...result, correlation_id: correlationId }, { status: result.ok ? 200 : 422 })
    }
    if (action === 'restore' && item_ids?.length) {
      const result = await restoreItems(store_id, item_ids, correlationId)
      return NextResponse.json({ ...result, correlation_id: correlationId }, { status: result.ok ? 200 : 422 })
    }
    // Uber endpoint #9: update de UN item (POST /v2/eats/stores/{id}/menus/items/{id})
    if (action === 'update' && item_id && patch) {
      const result = await updateItem(store_id, item_id, patch, correlationId)
      return NextResponse.json({ ...result, correlation_id: correlationId }, { status: result.ok ? 200 : 422 })
    }
    return NextResponse.json({ error: 'Invalid action or missing items/item_ids' }, { status: 400 })
  } catch {
    return NextResponse.json({ ok: false, error: 'Error interno', correlation_id: correlationId }, { status: 500 })
  }
}
