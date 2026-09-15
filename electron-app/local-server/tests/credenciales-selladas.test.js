'use strict'
// Guardián: una terminal instalada por .exe tiene que poder conseguir la llave.
// Run: node --test electron-app/local-server/tests/credenciales-selladas.test.js
//
// ─── Por qué existe este archivo ─────────────────────────────────────────────
//
// Medido contra AMALAY el 2026-09-14. El config.json de una terminal
// provisionada NO trae `supabaseUrl` ni `supabaseAnonKey`, y una máquina
// instalada por .exe tampoco tiene variables de entorno. Resultado: la cadena de
// `readSupabaseCreds` devolvía cadenas vacías, y eso costaba DOS cosas a la vez:
//
//   1. TELEMETRÍA MUDA. `local_server_heartbeats` con cero filas desde que
//      existe. Sin diagnóstico remoto hay que ir físicamente a la caja.
//
//   2. LA TERMINAL NO SE ACTUALIZA NUNCA. Antes de instalar, `main.js` consulta
//      el freno de versiones:
//          estaBloqueada: async (v) => {
//            if (!supabaseUrl || !supabaseKey) throw new Error('sin config de Supabase')
//      y el auto-instalador falla CERRADO ('no se pudo consultar el freno de
//      versiones'). El fail-closed es CORRECTO —instalar a ciegas es peor— pero
//      sin credencial nunca se puede consultar. Ésa es la razón de fondo de que
//      cada arreglo exija visitar la caja con una USB.
//
// La cuarta fuente (sellada en el build) cierra eso. Este guardián comprueba que
// la cadena la contemple, que la ausencia del archivo NO rompa nada, y que la
// llave nunca se filtre por donde no debe.

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { readSupabaseCreds } = require('../config-schema')

const RAIZ_ELECTRON = join(__dirname, '..', '..')
const SIN_ENTORNO = {}

describe('de dónde saca la llave una terminal instalada por .exe', () => {
  test('REGRESIÓN: la cadena contempla la credencial sellada en el build', () => {
    const src = readFileSync(join(RAIZ_ELECTRON, 'local-server', 'config-schema.js'), 'utf8')
    assert.match(src, /sellado\.supabaseUrl/, 'sin cuarta fuente, un .exe nace sin llave')
    assert.match(src, /sellado\.supabaseAnonKey/)
  })

  test('sin archivo sellado no truena: devuelve vacío y sigue', () => {
    // En desarrollo el archivo no existe. Que eso lance rompería el arranque del
    // POS por una credencial de telemetría, que es exactamente al revés de lo
    // que queremos: operar SIEMPRE gana.
    const creds = readSupabaseCreds({}, SIN_ENTORNO)
    assert.equal(typeof creds.supabaseUrl, 'string')
    assert.equal(typeof creds.supabaseKey, 'string')
  })

  test('el config de la terminal le gana al sellado', () => {
    // Un restaurante apuntado a otro proyecto de Supabase tiene que poder
    // sobrescribir lo que trae el instalador, sin recompilar.
    const creds = readSupabaseCreds(
      { supabaseUrl: 'https://propio.supabase.co', supabaseAnonKey: 'llave-del-restaurante' },
      SIN_ENTORNO,
    )
    assert.equal(creds.supabaseUrl, 'https://propio.supabase.co')
    assert.equal(creds.supabaseKey, 'llave-del-restaurante')
  })

  test('el entorno también le gana al sellado', () => {
    const creds = readSupabaseCreds({}, { SUPABASE_URL: 'https://env.supabase.co', SUPABASE_ANON_KEY: 'del-entorno' })
    assert.equal(creds.supabaseUrl, 'https://env.supabase.co')
    assert.equal(creds.supabaseKey, 'del-entorno')
  })

  test('REGRESIÓN: el archivo sellado NUNCA se commitea', () => {
    // Es lo único que separa «la llave viaja en el instalador» (que ya pasaba,
    // dentro del ui-bundle) de «la llave vive en el repo» (que no debe pasar).
    const ignore = readFileSync(join(RAIZ_ELECTRON, '.gitignore'), 'utf8')
    assert.match(ignore, /credenciales-selladas\.json/,
      'sin esta línea, el primer build local mete la llave al repo')
  })

  test('main.js resuelve por la fuente única, no por su propia copia', () => {
    // Estaba escrita tres veces —esquema y dos lugares de main.js— y por eso se
    // desincronizaban: index.js leía `supabaseKey` cuando el esquema declara
    // `supabaseAnonKey`. Ver heartbeat-credenciales.test.js.
    const main = readFileSync(join(RAIZ_ELECTRON, 'main.js'), 'utf8')
    const copiasAMano = main.match(/appConfig\.supabaseAnonKey\s*\|\|\s*process\.env\.SUPABASE_ANON_KEY/g) || []
    assert.equal(copiasAMano.length, 0,
      `main.js todavía resuelve credenciales a mano en ${copiasAMano.length} lugar(es)`)
    assert.match(main, /configSchema\.readSupabaseCreds\(appConfig\)/)
  })

  test('el sellador existe y no imprime la llave', () => {
    const p = join(RAIZ_ELECTRON, 'scripts', 'sellar-credenciales.cjs')
    assert.ok(existsSync(p), 'sin el sellador, nada escribe el archivo en el build')
    const src = readFileSync(p, 'utf8')
    assert.match(src, /key\.length/, 'debe reportar el largo, no el valor')
    assert.ok(!/console\.log\(.*\$\{key\}/.test(src), 'el sellador imprimiría la llave completa')
  })
})
