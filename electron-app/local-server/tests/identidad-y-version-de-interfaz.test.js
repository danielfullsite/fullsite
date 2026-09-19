'use strict'
/**
 * LA IDENTIDAD DE LA TERMINAL Y EL SELECTOR DE INTERFAZ.
 *
 * Dos cosas se prueban aquí, y las dos son de las que sólo se notan cuando
 * fallan en el restaurante:
 *
 *   1. Que la identidad DIGA cuando no sabe, en vez de inventar. Un `null`
 *      honesto se puede leer por teléfono; un valor a medias parece un dato y
 *      manda a alguien a buscar por el lado equivocado. Esta misma jornada se
 *      pagó el precio de confundir dos instalaciones.
 *
 *   2. Que la versión de interfaz se congele. Si se releyera, una orden podría
 *      empezar en V1 y terminar en V2 — dos modelos de estado distintos a media
 *      captura. El congelado es la funcionalidad; la lectura es el detalle.
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const { identidadDeTerminal, lineaDeIdentidad } = require('../core/identidad-de-terminal')
const vdi = require('../core/version-de-interfaz')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

/** Un directorio SIN build-info.json. Sin esto la prueba del caso «sin sellar»
 *  pasaba o fallaba segun si alguien habia compilado en su copia de trabajo —
 *  una prueba que depende del estado del disco no protege de nada. */
const SIN_SELLO = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-sin-sello-'))

test.beforeEach(() => vdi._olvidar())

// ── El selector ─────────────────────────────────────────────────────────────

test('sin nada declarado, la interfaz es v1', () => {
  const r = vdi.resolverVersionDeInterfaz({ config: {}, dev: false, env: {} })
  assert.equal(r.version, 'v1')
  assert.equal(r.procedencia, 'por omisión')
})

test('config.json manda en producción', () => {
  const r = vdi.resolverVersionDeInterfaz({ config: { ui_version: 'v2' }, dev: false, env: {} })
  assert.equal(r.version, 'v2')
  assert.equal(r.procedencia, 'config.json')
})

test('un valor ilegible NO deja la caja sin interfaz: cae a v1 y lo dice', () => {
  for (const basura of ['V3', 'verdadero', '', '  ', 2, null, {}, ['v2']]) {
    vdi._olvidar()
    const r = vdi.resolverVersionDeInterfaz({ config: { ui_version: basura }, dev: false, env: {} })
    assert.equal(r.version, 'v1', `«${JSON.stringify(basura)}» debió caer a v1`)
  }
})

test('mayúsculas y espacios se perdonan — "  V2 " es v2', () => {
  const r = vdi.resolverVersionDeInterfaz({ config: { ui_version: '  V2 ' }, dev: false, env: {} })
  assert.equal(r.version, 'v2')
})

test('el entorno SÓLO manda en desarrollo', () => {
  const r = vdi.resolverVersionDeInterfaz({ config: { ui_version: 'v1' }, dev: true, env: { FULLSITE_UI_VERSION: 'v2' } })
  assert.equal(r.version, 'v2')
  assert.match(r.procedencia, /dev/)
})

test('en PRODUCCIÓN el entorno se ignora — config.json es la autoridad', () => {
  const r = vdi.resolverVersionDeInterfaz({ config: { ui_version: 'v1' }, dev: false, env: { FULLSITE_UI_VERSION: 'v2' } })
  assert.equal(r.version, 'v1',
    'una variable de entorno no puede cambiarle la interfaz a una caja de restaurante')
})

test('SE CONGELA: resolver otra vez con otra configuración no la mueve', () => {
  const primera = vdi.resolverVersionDeInterfaz({ config: { ui_version: 'v1' }, dev: false, env: {} })
  assert.equal(primera.version, 'v1')
  assert.equal(primera.congelada, false)

  // Esto es lo que pasaría si alguien releyera a media orden: el catálogo se
  // refrescó, volvió el internet, el PIN se desbloqueó otra vez.
  const segunda = vdi.resolverVersionDeInterfaz({ config: { ui_version: 'v2' }, dev: true, env: { FULLSITE_UI_VERSION: 'v2' } })
  assert.equal(segunda.version, 'v1', 'la interfaz cambió a mitad del proceso')
  assert.equal(segunda.congelada, true)
  assert.equal(vdi.versionDeInterfaz(), 'v1')
})

test('versionDeInterfaz() antes de resolver contesta v1 y no resuelve sola', () => {
  assert.equal(vdi.versionDeInterfaz(), 'v1')
  // No debe haberse congelado por preguntar: resolver sigue siendo posible.
  const r = vdi.resolverVersionDeInterfaz({ config: { ui_version: 'v2' }, dev: false, env: {} })
  assert.equal(r.version, 'v2')
})

// ── La identidad ────────────────────────────────────────────────────────────

