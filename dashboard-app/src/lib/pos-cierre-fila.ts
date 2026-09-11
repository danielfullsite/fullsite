/**
 * La fila que el Corte Z inserta en `pos_cierres`.
 *
 * Vive fuera del wizard por una razón medida el 2026-09-10: el wizard escribía
 * `cola_pendiente_al_cerrar`, una columna que existía en AMALAY (agregada por
 * MCP) y en ningún otro entorno. PostgREST respondía 400, el wizard lo tragaba
 * como «queued», la cola lo marcaba terminal, y el turno quedaba cerrado SIN
 * cierre. Nadie lo veía porque la fila se armaba a mano dentro de un componente
 * de React, donde no hay prueba que la compare contra el esquema.
 *
 * Aquí la fila es un valor puro: `pos-cierre-fila-cabe-en-la-tabla.test.ts` la
 * confronta contra las columnas reales de `supabase/migrations`. Una columna
 * nueva sin migración rompe esa prueba antes de romper un corte.
 */

import { diaDeVenta, inicioDiaConfigurado } from './dia-de-venta'

export interface DatosDelCierre {
  id: string
  clientId: string
  turnoId: string
  /** Instante del cierre. La `fecha` sale del DÍA DE VENTA, no del reloj UTC. */
  ahora: Date
  fondoInicial: number
  totalContado: number
  efectivoEsperado: number
  tarjeta: number
  transferencias: number
  otros: number
  diferencia: number
  totalVentas: number
  ticketsCount: number
  cancelaciones: number
  descuentos: number
  propinas: number
  colaPendiente: number
  notas: string | null
  closedBy: string
}

/**
 * `fecha` = día de venta del instante del cierre (inicio configurado, 05:00 por
 * defecto). Antes era `now.toISOString().split('T')[0]`: la fecha UTC, que a
 * partir de las 18:00 hora Central ya es MAÑANA. Todo Z de cena quedaba fechado
 * al día siguiente, y ése es el `fecha` que se le muestra al cajero al confrontar
 * el fondo («el corte Z#3 del 2026-09-03» por un corte del 2).
 */
export function fechaDelCierre(ahora: Date): string {
  return diaDeVenta(ahora, inicioDiaConfigurado())
}

export function armarFilaDeCierre(d: DatosDelCierre) {
  return {
    id: d.id,
    client_id: d.clientId,
    turno_id: d.turnoId,
    fecha: fechaDelCierre(d.ahora),
    fondo_inicial: d.fondoInicial,
    billetes: JSON.stringify({}),
    monedas: JSON.stringify({}),
    total_contado: d.totalContado,
    efectivo_sistema: d.efectivoEsperado,
    tarjeta_sistema: d.tarjeta,
    transferencias_sistema: d.transferencias,
    // Plataformas y cortesías, fuera de `tarjeta_sistema`: ese número se
    // concilia a mano contra la terminal bancaria y con basura adentro no cuadra.
    otros_sistema: d.otros,
    diferencia: d.diferencia,
    total_ventas: d.totalVentas,
    tickets_count: d.ticketsCount,
    cancelaciones: d.cancelaciones,
    descuentos: d.descuentos,
    propinas: d.propinas,
    // Queda EN el cierre: mañana explica una diferencia en vez de adivinarla.
    cola_pendiente_al_cerrar: d.colaPendiente,
    notas: d.notas,
    closed_by: d.closedBy,
    approved_by: d.closedBy,
    created_at: d.ahora.toISOString(),
  }
}

/** Un 4xx que no es de sesión ni de tiempo es definitivo: reintentarlo da lo mismo. */
export function rechazoDefinitivo(status: number): boolean {
  return status >= 400 && status < 500 && ![401, 403, 408, 425, 429].includes(status)
}
