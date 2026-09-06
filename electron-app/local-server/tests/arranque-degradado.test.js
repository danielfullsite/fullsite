'use strict'
// Una Caja con la autoridad de PIN rota debe arrancar igual y decirlo.
//
// `new ActorAuthority(...)` lanza si su archivo quedó a medias por un apagón, o
// si alguien cambió el restaurante o la sucursal en la configuración. Como se
// construía sin resguardo, ese error tumbaba el arranque completo de Pedro:
// main.js lo atrapa y abre la ventana igual, así que quedaba un POS sin
// impresión, sin cocina, sin reenvío para las otras terminales y sin PIN, y en
// pantalla sólo "Sin conexión con Caja", sin pista de la causa.
//
// El arranque real deja timers vivos (mDNS, heartbeat, updater) y colgaría a
// `node --test`, así que el recorrido corre en un proceso hijo y el resultado es
// su código de salida. Mismo patrón que enlace-arranque-real.test.js.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')

test('Pedro arranca degradado cuando la autoridad de PIN no se puede construir', () => {
  const runner = path.join(__dirname, 'arranque-degradado-runner.cjs')
  const res = spawnSync(process.execPath, [runner], { encoding: 'utf8', timeout: 90000 })
  const salida = `${res.stdout || ''}${res.stderr || ''}`
  const aprobados = (salida.match(/^PASS /gm) || []).length

  assert.equal(res.status, 0, `el recorrido de arranque degradado falló:\n${salida}`)
  assert.ok(salida.includes('TODO VERDE'), `no llegó al final:\n${salida}`)
  // Si el recorrido se recorta, esta cota lo delata en vez de dar verde con
  // menos comprobaciones de las que decía cubrir.
  assert.ok(aprobados >= 11, `sólo ${aprobados} comprobaciones aprobadas:\n${salida}`)
})
