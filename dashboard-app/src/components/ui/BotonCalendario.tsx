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
 * Ahora el botón es un botón de verdad y abre el calendario con `showPicker()`.
 *
 * EL RESPALDO, Y POR QUÉ NO ES UN DETALLE. `showPicker()` puede no existir
 * (Safari anterior a 16) o lanzar si el navegador no considera la llamada un
 * gesto del usuario. La primera versión de este componente respondía a eso
 * enfocando el campo escondido — y eso reproducía el bug original en la rama
 * menos transitada: el foco se iba a un elemento invisible, marcado
 * `aria-hidden`, sin contorno visible por el `opacity-0`. El usuario quedaba
 * parado en la nada, sin calendario y sin saber dónde estaba.
 *
 * Ahora el respaldo MUESTRA el campo: deja de estar oculto, gana nombre propio
 * y recibe el foco. No es tan cómodo como el calendario, pero se ve, se anuncia
 * y se puede escribir la fecha. Un camino degradado tiene que seguir siendo un
 * camino.
 */
import { useRef, useState, type ReactNode } from 'react'

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
  // Sólo se enciende si el calendario nativo no se pudo abrir. Mientras esté
  // apagado, el campo no existe para el ratón ni para un lector de pantalla.
  const [conRespaldo, setConRespaldo] = useState(false)

  const abrir = () => {
    const el = campo.current
    if (!el) return
    try {
      // `showPicker` existe desde Chrome 99, Firefox 101 y Safari 16.
      if (typeof el.showPicker === 'function') { el.showPicker(); return }
    } catch {
      // Puede lanzar si el navegador no considera esto un gesto del usuario.
    }
    // Se muestra ANTES de enfocar: enfocar algo invisible deja al usuario sin
    // referencia, que es justo lo que este componente vino a evitar.
    setConRespaldo(true)
    requestAnimationFrame(() => el.focus())
  }

  return (
    <div className="relative flex items-center gap-2">
      <button
        type="button"
        onClick={abrir}
        aria-label={etiqueta}
        aria-expanded={conRespaldo || undefined}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors hover:border-[var(--accent-line)] hover:bg-[var(--raised)]"
        style={{ background: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--text-2)' }}
      >
        {children}
      </button>
      <input
        ref={campo}
        type="date"
        // Con el respaldo apagado el campo está fuera del alcance de todos: ni
        // tabulación, ni lector de pantalla, ni ratón. Encendido, es un control
        // normal con su nombre.
        {...(conRespaldo
          ? { 'aria-label': etiqueta }
          : { tabIndex: -1, 'aria-hidden': true })}
        className={conRespaldo
          ? 'h-9 rounded-lg border px-2 text-[13px]'
          : 'pointer-events-none absolute bottom-0 left-0 h-0 w-0 opacity-0'}
        style={conRespaldo
          ? { background: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--text-1)' }
          : undefined}
        value={valor}
        min={min}
        max={max}
        onChange={e => { if (e.target.value) alElegir(e.target.value) }}
      />
    </div>
  )
}
