// El POS le pregunta a Pedro. Un solo cliente, una sola verdad.
//
// ── POR QUÉ EXISTE ───────────────────────────────────────────────────────────
//
// El reenvío de lectura hacia la caja se construyó, se probó… y NADIE lo usaba.
// El mapa de mesas seguía sondeando Supabase cada 3 s, así que sin internet cada
// terminal se quedaba con lo suyo: tres cajas, tres versiones del salón. Es el
// reporte de campo del 2026-09-02 (Eduardo Esquivel, AMALAY).
//
// Éste es el consumidor que faltaba.
//
// ── POR QUÉ HTTP Y NO WEBSOCKET ──────────────────────────────────────────────
//
// Las dos rutas que la caja ya sabe contestar son `GET /state` (el salón) y
// `GET /events?since=N` (ponerse al día). Consumirlas por HTTP evita el muro de
// contenido mixto: la página del POS es `https` y el hub es `ws://`, que sólo
// funciona en Electron porque `main.js` parchea el CSP. Por HTTP contra
// `127.0.0.1` funciona en los dos, y es exactamente lo que H3 pedía consumir.
//
// El WebSocket sigue siendo el camino del KDS; esto no lo toca.
//
// ── LA REGLA QUE EVITA DOS VERDADES ──────────────────────────────────────────
//
// Este cliente NO mantiene un estado paralelo al de Supabase. Devuelve una
// lectura con su procedencia, y quien la consume decide con UNA regla:
//
//   autoritativa → se usa, y se ignora lo de la nube
//   degradada    → se avisa al operador y se sigue con lo que haya
//   sin Pedro    → se cae al camino de antes, sin cambiar nada
//
// Sin esa distinción volveríamos al bug de la semana: un dato que no se pudo
// confirmar, tratado como un hecho.

import { getBridgeUrl } from './bridge-url'
import { localNetworkFetch } from './local-network-fetch'

/** Pedro está en la misma máquina o en la LAN. Más de esto es que no contesta. */
const TIMEOUT_MS = 1_500

export type ProcedenciaDelSalon = 'caja' | 'local-degradado' | 'sin-pedro'

export interface LecturaDelSalon {
  /** De dónde salió el dato. Nunca se omite: es lo que impide confundir una
   *  lectura degradada con la verdad del restaurante. */
  procedencia: ProcedenciaDelSalon
  /** true SÓLO cuando la caja contestó. */
  autoritativa: boolean
  /** Cursor del servidor. Para pedir después sólo lo que falte. */
  sequence: number | null
  /** Órdenes vivas según Pedro. Vacío no significa "no hay": mira `procedencia`. */
  ordenes: Record<string, unknown>[]
  /** Turno abierto, si Pedro lo conoce. */
  turno: Record<string, unknown> | null
  /** Por qué falló, cuando falló. Para el operador, no para el log. */
  motivo?: string
}

const SIN_PEDRO: LecturaDelSalon = {
  procedencia: 'sin-pedro', autoritativa: false, sequence: null, ordenes: [], turno: null,
}

/**
 * El salón, preguntándole a Pedro.
 *
 * NUNCA lanza: el mapa de mesas no puede quedarse en blanco porque el servidor
 * local no conteste. Devuelve `sin-pedro` y quien llama sigue con su camino.
 */
