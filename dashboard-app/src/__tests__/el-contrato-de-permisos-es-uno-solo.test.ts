import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

// ESTA RAMA LLEVABA SEMANAS SIN PODER DESPLEGARSE, Y NADIE LO HABIA VISTO.
//
// `pos-permissions.ts` importaba el contrato con
// `'../../../electron-app/local-server/core/permission-profiles.json'`. Todos los
// previews de Vercel de `lab/pin-real-desde-pantalla` estaban en ERROR desde
// `14ac4831 feat(pedro): authorize local payments with prepared employee sessions`:
//
//     Module not found: Can't resolve '../../../electron-app/local-server/core/permission-profiles.json'
//
// La primera hipotesis era `.vercelignore`, que si excluye `electron-app/` del deploy.
// Es falsa: el build truena IGUAL en local, con el archivo presente en disco. La causa
// es Next -- Turbopack no resuelve un modulo fuera de la raiz del proyecto
// (`dashboard-app/`). O sea que ningun arreglo del ignore lo habria salvado.
//
// POR QUE HAY DOS ARCHIVOS Y NO SE MOVIO EL CANONICO. Pedro lee el suyo en RUNTIME
// (`actor-authority.js`: `require('./permission-profiles.json')`), va en las listas de
// empaquetado (`electron-builder-pos.json`, `electron-builder-kds.json`,
// `package.json`) y `verify-windows-package.cjs` comprueba que este en el instalador.
// Mover el canonico obligaba a tocar el empaquetado y el arranque de Pedro a dias del
// cutover de AMALAY -- riesgo sobre el artefacto que Daniel necesita funcionando.
//
// La objecion legitima a una copia es que DERIVA. Esta prueba lo impide: compara los
// dos archivos byte a byte. Si alguien edita uno, CI se pone roja en el commit, no en
// la caja. Un permiso que difiere entre el servidor y la terminal es exactamente la
// clase de bug que este proyecto lleva toda la sesion cerrando.

const CANONICO = join(__dirname, '..', '..', '..',
  'electron-app', 'local-server', 'core', 'permission-profiles.json')
const COPIA = join(__dirname, '..', 'lib', 'permission-profiles.json')

const sha = (ruta: string) =>
  createHash('sha256').update(readFileSync(ruta)).digest('hex')

describe('el contrato de permisos no puede derivar', () => {
  it('los dos archivos son identicos byte a byte', () => {
    // SI ESTA PRUEBA FALLA: la fuente es la de electron-app. Copiala encima de la otra:
    //   cp electron-app/local-server/core/permission-profiles.json \
    //      dashboard-app/src/lib/permission-profiles.json
    expect(sha(COPIA)).toBe(sha(CANONICO))
  })

  it('y tienen los mismos perfiles con los mismos valores', () => {
    // Redundante con el hash a proposito: si algun dia se permite formateo distinto,
    // esta sigue defendiendo lo que importa.
    const a = JSON.parse(readFileSync(CANONICO, 'utf8'))
    const b = JSON.parse(readFileSync(COPIA, 'utf8'))
    expect(b).toEqual(a)
  })

  it('el canonico tiene los perfiles que Pedro espera', () => {
    const c = JSON.parse(readFileSync(CANONICO, 'utf8'))
    expect(Object.keys(c.profiles)).toEqual(
      expect.arrayContaining(['admin', 'gerente', 'cajero', 'mesero']))
  })

  it('cancelar_ordenes sigue siendo solo de administrador', () => {
    // Eduardo, AMALAY: "solo yo tengo este". Es el permiso del vector de skimming.
    const c = JSON.parse(readFileSync(CANONICO, 'utf8'))
    expect(c.profiles.mesero.cancelar_ordenes).toBe(false)
    expect(c.profiles.admin.cancelar_ordenes).toBe(true)
  })
})

describe('el import no vuelve a cruzar la frontera del proyecto', () => {
  const src = readFileSync(join(__dirname, '..', 'lib', 'pos-permissions.ts'), 'utf8')
  const codigo = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('importa la copia local', () => {
    expect(codigo).toMatch(/import permissionContract from '\.\/permission-profiles\.json'/)
  })

  it('y NO el archivo de electron-app', () => {
    // Con este import el build de produccion no compila -- ni en Vercel ni en local.
    expect(codigo).not.toMatch(/\.\.\/\.\.\/\.\.\/electron-app/)
  })
})

describe('Pedro sigue leyendo el suyo', () => {
  it('actor-authority.js requiere el canonico, no la copia', () => {
    // Si alguien "unifica" apuntando Pedro a dashboard-app/, el instalador se queda sin
    // el archivo: no viaja en el paquete.
    const actor = readFileSync(join(__dirname, '..', '..', '..',
      'electron-app', 'local-server', 'core', 'actor-authority.js'), 'utf8')
    expect(actor).toMatch(/require\('\.\/permission-profiles\.json'\)/)
  })

  it('y el verificador del paquete lo sigue exigiendo', () => {
    const verify = readFileSync(join(__dirname, '..', '..', '..',
      'electron-app', 'scripts', 'verify-windows-package.cjs'), 'utf8')
    expect(verify).toMatch(/local-server\/core\/permission-profiles\.json/)
  })
})
