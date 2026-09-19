'use strict'
// Guardián: una flota que no reporta NO puede verse igual que una flota sana.
// Run: node --test electron-app/local-server/tests/telemetria-que-se-oye.test.js
//
// ─── Por qué existe este archivo ─────────────────────────────────────────────
//
// Medido contra el Supabase de AMALAY el 2026-09-14:
//
//     select count(*) from local_server_heartbeats  ->  0     (cero desde que existe)
//
// Toda la tubería estaba construida: la tabla, el emisor (`telemetry/heartbeat.js`),
// la API que la consume (`/api/platform/devices`) y hasta las pantallas
// (`/platform/devices`, `/platform/terminales`). Nunca pasó un solo renglón.
//
// La causa, confirmada el mismo día leyendo el config.json de una terminal
// provisionada: no trae `supabaseAnonKey` ni `supabaseUrl` — la receta de clonado
// no los escribe — así que `start()` se apaga por su guard.
//
// Y aquí está lo importante: el guard YA avisaba, con un `console.warn` que decía
// exactamente qué faltaba. No sirvió de nada. Vive en la consola de Electron, que
// nadie abre nunca. El apagón era perfectamente visible... para nadie.
//
// Por eso este guardián no comprueba que la telemetría FUNCIONE —eso depende de
// una credencial que vive en cada terminal— sino que su APAGÓN SEA AUDIBLE: que
// el módulo recuerde por qué está apagado y que `/health` lo publique, porque
// `/health` sí lo leen el certificador (`scripts/certificar-terminal.mjs`) y el
// panel de flota.
//
// Un guardián no vale hasta verlo fallar: quita `telemetria: heartbeat.estado()`
// de la respuesta de /health en index.js y el último test truena.

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const heartbeat = require('../telemetry/heartbeat')

const RAIZ = join(__dirname, '..')

describe('la telemetría dice por qué está apagada', () => {
  test('REGRESIÓN: el módulo expone su estado', () => {
    assert.equal(typeof heartbeat.estado, 'function',
      'sin estado() consultable, el apagón sólo existe en un console.warn')
  })

  test('sin credenciales queda apagada Y dice qué falta', () => {
    heartbeat.start({ supabaseUrl: '', supabaseKey: '' })
    const e = heartbeat.estado()
    assert.equal(e.activa, false)
    assert.match(e.motivo, /falta/i, `el motivo tiene que nombrar lo que falta, no ser gen<rico: ${e.motivo}`)
    assert.match(e.motivo, /supabase/i)
  })

  test('el estado NUNCA incluye la llave', () => {
    // Se publica en /health, que contesta sin credencial LAN (RUTAS_ABIERTAS).
    // Filtrar aquí una anon key sería regalar el acceso a cualquiera en la red.
    heartbeat.start({ supabaseUrl: 'https://x.supabase.co', supabaseKey: 'llave-secreta-de-prueba' })
    heartbeat.stop()
    const texto = JSON.stringify(heartbeat.estado())
    assert.ok(!/llave-secreta-de-prueba/.test(texto), 'el estado filtró la llave')
    assert.ok(!/apikey|anonKey|supabaseKey/i.test(texto), 'el estado no debe traer nombres de credencial')
  })

  test('«activa» no basta: se marca el último envío con éxito', () => {
    // Arrancar no es reportar. Cuando había 0 filas, el módulo igual habría dicho
    // que estaba "activo": lo que faltaba era la prueba de que una fila LLEGÓ.
    const src = readFileSync(join(RAIZ, 'telemetry', 'heartbeat.js'), 'utf8')
    assert.match(src, /ultimoEnvio: new Date\(\)\.toISOString\(\)/,
      'el 2xx tiene que dejar marca; si no, «activa» vuelve a mentir')
  })

  test('REGRESIÓN: /health publica el estado de la telemetría', () => {
    const src = readFileSync(join(RAIZ, 'index.js'), 'utf8')
    assert.match(src, /telemetria:\s*heartbeat\.estado\(\)/,
      '/health es el único lugar que ya leen el certificador y el panel de flota')
  })
})
