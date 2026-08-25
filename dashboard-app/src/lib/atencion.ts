/**
 * Lo que necesita a alguien, ahora.
 *
 * El dashboard abre con una lista de cosas que atender, ordenadas por lo que
 * cuesta ignorarlas. Es lo contrario de un panel de KPIs: no responde "¿cómo
 * vamos?" sino "¿qué hago?".
 *
 * REGLA DURA: todo lo de aquí sale de datos reales o no aparece. Este dashboard
 * venía mostrando "Venta por mesa $39,505" porque dividía entre un dato ausente,
 * y "Total nómina $4,197" para una semana con cero turnos. Una lista de
 * pendientes inventados es peor que no tener lista: enseña a ignorarla.
 *
 * Por eso no hay ningún cálculo con fallback. Si el dato no está, el renglón no
 * existe.
 */

export type Severidad = 'critical' | 'warning' | 'info'

export interface Atencion {
  id: string
  severidad: Severidad
  titulo: string
  detalle: string
  /** Pesos que están en juego, si el agente lo estimó. */
  valor: number | null
  /** 0–1. Debajo de UMBRAL_CONFIANZA no se muestra. */
  confianza: number | null
  /** A dónde va el botón. */
  href?: string
  accion?: string
}

/** Fila cruda de `agent_events`. */
export interface EventoAgente {
  id: string
  severity: string | null
  title: string | null
  explanation: string | null
  suggested_action: string | null
  estimated_value: number | null
  confidence: number | null
  status: string | null
  created_at: string | null
  expires_at: string | null
  type: string | null
}

/**
 * Debajo de esto el agente no está seguro, y un pendiente dudoso arriba de la
 * pantalla vale menos que nada. 0.7 sale de los datos actuales: las 12
 * detecciones existentes van de 0.74 a 0.93, así que el umbral no las corta —
 * corta las que vengan peor.
 */
export const UMBRAL_CONFIANZA = 0.7

/** Estados que significan "ya no hay nada que hacer con esto". */
const RESUELTOS = new Set(['resolved', 'dismissed', 'closed', 'ignored', 'acted'])

const ORDEN: Record<Severidad, number> = { critical: 0, warning: 1, info: 2 }

function normalizaSeveridad(s: string | null): Severidad {
  if (s === 'critical' || s === 'warning' || s === 'info') return s
  // Un evento sin severidad reconocida NO se promueve a crítico: se trata como
  // informativo. Inflar la severidad es la forma más rápida de que la lista
  // pierda credibilidad.
  return 'info'
}

/** Rutas por tipo de detección. Un tipo desconocido simplemente no lleva botón. */
const DESTINOS: Record<string, { href: string; accion: string }> = {
  out_of_stock: { href: '/inventario', accion: 'Ver inventario' },
  low_stock: { href: '/inventario', accion: 'Ver inventario' },
  cancel_concentration: { href: '/cancelaciones', accion: 'Revisar' },
  skimming_suspect: { href: '/cancelaciones', accion: 'Revisar' },
  understaffed: { href: '/meseros', accion: 'Ver equipo' },
  peak_load: { href: '/meseros', accion: 'Ver equipo' },
  top_performer: { href: '/meseros', accion: 'Ver meseros' },
  ticket_declining: { href: '/ventas', accion: 'Ver ventas' },
  low_ticket: { href: '/ventas', accion: 'Ver ventas' },
  sales_vs_dow: { href: '/tendencias', accion: 'Ver tendencia' },
  dow_insight: { href: '/tendencias', accion: 'Ver tendencia' },
  food_cost: { href: '/food-cost', accion: 'Ver food cost' },
}

/**
 * Convierte las detecciones de los agentes en renglones de la lista.
 *
 * @param ahora fecha de referencia, inyectable para que las pruebas no dependan
 *              del reloj de quien las corre.
 */
export function desdeEventos(eventos: EventoAgente[], ahora: Date = new Date()): Atencion[] {
  return eventos
    .filter(e => {
      if (!e.title) return false
      if (e.status && RESUELTOS.has(e.status)) return false
      // Una detección vencida ya no es un pendiente: es historia.
      if (e.expires_at && new Date(e.expires_at).getTime() < ahora.getTime()) return false
      // Sin confianza declarada se deja pasar: el agente no la reportó, no es
      // que la haya reportado baja.
      if (e.confidence != null && e.confidence < UMBRAL_CONFIANZA) return false
      return true
    })
    .map(e => {
      const destino = e.type ? DESTINOS[e.type] : undefined
      return {
        id: e.id,
        severidad: normalizaSeveridad(e.severity),
        titulo: e.title!,
        detalle: e.suggested_action || e.explanation || '',
        valor: typeof e.estimated_value === 'number' && e.estimated_value > 0 ? e.estimated_value : null,
        confianza: typeof e.confidence === 'number' ? e.confidence : null,
        href: destino?.href,
        accion: destino?.accion,
      }
    })
    .sort((a, b) => {
      // Primero por gravedad; dentro de la misma gravedad, por dinero en juego.
      const s = ORDEN[a.severidad] - ORDEN[b.severidad]
      if (s !== 0) return s
      return (b.valor ?? 0) - (a.valor ?? 0)
    })
}

/** Pesos totales en juego, para el encabezado de la lista. */
export function valorEnJuego(items: Atencion[]): number {
  return items.reduce((s, i) => s + (i.valor ?? 0), 0)
}
