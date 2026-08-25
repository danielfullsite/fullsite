'use client'

import { useEffect, type RefObject } from 'react'

/**
 * Congela el scroll de fondo mientras hay un diálogo abierto.
 *
 * El síntoma que lo motiva: con el modal de cobro abierto, rodar la rueda fuera del
 * panel mueve la lista de platillos que está atrás; en tablet, con el momentum del
 * dedo, el fondo se va solo.
 *
 * ⚠️ La versión ingenua de esto —poner `overflow:hidden` en `<body>`— **no arregla
 * el POS**, y esa fue la primera versión de este archivo. En `/pos/*` el body nunca
 * scrollea: la raíz es `.pos-kiosk h-dvh flex flex-col overflow-hidden`
 * (`pos/page.tsx:3600`) y los scrollers de verdad son divs internos con
 * `overflow-y-auto`. `globals.css:76` lo dice explícito: *"Sin overflow:hidden —
 * subpáginas /pos/* sí scrollean"*.
 *
 * Por eso aquí se bloquean DOS cosas: el `<body>` (que es el scroller del
 * dashboard) y todo contenedor con scroll vertical propio que quede por detrás del
 * panel. Se excluye el subárbol del panel para que el diálogo sí pueda scrollear
 * por dentro.
 *
 * Dos cuidados que parecen simples y no lo son:
 *
 * 1. **Refcount.** Con dos diálogos anidados, cerrar el de arriba no debe soltar el
 *    scroll. Sólo el último suelta.
 * 2. **Restaurar el valor PREVIO, no vaciarlo.** Se guarda lo que cada elemento
 *    tenía y se le devuelve tal cual.
 */

interface Saved {
  el: HTMLElement
  overflow: string
  paddingRight: string
}

let locks = 0
let saved: Saved[] = []

function scrollbarWidth(): number {
  if (typeof window === 'undefined') return 0
  return window.innerWidth - document.documentElement.clientWidth
}

/** Contenedores con scroll vertical propio, excluyendo el subárbol del panel. */
function backgroundScrollers(exclude: HTMLElement | null): HTMLElement[] {
  if (typeof document === 'undefined') return []
  const out: HTMLElement[] = []
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
    if (exclude && (exclude === el || exclude.contains(el) || el.contains(exclude))) continue
    const cs = window.getComputedStyle(el)
    const oy = cs.overflowY
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) out.push(el)
  }
  return out
}

function acquire(compensate: boolean, panel: HTMLElement | null): void {
  if (typeof document === 'undefined') return
  locks += 1
  if (locks > 1) return

  const body = document.body
  const targets: HTMLElement[] = [body, ...backgroundScrollers(panel)]

  saved = targets.map(el => ({
    el,
    overflow: el.style.overflow,
    paddingRight: el.style.paddingRight,
  }))

  for (const el of targets) el.style.overflow = 'hidden'

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
  if (locks > 0) return

  for (const s of saved) {
    s.el.style.overflow = s.overflow
    s.el.style.paddingRight = s.paddingRight
  }
  saved = []
}

/**
 * @param active    si el diálogo está abierto
 * @param mode      `true` bloquea; `'compensate'` además compensa la barra de
 *                  scroll (sólo dashboard — en POS la barra mide 14–44px y el
 *                  layout saltaría); `false` no toca nada.
 * @param panelRef  el panel del diálogo, para NO bloquear su scroll interno.
 */
export function useScrollLock(
  active: boolean,
  mode: boolean | 'compensate' = true,
  panelRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!active || mode === false) return
    acquire(mode === 'compensate', panelRef?.current ?? null)
    return release
  }, [active, mode, panelRef])
}

/** Sólo para pruebas: deja el contador y los estilos como estaban. */
export function __resetScrollLockForTests(): void {
  for (const s of saved) {
    s.el.style.overflow = s.overflow
    s.el.style.paddingRight = s.paddingRight
  }
  saved = []
  locks = 0
  if (typeof document !== 'undefined') {
    document.body.style.overflow = ''
    document.body.style.paddingRight = ''
  }
}

export function __scrollLockCount(): number {
  return locks
}
