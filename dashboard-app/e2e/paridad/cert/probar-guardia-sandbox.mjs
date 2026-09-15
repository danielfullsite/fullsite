// EL GUARDIA DE SANDBOX: ¿bloquea lo que tiene que bloquear?
//
// SANDBOX existe porque sin efectos reales no hay nada que un oráculo pueda
// observar. El precio es que ahora sí se puede romper algo — y lo que se puede
// romper es la base de un restaurante que está operando.
//
// Por eso esta prueba está escrita al revés que las demás: casi todos sus casos
// EXIGEN QUE EL GUARDIA DIGA QUE NO. Un guardia que sólo se prueba con el caso
// bueno no es un guardia; es un pasillo.
//
// Como `probar-captura-cero.mjs`, se ejerce la SONDA REAL con un `window` falso
// —sin red, sin navegador, sin base—. Una regla copiada dentro de la prueba
// seguiría en verde el día que el código real cambie, y entonces no vigila nada.
//
//   node cert/probar-guardia-sandbox.mjs

import { SONDA } from '../sonda.mjs'

const LAB = 'fullsite-cert-lab-v2'
const SUPA = 'https://qjiomlvudfmzuvqvhwpk.supabase.co'
const APP = 'https://app.fullsite.mx'
const PEDRO = 'http://127.0.0.1:7717'

let fallos = 0
const T = (nombre, ok, detalle = '') => {
  if (!ok) fallos++
  console.log(`   ${ok ? '✓' : '✗'} ${nombre}${ok || !detalle ? '' : `  → ${detalle}`}`)
}

/** Monta la sonda real sobre un navegador falso, con la configuración dada. */
function montar(cfg) {
  const salieron = []
  const win = {
    fetch: async (entrada, opciones = {}) => {
      const url = typeof entrada === 'string' ? entrada : String(entrada?.url ?? entrada)
      salieron.push({ url, metodo: (opciones.method || 'GET').toUpperCase() })
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' }
    },
  }
  globalThis.window = win
  globalThis.IDBObjectStore = { prototype: { put() {}, add() {}, name: 'falso' } }
  globalThis.Storage = { prototype: { setItem() {} } }
  globalThis.Response = class {
    constructor(cuerpo, init = {}) { this._c = cuerpo; this.status = init.status ?? 200; this.ok = this.status < 400 }
    async json() { return JSON.parse(this._c) }
  }
  SONDA(cfg)
  return {
    /** Devuelve { salio, status, violaciones, escrituras }. */
    async pedir(url, cuerpo = null, metodo = 'POST') {
      salieron.length = 0
      const efectos = globalThis.window.__efectos
      efectos.length = 0
      const res = await globalThis.window.fetch(url, {
        method: metodo, body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      })
      const cats = efectos.map(e => e.categoria)
      return {
        salio: salieron.length > 0,
        status: res.status,
        violaciones: cats.filter(c => c === 'sandbox_violations').length,
        escrituras: cats.filter(c => c === 'sandbox_writes').length,
        motivo: efectos.find(e => e.categoria === 'sandbox_violations')?.dato?.motivo ?? null,
      }
    },
    modo: () => globalThis.window.__sondaModo,
  }
}

console.log('EL GUARDIA DE SANDBOX\n' + '═'.repeat(68))

