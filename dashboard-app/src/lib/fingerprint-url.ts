// Reach DigitalPersona through Pedro's local proxy. The deployed CSP allows
// :7717, while direct browser requests to :7718 are intentionally blocked.
const FINGERPRINT_DEFAULT_URL = 'http://127.0.0.1:7717/fp'

let _override: string | null = null

export function getFingerprintUrl(): string {
  return _override ?? FINGERPRINT_DEFAULT_URL
}

// Call at POS startup when client config is loaded.
// Pass null to reset to the default.
export function setFingerprintUrl(url: string | null): void {
  _override = url
}
