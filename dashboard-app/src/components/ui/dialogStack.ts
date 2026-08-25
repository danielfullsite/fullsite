'use client'

/**
 * Pila de diálogos abiertos.
 *
 * Nace de dos defectos que encontró la revisión adversarial del 2026-08-25, y que
 * tienen la misma causa: cada diálogo registraba sus listeners en `document` por su
 * cuenta, sin saber que había otro encima.
 *
 * 1. **ESC cerraba los dos.** `e.stopPropagation()` no detiene a los demás
 *    listeners del MISMO nodo — para eso hace falta `stopImmediatePropagation`, y
 *    aun así el orden de registro decidiría quién gana. Con una confirmación
 *    encima del cobro, un solo ESC cerraba las dos.
 *
 * 2. **Los focus traps se peleaban.** Ambos corrían en cada Tab y ganaba el que se
 *    hubiera registrado al último, así que el foco podía aterrizar en un input del
 *    diálogo de abajo — disparando su `onFocus` a espaldas del cajero. Funcionaba
 *    por orden de montaje: reordenar el JSX lo invertía.
 *
 * La regla ahora es explícita: **sólo el diálogo que está hasta arriba responde**.
 */

let stack: symbol[] = []

export function pushDialog(id: symbol): void {
  stack.push(id)
}

export function popDialog(id: symbol): void {
  stack = stack.filter(x => x !== id)
}

/** true sólo para el diálogo que está hasta arriba de la pila. */
export function isTopDialog(id: symbol): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id
}

export function __dialogStackDepth(): number {
  return stack.length
}

export function __resetDialogStackForTests(): void {
  stack = []
}
