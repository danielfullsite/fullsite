'use strict'
// Una terminal secundaria tiene que poder PREGUNTARLE a la caja.
//
// ── EL BUG ───────────────────────────────────────────────────────────────────
//
// El reenvío entre terminales era, literalmente:
//
//   if (posServerIp && req.method === 'POST' && (url === '/print' || ...))
//
// `req.method === 'POST'`. Tres escrituras y CERO lecturas. Una caja secundaria
// podía avisar; no podía consultar. Su única fuente del salón era la nube, así
// que sin internet cada terminal se quedaba con lo suyo.
//
// En campo, 2026-09-02, AMALAY, tres cajas, WAN caído (Eduardo Esquivel):
//   «no hay comunicación correcta entre los puntos de venta, no muestran lo mismo»
//
// La caja YA sabía contestar `/state` y `/events?since=N`. Nadie las alcanzaba.
//
// ── LO QUE MÁS IMPORTA AQUÍ ──────────────────────────────────────────────────
//
// La rama de falla. Si la caja no contesta, servir un error dejaría el mapa de
// mesas en blanco — peor que el problema. Se sirve el estado local, PERO
// marcado, para que nadie confunda «el salón» con «lo que yo vi». Confundir esas
// dos cosas es la familia de bugs que costó la semana entera.

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const fuente = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
const sinComentarios = fuente
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

describe('El reenvío de lectura existe', () => {
  test('REGRESION: hay un forwardGet, no sólo forwardPost', () => {
    assert.match(sinComentarios, /function forwardGet\s*\(/,
      'sin forwardGet, una terminal secundaria no puede preguntarle nada a la caja')
  })

  test('REGRESION: /state y /events se reenvían', () => {
    assert.match(sinComentarios, /LECTURAS_REENVIADAS\s*=\s*\[[^\]]*'\/state'[^\]]*\]/)
    assert.match(sinComentarios, /LECTURAS_REENVIADAS\s*=\s*\[[^\]]*'\/events'[^\]]*\]/)
  })

  test('REGRESION: el reenvío GET está condicionado a posServerIp', () => {
    // Sin esta condición, la CAJA se reenviaría a sí misma: un bucle infinito
    // que tumba el servidor local del restaurante entero.
    const i = sinComentarios.indexOf("req.method === 'GET'")
    assert.ok(i > -1, 'no hay rama de GET reenviado')
    const linea = sinComentarios.slice(Math.max(0, i - 120), i + 60)
    assert.match(linea, /posServerIp/, 'el reenvío GET debe exigir posServerIp')
  })

  test('conserva la query — `?since=N` es todo el punto de /events', () => {
    // Sin la query, una terminal que reconecta no puede pedir «dame lo que me
    // perdí»: recibiría el historial completo o nada. Es la ruta que permite
    // ponerse al día, y sin `search` no sirve para eso.
    const i = sinComentarios.indexOf('function forwardGet')
    const cuerpo = sinComentarios.slice(i, i + 700)
    assert.match(cuerpo, /u\.pathname\s*\+\s*u\.search/,
      'forwardGet debe conservar la query string')
  })
})

describe('Lo que NO se reenvía, y por qué', () => {
  test('REGRESION: /identity NO se reenvía — un secundario no debe decir que es la caja', () => {
    // /identity pregunta por ESTA máquina. Reenviarla haría que un secundario se
    // presentara con la identidad de la caja y el descubrimiento de terminales
    // dejaría de distinguirlas.
    assert.doesNotMatch(sinComentarios, /LECTURAS_REENVIADAS\s*=\s*\[[^\]]*'\/identity'/)
  })

  test('REGRESION: /health NO se reenvía — mediría a la máquina equivocada', () => {
    assert.doesNotMatch(sinComentarios, /LECTURAS_REENVIADAS\s*=\s*\[[^\]]*'\/health'/)
  })
})

describe('Si la caja no contesta', () => {
  test('REGRESION: /state cae al estado LOCAL, no a un error', () => {
    // Devolver 502 dejaría el mapa de mesas en blanco. Mostrar lo que esta
    // terminal sabe es peor que la verdad pero mucho mejor que nada — siempre
    // que se diga, que es la prueba de abajo.
    const i = sinComentarios.indexOf('forward→caja GET')
    assert.ok(i > -1, 'no hay rama de falla del reenvío GET')
    const rama = sinComentarios.slice(i, i + 900)
    assert.match(rama, /state\.toSnapshot\(\)/, 'debe servir el estado local al fallar')
  })

  test('REGRESION: y lo DICE — cabecera X-Fullsite-Origen: local-degradado', () => {
    // Sin la marca, el consumidor no puede distinguir «el salón» de «lo que yo
    // vi», y volvemos exactamente al bug: un fallo leído como si fuera un hecho.
    const i = sinComentarios.indexOf('forward→caja GET')
    const rama = sinComentarios.slice(i, i + 900)
    assert.match(rama, /X-Fullsite-Origen/)
    assert.match(rama, /local-degradado/)
  })

  test('el timeout de lectura es MÁS CORTO que el de escritura', () => {
    // Una lectura la espera una pantalla con alguien enfrente; una escritura ya
    // se guardó localmente y puede aguantar. 5 s congelando el mapa de mesas
    // sería repetir el problema que se está arreglando.
    const iGet = sinComentarios.indexOf('function forwardGet')
    const iPost = sinComentarios.indexOf('function forwardPost')
    const tGet = Number(/timeout:\s*(\d+)/.exec(sinComentarios.slice(iGet, iGet + 700))?.[1])
    const tPost = Number(/timeout:\s*(\d+)/.exec(sinComentarios.slice(iPost, iPost + 700))?.[1])
    assert.ok(Number.isFinite(tGet) && Number.isFinite(tPost), 'ambos deben declarar timeout')
    assert.ok(tGet < tPost, `lectura ${tGet}ms debe ser menor que escritura ${tPost}ms`)
  })
})

describe('No se rompe lo que ya funcionaba en campo', () => {
  test('REGRESION: el reenvío de ESCRITURA sigue cubriendo las tres rutas', () => {
    // /print y /events son el camino probado en campo: la comanda que llega a
    // cocina en un segundo sin internet. Esta rama no se toca.
    const i = sinComentarios.indexOf("req.method === 'POST'")
    const linea = sinComentarios.slice(i, i + 200)
    for (const ruta of ['/print', '/events', '/drawer']) {
      assert.match(linea, new RegExp(ruta.replace('/', '\\/')), `${ruta} dejó de reenviarse`)
    }
  })

  test('REGRESION: el POST se evalúa ANTES que el GET', () => {
    // Si el GET quedara primero y su condición fuera laxa, podría tragarse
    // peticiones de escritura. El orden es parte del contrato.
    assert.ok(
      sinComentarios.indexOf("req.method === 'POST'") < sinComentarios.indexOf("req.method === 'GET'"),
      'el reenvío de escritura debe evaluarse primero',
    )
  })
})
