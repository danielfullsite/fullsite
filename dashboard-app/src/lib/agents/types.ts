export type AgentId = 'operations' | 'inventory' | 'fraud' | 'staff' | 'finance'
export type Severity = 'info' | 'warning' | 'critical'
export type EventStatus = 'new' | 'acknowledged' | 'resolved'
export type Outcome = 'correct' | 'false_positive'

export interface AgentEvent {
  id?: string
  client_id: string
  agent_id: AgentId
  type: string
  severity: Severity
  title: string
  explanation: string
  evidence: Record<string, unknown>
  suggested_action: string
  confidence: number                   // 0.0–1.0
  status: EventStatus
  // Economic quantification — null when calculation isn't reliable
  estimated_value?: number | null      // MXN en juego o en riesgo
  // Outcome tracking — set by user after resolving
  outcome?: Outcome | null
  created_at?: string
  expires_at?: string | null
  /**
   * Fecha o timestamp del registro MAS NUEVO que sustenta este hallazgo.
   *
   * Lo lee el engine al insertar: si el dato ya no es de hoy, fecha el titulo y la
   * explicacion en vez de dejar que la frase pase por presente. Sin declarar, queda
   * escrito como `declarada: false` en la evidencia — que NO significa fresco.
   */
  datos_hasta?: string | null
}

/**
 * Con menos de esto, un porcentaje de precisión es anécdota disfrazada de
 * medición: con 4 veredictos, un 25% se lee igual de firme que con 400, y con
 * ese número alguien apaga un agente por ruido muestral.
 */
export const MUESTRA_MINIMA_PRECISION = 20

export interface AgentMetrics {
  total_decisions: number
  correct: number
  false_positives: number
  /**
   * correct / (correct + false_positive), o null si NADIE ha opinado.
   *
   * Era `number` y la ruta devolvía `precisionRate ?? 0`: sin un solo veredicto
   * reportaba 0%, que no se lee como «sin datos» sino como «los agentes fallan
   * siempre». Cero y ausencia no son lo mismo.
   */
  precision_rate: number | null
  /** El denominador. Un porcentaje sin su muestra no se puede juzgar. */
  juzgados: number
  /** true mientras `juzgados` no alcance MUESTRA_MINIMA_PRECISION. */
  muestra_insuficiente: boolean
  total_value_estimated: number        // MXN sum where estimated_value is set
  total_value_validated: number        // MXN sum where outcome = 'correct'
  avg_time_to_action_min: number | null
  /** true si la consulta topó el límite: lo que se ve NO es todo. */
  truncado: boolean
}

export interface AgentResult {
  agent_id: AgentId
  events: AgentEvent[]
  ran_at: string
  duration_ms: number
  error?: string
}

export interface AgentMeta {
  id: AgentId
  label: string
  description: string
  icon: string
  color: string
}

export const AGENT_META: Record<AgentId, AgentMeta> = {
  operations: {
    id: 'operations',
    label: 'Operaciones',
    description: 'Mesas, cocina, cuellos de botella, horas pico',
    icon: 'Activity',
    color: 'blue',
  },
  inventory: {
    id: 'inventory',
    label: 'Inventario',
    description: 'Stock, mermas, compras urgentes, recetas',
    icon: 'Package',
    color: 'amber',
  },
  fraud: {
    id: 'fraud',
    label: 'Anti-Fraude',
    description: 'Cancelaciones, descuentos, patrones sospechosos',
    icon: 'Shield',
    color: 'red',
  },
  staff: {
    id: 'staff',
    label: 'Personal',
    description: 'Productividad, desempeño, staffing',
    icon: 'Users',
    color: 'violet',
  },
  finance: {
    id: 'finance',
    label: 'Finanzas',
    description: 'Margen, food cost, ticket promedio, tendencias',
    icon: 'TrendingUp',
    color: 'emerald',
  },
}