test('sin sello, la identidad dice "sin sellar" en vez de inventar un commit', () => {
  const id = identidadDeTerminal({ version: '1.4.0', config: null, raizDelSello: SIN_SELLO })
  assert.equal(id.app.git_sha, null)
  assert.equal(id.app.clean, false)
  assert.match(id.app.etiqueta, /sin sellar/)
})

test('los cinco bloques existen siempre, aunque vengan vacíos', () => {
  const id = identidadDeTerminal({ version: '1.4.0', raizDelSello: SIN_SELLO })
  for (const bloque of ['app', 'ui', 'pedro', 'config', 'terminal']) {
    assert.ok(id[bloque], `falta el bloque ${bloque}`)
  }
})

test('la terminal se identifica con lo que trae config.json', () => {
  const id = identidadDeTerminal({
    version: '1.4.0',
    config: { terminal_id: 'caja-01', terminal_role: 'server_pos', restaurant_id: 'amalay', config_version: 3 },
    serverId: 'srv-1', protocolo: 3,
  })
  assert.equal(id.terminal.terminal_id, 'caja-01')
  assert.equal(id.terminal.terminal_role, 'server_pos')
  assert.equal(id.terminal.restaurant_id, 'amalay')
  assert.equal(id.pedro.protocol_version, 3)
  assert.equal(id.config.config_version, 3)
})

test('la EDAD del catálogo se calcula — «hay catálogo» no dice de cuándo es', () => {
  const haceDiezMinutos = new Date(Date.now() - 600_000).toISOString()
  const id = identidadDeTerminal({
    version: '1.4.0',
    catalogo: { revision: 'abc123', actualizado_en: haceDiezMinutos },
  })
  assert.ok(id.config.catalog_edad_s >= 595 && id.config.catalog_edad_s <= 605,
    `edad inesperada: ${id.config.catalog_edad_s}`)
  assert.equal(id.config.catalog_revision, 'abc123')
})

test('una fecha de catálogo ilegible da edad null, no un número inventado', () => {
  const id = identidadDeTerminal({ version: '1.4.0', catalogo: { revision: 'x', actualizado_en: 'ayer por la tarde' } })
  assert.equal(id.config.catalog_edad_s, null)
})

test('la línea del pie cabe en la pantalla de bloqueo y se lee por teléfono', () => {
  const id = identidadDeTerminal({ version: '1.4.0', config: { terminal_id: 'caja-01' }, raizDelSello: SIN_SELLO })
  const linea = lineaDeIdentidad(id)
  assert.match(linea, /^1\.4\.0 · /)
  assert.match(linea, /UI v1/)
  assert.match(linea, /caja-01/)
  assert.ok(linea.length < 80, `demasiado larga para el pie: «${linea}»`)
})

// ── Coherencia entre cáscara e interfaz ─────────────────────────────────────
//
// El paquete de interfaz NO lleva commit adentro: su identidad es un sha256 del
// contenido. Traducir ese hash a un commit exige recompilar y comparar. Por eso
// `coherente` tiene TRES estados y no dos — y el tercero es el que evita la
// mentira cómoda de dar por hecho que shell e interfaz salieron juntos.

const { normalizar } = require('../core/identidad-de-build')

test('coherente = true sólo si los DOS sellos existen y coinciden', () => {
  const s = normalizar({ sha: 'aabbccddeeff', ui_sha: 'aabbccddeeff', limpio: true })
  assert.equal(s.coherente, true)
})

test('coherente = false cuando se demuestra que NO coinciden', () => {
  const s = normalizar({ sha: 'aabbccddeeff', ui_sha: '112233445566', limpio: true })
  assert.equal(s.coherente, false)
})

test('coherente = null cuando falta el sello de la interfaz — indemostrable, no "sí"', () => {
  const s = normalizar({ sha: 'aabbccddeeff', limpio: true })
  assert.equal(s.coherente, null)
  assert.equal(s.ui_sha, null, 'el commit de la interfaz NO se deduce del de la cáscara')
})

test('el commit de la interfaz NUNCA se hereda del de la cáscara', () => {
  // Éste es el defecto que el documento de reconciliación identificó como causa
  // raíz: dar por bueno que «salen del mismo repo».
  const id = identidadDeTerminal({ version: '1.4.0', raizDelSello: SIN_SELLO })
  assert.equal(id.ui.git_sha, null)
  assert.equal(id.coherente, null)
})

test('un ui_sha con forma inválida se descarta en vez de propagarse', () => {
  const s = normalizar({ sha: 'aabbccddeeff', ui_sha: 'no-es-un-sha', limpio: true })
  assert.equal(s.ui_sha, null)
  assert.equal(s.coherente, null)
})

test('un ejecutable con cambios sin guardar SE VE — no se esconde', () => {
  // Es el caso que más confunde en campo: un .dmg armado a mano desde un
  // checkout sucio reporta el mismo número que el oficial.
  const id = identidadDeTerminal({ version: '1.4.0', raizDelSello: SIN_SELLO })
  id.app.git_sha = '97e2b30b'
  id.app.clean = false
  assert.match(lineaDeIdentidad(id), /\+cambios/)
})
