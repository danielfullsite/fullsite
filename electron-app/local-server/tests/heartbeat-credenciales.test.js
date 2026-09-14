'use strict'
// Guardián: las credenciales de Supabase se resuelven con el nombre DEL ESQUEMA.
// Run: node --test electron-app/local-server/tests/heartbeat-credenciales.test.js
//
// ─── Por qué existe este archivo ──────────────────────────────────────────────
// El esquema de provisión (config-schema.js) declara la llave como
// `supabaseAnonKey`. El consumidor (local-server/index.js) la leía como
// `supabaseKey` — un nombre que ningún config del esquema tiene.
//
// En la ruta de producción eso NO explotó, por accidente: `main.js` arma su
// `cfg` traduciendo `appConfig.supabaseAnonKey → supabaseKey` antes de llamar
// al local server. La trampa quedaba armada para cualquier otro llamador que
// pasara un config del esquema tal cual: runners de prueba, el laboratorio
// multi-terminal, un arranque directo. Esos se quedaban sin llave, y
// `heartbeat.start()` se apagaba por su guard sin decir por qué.
//
// Contexto de por qué importa, medido el 2026-09-13 contra Supabase de AMALAY:
//   select ... from local_server_heartbeats  →  []   (cero filas, nunca una)
// La causa de ESA tabla vacía es otra y sigue sin confirmarse (lo más probable:
// el config.json de la terminal no trae `supabaseAnonKey`, porque la receta de
// clonado no lo escribe y no hay credencial embebida en electron-app).
// Este test no cierra esa; cierra la trampa de nombres que estaba al lado.
//
// Lo que está en juego: sin telemetría no hay forma de saber qué pasa en una
// terminal sin ir físicamente o entrar por TeamViewer — justo lo que
// documentamos como la debilidad de Wansoft en
// docs/knowledge/wansoft/LESSONS-NETSILVER.md §95.
//
// Un guardián no vale hasta verlo fallar: si cambias `readSupabaseCreds` para
// que lea sólo `config.supabaseKey`, el primer test de abajo truena.

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { readSupabaseCreds } = require('../config-schema')

const SIN_ENTORNO = {}

describe('readSupabaseCreds — el nombre del esquema manda', () => {
  test('REGRESIÓN: un config con el nombre del esquema resuelve la llave', () => {
    // Ésta es la forma que produce el asistente de provisión y la que trae
    // fromLegacy(). Si esto devuelve '', la flota se apaga entera.
    const creds = readSupabaseCreds({
      supabaseUrl:     'https://proyecto.supabase.co',
      supabaseAnonKey: 'llave-del-esquema',
    }, SIN_ENTORNO)

    assert.equal(creds.supabaseUrl, 'https://proyecto.supabase.co')
    assert.equal(creds.supabaseKey, 'llave-del-esquema',
      'config.supabaseAnonKey es el nombre que declara config-schema.js. ' +
      'Si esto falla, la telemetría de flota vuelve a morir en silencio.')
  })

  test('el alias escrito a mano (supabaseKey) sigue sirviendo', () => {
    const creds = readSupabaseCreds({
      supabaseUrl: 'https://proyecto.supabase.co',
      supabaseKey: 'llave-a-mano',
    }, SIN_ENTORNO)

    assert.equal(creds.supabaseKey, 'llave-a-mano')
  })

  test('el nombre del esquema gana sobre el alias', () => {
    const creds = readSupabaseCreds({
      supabaseAnonKey: 'la-del-esquema',
      supabaseKey:     'la-de-a-mano',
    }, SIN_ENTORNO)

    assert.equal(creds.supabaseKey, 'la-del-esquema')
  })

  test('el entorno es el ÚLTIMO recurso, nunca el primero', () => {
    // En una terminal instalada por .exe no hay variables de entorno. Si el
    // entorno ganara, un config correcto quedaría ignorado en desarrollo y la
    // diferencia dev/campo volvería a esconder el bug.
    const creds = readSupabaseCreds(
      { supabaseUrl: 'https://del-config.supabase.co', supabaseAnonKey: 'llave-config' },
      { SUPABASE_URL: 'https://del-entorno.supabase.co', SUPABASE_ANON_KEY: 'llave-entorno' },
    )

    assert.equal(creds.supabaseUrl, 'https://del-config.supabase.co')
    assert.equal(creds.supabaseKey, 'llave-config')
  })

  test('sin config, el entorno sí responde (ruta de desarrollo)', () => {
    const creds = readSupabaseCreds({}, {
      SUPABASE_URL:      'https://del-entorno.supabase.co',
      SUPABASE_ANON_KEY: 'llave-entorno',
    })

    assert.equal(creds.supabaseUrl, 'https://del-entorno.supabase.co')
    assert.equal(creds.supabaseKey, 'llave-entorno')
  })

  test('sin nada devuelve cadenas vacías, no undefined', () => {
    // heartbeat.start() decide con `if (!supabaseUrl || !supabaseKey)`.
    // Cadenas vacías mantienen ese guard predecible.
    const creds = readSupabaseCreds({}, SIN_ENTORNO)

    assert.equal(creds.supabaseUrl, '')
    assert.equal(creds.supabaseKey, '')
  })

  test('no truena con config undefined', () => {
    assert.doesNotThrow(() => readSupabaseCreds(undefined, SIN_ENTORNO))
  })
})

describe('el config que produce fromLegacy queda utilizable', () => {
  test('una terminal migrada desde config viejo conserva sus credenciales', () => {
    const { fromLegacy } = require('../config-schema')

    const migrado = fromLegacy({
      restaurantId:    'amalay-mty',
      clientId:        'amalay-mty',
      terminalId:      'legacy-term-001',
      supabaseUrl:     'https://proyecto.supabase.co',
      supabaseAnonKey: 'llave-legacy',
    })

    // fromLegacy puede devolver null si la migración no valida; en ese caso
    // este test no aplica y lo decimos, en vez de pasar en falso.
    assert.ok(migrado, 'fromLegacy devolvió null — revisa el esquema mínimo')

    const creds = readSupabaseCreds(migrado, SIN_ENTORNO)
    assert.equal(creds.supabaseKey, 'llave-legacy',
      'fromLegacy mapea supabaseAnonKey; readSupabaseCreds debe poder leerlo')
  })
})
