// Nombres amigables de agentes. agent_runs usa IDs largos y agent_results IDs
// cortos → este mapa cubre ambos para que la UI siempre muestre un nombre bonito.
const AGENT_NAMES: Record<string, string> = {
  'anomaly': 'Anomalías de venta', 'anomaly-detector': 'Anomalías de venta',
  'upselling': 'Upselling',
  'predictor': 'Predicción de Cierre', 'close-predictor': 'Predicción de Cierre',
  'antifraud': 'Anti-Fraude', 'antifraud-agent': 'Anti-Fraude',
  'cost-variance': 'Varianza de Costos',
  'menu-engineering': 'Menu Engineering',
  'auto86': 'Auto-86',
  'purchase-predictor': 'Compras',
  'kitchen': 'Calidad de Cocina', 'kitchen-quality': 'Calidad de Cocina',
  'config': 'Configuración', 'config-validator': 'Configuración',
  'sync': 'Sincronización', 'wansoft-staleness': 'Sincronización',
  'daily-briefing': 'Briefing del Día',
  'weekly-summary': 'Reporte Semanal', 'weekly-amalay': 'Reporte Semanal',
  'intraday-sales': 'Ventas Intraday',
  'staffing': 'Staffing', 'staffing-optimizer': 'Staffing',
  'tips': 'Propinas', 'tips-analyzer': 'Propinas',
  'waste': 'Desperdicio', 'waste-detector': 'Desperdicio',
  'suppliers': 'Proveedores', 'supplier-monitor': 'Proveedores',
  'climate': 'Clima', 'climate-events': 'Clima',
  'stock-alert': 'Alerta de Stock',
  'table-time': 'Tiempo de Mesa',
  'speed_of_service': 'Velocidad de Servicio', 'speed-of-service': 'Velocidad de Servicio',
  'crm-recompra': 'Clientes en Riesgo',
  'hermes': 'Salud del Sistema',
  'reservas-pendientes': 'Reservas',
  'wansoft-query': 'KB 24/7',
}

export function agentName(id: string): string {
  if (!id) return 'Agente'
  return AGENT_NAMES[id] || id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
