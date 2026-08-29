// Uber Eats — Menu management API.
// POST /api/integrations/uber-eats/menu → upload full menu
// PATCH /api/integrations/uber-eats/menu → mark OOS / restore items

import { type NextRequest, NextResponse } from 'next/server'
import { uploadMenu, markItemsOOS, restoreItems } from '@/lib/integrations/uber-eats/menu'
import { checkAdminAuth } from '@/lib/integrations/admin-auth'

export async function POST(request: NextRequest) {
  const correlationId = crypto.randomUUID()
  const auth = checkAdminAuth(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error, correlation_id: correlationId }, { status: auth.status })
  try {
    const { store_id, menu } = await request.json() as { store_id: string; menu: Parameters<typeof uploadMenu>[1] }
    if (!store_id || !menu) return NextResponse.json({ error: 'store_id and menu required' }, { status: 400 })
    const result = await uploadMenu(store_id, menu, correlationId)
    return NextResponse.json({ ...result, correlation_id: correlationId }, { status: result.ok ? 200 : 422 })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e), correlation_id: correlationId }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const correlationId = crypto.randomUUID()
  const auth = checkAdminAuth(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error, correlation_id: correlationId }, { status: auth.status })
  try {
    const { store_id, action, items, item_ids } = await request.json() as {
      store_id: string
      action: 'oos' | 'restore'
      items?: Parameters<typeof markItemsOOS>[1]
      item_ids?: string[]
    }
    if (!store_id) return NextResponse.json({ error: 'store_id required' }, { status: 400 })

    if (action === 'oos' && items?.length) {
      const result = await markItemsOOS(store_id, items, correlationId)
      return NextResponse.json({ ...result, correlation_id: correlationId }, { status: result.ok ? 200 : 422 })
    }
    if (action === 'restore' && item_ids?.length) {
      const result = await restoreItems(store_id, item_ids, correlationId)
      return NextResponse.json({ ...result, correlation_id: correlationId }, { status: result.ok ? 200 : 422 })
    }
    return NextResponse.json({ error: 'Invalid action or missing items/item_ids' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e), correlation_id: correlationId }, { status: 500 })
  }
}
