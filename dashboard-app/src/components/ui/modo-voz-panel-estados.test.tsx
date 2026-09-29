// Estados visibles del panel del modo voz (el hook se simula): "Te escucho…" con el
// subtítulo en vivo, la frase que suena resaltada, la descarga de la voz natural con
// progreso, y la pausa "¿Seguimos?".
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { FaseVoz } from '@/hooks/useModoVoz'
import type { EstadoCargaVoz } from '@/lib/voz/proveedores'

const acciones = { abrir: vi.fn(async () => {}), cerrar: vi.fn(), interrumpir: vi.fn(), reintentar: vi.fn() }
let estado: Record<string, unknown> = {}
function fijar(parcial: Partial<{
  fase: FaseVoz; usuarioHablando: boolean; enVivo: string; ultimaPregunta: string; frases: string[]; fraseActual: number
  cargaVoz: EstadoCargaVoz; interrumpePorVoz: boolean; error: string | null
}>) {
  estado = {
    fase: 'escuchando', nivel: 0, usuarioHablando: false, error: null, ultimaPregunta: '', ultimaRespuesta: '',
    frases: [], fraseActual: -1, enVivo: '', cargaVoz: { estado: 'inactivo' }, interrumpePorVoz: false, ...acciones, ...parcial,
  }
}
vi.mock('@/hooks/useModoVoz', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useModoVoz')>()),
  useModoVoz: () => estado,
}))

import ModoVozPanel, { textoCargaVoz } from '@/components/chat/ModoVozPanel'

const props = { preguntar: async () => '', alPreguntar: () => {}, alResponder: () => {}, alCerrar: vi.fn() }
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('ModoVozPanel — estados', () => {
  it('escuchando: "Te escucho…" siempre visible; mientras habla, su subtítulo en vivo', () => {
    fijar({ fase: 'escuchando' })
    const { rerender } = render(<ModoVozPanel {...props} />)
    expect(screen.getByText('Escuchando')).toBeTruthy()
    expect(screen.getByText('Te escucho…')).toBeTruthy()
    expect(screen.queryByTestId('voz-dicho')).toBeNull()
    fijar({ fase: 'escuchando', usuarioHablando: true, enVivo: 'cuánto vendimos' })
    rerender(<ModoVozPanel {...props} />)
    expect(screen.getByTestId('voz-dicho').textContent).toBe('“cuánto vendimos”')
    expect(screen.getByText('Te escucho…')).toBeTruthy()
  })

  it('hablando: la frase que suena va resaltada (aria-current) y dice cómo interrumpir', () => {
    fijar({ fase: 'hablando', ultimaPregunta: '¿Cuánto vendimos?', frases: ['Hoy llevas $12,533.', 'Vas arriba.'], fraseActual: 1, interrumpePorVoz: true })
    render(<ModoVozPanel {...props} />)
    const actual = document.querySelector('[aria-current="true"]')
    expect(actual?.textContent?.trim()).toBe('Vas arriba.')
    expect(screen.getByText('Hoy llevas $12,533.').getAttribute('aria-current')).toBeNull()
    expect(screen.getByText('Habla o toca el círculo para interrumpir.')).toBeTruthy()
    expect(screen.getByTestId('voz-dicho').textContent).toBe('“¿Cuánto vendimos?”')
    fireEvent.click(screen.getByRole('button', { name: 'Interrumpir respuesta' }))
    expect(acciones.interrumpir).toHaveBeenCalled()
  })

  it('hablando con la voz del navegador: sólo tocando', () => {
    fijar({ fase: 'hablando', frases: ['Hola.'], fraseActual: 0, interrumpePorVoz: false })
    render(<ModoVozPanel {...props} />)
    expect(screen.getByText('Toca el círculo para interrumpir.')).toBeTruthy()
  })

  it('primera vez: "Preparando voz… N% (solo la primera vez)" con barra de progreso', () => {
    fijar({ fase: 'escuchando', cargaVoz: { estado: 'descargando', cargado: 26_500_000, total: 63_122_309 } })
    render(<ModoVozPanel {...props} />)
    expect(screen.getByRole('status').textContent).toContain('Preparando voz… 41% (solo la primera vez)')
  })

  it('textoCargaVoz: nada cuando ya está lista o en respaldo', () => {
    expect(textoCargaVoz({ estado: 'listo', motor: 'piper:x' })).toBeNull()
    expect(textoCargaVoz({ estado: 'respaldo', razon: 'lento' })).toBeNull()
    expect(textoCargaVoz({ estado: 'iniciando' })).toBe('Preparando voz…')
    expect(textoCargaVoz({ estado: 'descargando', cargado: 0, total: 0 })).toBe('Preparando voz… 0% (solo la primera vez)')
  })

  it('pausado por silencio: "¿Seguimos?" y tocar (círculo o botón) reanuda', () => {
    fijar({ fase: 'pausado' })
    render(<ModoVozPanel {...props} />)
    expect(screen.getByText('¿Seguimos?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Seguir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Seguir conversación' }))
    expect(acciones.reintentar).toHaveBeenCalledTimes(2)
  })
})
