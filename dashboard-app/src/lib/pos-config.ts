// POS Client Configuration — singleton cache for receipt printing, IVA, branding
// Loaded once per session from Supabase `clients` table via fetchClientConfig()

import { fetchClientConfig } from './client-config'
import { getActiveClientSlug } from '@/lib/data'

export interface PosClientConfig {
  name: string         // "AMALAY"
  subtitle: string     // "Coffee & Market"
  address: string      // "San Pedro Garza Garcia, NL"
  phone: string        // "8115324371"
  rfc: string          // "AFO200806JI0"
  ivaRate: number      // 0 (AMALAY: precios incluyen IVA)
  receiptFooter: string // "Gracias por tu visita!"
  logoUrl: string      // URL to logo image for tickets
  socialMedia: string  // "@amalay.mx" or similar
  razonSocial: string  // Legal name for fiscal purposes
}

let _posConfig: PosClientConfig | null = null

/** Get POS config (cached singleton). Call once at POS startup. */
export async function getPosClientConfig(): Promise<PosClientConfig> {
  if (_posConfig) return _posConfig

  const clientId = typeof window !== 'undefined'
    ? getActiveClientSlug()
    : 'amalay'

  const config = await fetchClientConfig(clientId)

  _posConfig = {
    name: config.display_name, // "AMALAY Coffee & Market"
    subtitle: config.type || '',
    address: config.address || config.city || '',
    phone: config.phone || '',
    rfc: config.rfc || '',
    ivaRate: config.iva_rate,
    receiptFooter: config.receipt_footer || 'Gracias por tu visita!',
    logoUrl: config.logo_url || '',
    socialMedia: config.social_media || '',
    razonSocial: config.razon_social || '',
  }

  return _posConfig
}

/** Sync version — returns cached config or default. Use getPosClientConfig() for initial load. */
export function getPosConfigSync(): PosClientConfig {
  return _posConfig || {
    name: 'AMALAY',
    subtitle: 'Coffee & Market',
    address: 'San Pedro Garza Garcia, NL',
    phone: '',
    rfc: '',
    ivaRate: 0,
    receiptFooter: 'Gracias por tu visita!',
    logoUrl: '',
    socialMedia: '',
    razonSocial: '',
  }
}

/** Clear cache (for testing or client switch) */
export function clearPosConfig() { _posConfig = null }
