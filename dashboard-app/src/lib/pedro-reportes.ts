import { getBridgeUrl } from './bridge-url'
import { localNetworkFetch } from './local-network-fetch'
import { construirCorteCaja, ReporteCajaNoDisponible } from './caja-reportes'
import { type SesionDeCaja } from './pedro-actor'
import { getPermissions } from './pos-permissions'

/** Explicit Caja read: no network/cloud/IndexedDB fallback and no mutation.
 * Access is obtained by PIN from Caja, kept only in the mounted report. */
export async function leerCorteCaja(session: SesionDeCaja, turnoId?: string) {
  if (!session?.actor_token || session.expires_at <= Date.now() || !getPermissions(session.staff.role).gerente) throw new ReporteCajaNoDisponible('Ingresa el PIN de gerente en Caja para consultar el corte.')
  try {
    const response = await localNetworkFetch(`${getBridgeUrl()}/state`, { cache: 'no-store', headers: { 'x-fullsite-actor': session.actor_token }, signal: AbortSignal.timeout(2000) })
    if (!response.ok) throw new ReporteCajaNoDisponible('Caja no pudo confirmar el reporte. Vuelve a consultar.')
    return construirCorteCaja(await response.json(), turnoId)
  } catch (error) {
    if (error instanceof ReporteCajaNoDisponible) throw error
    throw new ReporteCajaNoDisponible('Sin conexión confirmada con Caja. El corte no está disponible.')
  }
}
