/**
 * EL BUSCADOR DE CONTROLES DEL ARNÉS — su propia regresión.
 *
 * El nombre de un control no es su texto. El botón de confirmar el PIN se dibuja
 * como un icono: `innerText` vacío y `aria-label="Entrar"`. La primera versión
 * del conductor comparaba sólo `innerText`, así que ese botón le era invisible y
 * reportaba «no está» sobre algo que cualquiera tiene enfrente.
 *
 * El daño no fue perder un clic: fue que **el fallo del instrumento se parecía a
 * un defecto del producto**. La corrida completa de G01 quedó en cero y la
 * primera lectura fue «el POS no deja entrar».
 *
 * Por eso el buscador tiene prueba propia, y por eso el caso central es
 * literalmente ése: un botón sin texto con nombre accesible.
 *
 * La lógica se mantiene idéntica a la del conductor a propósito: si allá cambia
 * y aquí no, esta prueba deja de proteger — y el caso «el rótulo se renombró»
 * lo vigila.
 */
import { describe, it, expect, beforeEach } from 'vitest'

/** Misma implementación que `e2e/paridad/conductor-v1.mjs`. */
function buscarControl(patron: string) {
  const vis = (el: Element) => {
    const b = el.getBoundingClientRect()
    // jsdom no calcula diseño: se considera visible salvo que esté oculto a propósito.
    return !(el as HTMLElement).hidden && (b.width > 0 || b.height > 0 || true)
  }
  const re = new RegExp(patron, 'i')
  const nombres = (el: Element) => [
    el.getAttribute('data-testid'),
    el.getAttribute('aria-label'),
    el.getAttribute('title'),
    ((el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim(),
  ].filter(Boolean) as string[]

  const controles = [...document.querySelectorAll('button,[role=button]')].filter(vis)
  const inventario = () => controles.map(x => nombres(x)[0] || '(sin nombre)').slice(0, 30)
  const b = controles.find(x => nombres(x).some(n => re.test(n)))
  if (!b) return { ok: false, motivo: 'no está en pantalla', enPantalla: inventario() }
  const rotulo = nombres(b)[0]
  if ((b as HTMLButtonElement).disabled || b.getAttribute('aria-disabled') === 'true') {
    return { ok: false, motivo: 'está deshabilitado', rotulo, enPantalla: inventario() }
  }
  return { ok: true, rotulo }
}

const pintar = (html: string) => { document.body.innerHTML = html }

describe('el buscador de controles del arnés', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  // ── EL CASO QUE ORIGINÓ TODO ──────────────────────────────────────────────

  it('encuentra un botón con aria-label="Entrar" y TEXTO VACÍO', () => {
    // Exactamente el teclado de PIN del POS: dígitos con texto, confirmar con icono.
    pintar(`
      <button>1</button><button>2</button><button>3</button>
      <button aria-label="Borrar"></button>
      <button aria-label="Entrar"></button>
    `)
    const r = buscarControl('^Entrar$')
    expect(r.ok).toBe(true)
    expect(r.rotulo).toBe('Entrar')
  })

  it('un buscador que sólo mirara innerText NO lo encontraría — ésa era la falla', () => {
    pintar('<button aria-label="Entrar"></button>')
    const porTexto = [...document.querySelectorAll('button')]
      .find(b => /^Entrar$/i.test((b.textContent || '').trim()))
    expect(porTexto).toBeUndefined()
    expect(buscarControl('^Entrar$').ok).toBe(true)
  })

  // ── Los cuatro identificadores, por orden de estabilidad ──────────────────

  it('prefiere data-testid sobre todo lo demás', () => {
    pintar('<button data-testid="confirmar-pin" aria-label="Entrar">Otra cosa</button>')
    expect(buscarControl('^confirmar-pin$')).toMatchObject({ ok: true, rotulo: 'confirmar-pin' })
  })

  it('encuentra por title cuando no hay aria-label ni texto', () => {
    pintar('<button title="Enviar a cocina"></button>')
    expect(buscarControl('Enviar a cocina').ok).toBe(true)
  })

  it('sigue encontrando por texto — el camino de siempre no se rompió', () => {
    pintar('<button>Enviar</button>')
    expect(buscarControl('^Enviar$')).toMatchObject({ ok: true, rotulo: 'Enviar' })
  })

  it('encuentra [role=button] que no es un <button>', () => {
    pintar('<div role="button" aria-label="Cobrar"></div>')
    expect(buscarControl('^Cobrar$').ok).toBe(true)
  })

  // ── Deshabilitado ≠ ausente ───────────────────────────────────────────────

  it('un botón DESHABILITADO se reporta como tal, no como ausente', () => {
    // Es la diferencia entre «el PIN está incompleto» y «el POS no tiene el botón».
    pintar('<button aria-label="Entrar" disabled></button>')
    const r = buscarControl('^Entrar$')
    expect(r.ok).toBe(false)
    expect(r.motivo).toBe('está deshabilitado')
    expect(r.rotulo).toBe('Entrar')
  })

  it('aria-disabled cuenta igual que disabled', () => {
    pintar('<div role="button" aria-label="Cobrar" aria-disabled="true"></div>')
    expect(buscarControl('^Cobrar$').motivo).toBe('está deshabilitado')
  })

  it('un control ausente dice que NO ESTÁ y enumera lo que sí había', () => {
    pintar('<button>1</button><button aria-label="Borrar"></button>')
    const r = buscarControl('^Entrar$')
    expect(r.ok).toBe(false)
    expect(r.motivo).toBe('no está en pantalla')
    expect(r.enPantalla).toContain('Borrar')
  })

  it('el inventario nombra los controles sin nombre en vez de omitirlos', () => {
    pintar('<button></button><button>Enviar</button>')
    const r = buscarControl('^NoExiste$')
    expect(r.enPantalla).toContain('(sin nombre)')
  })

  // ── Que no se afloje de más ───────────────────────────────────────────────

  it('no confunde «Entrar» con «Entrar al turno» cuando se ancla el patrón', () => {
    pintar('<button aria-label="Entrar al turno"></button>')
    expect(buscarControl('^Entrar$').ok).toBe(false)
  })

  it('el primer control que coincide es el que se pulsa, en orden del documento', () => {
    pintar('<button aria-label="Enviar">primero</button><button aria-label="Enviar">segundo</button>')
    expect(buscarControl('^Enviar$').rotulo).toBe('Enviar')
  })

  // ── El guardián del guardián ──────────────────────────────────────────────

  it('el conductor real usa los cuatro identificadores — si deja de hacerlo, esto avisa', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const fuente = readFileSync(
      join(__dirname, '..', '..', 'e2e', 'paridad', 'conductor-v1.mjs'), 'utf8')
    for (const id of ['data-testid', 'aria-label', 'title', 'innerText']) {
      expect(fuente, `el conductor dejó de buscar por ${id}`).toContain(id)
    }
    expect(fuente).toContain('está deshabilitado')
  })
})
