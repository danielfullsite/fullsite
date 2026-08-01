const DEFAULT = 'http://127.0.0.1:7717'
const STORAGE_KEY = 'FULLSITE_BRIDGE_URL'

export function getBridgeUrl(): string {
  if (typeof window === 'undefined') return DEFAULT
  return localStorage.getItem(STORAGE_KEY) || DEFAULT
}

export function setBridgeUrl(url: string): void {
  const trimmed = url.trim()
  if (!trimmed || trimmed === DEFAULT) {
    localStorage.removeItem(STORAGE_KEY)
  } else {
    localStorage.setItem(STORAGE_KEY, trimmed)
  }
}

export { DEFAULT as DEFAULT_BRIDGE_URL }
