const FINGERPRINT_DEFAULT_URL = 'http://127.0.0.1:7718'

let _override: string | null = null

export function getFingerprintUrl(): string {
  return _override ?? FINGERPRINT_DEFAULT_URL
}

// Call at POS startup when client config is loaded.
// Pass null to reset to the default.
export function setFingerprintUrl(url: string | null): void {
  _override = url
}
