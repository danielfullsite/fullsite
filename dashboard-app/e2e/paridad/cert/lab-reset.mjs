// lab:reset:g01 — deja el laboratorio listo para otra corrida SIN borrar historia.
//
// Hasta la primera corrida real con S6, «tenant limpio» quería decir
// `order_count = 0`. Dejó de valer en cuanto G01 creó su primera orden de
// verdad: la historia se acumula, y borrarla sería destruir justo la evidencia
// que la certificación produce.
//
// Lo que se exige ahora es ACTIVE_CERT_ORDERS = 0: ninguna orden CERT viva.
// Las canceladas y cerradas se quedan donde están.
//
// ── CÓMO SE CANCELA, Y POR QUÉ ASÍ ──────────────────────────────────────────
// Por el mismo contrato que usa el POS cuando un gerente anula una cuenta
// (page.tsx:3132): POST /api/pos/save-order con `status: 'cancelada'`,
// `expected_revision` para el control de concurrencia y `save_operation_id`
// para la idempotencia. Nada de DELETE, nada de SQL, el audit trail intacto.
//
// ── LA GUARDA ───────────────────────────────────────────────────────────────
// Esto cancela órdenes. El token se obtiene con el PIN del laboratorio y se
// comprueba que su `cid` sea EXACTAMENTE fullsite-cert-lab-v2 antes de tocar
// nada; el proxy además reescribe el scope desde ese mismo token. Si no coincide,
// no se cancela nada y se dice por qué.
//
//   node cert/lab-reset.mjs

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { OBJETIVO, ENTORNO } from './objetivo-g01.mjs'

const TENANT = 'fullsite-cert-lab-v2'
const API = ENTORNO.baseUrl
/** Estados en los que una orden sigue VIVA y ocupa la mesa. */
const ACTIVOS = ['abierta', 'enviada', 'en_preparacion', 'preparando', 'lista']

const uuid = () => crypto.randomUUID()

/**
 * Cancela las órdenes CERT vivas del laboratorio y devuelve evidencia.
 * `pin` se pasa desde fuera para que este módulo no decida de dónde sale.
 */
