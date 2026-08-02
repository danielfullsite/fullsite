/**
 * Restaurant Manifest — complete config for onboarding a new client.
 *
 * A manifest is a JSON document read by bootstrap_client.py to provision
 * everything a restaurant needs: DB row, staff, station routing, features,
 * KDS config, env vars. Zero manual steps after the manifest is defined.
 *
 * Every field maps 1:1 to either clients table columns or pos_settings keys.
 * The bootstrap script is the only code that reads this format.
 */

import type { ClientFeatures } from './client-config'

export interface StaffMember {
  name: string
  role: 'dueño' | 'gerente' | 'capitan' | 'cajero' | 'mesero' | 'staff'
  email?: string
  pin?: string
}

export interface StationRouting {
  cocina: string[]
  barra: string[]
  caja: string[]
  [station: string]: string[]
}

export interface RestaurantManifest {
  // Identity
  client_id: string
  display_name: string
  type: string
  city: string
  timezone: string

  // Plan & features
  plan: 'reporteador' | 'fullsite_software' | 'fullsite_completo'
  features: Partial<ClientFeatures>

  // Branding
  accent_color?: string
  default_theme?: 'light' | 'dark'
  logo_url?: string

  // Operations
  mesas?: number
  iva_rate?: number
  receipt_footer?: string

  // Business info (for receipts + invoicing)
  address?: string
  phone?: string
  rfc?: string
  razon_social?: string

  // Contact
  support_email: string

  // AI / integrations
  business_context?: string
  data_source?: 'fullsite' | 'wansoft' | 'demo'
  wansoft_subsidiary_id?: string

  // Telegram
  telegram_chat_id_owner?: string

  // Notifications
  report_recipients?: Record<string, string[]>

  // Staff (seeded during onboarding)
  staff: StaffMember[]

  // Station routing (overrides system default)
  station_routing?: StationRouting

  // Reviews agent config
  reviews?: {
    location_display?: string
    owner_context?: string
    staff_names?: string
  }
}
