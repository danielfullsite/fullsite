// POS Shift Token — cryptographically signed, issued by /api/pos/pin.
// Replaces btoa(pin) PIN cache (P0-E) and provides authenticated identity
// for all POS kiosk API calls without a Supabase session (P0-N).
//
// Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256 signature)
// Requires SHIFT_TOKEN_SECRET env var (≥32 chars), server-side only.
// TTL: 8 hours (one full shift). No refresh — staff re-enters PIN next shift.

const ALGORITHM = { name: 'HMAC', hash: 'SHA-256' }
const TTL_MS = 8 * 60 * 60 * 1000

export interface ShiftTokenPayload {
  sub: string   // staffId
  cid: string   // clientId
  rol: string   // role
  nam: string   // staffName
  iat: number   // issued at (unix ms)
  exp: number   // expires at (unix ms)
}

async function getKey(): Promise<CryptoKey> {
  const secret = process.env.SHIFT_TOKEN_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('SHIFT_TOKEN_SECRET must be set and ≥32 characters')
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    ALGORITHM,
    false,
    ['sign', 'verify']
  )
}

export async function issueShiftToken(
  staffId: string,
  clientId: string,
  role: string,
  staffName: string
): Promise<string> {
  const key = await getKey()
  const now = Date.now()
  const payload: ShiftTokenPayload = {
    sub: staffId,
    cid: clientId,
    rol: role,
    nam: staffName,
    iat: now,
    exp: now + TTL_MS,
  }
  const data = new TextEncoder().encode(JSON.stringify(payload))
  const sig = await crypto.subtle.sign(ALGORITHM.name, key, data)
  return `${Buffer.from(data).toString('base64url')}.${Buffer.from(sig).toString('base64url')}`
}

export async function verifyShiftToken(token: string): Promise<ShiftTokenPayload | null> {
  try {
    const dot = token.indexOf('.')
    if (dot < 0) return null
    const dataB64 = token.slice(0, dot)
    const sigB64 = token.slice(dot + 1)
    if (!dataB64 || !sigB64) return null

    const key = await getKey()
    const data = Buffer.from(dataB64, 'base64url')
    const sig = Buffer.from(sigB64, 'base64url')
    const valid = await crypto.subtle.verify(ALGORITHM.name, key, sig, data)
    if (!valid) return null

    const payload = JSON.parse(new TextDecoder().decode(data)) as ShiftTokenPayload
    if (!payload.sub || !payload.cid || !payload.rol || !payload.exp) return null
    if (Date.now() > payload.exp) return null

    return payload
  } catch {
    return null
  }
}
