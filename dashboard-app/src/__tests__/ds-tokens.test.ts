// Las fuentes que se descargan tienen que ser las que se usan.
//
// Historia: `layout.tsx` declaraba Inter con `variable: '--font-inter'`, y
// `globals.css` definía `--font-sans: Arial, Helvetica, …`. Nadie referenciaba
// `--font-inter` en ningún lado. Resultado: la app pagaba la descarga de una
// webfont completa (6 pesos) y renderizaba con la tipografía por defecto del
// sistema. Estuvo así el tiempo suficiente para que nadie lo notara.
//
// No es un test de estilo: es un test de que el cableado existe. Comprueba que
// toda variable de fuente declarada en layout.tsx se consume en globals.css, sin
// importar qué tipografía se elija mañana.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const layout = readFileSync(join(ROOT, 'app', 'layout.tsx'), 'utf8')
const css = readFileSync(join(ROOT, 'app', 'globals.css'), 'utf8')

/** Variables CSS declaradas por next/font, p.ej. variable: '--font-public-sans' */
function fontVarsDeclaradas(src: string): string[] {
  return [...src.matchAll(/variable:\s*'(--font-[a-z0-9-]+)'/g)].map(m => m[1])
}

describe('tokens del sistema de diseño — cableado de tipografía', () => {
  it('layout.tsx declara al menos una variable de fuente', () => {
    expect(fontVarsDeclaradas(layout).length).toBeGreaterThan(0)
  })

  it('CADA variable de fuente declarada se consume en globals.css', () => {
    const huerfanas = fontVarsDeclaradas(layout).filter(v => !css.includes(`var(${v})`))
    expect(
      huerfanas,
      `Se descargan estas fuentes y no se usan: ${huerfanas.join(', ')}. ` +
        'Apúntalas desde --font-sans / --font-mono en globals.css, o quítalas de layout.tsx.',
    ).toEqual([])
  })

  it('cada variable declarada llega al <html> vía className', () => {
    for (const v of fontVarsDeclaradas(layout)) {
      // el objeto de next/font se llama X y se usa como `${X.variable}`
      expect(layout).toMatch(/className=\{`\$\{[a-zA-Z]+\.variable\}/)
      expect(v).toMatch(/^--font-/)
    }
  })

  it('--font-sans arranca con una webfont, no con una fuente de sistema', () => {
    const m = css.match(/--font-sans:\s*([^;]+);/)
    expect(m, 'no se encontró --font-sans en globals.css').toBeTruthy()
    expect(
      m![1].trim(),
      'La primera familia de --font-sans debe ser la variable de next/font. ' +
        'Si arranca con Arial/Helvetica/system-ui, la webfont se descarga y no se usa.',
    ).toMatch(/^var\(--font-/)
  })

  it('--font-mono arranca con una webfont', () => {
    const m = css.match(/--font-mono:\s*([^;]+);/)
    expect(m).toBeTruthy()
    expect(m![1].trim()).toMatch(/^var\(--font-/)
  })
})

describe('tokens del sistema de diseño — invariantes visuales', () => {
  it('los dos temas definen el mismo juego de tokens', () => {
    const bloque = (sel: string) => {
      const i = css.indexOf(sel)
      if (i < 0) return []
      const fin = css.indexOf('\n}', i)
      return [...css.slice(i, fin).matchAll(/^\s*(--[a-z0-9-]+):/gm)].map(m => m[1])
    }
    const oscuro = new Set(bloque(':root {'))
    const claro = new Set(bloque('[data-theme="light"] {'))
    // El claro puede omitir alias derivados, pero no los tokens de superficie y texto.
    const esenciales = ['--bg', '--surface', '--panel', '--line', '--text-1', '--text-2', '--text-3', '--accent']
    for (const t of esenciales) {
      expect(oscuro.has(t), `${t} falta en :root`).toBe(true)
      expect(claro.has(t), `${t} falta en [data-theme="light"]`).toBe(true)
    }
  })

  it('ningún color se define SÓLO dentro de [data-theme="light"]', () => {
    // Si un token existe en claro y no en oscuro, el tema por defecto lo renderiza
    // sin valor: texto invisible o fondo transparente.
    const bloque = (sel: string) => {
      const i = css.indexOf(sel)
      const fin = css.indexOf('\n}', i)
      return new Set([...css.slice(i, fin).matchAll(/^\s*(--[a-z0-9-]+):/gm)].map(m => m[1]))
    }
    const oscuro = bloque(':root {')
    const claro = bloque('[data-theme="light"] {')
    const soloEnClaro = [...claro].filter(t => !oscuro.has(t))
    expect(soloEnClaro, `Definidos sólo en tema claro: ${soloEnClaro.join(', ')}`).toEqual([])
  })
})
