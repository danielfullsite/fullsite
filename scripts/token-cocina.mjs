#!/usr/bin/env node
/**
 * Calcula el token de cocina de un tenant, para provisionar sus pantallas KDS.
 *
 * POR QUÉ EXISTE
 * `/api/pos/kitchen` exige `x-kitchen-token`. La pantalla lo lee de
 * localStorage['pos_kitchen_token']. El token es determinista —no se guarda en la base—
 * así que se calcula aquí y se pega en cada pantalla.
 *
 * El procedimiento completo, y el orden que NO hay que invertir, está en
 * docs/security/ACTIVAR-KITCHEN-TOKEN.md. Resumen: provisionar las pantallas ANTES de
 * poner el secreto en Vercel; si se hace al revés, la cocina se queda sin comandas.
 *
 * USO
 *   KITCHEN_TOKEN_SECRET='...' node scripts/token-cocina.mjs amalay
 *   KITCHEN_TOKEN_SECRET='...' node scripts/token-cocina.mjs amalay demo lab-resto
 *
 * El secreto se pasa por variable de entorno a propósito: no como argumento, porque los
 * argumentos quedan en el historial del shell y en la lista de procesos.
 */
import { createHmac } from 'node:crypto'

const SECRET = process.env.KITCHEN_TOKEN_SECRET || ''
const tenants = process.argv.slice(2)

if (SECRET.length < 16) {
  console.error('Falta KITCHEN_TOKEN_SECRET (mínimo 16 caracteres).')
  console.error("Uso:  KITCHEN_TOKEN_SECRET='...' node scripts/token-cocina.mjs <client_id> [...]")
  process.exit(1)
}
if (tenants.length === 0) {
  console.error('Falta al menos un client_id.')
  console.error("Uso:  KITCHEN_TOKEN_SECRET='...' node scripts/token-cocina.mjs <client_id> [...]")
  process.exit(1)
}

const CLIENT_RE = /^[a-z0-9_-]{1,40}$/i
const invalidos = tenants.filter((t) => !CLIENT_RE.test(t))
if (invalidos.length > 0) {
  // Mismo patrón que valida el endpoint. Firmar un slug que el endpoint va a rechazar
  // produce un token que no sirve para nada y cuesta un viaje a la cocina descubrirlo.
  console.error(`client_id inválido: ${invalidos.join(', ')}`)
  process.exit(1)
}

// Debe coincidir exactamente con signKitchenToken() en
// dashboard-app/src/lib/kitchen-token.ts. Si uno cambia, el otro también.
const firmar = (clientId) =>
  createHmac('sha256', SECRET).update(`kitchen:${clientId}`).digest('base64url')

console.log('')
console.log('Pega esto en la consola de CADA pantalla KDS del tenant correspondiente:')
console.log('')
for (const t of tenants) {
  console.log(`  // ${t}`)
  console.log(`  localStorage.setItem('pos_kitchen_token', '${firmar(t)}')`)
  console.log('')
}
console.log('Después recarga la pantalla y confirma que siguen llegando comandas.')
console.log('El secreto va a Vercel HASTA que todas las pantallas estén provisionadas.')
console.log('')
