const OPEN = new Set(['ONLINE', 'ACTIVE', 'OPEN'])
const CLOSED = new Set(['OFFLINE', 'PAUSED', 'CLOSED', 'INACTIVE'])

export interface UberStatusShape {
  is_open?: boolean
  status?: string
  store_status?: string
}

/** Unknown future enums stay unknown; they must not silently close a store. */
export function normalizeStoreOpen(data: UberStatusShape | null | undefined): boolean | null {
  if (!data) return null
  if (typeof data.is_open === 'boolean') return data.is_open
  const raw = (data.store_status ?? data.status ?? '').trim().toUpperCase()
  if (OPEN.has(raw)) return true
  if (CLOSED.has(raw)) return false
  if (raw) console.warn('[uber] estado de tienda no reconocido:', raw)
  return null
}

export function rawStoreStatus(data: UberStatusShape | null | undefined): string | undefined {
  return data?.store_status ?? data?.status
}
