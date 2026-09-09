'use strict'
// `package.json` dice 1.4.0 igual en producción que en el candidato: dos
// ejecutables distintos con el mismo número. Cuando alguien reporta algo desde
// el restaurante no hay forma de saber con qué versión pasó, ni de comprobar
// que las cuatro terminales quedaron con el mismo instalador.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { identidadDeBuild, normalizar } = require('../core/identidad-de-build')

function conSello(sello) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sello-'))
  if (sello !== undefined) fs.writeFileSync(path.join(dir, 'build-info.json'), typeof sello === 'string' ? sello : JSON.stringify(sello))
  return dir
}

test('un ejecutable sellado se identifica por su commit, no sólo por el número', () => {
  const dir = conSello({ sha: 'abc123def4567890abc123def4567890abc12345', rama: 'main', limpio: true, sellado_en: '2026-09-06T10:00:00.000Z' })
  const id = identidadDeBuild('1.5.0', dir)
  assert.equal(id.version, '1.5.0')
  assert.equal(id.sha, 'abc123def456')          // recortado, suficiente para citarlo
  assert.equal(id.rama, 'main')
  assert.equal(id.etiqueta, '1.5.0 · abc123def456')
})

test('dos ejecutables con el mismo número pero distinto commit NO se confunden', () => {
  // Es exactamente el caso de hoy: producción y candidato dicen 1.4.0.
  const a = identidadDeBuild('1.4.0', conSello({ sha: 'aaaaaaaaaaaa', limpio: true }))
  const b = identidadDeBuild('1.4.0', conSello({ sha: 'bbbbbbbbbbbb', limpio: true }))
  assert.equal(a.version, b.version)
  assert.notEqual(a.etiqueta, b.etiqueta)
})

test('un ejecutable armado con cambios sin guardar se marca, no se disimula', () => {
  // No corresponde a ningún commit. Esconderlo es peor que enseñarlo: alguien
  // citaría un commit que no contiene lo que está corriendo.
  const id = identidadDeBuild('1.5.0', conSello({ sha: 'cccccccccccc', limpio: false }))
  assert.match(id.etiqueta, /\+cambios$/)
  assert.equal(id.limpio, false)
})

test('sin sello lo dice, en vez de inventar un número', () => {
  const id = identidadDeBuild('1.5.0', conSello())
  assert.equal(id.sha, null)
  assert.equal(id.etiqueta, '1.5.0 (sin sellar)')
})

test('un sello ilegible o a medias se descarta entero', () => {
  // Medio sello es peor que ninguno: haría citar un commit equivocado.
  for (const malo of ['{ no es json', '{}', { rama: 'main' }, { sha: '' }, { sha: 'zzz' }, { sha: 123 }, { sha: 'abc' }]) {
    const id = identidadDeBuild('1.5.0', conSello(malo))
    assert.equal(id.sha, null, `debió descartarse: ${JSON.stringify(malo)}`)
    assert.match(id.etiqueta, /sin sellar/)
  }
})

test('una fecha inventada no se propaga', () => {
  const id = identidadDeBuild('1.5.0', conSello({ sha: 'dddddddddddd', limpio: true, sellado_en: 'el martes' }))
  assert.equal(id.sellado_en, null)
  assert.equal(id.sha, 'dddddddddddd')   // el resto del sello sigue sirviendo
})

test('normalizar acepta un commit corto y lo deja utilizable', () => {
  assert.equal(normalizar({ sha: 'ABC1234', limpio: true }).sha, 'abc1234')
})
