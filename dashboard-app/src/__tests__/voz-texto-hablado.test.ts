// Lo que la voz del navegador lee en voz alta: sin markdown, sin links, sin emojis,
// con los montos dichos en español, y en trozos cortos (Chrome corta a los ~15 s).
import { describe, it, expect } from 'vitest'
import { montoEnPalabras, numeroEnPalabras, partirParaHablar, textoParaHablar } from '@/lib/voz/texto-hablado'

describe('textoParaHablar — limpieza', () => {
  it('quita negritas, títulos, viñetas y links (los "Ver …" completos)', () => {
    const md = '## Resumen\n**Hoy** llevas buen ritmo.\n- Primero\n- Segundo\n[Ver ventas →](/ventas)'
    const t = textoParaHablar(md)
    expect(t).not.toMatch(/[*#\[\]()→]/)
    expect(t).not.toMatch(/Ver ventas|\/ventas/)
    expect(t).toContain('Hoy llevas buen ritmo.')
    expect(t).toContain('Primero. Segundo.')
  })

  it('quita bloques de gráfica y emojis', () => {
    const t = textoParaHablar('Vas arriba 🚀📈.\n<!--chart\n{"type":"bar","data":[]}\nchart-->')
    expect(t).toBe('Vas arriba.')
  })

  it('link con otra etiqueta: se queda la etiqueta, no la URL', () => {
    expect(textoParaHablar('Revisa [el inventario](/inventario) y https://x.com/a')).toBe('Revisa el inventario y.')
  })

  it('tablas: sin separadores, celdas leídas como lista', () => {
    const t = textoParaHablar('| Mesero | Venta |\n|---|---|\n| Omar | 12 |')
    expect(t).not.toContain('|')
    expect(t).not.toContain('---')
    expect(t).toContain('Omar, 12') // enteros sueltos: la voz del navegador ya los dice bien
  })

  it('vacío → vacío', () => {
    expect(textoParaHablar('')).toBe('')
  })
})

describe('números dichos en español de México', () => {
  it('montos con separador de miles y centavos', () => {
    expect(textoParaHablar('Llevas $12,533 hoy')).toBe('Llevas doce mil quinientos treinta y tres pesos hoy.')
    expect(textoParaHablar('Ticket de $1,200.50')).toContain('mil doscientos pesos con cincuenta centavos')
    expect(textoParaHablar('Meta $21k')).toContain('veintiún mil pesos')
  })

  it('porcentajes y fechas ISO', () => {
    expect(textoParaHablar('Subiste 12.5% vs ayer')).toContain('doce punto cinco por ciento')
    expect(textoParaHablar('El 2026-09-28 vendiste más', { anioActual: 2026 })).toContain('28 de septiembre')
    expect(textoParaHablar('El 2025-01-01', { anioActual: 2026 })).toContain('primero de enero de 2025')
  })

  it('numeroEnPalabras / montoEnPalabras', () => {
    expect(numeroEnPalabras(0)).toBe('cero')
    expect(numeroEnPalabras(100)).toBe('cien')
    expect(numeroEnPalabras(1_000_000)).toBe('un millón')
    expect(numeroEnPalabras(2_501_021)).toBe('dos millones quinientos un mil veintiuno')
    expect(montoEnPalabras(1)).toBe('un peso')
    expect(montoEnPalabras(21)).toBe('veintiún pesos')
    expect(montoEnPalabras(3_000_000)).toBe('tres millones de pesos')
    expect(montoEnPalabras(-300)).toBe('menos trescientos pesos')
  })
})

describe('partirParaHablar', () => {
  it('oraciones cortas se juntan hasta el tope', () => {
    expect(partirParaHablar('Hola. ¿Cómo vas? Bien.', 200)).toEqual(['Hola. ¿Cómo vas? Bien.'])
    expect(partirParaHablar('Uno dos tres. Cuatro cinco seis.', 20)).toEqual(['Uno dos tres.', 'Cuatro cinco seis.'])
  })

  it('ningún trozo pasa del tope, y no se pierde ninguna palabra', () => {
    const largo = Array.from({ length: 12 }, (_, i) => `La venta del día ${i} fue buena, con muchos clientes y buen ticket promedio`).join('. ') + '.'
    const trozos = partirParaHablar(largo, 120)
    expect(trozos.length).toBeGreaterThan(5)
    for (const t of trozos) expect(t.length).toBeLessThanOrEqual(120)
    expect(trozos.join(' ').replace(/\s+/g, ' ')).toBe(largo)
  })

  it('una oración sin puntuación enorme se parte por palabras', () => {
    const texto = Array.from({ length: 80 }, () => 'palabra').join(' ')
    const trozos = partirParaHablar(texto, 50)
    for (const t of trozos) expect(t.length).toBeLessThanOrEqual(50)
    expect(trozos.join(' ')).toBe(texto)
  })

  it('vacío → []', () => {
    expect(partirParaHablar('   ')).toEqual([])
  })
})
