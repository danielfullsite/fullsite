export interface OrgConfig {
  id: string
  display_name: string
  city: string
  timezone: string
  type: string
  iva_rate: number
  rfc?: string
  razon_social?: string
  address?: string
  phone?: string
  receipt_footer?: string
  plan: string
  data_source: string
  accent_color: string
}

export interface LocationConfig {
  id: string
  name: string
  address?: string
  mesas: number
}

export interface MenuCategoryConfig {
  id: string
  name: string
  color: string
  sort_order: number
  items: MenuItemConfig[]
}

export interface MenuItemConfig {
  id: string
  name: string
  price: number
  sort_order: number
}

export interface StaffConfig {
  name: string
  pin: string
  role: string
}

export interface PaymentMethodConfig {
  name: string
  type: 'cash' | 'card' | 'transfer' | 'digital'
  commission_pct: number
  fiscal_code?: string
}

export interface RestaurantSeed {
  org: OrgConfig
  location: LocationConfig
  menu: MenuCategoryConfig[]
  staff: StaffConfig[]
  paymentMethods: PaymentMethodConfig[]
  historicalDays: number
}
