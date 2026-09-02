'use strict'
// El auto-instalador: cuando SI reinicia la terminal, y cuando NO.
//
// ── LO QUE ESTA EN JUEGO ─────────────────────────────────────────────────────
//
// Instalar reinicia Electron, y Pedro muere con Electron (regla dura #4 de
// OFFLINE-LAN-FIELD-PROVEN §4). Un reinicio a media operacion deja al restaurante
// sin imprimir y sin KDS, en el peor momento posible. Estas pruebas son el unico
// muro entre "se actualiza solo" y "se reinicia en plena cena".
//
// ── EL BUG QUE SE ENCONTRO AL CABLEARLO ──────────────────────────────────────
//
// `startLocalServer()` devolvia { httpServer, close, serverId, lanIp, wsHub } — SIN
// `state`. El instalador hacia `localServer.state.toSnapshot()`, que daba undefined,
// la politica lo leia como "no se pudo leer el estado" y NUNCA instalaba. En
// silencio: no hay error, simplemente no pasa nada nunca.
//
// Es la misma familia de los fallos del 2026-08-31: algo que no se puede saber leido
// como un hecho. Aqui al menos fallaba del lado seguro, pero el auto-update habria
// quedado muerto sin que nadie se enterara.
//
// Por eso hay una prueba del CONTRATO: si alguien deja de exportar `state`, falla.

const { test, describe, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

const inst = require('../../update/auto-installer')

const enReposo = { turno: null, mesas: [['1', { status: 'libre' }]], kds_orders: [] }
const enServicio = { turno: { id: 't1' }, mesas: [['1', { status: 'ocupada' }]], kds_orders: [{ mesa: 1 }] }

beforeEach(() => inst._reset())

describe('Contrato con el servidor local', () => {
  test('REGRESION: startLocalServer DEBE exportar `state`', () => {
    // Sin esto el instalador recibe undefined y no instala NUNCA, en silencio.
    const fs = require('fs')
    const path = require('path')
    const fuente = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.match(fuente, /return \{[^}]*\bstate\b[^}]*\}/,
      'local-server/index.js debe devolver `state` en su objeto de retorno')
  })
})

describe('No se instala a media operacion', () => {
  test('REGRESION: con turno, comandas y mesas ocupadas NO instala', async () => {
    inst._marcarDescargada('1.4.0')
    let instalo = false
    const r = await inst.intentarInstalar({
      getSnapshot: () => enServicio,
      estaBloqueada: async () => { instalo = true; return false },
    })
    assert.equal(r.instalo, false)
    assert.equal(instalo, false, 'ni siquiera debe llegar a consultar el freno')
  })

  test('REGRESION: si getSnapshot TRUENA, no instala (falla cerrado)', async () => {
    inst._marcarDescargada('1.4.0')
    const r = await inst.intentarInstalar({
      getSnapshot: () => { throw new Error('el servidor local no responde') },
      estaBloqueada: async () => false,
    })
    assert.equal(r.instalo, false)
  })

  test('REGRESION: sin getSnapshot tampoco instala', async () => {
    // Es el bug real: `localServer.state` no existia y esto llegaba como undefined.
    inst._marcarDescargada('1.4.0')
    const r = await inst.intentarInstalar({ estaBloqueada: async () => false })
    assert.equal(r.instalo, false)
  })

  test('sin nada descargado no hace nada', async () => {
    const r = await inst.intentarInstalar({ getSnapshot: () => enReposo, estaBloqueada: async () => false })
    assert.equal(r.instalo, false)
  })
})

describe('El freno de emergencia', () => {
  test('REGRESION: una version BLOQUEADA no se instala, aunque el restaurante este libre', async () => {
    inst._marcarDescargada('1.4.0-mala')
    const r = await inst.intentarInstalar({
      getSnapshot: () => enReposo,
      estaBloqueada: async (v) => v === '1.4.0-mala',
    })
    assert.equal(r.instalo, false)
    assert.match(r.motivo, /bloquead/)
  })

  test('REGRESION: si NO se puede consultar el freno, NO se instala (falla cerrado)', async () => {
    // A proposito distinto del manager, que falla ABIERTO al consultar el freno:
    // una cosa es dejar OPERAR sin Supabase, otra instalar software a ciegas.
    inst._marcarDescargada('1.4.0')
    const r = await inst.intentarInstalar({
      getSnapshot: () => enReposo,
      estaBloqueada: async () => { throw new Error('Supabase no responde') },
    })
    assert.equal(r.instalo, false)
    assert.match(r.motivo, /freno/)
  })

  test('el freno se consulta JUSTO antes de instalar, no solo al descargar', async () => {
    // Entre la descarga y este momento pueden pasar horas, y una version puede
    // bloquearse en ese rato — que es precisamente para lo que sirve el freno.
    inst._marcarDescargada('1.4.0')
    let consultas = 0
    await inst.intentarInstalar({
      getSnapshot: () => enReposo,
      estaBloqueada: async () => { consultas++; return true },
    })
    assert.equal(consultas, 1)
  })
})

describe('Con el restaurante en reposo SI instala', () => {
  test('sin turno, sin comandas y sin mesas: reinicia e instala', async () => {
    inst._reset()
    let llamado = null
    // Se inyecta un updater falso: no se va a reiniciar una maquina en una prueba.
    inst.iniciar({
      canal: 'stable',
      getSnapshot: () => enReposo,
      estaBloqueada: async () => false,
      updaterInyectado: {
        on: () => {}, removeAllListeners: () => {},
        quitAndInstall: (silent, forceRun) => { llamado = { silent, forceRun } },
      },
    })
    inst._marcarDescargada('1.4.0')

    const r = await inst.intentarInstalar({ getSnapshot: () => enReposo, estaBloqueada: async () => false })

    assert.equal(r.instalo, true)
    assert.deepEqual(llamado, { silent: true, forceRun: true },
      'debe reabrir el POS solo: si no, la terminal se queda apagada hasta que alguien la abra')
  })
})

describe('Configuracion del updater', () => {
  test('el canal piloto acepta prereleases; el estable NO', () => {
    for (const [canal, esperado] of [['pilot', true], ['development', true], ['stable', false]]) {
      inst._reset()
      const falso = { on: () => {}, quitAndInstall: () => {} }
      inst.iniciar({ canal, getSnapshot: () => null, estaBloqueada: async () => false, updaterInyectado: falso })
      assert.equal(falso.allowPrerelease, esperado, `canal ${canal}`)
    }
  })

  test('REGRESION: NUNCA instala solo al cerrar la app', () => {
    // El operador puede cerrar el POS a media operacion —un reinicio de Windows, un
    // cierre accidental— y ese no es un momento seguro. La instalacion la decide la
    // politica, no el ciclo de vida de la app.
    inst._reset()
    const falso = { on: () => {}, quitAndInstall: () => {} }
    inst.iniciar({ canal: 'stable', getSnapshot: () => null, estaBloqueada: async () => false, updaterInyectado: falso })
    assert.equal(falso.autoInstallOnAppQuit, false)
    assert.equal(falso.autoDownload, true, 'descargar en segundo plano si esta bien')
  })

  test('si electron-updater no esta, no truena el arranque del POS', () => {
    inst._reset()
    // Sin `updaterInyectado` y sin el paquete instalado, `iniciar` debe devolver un
    // handle inerte en vez de lanzar. Un fallo del updater jamas puede impedir que
    // el restaurante abra.
    const h = inst.iniciar({ canal: 'stable', getSnapshot: () => null, estaBloqueada: async () => false })
    assert.equal(typeof h.detener, 'function')
  })
})
