// Avisarle al restaurante lo que acaba de pasar, por la red local.
//
// ── POR QUE EXISTE ───────────────────────────────────────────────────────────
//
// El 2026-09-02 Eduardo probo AMALAY con tres cajas y el internet caido, y
// reporto dos cosas:
//
//   «no hay comunicacion correcta entre los puntos de venta, no muestran lo mismo»
//   «siguen apareciendo platillos en ordenes que estan ya cerradas»
//
// Son el mismo hueco. El POS le manda `ORDER_SENT` al servidor local cuando envia
// una comanda — eso funciona, y Eduardo lo vio llegar a cocina en un segundo. Pero
// cuando la mesa se CIERRA no manda nada.
//
// Y lo que duele: cocina, barra y el plano **ya estan escuchando `ORDER_CLOSED`**.
//
//   pos/cocina/page.tsx:267   ORDER_EVENTS = [... 'ORDER_CLOSED' ...]
//   pos/barra/page.tsx:132    ORDER_EVENTS = [... 'ORDER_CLOSED' ...]
//   pos/plano/page.tsx:216    MESA_EVENTS  = [... 'ORDER_CLOSED' ...]
//   hooks/useKdsWsClient.ts:173  case 'ORDER_CLOSED': ordersMap.delete(orderId)
//
// Se construyo el oido y nunca la boca. Cierras la mesa 8, la nube se entera, y la
// cocina no — porque su unica via era un evento que nadie emite.
//
// ── POR QUE NO SE REUSA `sendOrderToKitchen` TAL CUAL ────────────────────────
//
// El transporte es el mismo (`/events` de Pedro, que acepta cualquier evento con
// `command_id` y `command_type` — ver local-server/index.js:10 y :393). Lo que
// cambia es la CONSECUENCIA DE FALLAR, y por eso son dos funciones y no una:
//
//   ORDER_SENT   fallo => la comanda NO esta en cocina. Hay que FRENAR al mesero
//                y decirselo. `sendOrderToKitchen` espera, reintenta y devuelve
//                un resultado que el POS usa para mostrar la alerta roja.
//
//   ORDER_CLOSED fallo => los tableros se quedan con una orden de mas. Molesto,
//                se limpia solo al reconectar, y NO justifica congelar al cajero
//                con el cliente enfrente y el dinero en la mano.
//
// Frenar un cobro por un aviso seria peor que el problema que resuelve. Por eso
// esto es "dispara y olvida": no bloquea, no lanza, no muestra errores.
//
// ── LO QUE ESTO NO ES ────────────────────────────────────────────────────────
//
// No es la fuente de verdad. Es un aviso oportunista para que los tableros no se
// queden viejos. La reconciliacion real —la caja que estaba apagada y se conecta
// despues— necesita que el POS le pida a Pedro «dame todo desde el evento N», y
// eso vive en otro lado. Un aviso perdido debe ser recuperable; nunca la unica
// copia de un hecho.
//
// ── LO QUE FALTABA: EL AVISO ES DURABLE ──────────────────────────────────────
//
// El parrafo de arriba decia "recuperable" y no lo era. Laboratorio del 2026-09-10
// (electron-app/lab/videos-de-eduardo-ui.cjs, «Video de Eduardo 3, adversarial»):
// se pierde SOLO el ORDER_CLOSED que sale al cobrar —la LAN parpadea justo en ese
// momento, o la caja acaba de cambiar de IP (T-09)— y la caja se queda creyendo
// que la mesa debe dinero. El lector de un segundo vuelve a pintar el platillo en
// la pantalla que acaba de cobrarlo, «Cobrar» se enciende, y se puede volver a
// cobrar. Es el video de Eduardo del 2026-08-24 palabra por palabra:
//
//   «Voy a pagar la cuenta. La cuenta se cobra correctamente. Aparecen ceros. Pero
//    si vuelves a ingresar, hay un platillo. Y se puede volver a cobrar.»
//
// La nube no rescata: en modo legacy Pedro protege toda orden local del poll
// (state.js, _applyStateSync: «An absent cloud row is not a cancellation receipt»,
// y una fila cerrada en nube tampoco toca una orden local). Y el reenvio de una
// terminal secundaria a la caja es de paso (index.js, «forward to caja failed»):
// si la caja no contesta en ese instante, contesta 502 y no guarda nada. Un aviso
// perdido lo era para siempre.
//
// Se conserva la regla —un aviso jamas frena un cobro— y se agrega la otra mitad:
// un aviso que no llego se guarda ANTES de mandarse y se reintenta hasta que llega.
// Mismo command_id, asi que Pedro deduplica y un reintento de mas no produce nada.
// El reintento lo arranca este modulo al fallar, y el layout del POS al montar
// (el POS navega al mapa con una navegacion completa: el modulo que fallo muere
// con la pagina, y lo pendiente no puede depender de que alguien abra otra mesa).

