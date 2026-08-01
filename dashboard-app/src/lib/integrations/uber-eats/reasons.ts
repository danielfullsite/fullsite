// Uber Eats — Deny and Cancel reason catalogs per Marketplace API spec.

export const UBER_DENY_REASONS = {
  RESTAURANT_TOO_BUSY: 'RESTAURANT_TOO_BUSY',
  CLOSED_TEMPORARILY: 'CLOSED_TEMPORARILY',
  ITEM_UNAVAILABLE: 'ITEM_UNAVAILABLE',
  DELIVERY_AREA_TOO_FAR: 'DELIVERY_AREA_TOO_FAR',
  CUSTOMER_REQUESTED: 'CUSTOMER_REQUESTED',
  OTHER: 'OTHER',
} as const

export const UBER_CANCEL_REASONS = {
  ITEM_UNAVAILABLE: 'ITEM_UNAVAILABLE',
  CUSTOMER_CALLED_TO_CANCEL: 'CUSTOMER_CALLED_TO_CANCEL',
  RESTAURANT_TOO_BUSY: 'RESTAURANT_TOO_BUSY',
  CANNOT_COMPLETE_CUSTOMER_NOTE: 'CANNOT_COMPLETE_CUSTOMER_NOTE',
  DUPLICATE_ORDER: 'DUPLICATE_ORDER',
  ORDER_NOT_DELIVERED: 'ORDER_NOT_DELIVERED',
  OTHER: 'OTHER',
} as const

export type UberDenyReason = (typeof UBER_DENY_REASONS)[keyof typeof UBER_DENY_REASONS]
export type UberCancelReason = (typeof UBER_CANCEL_REASONS)[keyof typeof UBER_CANCEL_REASONS]

export const DENY_REASON_LABELS: Record<UberDenyReason, string> = {
  RESTAURANT_TOO_BUSY: 'Restaurante muy ocupado',
  CLOSED_TEMPORARILY: 'Cerrado temporalmente',
  ITEM_UNAVAILABLE: 'Artículo no disponible',
  DELIVERY_AREA_TOO_FAR: 'Zona muy lejos',
  CUSTOMER_REQUESTED: 'Cliente lo solicitó',
  OTHER: 'Otro',
}

export const CANCEL_REASON_LABELS: Record<UberCancelReason, string> = {
  ITEM_UNAVAILABLE: 'Artículo no disponible',
  CUSTOMER_CALLED_TO_CANCEL: 'Cliente llamó a cancelar',
  RESTAURANT_TOO_BUSY: 'Restaurante muy ocupado',
  CANNOT_COMPLETE_CUSTOMER_NOTE: 'No se puede cumplir la nota especial',
  DUPLICATE_ORDER: 'Orden duplicada',
  ORDER_NOT_DELIVERED: 'Orden no entregada',
  OTHER: 'Otro',
}
