'use client'

import { useCallback, useEffect, useId, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { LAYER, type Layer } from './layers'
import { useScrollLock } from './useScrollLock'
import { useFocusTrap, type InitialFocus } from './useFocusTrap'
import { isTopDialog, popDialog, pushDialog } from './dialogStack'

/**
 * Diálogo compartido.
 *
 * Reemplaza los 62 overlays sueltos que hoy son JSX inline en cada página. Lo que
 * arregla, con evidencia de la auditoría del 2026-08-24:
 *
 * | Hoy                              | Con <Dialog>                          |
 * |----------------------------------|---------------------------------------|
 * | 0 de 62 atrapan el foco          | trap siempre activo                   |
 * | 0 devuelven el foco al cerrar    | vuelve al disparador                  |
 * | 2 de 75 cierran con ESC          | ESC configurable, por contenedor      |
 * | 0 role="dialog" / aria-modal     | automáticos                           |
 * | 0 bloquean el scroll del body    | con refcount para anidados            |
 *
 * Lo que NO cambia: nada visual. Cada prop existe porque hay un modal real que la
 * necesita, y los defaults reproducen el comportamiento actual.
 *
 * ⚠️ `container` es la decisión delicada. En `/pos/*` el CSS de kiosko
 * (`globals.css:44-78`) usa selectores DESCENDIENTES: `.pos-kiosk button { min-height:48px }`,
 * `touch-action`, `user-select`. Portalear un modal del POS a `document.body` lo saca
 * de `.pos-kiosk` y los botones vuelven a su altura por defecto — sin error, sin
 * warning, sólo dedos que fallan. Por eso el default es `'inline'`.
 */

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | (string & {})

const SIZE_CLASS: Record<string, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
}

export interface DismissPolicy {
  esc?: boolean
  backdrop?: boolean
  closeButton?: boolean
}

export interface DialogProps {
  open: boolean
  /**
   * ÚNICA vía de cierre. ESC, backdrop y la X llaman EXACTAMENTE a este handler.
   *
   * Esto es lo que garantiza que el teardown corra por cualquier ruta. El caso que
   * lo motiva: el modal de cobro arranca un polling a Mercado Pago Point; si se
   * cierra por una vía que no limpia el intervalo, el `operationLock` queda trabado
   * y la caja "no cobra" — un síntoma que aparece horas después y no se parece en
   * nada a su causa. Nunca pasar `() => setOpen(false)` en un modal con efectos vivos.
   */
  onClose: () => void

  /** `false` o `{}` desactiva vías concretas. Cobro y conflicto offline usan
   *  `{ esc: false, backdrop: false }`. */
  dismissible?: boolean | DismissPolicy
  /** Guarda dinámica: si devuelve true, ninguna vía procede. Reproduce el
   *  `onClick={() => !saving && close()}` que hoy está a mano en varias páginas. */
  preventCloseWhile?: () => boolean

  title?: ReactNode
  subtitle?: ReactNode
  headerIcon?: ReactNode
  headerVariant?: 'plain' | 'accent' | 'danger' | 'none'
  headerClassName?: string
  closeButton?: 'lucide' | 'times' | 'none'
  closeButtonSize?: 'sm' | 'md' | 'touch'
  /** Obligatorio si no hay `title`. Sin nombre accesible el diálogo es un div anónimo. */
  ariaLabel?: string
  role?: 'dialog' | 'alertdialog'

  size?: DialogSize
  height?: 'auto' | 'full' | (string & {})
  /** `'scroll-panel'`: el panel entero scrollea (patrón dominante del dashboard).
   *  `'flex-column'`: header y footer fijos, cuerpo scrollea (ModifierModal). */
  layout?: 'scroll-panel' | 'flex-column'
  /** Aplica `.pos-fat-scroll` al cuerpo: barra de 44px, para el dedo. */
  fatScroll?: boolean
  panelClassName?: string
  bodyClassName?: string

  layer?: Layer
  backdrop?: 'dim' | 'dim-blur' | 'strong' | 'none'

  /** `'inline'` (default) mantiene el panel donde está en el árbol — obligatorio
   *  en `/pos/*`. `'portal'` monta en `document.body`; sólo dashboard. */
  container?: 'inline' | 'portal'

  initialFocus?: InitialFocus
  returnFocus?: boolean | RefObject<HTMLElement | null>
  scrollLock?: boolean | 'compensate'

  footer?: ReactNode
  children: ReactNode
  'data-testid'?: string
}

const BACKDROP_CLASS: Record<string, string> = {
  dim: 'bg-black/60',
  'dim-blur': 'bg-black/60 backdrop-blur-sm',
  strong: 'bg-black/75',
  none: '',
}

const CLOSE_SIZE: Record<string, string> = {
  sm: 'w-7 h-7',
  md: 'w-9 h-9',
  touch: 'w-11 h-11',
}

function resolvePolicy(d: DialogProps['dismissible']): Required<DismissPolicy> {
  if (d === false) return { esc: false, backdrop: false, closeButton: false }
  if (d === true || d === undefined) return { esc: true, backdrop: true, closeButton: true }
  return { esc: d.esc ?? true, backdrop: d.backdrop ?? true, closeButton: d.closeButton ?? true }
}

