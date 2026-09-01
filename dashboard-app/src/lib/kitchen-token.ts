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
// FALLA CERRADO. Sin KITCHEN_TOKEN_SECRET (o con menos de 16 chars) NO se autoriza a
// nadie. Antes era al revés — opt-in, y sin secreto servía abierto — y el secreto nunca
// se puso: el 2026-08-26 se reprodujo en producción que
// `GET /api/pos/kitchen?client_id=lab-resto` sin credencial alguna devolvía 200 con la
// operación viva (mesa, mesero por nombre, platillos, precios).
//
// Un mecanismo que falla abierto y está apagado se ve idéntico a uno que funciona. Por eso
// el default se invierte en vez de "acordarse" de encender la variable — el mismo arreglo
// que se le hizo a CRON_SECRET (#130).
//
// Consecuencia operativa: una pantalla sin provisionar recibe 401 y se queda sin comandas.
// El procedimiento de provisión está en docs/security/ACTIVAR-KITCHEN-TOKEN.md y hay que
// correrlo ANTES de desplegar esto.

const SECRET = process.env.KITCHEN_TOKEN_SECRET || ''

// Hay secreto utilizable. NO significa "el guardián está activo": el guardián siempre lo
// está. Sin secreto no se autoriza nada, y eso se reporta como error de configuración.
export function kitchenSecretPresente(): boolean {
  return SECRET.length >= 16
}

// Token determinista para un cliente. null si no hay secreto con qué firmarlo.
// Se usa para provisionar las pantallas: ver scripts/token-cocina.mjs.
export function signKitchenToken(clientId: string): string | null {
  if (!kitchenSecretPresente()) return null
  return createHmac('sha256', SECRET).update(`kitchen:${clientId}`).digest('base64url')
}

// true sólo si el token corresponde a ese client_id (comparación en tiempo constante).
//
// Sin secreto devuelve FALSE. Es deliberado: preferimos que la cocina se quede sin
// comandas —visible en dos segundos— a servir la operación de cualquier restaurante a
// quien adivine un slug. Un despliegue sin la variable se nota; una fuga silenciosa no.
export function verifyKitchenToken(clientId: string, token: string | null | undefined): boolean {
  const expected = signKitchenToken(clientId)
  if (!expected) return false // sin secreto → no se autoriza a nadie
  if (!token) return false
  const a = Buffer.from(token)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
