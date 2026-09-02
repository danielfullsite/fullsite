'use strict'
// La politica del auto-update: cuando una version es mas nueva, y cuando se puede
// instalar sin romperle el servicio a un restaurante.
//
// ── EL BUG QUE ROMPIA EL CANAL PILOTO ────────────────────────────────────────
//
// `_compareVersions` hacia:
//
//   const parse = v => v.replace(/^v/,'').split('.').map(Number)
//
// Con '1.4.0-pilot.1' eso da [1, 4, NaN, 1]. Toda comparacion con NaN devuelve NaN,
// que nunca es > 0. Medido el 2026-09-01:
//
//   1.3.10-pilot.1 vs 1.3.9         -> NaN
//   1.4.0-pilot.2  vs 1.4.0-pilot.1 -> NaN
//   1.4.0          vs 1.4.0-pilot.1 -> NaN   <- la peor: una terminal en piloto
//                                               NUNCA graduaba a estable
//
// El canal piloto es TODO el mecanismo de seguridad: probar en un restaurante antes
// de tocar a los demas. Roto asi, AMALAY se habria quedado en la version de prueba
// para siempre y nadie se habria enterado.
//
// ── POR QUE LA POLITICA VIVE APARTE ──────────────────────────────────────────
//
// El manager hace peticiones HTTPS al construirse; probarlo exige salir a la red.
// Aqui se prueba con una llamada y un objeto. Es la leccion de los cuatro fallos del
// 2026-08-31: cuando la politica vive mezclada con la red, nadie la prueba.

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')

const { compararVersiones, puedeInstalarAhora } = require('../update/politica')

const masNueva = (a, b) => compararVersiones(a, b) > 0

describe('Comparar versiones', () => {
  test('lo basico sigue funcionando', () => {
    assert.equal(masNueva('1.4.0', '1.3.9'), true)
    assert.equal(masNueva('1.3.9', '1.4.0'), false)
    assert.equal(masNueva('2.0.0', '1.99.99'), true)
    assert.equal(compararVersiones('1.3.9', '1.3.9'), 0)
    assert.equal(masNueva('v1.4.0', '1.3.9'), true, 'la v de la etiqueta no debe estorbar')
  })

  test('REGRESION: un piloto de PATCH si se detecta como mas nuevo', () => {
    // Antes: NaN. Un parche urgente por canal piloto nunca habria llegado.
    assert.equal(masNueva('1.3.10-pilot.1', '1.3.9'), true)
  })

  test('REGRESION: un piloto avanza al siguiente piloto', () => {
    // Antes: NaN. Corregir algo en el piloto no llegaba a la terminal piloto.
    assert.equal(masNueva('1.4.0-pilot.2', '1.4.0-pilot.1'), true)
  })

  test('REGRESION: una terminal en piloto GRADUA a estable', () => {
    // La peor de las tres. Semver: sin prerelease es MAYOR que con prerelease.
    // Sin esto, AMALAY se quedaba en la version de prueba para siempre.
    assert.equal(masNueva('1.4.0', '1.4.0-pilot.1'), true)
    assert.equal(masNueva('1.4.0-pilot.1', '1.4.0'), false, 'y NO retrocede de estable a piloto')
  })

  test('un numero de prerelease ordena numericamente, no como texto', () => {
    // '10' < '9' si se comparan como texto. Con diez pilotos, el 10 no llegaria.
    assert.equal(masNueva('1.4.0-pilot.10', '1.4.0-pilot.9'), true)
  })

  test('basura no truena ni inventa que hay version nueva', () => {
    assert.equal(compararVersiones(null, null), 0)
    assert.equal(compararVersiones(undefined, '1.0.0') > 0, false)
    assert.equal(compararVersiones('no-es-version', '1.0.0') > 0, false)
    assert.equal(Number.isNaN(compararVersiones('1.2.3', '1.2.x')), false,
      'nunca debe devolver NaN: NaN>0 es false y esconde el problema')
  })
})

describe('Cuando se puede instalar', () => {
  const libre = { turno: null, mesas: [['1', { status: 'libre' }]], kds_orders: [] }

  test('sin turno, sin comandas y sin mesas ocupadas: si', () => {
    const r = puedeInstalarAhora(libre)
    assert.equal(r.permitido, true)
  })

  test('REGRESION: con turno abierto NO se instala', () => {
    // Instalar reinicia Electron, y Pedro muere con Electron (regla dura #4).
    // Reiniciar a media operacion deja al restaurante sin imprimir y sin KDS.
    const r = puedeInstalarAhora({ ...libre, turno: { id: 't1' } })
    assert.equal(r.permitido, false)
    assert.match(r.motivo, /turno/)
  })

  test('REGRESION: con comandas en la cocina NO se instala', () => {
    const r = puedeInstalarAhora({ ...libre, kds_orders: [{ mesa: 3 }] })
    assert.equal(r.permitido, false)
    assert.match(r.motivo, /cocina/)
  })

  test('REGRESION: con mesas ocupadas NO se instala', () => {
    const r = puedeInstalarAhora({ ...libre, mesas: [['1', { status: 'ocupada' }]] })
    assert.equal(r.permitido, false)
    assert.match(r.motivo, /mesa/)
  })

  test('REGRESION: falla CERRADO — sin estado NO se instala', () => {
    // No saber si hay mesas abiertas nunca puede autorizar un reinicio. Un
    // restaurante que se actualiza un dia tarde no pierde nada; uno que se reinicia
    // con mesas abiertas, si.
    assert.equal(puedeInstalarAhora(null).permitido, false)
    assert.equal(puedeInstalarAhora(undefined).permitido, false)
    assert.equal(puedeInstalarAhora('no es un objeto').permitido, false)
  })

  test('un estado a medias no se lee como "todo libre"', () => {
    // Si `mesas` o `kds_orders` faltan, no se asume que no hay nada: solo se evalua
    // lo que si llego. Aqui hay turno, asi que bloquea igual.
    assert.equal(puedeInstalarAhora({ turno: { id: 't' } }).permitido, false)
  })

  test('el motivo se puede enseñar al operador', () => {
    assert.match(puedeInstalarAhora({ ...libre, kds_orders: [{}, {}] }).motivo, /2 comanda/)
  })
})
