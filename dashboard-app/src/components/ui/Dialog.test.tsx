import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { useRef, useState } from 'react'
import { Dialog } from './Dialog'
import { LAYER } from './layers'
import { __resetScrollLockForTests, __scrollLockCount } from './useScrollLock'

/**
 * Cada caso de aquí sale de un hallazgo real de la auditoría del 2026-08-24 sobre
 * los 75 overlays del repo, no de una lista genérica de buenas prácticas.
 */

afterEach(() => {
  cleanup()
  __resetScrollLockForTests()
})

function Harness(props: Partial<React.ComponentProps<typeof Dialog>> = {}) {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <button type="button">fuera</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Título" {...props}>
        <input aria-label="uno" />
        <input aria-label="dos" />
      </Dialog>
    </div>
  )
}

describe('Dialog — semántica', () => {
  it('monta con role="dialog" y aria-modal="true"', () => {
    render(<Harness />)
    const d = screen.getByRole('dialog')
    expect(d.getAttribute('aria-modal')).toBe('true')
  })

  it('aria-labelledby apunta al id del título renderizado', () => {
    render(<Harness />)
    const d = screen.getByRole('dialog')
    const id = d.getAttribute('aria-labelledby')
    expect(id).toBeTruthy()
    expect(document.getElementById(id!)?.textContent).toBe('Título')
  })

  it('role="alertdialog" cuando se pide (cancelar item, anular orden)', () => {
    render(<Harness role="alertdialog" />)
    expect(screen.getByRole('alertdialog')).toBeTruthy()
  })

  it('sin title y sin ariaLabel avisa en desarrollo', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <Dialog open onClose={() => {}}>
        <p>contenido</p>
      </Dialog>,
    )
    expect(spy.mock.calls.some(c => String(c[0]).includes('nombre accesible'))).toBe(true)
    spy.mockRestore()
  })

  it('con ariaLabel no avisa', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <Dialog open onClose={() => {}} ariaLabel="Confirmar">
        <p>contenido</p>
      </Dialog>,
    )
    expect(spy.mock.calls.some(c => String(c[0]).includes('nombre accesible'))).toBe(false)
    spy.mockRestore()
  })
})

describe('Dialog — cierre por una sola vía', () => {
  it('ESC llama a onClose exactamente una vez', () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose} title="T">
        <p>x</p>
      </Dialog>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('dismissible.esc=false ignora ESC — es el caso del cobro y del conflicto offline', () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose} title="Cobro" dismissible={{ esc: false }}>
        <p>x</p>
      </Dialog>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('clic en el backdrop llama a onClose', () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose} title="T">
        <p>x</p>
      </Dialog>,
    )
    fireEvent.click(screen.getByTestId('dialog-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clic dentro del panel NO cierra', () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose} title="T">
        <p>contenido</p>
      </Dialog>,
    )
    fireEvent.click(screen.getByText('contenido'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('dismissible.backdrop=false ignora el clic en el fondo — secreto de un solo uso', () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose} title="PIN generado" dismissible={{ backdrop: false }}>
        <p>x</p>
      </Dialog>,
    )
    fireEvent.click(screen.getByTestId('dialog-backdrop'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('preventCloseWhile devolviendo true bloquea las tres vías', () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose} title="T" preventCloseWhile={() => true}>
        <p>x</p>
      </Dialog>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByTestId('dialog-backdrop'))
    fireEvent.click(screen.getByTestId('dialog-close'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('X, ESC y backdrop invocan el MISMO handler — es lo que garantiza el teardown de Mercado Pago', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <Dialog open onClose={onClose} title="Cobro">
        <p>x</p>
      </Dialog>,
    )
    fireEvent.click(screen.getByTestId('dialog-close'))
    rerender(
      <Dialog open onClose={onClose} title="Cobro">
        <p>x</p>
      </Dialog>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByTestId('dialog-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('closeButton="none" no renderiza botón de cierre — CancelModal, VoidOrderModal, CashMovementModal', () => {
    render(<Harness closeButton="none" />)
    expect(screen.queryByTestId('dialog-close')).toBeNull()
  })

  it('open=false no monta nada', () => {
    render(
      <Dialog open={false} onClose={() => {}} title="T">
        <p>invisible</p>
      </Dialog>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('invisible')).toBeNull()
  })
})

describe('Dialog — foco', () => {
  it('al abrir, el foco entra al primer input', async () => {
    render(<Harness />)
    await new Promise(r => requestAnimationFrame(() => r(null)))
    expect(document.activeElement).toBe(screen.getByLabelText('uno'))
  })

  it('initialFocus="panel" enfoca el panel — los ~19 modales sin input hoy no enfocan nada', async () => {
    render(<Harness initialFocus="panel" />)
    await new Promise(r => requestAnimationFrame(() => r(null)))
    expect(document.activeElement).toBe(screen.getByRole('dialog'))
  })

  it('Tab desde el último elemento vuelve al primero', () => {
    render(<Harness closeButton="none" />)
    const dos = screen.getByLabelText('dos')
    dos.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByLabelText('uno'))
  })

  it('Shift+Tab desde el primero va al último', () => {
    render(<Harness closeButton="none" />)
    const uno = screen.getByLabelText('uno')
    uno.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByLabelText('dos'))
  })

  it('el foco nunca alcanza un elemento de fuera del panel', () => {
    render(<Harness closeButton="none" />)
    const fuera = screen.getByText('fuera')
    fuera.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).not.toBe(fuera)
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })

  it('al cerrar devuelve el foco al disparador', async () => {
    function App() {
      const [open, setOpen] = useState(false)
      const btn = useRef<HTMLButtonElement>(null)
      return (
        <div>
          <button ref={btn} type="button" onClick={() => setOpen(true)}>
            abrir
          </button>
          <Dialog open={open} onClose={() => setOpen(false)} title="T" returnFocus={btn}>
            <input aria-label="uno" />
          </Dialog>
        </div>
      )
    }
    render(<App />)
    const abrir = screen.getByText('abrir')
    fireEvent.click(abrir)
    await new Promise(r => requestAnimationFrame(() => r(null)))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(abrir)
  })

  it('si el disparador se desmontó, no lanza', () => {
    expect(() => {
      const { unmount } = render(<Harness />)
      fireEvent.keyDown(document, { key: 'Escape' })
      unmount()
    }).not.toThrow()
  })
})

