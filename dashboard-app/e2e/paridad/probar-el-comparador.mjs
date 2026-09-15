// ¿EL ARNÉS DETECTA UNA DIFERENCIA CUANDO LA HAY?
//
// Un comparador que siempre dice «cero diferencias» es indistinguible de uno
// roto. Antes de creerle un cero hay que verlo delatar diferencias que sabemos
// que existen. Eso es lo que hace este archivo.
//
// ── ALCANCE, DECLARADO ──────────────────────────────────────────────────────
// Esto prueba EL COMPARADOR Y EL NORMALIZADOR, no la captura. Que sepa
// distinguir dos manifiestos no demuestra que el manifiesto refleje lo que el
// POS hizo de verdad — eso lo demuestra la corrida V1 vs V1 contra el sistema
// vivo, que necesita el conductor y todavía no existe.
//
// Decirlo importa: confundir «probé el comparador» con «probé el arnés» sería
// exactamente el error de alcance que llevo todo el día corrigiendo.
//
//   node probar-el-comparador.mjs

import { normalizar, comparar, MUTACIONES, CATEGORIAS } from './manifiesto-de-efectos.mjs'

/* Un manifiesto con la forma real de G01: abrir mesa → agregar producto con
   modificador obligatorio → enviar. Los identificadores y relojes son distintos
   entre las dos corridas A PROPÓSITO: es lo que el normalizador debe absorber. */
const corrida = (semilla) => ({
  order_state: [{
    // La semilla va DENTRO del uuid, no pegada delante: un `1-uuid` no es un
    // identificador, es otra cosa con un uuid adentro — y el normalizador hace
    // bien en no tocarlo. (Primera corrida de esta prueba: el arnés se declaró
    // no confiable por este fixture mal armado. Justo para eso existe.)
    id: `4f2a1b3c-9d8e-4a7b-8c6d-1e2f3a4b5c6${semilla}`,
    mesa: 7, personas: 2, status: 'enviada',
    subtotal: 170, descuento: 0, iva: 27.2, total: 197.2,
    created_at: `2026-09-1${semilla}T02:10:00.000Z`,
  }],
  table_state: [{ mesa: 7, estado: 'ocupada', importe: 197.2, mesero: 'Daniel' }],
  api_writes: [{
    method: 'POST', endpoint: '/api/pos/save-order',
    save_operation_id: `op_${semilla}k3j4h5g6`,
    body: { mesa: 7, status: 'enviada', total: 197.2 },
  }],
  local_db_writes: [{ store: 'pos_orders', key: `${semilla}bcd1234efgh`, op: 'put' }],
  sync_queue: [{
    table: 'pos_orders', method: 'POST', endpoint: '/api/pos/save-order',
    transport: 'APP_API', save_operation_id: `op_${semilla}k3j4h5g6`,
  }],
  pedro_events: [{ tipo: 'ORDER_SENT', mesa: 7, ts: `2026-09-1${semilla}T02:10:01.000Z` }],
  kds_events: [{
    estacion: 'cocina', mesa: 7,
    items: [{ n: 'HUMMUS CHIPOTLE', q: 1, mods: ['PREPARACION: Normal'] }],
  }],
  audit_events: [
    { action: 'order_sent', actor: 'Daniel', order_id: `4f2a1b3c-9d8e-4a7b-8c6d-1e2f3a4b5c6${semilla}` },
  ],
  print_jobs: [{ tipo: 'comanda', estacion: 'cocina', ancho: 58 }],
  cash_drawer: [],
})

const A = normalizar(corrida('1'))
const B = normalizar(corrida('2'))   // mismos hechos, otros ids y otro reloj

console.log('ARNÉS G01 · prueba del comparador\n' + '═'.repeat(66))
console.log(`categorías observadas: ${CATEGORIAS.length}`)

// ── 1 · V1 vs V1 (con identificadores distintos) debe dar CERO ──────────────
const cero = comparar(A, B)
console.log(`\n1. DOS CORRIDAS EQUIVALENTES → ${cero.length} diferencias`)
if (cero.length) {
  for (const d of cero) console.log(`   ✗ ${d.categoria}: ${d.motivo}\n     A=${d.a}\n     B=${d.b}`)
  console.log('\n*** El normalizador no absorbe los identificadores. ARNÉS NO CONFIABLE.')
  process.exit(1)
}
console.log('   >>> ZERO DELTA — el normalizador absorbe ids y relojes sin borrar sustancia')

// ── 2 · Las cinco mutaciones deliberadas ────────────────────────────────────
console.log(`\n2. LAS CINCO MUTACIONES DELIBERADAS`)
let detectadas = 0
let noAplicables = 0
for (const m of MUTACIONES) {
  const mutado = m.aplicar(corrida('2'))
  // Una mutación no aplicable NO es un pase. Antes esto imprimía «??» y seguía
  // como si nada: una categoría de efectos vacía significa que nadie la está
  // mirando, y el «cero diferencias» de esa categoría es trivialmente cierto.
  if (!mutado) {
    noAplicables++
    console.log(`   ✗ ${m.id} NO APLICABLE sobre este manifiesto — categoría vacía: ${m.esperada.join('/')}`)
    continue
  }
  const diffs = comparar(A, normalizar(mutado))
  const categorias = diffs.map(d => d.categoria)
  const acerto = diffs.length > 0 && m.esperada.some(c => categorias.includes(c))
  if (acerto) detectadas++
  console.log(`   ${acerto ? '✓' : '✗'} ${m.id} · ${m.nombre}`)
  console.log(`        esperaba diferencia en: ${m.esperada.join(', ')}`)
  console.log(`        la encontró en        : ${categorias.join(', ') || '(ninguna)'}`)
  if (!acerto) console.log(`        *** NO DETECTADA — ${m.porQue}`)
}

console.log('\n' + '═'.repeat(66))
console.log(`DETECTADAS ${detectadas}/${MUTACIONES.length}${noAplicables ? ` · NO APLICABLES ${noAplicables}` : ''}`)
if (detectadas === MUTACIONES.length && noAplicables === 0) {
  console.log('>>> El comparador delata las cinco. Queda por probar la CAPTURA contra el sistema vivo.')
} else {
  if (noAplicables) console.log(`*** ${noAplicables} mutación(es) no aplicable(s): hay categorías del manifiesto que nadie observa.`)
  console.log('*** EL ARNÉS NO ES CONFIABLE. No continuar hasta que detecte 5/5 sin no-aplicables.')
  process.exit(1)
}
