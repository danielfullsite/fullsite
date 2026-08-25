'use client'

import { useEffect } from 'react'

/**
 * Bloquea el scroll del <body> mientras hay al menos un diálogo abierto.
 *
 * Hoy NINGUNO de los 75 overlays bloquea el scroll (auditoría 2026-08-24). El
 * síntoma en campo: con el modal de cobro abierto, rodar la rueda fuera del panel
 * mueve la lista de platillos que está atrás. En tablet, con el momentum del dedo,
 * el fondo se va solo.
 *
 * Dos cuidados que se ven simples y no lo son:
 *
 * 1. **Refcount.** Con dos diálogos anidados (una confirmación sobre el cobro),
 *    cerrar el de arriba no debe desbloquear el scroll. Sólo el último suelta.
 *
 * 2. **Restaurar el valor PREVIO, no vaciarlo.** `globals.css:70` dice explícito
 *    que las subpáginas `/pos/*` sí scrollean. Si al cerrar pusiéramos
 *    `overflow = ''` estaríamos borrando lo que la página hubiera puesto a
 *    propósito. Guardamos lo que había y lo devolvemos tal cual.
 */

let locks = 0
let previousOverflow: string | null = null
let previousPaddingRight: string | null = null

/** Ancho de la barra de scroll, para que el layout no salte al bloquear. */
function scrollbarWidth(): number {
  if (typeof window === 'undefined') return 0
  return window.innerWidth - document.documentElement.clientWidth
}

function acquire(compensate: boolean): void {
  if (typeof document === 'undefined') return
  locks += 1
  if (locks > 1) return // ya estaba bloqueado por un diálogo de abajo

  const body = document.body
  previousOverflow = body.style.overflow
  previousPaddingRight = body.style.paddingRight

  body.style.overflow = 'hidden'

  if (compensate) {
    const gap = scrollbarWidth()
    if (gap > 0) {
      const current = parseFloat(window.getComputedStyle(body).paddingRight) || 0
      body.style.paddingRight = `${current + gap}px`
    }
  }
}

function release(): void {
  if (typeof document === 'undefined') return
  locks = Math.max(0, locks - 1)
  if (locks > 0) return // todavía hay un diálogo abierto

  const body = document.body
  body.style.overflow = previousOverflow ?? ''
  body.style.paddingRight = previousPaddingRight ?? ''
  previousOverflow = null
  previousPaddingRight = null
}

/**
 * @param active   si el diálogo está abierto
 * @param mode     `true` bloquea; `'compensate'` además compensa la barra de scroll
 *                 (sólo dashboard — en POS la barra mide 14–44px y el layout saltaría);
 *                 `false` no toca el body (bottom sheet del menú del comensal).
 */
export function useScrollLock(active: boolean, mode: boolean | 'compensate' = true): void {
  useEffect(() => {
    if (!active || mode === false) return
    acquire(mode === 'compensate')
    return release
  }, [active, mode])
}

/** Sólo para pruebas: deja el contador y el body como estaban. */
export function __resetScrollLockForTests(): void {
  locks = 0
  previousOverflow = null
  previousPaddingRight = null
  if (typeof document !== 'undefined') {
    document.body.style.overflow = ''
    document.body.style.paddingRight = ''
  }
}

/** Sólo para pruebas y aserciones internas. */
export function __scrollLockCount(): number {
  return locks
}
