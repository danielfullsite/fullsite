'use client'

import { useEffect, type RefObject } from 'react'

/**
 * Atrapa el foco dentro del panel mientras el diálogo está abierto, y lo devuelve
 * al cerrar.
 *
 * Auditoría 2026-08-24: `focusTrap|tabbable|inert` → 0 coincidencias en todo `src/`.
 * `activeElement` → 0. O sea: con un modal abierto, Tab recorre el POS entero que
 * está detrás del backdrop, y al cerrar el foco cae a `<body>`.
 *
 * No es sólo accesibilidad. En la caja hay teclado físico: un cajero que tabula
 * dentro del modal de cobro hoy termina escribiendo en la búsqueda de platillos
 * que está atrás, sin darse cuenta.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * A propósito NO se usa `offsetParent` ni `getClientRects()` para decidir si un
 * elemento es enfocable. Dos razones: el panel del diálogo vive dentro de un
 * contenedor `position: fixed`, donde esas señales son poco fiables; y en jsdom
 * no hay layout, así que ambas devuelven vacío y el trap se quedaría sin nada
 * que enfocar. Se filtra por atributos y por estilo calculado, que sí es
 * determinista en los dos entornos.
 */
function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => {
    if (el.hasAttribute('disabled')) return false
    if (el.getAttribute('aria-hidden') === 'true') return false
    if (el.closest('[hidden]')) return false
    const cs = typeof window !== 'undefined' ? window.getComputedStyle(el) : null
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false
    return true
  })
}

/** Campos de captura, en el sentido de "dónde va a escribir la persona".
 *  Un `autoFocus` explícito gana sobre el orden del DOM. */
function firstField(root: HTMLElement): HTMLElement | null {
  const auto = root.querySelector<HTMLElement>('[autofocus]')
  if (auto && !auto.hasAttribute('disabled')) return auto
  const fields = focusables(root).filter(el =>
    ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName),
  )
  return fields[0] ?? null
}

export type InitialFocus = RefObject<HTMLElement | null> | 'first-input' | 'panel' | 'none'

export interface FocusTrapOptions {
  /** Dónde entra el foco al abrir. `'first-input'` respeta los 43 `autoFocus`
   *  que ya existen; `'panel'` es para los ~19 modales sin input, que hoy no
   *  enfocan nada. */
  initialFocus?: InitialFocus
  /** Devuelve el foco al elemento que abrió el diálogo. Si ese elemento ya no
   *  existe (la mesa se cerró, la fila se borró), cae al contenedor del POS o al
   *  body — nunca lanza. */
  returnFocus?: boolean | RefObject<HTMLElement | null>
}

export function useFocusTrap(
  active: boolean,
  panelRef: RefObject<HTMLElement | null>,
  { initialFocus = 'first-input', returnFocus = true }: FocusTrapOptions = {},
): void {
  useEffect(() => {
    if (!active) return
    const panel = panelRef.current
    if (!panel) return

    const opener = document.activeElement as HTMLElement | null
    // El ref se captura aquí, no en el cleanup: lo que interesa al cerrar es el
    // `.current` de ESTE ref, y capturarlo dentro del efecto lo deja explícito.
    const returnRef = typeof returnFocus === 'object' && returnFocus !== null ? returnFocus : null
    let cancelInitial: (() => void) | undefined

    // ── Foco de entrada ──────────────────────────────────────────────
    if (initialFocus !== 'none') {
      const target =
        typeof initialFocus === 'object' && initialFocus?.current
          ? initialFocus.current
          : initialFocus === 'panel'
            ? panel
            : // 'first-input': el primer campo capturable, NO el primer enfocable.
              // El botón de cerrar va antes en el DOM, y dejar el foco ahí al abrir
              // el modal de PIN obligaría al cajero a tabular para escribir.
              (firstField(panel) ?? focusables(panel)[0] ?? panel)

      // El panel necesita tabIndex para poder recibir foco programático.
      if (target === panel && !panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1')
      // rAF: el panel puede no estar medido todavía en el mismo tick del montaje.
      const raf = requestAnimationFrame(() => target?.focus?.())
      cancelInitial = () => cancelAnimationFrame(raf)
    }

    // ── Trap ─────────────────────────────────────────────────────────
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      const items = focusables(panel!)
      if (items.length === 0) {
        // Sin nada enfocable, el foco se queda en el panel.
        e.preventDefault()
        panel!.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const activeEl = document.activeElement as HTMLElement | null

      if (e.shiftKey) {
        if (activeEl === first || activeEl === panel || !panel!.contains(activeEl)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (activeEl === last || !panel!.contains(activeEl)) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      cancelInitial?.()

      if (returnFocus === false) return
      const candidate = returnRef?.current ?? opener
      // Si el disparador se desmontó, `isConnected` es false y no tiene caso.
      if (candidate && candidate.isConnected && typeof candidate.focus === 'function') {
        candidate.focus()
      } else {
        const kiosk = document.querySelector<HTMLElement>('.pos-kiosk')
        if (kiosk) {
          if (!kiosk.hasAttribute('tabindex')) kiosk.setAttribute('tabindex', '-1')
          kiosk.focus()
        }
        // Si no hay nada, el foco queda en body: aceptable y nunca lanza.
      }
    }
  }, [active, panelRef, initialFocus, returnFocus])
}

export { focusables as __focusablesForTests }