export async function labReset({ pin, mesa = OBJETIVO.mesa, producto = OBJETIVO.producto } = {}) {
  if (!pin) return { ok: false, motivo: 'sin PIN: no se puede autenticar contra el laboratorio' }

  // ── 1 · Token, y la guarda dura sobre su tenant ──────────────────────────
  const rp = await fetch(`${API}/api/pos/pin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin, client_id: TENANT, device_id: 'cert-lab-reset' }),
    signal: AbortSignal.timeout(20000),
  })
  const token = (await rp.json().catch(() => ({})))?.shiftToken
  if (!token) return { ok: false, motivo: `el PIN no autenticó (HTTP ${rp.status})` }

  let meta = null
  try { meta = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8')) } catch { /* opaco */ }
  if (meta?.cid !== TENANT) {
    return { ok: false, motivo: `el token pertenece a «${meta?.cid}», no a «${TENANT}»: no se cancela nada` }
  }

  const proxy = async (ruta, opciones = {}) => {
    const r = await fetch(`${API}/api/pos/db?path=${encodeURIComponent(ruta)}`, {
      ...opciones,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opciones.headers || {}) },
      signal: AbortSignal.timeout(20000),
    })
    const t = await r.text(); let c = t; try { c = JSON.parse(t) } catch { /* texto */ }
    return { ok: r.ok, estado: r.status, cuerpo: c }
  }

  // ── 2 · Localizar SÓLO las órdenes CERT vivas ────────────────────────────
  const buscar = async () => {
    const r = await proxy(`pos_orders?select=id,mesa,status,order_revision,items,created_at`
      + `&status=in.(${ACTIVOS.join(',')})&order=created_at.desc&limit=50`)
    if (!r.ok) return { error: `HTTP ${r.estado}`, filas: [] }
    const todas = Array.isArray(r.cuerpo) ? r.cuerpo : []
    // «CERT» no es un adorno: es lo que impide cancelar una orden que no sea
    // del fixture si algún día este tenant se usa para otra cosa.
    const esCert = (o) => (Array.isArray(o.items) ? o.items : [])
      .some(it => String(it?.nombre ?? it?.name ?? '').toUpperCase().includes('CERT-'))
    return { error: null, filas: todas.filter(esCert), todas }
  }

  const antes = await buscar()
  if (antes.error) return { ok: false, motivo: `no se pudo leer pos_orders: ${antes.error}` }

  // ── 3 · Cancelar cada una por el contrato del producto ───────────────────
  const canceladas = []
  for (const o of antes.filas) {
    /* La revisión se RELEE justo antes de cada intento y se reintenta ante
       conflicto. No es terquedad: Pedro sincroniza esta misma orden cada 5 s, así
       que la revisión que se leyó al listar puede haber avanzado para cuando sale
       el POST — el primer intento dio HTTP 409 exactamente por eso. Es el mismo
       ciclo releer-reintentar que hace el POS cuando otra terminal tocó la cuenta. */
    let resultado = null
    for (let intento = 1; intento <= 3; intento++) {
      const fresca = await proxy(`pos_orders?id=eq.${o.id}&select=id,status,order_revision,items,turno_id,mesa,mesero,personas&limit=1`)
      const fila = fresca.ok && Array.isArray(fresca.cuerpo) ? fresca.cuerpo[0] : null
      if (!fila) { resultado = { http: fresca.estado, ok: false, motivo: 'no se pudo releer la orden' }; break }
      if (!ACTIVOS.includes(String(fila.status))) { resultado = { http: 200, ok: true, yaInactiva: true }; break }

      const r = await fetch(`${API}/api/pos/save-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          order_id: fila.id,
          expected_revision: fila.order_revision ?? 0,
          save_operation_id: uuid(),
          status: 'cancelada',
          items: Array.isArray(fila.items) ? fila.items : [],
          // `turno_id` NO es opcional. Sin él, save-order responde
          // 409 {conflict:true, error:'TURN_NOT_FOUND'} — que se lee como
          // conflicto de revisión y manda a reintentar por el lado equivocado.
          // El POS lo manda siempre (pos-data.ts:1380); este reset también.
          turno_id: fila.turno_id,
          mesa: fila.mesa,
          mesero: fila.mesero ?? 'lab:reset:g01',
          personas: fila.personas ?? 1,
          notas: 'ANULADA: reset de laboratorio de certificación (lab:reset:g01)',
        }),
        signal: AbortSignal.timeout(20000),
      })
      const res = await r.json().catch(() => ({}))
      const conflicto = r.status === 409 || res.conflict === true
      const motivoServidor = res.error ?? null
      resultado = { http: r.status, ok: r.ok && !conflicto, conflicto, intentos: intento,
                    revisionUsada: fila.order_revision, motivoServidor }
      if (!conflicto) break
      await new Promise(x => setTimeout(x, 1500))
    }
    canceladas.push({ id: o.id, mesa: o.mesa, estadoPrevio: o.status, ...resultado })
  }

  // ── 4 · DEMOSTRARLO releyendo ────────────────────────────────────────────
  //     Un 200 de save-order no es prueba: la revisión pudo chocar y el
  //     endpoint devuelve `conflict` con HTTP 200.
  await new Promise(r => setTimeout(r, 2500))
  const despues = await buscar()
  const activasCert = despues.error ? null : despues.filas.length
  const abiertaEnMesa = despues.error ? null
    : despues.filas.some(o => String(o.mesa) === String(mesa))

  return {
    ok: activasCert === 0 && abiertaEnMesa === false,
    tenant: TENANT,
    active_cert_orders_antes: antes.filas.length,
    active_cert_orders: activasCert,
    open_order_for_mesa: abiertaEnMesa,
    canceladas,
    motivo: activasCert === 0 && abiertaEnMesa === false ? null
      : (despues.error ? `no se pudo releer: ${despues.error}`
        : `quedan ${activasCert} orden(es) CERT activas`),
  }
}

/* ── Ejecutable directo ──────────────────────────────────────────────────── */
if (import.meta.url === `file://${process.argv[1]}`) {
  const pin = process.env.FULLSITE_PIN
    || (() => { try { return readFileSync(join(homedir(), '.fullsite-cert-pin-gerente'), 'utf8').trim() } catch { return '' } })()
  const r = await labReset({ pin })
  console.log('lab:reset:g01')
  console.log('═'.repeat(66))
  console.log(`  tenant                 ${r.tenant ?? '(no autenticado)'}`)
  console.log(`  órdenes CERT activas   ${r.active_cert_orders_antes ?? '?'} → ${r.active_cert_orders ?? '?'}`)
  console.log(`  orden abierta en mesa  ${r.open_order_for_mesa}`)
  for (const c of r.canceladas ?? []) {
    console.log(`   ${c.ok ? '·' : '✗'} ${c.id.slice(0, 8)}… mesa ${c.mesa} (${c.estadoPrevio}) → HTTP ${c.http}`
      + (c.conflicto ? ' CONFLICTO de revisión' : ''))
  }
  console.log(`\n  LAB_RESET_OK = ${r.ok}${r.motivo ? ` · ${r.motivo}` : ''}`)
  process.exit(r.ok ? 0 : 1)
}
