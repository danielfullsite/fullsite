/**
 * Escala única de apilamiento.
 *
 * Nace de una auditoría del 2026-08-24: había 30 literales `z-[...]` repartidos por
 * el código y los toasts vivían en `z-[60]`, o sea DEBAJO del ErrorBoundary (100),
 * del modal bloqueante de conflicto offline (120) y del prompt de PIN (200). Un
 * toast que nadie puede ver es peor que no tener toast.
 *
 * Regla: en `components/ui/` está prohibido escribir un z-index literal. Si hace
 * falta una capa nueva, se agrega aquí y se justifica.
 */
export const LAYER = {
  /** Encabezado pegajoso de tabla — por encima de las celdas, muy por debajo
   *  de cualquier capa flotante. */
  stickyHeader: 5,
  /** Backdrop del sidebar móvil. */
  sidebarBackdrop: 30,
  /** Drawer de navegación (POS y demo). */
  drawer: 40,
  /** Diálogo normal. */
  dialog: 50,
  /** Segundo nivel: una confirmación encima de un cobro abierto. */
  dialogNested: 70,
  /** Fallback del ErrorBoundary — tiene que tapar cualquier cosa. */
  errorBoundary: 100,
  /** Conflicto offline: el cajero DEBE decidir, no puede quedar tapado. */
  blocking: 120,
  /** Reemplazo de window.prompt en Electron/kiosk. */
  prompt: 200,
  /** Banner fijo superior (Mercado Pago). */
  banner: 210,
  /** Arriba de todo, siempre. Un aviso invisible no es un aviso. */
  toast: 300,
} as const

export type Layer = keyof typeof LAYER

/** Valor numérico de una capa, para pasarlo a `style={{ zIndex }}`. */
export function layerZ(layer: Layer): number {
  return LAYER[layer]
}
