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

import { getBridgeUrl } from './bridge-url'
import { localNetworkFetch } from './local-network-fetch'

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
}

/**
 * Manda un aviso a la LAN sin bloquear ni lanzar NUNCA.
 *
 * Devuelve si llego, para pruebas y bitacora — pero el codigo que cobra no debe
 * ramificar sobre esto. Si te encuentras escribiendo `if (!await avisarALaLan(...))`
 * para mostrarle algo al cajero, estas usando la funcion equivocada: lo que
 * necesitas es `sendOrderToKitchen`, que si espera y si reporta.
 */
export async function avisarALaLan(aviso: Aviso): Promise<boolean> {
  // Se valida aqui y no en el call site porque un aviso sin `order_id` es peor que
  // no mandarlo: los receptores hacen `ordersMap.delete(orderId)` y un id vacio
  // no borra nada, pero si ensucia el event store de Pedro para siempre.
  if (!aviso?.order_id || !aviso?.command_id) {
    console.warn(`${LOG} aviso incompleto — no se manda`, aviso)
    return false
  }

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
    // curso exactamente igual.
    console.warn(`${LOG} ${aviso.command_type} no llego`, {
      url,
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    })
    return false
  }
}

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
