// Operational reads belong to Caja. Kitchen and debt are separate projections
// of the same order (ADR-005); an unreadable reply never means "free".
import { getBridgeUrl } from './bridge-url'
import { localNetworkFetch } from './local-network-fetch'
import { recordarAutoridad } from './modo-autoridad'

const TIMEOUT_MS = 1_500
export type ProcedenciaDelSalon = 'caja' | 'local-degradado' | 'sin-pedro'
export interface LecturaDelSalon {
  procedencia: ProcedenciaDelSalon
  autoritativa: boolean
  completa?: boolean
  writeAuthority?: 'caja' | 'legacy'
  sequence: number | null
  ordenes: Record<string, unknown>[]
  turno: Record<string, unknown> | null
  motivo?: string
}
const SIN_PEDRO: LecturaDelSalon = {
  procedencia: 'sin-pedro', autoritativa: false, completa: false, sequence: null, ordenes: [], turno: null,
}

/** Local terminals must not silently switch authority to cloud. */
export function requiereCaja(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string' && navigator.userAgent.includes('Electron')) return true
  try {
    return !!(localStorage.getItem('FULLSITE_BRIDGE_URL') || localStorage.getItem('FULLSITE_LAN_SECRET') || localStorage.getItem('pos_bridge_host'))
  } catch { return true }
}

function ocupacionLegacy(cuerpo: Record<string, unknown>): Record<string, unknown>[] {
  const porId = new Map<string, Record<string, unknown>>()
  for (const o of (Array.isArray(cuerpo.kds_orders) ? cuerpo.kds_orders : [])) {
    const id = String(o?.id ?? o?.order_id ?? '')
    if (id) porId.set(id, o)
  }
  const mesas = cuerpo.mesas && typeof cuerpo.mesas === 'object' ? cuerpo.mesas : {}
  for (const [mesa, entrada] of Object.entries(mesas as Record<string, { status?: string; order_id?: string }>)) {
    const id = String(entrada?.order_id ?? '')
    if (id && !porId.has(id) && entrada.status !== 'libre') {
      porId.set(id, { id, mesa: Number(mesa), status: 'ocupada' })
    }
  }
  return [...porId.values()]
}

