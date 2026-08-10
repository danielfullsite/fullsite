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

// Gate R2-G04 / CLON-TERMINALS — espejo de scripts/manifests/manifest.schema.json §terminals.
// generate_terminal_config.mjs emite un TerminalConfig (electron-app/local-server/config-schema.js)
// por cada entrada — provisioning config-only, sin editar código.
export interface TerminalSpec {
  terminal_id: string
  name: string
  role: 'server_pos' | 'pos' | 'kds' | 'admin'
  pos_server_ip?: string
  local_server_port?: number
  channel?: 'stable' | 'pilot' | 'development'
  kds?: boolean
  printer_ids?: string[]
}

// Espejo de manifest.schema.json §printers — subset del schema v2 de
// electron-app/local-server/adapters/printer-config-schema.js.
export interface PrinterSpec {
  printer_id: string
  name: string
  enabled?: boolean
  connection: {
    type: 'tcp' | 'usb' | 'windows'
    host?: string
    port?: number
    names?: string[]
  }
  station_ids: string[]
  document_types?: Array<
    'kitchen_ticket' | 'bar_ticket' | 'receipt' | 'pre_ticket' | 'invoice' | 'corte' | 'reprint'
  >
  copies?: number
  encoding?: 'cp850' | 'cp858' | 'utf-8'
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

  // Terminal provisioning (R2-G04 / CLON-TERMINALS)
  terminals?: TerminalSpec[]
  printers?: PrinterSpec[]
}
