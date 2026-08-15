import { type NextRequest, NextResponse } from 'next/server'
import { rappiEnv, rappiStoreId, RappiConfigError } from '@/lib/integrations/rappi/auth'
import { buildRappiDevTestMenu, readRappiMenu, uploadRappiMenu, type RappiMenuPayload } from '@/lib/integrations/rappi/menu'

function requireAdmin(request: NextRequest): Response | null {
  const expected = process.env.INTEGRATION_ADMIN_SECRET || ''
  if (!expected) return NextResponse.json({ ok: false, error: 'INTEGRATION_ADMIN_SECRET_REQUIRED' }, { status: 503 })
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const header = request.headers.get('x-integration-admin-secret')
  if (bearer !== expected && header !== expected) return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 })
  return null
}

function devOnly(): Response | null {
  if (rappiEnv() === 'dev') return null
  return NextResponse.json({ ok: false, error: 'RAPPI_MENU_DEV_ONLY' }, { status: 409 })
}

function hasMenuPayload(value: unknown): value is RappiMenuPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const obj = value as Record<string, unknown>
  if (typeof obj.storeId !== 'string' || !obj.storeId.trim()) return false
  return Array.isArray(obj.items)
}

function menuSummary(payload: RappiMenuPayload) {
  const categoryIds = new Set<string>()
  for (const item of payload.items) {
    const categoryId = item.category?.id || item.category?.name
    if (categoryId) categoryIds.add(categoryId)
  }
  return {
    store_id_configured: Boolean(payload.storeId),
    category_count: categoryIds.size,
    product_count: payload.items.length,
  }
}

function errorCode(error: unknown): string {
  if (error instanceof RappiConfigError) return error.code
  if (error instanceof Error && error.message === 'RAPPI_STORE_ID_REQUIRED') return 'RAPPI_STORE_ID_REQUIRED'
  return 'RAPPI_MENU_FAILED'
}

export async function GET(request: NextRequest) {
  const denied = requireAdmin(request)
  if (denied) return denied

  const notDev = devOnly()
  if (notDev) return notDev

  const storeId = request.nextUrl.searchParams.get('store_id')?.trim() || rappiStoreId()
  try {
    const result = await readRappiMenu(storeId)
    return NextResponse.json({ ok: result.ok, provider: 'rappi', action: 'read_menu', status_code: result.status_code, upstream: result.upstream }, {
      status: result.ok ? 200 : 502,
    })
  } catch (error) {
    return NextResponse.json({ ok: false, provider: 'rappi', action: 'read_menu', error: errorCode(error) }, { status: 502 })
  }
}

export async function POST(request: NextRequest) {
  const denied = requireAdmin(request)
  if (denied) return denied

  const notDev = devOnly()
  if (notDev) return notDev

  const body = await request.json().catch(() => ({})) as {
    dry_run?: boolean
    store_id?: string
    menu?: unknown
  }

  const storeId = body.store_id?.trim() || rappiStoreId()
  let payload: RappiMenuPayload
  try {
    payload = hasMenuPayload(body.menu) ? body.menu : buildRappiDevTestMenu(storeId)
  } catch (error) {
    return NextResponse.json({ ok: false, provider: 'rappi', action: 'upload_menu', error: errorCode(error) }, { status: 502 })
  }

  const summary = menuSummary(payload)

  if (body.dry_run === true) {
    return NextResponse.json({ ok: true, provider: 'rappi', action: 'upload_menu', dry_run: true, summary })
  }

  try {
    const result = await uploadRappiMenu(payload)
    return NextResponse.json({
      ok: result.ok,
      provider: 'rappi',
      action: 'upload_menu',
      dry_run: false,
      status_code: result.status_code,
      summary,
      upstream: result.upstream,
    }, {
      status: result.ok ? 200 : 502,
    })
  } catch (error) {
    return NextResponse.json({ ok: false, provider: 'rappi', action: 'upload_menu', error: errorCode(error), summary }, { status: 502 })
  }
}
