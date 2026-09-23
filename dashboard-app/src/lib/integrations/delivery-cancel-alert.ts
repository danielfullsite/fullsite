// Alerta de cancelación externa en la vista de delivery del POS.
//
// POR QUE EXISTE
//
// Uber preguntó textualmente en el cuestionario de certificación:
//
//   "When an order is marked as cancelled by Uber (e.g. orders.failure webhook),
//    how is this surfaced to merchant on location?"
//
// La respuesta que se les dio fue: *"The current POS delivery view removes cancelled
// orders from the active queue; a dedicated persistent audible/visual cancellation
// alert for the on-site operator is not yet implemented."*
//
// O sea: la orden **desaparece de la cola**. Si la cocina ya la está preparando, nadie
// se entera — se cocina comida que nadie va a recoger. Es el mismo patrón que costó
// caro en el POS la noche del 2026-08-30: un fallo que el sistema conoce y no comunica.
//
// QUE HACE ESTE MODULO
//
// Sólo la detección, que es la parte con reglas. La pieza que importa es distinguir
// una cancelación **de la plataforma** de una que hizo el propio operador: alarmar por
// nuestras propias acciones entrena a ignorar la alarma, que es peor que no tenerla.

export interface CancelWatchOrder {
  id: string
  status: string
  platform: string
  platform_order_id: string | null
  customer_name: string
  total: number
}

/** Estados en los que la cocina puede estar trabajando la orden. */
const EN_CURSO = new Set(['nueva', 'aceptada', 'preparando', 'lista', 'en_ruta', 'recibida'])

export interface CancelacionExterna {
  id: string
  platform: string
  platform_order_id: string | null
  customer_name: string
  total: number
  /** Estado en el que estaba cuando la plataforma la canceló. */
  estadoPrevio: string
  /** true si la cocina ya podía estar preparándola. */
  cocinaEnCurso: boolean
}

/**
 * Compara dos lecturas consecutivas y devuelve las órdenes que la PLATAFORMA canceló.
 *
 * @param previas       órdenes de la lectura anterior
 * @param actuales      órdenes de la lectura de ahora
 * @param canceladasAqui ids que el operador canceló desde esta terminal — se excluyen
 *                       siempre: él ya sabe, y alarmar por su propia acción quema la alarma
 * @param yaAvisadas    ids por los que ya se alertó, para no repetir en cada poll
 */
export function detectarCancelacionesExternas(
  previas: CancelWatchOrder[],
  actuales: CancelWatchOrder[],
  canceladasAqui: ReadonlySet<string> = new Set(),
  yaAvisadas: ReadonlySet<string> = new Set(),
): CancelacionExterna[] {
  if (!previas.length) return [] // primera carga: no hay "antes" contra qué comparar

  const antes = new Map(previas.map(o => [o.id, o]))
  const out: CancelacionExterna[] = []

  for (const ahora of actuales) {
    if (ahora.status !== 'cancelada') continue
    if (canceladasAqui.has(ahora.id)) continue
    if (yaAvisadas.has(ahora.id)) continue

    const previa = antes.get(ahora.id)
    if (!previa) continue                      // no estaba antes: no es una transición
    if (previa.status === 'cancelada') continue // ya venía cancelada

    out.push({
      id: ahora.id,
      platform: ahora.platform,
      platform_order_id: ahora.platform_order_id,
      customer_name: ahora.customer_name,
      total: ahora.total,
      estadoPrevio: previa.status,
      cocinaEnCurso: EN_CURSO.has(previa.status),
    })
  }

  return out
}

/** Texto para el operador. Lo primero que dice es si hay que parar la cocina. */
export function mensajeCancelacion(c: CancelacionExterna): string {
  const plataforma = c.platform === 'ubereats' ? 'Uber Eats' : c.platform === 'rappi' ? 'Rappi' : c.platform
  const quien = c.customer_name && c.customer_name !== 'Cliente Uber' ? ` de ${c.customer_name}` : ''
  return c.cocinaEnCurso
    ? `${plataforma} CANCELÓ la orden${quien} — avisa a cocina, puede estar preparándose.`
    : `${plataforma} canceló la orden${quien}.`
}

/**
 * Pitido de atención. Sin archivo de audio: en una terminal de cocina un asset que no
 * cargó es una alarma que no suena. Falla en silencio — el aviso visual es el que manda.
 */
export function sonarAlerta(veces = 3): void {
  try {
    const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    for (let i = 0; i < veces; i++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = 880
      gain.gain.value = 0.08
      osc.connect(gain); gain.connect(ctx.destination)
      const t = ctx.currentTime + i * 0.45
      osc.start(t); osc.stop(t + 0.22)
    }
  } catch { /* sin audio: el banner visual sigue ahí */ }
}
