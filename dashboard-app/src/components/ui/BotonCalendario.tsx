'use client'
/**
 * El botón que abre el calendario.
 *
 * EL BUG QUE ARREGLA. Antes esto era un `<input type="date">` invisible
 * (`opacity-0`) estirado sobre un icono decorativo con `pointer-events-none`.
 * Suena razonable y no funciona: en un campo de fecha nativo, el clic sólo abre
 * el calendario si cae sobre el iconito interno del navegador. El resto del
 * área enfoca los segmentos de día, mes y año para teclearlos.
 *
 * Ese iconito vive pegado al borde derecho del campo y mide unos 16 px. Al
 * estirar el campo a una casilla de 36 px, quedaba una franja estrecha —y
 * distinta en cada navegador— donde el clic funcionaba. Fuera de ella no pasaba
 * nada: ni error, ni calendario. Reportado como «el calendario tiene un spot
 * donde no se le puede picar bien», y eso es exactamente lo que era.
 *
 * Ahora el botón es un botón de verdad y abre el calendario con `showPicker()`,
 * que es la forma estándar de pedirlo. El campo queda fuera del camino del
 * ratón y sólo guarda el valor.
 *
 * `showPicker()` puede lanzar: algunos navegadores exigen que la llamada venga
 * de un gesto del usuario, y Safari tardó en traerlo. Por eso hay respaldo:
 * si no existe o lanza, se enfoca el campo, que al menos deja escribir la fecha
 * con el teclado en vez de dejar al usuario sin salida.
 */
import { useRef, type ReactNode } from 'react'

export default function BotonCalendario({
  valor, min, max, alElegir, etiqueta, children,
}: {
  valor?: string
  min?: string
  max?: string
  alElegir: (fecha: string) => void
  /** Nombre accesible. El campo invisible anterior no tenía ninguno. */
  etiqueta: string
  children: ReactNode
}) {
  const campo = useRef<HTMLInputElement>(null)

  const abrir = () => {
    const el = campo.current
    if (!el) return
    try {
      // `showPicker` existe desde Chrome 99, Firefox 101 y Safari 16.
      if (typeof el.showPicker === 'function') { el.showPicker(); return }
    } catch {
      // Puede lanzar si el navegador no considera esto un gesto del usuario.
    }
    el.focus()
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={abrir}
        aria-label={etiqueta}
        className="flex h-9 w-9 items-center justify-center rounded-lg border transition-colors hover:border-[var(--accent-line)] hover:bg-[var(--raised)]"
        style={{ background: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--text-2)' }}
      >
        {children}
      </button>
      <input
        ref={campo}
        type="date"
        tabIndex={-1}
        aria-hidden
        // Fuera del camino del ratón, pero presente en el documento: un campo
        // con `display:none` no puede abrir su propio calendario.
        className="pointer-events-none absolute bottom-0 left-0 h-0 w-0 opacity-0"
        value={valor}
        min={min}
        max={max}
        onChange={e => { if (e.target.value) alElegir(e.target.value) }}
      />
    </div>
  )
}
