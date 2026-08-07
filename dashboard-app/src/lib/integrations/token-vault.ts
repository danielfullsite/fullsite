// Token vault — minimal envelope encryption for provider tokens at rest.
//
// Closes the audit finding: integration_providers.*_enc columns stored
// plaintext. Format on disk:  enc:v1:<iv_b64>:<ciphertext_b64>:<tag_b64>
// Cipher: AES-256-GCM. Key: INTEGRATION_TOKEN_KEY (base64, exactly 32 bytes).
//
// Backward/forward compatibility contract:
//   - sealToken:  key present → encrypted envelope; key absent → plaintext
//     passthrough with a one-time warning (classified pre-production blocker
//     SEC-UBER-01 — production go-live requires the key).
//   - openToken:  envelope → decrypt (throws without key — fail closed, an
//     encrypted row must never silently read as garbage); legacy plaintext
//     rows pass through unchanged so existing USL connections keep working.
//
// NEVER log token material — errors carry no plaintext or ciphertext.

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ENVELOPE_PREFIX = 'enc:v1:'

export class TokenVaultError extends Error {
  constructor(message: string) {
    super(`[token-vault] ${message}`)
    this.name = 'TokenVaultError'
  }
}

let warnedPlaintext = false

function loadKey(): Buffer | null {
  const raw = (process.env.INTEGRATION_TOKEN_KEY ?? '').trim()
  if (!raw) return null
  let key: Buffer
  try {
    key = Buffer.from(raw, 'base64')
  } catch {
    throw new TokenVaultError('INTEGRATION_TOKEN_KEY is not valid base64')
  }
  if (key.length !== 32) {
    throw new TokenVaultError(`INTEGRATION_TOKEN_KEY must decode to 32 bytes (got ${key.length})`)
  }
  return key
}

export function isEncryptedToken(value: string): boolean {
  return value.startsWith(ENVELOPE_PREFIX)
}

/** Encrypt a token for storage. Plaintext passthrough (warned once) if no key is configured. */
export function sealToken(plaintext: string): string {
  const key = loadKey()
  if (!key) {
    if (!warnedPlaintext) {
      warnedPlaintext = true
      console.warn('[token-vault] INTEGRATION_TOKEN_KEY not set — storing tokens in plaintext (SEC-UBER-01 pre-production blocker)')
    }
    return plaintext
  }
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${ENVELOPE_PREFIX}${iv.toString('base64')}:${ciphertext.toString('base64')}:${tag.toString('base64')}`
}

/** Decrypt a stored token. Legacy plaintext rows pass through unchanged. */
export function openToken(stored: string): string {
  if (!isEncryptedToken(stored)) return stored
  const key = loadKey()
  if (!key) {
    throw new TokenVaultError('encrypted token found but INTEGRATION_TOKEN_KEY is not configured')
  }
  const parts = stored.slice(ENVELOPE_PREFIX.length).split(':')
  if (parts.length !== 3) throw new TokenVaultError('malformed token envelope')
  try {
    const iv = Buffer.from(parts[0], 'base64')
    const ciphertext = Buffer.from(parts[1], 'base64')
    const tag = Buffer.from(parts[2], 'base64')
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    throw new TokenVaultError('token decryption failed (wrong key or corrupted envelope)')
  }
}

/** Test hook — reset the one-time plaintext warning. */
export function _resetVaultWarning(): void {
  warnedPlaintext = false
}
