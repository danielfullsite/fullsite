export type OperationalState = 'operational' | 'degraded' | 'attention' | 'blocked' | 'recovering' | 'unknown'
export type MetricFreshness = 'live' | 'recent' | 'stale' | 'unknown'
export type ActionPriority = 'critical' | 'high' | 'medium' | 'low'

export interface CanonicalMetric {
  id: string
  label: string
  value: number
  unit: 'mxn' | 'count' | 'percent' | 'minutes'
  source: string
  observedAt: string | null
  freshness: MetricFreshness
  comparison?: { value: number; label: string }
}

export interface OperationalAction {
  id: string
  title: string
  detail: string
  priority: ActionPriority
  area: 'ventas' | 'cocina' | 'caja' | 'inventario' | 'equipo' | 'sistema'
  href: string
  owner: string
  source: string
  observedAt: string | null
}

export function classifyFreshness(observedAt: string | null, now = new Date()): MetricFreshness {
  if (!observedAt) return 'unknown'
  const observed = new Date(observedAt.includes('T') ? observedAt : `${observedAt}T23:59:59`)
  const age = now.getTime() - observed.getTime()
  if (!Number.isFinite(age) || age < 0) return 'unknown'
  if (age <= 15 * 60_000) return 'live'
  if (age <= 36 * 60 * 60_000) return 'recent'
  return 'stale'
}

export function deriveSalesActions(metrics: CanonicalMetric[]): OperationalAction[] {
  const sales = metrics.find(metric => metric.id === 'net_sales_today')
  const averageTicket = metrics.find(metric => metric.id === 'average_ticket_today')
  const actions: OperationalAction[] = []

  if (sales?.comparison && sales.comparison.value <= -15) {
    actions.push({
      id: 'sales-below-comparison',
      title: 'Ventas por debajo del periodo comparable',
      detail: `La venta está ${Math.abs(sales.comparison.value).toFixed(0)}% abajo. Revisa mezcla, horarios y canales antes del cierre.`,
      priority: sales.comparison.value <= -25 ? 'high' : 'medium',
      area: 'ventas',
      href: '/ventas',
      owner: 'Gerencia',
      source: sales.source,
      observedAt: sales.observedAt,
    })
  }

  if (averageTicket && averageTicket.value === 0 && sales && sales.value > 0) {
    actions.push({
      id: 'ticket-metric-inconsistent',
      title: 'Ticket promedio sin datos',
      detail: 'Hay venta registrada, pero el ticket promedio es cero. Verifica la definición y la fuente antes de usar el indicador.',
      priority: 'high',
      area: 'sistema',
      href: '/ventas',
      owner: 'Administrador',
      source: averageTicket.source,
      observedAt: averageTicket.observedAt,
    })
  }

  return actions
}

export function stateLabel(state: OperationalState): string {
  return {
    operational: 'Operando',
    degraded: 'Degradado, pero vendiendo',
    attention: 'Requiere atención',
    blocked: 'Bloqueado',
    recovering: 'Recuperando',
    unknown: 'Estado desconocido',
  }[state]
}