import { getBridgeUrl } from './bridge-url'
import { localNetworkFetch } from './local-network-fetch'
import { requiereCaja } from './pedro-cliente'
import { calcOrderTotals, round2 } from './pos-calculations'

/**
 * Presupuesto corto a proposito. Este aviso ocurre mientras el cajero espera para
 * imprimir el ticket: es tiempo que se le quita a una persona parada frente a un
 * cliente. Si Pedro no contesta en 1.2 s, el tablero se limpia solo al reconectar.
 */
const TIMEOUT_MS = 1_200

const LOG = '[aviso-lan]'

export type TipoDeAviso = 'ORDER_CLOSED' | 'ORDER_CANCELLED' | 'ORDER_UPSERTED'

export interface Aviso {
  /**
   * Identificador unico del aviso. Pedro deduplica por este campo, asi que un
   * reintento o un doble tap no producen dos efectos.
   */
  command_id: string
  command_type: TipoDeAviso
  order_id: string
  client_id: string
  mesa?: number | null
  turno_id?: string | null
  status?: string | null
  /**
   * Campos de negocio de un ORDER_UPSERTED. Pedro copia exactamente estos
   * (state.js, `orderFields`) y reemplaza `items` si viene; lo que no viene se
   * conserva. Nunca credenciales ni transporte.
   */
  items?: unknown[]
  subtotal?: number
  iva?: number
  total?: number
  descuento?: number
  personas?: number
  mesero?: string
  order_revision?: number
  notas?: string | null
}

// ── Avisos pendientes: lo que no llego, se guarda ────────────────────────────

const CLAVE_PENDIENTES = 'pos_avisos_lan_pendientes'
/** Cada cuanto se reintenta lo pendiente mientras haya algo pendiente. */
const REINTENTO_MS = 3_000
/**
 * Tope de seguridad. Un restaurante no acumula 200 cierres sin LAN sin que alguien
 * lo note; si pasa, se conservan los MAS RECIENTES, que son los que todavia
 * pintan una mesa ocupada.
 */
export const MAX_AVISOS_PENDIENTES = 200

function almacen(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

/** Los avisos que salieron de esta terminal y Pedro no confirmo. Vacio si no hay almacen. */
export function leerAvisosPendientes(): Aviso[] {
  try {
    const crudo = JSON.parse(almacen()?.getItem(CLAVE_PENDIENTES) || '[]')
    return Array.isArray(crudo) ? crudo.filter(a => a && typeof a.command_id === 'string' && typeof a.order_id === 'string') : []
  } catch { return [] }
}

function escribirPendientes(lista: Aviso[]): void {
  try {
    if (lista.length === 0) almacen()?.removeItem(CLAVE_PENDIENTES)
    else almacen()?.setItem(CLAVE_PENDIENTES, JSON.stringify(lista.slice(-MAX_AVISOS_PENDIENTES)))
  } catch { /* sin almacen (modo privado, cuota): el aviso sigue siendo de un intento, como antes */ }
}

function recordarPendiente(aviso: Aviso): void {
  const pendientes = leerAvisosPendientes()
  // A duplicate caller must retain its original position and payload.
  if (!pendientes.some(a => a.command_id === aviso.command_id)) escribirPendientes([...pendientes, aviso])
}

function olvidarPendiente(commandId: string): void {
  escribirPendientes(leerAvisosPendientes().filter(a => a.command_id !== commandId))
}

/** Un intento. Nunca lanza: devuelve si Pedro lo acepto. */
async function enviar(aviso: Aviso): Promise<boolean> {
  const url = `${getBridgeUrl()}/events`
  try {
    const res = await localNetworkFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(aviso),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      console.warn(`${LOG} ${aviso.command_type} rechazado`, { url, status: res.status })
      return false
    }
    return true
  } catch (e) {
    // Silencioso a proposito. Sin LAN —una caja en WiFi de invitados, el cable
    // desconectado, Pedro reiniciandose— esto falla, y el cobro debe seguir su
    // curso exactamente igual. El aviso queda pendiente y se reintenta.
    console.warn(`${LOG} ${aviso.command_type} no llego`, {
      url,
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    })
    return false
  }
}

