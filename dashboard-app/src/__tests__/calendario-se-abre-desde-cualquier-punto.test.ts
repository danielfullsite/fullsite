import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Reportado desde el producto: «el calendario tiene un spot en donde no se le
// puede picar bien».
//
// La causa: los tres selectores de fecha eran un `<input type="date">` invisible
// estirado sobre un icono decorativo. En un campo de fecha nativo, el clic sólo
// abre el calendario si cae sobre el iconito interno del navegador —unos 16 px
// pegados al borde derecho—; el resto del área enfoca los segmentos de día, mes
// y año. Estirado a una casilla de 36 px, quedaba una franja estrecha, distinta
// en cada navegador, donde el clic funcionaba. Fuera de ella no pasaba nada.
//
// Estas comprobaciones son sobre el código fuente a propósito: el defecto vive
// en la forma del markup, y el carril de pruebas de este proyecto corre en Node
// sin DOM, así que no hay forma de hacer clic de verdad aquí. Lo que sí puede
// hacerse, y es lo que importa, es impedir que el patrón regrese.

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')

/**
 * El código sin sus comentarios.
 *
 * Sin esto, una comprobación de forma se dispara con el texto que EXPLICA el
 * defecto. Pasó aquí: el componente comenta que «un campo con display:none no
 * puede abrir su calendario», y la prueba lo leyó como si el código lo hiciera.
 * Una prueba que castiga documentar el porqué es peor que no tenerla.
 */
const soloCodigo = (fuente: string) =>
  fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('el calendario se abre desde cualquier punto del botón', () => {
  it('ningún campo de fecha se estira invisible sobre un icono', () => {
    const panel = soloCodigo(leer('app/page.tsx'))
    // El patrón exacto que causaba el punto muerto.
    expect(panel).not.toMatch(/type="date"[\s\S]{0,200}?absolute inset-0[\s\S]{0,80}?opacity-0/)
    expect(panel).not.toMatch(/absolute inset-0 w-full h-full opacity-0 cursor-pointer/)
  })

  it('el botón del calendario es un botón, no un div decorativo', () => {
    const comp = soloCodigo(leer('components/ui/BotonCalendario.tsx'))
    expect(comp).toMatch(/<button\b/)
    expect(comp).toMatch(/type="button"/)
    // Un div con pointer-events-none debajo de un campo invisible era justamente
    // la forma anterior.
    expect(comp).not.toMatch(/pointer-events-none[\s\S]{0,120}?<input/)
  })

  it('pide el calendario con la API estándar y no se queda sin salida si falla', () => {
    const comp = leer('components/ui/BotonCalendario.tsx')
    expect(comp).toMatch(/showPicker\(\)/)
    // Respaldo: algunos navegadores exigen gesto del usuario y Safari tardó en
    // traerlo. Sin esto, en esos casos el botón no haría absolutamente nada.
    expect(comp).toMatch(/catch/)
    expect(comp).toMatch(/\.focus\(\)/)
  })

  it('el respaldo MUESTRA el campo antes de enfocarlo', () => {
    // La primera versión enfocaba el campo escondido, que reproducía el bug
    // original en la rama menos transitada: el foco se iba a algo invisible y
    // marcado como oculto para lectores de pantalla, sin contorno visible.
    const comp = soloCodigo(leer('components/ui/BotonCalendario.tsx'))
    const iFoco = comp.indexOf('.focus()')
    const iMostrar = comp.indexOf('setConRespaldo(true)')
    expect(iMostrar).toBeGreaterThan(-1)
    expect(iFoco).toBeGreaterThan(iMostrar)   // primero se muestra, luego se enfoca
    // Y con el respaldo encendido el campo deja de estar oculto y gana nombre.
    expect(comp).toMatch(/conRespaldo[\s\S]{0,120}?'aria-label': etiqueta/)
    expect(comp).toMatch(/tabIndex: -1, 'aria-hidden': true/)
  })

  it('el campo sigue en el documento: uno oculto no puede abrir su calendario', () => {
    const comp = soloCodigo(leer('components/ui/BotonCalendario.tsx'))
    expect(comp).not.toMatch(/display:\s*none/)
    // `aria-hidden` sí va, y es correcto: el campo no aporta nada a un lector de
    // pantalla, el nombre lo lleva el botón. Lo que no puede estar es sacarlo
    // del renderizado, porque entonces no tendría calendario que abrir.
    expect(comp).not.toMatch(/className="[^"]*\bhidden\b/)
    expect(leer('components/ui/BotonCalendario.tsx')).toMatch(/aria-hidden/)
  })

  it('los tres periodos usan el mismo botón y cada uno se anuncia', () => {
    const panel = leer('app/page.tsx')
    const usos = panel.match(/<BotonCalendario\b/g) ?? []
    expect(usos.length).toBe(3)   // día, semana y mes
    for (const q of ['Elegir día en el calendario', 'Elegir semana en el calendario', 'Elegir mes en el calendario']) {
      expect(panel).toContain(q)
    }
  })
})
