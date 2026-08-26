// El piso táctil de móvil no se puede pisar desde una clase.
//
// globals.css declara:
//     @media (max-width: 768px) { button, a, input, select { min-height: 44px } }
// Son selectores de ELEMENTO: especificidad (0,0,1). Cualquier regla de CLASE
// —(0,1,0)— con un min-height menor le gana, y una media query no cambia eso:
// sólo decide si la regla aplica, no cuánto pesa.
//
// Ya pasó: `.sidebar-nav-item { min-height: 36px }` bajó los 66 enlaces del riel
// de 44px a 36px en teléfono, por debajo del estándar del propio proyecto
// (44 en móvil, 48 en POS). Se veía bien en escritorio y nadie lo notaba.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = readFileSync(join(__dirname, '../app/globals.css'), 'utf8')
const PISO_MOVIL = 44

/** Quita los bloques @media que sólo aplican en anchos de escritorio. */
function sinBloquesDeEscritorio(css: string): string {
  let out = ''
  let i = 0
  for (;;) {
    const a = css.indexOf('@media', i)
    if (a < 0) { out += css.slice(i); break }
    out += css.slice(i, a)
    const abre = css.indexOf('{', a)
    const consulta = css.slice(a, abre)
    // profundidad de llaves para saltarse el bloque completo
    let d = 0, j = abre
    for (; j < css.length; j++) {
      if (css[j] === '{') d++
      else if (css[j] === '}') { d--; if (d === 0) break }
    }
    const esSoloEscritorio = /min-width:\s*(\d+)/.test(consulta)
      && Number(/min-width:\s*(\d+)/.exec(consulta)![1]) > 768
    if (!esSoloEscritorio) out += css.slice(a, j + 1)
    i = j + 1
  }
  return out
}

describe('piso táctil en móvil', () => {
  it('la regla de 44px sigue existiendo', () => {
    expect(CSS).toMatch(/@media\s*\(max-width:\s*768px\)[^}]*min-height:\s*44px/)
  })

  it('ninguna clase baja de 44px fuera de un bloque de escritorio', () => {
    const aplicable = sinBloquesDeEscritorio(CSS)
    const culpables: string[] = []

    // reglas de clase con min-height explícito
    for (const m of aplicable.matchAll(/(\.[a-zA-Z][\w-]*(?:[^{}]*?))\{([^}]*min-height:\s*(\d+)px[^}]*)\}/g)) {
      const px = Number(m[3])
      const sel = m[1].trim().split('\n').pop() || ''
      // Los pseudo-elementos no son controles: la barra de scroll del POS
      // declara 40px para su pulgar y eso no tiene nada que ver con un dedo
      // sobre un botón.
      if (sel.includes('::')) continue
      if (px < PISO_MOVIL) culpables.push(`${sel} → ${px}px`)
    }

    expect(culpables, `clases que pisan el piso táctil: ${culpables.join(' · ')}`).toEqual([])
  })
})
