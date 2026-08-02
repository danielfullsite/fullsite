/**
 * Fullsite Settings Contract
 *
 * Single source of truth for operational settings — values that legitimately vary
 * between clients and where the default is correct for the majority.
 *
 * Architecture:
 *   - getEffectiveSetting() reads from clients.pos_settings JSONB, falls back to registry default
 *   - updateSetting() writes back to clients.pos_settings
 *   - getAllSettings() returns the full snapshot for a client (current + default + metadata)
 *
 * Persistence (v1): clients.pos_settings JSONB column (flat key-value per client).
 * The contract is stable — persistence can evolve to a normalized table without
 * changing any call sites.
 *
 * What belongs here (see docs/bibles/SETTINGS-PHILOSOPHY.md):
 *   - Values that legitimately vary between clients
 *   - Where the default is correct for the majority
 *   - Where the operator understands the impact without a technical manual
 *   - Changing the value does NOT compromise data integrity or the audit trail
 *
 * What does NOT belong here: feature flags (clients.features), permissions (roles),
 * master data catalogs (menu, staff, suppliers), system invariants (audit log, Z numbering).
 */

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// ─── Types ───────────────────────────────────────────────────────────────────

export type SettingScope = 'org' | 'sucursal' | 'terminal' | 'estacion'

interface SettingDefinition<T> {
  default: T
  scope: SettingScope
  /** Problema operativo en español — visible en UI de configuración */
  operationalProblem: string
}

type SettingKey =
  | 'pos.station_routing'
  | 'pos.cancellation_reasons'
  | 'pos.discount_catalog'
  | 'pos.idle_timeout_ms'
  | 'pos.return_to_plano'

type SettingValue<K extends SettingKey> =
  K extends 'pos.station_routing' ? Record<string, string[]> :
  K extends 'pos.cancellation_reasons' ? string[] :
  K extends 'pos.discount_catalog' ? Array<{ id: string; label: string; pct?: number; amount?: number }> :
  K extends 'pos.idle_timeout_ms' ? number :
  K extends 'pos.return_to_plano' ? boolean :
  never

// ─── Registry ────────────────────────────────────────────────────────────────

const REGISTRY: { [K in SettingKey]: SettingDefinition<SettingValue<K>> } = {
  'pos.station_routing': {
    scope: 'sucursal',
    operationalProblem:
      'Un restaurante tiene cocina caliente, barra y panadería en ubicaciones físicas distintas; ' +
      'otro tiene una sola impresora. El routing hardcodeado impide el onboarding de cualquier cliente nuevo.',
    default: {
      // System default — mirrors STATION_CATEGORIES in pos-constants.ts
      // Each key is a category slug; value is the station name
      // Clients override this map to redirect categories to different stations
      cocina: [
        'chilaquiles', 'eggs', 'croissants', 'pancakes', 'paninis',
        'pizzas', 'bowls', 'ceviche', 'toast', 'bakery', 'postres',
        'promos', 'keto', 'kids', 'soups', 'munchies', 'extras', 'envios',
        'enchiladas-tacos', 'salads-ceviche', 'appetizers', 'evento', 'signature',
      ],
      barra: [
        'coffee', 'jugos', 'fresh', 'smoothies', 'frappes',
        'sodas', 'tea', 'alcohol', 'activaciones', 'vinos', 'cerveza', 'licores',
      ],
      caja: [
        'icecream', 'desserts',
      ],
    } as Record<string, string[]>,
  },

  'pos.cancellation_reasons': {
    scope: 'sucursal',
    operationalProblem:
      'Cada restaurante tiene sus propias razones de cancelación. El texto libre genera inconsistencia ' +
      'en reportes y dificulta detectar patrones de fraude. Un catálogo configurable permite análisis real.',
    default: [
      'Error de captura',
      'Cliente canceló',
      'Platillo no disponible',
      'Orden duplicada',
      'Otro',
    ],
  },

  'pos.discount_catalog': {
    scope: 'sucursal',
    operationalProblem:
      'Los porcentajes y nombres de descuento son específicos de cada restaurante. ' +
      'Sin catálogo configurable, los descuentos quedan hardcodeados para un solo cliente.',
    default: [],  // No discounts by default — each client configures their own
  },

  'pos.idle_timeout_ms': {
    scope: 'sucursal',
    operationalProblem:
      'Un restaurante de alta rotación con meseros compartiendo terminal necesita bloqueo en 5 min. ' +
      'Un restaurante con terminal dedicada por mesero puede tolerar 30 min. ' +
      '30 minutos hardcodeados no es correcto para todos.',
    default: 30 * 60 * 1000,  // 30 minutes in ms
  },

  'pos.return_to_plano': {
    scope: 'sucursal',
    operationalProblem:
      'La mayoría prefiere regresar al plano post-envío para atender otras mesas desde el mapa. ' +
      'Algunos operadores con flujo de lista prefieren /pos/mesas.',
    default: true,
  },
}