/* ═══════════════════════════════════════════════════════════════════════════
   1 · EL CASO BUENO — el laboratorio sí puede escribir
   ───────────────────────────────────────────────────────────────────────────
   Va primero porque si éste no pasa, SANDBOX no sirve para nada: no habría
   efectos que observar y los tres oráculos nacerían muertos.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n1 · el tenant de laboratorio SÍ escribe')
{
  const s = montar({ modo: 'SANDBOX', tenantPermitido: LAB })
  T('el modo efectivo es SANDBOX', s.modo().efectivo === 'SANDBOX', JSON.stringify(s.modo()))

  const a = await s.pedir(`${APP}/api/pos/save-order`, { client_id: LAB, mesa: 1 })
  T('save-order del lab SALE', a.salio && a.escrituras === 1, `salio=${a.salio} escrituras=${a.escrituras}`)

  const b = await s.pedir(`${SUPA}/rest/v1/pos_orders`, { client_id: LAB, id: 'x' })
  T('escritura REST con client_id del lab SALE', b.salio, `status=${b.status}`)

  const c = await s.pedir(`${APP}/api/pos/db?path=pos_turnos`, { fondo_inicial: 1000 })
  T('proxy del producto sin client_id SALE (el token impone el scope)', c.salio, `status=${c.status}`)
}

/* ═══════════════════════════════════════════════════════════════════════════
   2 · LOS TENANTS PROHIBIDOS — ninguno sale, y cada negativa queda anotada
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n2 · AMALAY, demo y lab-resto NO salen')
{
  const s = montar({ modo: 'SANDBOX', tenantPermitido: LAB })
  for (const malo of ['amalay', 'demo', 'lab-resto']) {
    const r = await s.pedir(`${SUPA}/rest/v1/pos_orders`, { client_id: malo, id: 'x' })
    T(`client_id=${malo} BLOQUEADO`, !r.salio && r.violaciones === 1 && r.status === 403,
      `salio=${r.salio} status=${r.status} motivo=${r.motivo}`)
  }
  // También por la URL, no sólo por el cuerpo: PostgREST filtra en query string.
  const u = await s.pedir(`${SUPA}/rest/v1/pos_orders?client_id=eq.amalay`, { total: 100 }, 'PATCH')
  T('AMALAY en la query string BLOQUEADO', !u.salio && u.violaciones === 1, `salio=${u.salio} motivo=${u.motivo}`)

  // Un tenant que no es prohibido pero tampoco es el permitido: igual se bloquea.
  const o = await s.pedir(`${SUPA}/rest/v1/pos_orders`, { client_id: 'otro-restaurante', id: 'x' })
  T('un tercer tenant cualquiera BLOQUEADO', !o.salio && o.violaciones === 1, `motivo=${o.motivo}`)
}

/* ═══════════════════════════════════════════════════════════════════════════
   3 · LO AMBIGUO FALLA CERRADO
   ───────────────────────────────────────────────────────────────────────────
   «Probablemente es del lab» no es una garantía. Una escritura a Supabase REST
   sin `client_id` legible no sale, aunque venga del mismo journey.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n3 · sin tenant legible, no sale')
{
  const s = montar({ modo: 'SANDBOX', tenantPermitido: LAB })
  const r = await s.pedir(`${SUPA}/rest/v1/pos_audit_log`, { action: 'algo' })
  T('REST sin client_id BLOQUEADO', !r.salio && r.violaciones === 1, `salio=${r.salio} motivo=${r.motivo}`)
}

/* ═══════════════════════════════════════════════════════════════════════════
   4 · EL PUENTE LOCAL — Pedro no se cree sin acreditar
   ───────────────────────────────────────────────────────────────────────────
   El Pedro vivo del 15-sep reportaba `restaurant_id: "demo"`. Escribirle sin
   comprobar a quién pertenece es escribir en el tenant de otro.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n4 · el puente local tiene que acreditar su tenant')
{
  const sinAcreditar = montar({ modo: 'SANDBOX', tenantPermitido: LAB })
  const a = await sinAcreditar.pedir(`${PEDRO}/events`, { command_type: 'ORDER_SENT', mesa: 1 })
  T('Pedro sin acreditar BLOQUEADO', !a.salio && a.violaciones === 1, `salio=${a.salio} motivo=${a.motivo}`)

  const deDemo = montar({ modo: 'SANDBOX', tenantPermitido: LAB, bridgeTenant: 'demo' })
  const b = await deDemo.pedir(`${PEDRO}/events`, { command_type: 'ORDER_SENT', mesa: 1 })
  T('Pedro que dice ser de «demo» BLOQUEADO', !b.salio && b.violaciones === 1, `motivo=${b.motivo}`)

  const delLab = montar({ modo: 'SANDBOX', tenantPermitido: LAB, bridgeTenant: LAB })
  const c = await delLab.pedir(`${PEDRO}/events`, { command_type: 'ORDER_SENT', mesa: 1 })
  T('Pedro acreditado del lab SÍ recibe', c.salio, `salio=${c.salio} motivo=${c.motivo}`)
}

/* ═══════════════════════════════════════════════════════════════════════════
   5 · EL MODO DEGRADA ANTES DE ARRIESGAR
   ───────────────────────────────────────────────────────────────────────────
   Pedir SANDBOX apuntando a cualquier cosa que no sea el laboratorio no da
   error ruidoso: da CAPTURE_ONLY. La opción segura es la que gana sola.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n5 · SANDBOX mal apuntado degrada a CAPTURE_ONLY')
{
  for (const [etiqueta, cfg] of [
    ['apuntando a AMALAY',    { modo: 'SANDBOX', tenantPermitido: 'amalay' }],
    ['apuntando a demo',      { modo: 'SANDBOX', tenantPermitido: 'demo' }],
    ['sin tenant declarado',  { modo: 'SANDBOX', tenantPermitido: null }],
    ['tenant vacío',          { modo: 'SANDBOX', tenantPermitido: '' }],
  ]) {
    const s = montar(cfg)
    const r = await s.pedir(`${SUPA}/rest/v1/pos_orders`, { client_id: cfg.tenantPermitido || LAB, id: 'x' })
    T(`${etiqueta} → CAPTURE_ONLY y nada sale`,
      s.modo().efectivo === 'CAPTURE_ONLY' && !r.salio,
      `efectivo=${s.modo().efectivo} salio=${r.salio}`)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   6 · NO HAY REGRESIÓN EN CAPTURE_ONLY
   ───────────────────────────────────────────────────────────────────────────
   El modo por defecto tiene que seguir siendo el de siempre: ni una escritura
   sale, ni siquiera la del propio laboratorio.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n6 · CAPTURE_ONLY sigue sin dejar salir nada')
{
  const s = montar()   // sin cfg: el default histórico
  T('el modo por defecto es CAPTURE_ONLY', s.modo().efectivo === 'CAPTURE_ONLY', JSON.stringify(s.modo()))
  let salieron = 0
  for (const [url, cuerpo] of [
    [`${APP}/api/pos/save-order`, { client_id: LAB }],
    [`${SUPA}/rest/v1/pos_orders`, { client_id: LAB }],
    [`${SUPA}/rest/v1/pos_audit_log`, { action: 'x' }],
    [`${PEDRO}/events`, { command_type: 'ORDER_SENT' }],
  ]) {
    const r = await s.pedir(url, cuerpo)
    if (r.salio) salieron++
  }
  T('CAPTURE_ONLY_REAL_WRITES === 0', salieron === 0, `salieron ${salieron}`)
}

console.log(`\n${'═'.repeat(68)}`)
if (fallos) {
  console.log(`*** ${fallos} comprobaciones fallaron. El guardia NO es de fiar.`)
  process.exit(1)
}
console.log('>>> EL GUARDIA BLOQUEA LO QUE DEBE Y DEJA PASAR SÓLO EL LABORATORIO')
