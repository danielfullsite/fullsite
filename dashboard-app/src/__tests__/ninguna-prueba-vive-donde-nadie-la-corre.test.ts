import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// DOS ARCHIVOS DE PRUEBA QUE NADIE CORRE, Y PARECEN COBERTURA.
//
// `dashboard-app/tests/` tiene `pos-e2e.spec.ts` (29 casos) y
// `p2-floor-plan-validation.spec.ts` (4 casos). Ninguno se ejecuta jamas:
//
//   - `vitest.config.ts` los EXCLUYE:  exclude: [..., 'tests/**', ...]
//   - los dos configs de Playwright apuntan a `testDir: './e2e'`
//
// Asi que existen, se ven como pruebas, salen en cualquier conteo de archivos, y no
// defienden nada. Es exactamente lo que el workflow `offline-e2e.yml` dice de si mismo
// en su primera linea: "LA PRUEBA YA EXISTIA. NADIE LA CORRIA."
//
// NO SE BORRARON. Son trabajo de alguien mas y borrar no es de esta sesion. Lo que si
// se hace es que el hueco DEJE DE SER INVISIBLE: esta prueba falla si aparece un
// `.spec.ts` en un sitio donde ningun runner mira.
//
// Y hay una razon extra para no cablearlos sin pensar: `tests/pos-e2e.spec.ts` apunta a
//
//     const BASE = 'https://app.fullsite.mx'
//     const PIN = process.env.POS_TEST_PIN || '9012'
//
// PRODUCCION, con un PIN por omision en el codigo. Correrlo escribe ordenes en el
// restaurante de verdad. Un `npx playwright test tests/` a ciegas cobra en AMALAY.

const APP = join(__dirname, '..', '..')          // dashboard-app/
const DIRS_CON_RUNNER = new Set(['e2e', 'src'])  // playwright -> e2e/ ; vitest -> src/

/**
 * Los dos huerfanos que ya existian el 2026-09-09, con lo que se decidio de cada uno.
 *
 * Se listan en vez de borrarlos: son trabajo de alguien mas y borrarlo no es de esta
 * sesion. Lo que NO puede pasar es que aparezca uno NUEVO sin que nadie lo note --
 * cualquier .spec fuera de esta lista pone la prueba en rojo.
 *
 * Que hacer con ellos, cuando Daniel decida:
 *
 *   pos-e2e.spec.ts .............. 29 casos contra PRODUCCION. Ya lleva una guarda que
 *                                  lo salta salvo `POS_E2E_PROD=1`, y se le quito el PIN
 *                                  por omision. Sirve como verificacion manual
 *                                  deliberada; NO se puede cablear a CI tal cual.
 *   p2-floor-plan-validation ..... 4 casos de captura de pantalla del plano, con las 33
 *                                  mesas de AMALAY quemadas. Es de una rama vieja (P2).
 *                                  O se generaliza por tenant, o se borra.
 */
const HUERFANOS_CONOCIDOS = new Set([
  'tests/pos-e2e.spec.ts',
  'tests/p2-floor-plan-validation.spec.ts',
])

function specs(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) specs(p, acc)
    else if (e.endsWith('.spec.ts') || e.endsWith('.spec.tsx')) acc.push(p)
  }
  return acc
}

describe('ningun .spec NUEVO vive fuera del alcance de un runner', () => {
  it('todos estan en e2e/ o en src/, salvo los dos huerfanos conocidos', () => {
    const huerfanos = specs(APP)
      .map(p => p.slice(APP.length + 1))
      .filter(rel => !DIRS_CON_RUNNER.has(rel.split('/')[0]))
      .filter(rel => !HUERFANOS_CONOCIDOS.has(rel))

    expect(
      huerfanos,
      'Estos .spec no los corre nadie (vitest excluye tests/, playwright apunta a e2e/).\n' +
      'O se mueven a e2e/, o se borran, o se les pone un runner:\n  ' +
      huerfanos.join('\n  '),
    ).toEqual([])
  })

  it('y los dos conocidos siguen ahi — si desaparecen, quitar la excepcion', () => {
    // Sin esto la lista se pudre: alguien borra un huerfano, la excepcion se queda, y
    // manana tapa a uno distinto con el mismo nombre.
    const existentes = specs(APP).map(p => p.slice(APP.length + 1))
    for (const conocido of HUERFANOS_CONOCIDOS) {
      expect(existentes, `${conocido} ya no existe: quita su entrada de HUERFANOS_CONOCIDOS`)
        .toContain(conocido)
    }
  })
})

describe('el huerfano que apunta a produccion esta desarmado', () => {
  const src = readFileSync(join(APP, 'tests', 'pos-e2e.spec.ts'), 'utf8')

  it('se salta salvo que se pida a proposito', () => {
    expect(src).toMatch(/test\.skip\(\s*\n?\s*process\.env\.POS_E2E_PROD !== '1'/)
  })

  it('y ya no trae un PIN por omision en el codigo', () => {
    // `process.env.POS_TEST_PIN || '9012'` era un PIN publicado en el repositorio.
    expect(src).not.toMatch(/POS_TEST_PIN \|\| '\d+'/)
    expect(src).toMatch(/POS_TEST_PIN \|\| ''/)
  })
})

describe('la configuracion sigue siendo la que se midio', () => {
  it('vitest excluye tests/', () => {
    const cfg = readFileSync(join(APP, 'vitest.config.ts'), 'utf8')
    expect(cfg).toMatch(/'tests\/\*\*'/)
  })

  it('los dos configs de Playwright apuntan a e2e/', () => {
    for (const f of ['playwright.config.ts', 'playwright.config.offline.ts']) {
      expect(readFileSync(join(APP, f), 'utf8')).toMatch(/testDir: '\.\/e2e'/)
    }
  })
})

describe('ninguna prueba automatizada apunta a produccion', () => {
  it('nada bajo e2e/ ni src/ escribe en app.fullsite.mx', () => {
    // Una prueba que corre en CI y pega a produccion cobra en el restaurante de verdad.
    // El unico archivo con esa URL es el huerfano de `tests/`, que justamente no corre.
    const vivos = [...specs(join(APP, 'e2e')), ...specs(join(APP, 'src'))]
    const culpables = vivos.filter(p =>
      /https:\/\/app\.fullsite\.mx/.test(readFileSync(p, 'utf8')))
    expect(culpables.map(p => p.slice(APP.length + 1))).toEqual([])
  })
})