/**
 * Manda un aviso a la LAN sin bloquear ni lanzar NUNCA.
 *
 * Devuelve si llego, para pruebas y bitacora — pero el codigo que cobra no debe
 * ramificar sobre esto. Si te encuentras escribiendo `if (!await avisarALaLan(...))`
 * para mostrarle algo al cajero, estas usando la funcion equivocada: lo que
 * necesitas es `sendOrderToKitchen`, que si espera y si reporta.
 *
 * Si no llega, queda pendiente y se reintenta solo (ver arriba).
 */
export async function avisarALaLan(aviso: Aviso): Promise<boolean> {
  // Se valida aqui y no en el call site porque un aviso sin `order_id` es peor que
  // no mandarlo: los receptores hacen `ordersMap.delete(orderId)` y un id vacio
  // no borra nada, pero si ensucia el event store de Pedro para siempre.
  if (!aviso?.order_id || !aviso?.command_id) {
    console.warn(`${LOG} aviso incompleto — no se manda`, aviso)
    return false
  }

  // Sin una caja a la que avisar —el POS web de un tenant sin Electron ni
  // puente configurado— el aviso es de un solo intento, como siempre fue. Guardarlo
  // y reintentarlo cada 3 s en un navegador que nunca va a tener Pedro seria un
  // temporizador eterno golpeando 127.0.0.1 por nada.
  if (!requiereCaja()) return enviar(aviso)

  // ANTES de mandar, no despues de fallar: si la pestaña muere a media llamada
  // (el cobro navega al mapa con `location.replace`), el aviso sobrevive igual.
  const anteriorPendiente = leerAvisosPendientes().some(a =>
    a.client_id === aviso.client_id && a.order_id === aviso.order_id && a.command_id !== aviso.command_id)
  recordarPendiente(aviso)
  // Do not overtake an older snapshot of the same account. Otherwise its retry
  // would restore the previous items/total after this update was acknowledged.
  if (anteriorPendiente) { asegurarReintentos(); return false }
  const llego = await enviar(aviso)
  if (llego) olvidarPendiente(aviso.command_id)
  else asegurarReintentos()
  return llego
}

let temporizador: ReturnType<typeof setInterval> | null = null
let reintentoEnCurso: Promise<{ pendientes: number; entregados: number }> | null = null

/**
 * Reintenta todo lo pendiente, en orden, una vez. Lo que Pedro acepta se olvida;
 * lo demas se queda. Dos llamadas solapadas comparten la misma pasada.
 */
export function reintentarAvisosPendientes(): Promise<{ pendientes: number; entregados: number }> {
  if (reintentoEnCurso) return reintentoEnCurso
  reintentoEnCurso = (async () => {
    let entregados = 0
    const bloqueadas = new Set<string>()
    for (const aviso of leerAvisosPendientes()) {
      const cuenta = JSON.stringify([aviso.client_id, aviso.order_id])
      if (bloqueadas.has(cuenta)) continue
      if (await enviar(aviso)) { olvidarPendiente(aviso.command_id); entregados++ }
      else bloqueadas.add(cuenta)
    }
    const pendientes = leerAvisosPendientes().length
    if (pendientes === 0) detenerReintentos()
    else if (entregados > 0) console.warn(`${LOG} ${entregados} aviso(s) entregados tarde; ${pendientes} siguen pendientes`)
    return { pendientes, entregados }
  })().finally(() => { reintentoEnCurso = null })
  return reintentoEnCurso
}

/**
 * Enciende el temporizador de reintentos si hay algo pendiente. Idempotente: con
 * el temporizador ya encendido no hace nada. Devuelve si quedo encendido.
 *
 * Lo llama este modulo al fallar un aviso, y `pos/layout.tsx` al montar, para que
 * lo que quedo pendiente antes de una navegacion completa o un reinicio se
 * reintente sin que nadie tenga que abrir una mesa.
 */
export function asegurarReintentos(): boolean {
  if (leerAvisosPendientes().length === 0) return false
  if (!temporizador) temporizador = setInterval(() => { void reintentarAvisosPendientes() }, REINTENTO_MS)
  return true
}

export function detenerReintentos(): void {
  if (temporizador) { clearInterval(temporizador); temporizador = null }
}

export function hayReintentosProgramados(): boolean { return temporizador !== null }

