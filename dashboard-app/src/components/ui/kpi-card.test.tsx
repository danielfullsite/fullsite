// El tratamiento monetario del KPI: entero grande, centavos elevados.
//
// La parte delicada es qué NO se parte. Un `27.6%` partido en "27" + "6%"
// elevado, o un "7 / 16" tratado como decimal, se ve roto y nadie lo nota hasta
// que está en producción. Estas pruebas fijan la frontera.
//
// Viven bajo components/ui/ para correr con `npm run test:ui` (jsdom), aunque el
// componente esté en components/.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Ban } from 'lucide-react'
import KPICard from '@/components/KPICard'

afterEach(cleanup)

/** Texto del valor en la variante de escritorio. */
function valorDesktop(): HTMLElement {
  // hay dos layouts (móvil y escritorio); el de escritorio es el segundo
  const nodos = screen.getAllByTestId('kpi-valor')
  return nodos[nodos.length - 1]
}

describe('KPICard — cifra con centavos elevados', () => {
  it('parte un monto con centavos: el entero manda, los centavos se elevan', () => {
    render(<KPICard label="Ventas" value="$48,250.75" />)
    const v = valorDesktop()
    expect(v.textContent).toBe('$48,250.75')
    // el `.75` va en su propio span, más chico y elevado
    const chico = v.querySelector('span')
    expect(chico?.textContent).toBe('.75')
    expect(chico?.className).toContain('text-[0.58em]')
  })

  it('NO parte un porcentaje de un decimal — 27.6% se queda entero', () => {
    render(<KPICard label="Food cost" value="27.6%" />)
    const v = valorDesktop()
    expect(v.textContent).toBe('27.6%')
    expect(v.querySelector('span')).toBeNull()
  })

  it('NO parte un porcentaje de dos decimales — termina en %, no en dígito', () => {
    render(<KPICard label="Margen" value="27.65%" />)
    expect(valorDesktop().querySelector('span')).toBeNull()
  })

  it('NO parte un entero', () => {
    render(<KPICard label="Comensales" value="118" />)
    const v = valorDesktop()
    expect(v.textContent).toBe('118')
    expect(v.querySelector('span')).toBeNull()
  })

  it('NO parte una razón tipo 7 / 16', () => {
    render(<KPICard label="Mesas" value="7 / 16" />)
    expect(valorDesktop().querySelector('span')).toBeNull()
  })

  it('NO parte una cifra abreviada tipo $1.2M', () => {
    render(<KPICard label="Anual" value="$1.2M" />)
    expect(valorDesktop().querySelector('span')).toBeNull()
  })

  it('parte un monto negativo conservando el signo en el entero', () => {
    render(<KPICard label="Merma" value="-$1,340.20" />)
    const v = valorDesktop()
    expect(v.textContent).toBe('-$1,340.20')
    expect(v.querySelector('span')?.textContent).toBe('.20')
  })

  it('el valor siempre lleva tabular-nums, para que una fila de tarjetas alinee', () => {
    render(<KPICard label="Ventas" value="$48,250.75" />)
    expect(valorDesktop().className).toContain('tnum')
  })
})

describe('KPICard — el arcoíris de acentos se retiró', () => {
  it('los acentos decorativos ya no pintan el chip de color', () => {
    for (const acc of ['kpi-accent-blue', 'kpi-accent-purple', 'kpi-accent-pink', 'kpi-accent-cyan']) {
      cleanup()
      const { container } = render(<KPICard label="X" value="1" accentClass={acc} />)
      const html = container.innerHTML
      expect(html, `${acc} sigue pintando color saturado`).not.toMatch(/bg-(blue|purple|pink|cyan|amber)-500/)
    }
  })

  it('el acento rojo SÍ conserva color: ahí el color es el mensaje', () => {
    // el tinte vive en el chip del icono, así que hay que pasar icono
    const { container } = render(
      <KPICard label="Cancelaciones" value="4" accentClass="kpi-accent-red" icon={Ban} />,
    )
    expect(container.innerHTML).toContain('--crit-soft')
  })

  it('los acentos decorativos con icono usan chip neutro', () => {
    const { container } = render(
      <KPICard label="Ventas" value="1" accentClass="kpi-accent-blue" icon={Ban} />,
    )
    expect(container.innerHTML).toContain('--surface-2')
    expect(container.innerHTML).not.toMatch(/bg-blue-500/)
  })

  it('sigue aceptando los siete nombres sin romperse — 35 páginas los pasan', () => {
    for (const acc of [
      'kpi-accent-blue', 'kpi-accent-green', 'kpi-accent-amber',
      'kpi-accent-purple', 'kpi-accent-pink', 'kpi-accent-red', 'kpi-accent-cyan',
    ]) {
      cleanup()
      expect(() => render(<KPICard label="X" value="1" accentClass={acc} />)).not.toThrow()
    }
  })

  it('un acento desconocido cae al neutro sin reventar', () => {
    expect(() => render(<KPICard label="X" value="1" accentClass="kpi-accent-inventado" />)).not.toThrow()
  })
})

describe('KPICard — nada de lo que ya mostraba se perdió', () => {
  it('sigue mostrando etiqueta, delta, subtítulo y cambio semanal', () => {
    render(
      <KPICard
        label="Ventas netas"
        value="$48,250.75"
        delta="+12.5%"
        deltaType="up"
        subtitle="vs ayer"
        weekChange={3.2}
      />,
    )
    expect(screen.getAllByText('Ventas netas').length).toBeGreaterThan(0)
    expect(screen.getByText('+12.5%')).toBeTruthy()
    expect(screen.getByText('vs ayer')).toBeTruthy()
    expect(screen.getByText(/3\.2% vs semana pasada/)).toBeTruthy()
  })

  it('weekChange negativo se pinta como crítico, no como positivo', () => {
    render(<KPICard label="Ventas" value="100" weekChange={-4.1} />)
    const nodo = screen.getByText(/-4\.1% vs semana pasada/)
    expect(nodo.className).toContain('crit-ink')
  })
})
