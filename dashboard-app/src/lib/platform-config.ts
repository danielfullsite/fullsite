// Control Plane · capa GLOBAL-PLATAFORMA (Fase 2): la app LEE flags/settings globales.
//
// feature_flags y platform_settings son filas GLOBALES (sin client_id) con RLS de lectura
// pública (config no sensible). Por eso se leen con la anon key desde cualquier tenant.
// Consecuencia clave: el admin cambia UNA fila y TODOS los tenants la ven ("cambio de Instagram").
// La ESCRITURA vive solo en endpoints /api/platform/* con service_role.

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export interface FeatureFlag {
  key: string
  enabled: boolean
  rollout: { cohort?: string; client_ids?: string[]; percentage?: number }
}

export interface PlatformConfig {
  flags: Record<string, FeatureFlag>
  settings: Record<string, unknown>
}

let _cache: { data: PlatformConfig; at: number } | null = null
const TTL_MS = 60_000

/** Lee la config global (flags + settings). Cacheada 60s. Nunca lanza. */
export async function getPlatformConfig(force = false): Promise<PlatformConfig> {
  if (!force && _cache && Date.now() - _cache.at < TTL_MS) return _cache.data
  const headers = { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}` }
  try {
    const [f, s] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/feature_flags?select=key,enabled,rollout`, { headers }).then((r) => (r.ok ? r.json() : [])),
      fetch(`${SB_URL}/rest/v1/platform_settings?select=key,value`, { headers }).then((r) => (r.ok ? r.json() : [])),
    ])
    const flags: Record<string, FeatureFlag> = {}
    for (const row of Array.isArray(f) ? f : []) flags[row.key] = row
    const settings: Record<string, unknown> = {}
    for (const row of Array.isArray(s) ? s : []) settings[row.key] = row.value
    const data: PlatformConfig = { flags, settings }
    _cache = { data, at: Date.now() }
    return data
  } catch {
    return _cache?.data ?? { flags: {}, settings: {} }
  }
}

/**
 * Evalúa un feature flag para un tenant (cohorte).
 * - enabled=false → false para todos.
 * - rollout.client_ids → solo esos tenants (cohorte).
 * - rollout.percentage → hash estable del clientId contra el %.
 * - por defecto (cohort 'all') → todos los tenants.
 */
export function isEnabledForTenant(flag: FeatureFlag | undefined, clientId: string): boolean {
  if (!flag || !flag.enabled) return false
  const r = flag.rollout || {}
  if (Array.isArray(r.client_ids)) return r.client_ids.includes(clientId)
  if (typeof r.percentage === 'number') {
    let h = 0
    for (let i = 0; i < clientId.length; i++) h = (h * 31 + clientId.charCodeAt(i)) >>> 0
    return h % 100 < r.percentage
  }
  return true // cohort 'all'
}

/** Azúcar: ¿está el flag `key` activo para `clientId`? */
export async function isFeatureEnabled(key: string, clientId: string): Promise<boolean> {
  const { flags } = await getPlatformConfig()
  return isEnabledForTenant(flags[key], clientId)
}

/** Lee un platform_setting global por key. */
export async function getPlatformSetting<T = unknown>(key: string): Promise<T | undefined> {
  const { settings } = await getPlatformConfig()
  return settings[key] as T | undefined
}
