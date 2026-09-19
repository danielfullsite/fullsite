// Primitivas de la fase 1 del rediseño V2.
//
// Lo que se prueba aquí NO es que se vean bonitas: es el contrato que el resto
// del POS va a dar por hecho. Tres cosas concretas:
//
//   1. `Row` con acción es un <button>. Si vuelve a ser un <div onClick>, la
//      pantalla deja de llegar por teclado y un lector de pantalla no la anuncia.
//   2. `Sheet` NO reimplementa el modal: envuelve <Dialog>. Si alguien lo
//      "simplifica" a un div absoluto, se pierden la trampa de foco, el ESC por
//      pila y el bloqueo de scroll — sin ningún error visible.
//   3. `Keypad` no guarda estado. Es lo que permite reusarlo en el PIN, en el
//      arqueo y en el cobro sin que uno le herede el monto al otro.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { Sheet, List, Row, RowText, CardStat, Tag, Pill, ActionBar, Keypad } from './PosKit'

afterEach(cleanup)

describe('Tag y Pill', () => {
  it('Tag es un <span>: lo que se toca es un botón, lo que clasifica no', () => {
    render(<Tag tone="bad">cancelada</Tag>)
    const t = screen.getByText('cancelada')
    expect(t.tagName).toBe('SPAN')
    expect(t.getAttribute('data-tone')).toBe('bad')
  })

  it('Pill sin onClick es <span>; con onClick es <button> y avisa', () => {
    const { unmount } = render(<Pill state="off">Sin internet</Pill>)
    expect(screen.getByText('Sin internet').closest('span')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    unmount()

    const onClick = vi.fn()
    render(<Pill state="on" onClick={onClick}>Cocina</Pill>)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('Pill refleja su estado en data-state — el color no es el único canal', () => {
    render(<Pill state="warn">Subiendo 3</Pill>)
    expect(screen.getByText(/Subiendo 3/).getAttribute('data-state')).toBe('warn')
  })
})

describe('CardStat', () => {
  it('muestra etiqueta, valor y nota', () => {
    render(<CardStat label="Venta del turno" value="$48,210" note="$6,027 por hora" tone="ok" />)
    expect(screen.getByText('Venta del turno')).toBeTruthy()
    expect(screen.getByText('$48,210')).toBeTruthy()
    expect(screen.getByText('$6,027 por hora')).toBeTruthy()
  })

  it('sin nota no pinta una línea vacía', () => {
    const { container } = render(<CardStat label="Cuentas" value={0} />)
    expect(container.textContent).toBe('Cuentas0')
  })

  it('un valor de 0 se pinta — no se cae por falsy', () => {
    render(<CardStat label="Cancelaciones" value={0} />)
    expect(screen.getByText('0')).toBeTruthy()
  })
})

describe('List y Row', () => {
  it('Row con onClick es <button> accesible; sin onClick es <div>', () => {
    const onClick = vi.fn()
    const { unmount } = render(<List><Row onClick={onClick}>toca</Row></List>)
    const b = screen.getByRole('button')
    expect(b.tagName).toBe('BUTTON')
    expect(b.getAttribute('type')).toBe('button')
    fireEvent.click(b)
    expect(onClick).toHaveBeenCalledTimes(1)
    unmount()

    render(<List><Row>sólo lectura</Row></List>)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('respeta las columnas declaradas', () => {
    render(<List><Row data-testid="r" columns="auto 1fr auto">x</Row></List>)
    expect(screen.getByTestId('r').style.gridTemplateColumns).toBe('auto 1fr auto')
  })

  it('RowText pinta título y apoyo, y omite el apoyo si no hay', () => {
    const { container, unmount } = render(<RowText title="Mesa 7" sub="Aldo · 2 personas" />)
    expect(screen.getByText('Mesa 7')).toBeTruthy()
    expect(screen.getByText('Aldo · 2 personas')).toBeTruthy()
    expect(container.firstElementChild!.childElementCount).toBe(2)
    unmount()

    const solo = render(<RowText title="Mesa 7" />)
    expect(solo.container.firstElementChild!.childElementCount).toBe(1)
  })
})

describe('Keypad', () => {
  it('emite el dígito tocado y no guarda nada', () => {
    const onDigit = vi.fn()
    render(<Keypad onDigit={onDigit} />)
    fireEvent.click(screen.getByText('7'))
    fireEvent.click(screen.getByText('0'))
    expect(onDigit.mock.calls.map(c => c[0])).toEqual(['7', '0'])
  })

  it('tiene las diez teclas', () => {
    render(<Keypad onDigit={() => {}} />)
    const grupo = screen.getByRole('group', { name: 'Teclado numérico' })
    for (const d of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']) {
      expect(within(grupo).getByText(d)).toBeTruthy()
    }
  })

  it('las dos funciones son opcionales y llaman a lo suyo', () => {
    const left = vi.fn(); const right = vi.fn()
    render(<Keypad onDigit={() => {}} left={{ label: 'Limpiar', onPress: left }} right={{ label: '←', onPress: right }} />)
    fireEvent.click(screen.getByText('Limpiar'))
    fireEvent.click(screen.getByText('←'))
    expect(left).toHaveBeenCalledTimes(1)
    expect(right).toHaveBeenCalledTimes(1)
  })
})

describe('ActionBar', () => {
  it('conserva la altura y las columnas: la posición del verbo es memoria muscular', () => {
    render(<ActionBar columns="auto 1fr 1.25fr"><span>a</span><span>b</span><span>c</span></ActionBar>)
    const bar = screen.getByRole('contentinfo')
    expect(bar.style.gridTemplateColumns).toBe('auto 1fr 1.25fr')
    expect(bar.style.height).toBe('78px')
  })
})

describe('Sheet', () => {
  it('cerrada no renderiza nada', () => {
    const { container } = render(<Sheet open={false} onClose={() => {}} title="Cobrar">x</Sheet>)
    expect(container.firstChild).toBeNull()
  })

  it('abierta trae título, subtítulo, cuerpo y pie', () => {
    render(
      <Sheet open onClose={() => {}} title="Cobrar mesa 7" subtitle="3 renglones" footer={<button>Confirmar</button>}>
        <p>contenido</p>
      </Sheet>,
    )
    expect(screen.getByText('Cobrar mesa 7')).toBeTruthy()
    expect(screen.getByText('3 renglones')).toBeTruthy()
    expect(screen.getByText('contenido')).toBeTruthy()
    expect(screen.getByText('Confirmar')).toBeTruthy()
  })

  it('HEREDA de Dialog: rol de diálogo, aria-modal y cierre por ESC', () => {
    const onClose = vi.fn()
    render(<Sheet open onClose={onClose} title="Acciones">x</Sheet>)

    const panel = screen.getByRole('dialog')
    expect(panel.getAttribute('aria-modal')).toBe('true')
    // Si alguien reemplaza Sheet por un div absoluto, esto truena.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('la X y el fondo cierran por la MISMA puerta que ESC', () => {
    const onClose = vi.fn()
    const { rerender } = render(<Sheet open onClose={onClose} title="Acciones">x</Sheet>)
    fireEvent.click(screen.getByTestId('dialog-close'))
    expect(onClose).toHaveBeenCalledTimes(1)

    rerender(<Sheet open onClose={onClose} title="Acciones">x</Sheet>)
    fireEvent.click(screen.getByTestId('dialog-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('`dismissible={false}` no deja cerrar — para el cobro a media transacción', () => {
    const onClose = vi.fn()
    render(<Sheet open onClose={onClose} title="Cobrando" dismissible={false}>x</Sheet>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('dialog-close')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('se queda DENTRO de .pos-kiosk — portalearlo mata los targets de 48px', () => {
    render(
      <div className="pos-kiosk">
        <Sheet open onClose={() => {}} title="Acciones">x</Sheet>
      </div>,
    )
    expect(screen.getByRole('dialog').closest('.pos-kiosk')).not.toBeNull()
  })

  it('los tres tamaños del rediseño llegan al panel', () => {
    const anchos: Record<string, string> = { md: 'max-w-[820px]', wide: 'max-w-[1060px]', full: 'max-w-[1280px]' }
    for (const [size, clase] of Object.entries(anchos)) {
      const { unmount } = render(<Sheet open onClose={() => {}} size={size as 'md'} title="T">x</Sheet>)
      expect(screen.getByRole('dialog').className).toContain(clase)
      unmount()
    }
  })
})
