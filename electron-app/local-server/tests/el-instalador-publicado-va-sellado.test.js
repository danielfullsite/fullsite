'use strict'
// EL INSTALADOR QUE SE PUBLICA TIENE QUE PODER DECIR DE QUÉ COMMIT SALIÓ.
//
// Barrido 3 (2026-09-12), P0 del instalador. `npm run sellar` escribe
// `build-info.json` (commit, rama, árbol limpio, versión) y `package.json` lo
// incluye en `build.files`. Pero `electron-release.yml` compila con
// `--config electron-builder-pos.json` / `-kds.json`, y ESOS archivos sustituyen
// el bloque `build` entero: ninguno de los dos listaba `build-info.json`.
//
// Resultado: el instalador publicado en una release salía SIN sello. `/health`
// respondía «1.4.0 (sin sellar)» y el paso §1.3 del procedimiento de instalación
// —verificar dentro del ASAR que el commit es el que se probó— no se podía
// cumplir. Y dos artefactos del mismo commit (el de CI y el de release) tenían
// identidad distinta.
//
// Esta prueba no compila nada: compara las tres listas, que es justo lo que
// divergió. Run: node --test electron-app/local-server/tests/el-instalador-publicado-va-sellado.test.js
const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const raiz = path.join(__dirname, '../..')
const leer = (archivo) => JSON.parse(fs.readFileSync(path.join(raiz, archivo), 'utf8'))

describe('las tres configuraciones de empaquetado no pueden divergir', () => {
  const dePackage = leer('package.json').build.files
  const configs = ['electron-builder-pos.json', 'electron-builder-kds.json']

  test('REGRESION: las dos configuraciones publicadas incluyen build-info.json', () => {
    for (const archivo of configs) {
      assert.ok(leer(archivo).files.includes('build-info.json'),
        `${archivo} no empaqueta build-info.json: el instalador saldría sin sello`)
    }
    assert.ok(dePackage.includes('build-info.json'))
  })

  test('y listan exactamente lo mismo que package.json', () => {
    for (const archivo of configs) {
      assert.deepEqual([...leer(archivo).files].sort(), [...dePackage].sort(),
        `${archivo} difiere de package.json: un artefacto llevaría archivos que el otro no`)
    }
  })

  test('el sellador escribe donde el empaquetado lo busca', () => {
    const sellador = fs.readFileSync(path.join(raiz, 'scripts/sellar-version.cjs'), 'utf8')
    assert.match(sellador, /build-info\.json/)
  })
})
