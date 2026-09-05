'use strict'
// El enlace ascendente, por el ARRANQUE REAL de Pedro.
//
// ── POR QUÉ ESTE ARCHIVO EXISTE, Y POR QUÉ LANZA UN PROCESO HIJO ─────────────
//
// `enlace-ascendente-e2e.test.js` prueba el módulo cableado A MANO: el test
// llama a `conectarConLaCaja` él mismo. Eso demuestra que el transporte
// funciona, y NO demuestra que Pedro lo encienda. Es exactamente la diferencia
// que dejó al reenvío de lectura sin efecto en el piso: funcionaba y nadie lo
// usaba.
//
// Aquí se levanta Pedro con `startLocalServer` — el mismo entrypoint que llama
// Electron — y se comprueba que el enlace se activa SOLO, con la configuración
// de una terminal secundaria real.
//
// El arranque real deja timers vivos (mDNS, heartbeat, updater) y `node --test`
// nunca termina: el repo ya lo documenta en forward-port.test.js. Por eso la
// E2E vive en `arranque-real-runner.cjs`, que controla su ciclo de vida y sale
// con un código, y este archivo lo ejecuta como proceso hijo. Sigue dentro de
// la suite; lo que cambia es quién es dueño del event loop.

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const path = require('node:path')

describe('Arranque real de Pedro · enlace ascendente', () => {
  test('POS 3 → Caja → tablero de POS 2, con Pedro arrancado de verdad', () => {
    let salida = ''
    let codigo = 0
    try {
      salida = execFileSync(
        process.execPath,
        [path.join(__dirname, 'arranque-real-runner.cjs')],
        { encoding: 'utf8', timeout: 90_000, cwd: path.join(__dirname, '..', '..') },
      )
    } catch (e) {
      salida = `${e.stdout || ''}${e.stderr || ''}`
      codigo = e.status ?? 1
    }

    // Se imprime siempre: cuando falla, el detalle de QUÉ falló está aquí y no
    // en una aserción genérica.
    console.log(salida.split('\n').filter((l) => /^(PASS|FAIL|TODO|FALLARON|ERROR)/.test(l)).join('\n'))

    assert.equal(codigo, 0, `el arranque real falló:\n${salida}`)
    assert.match(salida, /TODO VERDE/)

    // Que las siete comprobaciones corrieran de verdad. Sin esto, un runner que
    // saliera con 0 sin ejecutar nada pasaría en verde — la forma exacta del
    // falso positivo que costó esta semana.
    const pases = (salida.match(/^PASS /gm) || []).length
    assert.ok(pases >= 12, `sólo corrieron ${pases} comprobaciones de 12`)
  })
})