export function Dialog({
  open,
  onClose,
  dismissible,
  preventCloseWhile,
  title,
  subtitle,
  headerIcon,
  headerVariant = 'plain',
  headerClassName = '',
  closeButton = 'lucide',
  closeButtonSize = 'md',
  ariaLabel,
  role = 'dialog',
  size = 'lg',
  height = 'auto',
  layout = 'scroll-panel',
  fatScroll = false,
  panelClassName = '',
  bodyClassName = '',
  layer = 'dialog',
  backdrop = 'dim',
  container = 'inline',
  initialFocus = 'first-input',
  returnFocus = true,
  scrollLock = true,
  footer,
  children,
  'data-testid': testId,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const policy = resolvePolicy(dismissible)

  if (process.env.NODE_ENV !== 'production' && open && !title && !ariaLabel) {
    console.error(
      '[Dialog] Sin `title` ni `ariaLabel`: el diálogo no tiene nombre accesible. ' +
        'Un lector de pantalla lo anuncia como un div vacío.',
    )
  }

  /** Puerta única: todas las vías de cierre pasan por aquí. */
  const requestClose = useCallback(() => {
    if (preventCloseWhile?.()) return
    onClose()
  }, [onClose, preventCloseWhile])

  // Identidad estable para la pila. Sin esto, dos diálogos apilados se pelean:
  // un ESC cerraba los dos, y los focus traps se robaban el foco entre sí.
  const stackId = useMemo(() => Symbol('dialog'), [])
  useEffect(() => {
    if (!open) return
    pushDialog(stackId)
    return () => popDialog(stackId)
  }, [open, stackId])

  // Se pasa el panel para que su scroll interno NO se bloquee junto con el fondo.
  useScrollLock(open, scrollLock, panelRef)
  // Sólo el diálogo de hasta arriba atrapa el foco.
  useFocusTrap(open, panelRef, { initialFocus, returnFocus, isActive: () => isTopDialog(stackId) })

  // ESC a nivel de documento. Hoy sólo 2 de 75 overlays cierran con ESC, y uno de
  // ellos sólo si el foco está dentro del input.
  useEffect(() => {
    if (!open || !policy.esc) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      // Sólo responde el de hasta arriba. `stopPropagation` no bastaba: no detiene
      // a los otros listeners registrados en el MISMO nodo (document), así que
      // una confirmación sobre el cobro cerraba las dos de un solo ESC.
      if (!isTopDialog(stackId)) return
      e.stopPropagation()
      requestClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, policy.esc, requestClose, stackId])

  if (!open) return null

  const sizeClass = SIZE_CLASS[size as string] ?? size
  const heightClass = height === 'auto' ? '' : height === 'full' ? 'h-[calc(100vh-2rem)]' : height
  const isFlex = layout === 'flex-column'
  // El tope de 85vh sólo se aplica cuando NO se pidió una altura explícita. Antes
  // se emitían juntos y `max-h-[85vh]` ganaba, así que `height="full"` no hacía
  // nada con el layout por defecto — sin ningún aviso.
  const capHeight = height === 'auto'

  const headerTone =
    headerVariant === 'accent'
      ? 'bg-[var(--accent-soft)] border-b border-[var(--accent-line)]'
      : headerVariant === 'danger'
        ? 'bg-[var(--crit-soft)] border-b border-[var(--crit)]/40'
        : headerVariant === 'none'
          ? ''
          : 'border-b border-[var(--line)]'

  const node = (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: LAYER[layer] }}
      data-testid={testId}
    >
      {/* Backdrop hermano: es el patrón que ya usan los 5 modales nombrados del POS,
          y evita depender de stopPropagation en el panel. */}
      <div
        className={`absolute inset-0 ${BACKDROP_CLASS[backdrop] ?? BACKDROP_CLASS.dim}`}
        onClick={policy.backdrop ? requestClose : undefined}
        data-testid="dialog-backdrop"
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? ariaLabel : undefined}
        className={[
          'relative w-full bg-[var(--panel)] border border-[var(--line)]',
          'rounded-2xl shadow-[var(--shadow-pop,0_20px_40px_-4px_rgba(0,0,0,.45))]',
          sizeClass,
          heightClass,
          isFlex
            ? 'flex flex-col overflow-hidden'
            : `${capHeight ? 'max-h-[85vh]' : ''} overflow-y-auto`,
          panelClassName,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {(title || subtitle || headerIcon || (closeButton !== 'none' && policy.closeButton)) && (
          <div
            className={[
              'flex items-start gap-3 px-5 py-4',
              headerTone,
              isFlex ? 'flex-none' : '',
              headerClassName,
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {headerIcon && <div className="flex-none mt-0.5">{headerIcon}</div>}
            <div className="min-w-0 flex-1">
              {title && (
                <h2 id={titleId} className="text-base font-bold text-[var(--text-1)] leading-snug">
                  {title}
                </h2>
              )}
              {subtitle && <p className="text-sm text-[var(--text-3)] mt-0.5">{subtitle}</p>}
            </div>
            {closeButton !== 'none' && policy.closeButton && (
              <button
                type="button"
                onClick={requestClose}
                aria-label="Cerrar"
                data-testid="dialog-close"
                className={`flex-none grid place-items-center rounded-lg text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] ${CLOSE_SIZE[closeButtonSize]}`}
              >
                {closeButton === 'times' ? (
                  <span aria-hidden="true" className="text-xl leading-none">
                    &times;
                  </span>
                ) : (
                  <X size={closeButtonSize === 'touch' ? 20 : 18} aria-hidden="true" />
                )}
              </button>
            )}
          </div>
        )}

        <div
          className={[
            'px-5 py-4',
            isFlex ? 'flex-1 overflow-y-auto min-h-0' : '',
            fatScroll ? 'pos-fat-scroll' : '',
            bodyClassName,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {children}
        </div>

        {footer && (
          <div
            className={`px-5 py-4 border-t border-[var(--line)] bg-[var(--surface-2)] ${isFlex ? 'flex-none' : ''}`}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )

  if (container === 'portal' && typeof document !== 'undefined') {
    return createPortal(node, document.body)
  }
  return node
}
