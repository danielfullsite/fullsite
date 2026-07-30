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
}

export interface AgentMetrics {
  total_decisions: number
  correct: number
  false_positives: number
  precision_rate: number               // correct / (correct + false_positive)
  total_value_estimated: number        // MXN sum where estimated_value is set
  total_value_validated: number        // MXN sum where outcome = 'correct'
  avg_time_to_action_min: number | null
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