describe('Dialog — scroll del body', () => {
  beforeEach(() => {
    document.body.style.overflow = ''
  })

  it('bloquea el scroll al abrir y lo restaura al cerrar', () => {
    const { unmount } = render(<Harness />)
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('restaura el valor PREVIO, no lo vacía — /pos/* sí scrollea a propósito', () => {
    document.body.style.overflow = 'auto'
    const { unmount } = render(<Harness />)
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('auto')
  })

  it('con dos diálogos anidados, sólo el último desbloquea', () => {
    const a = render(
      <Dialog open onClose={() => {}} title="A">
        <p>a</p>
      </Dialog>,
    )
    const b = render(
      <Dialog open onClose={() => {}} title="B" layer="dialogNested">
        <p>b</p>
      </Dialog>,
    )
    expect(__scrollLockCount()).toBe(2)
    b.unmount()
    expect(document.body.style.overflow).toBe('hidden')
    a.unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('scrollLock=false no toca el body — bottom sheet del menú del comensal', () => {
    render(<Harness scrollLock={false} />)
    expect(document.body.style.overflow).toBe('')
  })
})

describe('Dialog — capas y montaje', () => {
  it('container="inline" deja el panel dentro del árbol, no en body', () => {
    const { container } = render(
      <div className="pos-kiosk">
        <Dialog open onClose={() => {}} title="T">
          <p>x</p>
        </Dialog>
      </div>,
    )
    const panel = screen.getByRole('dialog')
    expect(panel.closest('.pos-kiosk')).not.toBeNull()
    expect(container.contains(panel)).toBe(true)
  })

  it('container="portal" monta en document.body, fuera del árbol del padre', () => {
    const { container } = render(
      <div id="padre">
        <Dialog open onClose={() => {}} title="T" container="portal">
          <p>x</p>
        </Dialog>
      </div>,
    )
    const panel = screen.getByRole('dialog')
    expect(container.querySelector('#padre')?.contains(panel)).toBe(false)
    expect(document.body.contains(panel)).toBe(true)
  })

  it('el z-index sale de LAYER, no de un literal', () => {
    render(<Harness data-testid="d" layer="blocking" />)
    expect(screen.getByTestId('d').style.zIndex).toBe(String(LAYER.blocking))
  })

  it('LAYER.toast está por encima de blocking, prompt y banner — hoy los toasts son invisibles', () => {
    expect(LAYER.toast).toBeGreaterThan(LAYER.blocking)
    expect(LAYER.toast).toBeGreaterThan(LAYER.prompt)
    expect(LAYER.toast).toBeGreaterThan(LAYER.banner)
    expect(LAYER.toast).toBeGreaterThan(LAYER.errorBoundary)
  })
})