// ─── Cache ───────────────────────────────────────────────────────────────────

// In-memory cache: clientId → { settings: object, fetchedAt: timestamp }
const _settingsCache: Record<string, { data: Record<string, unknown>; fetchedAt: number }> = {}
const SETTINGS_CACHE_TTL = 5 * 60 * 1000  // 5 min — same as client-config

async function _fetchRaw(clientId: string): Promise<Record<string, unknown>> {
  const cached = _settingsCache[clientId]
  if (cached && Date.now() - cached.fetchedAt < SETTINGS_CACHE_TTL) {
    return cached.data
  }
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=pos_settings&limit=1`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, cache: 'no-store' }
    )
    if (res.ok) {
      const rows = await res.json()
      const data: Record<string, unknown> = (rows[0]?.pos_settings) || {}
      _settingsCache[clientId] = { data, fetchedAt: Date.now() }
      return data
    }
  } catch { /* fall through to defaults */ }
  return {}
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolve the effective value of a setting for a client.
 * Resolution order: clients.pos_settings[key] → registry default.
 * Always returns a value — never throws.
 */
export async function getEffectiveSetting<K extends SettingKey>(
  clientId: string,
  key: K
): Promise<SettingValue<K>> {
  const raw = await _fetchRaw(clientId)
  const def = REGISTRY[key] as SettingDefinition<SettingValue<K>>
  const stored = raw[key]
  return (stored !== undefined ? stored : def.default) as SettingValue<K>
}

/**
 * Update a setting for a client.
 * Writes to clients.pos_settings via merge-patch (preserves other settings).
 * Requires: the calling API route must validate permissions (dueño/gerente).
 */
export async function updateSetting(
  clientId: string,
  key: SettingKey,
  value: unknown,
  authToken: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const raw = await _fetchRaw(clientId)
    const next = { ...raw, [key]: value }
    const res = await fetch(
      `${SB_URL}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SB_KEY,
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ pos_settings: next }),
      }
    )
    if (!res.ok) return { ok: false, error: `DB error ${res.status}` }
    // Invalidate cache after write
    delete _settingsCache[clientId]
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

/**
 * Return all settings for a client — current effective values + registry defaults + metadata.
 * Used by the settings UI page.
 */
export async function getAllSettings(clientId: string): Promise<Array<{
  key: SettingKey
  value: unknown
  default: unknown
  scope: SettingScope
  operationalProblem: string
  isOverridden: boolean
}>> {
  const raw = await _fetchRaw(clientId)
  return (Object.keys(REGISTRY) as SettingKey[]).map(key => {
    const def = REGISTRY[key]
    const stored = raw[key]
    return {
      key,
      value: stored !== undefined ? stored : def.default,
      default: def.default,
      scope: def.scope,
      operationalProblem: def.operationalProblem,
      isOverridden: stored !== undefined,
    }
  })
}

/** Invalidate the in-memory cache for a client (call after writes from server routes). */
export function invalidateSettingsCache(clientId: string): void {
  delete _settingsCache[clientId]
}
