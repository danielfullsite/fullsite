import { buildRappiAuthHeaders, rappiLegacyBaseUrl, rappiStoreId } from '@/lib/integrations/rappi/auth'

export type RappiMenuPrice = {
  price: number
}

export type RappiMenuProduct = {
  sku: string
  name: string
  description: string
  price: number
  active: boolean
  type: 'PRODUCT'
}

export type RappiMenuCategory = {
  sku: string
  name: string
  active: boolean
  products: RappiMenuProduct[]
}

export type RappiMenuPayload = {
  storeId: string
  menu: {
    categories: RappiMenuCategory[]
  }
}

export type RappiMenuUploadResult = {
  ok: boolean
  status_code: number
  upstream: Record<string, unknown> | string | null
}

const MENU_PATH = '/api/v2/restaurants-integrations-public-api/menu'

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function summarizeUpstreamPayload(payload: unknown): Record<string, unknown> | string | null {
  if (!payload) return null
  if (typeof payload === 'string') return payload.slice(0, 300)

  const obj = asObject(payload)
  if (!obj) return null

  return {
    status: typeof obj.status === 'string' || typeof obj.status === 'number' ? obj.status : undefined,
    code: typeof obj.code === 'string' || typeof obj.code === 'number' ? obj.code : undefined,
    message: typeof obj.message === 'string' ? obj.message.slice(0, 300) : undefined,
    error: typeof obj.error === 'string' ? obj.error.slice(0, 300) : undefined,
    code_message: typeof obj.code_message === 'string' ? obj.code_message.slice(0, 300) : undefined,
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
    menu: {
      categories: [
        {
          sku: 'fullsite-dev-bebidas',
          name: 'Bebidas',
          active: true,
          products: [
            {
              sku: 'fullsite-dev-cafe-americano',
              name: 'Café americano',
              description: 'Café americano de prueba Fullsite DEV.',
              price: 4500,
              active: true,
              type: 'PRODUCT',
            },
            {
              sku: 'fullsite-dev-latte',
              name: 'Latte',
              description: 'Latte de prueba Fullsite DEV.',
              price: 5500,
              active: true,
              type: 'PRODUCT',
            },
          ],
        },
        {
          sku: 'fullsite-dev-alimentos',
          name: 'Alimentos',
          active: true,
          products: [
            {
              sku: 'fullsite-dev-pan-dulce',
              name: 'Pan dulce',
              description: 'Pan dulce de prueba Fullsite DEV.',
              price: 3900,
              active: true,
              type: 'PRODUCT',
            },
          ],
        },
      ],
    },
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

export async function readRappiMenu(storeId = rappiStoreId()): Promise<RappiMenuUploadResult> {
  if (!storeId) throw new Error('RAPPI_STORE_ID_REQUIRED')

  const headers = new Headers(await buildRappiAuthHeaders())
  const res = await fetch(`${rappiLegacyBaseUrl()}${MENU_PATH}?storeId=${encodeURIComponent(storeId)}`, {
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

