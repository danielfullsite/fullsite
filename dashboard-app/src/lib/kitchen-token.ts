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

// ─── Rollout grace → strict ──────────────────────────────────────────────────
//
// El problema de encender esto no es el código: es que el token vive en el
// localStorage de cada pantalla (`pos_kitchen_token`, pos-data.ts:1606). En cuanto
// existe el secreto, TODA pantalla sin provisionar recibe 401 y se queda sin
// comandas. En una cocina eso no es un error de log: es que dejan de salir los
// platillos.
//
// Por eso el mismo patrón que ya usa el enforcement antifraude
// (docs/security/FRAUD-ENFORCEMENT-FLAGS.md): observar antes de bloquear.
//
//   off    — sin secreto. Abierto, como hoy. Es el default y no cambia nada.
//   grace  — con secreto: verifica, PERMITE y reporta quién no trae token.
//            Sirve para ver qué pantallas faltan por provisionar SIN dejar la
//            cocina sin tickets.
//   strict — con secreto: 401 sin token válido.
//
// Con secreto y sin `KITCHEN_TOKEN_MODE`, el default es `strict` — que es
// exactamente lo que hace hoy el endpoint. Encender el secreto no cambia de
// comportamiento por accidente; `grace` hay que pedirlo.
export type ModoTokenCocina = 'off' | 'grace' | 'strict'

export function modoTokenCocina(): ModoTokenCocina {
  if (!kitchenTokenEnabled()) return 'off'
  const m = (process.env.KITCHEN_TOKEN_MODE ?? '').trim().toLowerCase()
  return m === 'grace' ? 'grace' : 'strict'
}

export interface VeredictoCocina {
  /** ¿Se sirve la respuesta? */
  permitir: boolean
  modo: ModoTokenCocina
  /** ¿El token venía y era correcto? En modo `off` siempre es false: no se pidió. */
  tokenValido: boolean
  /** true cuando se dejó pasar una pantalla sin token válido y hay que reportarlo. */
  reportar: boolean
}

export function evaluarTokenCocina(
  clientId: string,
  token: string | null | undefined,
): VeredictoCocina {
  const modo = modoTokenCocina()
  if (modo === 'off') {
    return { permitir: true, modo, tokenValido: false, reportar: false }
  }
  const tokenValido = verifyKitchenToken(clientId, token)
  if (tokenValido) return { permitir: true, modo, tokenValido: true, reportar: false }
  if (modo === 'grace') {
    return { permitir: true, modo, tokenValido: false, reportar: true }
  }
  return { permitir: false, modo, tokenValido: false, reportar: false }
}
