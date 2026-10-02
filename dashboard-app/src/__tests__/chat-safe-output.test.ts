import { describe, expect, it } from 'vitest'
import { quitarBloquesNoVerificados } from '@/lib/chat-safe-output'

describe('salida segura del chat', () => {
  it('omite el bloque completo que contiene cifras no verificadas y su conclusión dependiente', () => {
    const salida = quitarBloquesNoVerificados([
      '## Hecho\nLa venta semanal se mantuvo estable.',
      '## Meseros\n1. Ana: $500\n2. Bruno: [sin verificar]',
      'Cambio: Ana sube a #1, por lo que conviene replicar su turno.',
      '## Siguiente paso\nRevisar la cobertura por horario.',
    ].join('\n\n'))

    expect(salida.texto).toContain('La venta semanal se mantuvo estable')
    expect(salida.texto).toContain('Revisar la cobertura por horario')
    expect(salida.texto).not.toContain('[sin verificar]')
    expect(salida.texto).not.toContain('Ana sube a #1')
    expect(salida.omitidos).toBe(2)
  })

  it('no altera una respuesta totalmente verificable', () => {
    const texto = '## Hecho\nVentas: $100.\n\n## Siguiente paso\nRevisar mañana.'
    expect(quitarBloquesNoVerificados(texto)).toEqual({ texto, omitidos: 0 })
  })
})
