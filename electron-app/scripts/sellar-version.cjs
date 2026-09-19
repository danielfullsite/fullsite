#!/usr/bin/env node
'use strict'
/**
 * Sella el ejecutable con el commit del que salió.
 *
 * Corre antes de empaquetar. Escribe `build-info.json` junto al código, que
 * `core/identidad-de-build.js` lee en el restaurante y `/health` publica.
 *
 * Sin esto, dos ejecutables distintos reportan el mismo 1.4.0 y una queja de
 * campo no se puede atar a una versión.
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const RAIZ = path.join(__dirname, '..')

function git(...args) {
  try { return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8' }).trim() }
  catch { return '' }
}

// En un servidor de compilación el commit llega por variable de entorno y puede
// no haber repositorio; localmente sale de git. Cualquiera de los dos sirve.
const sha = (process.env.FULLSITE_BUILD_SHA || process.env.GITHUB_SHA || git('rev-parse', 'HEAD')).trim()
if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
  console.error('[sellar-version] No hay commit del cual sellar.')
  console.error('  Pasa FULLSITE_BUILD_SHA, o compila dentro del repositorio.')
  process.exit(1)
}

const rama = (process.env.FULLSITE_BUILD_RAMA || process.env.GITHUB_REF_NAME || git('rev-parse', '--abbrev-ref', 'HEAD')).trim()
// `git status --porcelain` vacío significa que el ejecutable corresponde de
// verdad a ese commit. Si no, se sella igual pero marcado: un ejecutable con
// cambios sin guardar existe, y esconderlo es peor que enseñarlo.
const limpio = process.env.FULLSITE_BUILD_SHA || process.env.GITHUB_SHA
  ? true
  : git('status', '--porcelain') === ''

// El COMMIT no basta para identificar la interfaz servida: `build:ui` puede
// rearmar el paquete y producir contenido distinto desde el mismo commit (un
// lockfile que resolvió otra versión, un assets rehecho). La revisión del
// manifiesto es un sha256 del contenido real, así que dos paquetes distintos
// nunca se ven iguales. Si el paquete no existe —porque se selló sin compilar
// la interfaz— se dice `null` en vez de inventarlo.
function revisionDelPaqueteUi() {
  try {
    const { MANIFEST } = require('../offline-ui/package-store')
    const ruta = path.join(RAIZ, 'ui-bundle', MANIFEST)
    if (!fs.existsSync(ruta)) return null
    const revision = JSON.parse(fs.readFileSync(ruta, 'utf8')).revision
    return typeof revision === 'string' && /^[0-9a-f]{64}$/.test(revision) ? revision : null
  } catch { return null }
}

/**
 * El sello que dejó `build:ui` junto al paquete. `null` si la interfaz no se
 * compiló en esta corrida.
 *
 * Existe porque el paquete de interfaz NO lleva commit adentro: su `revision`
 * es un sha256 del contenido, y no hay forma de traducir un hash de contenido a
 * un commit sin recompilar y comparar. Ése fue exactamente el motivo por el que
 * no se pudo decir qué interfaz corría en AMALAY.
 */
function selloDeInterfaz() {
  try {
    const ruta = path.join(RAIZ, 'ui-bundle.sello.json')
    if (!fs.existsSync(ruta)) return null
    const s = JSON.parse(fs.readFileSync(ruta, 'utf8'))
    return (typeof s.git_sha === 'string' && /^[0-9a-f]{7,40}$/.test(s.git_sha)) ? s : null
  } catch { return null }
}

const sello = {
  sha: sha.toLowerCase(),
  rama: rama || null,
  limpio,
  sellado_en: new Date().toISOString(),
  version: JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8')).version,
  // Con qué interfaz se compiló. Hoy siempre v1; cuando exista V2, el build la
  // declara aquí y `/health` la publica sin que nadie tenga que adivinar.
  ui_version: process.env.FULLSITE_UI_VERSION === 'v2' ? 'v2' : 'v1',
  ui_revision: revisionDelPaqueteUi(),
  // El commit DE LA INTERFAZ, copiado del sello que dejó `build:ui`. NUNCA se
  // deduce del sha de la cáscara ni del hash de contenido: son cosas distintas,
  // y confundirlas es justo lo que impidió saber qué corría en cada terminal.
  ui_sha: selloDeInterfaz()?.git_sha ?? null,
  ui_sellado_en: selloDeInterfaz()?.built_at ?? null,
}

// ── COHERENCIA: ¿cáscara e interfaz salieron del mismo commit? ──────────────
//
//   true  — los dos sellos existen y coinciden: se compilaron juntos
//   false — los dos existen y NO coinciden: incompatibilidad DEMOSTRADA
//   null  — falta alguno: no se puede demostrar ni una cosa ni la otra
//
// El tercer estado es el que importa. Un instalador armado a mano, o un paquete
// de interfaz traído de otra compilación, caen ahí — y verlo como `null` es la
// verdad; verlo como `true` sería una mentira cómoda, que es la que costó una
// jornada entera de confusión sobre qué build estaba instalado.
sello.coherente = (sello.ui_sha && sello.sha)
  ? (sello.ui_sha === sello.sha)
  : null

const destino = path.join(RAIZ, 'build-info.json')
fs.writeFileSync(destino, JSON.stringify(sello, null, 2) + '\n')

const coh = sello.coherente === true ? 'coherente'
  : sello.coherente === false ? 'INCOHERENTE' : 'coherencia no demostrable'
console.log(`[sellar-version] ${sello.version} · ${sello.sha.slice(0, 12)}${limpio ? '' : '+cambios'} · ${sello.rama || 'sin rama'} · UI ${sello.ui_version} ${sello.ui_revision ? sello.ui_revision.slice(0, 12) : '(sin paquete)'} · ${coh}`)

// Una incoherencia DEMOSTRADA no se empaqueta. No es celo: un instalador cuya
// cáscara y cuya interfaz salieron de commits distintos es exactamente el
// objeto que nadie puede diagnosticar después, y el que produce la pregunta
// «¿qué versión tiene esa caja?» sin respuesta posible.
if (sello.coherente === false) {
  console.error(`[sellar-version] ERROR: la cáscara es ${sello.sha.slice(0, 12)} y la interfaz ${sello.ui_sha.slice(0, 12)}.`)
  console.error('[sellar-version] No se empaqueta un instalador incoherente. Recompila la interfaz desde este commit.')
  process.exit(1)
}
if (!limpio) console.warn('[sellar-version] AVISO: hay cambios sin guardar; el ejecutable no corresponde a un commit.')
