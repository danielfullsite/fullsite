// El centro de agentes: la tarjeta, el panel de detalle y la notificación.
//
// Lo que se prueba es que el producto no mienta ni se calle cuando debe hablar:
//   · cuando NO hay nada, lo dice — no desaparece
//   · el aviso emergente sale una vez al día, no en cada recarga
//   · el chat admite que todavía no funciona en vez de tragarse la pregunta
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import CentroAgentes from '@/components/agentes/CentroAgentes'
import PanelAgente from '@/components/agentes/PanelAgente'
import NotificacionFullsite from '@/components/agentes/NotificacionFullsite'
import GraficaEvidencia from '@/components/agentes/GraficaEvidencia'
import type { Deteccion } from '@/lib/agentes/detectar'

const det = (o: Partial<Deteccion> = {}): Deteccion => ({
  id: 'venta-vs-dia-2026-07-24',
  agente: 'Ventas fuera de lo normal',
  agenteQueHace: 'Compara cada día contra tus mismos días',
  verbo: 'Revísalo',
  linea: 'la venta cerró 69% abajo de lo que da un viernes normal',
  pushTitulo: 'Un viernes flojo',
  pushCuerpo: 'Cerraste $2,070. Un viernes normal son $6,619.',
  impacto: -4549,
  severidad: 'alta',
  queAnalizo: ['El 24 jul, contra tus 4 viernes anteriores.', 'Un viernes normal son $6,619.'],
  evidencia: [
    { etiqueta: '26 jun', valor: 9185 },
    { etiqueta: '3 jul', valor: 6215 },
    { etiqueta: '24 jul', valor: 2070, foco: true },
  ],
  evidenciaNota: 'Tus últimos viernes.',
  recomendacion: 'Checa si ese viernes hubo algo fuera de lo común antes de darlo por malo.',
  ...o,
})

beforeEach(() => {
  try { window.localStorage.clear() } catch { /* */ }
})
afterEach(cleanup)

describe('CentroAgentes — cuándo habla y cuándo se calla', () => {
  it('sin detecciones dice "Todo en orden" en vez de desaparecer', () => {
    render(<CentroAgentes detecciones={[]} />)
    expect(screen.getByText('Todo en orden')).toBeTruthy()
    expect(screen.getByText(/Nada que atender/)).toBeTruthy()
  })

  it('mientras carga no renderiza nada', () => {
    const { container } = render(<CentroAgentes detecciones={[det()]} cargando />)
    expect(container.firstChild).toBeNull()
  })

  it('el encabezado cuenta bien: nunca "1 cosas"', () => {
    const { rerender } = render(<CentroAgentes detecciones={[det()]} />)
    expect(screen.getByText(/1 cosa para hoy/)).toBeTruthy()
    expect(screen.queryByText(/1 cosas/)).toBeNull()
    rerender(<CentroAgentes detecciones={[det(), det({ id: 'b' })]} />)
    expect(screen.getByText(/2 cosas para hoy/)).toBeTruthy()
  })

  it('el renglón lleva verbo, hecho y dinero', () => {
    render(<CentroAgentes detecciones={[det()]} />)
    expect(screen.getByText('Revísalo:')).toBeTruthy()
    expect(screen.getByText(/69% abajo/)).toBeTruthy()
    expect(screen.getByText('−$4,549')).toBeTruthy()
  })

  it('sin impacto calculable no inventa un monto', () => {
    render(<CentroAgentes detecciones={[det({ impacto: null })]} />)
    expect(screen.queryByText(/\$/)).toBeNull()
  })

  it('nunca escribe como sistema', () => {
    render(<CentroAgentes detecciones={[det()]} />)
    const t = document.body.textContent || ''
    expect(t).not.toMatch(/ALERTAS|issues|critical|high/)
  })
})

describe('CentroAgentes — abrir y resolver', () => {
  it('al hacer clic se abre el detalle', async () => {
    render(<CentroAgentes detecciones={[det()]} />)
    fireEvent.click(screen.getByText('Revísalo:').closest('button')!)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(screen.getByText('Qué analizó')).toBeTruthy()
  })

  it('"no aplica" avisa, deja ver el acuse, y al cerrar queda vacío', async () => {
    // El panel NO puede desmontarse al vaciarse la lista: marcar la última
    // detección haría desaparecer todo de golpe, sin enseñar qué pasó.
    const onAccion = vi.fn()
    render(<CentroAgentes detecciones={[det()]} onAccion={onAccion} />)
    fireEvent.click(screen.getByText('Revísalo:').closest('button')!)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())

    fireEvent.click(screen.getByText('No aplica'))
    expect(onAccion).toHaveBeenCalledWith('venta-vs-dia-2026-07-24', 'descartar')
    // el panel sigue abierto y explica qué quedó
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText(/no te lo vuelvo a sacar/)).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Cerrar'))
    await waitFor(() => expect(screen.getByText('Todo en orden')).toBeTruthy())
  })
})

