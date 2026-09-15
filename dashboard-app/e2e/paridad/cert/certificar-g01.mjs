// certify:g01 — UN COMANDO, UN VEREDICTO.
//
// Termina siempre en PASS, FAIL o PRECONDITION_FAILURE, y deja `run.json`,
// `REPORT.md` y los artefactos. Nunca termina en «no sé»: la ausencia se
// clasifica, no se calla.
//
// El orden no es casual. L0 antes que todo, y si L0 falla NO se ejecuta el
// guion: correr el producto sobre un sistema mal sellado produce fallos que
// parecen defectos. Es exactamente lo que ya pasó dos veces en este proyecto.
//
//   node cert/certificar-g01.mjs

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { normalizar, comparar, MUTACIONES, CATEGORIAS } from '../manifiesto-de-efectos.mjs'
import { G01, OBJETIVO, ENTORNO, TOTAL_PASOS } from './objetivo-g01.mjs'
import { preflight } from './sello.mjs'
import { clasificar, veredicto, resumir as resumirClases } from './clasificar.mjs'
import { nuevoRunId, nuevoSobre, observar, validar, escribir } from './contrato.mjs'
import { generar } from './reporte.mjs'

const RAIZ = process.env.CERT_OUT || join(process.cwd(), 'e2e', 'paridad', 'artifacts')

const linea = (c = '─') => c.repeat(72)

const runId = nuevoRunId('g01')
const dir = join(RAIZ, runId)
mkdirSync(dir, { recursive: true })

const sobre = nuevoSobre({ runId, journeyId: G01.id, nombre: G01.nombre })
const clases = []
const emitir = (o) => clases.push(observar(sobre, o))

console.log(`${G01.id} · ${G01.nombre}`)
console.log(linea('═'))
console.log(`run_id   ${runId}`)
console.log(`objetivo ${OBJETIVO.categoria} / ${OBJETIVO.producto} / ${OBJETIVO.grupo} → ${OBJETIVO.opcion}`)
console.log(`blanco   ${ENTORNO.baseUrl}  ·  bridge ${ENTORNO.bridge}  ·  cdp ${ENTORNO.cdp}`)

/* ═══════════════════════════════════════════════════════════════════════════
   L0 · SELLO Y PRECONDICIONES
   ═══════════════════════════════════════════════════════════════════════════ */
console.log(`\n── L0 · precondiciones y sello ──`)
const l0 = await preflight()
sobre.identity = l0.sello
sobre.preconditions_satisfied = l0.satisfechas
sobre.correlation.pedro_seq_inicial = l0.seqInicial

for (const g of l0.gates) {
  const clase = clasificar({ fase: 'preflight', ok: g.ok, causa: g.causa })
  emitir({ id: g.id, fase: 'preflight', descripcion: g.nombre, esperado: g.esperado, observado: g.observado, clase })
  console.log(`   ${g.ok ? '·' : '✗'} ${g.id} ${g.nombre}${g.ok ? '' : `  → ${g.observado ?? ''}`}`)
}

if (!l0.satisfechas) {
  console.log(`\n${linea('═')}`)
  console.log('*** L0 NO PASÓ. El guion no se ejecuta.')
  console.log('    Un arnés que corre sobre un sistema mal sellado produce fallos que')
  console.log('    parecen defectos del producto. La ausencia se clasifica como')
  console.log('    precondición, no como defecto, y JAMÁS como aprobado.')
  await cerrar()
}

/* ═══════════════════════════════════════════════════════════════════════════
   FASE 2 · PARIDAD — dos corridas CAPTURE_ONLY
   ═══════════════════════════════════════════════════════════════════════════ */
console.log(`\n── corrida A (CAPTURE_ONLY) ──`)
const A = await correr('A')
console.log(`\n── corrida B (CAPTURE_ONLY) ──`)
const B = await correr('B')

sobre.driver = { executed: A.corrio && B.corrio, steps_total: TOTAL_PASOS, steps_ok: A.pasosOk }
sobre.steps = A.pasos
sobre.manifest_effects = Object.fromEntries(CATEGORIAS.map(c => [c, (A.manifiesto[c] ?? []).length]))
enlazarCorrelacion(A.manifiesto)

