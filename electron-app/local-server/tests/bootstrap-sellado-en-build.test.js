'use strict'
/**
 * EL BOOTSTRAP DE PLATAFORMA, SELLADO EN EL BUILD.
 *
 * Una terminal instalada por .exe no tiene variables de entorno, y la receta de
 * clonado no escribe credenciales en su config.json. Medido contra AMALAY el
 * 2026-09-14, eso costaba dos cosas a la vez: la flota nunca reportaba
 * (`local_server_heartbeats` con cero filas desde que existe) y la terminal no
 * se auto-actualizaba, porque el freno de versiones lanza sin credencial y el
 * instalador falla CERRADO a propósito.
 *
 * El script existía desde antes. Lo que no existía era el cableado: nadie lo
 * llamaba, y `credenciales-selladas.json` ni siquiera estaba en la lista de
 * archivos que empaqueta electron-builder. Un instalador podía nacer mudo sin
 * que nada lo dijera.
 *
 * ── QUÉ SE SELLA, Y QUÉ NUNCA ──────────────────────────────────────────────
 * Sólo bootstrap PÚBLICO: la URL de Supabase y la llave `anon`. Es la MISMA
 * llave que ya viaja dentro del instalador —la web la publica como
 * NEXT_PUBLIC_SUPABASE_ANON_KEY y Next la inlina en el paquete de interfaz—;
 * lo único que cambia es que ahora el proceso principal también la lee.
 *
 * Lo que NUNCA puede sellarse, y estas pruebas lo vigilan: `service_role`,
 * contraseñas de base, tokens de administración, secretos de tenant, la
 * credencial de red local y el secreto IPC de la huella. Cualquiera de ellos
 * convertiría el instalador en una llave maestra distribuible.
 *
 * Valores SINTÉTICOS. Nunca credenciales reales, ni siquiera públicas.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const RAIZ = path.join(__dirname, '..', '..')
const SCRIPT = path.join(RAIZ, 'scripts', 'sellar-credenciales.cjs')
const DESTINO = path.join(RAIZ, 'credenciales-selladas.json')

const URL_SINTETICA = 'https://synthetic.invalid'
const LLAVE_SINTETICA = 'synthetic-test-value'

/** Corre el sellador con un entorno controlado. Nunca hereda credenciales reales. */
function sellar({ url, key, args = [] } = {}) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME }
  if (url) env.SUPABASE_URL = url
  if (key) env.SUPABASE_ANON_KEY = key
  // Se capturan LOS DOS flujos también en el camino exitoso: los avisos salen por
  // console.warn → stderr, y mirar sólo stdout hacía que un aviso presente se
  // leyera como ausente. (Error del instrumento, cazado en la primera corrida.)
  const r = require('node:child_process').spawnSync('node', [SCRIPT, ...args], { env, encoding: 'utf8' })
  return { code: r.status ?? 1, salida: `${r.stdout || ''}${r.stderr || ''}` }
}

/** Guarda y restaura el artefacto real para no pisarlo al probar. */
let respaldo = null
test.before(() => { if (fs.existsSync(DESTINO)) respaldo = fs.readFileSync(DESTINO, 'utf8') })
test.beforeEach(() => { try { fs.unlinkSync(DESTINO) } catch {} })
test.after(() => {
  try { fs.unlinkSync(DESTINO) } catch {}
  if (respaldo !== null) fs.writeFileSync(DESTINO, respaldo, 'utf8')
})

// ── 1 · Genera el artefacto ─────────────────────────────────────────────────

test('con bootstrap en el entorno, el sellador escribe el artefacto', () => {
  const r = sellar({ url: URL_SINTETICA, key: LLAVE_SINTETICA })
  assert.equal(r.code, 0, r.salida)
  assert.ok(fs.existsSync(DESTINO), 'no se escribió credenciales-selladas.json')
  const s = JSON.parse(fs.readFileSync(DESTINO, 'utf8'))
  assert.equal(s.supabaseUrl, URL_SINTETICA)
  assert.equal(s.supabaseAnonKey, LLAVE_SINTETICA)
})

// ── 2 · readSupabaseCreds lo puede leer ─────────────────────────────────────

