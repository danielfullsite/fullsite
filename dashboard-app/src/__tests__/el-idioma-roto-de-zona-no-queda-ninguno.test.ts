import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// BARRIDO COMPLETO DEL IDIOMA ROTO, EN TODO EL PRODUCTO.
//
//     new Date(x.toLocaleString('en-US', { timeZone: TZ }))
//
// Toma los numeros de PARED de TZ y los reinterpreta como hora local del PROCESO. Sus
// getters locales dan el calendario correcto; su INSTANTE (`getTime`, `toISOString`)
// esta corrido por la diferencia entre las dos zonas.
//
// Eso lo vuelve una trampa: funciona hasta que alguien le agrega un `.toISOString()`.
// Paso tres veces en este repo, y las tres se encontraron hoy:
//
//   1. `pos/corte` — le quitaba LA COMIDA al corte del dia.
//   2. `MeseroLeaderboard` — el ranking arrancaba a las 18:00 de ayer.
//   3. `PredictionWidget` — la proyeccion se iba EN BLANCO cada noche, porque comparaba
//      la fecha del dato contra un "hoy" que a la hora de la cena ya era manana.
//   4. `pos-combos` — la vigencia de una promocion se decidia con esa fecha corrida: un
//      2x1 que termina hoy se apagaba horas antes.
//
// Esta prueba fija el resultado del barrido: donde el idioma sobrevive es porque SOLO
// se leen componentes locales, y ninguno de esos sitios lo combina con `toISOString`.

const RAIZ = join(__dirname, '..')
const EXENTOS = new Set(['date-mx.ts'])   // ahi vive `nowMX`, con su advertencia

function fuentes(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) {
      if (e === '__tests__' || e === 'node_modules') continue
      fuentes(p, acc)
    } else if ((e.endsWith('.ts') || e.endsWith('.tsx')) && !EXENTOS.has(e)) {
      acc.push(p)
    }
  }
  return acc
}

const ARCHIVOS = fuentes(RAIZ)
const sinComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('el idioma reinterpretado nunca se combina con toISOString', () => {
  it('ningun archivo del producto lo hace', () => {
    // Esta es LA combinacion que rompe: reinterpretar y despues pedir el instante.
    const culpables: string[] = []
    for (const archivo of ARCHIVOS) {
      const codigo = sinComentarios(readFileSync(archivo, 'utf8'))
      // `const X = new Date(...toLocaleString...)` seguido de `X.toISOString()`
      const asignaciones = [...codigo.matchAll(
        /(?:const|let)\s+(\w+)\s*=\s*new Date\([^\n]*toLocaleString\('en-US'/g)]
      for (const [, nombre] of asignaciones) {
        if (new RegExp(`\\b${nombre}\\.toISOString\\(`).test(codigo)) {
          culpables.push(`${archivo.replace(RAIZ, 'src')} → ${nombre}.toISOString()`)
        }
      }
      // Y la version en una sola linea.
      if (/new Date\([^\n]*toLocaleString\('en-US'[^\n]*\)\)\.toISOString\(/.test(codigo)) {
        culpables.push(`${archivo.replace(RAIZ, 'src')} → en una linea`)
      }
    }
    expect(culpables, `usar todayMX() o fmtDateEnZona() en:\n${culpables.join('\n')}`).toEqual([])
  })
})

describe('la zona no se clava en el codigo', () => {
  it("ningun archivo del producto pasa 'America/Monterrey' a toLocaleString ni a Intl", () => {
    // La zona sale del tenant: `getActiveTimezone()` en el cliente, `clients.timezone`
    // en el servidor. Clavarla rompe a cualquier restaurante fuera del centro de Mexico.
    //
    // El alta de un tenant SI puede traerla como valor por omision del formulario --
    // ahi es un dato inicial, no una decision de codigo.
    const culpables: string[] = []
    for (const archivo of ARCHIVOS) {
      if (archivo.endsWith(join('app', 'onboarding', 'page.tsx'))) continue
      const codigo = sinComentarios(readFileSync(archivo, 'utf8'))
      if (/timeZone:\s*'America\/Monterrey'/.test(codigo)) {
        culpables.push(archivo.replace(RAIZ, 'src'))
      }
    }
    expect(culpables, `la zona debe salir del tenant en:\n${culpables.join('\n')}`).toEqual([])
  })
})

describe('los cuatro sitios que estaban rotos', () => {
  const leer = (...p: string[]) => sinComentarios(readFileSync(join(RAIZ, ...p), 'utf8'))

  it('PredictionWidget compara contra todayMX, no contra un instante corrido', () => {
    const src = leer('components', 'PredictionWidget.tsx')
    expect(src).toMatch(/const todayStr = todayMX\(\)/)
    expect(src).not.toMatch(/mxNow\.toISOString/)
  })

  it('pos-combos decide la vigencia con la fecha formateada en la zona', () => {
    const src = leer('lib', 'pos-combos.ts')
    expect(src).toMatch(/const today = fmtDateEnZona\(new Date\(\), zona\)/)
    expect(src).not.toMatch(/mx\.toISOString/)
  })

  it('y sigue leyendo dia y hora de los componentes locales, que ahi es correcto', () => {
    const src = leer('lib', 'pos-combos.ts')
    expect(src).toMatch(/const day = mx\.getDay\(\)/)
    expect(src).toMatch(/mx\.getHours\(\)/)
  })

  it('ventas calcula sus presets por calendario', () => {
    const src = leer('app', 'ventas', 'page.tsx')
    expect(src).toMatch(/const hoy = todayMX\(\)/)
    expect(src).toMatch(/sumarDias\(hoy, -1, zona\)/)
    expect(src).toMatch(/sumarDias\(hoy, -diasAtras, zona\)/)
  })

  it('contabilidad usa la funcion canonica en vez de dos copias del idioma', () => {
    const src = leer('app', 'contabilidad', 'page.tsx')
    expect(src).toMatch(/function fmtMXDate\(\): string \{\s*return todayMX\(\)\s*\}/)
    expect(src).toMatch(/return todayMX\(\)\.slice\(0, 7\)/)
  })
})

describe('los agentes toman la zona del tenant', () => {
  it.each(['operations', 'finance', 'staff', 'fraud'])('agents/%s.ts', (nombre) => {
    const src = sinComentarios(
      readFileSync(join(RAIZ, 'lib', 'agents', `${nombre}.ts`), 'utf8'))
    expect(src).toMatch(/getActiveTimezone\(\)/)
    expect(src).not.toMatch(/timeZone: 'America\/Monterrey'/)
  })
})