// Cada paso es una observación. La causa que trae el conductor decide la clase:
// un dato que el tenant no sembró es precondición; un control estructural que
// el arnés no encontró es del arnés. Ninguno de los dos puede ser un defecto.
for (const p of A.pasos) {
  const clase = clasificar({
    fase: 'driver', ok: p.ok, l0: l0.satisfechas, ejecuto: p.ok, causa: p.causa ?? undefined,
  })
  emitir({
    id: `paso-${p.n}`, fase: 'driver', descripcion: p.etiqueta,
    esperado: 'el paso se ejecuta', observado: p.ok ? (p.rotulo ?? 'ok') : p.motivo,
    clase, evidencia: p.evidencia,
  })
}

// ── LA COMPUERTA: sin ejecución no hay veredicto de paridad ─────────────────
// Dos corridas vacías son idénticas, y eso no dice nada del sistema.
if (!sobre.driver.executed) {
  console.log(`\n${linea('═')}`)
  console.log('*** EL GUION NO SE EJECUTÓ COMPLETO. No se declara paridad.')
  for (const [n, r] of [['A', A], ['B', B]]) {
    if (r.corrio) continue
    console.log(`\n  corrida ${n} — pasos fallidos: ${(r.manifiesto.__no_corrio?.pasosFallidos ?? []).join(', ')}`)
    const vis = r.manifiesto.__no_corrio?.enPantallaAlFallar ?? []
    if (vis.length) console.log(`  en pantalla al fallar: ${vis.join(' | ').slice(0, 260)}`)
  }
  await cerrar()
}

const nA = normalizar(A.manifiesto)
const nB = normalizar(B.manifiesto)
const dif = comparar(nA, nB)
sobre.parity = { diferencias: dif.length, detalle: dif.map(d => ({ categoria: d.categoria, motivo: d.motivo })) }
console.log(`\n${linea()}\nV1 vs V1 → ${dif.length} diferencias`)
for (const d of dif) console.log(`   ✗ ${d.categoria}: ${d.motivo}`)

emitir({
  id: 'paridad', fase: 'paridad', descripcion: 'V1 vs V1 sin deriva',
  esperado: '0 diferencias', observado: `${dif.length} diferencias`,
  clase: clasificar({ fase: 'paridad', ok: dif.length === 0, l0: l0.satisfechas, ejecuto: true, causa: 'arnes' }),
})

