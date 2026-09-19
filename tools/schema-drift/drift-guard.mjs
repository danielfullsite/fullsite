#!/usr/bin/env node
/**
 * SCHEMA DRIFT GUARD — dry-run, sólo lectura, sin credenciales.
 *
 * ── QUÉ HACE ────────────────────────────────────────────────────────────────
 * Compara TRES fuentes y clasifica cada objeto verificable en exactamente un
 * estado. Nunca dos. Nunca «probablemente».
 *
 *   A  archivos de migración        (del repo, por `git ls-tree`)
 *   B  ledger schema_migrations     (filas registradas)
 *   C  efecto real en PostgreSQL    (introspección)
 *
 * ── POR QUÉ TRES Y NO DOS ───────────────────────────────────────────────────
 * Porque el 2026-09-18 se encontraron los tres desacuerdos posibles el mismo
 * día: un archivo PENDIENTE cuyo efecto está vivo y sin registrar, una función
 * viva cuya hermana no lo está, y archivos registrados en el repo cuyo efecto
 * no existe. `FILE != LEDGER != EFFECT`.
 *
 * ── LA REGLA QUE LO HACE ÚTIL ───────────────────────────────────────────────
 * El guardián NO concluye que algo está aplicado porque el archivo exista o
 * porque el ledger tenga una fila. Sólo C decide si hay efecto.
 *
 * ── LO QUE NO HACE, Y NO VA A HACER ─────────────────────────────────────────
 * No escribe. Ni al esquema, ni al ledger, ni a los archivos. No ejecuta DDL.
 * No hace `supabase db push`. No renombra migraciones. No corrige nada.
 * No toca la red: recibe la introspección ya hecha, por archivo.
 *
 * ── SIN CREDENCIALES, A PROPÓSITO ───────────────────────────────────────────
 * El guardián no se conecta a la base. Quien la consulta le pasa el resultado
 * en `--effects`. Así el binario no maneja secretos y puede correr en CI con
 * una credencial de sólo lectura que vive fuera de él.
 *
 * ── USO ─────────────────────────────────────────────────────────────────────
 *   node drift-guard.mjs \
 *     --registry registry.json \
 *     --files    files.json     \  # A: [{path}]
 *     --ledger   ledger.json    \  # B: [{version,name}]
 *     --effects  effects.json   \  # C: {"<object id>": 0|1}
 *     --repo-sha <sha> --db-identity <texto> [--out artifact.json]
 *
 * Código de salida:  0 sin deriva bloqueante · 1 con deriva bloqueante
 *                    2 error de uso o de entrada
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { hashContenido } from './hash.mjs'

// ─── Estados. Exactamente uno por objeto. ───────────────────────────────────
const S = {
  MATCH: 'MATCH',
  FILE_ONLY: 'FILE_ONLY',
  LEDGER_ONLY: 'LEDGER_ONLY',
  EFFECT_ONLY: 'EFFECT_ONLY',
  FILE_AND_EFFECT_NO_LEDGER: 'FILE_AND_EFFECT_NO_LEDGER',
  LEDGER_AND_EFFECT_NO_FILE: 'LEDGER_AND_EFFECT_NO_FILE',
  MISMATCH: 'MISMATCH',
  UNKNOWN: 'UNKNOWN',
}

/**
 * Severidad por estado.
 *   BLOCK  corrupción: el build falla
 *   WARN   puede ser legítimo (una corrida de certificación) pero hay que verlo
 *   OK     estado correcto, no es deriva
 */
const SEVERITY = {
  [S.MATCH]: 'OK',
  [S.FILE_ONLY]: 'OK',          // se ajusta abajo: depende de si el archivo es PENDIENTE_
  [S.LEDGER_ONLY]: 'BLOCK',
  [S.MISMATCH]: 'BLOCK',
  [S.EFFECT_ONLY]: 'WARN',
  [S.FILE_AND_EFFECT_NO_LEDGER]: 'WARN',
  [S.LEDGER_AND_EFFECT_NO_FILE]: 'WARN',
  [S.UNKNOWN]: 'WARN',
}

/**
 * `FILE_ONLY` significa dos cosas opuestas, y la primera corrida lo demostró.
 *
 *   PENDIENTE_20260914120000_pos_staff_pin_hash.sql sin aplicar  → correcto
 *   20260902120000_client_locations_timezone.sql sin aplicar     → deuda
 *
 * Los dos caen en `FILE_ONLY`. Tratarlos igual esconde el segundo caso, que es
 * justo el que duele: el código lee `client_locations.timezone` y la columna no
 * existe. La distinción no es un estado nuevo —los ocho estados son el contrato—
 * sino la severidad: el prefijo `PENDIENTE_` es una declaración de intención, y
 * su ausencia significa que alguien esperaba que esa migración ya estuviera.
 */