export async function leerSalon(): Promise<LecturaDelSalon> {
  let res: Response
  try {
    res = await localNetworkFetch(`${getBridgeUrl()}/state`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    return { ...SIN_PEDRO, motivo: e instanceof Error ? e.message : String(e) }
  }
  if (!res.ok) return { ...SIN_PEDRO, motivo: `HTTP ${res.status}` }

  let cuerpo: Record<string, unknown>
  try {
    cuerpo = await res.json()
  } catch {
    return { ...SIN_PEDRO, motivo: 'respuesta ilegible' }
  }

  // `authoritative` viaja en el CUERPO a propósito. La cabecera equivalente
  // (`X-Fullsite-Origen`) existe, pero `fetch` no puede leer una cabecera
  // cross-origin salvo que el servidor la exponga — y un consumidor puede no
  // mirarla nunca. El cuerpo obliga a decidir.
  const autoritativa = cuerpo.authoritative === true
  const ordenes = Array.isArray(cuerpo.kds_orders)
    ? (cuerpo.kds_orders as Record<string, unknown>[])
    : []

  return {
    procedencia: autoritativa ? 'caja' : 'local-degradado',
    autoritativa,
    sequence: typeof cuerpo.sequence === 'number' ? cuerpo.sequence : null,
    ordenes,
    turno: (cuerpo.turno as Record<string, unknown>) ?? null,
    motivo: autoritativa ? undefined : String(cuerpo.source ?? 'la caja no contestó'),
  }
}

export interface LecturaDeEventos {
  /** Los eventos posteriores al cursor. Vacío = al día, o no se pudo saber. */
  eventos: Record<string, unknown>[]
  /** false cuando NO se pudo preguntar. Distinto de "no hay nada nuevo". */
  determinado: boolean
  motivo?: string
}

/**
 * Lo que pasó desde `cursor`.
 *
 * Devuelve `determinado: false` cuando no se pudo preguntar, en vez de una lista
 * vacía. Un fallo no es un dato vacío — la regla del repo, con su propia prueba
 * de trinquete (`regla-fallo-no-es-dato-vacio.test.ts`).
 */
export async function leerEventosDesde(cursor: number): Promise<LecturaDeEventos> {
  const desde = Number.isInteger(cursor) && cursor >= 0 ? cursor : 0
  try {
    const res = await localNetworkFetch(`${getBridgeUrl()}/events?since=${desde}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return { eventos: [], determinado: false, motivo: `HTTP ${res.status}` }
    const cuerpo = await res.json()
    const eventos = Array.isArray(cuerpo?.events) ? cuerpo.events : []
    return { eventos, determinado: true }
  } catch (e) {
    return { eventos: [], determinado: false, motivo: e instanceof Error ? e.message : String(e) }
  }
}

/** Lo que el mapa de mesas necesita de cada orden. */
export interface OrdenDelSalon {
  id: string
  mesa: number | null
  mesero: string | null
  status: string | null
  total: number
  created_at: string | null
}

/**
 * Traduce lo que guarda Pedro a lo que pinta el mapa de mesas.
 *
 * QUÉ CAMPOS VIENEN DE PEDRO: id, mesa, mesero, status, total y hora de
 * apertura — lo que decide si una mesa se ve ocupada y desde cuándo.
 *
 * QUÉ SIGUE EN SUPABASE, y por qué: reservaciones, catálogo, staff, historial y
 * reportes. Pedro no los conoce ni debe: son datos de administración, no de
 * operación, y no tienen por qué sobrevivir sin internet.
 */
export function aOrdenesDelSalon(crudas: Record<string, unknown>[]): OrdenDelSalon[] {
  const salida: OrdenDelSalon[] = []
  for (const o of crudas) {
    const id = String(o.id ?? o.order_id ?? '')
    if (!id) continue   // sin id no se puede reconciliar con nada
    const mesa = Number(o.mesa)
    const total = Number(o.total)
    salida.push({
      id,
      mesa: Number.isFinite(mesa) ? mesa : null,
      mesero: typeof o.mesero === 'string' ? o.mesero : null,
      status: typeof o.status === 'string' ? o.status : null,
      total: Number.isFinite(total) ? total : 0,
      created_at: typeof o.created_at === 'string' ? o.created_at
        : (typeof o.ts === 'number' ? new Date(o.ts).toISOString() : null),
    })
  }
  return salida
}

/**
 * ¿Se usa lo de Pedro, o lo de la nube?
 *
 * Es LA decisión que evita dos estados independientes, y por eso vive aquí sola
 * y probada, no repartida en la pantalla.
 */
export function debeUsarPedro(lectura: LecturaDelSalon): boolean {
  return lectura.autoritativa
}

/** Qué decirle al operador. `null` cuando no hay nada que avisar. */
export function avisoDeProcedencia(lectura: LecturaDelSalon): string | null {
  if (lectura.autoritativa) return null
  if (lectura.procedencia === 'local-degradado') {
    return 'Sin conexión con la caja — puede que no veas mesas de otras terminales'
  }
  return null   // `sin-pedro` es lo normal fuera de una terminal; no se alarma
}
