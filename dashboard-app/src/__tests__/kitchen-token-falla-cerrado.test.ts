/**
 * El token de cocina falla CERRADO.
 *
 * POR QUÉ EXISTE ESTA PRUEBA
 * `/api/pos/kitchen` sirve las comandas a pantallas sin login, gateadas por un `client_id`
 * que es un slug adivinable. El token por-tenant existía desde antes para cerrarlo, pero
 * era opt-in: sin `KITCHEN_TOKEN_SECRET`, `verifyKitchenToken` devolvía `true` y autorizaba
 * a cualquiera.
 *
 * El secreto nunca se puso. El 2026-08-26 se reprodujo en producción, sin credencial de
 * ningún tipo:
 *
 *   GET https://app.fullsite.mx/api/pos/kitchen?client_id=lab-resto  → 200, operación viva
 *   GET https://app.fullsite.mx/api/pos/kitchen?client_id=amalay     → 200
 *
 * El de `amalay` salía vacío sólo porque AMALAY no tiene órdenes ahí — no porque algo lo
 * negara. Lo que estaba vacío eran los datos, no el control.
 *
 * Estas pruebas fijan la mitad que se rompió sola durante meses: **que la ausencia del
 * secreto deniegue**. Un mecanismo que falla abierto y está apagado se ve idéntico a uno
 * que funciona, y por eso nadie lo notó.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const SECRETO = 'x'.repeat(32)

async function cargar(secreto: string | undefined) {
  vi.resetModules()
  if (secreto === undefined) delete process.env.KITCHEN_TOKEN_SECRET
  else process.env.KITCHEN_TOKEN_SECRET = secreto
  return import('../lib/kitchen-token')
}

beforeEach(() => {
  vi.resetModules()
})

describe('sin secreto no se autoriza a nadie', () => {
  it('verifyKitchenToken devuelve false aunque no se mande token', async () => {
    const { verifyKitchenToken } = await cargar(undefined)
    // Éste es exactamente el bug: aquí devolvía true.
    expect(verifyKitchenToken('lab-resto', null)).toBe(false)
  })

  it('verifyKitchenToken devuelve false aunque se mande un token cualquiera', async () => {
    const { verifyKitchenToken } = await cargar(undefined)
    expect(verifyKitchenToken('lab-resto', 'lo-que-sea')).toBe(false)
  })

  it('un secreto demasiado corto cuenta como ausente', async () => {
    // 15 chars. Un secreto débil no debe comprar autorización.
    const { verifyKitchenToken } = await cargar('x'.repeat(15))
    expect(verifyKitchenToken('lab-resto', null)).toBe(false)
  })

  it('signKitchenToken devuelve null en vez de firmar con cadena vacía', async () => {
    const { signKitchenToken } = await cargar(undefined)
    expect(signKitchenToken('lab-resto')).toBeNull()
  })
})

describe('con secreto, sólo pasa el token de ese tenant', () => {
  it('el token propio autoriza', async () => {
    const { signKitchenToken, verifyKitchenToken } = await cargar(SECRETO)
    const token = signKitchenToken('amalay')
    expect(token).toBeTruthy()
    expect(verifyKitchenToken('amalay', token)).toBe(true)
  })

  it('el token de OTRO tenant no autoriza — esto es lo que impide enumerar', async () => {
    const { signKitchenToken, verifyKitchenToken } = await cargar(SECRETO)
    const ajeno = signKitchenToken('lab-resto')
    expect(verifyKitchenToken('amalay', ajeno)).toBe(false)
  })

  it('sin token no autoriza', async () => {
    const { verifyKitchenToken } = await cargar(SECRETO)
    expect(verifyKitchenToken('amalay', null)).toBe(false)
    expect(verifyKitchenToken('amalay', undefined)).toBe(false)
    expect(verifyKitchenToken('amalay', '')).toBe(false)
  })

  it('un token de largo distinto no revienta la comparación', async () => {
    // timingSafeEqual lanza si los buffers miden distinto; hay que compararlo antes.
    const { verifyKitchenToken } = await cargar(SECRETO)
    expect(() => verifyKitchenToken('amalay', 'corto')).not.toThrow()
    expect(verifyKitchenToken('amalay', 'corto')).toBe(false)
  })

  it('el token es determinista: la misma entrada da lo mismo', async () => {
    // De esto depende que no haya que guardarlo en BD.
    const { signKitchenToken } = await cargar(SECRETO)
    expect(signKitchenToken('amalay')).toBe(signKitchenToken('amalay'))
  })

  it('secretos distintos producen tokens distintos', async () => {
    const a = (await cargar(SECRETO)).signKitchenToken('amalay')
    const b = (await cargar('y'.repeat(32))).signKitchenToken('amalay')
    expect(a).not.toBe(b)
  })

  it('vector conocido — ata esta librería a scripts/token-cocina.mjs', async () => {
    // El script de provisión reimplementa el HMAC en Node puro, porque corre fuera de
    // Next. Si una de las dos partes cambia el mensaje que firma (hoy `kitchen:<id>`) o
    // la codificación (base64url), los tokens dejan de coincidir y la cocina se queda sin
    // comandas — sin ningún error visible, porque cada lado sigue siendo coherente
    // consigo mismo. Este vector es lo único que las mantiene juntas.
    const { signKitchenToken } = await cargar('secreto-de-prueba-no-real-32chars')
    expect(signKitchenToken('amalay')).toBe('H16pLe-zF3izCtuHSawYY7tUxUg5TN-4HDJMPYEaRUw')
  })
})