const esPendientePorDiseno = (ruta) => /(^|\/)PENDIENTE_/.test(String(ruta || ''))
function severidad(state, file) {
  if (state === S.FILE_ONLY) return esPendientePorDiseno(file) ? 'OK' : 'WARN'
  return SEVERITY[state]
}


// ─── v1.1 · FINGERPRINTS ────────────────────────────────────────────────────
/**
 * `exists` demuestra PRESENCIA. No demuestra EQUIVALENCIA.
 *
 *   OBJECT_EXISTS != OBJECT_MATCHES_EXPECTED_DEFINITION
 *
 * Una columna puede existir con otro tipo, un índice con otro predicado, una
 * función con otro `search_path` o sin `SECURITY DEFINER`. El guardián v1
 * los habría dado por buenos. Éste los compara.
 */
const DETALLE = {
  PRESENT_AND_MATCHING: 'PRESENT_AND_MATCHING',
  PRESENT_BUT_DIFFERENT: 'PRESENT_BUT_DIFFERENT',
  ABSENT: 'ABSENT',
  NOT_CHECKED: 'NOT_CHECKED',
}

/** Espacios colapsados, minúsculas, sin `public.`, sin `if not exists`, sin `;` final. */
const norm = (v) => String(v ?? '')
  .toLowerCase().replace(/\bif not exists\b/g, '').replace(/\bpublic\./g, '')
  .replace(/\s+/g, ' ').replace(/\s*;\s*$/, '').trim()
/** `search_path=a, b` y `a,b` son el mismo valor. El prefijo y los espacios no son semántica. */
const normPath = (v) => String(v ?? '').toLowerCase().replace(/^search_path\s*=\s*/, '').replace(/\s+/g, '').trim()

/** Campos comparados por tipo de objeto. Lo que no está aquí no se compara. */
const CAMPOS = {
  column:   [['data_type', norm], ['udt_name', norm], ['is_nullable', norm], ['column_default', norm]],
  index:    [['unique', v => String(v)], ['indexdef', norm]],
  function: [['args', norm], ['returns', norm], ['security_definer', v => String(v)],
             ['search_path', normPath]],   // body_md5 se compara aparte: ver abajo
  constraint: [['definition', norm]],
}

/**
 * EL HASH DEL CUERPO NECESITA DECIR CÓMO SE CALCULÓ.
 *
 * El 2026-09-19 el guardián marcó cuatro funciones como MISMATCH. Dos de ellas
 * no habían cambiado: la corrida del 18 había pinchado
 * `md5(regexp_replace(prosrc,'\s+',' ','g'))` y la del 19 observaba
 * `md5(prosrc)`. Dos formas distintas de medir lo mismo, ninguna declarada, y
 * el resultado se leía como corrupción del esquema.
 *
 * Un hash sin su método no es una huella: es un número. Desde aquí el pin
 * declara `body_md5_method` y la introspección entrega las dos variantes. Si el
 * método pedido no viene observado, el campo NO se compara y se dice —
 * comparar dos métodos distintos sería fabricar un MISMATCH, que es peor que
 * no comparar.
 */
const METODOS_BODY = { prosrc: 'body_md5', collapsed: 'body_md5_collapsed' }

function compararCuerpo(expected, observed) {
  if (!('body_md5' in expected)) return { diff: null, nota: null }
  const metodo = expected.body_md5_method ?? 'prosrc'
  const campo = METODOS_BODY[metodo]
  if (!campo) return { diff: null, nota: `método de hash desconocido: ${metodo}` }
  if (!(campo in observed) || observed[campo] === undefined || observed[campo] === null)
    return { diff: null, nota: `la introspección no trajo ${campo}: el cuerpo no se comparó` }
  const e = norm(expected.body_md5), o = norm(observed[campo])
  return e === o ? { diff: null, nota: null }
                 : { diff: { field: `body_md5(${metodo})`, expected: e, observed: o }, nota: null }
}

/**
 * Compara esperado contra observado. Devuelve el detalle y las diferencias.
 * Sólo compara los campos que el registro DECLARA esperar: un campo ausente en
 * `expected` no se inventa, y no cuenta como diferencia.
 */
