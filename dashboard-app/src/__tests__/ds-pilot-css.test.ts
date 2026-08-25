// El CSS no tiene compilador.
//
// Al implementar el piloto visual escribí tres reglas que enganchaban clases
// inexistentes: `.dash-card` y `.premium-card` (definidas en globals.css pero
// usadas por cero componentes) y `.kpi-accent-blue` y familia, que ni siquiera
// son clases — son llaves del mapa `iconStyles` dentro de KPICard.tsx.
//
// Las tres pasaron `tsc --noEmit`, ESLint y las 2,174 pruebas sin pintar un
// solo pixel. Un CSS muerto no falla: simplemente no hace nada, y el rediseño
// se declara aplicado cuando en pantalla no cambió nada.
//
// Esta prueba cierra ese hueco: toda clase que aparezca en un selector del
// piloto tiene que existir en algún componente.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = join(__dirname, '..')
const CSS = readFileSync(join(RAIZ, 'app/globals.css'), 'utf8')

function fuentes(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next') continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) fuentes(p, acc)
    else if (p.endsWith('.tsx')) acc.push(p)
  }
  return acc
}

const MARKUP = fuentes(RAIZ).map(f => readFileSync(f, 'utf8')).join('\n')

/** Clases mencionadas en cualquier selector que cuelgue de [data-ds="v3"]. */
function clasesDelPiloto(): string[] {
  const out = new Set<string>()
  for (const linea of CSS.split('\n')) {
    if (!linea.includes('[data-ds="v3"]')) continue
    // Sólo la parte del selector: un comentario que mencione `.foo` no cuenta.
    if (linea.trimStart().startsWith('*') || linea.includes('/*')) continue
    // `\.` escapado en Tailwind arbitrario: .rounded-\[14px\]
    for (const m of linea.matchAll(/\.((?:[A-Za-z0-9_-]|\\.)+)/g)) {
      out.add(m[1].replace(/\\(.)/g, '$1'))
    }
  }
  return [...out]
}

describe('CSS del piloto DS v3', () => {
  it('encuentra las clases del piloto (si no, la prueba no está probando nada)', () => {
    expect(clasesDelPiloto().length).toBeGreaterThan(5)
  })

  it('toda clase del piloto existe en algún componente', () => {
    const muertas = clasesDelPiloto().filter(c => !MARKUP.includes(c))
    expect(muertas, `clases sin uso en el markup: ${muertas.join(', ')}`).toEqual([])
  })

  it('--font-display se define y se consume', () => {
    expect(CSS).toContain('--font-display:')
    expect(CSS).toContain('var(--font-display)')
  })

  it('los modales conservan su sombra: sólo se apagan las de tarjeta', () => {
    // --shadow-deep/--shadow-hero separan el diálogo del fondo. Apagarlos
    // dejaría el modal flotando sin apoyo visual.
    const bloque = CSS.slice(CSS.indexOf('[data-ds="v3"] {'))
    expect(bloque).not.toMatch(/--shadow-(deep|hero)\s*:\s*none/)
  })

  it('ningún comentario del CSS se cierra a sí mismo', () => {
    // `src/**/*.tsx` dentro de un comentario lo TERMINA en el `*/` de `**/`,
    // y todo lo que sigue queda como contenido suelto. Ya pasó una vez.
    let i = 0
    let n = 0
    for (;;) {
      const a = CSS.indexOf('/*', i)
      if (a < 0) break
      const b = CSS.indexOf('*/', a + 2)
      expect(b, 'comentario sin cerrar en globals.css').toBeGreaterThan(-1)
      n++
      i = b + 2
    }
    expect(n).toBeGreaterThan(10)
  })
})