/* ═══════════════════════════════════════════════════════════════════════════
   LAS CINCO MUTACIONES — 5/5 o la certificación falla
   ───────────────────────────────────────────────────────────────────────────
   Antes esto imprimía «?? no aplicable» y seguía. Una mutación no aplicable
   significa que su categoría de efectos está vacía: nadie la está mirando, y
   el «cero diferencias» de esa categoría es trivialmente cierto. Eso no es un
   aprobado — es el hueco exacto que el arnés existe para no tener.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log(`\nLAS CINCO MUTACIONES, sobre el manifiesto REAL:`)
const detalleMut = []
const noAplicables = []
let detectadas = 0

for (const m of MUTACIONES) {
  const mutado = m.aplicar(B.manifiesto)
  if (!mutado) {
    noAplicables.push(m.id)
    detalleMut.push({ id: m.id, nombre: m.nombre, aplicable: false, detectada: false,
                      categorias: [], esperada: m.esperada })
    console.log(`   ✗ ${m.id} · ${m.nombre} → NO APLICABLE (categoría vacía: ${m.esperada.join('/')})`)
    emitir({
      id: `mut-${m.id}`, fase: 'mutacion', descripcion: `${m.id} ${m.nombre}`,
      esperado: `diferencia en ${m.esperada.join(' o ')}`,
      observado: 'no aplicable — la categoría de efectos está vacía',
      clase: 'NOT_OBSERVED',
    })
    continue
  }
  const diffs = comparar(nA, normalizar(mutado))
  const cats = diffs.map(x => x.categoria)
  const ok = diffs.length > 0 && m.esperada.some(c => cats.includes(c))
  if (ok) detectadas++
  detalleMut.push({ id: m.id, nombre: m.nombre, aplicable: true, detectada: ok,
                    categorias: cats, esperada: m.esperada })
  console.log(`   ${ok ? '✓' : '✗'} ${m.id} · ${m.nombre} → ${cats.join(', ') || '(nada)'}`)
  emitir({
    id: `mut-${m.id}`, fase: 'mutacion', descripcion: `${m.id} ${m.nombre}`,
    esperado: `diferencia en ${m.esperada.join(' o ')}`,
    observado: cats.length ? cats.join(', ') : 'ninguna diferencia',
    clase: clasificar({ fase: 'mutacion', ok, l0: l0.satisfechas, ejecuto: true, causa: 'arnes' }),
  })
}

sobre.mutation = { total: MUTACIONES.length, detected: detectadas,
                   no_aplicables: noAplicables, detalle: detalleMut }
console.log(`\nDETECTADAS ${detectadas}/${MUTACIONES.length}`)
if (noAplicables.length) {
  console.log(`*** ${noAplicables.join(', ')} NO APLICABLES. Una mutación no aplicable no es verde.`)
}

/* ═══════════════════════════════════════════════════════════════════════════
   FASE 3 · SANDBOX — la corrida que SÍ deja rastro, y los tres oráculos
   ───────────────────────────────────────────────────────────────────────────
   Va al final a propósito. La paridad y las mutaciones se miden en
   CAPTURE_ONLY, donde el arnés puede correr mil veces sin mover nada; sólo
   cuando esas dos compuertas ya hablaron se deja salir una escritura real.

   Y es UNA corrida, no dos: dos corridas reales dejarían dos órdenes con ids
   distintos, y la comparación de paridad se volvería ruido. Paridad mide
   intenciones; los oráculos miden efectos. Mezclarlas rompe las dos.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log(`\n── corrida SANDBOX (escribe de verdad, sólo en el laboratorio) ──`)

if (!l0.sandbox.permitido) {
  // Sin llave no hay corrida real. Los tres oráculos quedan ciegos, y eso se
  // dice — no se rellena con el manifiesto de CAPTURE_ONLY, que es la
  // tentación exacta que convierte un arnés en un sello de goma.
  console.log(`   ✗ SANDBOX no autorizado: ${l0.sandbox.motivo}`)
  sobre.sandbox = { modo: 'CAPTURE_ONLY', tenant: null, writes: 0, violations: 0,
                    detalle_violaciones: [], motivo: l0.sandbox.motivo }
  for (const o of ['db', 'pedro', 'kds']) {
    sobre.oracles[o] = { classification: 'NOT_OBSERVED',
      motivo: `sin corrida SANDBOX: ${l0.sandbox.motivo}`, detalle: null }
    emitir({ id: `oraculo-${o}`, fase: 'oraculo', descripcion: `oráculo ${o}`,
      esperado: 'efecto real observado', observado: 'no hubo corrida que observar',
      clase: 'NOT_OBSERVED' })
  }
} else {
  // El ancla temporal se toma ANTES de la corrida: sin ella, el DB oracle no
  // puede distinguir la orden de este journey de una que ya estaba.
  const desde = new Date(Date.now() - 5000).toISOString()
  const S = await correr('SANDBOX', {
    modo: 'SANDBOX',
    tenantPermitido: l0.sandbox.tenant,
    bridgeTenant: l0.sandbox.bridgeTenant,
  })

  const violaciones = S.manifiesto?.sandbox_violations ?? []
  const escrituras = S.manifiesto?.sandbox_writes ?? []
  sobre.sandbox = {
    modo: S.modoEfectivo?.efectivo ?? 'desconocido',
    tenant: l0.sandbox.tenant,
    writes: escrituras.length,
    violations: violaciones.length,
    detalle_violaciones: violaciones.slice(0, 10),
  }
  console.log(`   modo efectivo: ${sobre.sandbox.modo} · escrituras reales: ${escrituras.length}`
    + ` · bloqueadas por el guardia: ${violaciones.length}`)
  for (const v of violaciones.slice(0, 5)) console.log(`   ✗ BLOQUEADA ${v.metodo} ${v.url} → ${v.motivo}`)

  emitir({
    id: 'guardia-sandbox', fase: 'sandbox', descripcion: 'ninguna escritura fuera del laboratorio',
    esperado: '0 bloqueos', observado: `${violaciones.length} bloqueos`,
    clase: violaciones.length === 0 ? 'EXPECTED_BEHAVIOR' : 'HARNESS_ERROR',
  })

  // ── Los tres oráculos ────────────────────────────────────────────────────
  const { abrirSesion, dbOracle, pedroOracle, kdsOracle } = await import('./oraculos.mjs')
  const ses = await abrirSesion({ baseUrl: ENTORNO.baseUrl, tenant: l0.sandbox.tenant, pin: ENTORNO.pin })
  if (ses.error) console.log(`   ✗ sin sesión para los oráculos: ${ses.error}`)

  const db = await dbOracle({ baseUrl: ENTORNO.baseUrl, token: ses.token, objetivo: OBJETIVO,
                              desde, turnoId: sobre.correlation.turno_id })
  const pedro = await pedroOracle({ bridge: ENTORNO.bridge, seqInicial: l0.seqInicial,
                                    tenantEsperado: l0.sandbox.tenant })
  const kds = await kdsOracle({ orden: db.orden ?? null, objetivo: OBJETIVO })

  // La correlación se completa con lo que el oráculo encontró: los ids hijos
  // nacen al guardar, no antes.
  if (db.correlacion) Object.assign(sobre.correlation, db.correlacion)
  if (pedro.correlacion) Object.assign(sobre.correlation, pedro.correlacion)

  for (const [nombre, r] of [['db', db], ['pedro', pedro], ['kds', kds]]) {
    sobre.oracles[nombre] = { classification: r.clase, motivo: r.motivo, detalle: r.detalle }
    console.log(`   ${r.ok ? '·' : '✗'} oráculo ${nombre.padEnd(5)} ${r.clase}${r.motivo ? ` → ${String(r.motivo).slice(0, 120)}` : ''}`)
    emitir({
      id: `oraculo-${nombre}`, fase: 'oraculo', descripcion: `oráculo ${nombre}`,
      esperado: 'el efecto quedó y es el del journey',
      observado: r.motivo ?? 'confirmado', clase: r.clase,
    })
  }
}

/* ── La evidencia visual, contada sobre lo que existe en el disco ──────────── */
{
  const { existsSync, readdirSync } = await import('node:fs')
  const archivos = existsSync(dir) ? readdirSync(dir) : []
  const capturas = archivos.filter(f => f.endsWith('.png'))
  const trazas = archivos.filter(f => f.endsWith('.zip'))
  sobre.visual_evidence = { capturas: capturas.length, trazas: trazas.length,
                            archivos: [...capturas, ...trazas].slice(0, 40) }
  console.log(`\nevidencia visual: ${capturas.length} capturas · ${trazas.length} trazas`)
  emitir({
    id: 'evidencia-visual', fase: 'evidencia', descripcion: 'capturas suficientes para auditar',
    esperado: '≥ 2 capturas', observado: `${capturas.length} capturas`,
    clase: capturas.length >= 2 ? 'EXPECTED_BEHAVIOR' : 'HARNESS_ERROR',
  })
}

