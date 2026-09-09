'use strict'

/**
 * EL BUILD DE WINDOWS SE CAIA POR UN ARCHIVO QUE EL FILTRO CREIA HABER EXCLUIDO.
 *
 * El 2026-09-09, la PRIMERA vez que este workflow llego a compilar en CI:
 *
 *     ./src/instrumentation.ts
 *     Module not found: Can't resolve '../sentry.server.config'
 *     > Build failed because of webpack errors
 *
 * El mismo script corre limpio en macOS -- comprobado el mismo dia: 456 archivos, 33
 * rutas. La diferencia es el sistema operativo: `fs.cpSync` puede entregarle al filtro
 * rutas con prefijo extendido (`\\?\C:\...`) en Windows, y entonces la comparacion
 * contra la ruta relativa no casa. El archivo llega al build aislado, Next lo compila,
 * y su `import '../sentry.server.config'` apunta a un archivo que este build NO copia a
 * proposito: es configuracion de servidor, y esto es un export estatico.
 *
 * Por que importa mas alla del build roto: `instrumentation.ts` y `proxy.ts` son codigo
 * de SERVIDOR. El paquete que se instala en la caja de un restaurante no debe llevarlos
 * -- el encabezado del script lo dice desde el principio: "never bundle server API code
 * or credentials".
 *
 * Run: node --test electron-app/local-server/tests/el-build-no-lleva-codigo-de-servidor.test.js
 */

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const script = fs.readFileSync(
  path.join(__dirname, '..', '..', 'scripts', 'build-offline-ui.cjs'), 'utf8')

describe('el borrado no depende de como el sistema entregue las rutas', () => {
  test('los dos archivos de servidor se borran DESPUES de copiar', () => {
    assert.match(script, /for \(const name of \['instrumentation\.ts', 'proxy\.ts'\]\) \{\s*\n\s*fs\.rmSync\(path\.join\(build, 'src', name\), \{ force: true \}\)/)
  })

  test('el borrado va despues del cpSync de src, no antes', () => {
    // Antes no serviria de nada: la copia los volveria a poner.
    const copia = script.indexOf("fs.cpSync(path.join(source, 'src')")
    const borrado = script.indexOf("for (const name of ['instrumentation.ts', 'proxy.ts'])")
    assert.ok(copia > -1, 'no encontre la copia de src')
    assert.ok(borrado > copia, 'el borrado tiene que ir DESPUES de la copia')
  })

  test('y el filtro se conserva: hace el trabajo grueso de app/', () => {
    // El borrado es el cinturon, no el reemplazo. El filtro sigue decidiendo que rutas
    // de `app/` entran, que es la mayor parte de lo que este build excluye.
    assert.match(script, /relative === 'instrumentation\.ts'/)
    assert.match(script, /relative\.startsWith\('app\/'\)/)
  })
})

describe('el filtro solo, que era lo que habia, no alcanza', () => {
  /** Lo que Windows puede entregarle al filtro: la misma ruta con prefijo extendido. */
  test('con prefijo extendido, la comparacion del filtro NO casa', () => {
    const source = 'C:\\repo\\dashboard-app'
    const value = '\\\\?\\C:\\repo\\dashboard-app\\src\\instrumentation.ts'
    // Reproduccion del filtro tal cual esta en el script.
    const relative = path.relative(path.join(source, 'src'), value).split(path.sep).join('/')
    assert.notEqual(relative, 'instrumentation.ts',
      'si esto llegara a ser igual, el filtro bastaria y este arreglo sobraria')
  })

  test('sin prefijo si casa — por eso en macOS nunca se vio', () => {
    const source = path.join(os.tmpdir(), 'repo', 'dashboard-app')
    const value = path.join(source, 'src', 'instrumentation.ts')
    const relative = path.relative(path.join(source, 'src'), value).split(path.sep).join('/')
    assert.equal(relative, 'instrumentation.ts')
  })
})

describe('lo que el paquete NO debe llevar a la caja de un restaurante', () => {
  test('el script lo declara en su encabezado', () => {
    assert.match(script, /never bundle server API code or credentials/)
  })

  test('y el bundle generado no trae ninguno de los dos', () => {
    // Si ya se construyo en esta maquina, se comprueba sobre el resultado real. Si no,
    // la prueba lo dice en vez de pasar en verde sobre nada.
    const bundle = path.join(__dirname, '..', '..', 'ui-bundle')
    if (!fs.existsSync(bundle)) {
      console.log('  (sin ui-bundle local — se omite la comprobacion sobre el resultado)')
      return
    }
    const sospechosos = []
    const recorrer = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) recorrer(p)
        else if (/instrumentation\.(ts|js)$|sentry\..*\.config\./.test(e.name)) sospechosos.push(p)
      }
    }
    recorrer(bundle)
    assert.deepEqual(sospechosos, [], `el bundle lleva codigo de servidor: ${sospechosos.join(', ')}`)
  })
})
