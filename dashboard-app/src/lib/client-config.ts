// Multi-tenant client configuration
// Single source of truth: Supabase `clients` table
// This file provides TypeScript types + helpers to read the config
// Python agents read the same table via client_config.py

export interface ClientFeatures {
  pos: boolean
  posRestaurant: boolean
  posTienda: boolean
  bakery_station: boolean
  delivery: boolean
  ecommerce: boolean
  inventory: boolean
  foodCost: boolean
  facturacion: boolean
  nomina: boolean
  agentesIA: boolean
  coach: boolean
  chatIA: boolean
  resenas: boolean
  giftCards: boolean
}

export interface ClientConfig {
  id: string
  plan: string  // 'reporteador' | 'fullsite_software' | 'fullsite_completo'
  display_name: string
  city: string
  timezone: string
  type: string
  default_theme: 'light' | 'dark'
  accent_color: string
  mesas: number
  meseros: string[]
  features: ClientFeatures
  iva_rate: number
  data_source: 'supabase' | 'demo' | 'wansoft' | 'fullsite'
  logo_url?: string
  // Wansoft integration
  wansoft_subsidiary_id?: string
  // Telegram
  telegram_chat_ids?: Record<string, string>
  report_recipients?: Record<string, string[]>
  // Menu config
  menu_categories?: Record<string, string[]>
  bebida_groups?: string[]
  // Business context for AI agents
  business_context?: string
  // Restaurant info (for receipts, invoicing)
  address?: string
  phone?: string
  rfc?: string
  receipt_footer?: string
  social_media?: string
  razon_social?: string
}

// Default features for new clients
const DEFAULT_FEATURES: ClientFeatures = {
  pos: true, posRestaurant: true, posTienda: false, bakery_station: false, delivery: false,
  ecommerce: false, inventory: true, foodCost: true, facturacion: true,
  nomina: false, agentesIA: true, coach: true, chatIA: true,
  resenas: false, giftCards: false,
}

// ─── Fetch from Supabase ────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// Cache to avoid refetching on every render
let _cache: Record<string, ClientConfig> = {}
let _cacheTime = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 min

export async function fetchClientConfig(clientId: string): Promise<ClientConfig> {
  // Check cache
  if (_cache[clientId] && Date.now() - _cacheTime < CACHE_TTL) {
    return _cache[clientId]
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${clientId}&limit=1`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      cache: 'no-store',
    })
    if (res.ok) {
      const rows = await res.json()
      if (rows.length > 0) {
        const row = rows[0]
        const config: ClientConfig = {
          id: row.id,
          plan: row.plan || 'fullsite_completo',
          display_name: row.display_name || row.id,
          city: row.city || '',
          timezone: row.timezone || 'America/Mexico_City',
          type: row.type || '',
          default_theme: row.default_theme || 'light',
          accent_color: row.accent_color || 'emerald',
          mesas: row.mesas || 16,
          meseros: typeof row.meseros === 'string' ? JSON.parse(row.meseros) : (row.meseros || []),
          features: { ...DEFAULT_FEATURES, ...(typeof row.features === 'string' ? JSON.parse(row.features) : (row.features || {})) },
          iva_rate: row.iva_rate || 0.16,
          data_source: row.data_source || 'supabase',
          logo_url: row.logo_url,
          wansoft_subsidiary_id: row.wansoft_subsidiary_id,
          telegram_chat_ids: row.telegram_chat_ids,
          report_recipients: row.report_recipients,
          menu_categories: row.menu_categories,
          bebida_groups: row.bebida_groups,
          business_context: row.business_context,
          address: row.address,
          phone: row.phone,
          rfc: row.rfc,
          receipt_footer: row.receipt_footer,
          social_media: row.social_media,
          razon_social: row.razon_social,
        }
        _cache[clientId] = config
        _cacheTime = Date.now()
        return config
      }
    }
  } catch { /* fallback to hardcoded */ }

  return getClientConfigFallback(clientId)
}

// ─── Fallback (hardcoded, used if DB unavailable) ───────────────────────────

function getClientConfigFallback(clientId: string): ClientConfig {
  const FALLBACKS: Record<string, Partial<ClientConfig>> = {
    demo: {
      display_name: 'Café Central',
      city: 'San Pedro Garza García, NL',
      type: 'Café & Brunch',
      mesas: 15,
      meseros: ['Ana García', 'Luis Martínez', 'María López', 'Carlos Ruiz', 'Sofía Hernández'],
      data_source: 'demo',
      features: { ...DEFAULT_FEATURES, nomina: false, delivery: false, ecommerce: false, resenas: false, giftCards: false },
    },
  }

  const fb = FALLBACKS[clientId] || {}
  return {
    id: clientId,
    plan: 'fullsite_completo',  // default: full access
    display_name: fb.display_name || clientId,
    city: fb.city || '',
    timezone: 'America/Mexico_City',
    type: fb.type || '',
    default_theme: 'light',
    accent_color: 'emerald',
    mesas: fb.mesas || 16,
    meseros: fb.meseros || [],
    features: fb.features || DEFAULT_FEATURES,
    iva_rate: 0.16,
    data_source: fb.data_source || 'supabase',
    ...fb,
  }
}

// Sync version for immediate use (returns fallback, then updates from DB)
export function getClientConfig(clientId: string): ClientConfig {
  if (_cache[clientId]) return _cache[clientId]
  return getClientConfigFallback(clientId)
}

// Email → client mapping (legacy fallback — source of truth is client_users table)
// Only used when user_metadata.client_id and client_users both miss.
export function getClientIdFromEmail(email: string): string {
  const EMAIL_MAP: Record<string, string> = {
    'demo@fullsite.mx': 'demo',
  }
  return EMAIL_MAP[email] || ''
}
