import { createHmac, timingSafeEqual } from 'crypto'

// ─── Token de cocina por tenant ──────────────────────────────────────────────
// El endpoint /api/pos/kitchen sirve las órdenes a las pantallas de cocina (KDS),
// que son login-less. Antes se gateaba SOLO por client_id (un slug adivinable como
// 'amalay') → cualquiera podía enumerar las órdenes de cocina de otro tenant.
//
// Este token ata la lectura a un secreto por-tenant: token = HMAC(client_id, SECRET).
// Sin el SECRET no se puede forjar el token de otro cliente. Es determinista (no hay
// que guardarlo en BD): se computa una vez por cliente y se provisiona a su KDS.
//
// OPT-IN: si KITCHEN_TOKEN_SECRET no está seteado (o es < 16 chars), el sistema opera
// ABIERTO igual que hoy (backward-compatible, cero cambios de comportamiento). En
// cuanto se setea el env + se provisiona el token a las cajas, el endpoint lo exige.

const SECRET = process.env.KITCHEN_TOKEN_SECRET || ''

export function kitchenTokenEnabled(): boolean {
  return SECRET.length >= 16
}

// Token determinista para un cliente. null si el sistema está deshabilitado.
export function signKitchenToken(clientId: string): string | null {
  if (!kitchenTokenEnabled()) return null
  return createHmac('sha256', SECRET).update(`kitchen:${clientId}`).digest('base64url')
}

// true si el token corresponde al client_id (timing-safe). Si está deshabilitado,
// devuelve true (modo abierto). El endpoint solo verifica cuando kitchenTokenEnabled().
export function verifyKitchenToken(clientId: string, token: string | null | undefined): boolean {
  const expected = signKitchenToken(clientId)
  if (!expected) return true // deshabilitado → abierto
  if (!token) return false
  const a = Buffer.from(token)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
