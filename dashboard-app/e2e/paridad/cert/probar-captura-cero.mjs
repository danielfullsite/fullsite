// CAPTURE_ONLY: ¿DE VERDAD NO SALE NADA?
//
// La promesa del modo CAPTURE_ONLY es una sola: se puede correr mil veces sin
// escribir un peso ni mover una mesa. Era FALSA hasta el 15-sep —`logAudit`
// (pos-data.ts:2025) postea derecho a `${SUPABASE_URL}/rest/v1/pos_audit_log`,
// no por `/api/`, y la condición de la sonda no lo cubría: se escapaba y
// escribía de verdad en la base del tenant.
//
// Esta prueba existe para que eso no vuelva a pasar en silencio.
//
// ── CÓMO ESTÁ HECHA ────────────────────────────────────────────────────────
// Sin base real, sin navegador, sin red. Se le arma a la SONDA un `window`
// falso con un `fetch` espía que hace de «la red de verdad». Después se le
// pasan URLs y se comprueban DOS cosas por cada una:
//
//   1. en qué categoría del manifiesto quedó anotada;
//   2. si el fetch espía fue llamado — o sea, si SALIÓ.
//
// Se ejerce la SONDA REAL (`sonda.mjs`), no una copia del criterio. Un
// test que reimplementa la regla que vigila sigue en verde cuando el código
// real ya cambió, y entonces no vigila nada.
//
//   node cert/probar-captura-cero.mjs

import { SONDA } from '../sonda.mjs'

let fallos = 0
const T = (nombre, ok, detalle = '') => {
  if (!ok) fallos++
  console.log(`   ${ok ? '✓' : '✗'} ${nombre}${ok || !detalle ? '' : `  → ${detalle}`}`)
}

/* ═══════════════════════════════════════════════════════════════════════════
   EL NAVEGADOR FALSO
   ═══════════════════════════════════════════════════════════════════════════ */
function montarSonda() {
  const salieron = []   // todo lo que la sonda dejó pasar a «la red»

  const fetchEspia = async (entrada, opciones = {}) => {
    const url = typeof entrada === 'string' ? entrada : String(entrada?.url ?? entrada)
    salieron.push({ url, metodo: (opciones.method || 'GET').toUpperCase() })
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' }
  }

  // Lo mínimo que la SONDA toca del navegador.
  const win = { fetch: fetchEspia }
  globalThis.window = win
  globalThis.IDBObjectStore = { prototype: { put() {}, add() {}, name: 'falso' } }
  globalThis.Storage = { prototype: { setItem() {} } }
  globalThis.Response = class {
    constructor(cuerpo, init = {}) { this._c = cuerpo; this.status = init.status ?? 200; this.ok = this.status < 400 }
    async json() { return JSON.parse(this._c) }
  }

  SONDA()
  return {
    fetch: win.fetch,
    salieron,
    efectos: () => win.__efectos ?? globalThis.window.__efectos ?? [],
    limpiar: () => { salieron.length = 0; (globalThis.window.__efectos ?? []).length = 0 },
  }
}

const s = montarSonda()

const SUPA = 'https://qjiomlvudfmzuvqvhwpk.supabase.co'
const PEDRO = 'http://127.0.0.1:7717'

/** Ejecuta una petición contra la sonda y devuelve qué pasó. */
async function pedir(url, metodo = 'POST', cuerpo = null) {
  s.limpiar()
  const res = await s.fetch(url, { method: metodo, body: cuerpo ? JSON.stringify(cuerpo) : undefined })
  const efs = (globalThis.window.__efectos ?? []).map(e => e.categoria)
  return { salio: s.salieron.length > 0, categorias: efs, res }
}

console.log('CAPTURE_ONLY · cero escrituras reales\n' + '═'.repeat(68))