function comparar(expected, observed) {
  if (!expected) return { detalle: DETALLE.NOT_CHECKED, diffs: [], razon: 'el registro no declara fingerprint esperado' }
  if (!observed) return { detalle: DETALLE.NOT_CHECKED, diffs: [], razon: 'la introspección no trajo fingerprint' }
  const campos = CAMPOS[expected.kind || observed.kind]
  if (!campos) return { detalle: DETALLE.NOT_CHECKED, diffs: [], razon: `tipo sin reglas de comparación: ${expected.kind}` }
  const diffs = []
  for (const [campo, f] of campos) {
    if (!(campo in expected)) continue           // no se exige lo que no se declaró
    const e = f(expected[campo]), o = f(observed[campo])
    if (e !== o) diffs.push({ field: campo, expected: e, observed: o })
  }
  let nota = null
  if ((expected.kind || observed.kind) === 'function') {
    const c = compararCuerpo(expected, observed)
    if (c.diff) diffs.push(c.diff)
    nota = c.nota
  }
  return diffs.length
    ? { detalle: DETALLE.PRESENT_BUT_DIFFERENT, diffs, razon: nota }
    : { detalle: DETALLE.PRESENT_AND_MATCHING, diffs: [], razon: nota }
}

/** Normaliza la entrada C: acepta el formato v1 (0|1) y el v1.1 ({exists, observed}). */
function leerEfecto(crudo) {
  if (crudo === undefined || crudo === null) return { exists: null, observed: null }
  if (typeof crudo === 'number' || typeof crudo === 'boolean') return { exists: Number(crudo) > 0, observed: null }
  return { exists: crudo.exists === true, observed: crudo.observed ?? null }
}

// ─── Entrada ────────────────────────────────────────────────────────────────
function args(argv) {
  const o = {}
  for (let i = 2; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--')) fail(`argumento inesperado: ${argv[i]}`)
    o[argv[i].slice(2)] = argv[i + 1]
  }
  return o
}
function fail(msg) { console.error(`drift-guard: ${msg}`); process.exit(2) }
function readJson(p, etiqueta) {
  try { return JSON.parse(readFileSync(p, 'utf8')) }
  catch (e) { fail(`no se pudo leer ${etiqueta} (${p}): ${e.message}`) }
}

/**
 * ¿El ledger nombra esta migración?
 *
 * Es una HEURÍSTICA por substring, y tiene que decirse: los nombres del ledger
 * NO corresponden a los nombres de archivo. `20260910050000_inventory_movement_atomic.sql`
 * está registrado como `20260911220951 inventory_movement_atomic`: otro sello,
 * otro prefijo. Por eso el empate se busca por `ledger_hint` explícito del
 * registro, puesto a mano tras leer el archivo — nunca derivado del nombre.
 *
 * Un hint sin empate NO prueba que no se aplicó. Sólo dice que el ledger no la
 * nombra así. La prueba de aplicación es C, siempre.
 */
function ledgerTiene(ledger, hint) {
  if (hint === null || hint === undefined) return null   // el objeto no espera fila propia
  return ledger.some(r => String(r.name || '').includes(hint))
}

function clasificar({ enArchivo, enLedger, enEfecto, detalle }) {
  // v1.1: existir con otra definición NO es estar aplicado. Manda sobre todo lo
  // demás, incluso con archivo + ledger + objeto presentes.
  if (detalle === DETALLE.PRESENT_BUT_DIFFERENT) return S.MISMATCH

  // El objeto no declara nada verificable: no se inventa un veredicto.
  if (enEfecto === null || enEfecto === undefined) return S.UNKNOWN

  // El objeto nace en el baseline y no espera fila de ledger propia.
  if (enLedger === null) return enEfecto ? S.MATCH : (enArchivo ? S.FILE_ONLY : S.UNKNOWN)

  if (enArchivo && enLedger && enEfecto) return S.MATCH
  if (enArchivo && !enLedger && !enEfecto) return S.FILE_ONLY
  if (!enArchivo && enLedger && !enEfecto) return S.LEDGER_ONLY
  if (!enArchivo && !enLedger && enEfecto) return S.EFFECT_ONLY
  if (enArchivo && !enLedger && enEfecto) return S.FILE_AND_EFFECT_NO_LEDGER
  if (!enArchivo && enLedger && enEfecto) return S.LEDGER_AND_EFFECT_NO_FILE
  // archivo + ledger + sin efecto: se registró y no dejó rastro.
  if (enArchivo && enLedger && !enEfecto) return S.MISMATCH
  return S.UNKNOWN
}

// ─── Principal ──────────────────────────────────────────────────────────────
const a = args(process.argv)
for (const req of ['registry', 'files', 'ledger', 'effects']) {
  if (!a[req]) fail(`falta --${req}`)
}

const registry = readJson(a.registry, 'registry')
const files = readJson(a.files, 'files')       // A
const ledger = readJson(a.ledger, 'ledger')    // B
const effects = readJson(a.effects, 'effects') // C
// Política de release: OPCIONAL y SEPARADA de la severidad. El guardián la
// adjunta al artefacto y no la usa para decidir nada. DRIFT_SEVERITY responde
// «¿el esquema corresponde a la fuente?»; RELEASE_IMPACT responde «¿esto puede
// liberarse?», y eso lo decide una persona.
const policy = a.policy ? readJson(a.policy, 'policy') : null
const politicaDe = (id) => policy?.objects?.find(o => o.object_id === id) ?? null