/**
 * La mesa se cerro: que los tableros la quiten.
 *
 * `opId` es el mismo identificador de la operacion de cobro, para que el aviso
 * herede su idempotencia — dos taps del boton de cobrar producen un solo aviso.
 */
export function avisarCierreDeOrden(args: {
  opId: string
  orderId: string
  clientId: string
  mesa?: number | null
  turnoId?: string | null
  cancelada?: boolean
}): Promise<boolean> {
  return avisarALaLan({
    command_id: `cierre:${args.opId}`,
    command_type: args.cancelada ? 'ORDER_CANCELLED' : 'ORDER_CLOSED',
    order_id: args.orderId,
    client_id: args.clientId,
    mesa: args.mesa ?? null,
    turno_id: args.turnoId ?? null,
    status: args.cancelada ? 'cancelada' : 'cerrada',
  })
}

/**
 * La cuenta cambio sin pasar por «Enviar» ni por «Cobrar»: que Pedro lo sepa.
 *
 * ── POR QUE EXISTE (barrido del 2026-09-10, antes del instalador) ────────────
 *
 * Bajo Electron el mapa y el editor leen del MISMO Pedro (H3, 365eaf22). Pero en
 * modo legacy —que es como se instala AMALAY— cinco mutaciones de la cuenta iban
 * SOLO a la nube y Pedro nunca se enteraba:
 *
 *   anular la orden           pos/page.tsx  handleVoidOrder      → status 'cancelada'
 *   cancelar un platillo      pos/page.tsx  handleCancelItem     → /api/pos/cancel-item
 *   transferir un platillo    pos/page.tsx  handleTransferItem   → /api/pos/transfer-item
 *   transferir la mesa        pos/page.tsx  boton «Transferir»   → updateOrderStatus(mesa)
 *   fusionar dos mesas        pos/mesas     handleMerge          → /api/pos/merge-orders
 *
 * Y Pedro protege toda orden local del poll de nube (state.js, _applyStateSync),
 * asi que esa nube nunca lo corregia. Resultado: la mesa anulada seguia ocupada
 * en las tres pantallas, el platillo cancelado seguia sumando en el mapa, la mesa
 * transferida se veia en la vieja. Es la familia entera de «por fuera no dice lo
 * mismo que por dentro» de los videos de Eduardo, por otra puerta.
 *
 * Solo «Enviar» (ORDER_SENT, kitchen-bridge.ts) y «Cobrar» (ORDER_CLOSED, arriba)
 * hablaban con Pedro. Esto es la boca que faltaba para todo lo demas: un
 * ORDER_UPSERTED con la verdad completa de la cuenta, durable como el cierre.
 * Pedro reemplaza items y status, mueve la mesa si cambio, y conserva lo que no
 * viene (state.js, _applyOrderUpserted).
 */
export function avisarCuentaActualizada(args: {
  opId: string
  orderId: string
  clientId: string
  mesa?: number | null
  turnoId?: string | null
  status?: string | null
  items?: unknown[]
  subtotal?: number
  iva?: number
  total?: number
  descuento?: number
  personas?: number
  mesero?: string
  orderRevision?: number
  notas?: string | null
}): Promise<boolean> {
  const sinIndefinidos = <T extends object>(o: T): T =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
  return avisarALaLan(sinIndefinidos({
    command_id: `cuenta:${args.opId}`,
    command_type: 'ORDER_UPSERTED' as const,
    order_id: args.orderId,
    client_id: args.clientId,
    mesa: args.mesa,
    turno_id: args.turnoId,
    status: args.status,
    items: args.items,
    subtotal: args.subtotal,
    iva: args.iva,
    total: args.total,
    descuento: args.descuento,
    personas: args.personas,
    mesero: args.mesero,
    order_revision: args.orderRevision,
    notas: args.notas,
  }))
}


/** Only sent lines belong to the shared kitchen/account snapshot. Local drafts
 * stay on their terminal until the operator explicitly sends them. */
export function cuentaEnviadaParaLan<T extends { id: string; subtotal: number; cancelled?: boolean }>(
  items: T[], sentIds: ReadonlySet<string>, excludedIds: ReadonlySet<string>, discount = 0,
) {
  const sent = items.filter(item => sentIds.has(item.id)).map(item =>
    excludedIds.has(item.id) ? { ...item, cancelled: true } : item)
  const { subtotal, iva, total } = calcOrderTotals(sent.filter(item => !item.cancelled), discount)
  return { items: sent, subtotal, iva, total: round2(total), descuento: discount }
}
