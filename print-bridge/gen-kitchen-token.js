#!/usr/bin/env node
// Genera el token de cocina de un cliente para provisionar el KDS.
// El token es determinista: HMAC(client_id, KITCHEN_TOKEN_SECRET). Debe coincidir
// con el mismo secreto que está en Vercel (env KITCHEN_TOKEN_SECRET).
//
// Uso:
//   KITCHEN_TOKEN_SECRET="<secreto>" node gen-kitchen-token.js amalay
//
// El valor impreso va en el config.json de la caja/KDS como "kitchen_token".

import { createHmac } from 'crypto'

const secret = process.env.KITCHEN_TOKEN_SECRET || ''
const clientId = (process.argv[2] || '').toLowerCase().trim()

if (secret.length < 16) {
  console.error('[error] Falta KITCHEN_TOKEN_SECRET (>= 16 chars) en el env.')
  process.exit(1)
}
if (!/^[a-z0-9_-]{1,40}$/i.test(clientId)) {
  console.error('[error] Uso: KITCHEN_TOKEN_SECRET="..." node gen-kitchen-token.js <client_id>')
  process.exit(1)
}

const token = createHmac('sha256', secret).update(`kitchen:${clientId}`).digest('base64url')
console.log(token)
