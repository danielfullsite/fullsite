// El logo tiene que contrastar con la superficie que tiene debajo.
//
// Las clases `sidebar-logo-*` NO significan "logo claro / logo oscuro":
// significan "qué logo va DENTRO DEL RIEL", y el riel es oscuro incluso en tema
// claro. Al reusarlas en la notificación flotante, la f salió BLANCA sobre el
// fondo claro del aviso y quedó invisible.
//
// Peor: la excepción del riel estaba escrita como
//     [data-theme="light"] [data-ds="v3"] .sidebar-logo-white { display: block }
// sin acotar al riel. Mientras el rediseño era un piloto de un tenant eso casi
// no se notaba; cuando dejó de ser piloto, `[data-ds="v3"]` pasó a cubrir TODA
// la app y la excepción alcanzó a cualquier logo.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = join(__dirname, '..')
const CSS = readFileSync(join(RAIZ, 'app/globals.css'), 'utf8')

function tsx(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next') continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) tsx(p, acc)
    else if (p.endsWith('.tsx')) acc.push(p)
  }
  return acc
}

describe('contraste del logo', () => {
  it('la excepción del riel está acotada al riel', () => {
    // Cualquier regla que fuerce el logo blanco en tema claro tiene que pasar
    // por .sidebar-rail; si no, alcanza a toda la app.
    const sueltas = CSS.split('\n').filter(l =>
      l.includes('[data-theme="light"]') &&
      l.includes('sidebar-logo-white') &&
      l.includes('display: block') &&
      !l.includes('.sidebar-rail')
    )
    expect(sueltas, `reglas sin acotar: ${sueltas.join(' | ')}`).toEqual([])
  })

  it('existen las clases por superficie, y son simétricas', () => {
    expect(CSS).toMatch(/\.logo-sobre-oscuro\s*\{\s*display:\s*block/)
    expect(CSS).toMatch(/\.logo-sobre-claro\s*\{\s*display:\s*none/)
    expect(CSS).toMatch(/\[data-theme="light"\]\s*\.logo-sobre-oscuro\s*\{\s*display:\s*none/)
    expect(CSS).toMatch(/\[data-theme="light"\]\s*\.logo-sobre-claro\s*\{\s*display:\s*block/)
  })

  it('fuera del sidebar nadie usa las clases del riel', () => {
    const culpables: string[] = []
    for (const f of tsx(RAIZ)) {
      const rel = f.slice(RAIZ.length + 1)
      // El riel y el layout del demo son los dueños legítimos de esas clases.
      if (rel.includes('Sidebar.tsx') || rel.includes('demo/layout.tsx')) continue
      if (/className="[^"]*sidebar-logo-/.test(readFileSync(f, 'utf8'))) culpables.push(rel)
    }
    expect(culpables, `usan clases del riel fuera del riel: ${culpables.join(', ')}`).toEqual([])
  })
})
