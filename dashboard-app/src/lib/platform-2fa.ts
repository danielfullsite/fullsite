import crypto from 'crypto'

// ── Control Plane · Email 2FA (step-up) ──────────────────────────────────────
// Segundo factor por CORREO para /platform (modo dios). Diseño fail-open por flag:
//
//  - PLATFORM_2FA_ENFORCED !== 'true'  → el guard estricto se comporta como el base
//    (NO hay lockout). Así se despliega el código sin riesgo; el enforcement se
//    prende sólo cuando el flujo ya se probó y existen recovery codes.
//  - Al verificar (código de email o recovery code) se emite un token step-up
//    firmado HMAC-SHA256, guardado en cookie httpOnly `fs-2fa`, válido 12h.
//  - El token NO reemplaza la sesión: requirePlatformAdmin sigue validando sesión
//    + is_platform_admin. Esto es SÓLO el segundo factor, y sólo para /platform.
//
// Secreto de firma: PLATFORM_2FA_SECRET, con fallback a SUPABASE_SERVICE_KEY
// (siempre presente en el server). Nunca se expone al cliente.

export const STEPUP_COOKIE = 'fs-2fa'
export const STEPUP_TTL_SECONDS = 12 * 60 * 60 // 12h
export const CODE_TTL_MS = 10 * 60 * 1000 // 10 min
export const MAX_CODE_ATTEMPTS = 5
export const RECOVERY_CODE_COUNT = 8

function signingSecret(): string {
  return process.env.PLATFORM_2FA_SECRET || process.env.SUPABASE_SERVICE_KEY || ''
}

/** ¿Está activo el enforcement del segundo factor? (default: NO → sin lockout) */
export function is2FAEnforced(): boolean {
  return process.env.PLATFORM_2FA_ENFORCED === 'true'
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Firma un token step-up para un admin. Formato: <payloadB64>.<hmacB64> */
export function signStepUp(userId: string, nowMs: number): string {
  const exp = Math.floor(nowMs / 1000) + STEPUP_TTL_SECONDS
  const payload = b64url(Buffer.from(JSON.stringify({ uid: userId, exp })))
  const mac = b64url(crypto.createHmac('sha256', signingSecret()).update(payload).digest())
  return `${payload}.${mac}`
}

/** Verifica un token step-up. Devuelve el userId si es válido y no expiró, o null. */
export function verifyStepUp(token: string | undefined, nowMs: number): string | null {
  if (!token || !token.includes('.')) return null
  const [payload, mac] = token.split('.')
  if (!payload || !mac) return null
  const expected = b64url(crypto.createHmac('sha256', signingSecret()).update(payload).digest())
  // timing-safe compare
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
    if (!json?.uid || typeof json.exp !== 'number') return null
    if (Math.floor(nowMs / 1000) > json.exp) return null
    return json.uid as string
  } catch {
    return null
  }
}

/** Cadena Set-Cookie para el token step-up (httpOnly, Secure, SameSite=Lax). */
export function stepUpSetCookie(token: string): string {
  return [
    `${STEPUP_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${STEPUP_TTL_SECONDS}`,
  ].join('; ')
}

/** SHA-256 hex de un código (email OTP o recovery code). */
export function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code.trim()).digest('hex')
}

/** Genera un código numérico de 6 dígitos criptográficamente aleatorio. */
export function generateOtp(): string {
  // 000000–999999 uniforme
  const n = crypto.randomInt(0, 1_000_000)
  return n.toString().padStart(6, '0')
}

/** Genera N recovery codes tipo "3f9a-c210" (single-use). */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = []
  for (let i = 0; i < count; i++) {
    const hex = crypto.randomBytes(4).toString('hex') // 8 hex chars
    codes.push(`${hex.slice(0, 4)}-${hex.slice(4)}`)
  }
  return codes
}

/** Enmascara un correo para respuestas: da***@dominio.com */
export function maskEmail(email: string): string {
  const [user, domain] = email.split('@')
  if (!domain) return '***'
  const head = user.slice(0, 2)
  return `${head}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`
}
