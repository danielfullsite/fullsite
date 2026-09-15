'use strict'
/**
 * CADA TERMINAL GENERA SU PROPIA CREDENCIAL DE RED LOCAL.
 *
 * Es la contrapartida del bootstrap sellado. En el instalador viaja lo PÚBLICO
 * —URL y llave anon—; lo que NUNCA puede viajar ahí es la credencial de red
 * local, porque sellarla convertiría a todo instalador en la misma llave para
 * todas las cajas del país: quien tuviera un .exe podría hablarle a la Caja de
 * cualquier restaurante.
 *
 * Cada terminal la fabrica en su primer arranque y se queda con ella. No se
 * hereda del tenant, no se copia entre terminales, no va en una plantilla de
 * configuración.
 *
 * ── POR QUÉ ESTA PRUEBA EXISTE ─────────────────────────────────────────────
 * El 2026-09-14, provisionando una terminal de certificación, se copió el
 * `config.json` de otra que ya funcionaba. `prepararCredencial` empieza con:
 *
 *     if (config.lanSecret) return config.lanSecret
 *
 * — así que la terminal «nueva» jamás generó identidad propia: heredó la
 * ajena, y `authority.ready` decía `true` por la razón equivocada. La copia no
 * dejó rastro visible; sólo se notó al mirar el código.
 *
 * NINGUNA prueba imprime un secreto. Se comparan longitudes, forma y si dos
 * valores son iguales — que es todo lo que hace falta demostrar.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { prepararCredencial, generarSecreto } = require('../core/credencial-lan')

const nuevoDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-terminal-'))
const config = () => ({ terminalRole: 'server_pos' })

test('una terminal nueva FABRICA su credencial en el primer arranque', () => {
  const dir = nuevoDir()
  const c = config()
  const secreto = prepararCredencial({ dataDir: dir, config: c })
  assert.equal(typeof secreto, 'string')
  assert.equal(secreto.length, 64, '32 bytes en hexadecimal')
  assert.match(secreto, /^[0-9a-f]{64}$/)
  assert.ok(fs.existsSync(path.join(dir, 'lan-secret')), 'no quedó persistida')
})

test('DOS terminales nuevas generan credenciales DISTINTAS', () => {
  const a = prepararCredencial({ dataDir: nuevoDir(), config: config() })
  const b = prepararCredencial({ dataDir: nuevoDir(), config: config() })
  // Se comparan sin imprimirlas: sólo importa que no coincidan.
  assert.notEqual(a, b, 'dos terminales comparten credencial: es una llave maestra')
  assert.equal(a.length, b.length)
})

test('veinte terminales dan veinte credenciales distintas — no hay colisión', () => {
  const vistas = new Set()
  for (let i = 0; i < 20; i++) vistas.add(prepararCredencial({ dataDir: nuevoDir(), config: config() }))
  assert.equal(vistas.size, 20)
})

test('la misma terminal CONSERVA la suya entre arranques', () => {
  const dir = nuevoDir()
  const primera = prepararCredencial({ dataDir: dir, config: config() })
  // Segundo arranque: config limpia, mismo directorio de datos.
  const segunda = prepararCredencial({ dataDir: dir, config: config() })
  assert.equal(primera, segunda, 'regenerarla dejaría huérfanas a las terminales emparejadas')
})

test('el archivo se escribe con permisos restrictivos', () => {
  const dir = nuevoDir()
  prepararCredencial({ dataDir: dir, config: config() })
  const modo = fs.statSync(path.join(dir, 'lan-secret')).mode & 0o777
  assert.equal(modo, 0o600, `permisos ${modo.toString(8)}: cualquier usuario del equipo podría leerla`)
})

test('una credencial persistida VACÍA no se acepta en silencio', () => {
  const dir = nuevoDir()
  fs.writeFileSync(path.join(dir, 'lan-secret'), '   \n')
  assert.throws(() => prepararCredencial({ dataDir: dir, config: config() }), /vacia|vacía/i)
})

test('generarSecreto no repite — es la fuente de la unicidad', () => {
  const vistas = new Set()
  for (let i = 0; i < 200; i++) vistas.add(generarSecreto())
  assert.equal(vistas.size, 200)
})

// ── Lo que NO debe pasar ────────────────────────────────────────────────────

test('NO está sellada en el build: el artefacto de bootstrap no la menciona', () => {
  // Si algún día alguien la agregara ahí, todo instalador sería la misma llave.
  const script = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'sellar-credenciales.cjs'), 'utf8')
  for (const p of ['lan_secret', 'lanSecret', 'LAN_SECRET', 'lan-secret']) {
    assert.ok(!script.includes(p), `el sellador de build menciona «${p}»`)
  }
})

test('heredar una credencial ajena impide generar la propia — el defecto que hay que ver', () => {
  // Éste es EXACTAMENTE el caso del 2026-09-14: una config copiada de otra
  // terminal. El código lo permite a propósito (una secundaria recibe la de su
  // Caja), y por eso la contaminación no se nota. Queda escrito para que quien
  // provisione una terminal de certificación sepa que empezar de una copia
  // NUNCA produce una terminal nueva.
  const dir = nuevoDir()
  const ajena = generarSecreto()
  const c = { terminalRole: 'server_pos', lanSecret: ajena }
  const resultado = prepararCredencial({ dataDir: dir, config: c })
  assert.equal(resultado, ajena, 'devuelve la heredada')
  assert.ok(!fs.existsSync(path.join(dir, 'lan-secret')),
    'no fabricó la suya: la terminal no es nueva, es un clon')
})
