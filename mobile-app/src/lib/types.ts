// Shared types — mirrors dashboard-app/src/lib/pos-data.ts

export interface MenuItem {
  id: string
  nombre: string
  precio: number
  categoria: string
  barcode?: string
  promo?: boolean
  disponible: boolean
}

export interface MenuCategory {
  id: string
  label: string
  items: MenuItem[]
}

export interface OrderItem {
  menuItemId: string
  nombre: string
  precio: number
  cantidad: number
  subtotal: number
  modificadores?: string[]
  notas?: string
}

export interface Order {
  id: string
  mesa: string
  mesero: string
  items: OrderItem[]
  subtotal: number
  descuento: number
  iva: number
  total: number
  propina?: number
  metodoPago?: string
  status: 'open' | 'closed' | 'cancelled'
  notas?: string
  createdAt: string
  closedAt?: string
}

export interface StaffMember {
  id: string
  name: string
  role: 'admin' | 'mesero' | 'cocina' | 'barra' | 'caja'
  pin: string
  active: boolean
}

export type StationName = 'cocina' | 'barra' | 'caja'
