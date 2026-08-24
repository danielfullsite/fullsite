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
  location.replace(POS_MESA_MAP_PATH)
}
