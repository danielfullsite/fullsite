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

const sello = {
  sha: sha.toLowerCase(),
  rama: rama || null,
  limpio,
  sellado_en: new Date().toISOString(),
  version: JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8')).version,
}

const destino = path.join(RAIZ, 'build-info.json')
fs.writeFileSync(destino, JSON.stringify(sello, null, 2) + '\n')

console.log(`[sellar-version] ${sello.version} · ${sello.sha.slice(0, 12)}${limpio ? '' : '+cambios'} · ${sello.rama || 'sin rama'}`)
if (!limpio) console.warn('[sellar-version] AVISO: hay cambios sin guardar; el ejecutable no corresponde a un commit.')