describe('PanelAgente — enseña con qué lo sostiene', () => {
  it('muestra impacto, qué analizó, evidencia y recomendación', () => {
    render(<PanelAgente deteccion={det()} onCerrar={() => {}} />)
    expect(screen.getByText('−$4,549')).toBeTruthy()
    expect(screen.getByText(/4 viernes anteriores/)).toBeTruthy()
    expect(screen.getByText('Evidencia')).toBeTruthy()
    expect(screen.getByText(/algo fuera de lo común/)).toBeTruthy()
  })

  it('cierra con ESC', () => {
    const onCerrar = vi.fn()
    render(<PanelAgente deteccion={det()} onCerrar={onCerrar} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCerrar).toHaveBeenCalled()
  })

  it('cada acción deja un acuse distinto', () => {
    const { rerender } = render(<PanelAgente deteccion={det()} onCerrar={() => {}} />)
    fireEvent.click(screen.getByText('Recuérdamelo'))
    expect(screen.getByText(/te lo recuerdo mañana/)).toBeTruthy()
    // al abrir OTRA detección el panel arranca limpio
    rerender(<PanelAgente deteccion={det({ id: 'otra' })} onCerrar={() => {}} />)
    expect(screen.queryByText(/te lo recuerdo mañana/)).toBeNull()
    expect(screen.getByText('Ya lo atendí')).toBeTruthy()
  })

  it('el chat admite que todavía no funciona en vez de fingir', () => {
    render(<PanelAgente deteccion={det()} onCerrar={() => {}} />)
    expect(screen.getByLabelText('Enviar pregunta')).toHaveProperty('disabled', true)
    expect(screen.getByText(/todavía no está listo/)).toBeTruthy()
  })

  it('sin detección no renderiza nada', () => {
    const { container } = render(<PanelAgente deteccion={null} onCerrar={() => {}} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('NotificacionFullsite — avisa una vez, no en cada recarga', () => {
  it('sale con el logo de Fullsite y el texto corto', async () => {
    vi.useFakeTimers()
    render(<NotificacionFullsite detecciones={[det()]} />)
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(screen.getByText('Fullsite')).toBeTruthy()
    expect(screen.getByText('Un viernes flojo')).toBeTruthy()
    vi.useRealTimers()
  })

  it('no vuelve a salir el mismo día — una alerta repetida deja de leerse', async () => {
    vi.useFakeTimers()
    const { unmount } = render(<NotificacionFullsite detecciones={[det()]} />)
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(screen.getByText('Un viernes flojo')).toBeTruthy()
    unmount()

    const { container } = render(<NotificacionFullsite detecciones={[det()]} />)
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(container.firstChild).toBeNull()
    vi.useRealTimers()
  })

  it('sin detecciones no aparece', async () => {
    vi.useFakeTimers()
    const { container } = render(<NotificacionFullsite detecciones={[]} />)
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(container.firstChild).toBeNull()
    vi.useRealTimers()
  })
})

describe('GraficaEvidencia', () => {
  it('la barra del día analizado se distingue de las de referencia', () => {
    const { container } = render(<GraficaEvidencia puntos={det().evidencia} />)
    const barras = [...container.querySelectorAll('div > span[style*="height"]')]
    expect(barras).toHaveLength(3)
    // la de foco va en acento; las otras en el tono neutro
    expect(barras[2].getAttribute('style')).toMatch(/--accent/)
    expect(barras[0].getAttribute('style')).toMatch(/--text-4/)
  })

  it('las alturas son proporcionales al máximo', () => {
    const { container } = render(<GraficaEvidencia puntos={det().evidencia} />)
    const alturas = [...container.querySelectorAll('div > span[style*="height"]')]
      .map(e => parseFloat((e as HTMLElement).style.height))
    expect(alturas[0]).toBeCloseTo(100, 0)                    // 9185 es el máximo
    expect(alturas[2]).toBeCloseTo((2070 / 9185) * 100, 0)
  })

  it('se anuncia a lectores de pantalla, no sólo por color', () => {
    render(<GraficaEvidencia puntos={det().evidencia} />)
    const g = screen.getByRole('img')
    expect(g.getAttribute('aria-label')).toMatch(/26 jun/)
    expect(g.getAttribute('aria-label')).toMatch(/24 jul/)
  })

  it('sin puntos no dibuja un marco vacío', () => {
    const { container } = render(<GraficaEvidencia puntos={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
