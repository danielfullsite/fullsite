import { buildRappiAuthHeaders, rappiLegacyBaseUrl, rappiStoreId } from '@/lib/integrations/rappi/auth'

export type RappiMenuCategory = {
  id: string
  name: string
  minQty: number
  maxQty: number
  sortingPosition: number
}

export type RappiMenuItem = {
  category: RappiMenuCategory
  children: RappiMenuItem[]
  name: string
  description: string
  price: number
  sku: string
  sortingPosition: number
  type: 'PRODUCT'
  combo?: boolean
}

export type RappiMenuPayload = {
  storeId: string
  items: RappiMenuItem[]
}

export type RappiMenuUploadResult = {
  ok: boolean
  status_code: number
  upstream: Record<string, unknown> | string | null
}

export type RappiMenuReadMode = 'submitted' | 'approved' | 'rappi'

const MENU_PATH = '/api/v2/restaurants-integrations-public-api/menu'

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function summarizeUpstreamPayload(payload: unknown): Record<string, unknown> | string | null {
  if (!payload) return null
  if (typeof payload === 'string') return payload.slice(0, 300)
  if (Array.isArray(payload)) return { item_count: payload.length }

  const obj = asObject(payload)
  if (!obj) return null
  const items = Array.isArray(obj.items) ? obj.items : null

  return {
    status: typeof obj.status === 'string' || typeof obj.status === 'number' ? obj.status : undefined,
    code: typeof obj.code === 'string' || typeof obj.code === 'number' ? obj.code : undefined,
    message: typeof obj.message === 'string' ? obj.message.slice(0, 300) : undefined,
    error: typeof obj.error === 'string' ? obj.error.slice(0, 300) : undefined,
    code_message: typeof obj.code_message === 'string' ? obj.code_message.slice(0, 300) : undefined,
    item_count: items ? items.length : undefined,
  }
}

async function parsePayload(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export function buildRappiDevTestMenu(storeId = rappiStoreId()): RappiMenuPayload {
  if (!storeId) throw new Error('RAPPI_STORE_ID_REQUIRED')

  return {
    storeId,
    items: [
      {
        category: {
          id: 'fullsite-dev-cat-bebidas',
          name: 'Bebidas',
          minQty: 0,
          maxQty: 0,
          sortingPosition: 0,
        },
        children: [],
        name: 'Café americano',
        description: 'Café americano de prueba Fullsite DEV.',
        price: 4500,
        sku: 'fullsite-dev-cafe-americano',
        sortingPosition: 0,
        type: 'PRODUCT',
      },
      {
        category: {
          id: 'fullsite-dev-cat-bebidas',
          name: 'Bebidas',
          minQty: 0,
          maxQty: 0,
          sortingPosition: 0,
        },
        children: [],
        name: 'Latte',
        description: 'Latte de prueba Fullsite DEV.',
        price: 5500,
        sku: 'fullsite-dev-latte',
        sortingPosition: 1,
        type: 'PRODUCT',
      },
      {
        category: {
          id: 'fullsite-dev-cat-alimentos',
          name: 'Alimentos',
          minQty: 0,
          maxQty: 0,
          sortingPosition: 1,
        },
        children: [],
        name: 'Pan dulce',
        description: 'Pan dulce de prueba Fullsite DEV.',
        price: 3900,
        sku: 'fullsite-dev-pan-dulce',
        sortingPosition: 0,
        type: 'PRODUCT',
      },
    ],
  }
}

export async function uploadRappiMenu(payload: RappiMenuPayload): Promise<RappiMenuUploadResult> {
  const headers = new Headers(await buildRappiAuthHeaders())
  headers.set('Content-Type', 'application/json')

  const res = await fetch(`${rappiLegacyBaseUrl()}${MENU_PATH}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    cache: 'no-store',
  })
  const parsed = await parsePayload(res)

  return {
    ok: res.ok,
    status_code: res.status,
    upstream: summarizeUpstreamPayload(parsed),
  }
}

function menuReadPath(storeId: string, mode: RappiMenuReadMode): string {
  const encodedStoreId = encodeURIComponent(storeId)
  if (mode === 'approved') return `${MENU_PATH}/approved/${encodedStoreId}`
  if (mode === 'rappi') return `${MENU_PATH}/rappi/${encodedStoreId}`
  return `${MENU_PATH}?storeId=${encodedStoreId}`
}

export async function readRappiMenu(storeId = rappiStoreId(), mode: RappiMenuReadMode = 'submitted'): Promise<RappiMenuUploadResult> {
  if (!storeId) throw new Error('RAPPI_STORE_ID_REQUIRED')

  const headers = new Headers(await buildRappiAuthHeaders())
  const res = await fetch(`${rappiLegacyBaseUrl()}${menuReadPath(storeId, mode)}`, {
    method: 'GET',
    headers,
    cache: 'no-store',
  })
  const parsed = await parsePayload(res)

  return {
    ok: res.ok,
    status_code: res.status,
    upstream: summarizeUpstreamPayload(parsed),
  }
}