await cerrar()

/* ═══════════════════════════════════════════════════════════════════════════
   Utilidades
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * El conductor se carga TARDE, a propósito.
 *
 * Importarlo arriba arrastra `playwright` al arranque, y en un checkout sin
 * `node_modules` el proceso moría con un stack trace de Node antes de que L0
 * pudiera decir nada. Un arnés que truena no clasifica: el veredicto se
 * convierte en «el comando falló», que es justo lo que este diseño existe para
 * no producir. Cargado aquí, una dependencia ausente es una observación
 * ENVIRONMENT_ERROR con su sobre y su reporte, como cualquier otro fallo.
 */
async function correr(etiqueta, extra = {}) {
  try {
    const { conducirV1 } = await import('../conductor-v1.mjs')
    const r = await conducirV1(G01, {
      evidencia: dir, corridaId: etiqueta, objetivo: OBJETIVO,
      ...(l0.cdpUrl ? { cdp: l0.cdpUrl } : {}),
      ...extra,
    })
    for (const p of r.pasos) {
      console.log(`   ${p.ok ? '·' : '✗'} ${p.n} ${p.etiqueta}${p.ok ? (p.rotulo ? `: «${String(p.rotulo).slice(0, 40)}»` : '') : `  → ${p.motivo}`}`)
    }
    console.log(`   efectos: ${CATEGORIAS.map(c => [c, (r.manifiesto[c] ?? []).length]).filter(([, n]) => n).map(([c, n]) => `${c}=${n}`).join(' ') || '(ninguno)'}`)
    return r
  } catch (e) {
    // Un fallo de infraestructura del arnés NO es un defecto del producto.
    console.log(`   ✗ la corrida ${etiqueta} no pudo ejecutarse: ${e.message}`)
    emitir({
      id: `corrida-${etiqueta}`, fase: 'driver', descripcion: `corrida ${etiqueta}`,
      esperado: 'el conductor ejecuta el guion', observado: e.message,
      clase: clasificar({ fase: 'driver', ok: false, l0: l0.satisfechas, ejecuto: false, causa: 'entorno' }),
    })
    return { manifiesto: {}, pasos: [], corrio: false, pasosOk: 0, pasosTotal: TOTAL_PASOS, bitacora: [] }
  }
}