test('readSupabaseCreds lee el sello — que es el punto de todo esto', () => {
  sellar({ url: URL_SINTETICA, key: LLAVE_SINTETICA })
  // El módulo memoiza el sello, así que se recarga limpio.
  delete require.cache[require.resolve('../config-schema')]
  delete require.cache[require.resolve('../../credenciales-selladas.json')]
  const { readSupabaseCreds } = require('../config-schema')
  // Sin config y sin entorno: sólo el sello puede contestar. Es exactamente la
  // situación de una caja instalada por .exe.
  const creds = readSupabaseCreds({}, {})
  assert.equal(creds.supabaseUrl, URL_SINTETICA)
  assert.equal(creds.supabaseKey, LLAVE_SINTETICA)
})

test('el config.json de la terminal gana sobre el sello — una caja puede corregirse', () => {
  sellar({ url: URL_SINTETICA, key: LLAVE_SINTETICA })
  delete require.cache[require.resolve('../config-schema')]
  delete require.cache[require.resolve('../../credenciales-selladas.json')]
  const { readSupabaseCreds } = require('../config-schema')
  const creds = readSupabaseCreds({ supabaseUrl: 'https://otra.invalid', supabaseAnonKey: 'otra' }, {})
  assert.equal(creds.supabaseUrl, 'https://otra.invalid')
})

// ── 3 y 4 · Lo que JAMÁS puede aparecer ─────────────────────────────────────

test('el artefacto contiene EXACTAMENTE dos claves, y ninguna es privilegiada', () => {
  sellar({ url: URL_SINTETICA, key: LLAVE_SINTETICA })
  const crudo = fs.readFileSync(DESTINO, 'utf8')
  const s = JSON.parse(crudo)
  assert.deepEqual(Object.keys(s).sort(), ['supabaseAnonKey', 'supabaseUrl'],
    'el sello creció: cualquier llave nueva necesita revisión de seguridad')

  // Una llave que otorga privilegios elevados convertiría al instalador en una
  // llave maestra distribuible. Se vigila por nombre Y por forma.
  for (const prohibido of [
    'service_role', 'serviceRole', 'SERVICE_ROLE',
    'lan_secret', 'lanSecret', 'LAN_SECRET',
    'fingerprint', 'ipc_secret', 'ipcSecret',
    'password', 'passwd', 'db_password',
    'admin_token', 'adminToken', 'access_token',
    'SHIFT_TOKEN_SECRET', 'tenant_secret',
  ]) {
    assert.ok(!crudo.includes(prohibido), `el sello contiene «${prohibido}»`)
  }
})

test('el sellador NO lee variables de entorno privilegiadas aunque estén presentes', () => {
  // Se le ofrecen a propósito. Si alguna terminara en el artefacto, el instalador
  // repartiría privilegios elevados a cada caja del país.
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME,
    SUPABASE_URL: URL_SINTETICA, SUPABASE_ANON_KEY: LLAVE_SINTETICA,
    SUPABASE_SERVICE_ROLE_KEY: 'NO-DEBE-APARECER-service-role',
    SHIFT_TOKEN_SECRET: 'NO-DEBE-APARECER-shift',
    FULLSITE_LAN_SECRET: 'NO-DEBE-APARECER-lan',
  }
  execFileSync('node', [SCRIPT], { env, encoding: 'utf8', stdio: 'pipe' })
  const crudo = fs.readFileSync(DESTINO, 'utf8')
  assert.ok(!crudo.includes('NO-DEBE-APARECER'), 'una credencial privilegiada llegó al sello')
})

test('el código fuente del sellador no menciona service_role ni el secreto de red local', () => {
  // Guardián de la FUENTE, no sólo de la salida: impide que alguien añada una
  // llave privilegiada mañana y que se descubra en campo.
  const fuente = fs.readFileSync(SCRIPT, 'utf8')
  for (const prohibido of ['SERVICE_ROLE', 'service_role', 'LAN_SECRET', 'SHIFT_TOKEN']) {
    assert.ok(!fuente.includes(prohibido), `sellar-credenciales.cjs menciona «${prohibido}»`)
  }
})

// ── 5 · RELEASE falla si falta el bootstrap ─────────────────────────────────

