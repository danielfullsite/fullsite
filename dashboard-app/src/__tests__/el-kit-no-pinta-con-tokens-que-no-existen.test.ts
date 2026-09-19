// EL GUARDIÁN QUE LA FASE 1 DEBÍA TRAER Y NO TRAJO.
//
// El plan de pruebas del discovery pedía, para la fase 1, un "guardián contra
// deriva de color: que los valores de globals.css sean los que consume PosKit".
// Las 61 pruebas de las fases 1-2 no lo cubrían: todas miran TEXTO, y jsdom no
// computa CSS. Un `var(--no-existe)` pasa las 61 en verde y en la caja se ve
// un fondo transparente.
//
// No es hipotético. Al buscarlo aparecieron SEIS variables que el POS ya
// consume hoy sin que existan (ver HUERFANAS_CONOCIDAS abajo). Ninguna está en
// la superficie de las fases 1-2, así que arreglarlas es otro PR — pero el
// conteo queda trabado aquí para que no crezca.
//
// Por qué duele y no se ve: una `var()` indefinida NO es un error. La
// declaración entera se descarta y la propiedad queda sin poner. Un color
// hereda —feo pero legible— y un `background` queda transparente. Y si va
// dentro de `color-mix()`, la función completa se invalida. Nadie ve un error
// en consola; sólo una pantalla que se ve mal en la caja, un jueves.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

/** Todos los .tsx bajo `dir` (recursivo), menos las pruebas. */
function tsxBajo(dir: string): string[] {
  return readdirSync(resolve(process.cwd(), dir), { recursive: true, encoding: 'utf8' })
    .filter(f => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
    .map(f => `${dir}/${f}`)
}

const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8')

/** Variables declaradas dentro del `:root {}` por defecto (tema oscuro). */
function tokensDeRoot(): Set<string> {
  // El primer `:root {` y hasta su `}` a inicio de línea. Los `:root[data-theme…]`
  // se quedan fuera A PROPÓSITO: si una variable SÓLO vive en el tema claro,
  // el oscuro —que es el que corre en la caja— se queda sin ella.
  const m = /^:root\s*\{([\s\S]*?)^\}/m.exec(css)
  if (!m) throw new Error('No se encontró el bloque :root en globals.css')
  return new Set([...m[1].matchAll(/(--[a-z0-9-]+)\s*:/g)].map(x => x[1]))
}

/** Todas las variables declaradas en cualquier scope del archivo. */
function tokensDeclarados(): Set<string> {
  return new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(x => x[1]))
}

/** `var(--x)` sin respaldo. Con respaldo (`var(--x, #fff)`) no es un hueco. */
function consumosSinRespaldo(archivo: string): string[] {
  const src = readFileSync(resolve(process.cwd(), archivo), 'utf8')
  return [...src.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/g)].map(x => x[1])
}

/**
 * La superficie que las fases 1 y 2 sí poseen. Se declara a mano, no se
 * descubre sola: cuando la fase 3 migre una pantalla, agregarla aquí es parte
 * de migrarla — y si a alguien se le olvida, la pantalla nueva queda sin
 * guardián y eso se nota al leer este arreglo.
 */
const SUPERFICIE_FASES_1_2 = [
  'src/components/pos/ui/PosKit.tsx',
  'src/app/pos/ui-kit/page.tsx',
  'src/app/pos/auditoria/page.tsx',
  'src/app/pos/historial/page.tsx',
]

describe('el kit no pinta con tokens que no existen', () => {
  it.each(SUPERFICIE_FASES_1_2)('%s sólo consume variables declaradas en :root', (archivo) => {
    const root = tokensDeRoot()
    const huecos = [...new Set(consumosSinRespaldo(archivo))].filter(v => !root.has(v))
    expect(huecos, `variables sin declarar en :root: ${huecos.join(', ')}`).toEqual([])
  })

  it('consume algo — si el regex dejara de encontrar nada, la prueba pasaría en falso', () => {
    const total = SUPERFICIE_FASES_1_2.flatMap(consumosSinRespaldo)
    expect(total.length).toBeGreaterThan(15)
  })
})

describe('los tres tokens reconciliados con el artifact aprobado', () => {
  // Si alguien los regresa a los valores viejos, esto truena y dice cuál.
  it.each([
    ['--bg', '#080b0c', '#07090a'],
    ['--text-2', '#a8b5b1', '#b4bfbb'],
    ['--accent-line', 'rgba(16, 185, 129, 0.28)', 'rgba(16, 185, 129, 0.26)'],
  ])('%s vale %s (antes %s)', (token, esperado) => {
    const m = new RegExp(`^\\s*${token}\\s*:\\s*([^;]+);`, 'm').exec(
      /^:root\s*\{([\s\S]*?)^\}/m.exec(css)![1],
    )
    expect(m?.[1].trim()).toBe(esperado)
  })
})

/**
 * HUECOS QUE YA EXISTÍAN. No los introdujeron las fases 1-2 y arreglarlos es un
 * cambio visual en pantallas que nadie autorizó tocar todavía. Lo que sí se
 * hace aquí es TRABAR EL CONTEO: si aparece uno nuevo, truena; si alguien
 * arregla uno, también truena y hay que borrarlo de esta lista. Una deuda que
 * no puede crecer en silencio.
 *
 *   --bg-0      TurnoGate.tsx:300 — fondo de un overlay a pantalla completa;
 *               sin él, el gate del turno se pinta transparente.
 *   --st-cocina  configuracion/page.tsx:31-35 — colores por estación. Van
 *   --st-barra   dentro de `color-mix()`, así que la función entera se
 *   --st-caja    invalida y los chips pierden el color que los distingue.
 *   --st-pan
 *   --text      CobroDeCaja.tsx:94,105 — color de texto del modal de cobro;
 *               hereda en vez de usar --text-1.
 */
const HUERFANAS_CONOCIDAS = ['--bg-0', '--st-barra', '--st-caja', '--st-cocina', '--st-pan', '--text']

describe('la deuda de tokens del POS no crece', () => {
  it('en todo src/app/pos y src/components/pos no hay huérfanas nuevas', () => {
    const archivos = [...tsxBajo('src/app/pos'), ...tsxBajo('src/components/pos')]
    // Si el barrido dejara de encontrar archivos, la lista saldría vacía y la
    // prueba pasaría en falso. Aquí hay ~50; el piso evita esa trampa.
    expect(archivos.length).toBeGreaterThan(30)

    const declarados = tokensDeclarados()
    const huerfanas = [...new Set(archivos.flatMap(consumosSinRespaldo))]
      .filter(v => !declarados.has(v))
      .sort()

    expect(
      huerfanas,
      'Cambió la lista de variables CSS huérfanas del POS.\n' +
      'Si AGREGASTE una: decláralas en globals.css o ponles respaldo — var(--x, #fff).\n' +
      'Si ARREGLASTE una: bórrala de HUERFANAS_CONOCIDAS en esta prueba.',
    ).toEqual(HUERFANAS_CONOCIDAS)
  })
})
