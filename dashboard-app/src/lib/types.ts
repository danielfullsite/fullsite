export interface WansoftDaily {
  fecha: string
  ventas_dia: number
  ventas_brutas: number
  descuentos: number
  devoluciones: number
  tickets_count: number
  personas_restaurant: number
  ticket_promedio_restaurant: number
  efectivo: number
  tarjeta: number
  mesas_atendidas: number
  ordenes_llevar: number
  propinas_total: number
  chilaquiles_total: number
  half_half_total: number
  meseros: MeseroEntry[]
  platillos_top: PlatilloEntry[]
  ventas_por_grupo: GrupoEntry[]
  pago_métodos: PagoMetodoEntry[]
  updated_at?: string
}

export interface MeseroEntry {
  nombre: string
  total: number
}

export interface PlatilloEntry {
  nombre: string
  total: number
}

export interface GrupoEntry {
  nombre: string
  total: number
}

export interface PagoMetodoEntry {
  nombre: string
  total: number
}

export interface WaiterCategory {
  fecha: string
  data: WaiterCategoryData
}

export interface WaiterCategoryData {
  [waiterName: string]: {
    KPIs?: {
      ticket_promedio?: number
      mesas?: number
      personas?: number
      total_ventas?: number
    }
    'H&H'?: number
    Pan?: number
    Postres?: number
    '2da Bebida'?: number
    __por_mesero_grupo?: Record<string, number>
    __por_mesero_platillo?: Record<string, number>
  }
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface KPICardData {
  label: string
  value: string
  delta?: string
  deltaType?: 'up' | 'down' | 'neutral'
}
