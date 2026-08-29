import { counterHomePath, isCounterModel, peekServiceModel } from './pos-service-model'

export const POS_MESA_MAP_PATH = '/pos/mesas'

/**
 * Leave an order through a full document navigation.
 *
 * The deployed POS has field evidence that client-side App Router navigation can
 * resolve the cached `/pos` shell without the intended route/query while offline,
 * which falls back to mesa 1. `replace` also removes the current table from the
 * browser history, so Back cannot reopen it accidentally.
 */
export function navigateToMesaMap(
  location: Pick<Location, 'replace'> = window.location,
): void {
  // Tenants de mostrador (fast food / dark kitchen) no tienen mapa de mesas:
  // al salir de una orden se abre la siguiente orden de mostrador. peek es
  // síncrono y sin red (ver pos-service-model.ts); su default 'tables' deja
  // este flujo exactamente como siempre para todos los demás tenants.
  const model = peekServiceModel()
  if (isCounterModel(model)) {
    location.replace(counterHomePath(model))
    return
  }
  location.replace(POS_MESA_MAP_PATH)
}

/**
 * Where the table map parks the table the user just tapped.
 *
 * Offline the query string is not a reliable channel in either direction:
 * a hard `location.href` reload depends on the Service Worker serving `/pos`
 * and re-runs the auth gate (the table never opens at all), while a client-side
 * `router.push` can resolve the cached `/pos` shell without the query and fall
 * back to mesa 1. Both failures were seen in the field on 2026-08-23.
 *
 * sessionStorage survives both paths, is per-tab, and needs no network, so the
 * intent travels next to the URL instead of inside it.
 */
export const POS_TARGET_MESA_KEY = 'pos_target_mesa'

type WritableStorage = Pick<Storage, 'setItem'>
type ReadableStorage = Pick<Storage, 'getItem'>
type ClearableStorage = Pick<Storage, 'removeItem'>

function session(): Storage | undefined {
  if (typeof window === 'undefined') return undefined
  try { return window.sessionStorage } catch { return undefined }
}

/** Park the table the user tapped, right before navigating to `/pos`. */
export function setMesaTarget(mesaNum: number, storage?: WritableStorage): void {
  if (!Number.isInteger(mesaNum) || mesaNum <= 0) return
  try { (storage ?? session())?.setItem(POS_TARGET_MESA_KEY, String(mesaNum)) } catch { /* private mode */ }
}

/** Read the parked table without consuming it (safe to call during render). */
export function peekMesaTarget(storage?: ReadableStorage): number {
  try {
    const n = Number((storage ?? session())?.getItem(POS_TARGET_MESA_KEY))
    return Number.isInteger(n) && n > 0 ? n : 0
  } catch { return 0 }
}

/** Drop the parked table once `/pos` has opened it. */
export function clearMesaTarget(storage?: ClearableStorage): void {
  try { (storage ?? session())?.removeItem(POS_TARGET_MESA_KEY) } catch { /* private mode */ }
}

/**
 * Which table `/pos` should open: the URL wins when it survived, the parked
 * target covers the offline case, and only a genuinely intentless visit to
 * `/pos` falls back to mesa 1 (unchanged behaviour for direct access).
 */
export function resolveMesa(queryMesa: string | null, storage?: ReadableStorage): number {
  const fromQuery = Number(queryMesa)
  if (Number.isInteger(fromQuery) && fromQuery > 0) return fromQuery
  return peekMesaTarget(storage) || 1
}