export async function leerSalon(): Promise<LecturaDelSalon> {
  try {
    const res = await localNetworkFetch(`${getBridgeUrl()}/state`, {
      cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return { ...SIN_PEDRO, motivo: `HTTP ${res.status}` }
    const cuerpo = await res.json()
    if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return { ...SIN_PEDRO, motivo: 'respuesta ilegible' }
    const autoritativa = cuerpo.authoritative === true
    const completa = Array.isArray(cuerpo.salon_orders) && cuerpo.order_snapshot_complete === true
    const ordenes = Array.isArray(cuerpo.salon_orders) ? cuerpo.salon_orders : ocupacionLegacy(cuerpo)
    if (ordenes.some((o: unknown) => !o || typeof o !== 'object' || Array.isArray(o))) {
      return { ...SIN_PEDRO, motivo: 'respuesta de órdenes ilegible' }
    }
    // Se recuerda para que la pantalla de acceso sepa si esta instalación exige
    // un permiso firmado por Caja, sin tener que esperar su propia lectura.
    recordarAutoridad(cuerpo.write_authority)
    return {
      procedencia: autoritativa ? 'caja' : 'local-degradado', autoritativa, completa,
      writeAuthority: cuerpo.write_authority === 'caja' ? 'caja' : 'legacy',
      sequence: typeof cuerpo.sequence === 'number' ? cuerpo.sequence : null,
      ordenes, turno: cuerpo.turno ?? null,
      motivo: !autoritativa ? String(cuerpo.source ?? 'la caja no contestó')
        : !completa ? 'La caja todavía no confirmó todas las cuentas' : undefined,
    }
  } catch (e) {
    return { ...SIN_PEDRO, motivo: e instanceof Error ? e.message : String(e) }
  }
}

export interface LecturaDeEventos { eventos: Record<string, unknown>[]; determinado: boolean; motivo?: string }
export async function leerEventosDesde(cursor: number): Promise<LecturaDeEventos> {
  const desde = Number.isInteger(cursor) && cursor >= 0 ? cursor : 0
  try {
    const res = await localNetworkFetch(`${getBridgeUrl()}/events?since=${desde}`, {
      cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return { eventos: [], determinado: false, motivo: `HTTP ${res.status}` }
    const cuerpo = await res.json()
    if (!Array.isArray(cuerpo?.events)) return { eventos: [], determinado: false, motivo: 'respuesta ilegible' }
    return { eventos: cuerpo.events, determinado: true }
  } catch (e) { return { eventos: [], determinado: false, motivo: String(e) } }
}

export type SeleccionDeCuenta = { orderId?: string | null; mesa?: number; customerName?: string }
export type LecturaDeCuenta = {
  lectura: LecturaDelSalon
  estado: 'existente' | 'libre' | 'cerrada' | 'incierta'
  orden: Record<string, unknown> | null
  motivo?: string
}

/** Identity first. Empty items are valid; missing/corrupt items are not. A new
 * order on the same table can never replace the account open in the editor. */
export function seleccionarCuenta(lectura: LecturaDelSalon, seleccion: SeleccionDeCuenta): LecturaDeCuenta {
  const incierta = (motivo: string): LecturaDeCuenta => ({ lectura, estado: 'incierta', orden: null, motivo })
  if (!lectura.autoritativa) return incierta('Sin conexión con la caja — sólo borradores pendientes')
  const matches = lectura.ordenes.filter(o => seleccion.orderId
    ? String(o.id ?? o.order_id) === seleccion.orderId
    : seleccion.customerName ? o.customer_name === seleccion.customerName && !Number(o.mesa)
      : Number(o.mesa) === seleccion.mesa)
  if (matches.length > 1) return incierta('La caja reporta varias cuentas para esta mesa — revisa en Caja')
  const orden = matches[0]
  if (!orden) {
    if (!lectura.completa) return incierta('La caja todavía no confirmó todas las cuentas')
    return { lectura, estado: seleccion.orderId ? 'cerrada' : 'libre', orden: null }
  }
  let items = orden.items
  if (typeof items === 'string') { try { items = JSON.parse(items) } catch { return incierta('No se pudieron leer los platillos de esta cuenta') } }
  if (!Array.isArray(items) || items.some(i => !i || typeof i !== 'object' || typeof i.id !== 'string')) {
    return incierta('La caja no tiene el detalle completo de esta cuenta')
  }
  return { lectura, estado: 'existente', orden: { ...orden, id: String(orden.id ?? orden.order_id), items } }
}
export async function leerCuenta(seleccion: SeleccionDeCuenta): Promise<LecturaDeCuenta> {
  return seleccionarCuenta(await leerSalon(), seleccion)
}
export async function leerOrdenDeMesa(mesa: number): Promise<LecturaDeCuenta> { return leerCuenta({ mesa }) }

/** UI preflight, not a replacement for server OCC. A real revision is required. */
export function cuentaConfirmada(lectura: LecturaDeCuenta): boolean {
  const o = lectura.orden
  return lectura.estado === 'existente' && Number.isInteger(o?.order_revision) && Number(o?.order_revision) >= 0 &&
    o?.total != null && Number.isFinite(Number(o.total)) && Number(o.total) >= 0 &&
    o?.saldo != null && Number.isFinite(Number(o.saldo)) && Number(o.saldo) >= 0
}

export interface OrdenDelSalon {
  id: string; mesa: number | null; customer_name: string | null; mesero: string | null
  personas: number; status: string | null; total: number; saldo: number | null
  order_revision: number | null; order_number: number | null; created_at: string | null
}
export function aOrdenesDelSalon(crudas: Record<string, unknown>[]): OrdenDelSalon[] {
  return crudas.filter(o => o && (o.id || o.order_id)).map(o => ({
    id: String(o.id ?? o.order_id),
    mesa: o.mesa != null && Number.isFinite(Number(o.mesa)) ? Number(o.mesa) : null,
    customer_name: typeof o.customer_name === 'string' ? o.customer_name : null,
    mesero: typeof o.mesero === 'string' ? o.mesero : null,
    personas: Number.isFinite(Number(o.personas)) ? Number(o.personas) : 0,
    status: typeof o.status === 'string' ? o.status : null,
    total: Number.isFinite(Number(o.total)) ? Number(o.total) : 0,
    saldo: o.saldo != null && Number.isFinite(Number(o.saldo)) ? Number(o.saldo) : null,
    order_number: typeof o.order_number === 'number' && Number.isSafeInteger(o.order_number) && o.order_number > 0 ? o.order_number : null,
    order_revision: Number.isInteger(o.order_revision) ? Number(o.order_revision) : null,
    created_at: typeof o.created_at === 'string' ? o.created_at
      : typeof o.ts === 'number' ? new Date(o.ts).toISOString() : null,
  }))
}
export function debeUsarPedro(lectura: LecturaDelSalon): boolean { return lectura.autoritativa }
export function avisoDeProcedencia(lectura: LecturaDelSalon): string | null {
  if (lectura.autoritativa) return lectura.completa === false ? 'La caja todavía no confirmó todas las cuentas' : null
  if (lectura.procedencia === 'local-degradado' || requiereCaja()) {
    return 'Sin conexión con la caja — puede que no veas mesas de otras terminales; sólo borradores pendientes'
  }
  return null
}