test('RELEASE: sin bootstrap, el build FALLA — no produce un instalador mudo', () => {
  const r = sellar({})
  assert.equal(r.code, 1, 'debió fallar y no falló')
  assert.match(r.salida, /FALTA/)
  assert.ok(!fs.existsSync(DESTINO), 'escribió un artefacto a medias')
})

test('RELEASE: con la URL pero sin la llave, también falla', () => {
  const r = sellar({ url: URL_SINTETICA })
  assert.equal(r.code, 1)
  assert.match(r.salida, /SUPABASE_ANON_KEY/)
})

// ── 6 · DEV puede seguir sin sellar, pero ETIQUETADO ───────────────────────

test('DEV: --permitir-sin-sellar deja pasar, y AVISA de las consecuencias', () => {
  const r = sellar({ args: ['--permitir-sin-sellar'] })
  assert.equal(r.code, 0)
  assert.match(r.salida, /SIN sellar/i)
  // El aviso tiene que decir QUÉ se pierde, no sólo que faltó algo.
  assert.match(r.salida, /telemetr[íi]a|auto-?actualiz/i)
  assert.ok(!fs.existsSync(DESTINO), 'DEV no debe fabricar un sello falso')
})

test('sin sello, readSupabaseCreds devuelve vacío y no inventa nada', () => {
  delete require.cache[require.resolve('../config-schema')]
  try { delete require.cache[require.resolve('../../credenciales-selladas.json')] } catch {}
  const { readSupabaseCreds } = require('../config-schema')
  const creds = readSupabaseCreds({}, {})
  assert.equal(creds.supabaseUrl, '')
  assert.equal(creds.supabaseKey, '')
})

// ── 7 · Los registros nunca imprimen el valor completo ─────────────────────

test('el registro NUNCA imprime la llave completa', () => {
  const llaveLarga = 'synthetic-test-value-con-mucho-relleno-para-notarse-1234567890'
  const r = sellar({ url: URL_SINTETICA, key: llaveLarga })
  assert.equal(r.code, 0)
  assert.ok(!r.salida.includes(llaveLarga), 'la llave apareció completa en el registro')
  assert.match(r.salida, new RegExp(`${llaveLarga.length} caracteres`),
    'debe decir cuántos caracteres tiene, que es prueba suficiente sin exponerla')
})

test('el registro enmascara el subdominio de la URL', () => {
  const r = sellar({ url: 'https://proyectoreal.supabase.co', key: LLAVE_SINTETICA })
  assert.ok(!r.salida.includes('proyectoreal'), 'el identificador del proyecto quedó a la vista')
  assert.match(r.salida, /\/\/\*\*\*\./)
})

// ── El cableado, que es lo que faltaba ─────────────────────────────────────

test('el pipeline de release CORRE el sellador — antes no lo llamaba nadie', () => {
  const p = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'))
  for (const plat of ['build:win', 'build:mac']) {
    assert.match(p.scripts[plat], /sellar:credenciales/,
      `${plat} no sella el bootstrap: el instalador nacería mudo`)
    // El orden importa: sellar DESPUÉS de construir y ANTES de empaquetar.
    const s = p.scripts[plat]
    assert.ok(s.indexOf('build:ui') < s.indexOf('sellar:credenciales'), `${plat}: orden incorrecto`)
    assert.ok(s.indexOf('sellar:credenciales') < s.indexOf('electron-builder'), `${plat}: sella después de empaquetar`)
  }
})

test('electron-builder EMPAQUETA el artefacto — sellarlo y no incluirlo no sirve de nada', () => {
  for (const f of ['electron-builder-pos.json', 'electron-builder-kds.json']) {
    const cfg = JSON.parse(fs.readFileSync(path.join(RAIZ, f), 'utf8'))
    assert.ok(cfg.files.includes('credenciales-selladas.json'), `${f} no lo empaqueta`)
  }
})

test('el artefacto está ignorado por git — la llave no entra al repositorio', () => {
  const ignore = fs.readFileSync(path.join(RAIZ, '.gitignore'), 'utf8')
  assert.match(ignore, /credenciales-selladas\.json/)
})
