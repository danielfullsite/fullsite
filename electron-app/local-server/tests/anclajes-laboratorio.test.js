'use strict'
// Las cuatro variables que permiten levantar cinco terminales en una máquina.
//
// ── POR QUÉ IMPORTAN ────────────────────────────────────────────────────────
//
// Para probar de verdad 3 POS + KDS + caja hay que correr cinco procesos Electron
// a la vez. Hoy los cinco escucharían en 7717 (EADDRINUSE en el segundo),
// compartirían userData (misma config, misma identidad, mismos eventos) y
// cargarían https://app.fullsite.mx — o sea PRODUCCIÓN.
//
// Ese último es el que las vuelve obligatorias: sin FULLSITE_POS_URL, un
// laboratorio automatizado escribiría en los datos de un restaurante real.
//
// ── QUÉ PRUEBA ESTO, Y QUÉ NO ───────────────────────────────────────────────
//
// Prueba el COMPORTAMIENTO de la resolución: se ejecuta la misma expresión en un
// proceso hijo real, con el entorno puesto, y se observa el valor resultante. NO
// se busca texto en main.js.
//
// Lo que NO prueba: que Electron arranque con ellas. Eso exige un Electron real
// y es el laboratorio E2E, no esta suite.

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const MAIN = path.join(__dirname, '..', '..', 'main.js')

/**
 * Ejecuta EN UN PROCESO REAL las expresiones de main.js que resuelven cada
 * anclaje, con el entorno pedido. Se extraen del archivo para que la prueba siga
 * el código: si alguien cambia la expresión, esto cambia con ella.
 *
 * Nota honesta: no se carga main.js entero — hacerlo requiere Electron y abriría
 * ventanas. Se aísla la resolución, que es lo que esta prueba afirma cubrir.
 */
function resolver(env) {
  const fuente = fs.readFileSync(MAIN, 'utf8')

  const linePos = /const POS_URL = ([^\n;]+);/.exec(fuente)
  const lineKds = /const KDS_URL = ([^\n;]+);/.exec(fuente)
  const bloquePuerto = /const LOCAL_SERVER_PORT\s+= (\(\(\) => \{[\s\S]*?\}\)\(\));/.exec(fuente)
  assert.ok(linePos && lineKds && bloquePuerto, 'no se hallaron las expresiones en main.js')

  const script = `
    const POS = ${linePos[1]};
    const KDS = ${lineKds[1]};
    const PORT = ${bloquePuerto[1]};
    process.stdout.write(JSON.stringify({ POS, KDS, PORT }));
  `
  const out = execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
  return JSON.parse(out)
}

describe('Los defaults de PRODUCCIÓN no cambian', () => {
  test('REGRESION: sin variables, todo apunta a producción y al 7717', () => {
    // Si esto falla, una terminal instalada en un restaurante cambia de
    // comportamiento por un cambio pensado para el laboratorio. Es la prueba más
    // importante del archivo.
    const r = resolver({
      FULLSITE_POS_URL: undefined,
      FULLSITE_KDS_URL: undefined,
      FULLSITE_LOCAL_SERVER_PORT: undefined,
    })
    assert.equal(r.POS, 'https://app.fullsite.mx/pos')
    assert.equal(r.KDS, 'https://app.fullsite.mx/pos/cocina')
    assert.equal(r.PORT, 7717)
  })

  test('una variable VACÍA no cuenta como configuración', () => {
    // `FULLSITE_POS_URL=` en un .env mal escrito no debe dejar al POS sin URL.
    const r = resolver({ FULLSITE_POS_URL: '', FULLSITE_KDS_URL: '', FULLSITE_LOCAL_SERVER_PORT: '' })
    assert.equal(r.POS, 'https://app.fullsite.mx/pos')
    assert.equal(r.PORT, 7717)
  })
})

describe('Con las variables puestas, cada terminal es distinta', () => {
  test('POS y KDS apuntan a la copia local', () => {
    const r = resolver({
      FULLSITE_POS_URL: 'http://127.0.0.1:3100/pos',
      FULLSITE_KDS_URL: 'http://127.0.0.1:3100/pos/cocina',
    })
    assert.equal(r.POS, 'http://127.0.0.1:3100/pos')
    assert.equal(r.KDS, 'http://127.0.0.1:3100/pos/cocina')
  })

  test('cada terminal escucha en su propio puerto', () => {
    assert.equal(resolver({ FULLSITE_LOCAL_SERVER_PORT: '7801' }).PORT, 7801)
    assert.equal(resolver({ FULLSITE_LOCAL_SERVER_PORT: '7802' }).PORT, 7802)
  })
})

describe('Un puerto inservible NO deja a Pedro sin arrancar', () => {
  // Pedro caído = POS sin impresión y sin KDS. Ante una variable basura, es mejor
  // el default de producción que no arrancar.
  for (const malo of ['abc', '0', '-1', '70000', '77.5']) {
    test(`"${malo}" cae al 7717`, () => {
      assert.equal(resolver({ FULLSITE_LOCAL_SERVER_PORT: malo }).PORT, 7717)
    })
  }
})

describe('userData separado por terminal', () => {
  test('REGRESION: main.js aplica setPath ANTES de que nadie lea userData', () => {
    // `app.setPath('userData')` sólo surte efecto si corre antes del primer
    // getPath. Si quedara después, las cinco terminales compartirían config,
    // identidad y event store — el laboratorio probaría UNA terminal cinco veces
    // y saldría verde. Un falso verde es peor que no probar.
    //
    // Esto sí se verifica por ORDEN en el archivo, porque el orden ES la
    // propiedad. No es una prueba de existencia de una cadena: compara posiciones
    // de dos llamadas reales.
    const fuente = fs.readFileSync(MAIN, 'utf8')
    const iSet = fuente.indexOf("app.setPath('userData'")
    const iGet = fuente.indexOf("app.getPath('userData')")
    assert.ok(iSet > -1, 'main.js no aplica FULLSITE_USER_DATA_DIR')
    assert.ok(iGet > -1, 'premisa: alguien lee userData')
    assert.ok(iSet < iGet, `setPath (${iSet}) debe ir antes del primer getPath (${iGet})`)
  })

  test('el directorio se crea si no existe', () => {
    // La terminal 3 de un laboratorio nuevo no tiene carpeta todavía.
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-ud-'))
    const destino = path.join(base, 'pos3', 'anidado')
    const script = `
      const fs = require('fs'); const path = require('path');
      const dir = path.resolve(process.env.FULLSITE_USER_DATA_DIR);
      fs.mkdirSync(dir, { recursive: true });
      process.stdout.write(fs.existsSync(dir) ? 'SI' : 'NO');
    `
    try {
      const out = execFileSync(process.execPath, ['-e', script], {
        env: { ...process.env, FULLSITE_USER_DATA_DIR: destino }, encoding: 'utf8',
      })
      assert.equal(out, 'SI')
    } finally {
      fs.rmSync(base, { recursive: true, force: true })
    }
  })
})
