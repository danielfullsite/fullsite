// El selector de rango.
//
// Daniel lo abrió en /cortes y el panel tapó por completo una tarjeta de KPI.
// Al revisarlo salieron SEIS defectos en un solo componente, y cada `it` de aquí
// abajo corresponde a uno. Ninguno era visible desde el código: todos se ven
// sólo cuando el panel está abierto encima de otra cosa.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import PeriodPicker from '@/components/PeriodPicker'
import { LAYER } from '@/components/ui/layers'

afterEach(cleanup)

function abrir(props: Partial<React.ComponentProps<typeof PeriodPicker>> = {}) {
  const r = render(
    <PeriodPicker period={30} onPeriod={() => {}} range={null} onRange={() => {}} {...props} />
  )
  fireEvent.click(screen.getByTitle('Rango de fechas personalizado'))
  return r
}

describe('PeriodPicker — el panel flotante', () => {
  it('el panel NO usa el mismo blanco de las tarjetas que tapa', () => {
    // El defecto original: bg-[var(--surface)], que en tema claro es el MISMO
    // blanco de la tarjeta de KPI. Al abrirse encima, las dos se fundían en una
    // figura rota y parecía que la tarjeta se había reventado.
    abrir()
    const panel = screen.getByRole('dialog')
    expect(panel.getAttribute('style')).toMatch(/--raised/)
    expect(panel.getAttribute('style')).not.toMatch(/var\(--surface\)/)
  })

  it('se apila con la escala, no con un z-index inventado', () => {
    abrir()
    const panel = screen.getByRole('dialog')
    expect(panel.style.zIndex).toBe(String(LAYER.popover))
    // y por debajo de cualquier diálogo: un popover no puede tapar un modal
    expect(LAYER.popover).toBeLessThan(LAYER.dialog)
  })

  it('cierra con ESC, no sólo con clic fuera', () => {
    abrir()
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('el botón anuncia que abre un panel y si está abierto', () => {
    render(<PeriodPicker period={30} onPeriod={() => {}} range={null} onRange={() => {}} />)
    const btn = screen.getByTitle('Rango de fechas personalizado')
    expect(btn.getAttribute('aria-haspopup')).toBe('dialog')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
  })

  it('no se sale en pantalla angosta', () => {
    // w-[280px] fijo con right-0 se cortaba en un teléfono.
    abrir()
    expect(screen.getByRole('dialog').className).toMatch(/max-w-\[calc\(100vw-2rem\)\]/)
  })
})

describe('PeriodPicker — el rango aplicado se lee como lo diría una persona', () => {
  it('no imprime fechas ISO crudas en el botón', () => {
    render(
      <PeriodPicker
        period={30} onPeriod={() => {}}
        range={{ from: '2026-07-26', to: '2026-08-25' }} onRange={() => {}}
      />
    )
    const btn = screen.getByTitle('Rango de fechas personalizado')
    expect(btn.textContent).not.toMatch(/2026-07-26/)
    expect(btn.textContent).toMatch(/26 de jul|26 jul/)
    expect(btn.textContent).toMatch(/25 de ago|25 ago/)
  })

  it('una fecha inválida no revienta el botón', () => {
    render(
      <PeriodPicker
        period={30} onPeriod={() => {}}
        range={{ from: 'no-es-fecha', to: '2026-08-25' }} onRange={() => {}}
      />
    )
    expect(screen.queryByText(/Invalid Date/)).toBeNull()
  })
})
