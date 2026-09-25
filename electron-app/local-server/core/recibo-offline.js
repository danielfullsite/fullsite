'use strict'
// Recibo de APROBACIÓN OFFLINE firmado por la Caja (bloque POS, 2026-09-24).
//
// Antes, una cancelación o reapertura aprobada sin internet llegaba al servidor como
// `offline_approved: true`: una AFIRMACIÓN del cliente (manager-approval.ts lo documenta).
// Cualquier mesero podía mandarla. El cierre que ese archivo describía —«llave provisionada
// con red y HMAC verificable al drenar la cola»— es esto:
//
//   · La nube DERIVA una llave por terminal: K = HMAC(raíz, 'recibo:v1|<cid>|<tid>').
//     Se la entrega a la Caja una vez, con red, a través de una sesión de gerente
//     (/api/pos/terminal-receipt-key), y la Caja la guarda SELLADA por el SO.
//   · Sin red, al aprobar con un PIN que la Caja verificó contra su almacén sellado, firma
//     un recibo con K. La página lo manda como aprobación.
//   · Al drenar, el servidor re-deriva K con cid+tid del recibo y verifica: firma, tenant,
//     rol, vigencia y un solo uso por operación (pos_aprobaciones_usadas, `recibo:<non>`).
//
// Formato (el servidor lo verifica en dashboard-app/src/lib/recibo-offline.ts):
//   rcb1.<base64url(JSON claims)>.<base64url(HMAC-SHA256(K, 'rcb1.' + payload))>
const crypto = require('node:crypto')

const PREFIJO = 'rcb1'
const VIGENCIA_MS = 7 * 86400000 // lo que puede tardar en drenar una cola de varios días

function firmarRecibo(llaveHex, { cid, tid, req, sub, nam, rol, kid = 'v1', now = Date.now() }) {
  if (!/^[a-f0-9]{64}$/.test(llaveHex || '')) throw new Error('Llave de recibos inválida')
  const claims = { v: 1, kid, cid, tid, req: req || tid, sub, nam, rol, iat: now, exp: now + VIGENCIA_MS, non: crypto.randomUUID() }
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const firma = crypto.createHmac('sha256', Buffer.from(llaveHex, 'hex')).update(PREFIJO + '.' + payload).digest('base64url')
  return `${PREFIJO}.${payload}.${firma}`
}

module.exports = { firmarRecibo, PREFIJO_RECIBO: PREFIJO, VIGENCIA_RECIBO_MS: VIGENCIA_MS }