/* ═══════════════════════════════════════════════════════════════════════════
   1 · LAS ESCRITURAS DE NEGOCIO NO SALEN
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n1. ESCRITURAS DE NEGOCIO — interceptadas, NO salen')

const negocio = [
  ['POST  /api/pos/save-order',            `/api/pos/save-order`,            'POST',   'api_writes'],
  ['PATCH /api/pos/orders',                `/api/pos/orders`,                'PATCH',  'api_writes'],
  ['DELETE /api/pos/orders/1',             `/api/pos/orders/1`,              'DELETE', 'api_writes'],
  ['POST  supabase /rest/v1/pos_orders',   `${SUPA}/rest/v1/pos_orders`,     'POST',   'api_writes'],
  ['PATCH supabase /rest/v1/pos_turnos',   `${SUPA}/rest/v1/pos_turnos`,     'PATCH',  'api_writes'],
  ['POST  Pedro /events (comanda)',        `${PEDRO}/events`,                'POST',   'pedro_events'],
  ['POST  Pedro /print',                   `${PEDRO}/print`,                 'POST',   'print_jobs'],
  ['POST  Pedro /drawer',                  `${PEDRO}/drawer`,                'POST',   'cash_drawer'],
]

for (const [nombre, url, metodo, categoriaEsperada] of negocio) {
  const r = await pedir(url, metodo, { mesa: 1, items: [{ nombre: 'X', cantidad: 1, station: 'cocina' }] })
  T(`${nombre} — no sale`, r.salio === false, r.salio ? 'SALIÓ A LA RED' : '')
  T(`${nombre} — anotada en ${categoriaEsperada}`, r.categorias.includes(categoriaEsperada),
    `quedó en: ${r.categorias.join(',') || '(nada)'}`)
}

/* ═══════════════════════════════════════════════════════════════════════════
   2 · logAudit — EL CASO QUE SE ESCAPABA
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n2. logAudit DIRECTO A SUPABASE REST — el que se escapaba')

const audit = await pedir(`${SUPA}/rest/v1/pos_audit_log`, 'POST',
  { action: 'order_sent', actor: 'CERT', order_id: 'abc', mesa: 1 })
T('POST /rest/v1/pos_audit_log — NO sale', audit.salio === false, audit.salio ? 'SALIÓ A LA RED' : '')
T('POST /rest/v1/pos_audit_log — anotada en audit_events', audit.categorias.includes('audit_events'),
  `quedó en: ${audit.categorias.join(',') || '(nada)'}`)

/* ═══════════════════════════════════════════════════════════════════════════
   3 · LA COMANDA SE REPARTE — sin esto M1/M2/M3 no aplican
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n3. EL REPARTO POR CATEGORÍA')

const comanda = await pedir(`${PEDRO}/events`, 'POST', {
  command_type: 'ORDER_SENT', mesa: 4,
  items: [
    { nombre: 'CERT-G01-PLATO', cantidad: 2, station: 'cocina', modificadores: ['CERT-G01-ESTANDAR'] },
    { nombre: 'CERT-G01-BEBIDA', cantidad: 1, station: 'barra', modificadores: [] },
  ],
})
T('ORDER_SENT produce kds_events', comanda.categorias.includes('kds_events'),
  `quedó en: ${comanda.categorias.join(',')}`)
const kds = (globalThis.window.__efectos ?? []).filter(e => e.categoria === 'kds_events').map(e => e.dato)
T('una comanda por estación (barra y cocina)', kds.length === 2, `llegaron ${kds.length}`)
T('la comanda trae estacion', kds.every(k => !!k.estacion), JSON.stringify(kds).slice(0, 120))
T('la comanda trae items con q (M1 la muta)', kds.every(k => k.items?.every(i => typeof i.q === 'number')),
  JSON.stringify(kds).slice(0, 120))

/* ═══════════════════════════════════════════════════════════════════════════
   4 · LAS PRECONDICIONES PASAN ÍNTEGRAS
   ───────────────────────────────────────────────────────────────────────────
   Entrar al sistema no es uno de los efectos que el guion mide. Interceptarlo
   rompe el guion y el fallo se disfraza de defecto del producto: la sonda
   contestaba el POST del PIN con `{ok:true,capturado:true}`, un cuerpo sin
   `staff.id` ni `actor_token`, el POS lo rechazaba —correctamente— y mostraba
   «Caja no confirmó la sesión». Se leyó como «el POS no deja entrar».
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n4. AUTENTICACIÓN E IDENTIDAD — pasan ÍNTEGRAS')

const precondiciones = [
  ['POST Pedro /auth/pin',      `${PEDRO}/auth/pin`,   'POST'],
  ['GET  Pedro /auth/status',   `${PEDRO}/auth/status`, 'GET'],
  ['POST /api/pos/pin',         `/api/pos/pin`,         'POST'],
  ['POST Pedro /fp/list',       `${PEDRO}/fp/list`,     'POST'],
  ['GET  Pedro /identity',      `${PEDRO}/identity`,    'GET'],
]
for (const [nombre, url, metodo] of precondiciones) {
  const r = await pedir(url, metodo, { pin: '****' })
  T(`${nombre} — pasa al Pedro real`, r.salio === true, 'FUE INTERCEPTADA')
  T(`${nombre} — no contamina el manifiesto`, r.categorias.length === 0,
    `quedó en: ${r.categorias.join(',')}`)
}

// Las lecturas tampoco se interceptan: no son efectos.
const lectura = await pedir('/api/pos/menu', 'GET')
T('GET /api/pos/menu — pasa (una lectura no es un efecto)', lectura.salio === true)

/* ═══════════════════════════════════════════════════════════════════════════
   5 · EL RECUENTO
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n5. RECUENTO DE ESCRITURAS REALES')

// Se repasa toda la matriz de negocio + audit contando cuántas salieron.
let realWrites = 0
for (const [, url, metodo] of [...negocio, ['audit', `${SUPA}/rest/v1/pos_audit_log`, 'POST']]) {
  const r = await pedir(url, metodo, { mesa: 1, items: [] })
  if (r.salio) realWrites++
}
console.log(`\n   CAPTURE_ONLY_REAL_WRITES = ${realWrites}`)
T('CAPTURE_ONLY_REAL_WRITES === 0', realWrites === 0, `salieron ${realWrites}`)

/* ═══════════════════════════════════════════════════════════════════════════
   6 · LA PRUEBA SE VE FALLAR
   ───────────────────────────────────────────────────────────────────────────
   Un guardián que nunca delató nada no se distingue de uno roto. Aquí se
   reconstruye el criterio VIEJO —`url.includes('/api/') || esPedro`— y se
   exige que bajo él el POST de auditoría SÍ se escape. Si algún día esta
   comprobación deja de detectarlo, la prueba de arriba tampoco sirve.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n6. LA REGRESIÓN, SIMULADA — la prueba debe detectarla')

const urlAudit = `${SUPA}/rest/v1/pos_audit_log`
const criterioViejo = (url) => url.includes('/api/') || /127\.0\.0\.1:7717|:7717\//.test(url)
const criterioActual = (url) => url.includes('/api/') || /127\.0\.0\.1:7717|:7717\//.test(url) || /\/rest\/v1\//.test(url)

T('con el criterio VIEJO el POST de auditoría se escapaba', criterioViejo(urlAudit) === false,
  'el criterio viejo ya lo cubría — revisar la premisa')
T('con el criterio ACTUAL queda capturado', criterioActual(urlAudit) === true)
T('la sonda real usa el criterio ACTUAL', audit.salio === false,
  'la sonda dejó salir la auditoría: REGRESIÓN')

console.log('\n' + '═'.repeat(68))
if (fallos) {
  console.log(`*** ${fallos} comprobaciones fallaron.`)
  console.log('*** CAPTURE_ONLY NO GARANTIZA CERO ESCRITURAS. No certificar.')
  process.exit(1)
}
console.log('>>> CAPTURE_ONLY_REAL_WRITES = 0')
console.log('    Negocio y auditoría quedan capturados; autenticación e identidad pasan')
console.log('    íntegras como precondiciones. La regresión de logAudit está cerrada.')