if (!Array.isArray(registry?.objects)) fail('registry.objects debe ser un arreglo')
const rutas = new Set((Array.isArray(files) ? files : files.paths || []).map(f => f.path ?? f))

const objects = registry.objects.map(o => {
  const enArchivo = rutas.has(o.file)
  const enLedger = ledgerTiene(ledger, o.ledger_hint)
  const { exists, observed } = leerEfecto(effects[o.id])
  const cmp = exists ? comparar(o.expected, observed)
                     : { detalle: exists === false ? DETALLE.ABSENT : DETALLE.NOT_CHECKED, diffs: [], razon: null }
  const state = clasificar({ enArchivo, enLedger, enEfecto: exists, detalle: cmp.detalle })
  return {
    id: o.id, kind: o.kind, relation: o.rel ?? null, name: o.name,
    declared_in: o.file, declared_at_ref: o.file_ref ?? null,
    sources: {
      file: enArchivo,
      ledger: enLedger,
      effect: { exists, fingerprint_matches: cmp.detalle === DETALLE.PRESENT_AND_MATCHING ? true
                                          : cmp.detalle === DETALLE.PRESENT_BUT_DIFFERENT ? false : null,
                detail: cmp.detalle, reason: cmp.razon },
    },
    fingerprint_source: o.expected?.source ?? null,
    diffs: cmp.diffs,
    state, severity: severidad(state, o.file),
    release_impact: politicaDe(o.id)?.release_impact ?? 'UNASSESSED',
    release_critical_when: politicaDe(o.id)?.release_critical_when ?? null,
    note: o.note || null,
  }
})

const drifts = objects.filter(o => o.severity !== 'OK')
const summary = {}
for (const o of objects) summary[o.state] = (summary[o.state] || 0) + 1

const artifact = {
  artifact_version: '1.1',
  tool: 'schema-drift-guard',
  mode: 'DRY_RUN',
  checked_at: a['checked-at'] || new Date().toISOString(),
  repo_sha: a['repo-sha'] || null,
  database_identity: a['db-identity'] || null,
  inputs: {
    migration_files: rutas.size,
    ledger_rows: ledger.length,
    registry_objects: registry.objects.length,
    registry_version: registry.registry_version ?? null,
    fingerprinted_objects: registry.objects.filter(o => o.expected).length,
  },
  objects,
  drifts: drifts.map(d => ({ id: d.id, state: d.state, severity: d.severity,
    release_impact: d.release_impact, effect_detail: d.sources.effect.detail,
    diffs: d.diffs, note: d.note })),
  summary: {
    by_state: summary,
    blocking: drifts.filter(d => d.severity === 'BLOCK').length,
    warning: drifts.filter(d => d.severity === 'WARN').length,
    ok: objects.length - drifts.length,
    by_effect_detail: objects.reduce((m, o) => {
      const d = o.sources.effect.detail; m[d] = (m[d] || 0) + 1; return m
    }, {}),
    // Separado a propósito de `blocking`: la severidad no decide el release.
    by_release_impact: objects.reduce((m, o) => {
      m[o.release_impact] = (m[o.release_impact] || 0) + 1; return m
    }, {}),
    policy_version: policy?.policy_version ?? null,
  },
  // Invariantes del propio artefacto. Si alguna es falsa, el artefacto no vale.
  guarantees: {
    read_only: true,
    ddl_executed: 0,
    ledger_writes: 0,
    contains_secrets: false,
    contains_customer_data: false,
  },
}

// La firma va al final, sobre el artefacto ya completo, y se excluye a sí
// misma del hash. Cualquier edición posterior —incluida una bienintencionada,
// como añadirle un campo para que otro índice lo encuentre— la rompe.
artifact.content_sha256 = hashContenido(artifact)

const salida = JSON.stringify(artifact, null, 2)
if (a.out) { writeFileSync(a.out, salida + '\n'); console.error(`artefacto → ${a.out}`) }
else console.log(salida)

// Resumen legible a stderr, para que stdout quede limpio para el artefacto.
console.error(`\nestados: ${Object.entries(summary).map(([k, v]) => `${k}=${v}`).join(' · ')}`)
console.error(`bloqueantes=${artifact.summary.blocking}  avisos=${artifact.summary.warning}  ok=${artifact.summary.ok}`)

process.exit(artifact.summary.blocking > 0 ? 1 : 0)