/** Enlaza los ids hijos al `run_id`. Aparecen tarde; se buscan donde caen. */
function enlazarCorrelacion(manifiesto) {
  const buscar = (campo) => {
    for (const cat of ['api_writes', 'sync_queue', 'pedro_events', 'local_db_writes', 'order_state']) {
      for (const e of manifiesto[cat] ?? []) {
        const v = e?.[campo] ?? e?.cuerpo?.[campo] ?? e?.resumen?.[campo]
        if (v) return v
      }
    }
    return null
  }
  sobre.correlation.save_operation_id = buscar('save_operation_id') ?? buscar('command_id')
  sobre.correlation.order_id = buscar('order_id') ?? buscar('id')
  sobre.correlation.turno_id = buscar('turno_id')
}

async function cerrar() {
  sobre.finished_at = new Date().toISOString()
  sobre.summary = resumirClases(clases)

  const v = veredicto(clases)
  sobre.verdict = v.verdict
  sobre.verdict_razon = v.razon

  const faltas = validar(sobre)
  if (faltas.length) {
    // El sobre mal formado no se acepta: si el validador encuentra algo, el
    // veredicto baja a FAIL y se dice por qué. Un validador que sólo aprueba
    // no valida.
    sobre.contract_violations = faltas
    if (sobre.verdict === 'PASS') {
      sobre.verdict = 'FAIL'
      sobre.verdict_razon = `el sobre violó el contrato: ${faltas.map(f => f.regla).join(', ')}`
    }
  }

  const rutaJson = escribir(sobre, dir)
  const rutaMd = generar(sobre, dir)

  console.log(`\n${linea('═')}`)
  console.log(`${G01.id} ${sobre.verdict}`)
  console.log(`  ${sobre.verdict_razon}`)
  if (sobre.verdict !== 'PASS') {
    const primera = sobre.observations.find(o => o.classification !== 'EXPECTED_BEHAVIOR')
    if (primera) {
      console.log(`  paso/compuerta : ${primera.id} — ${primera.descripcion}`)
      console.log(`  clasificación  : ${primera.classification}`)
      console.log(`  esperado       : ${fmtCorto(primera.esperado)}`)
      console.log(`  observado      : ${fmtCorto(primera.observado)}`)
    }
  }
  for (const f of faltas) console.log(`  contrato ${f.regla}: ${f.motivo}`)
  console.log(`\n  run.json   ${rutaJson}`)
  console.log(`  REPORT.md  ${rutaMd}`)
  console.log(`  artefactos ${dir}`)

  process.exit(sobre.verdict === 'PASS' ? 0 : 1)
}

function fmtCorto(v) {
  if (v === null || v === undefined) return '—'
  return typeof v === 'object' ? JSON.stringify(v).slice(0, 120) : String(v).slice(0, 120)
}
