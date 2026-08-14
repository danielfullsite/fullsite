export const RAPPI_CANCEL_TYPES = {
  STORE_CLOSED: 'Tienda cerrada',
  ITEM_STOCKOUT: 'Producto agotado',
  POS_OFFLINE: 'POS sin conexión',
  POS_INTERNAL_ERROR: 'Error interno del POS',
  INTEGRATOR_ERROR: 'Error del integrador',
  DELIVERY_METHOD_NOT_SUPPORTED: 'Método de entrega no soportado',
  ORDER_TOTAL_INCORRECT: 'Total de orden incorrecto',
  ORDER_CHARGES_INCORRECT: 'Cargos incorrectos',
  ORDER_DISCOUNTS_INCORRECT: 'Descuentos incorrectos',
  OUTSIDE_DELIVERY_AREA: 'Fuera de zona de entrega',
  ITEM_PRICE_INCORRECT: 'Precio de producto incorrecto',
  ITEM_NOT_FOUND: 'Producto no encontrado',
  CUSTOMER_INFO_INCORRECT: 'Información del cliente incorrecta',
} as const

export type RappiCancelType = keyof typeof RAPPI_CANCEL_TYPES

const UBER_TO_RAPPI_CANCEL: Record<string, RappiCancelType> = {
  OUT_OF_ITEM: 'ITEM_STOCKOUT',
  ITEM_UNAVAILABLE: 'ITEM_STOCKOUT',
  STORE_CLOSED: 'STORE_CLOSED',
  RESTAURANT_CLOSED: 'STORE_CLOSED',
  POS_OFFLINE: 'POS_OFFLINE',
  RESTAURANT_TOO_BUSY: 'POS_INTERNAL_ERROR',
  OTHER: 'INTEGRATOR_ERROR',
}

export function isRappiCancelType(value: string): value is RappiCancelType {
  return value in RAPPI_CANCEL_TYPES
}

export function toRappiCancelType(value?: string | null): RappiCancelType {
  if (value && isRappiCancelType(value)) return value
  if (value && UBER_TO_RAPPI_CANCEL[value]) return UBER_TO_RAPPI_CANCEL[value]
  return 'INTEGRATOR_ERROR'
}
