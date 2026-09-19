// Tenant provisioning — Control Plane domain module (Fase 3).
//
// Contract: `provisionTenant()` is the single reusable entry point for "dar de alta"
// a new tenant. Given a clientId + brand, it clones a FULL tenant skeleton
// (clients row, default location, menu, payment methods, role placeholders) from the
// global onboarding template. It is:
//   - RESUMABLE: inserts preserve existing rows, including defaults the tenant
//     has edited. A new tenant stays inactive until every required step succeeds.
//   - MULTI-TENANT SAFE: every seeded row carries client_id = clientId. Nothing
//     global is mutated.
//   - SERVICE-ROLE ONLY: uses SUPABASE_SERVICE_KEY via PostgREST fetch. NEVER the
//     Supabase SDK (hangs in App Router), NEVER the anon key.
//
// Table/column shapes mirror seeds/_lib/seed-restaurant.ts exactly. This module is
// the domain owner — routes MUST call it rather than inline provisioning logic.

import { DEFAULT_ONBOARDING_TEMPLATE, type OnboardingTemplate } from './onboarding-template'
import type { ClientFeatures } from './client-config'
import { resolveVerticalPreset, type VerticalId } from './vertical-presets'
import { randomInt } from 'node:crypto'

// Kept in sync with DEFAULT_FEATURES in src/lib/client-config.ts (which is not
// exported). New tenants get the standard feature set.
const DEFAULT_FEATURES: ClientFeatures = {
  pos: true, posRestaurant: true, posTienda: false, bakery_station: false, delivery: false,
  ecommerce: false, inventory: true, foodCost: true, facturacion: true,
  nomina: false, agentesIA: true, coach: true, chatIA: true,
  resenas: false, giftCards: false,
}

export interface ProvisionInput {
  clientId: string
  display_name?: string
  accent_color?: string
  default_theme?: 'light' | 'dark'
  logo_url?: string
  plan?: string
  mesas?: number
  locations?: Array<{ id?: string; name: string; address?: string }>
  template?: OnboardingTemplate // optional override; defaults to code template
  /** Tipo de restaurante — resuelve un preset de src/lib/vertical-presets.ts
   *  (features + menú semilla + mesas). Ver docs/strategy/BIBLE-SQUARE.md. */
  vertical?: VerticalId
  /** Platform onboarding activates only after owner and service memberships. */
  deferActivation?: boolean
}

export interface ProvisionResult {
  clientId: string
  created: {
    clients: number
    client_locations: number
    pos_menu_categories: number
    pos_menu_items: number
    pos_payment_methods: number
    pos_staff: number
    pos_mesas: number
    pos_combos: number
    pos_mutation_authority: number
    pos_item_inventory_policy: number
  }
  /** Campo legacy: ahora siempre vacío; las plantillas nuevas están inactivas. */
  staffPins: Array<{ role: string; pin: string }>
  staffSetupRequired: boolean
  activationPending: boolean
}

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''

function slugifyLocation(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function serviceKey(): string {
  // service_role ONLY — never fall back to anon for writes.
  return process.env.SUPABASE_SERVICE_KEY || ''
}

/**
 * PIN determinístico de 10 dígitos a partir de una semilla (tenant:rol).
 * FNV-1a doble pasada → 10 dígitos, primer dígito nunca 0. No es secreto
 * criptográfico. Se conserva sólo para detectar plantillas legacy pendientes
 * de rotación; el alta nueva nunca usa este valor como credencial.
 */
export function deterministicPin10(seed: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < seed.length; i++) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ seed.charCodeAt(seed.length - 1 - i), 0x01000193) >>> 0
  }
  // 9 dígitos mezclando ambos hashes sin productos de 64 bits (precisión JS).
  const nine = String(h1 % 100000).padStart(5, '0') + String(h2 % 10000).padStart(4, '0')
  const first = String((h1 % 9) + 1) // 1-9: nunca empieza en 0
  return first + nine
}

/** Legacy detection only. This predictable value is never issued by new seeds. */
export function isUnrotatedTemplatePin(clientId: string, staff: { id: string; name: string; role: string }, pin: unknown): boolean {
  if (typeof pin !== 'string' || pin !== deterministicPin10(`${clientId}:${staff.role}`)) return false
  return staff.id === `${clientId}-${pin}` || /\(plantilla\)\s*$/i.test(staff.name)
}

function headers() {
  const key = serviceKey()
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    // Idempotent upsert on the table's primary key.
    Prefer: 'resolution=ignore-duplicates,return=representation',
  }
}

/** ¿Cuántas filas tiene `table` para este client? (para siembras idempotentes por conteo). */
async function countFor(table: string, clientId: string, extraFilter = ''): Promise<number> {
  const res = await fetch(
    `${SB_URL}/rest/v1/${table}?client_id=eq.${encodeURIComponent(clientId)}&select=id${extraFilter}`,
    { headers: { ...headers(), Prefer: 'count=exact', Range: '0-0' }, cache: 'no-store' }
  )
  if (!res.ok) throw new Error(`[provision] count ${table} failed (${res.status})`)
  const range = res.headers.get('content-range')
  if (range) { const total = Number(range.split('/')[1]); if (Number.isFinite(total)) return total }
  const rows = await res.json()
  if (!Array.isArray(rows)) throw new Error(`[provision] count ${table} invalid response`)
  return rows.length // Only zero/nonzero is used when exact count is unavailable.
}

async function insertRows(table: string, rows: Record<string, unknown>[]): Promise<number> {
  if (rows.length === 0) return 0
  const res = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'return=minimal' },
    body: JSON.stringify(rows),
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`[provision] insert ${table} failed (${res.status})`)
  }
  return rows.length
}

async function upsert(table: string, rows: Record<string, unknown>[]): Promise<number> {
  if (rows.length === 0) return 0
  const res = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(rows),
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`[provision] upsert ${table} failed (${res.status})`)
  }
  const inserted = await res.json()
  if (!Array.isArray(inserted)) throw new Error(`[provision] insert ${table} invalid receipt`)
  return inserted.length
}

/**
 * Upsert resolving on a NON-primary-key unique constraint. Needed for tables
 * whose PK is a serial id but whose logical identity is (client_id, ...): the
 * default merge-duplicates resolves on the serial PK (never conflicts → dup on
 * re-run). `on_conflict` tells PostgREST which unique index to merge on.
 */
async function upsertOnConflict(table: string, rows: Record<string, unknown>[], conflictCols: string): Promise<number> {
  if (rows.length === 0) return 0
  const res = await fetch(`${SB_URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(conflictCols)}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(rows),
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`[provision] upsert ${table} (on_conflict=${conflictCols}) failed (${res.status})`)
  }
  const inserted = await res.json()
  if (!Array.isArray(inserted)) throw new Error(`[provision] insert ${table} invalid receipt`)
  return inserted.length
}

/** Final gate; cannot reactivate an intentionally disabled existing tenant. */
export async function activateProvisionedTenant(clientId: string): Promise<void> {
  const response = await fetch(`${SB_URL}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=id,active,pos_settings&limit=1`, { headers: headers(), cache: 'no-store' })
  if (!response.ok) throw new Error('[provision] cannot verify activation')
  const rows = await response.json()
  const client = Array.isArray(rows) ? rows[0] : null
  if (!client) throw new Error('[provision] client missing before activation')
  if (client.active) return
  const settings = client.pos_settings || {}
  if (settings['onboarding.provisioning']?.state !== 'pending') throw new Error('[provision] existing tenant is disabled; explicit activation required')
  const updated = await fetch(`${SB_URL}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&active=eq.false`, {
    method: 'PATCH', headers: { ...headers(), Prefer: 'return=representation' },
    body: JSON.stringify({ active: true, pos_settings: { ...settings, 'onboarding.provisioning': { state: 'complete', completed_at: new Date().toISOString() } } }), cache: 'no-store',
  })
  if (!updated.ok) throw new Error('[provision] activation failed')
  const receipt = await updated.json()
  if (!Array.isArray(receipt) || receipt.length !== 1 || receipt[0].active !== true) throw new Error('[provision] activation not confirmed')
}

/**
 * Provision a full tenant skeleton. Fail-closed: throws if no service key.
 */
export async function provisionTenant(input: ProvisionInput): Promise<ProvisionResult> {
  const { clientId } = input
  if (!/^[a-z0-9_-]{1,40}$/i.test(clientId)) throw new Error('[provision] valid clientId required')
  if (!SB_URL) throw new Error('[provision] NEXT_PUBLIC_SUPABASE_URL not configured')
  if (!serviceKey()) throw new Error('[provision] SUPABASE_SERVICE_KEY not configured')

  const preset = input.vertical ? resolveVerticalPreset(input.vertical) : null

  // ¿El tenant ya existe? Los umbrales día-0 (Lazo 1) solo se siembran en el
  // alta ORIGINAL: un re-provision no debe pisar pos_settings que el tenant o
  // el tuner (Lazo 2) ya ajustaron.
  const chk = await fetch(`${SB_URL}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=id,active,pos_settings&limit=1`,
    { headers: headers(), cache: 'no-store' })
  if (!chk.ok) throw new Error('[provision] cannot verify existing tenant')
  const existingRows = await chk.json()
  if (!Array.isArray(existingRows)) throw new Error('[provision] invalid existing tenant response')
  const clientExists = existingRows.length > 0

  const tpl = input.template || preset?.template || DEFAULT_ONBOARDING_TEMPLATE
  const displayName = input.display_name || clientId
  const mesas = input.mesas ?? preset?.defaultMesas ?? 10
  const features: ClientFeatures = preset
    ? { ...DEFAULT_FEATURES, ...preset.features }
    : DEFAULT_FEATURES

  // ── 1. clients row ─────────────────────────────────────────────────────────
  const clientsCount = await upsert('clients', [{
    id: clientId,
    display_name: displayName,
    accent_color: input.accent_color || 'emerald',
    default_theme: input.default_theme || 'light',
    logo_url: input.logo_url || null,
    iva_rate: 0.16,
    timezone: 'America/Mexico_City',
    active: false,
    features: JSON.stringify(features),
    mesas,
    // Tipo de restaurante (vertical preset). Columna `type` ya existe en `clients`.
    ...(input.vertical ? { type: input.vertical } : {}),
    // Lazo 1 (docs/ai/APRENDIZAJE-AGENTES-DESIGN.md): umbrales de industria del
    // vertical como prior de los agentes — SOLO en el alta original, para no
    // pisar ajustes del tenant/tuner en un re-provision.
    pos_settings: {
      'onboarding.provisioning': { state: 'pending', started_at: new Date().toISOString() },
      ...(!clientExists && preset ? { 'agents.thresholds': { ...preset.thresholds, source: `vertical:${preset.id}`, seeded_at: new Date().toISOString() } } : {}),
    },
    data_source: 'fullsite',
    // Requerido por el cálculo de día de negocio (ops_aggregate.get_business_day_config).
    // Sin esto, los agentes de IA crashean para el clon. Default 05:00 (día empieza a las 5am).
    business_day_start_local: '05:00:00',
    // 'plan' NO es columna real de `clients` (validado contra el esquema en staging) → no se escribe.
  }])

  // ── 2. default location ────────────────────────────────────────────────────
  const locationInputs = input.locations?.length
    ? input.locations
    : [{ id: `${clientId}-principal`, name: 'Principal', address: '' }]
  const locationRows = locationInputs.map((location, index) => ({
    id: location.id || `${clientId}-${slugifyLocation(location.name) || `sucursal-${index + 1}`}`,
    client_id: clientId,
    name: location.name.trim(),
    address: location.address?.trim() || '',
    active: true,
  }))
  if (new Set(locationRows.map(location => location.id)).size !== locationRows.length) throw new Error('[provision] duplicate location ids')
  for (const location of locationRows) {
    if (!/^[\w-]{1,100}$/.test(location.id)) throw new Error('[provision] invalid location id')
    const check = await fetch(`${SB_URL}/rest/v1/client_locations?id=eq.${encodeURIComponent(location.id)}&select=id,client_id`, { headers: headers(), cache: 'no-store' })
    if (!check.ok) throw new Error('[provision] cannot verify location ownership')
    const found = await check.json()
    if (!Array.isArray(found) || found.some(row => row.client_id !== clientId)) throw new Error('[provision] location belongs to another tenant')
  }
  const locationsCount = await upsert('client_locations', locationRows)

  // ── 3. menu categories + items ─────────────────────────────────────────────
  const catRows = tpl.menu.map(cat => ({
    id: `${clientId}-${cat.idSuffix}`,
    client_id: clientId,
    name: cat.name,
    color: cat.color,
    sort_order: cat.sort_order,
    active: true,
  }))
  const catsCount = await upsert('pos_menu_categories', catRows)

  const itemRows = tpl.menu.flatMap(cat =>
    cat.items.map(item => ({
      id: `${clientId}-${item.idSuffix}`,
      client_id: clientId,
      category_id: `${clientId}-${cat.idSuffix}`,
      name: item.name,
      price: item.price,
      sort_order: item.sort_order,
      active: true,
    }))
  )
  const itemsCount = await upsert('pos_menu_items', itemRows)

  // ── 4. payment methods ─────────────────────────────────────────────────────
  const pmRows = tpl.paymentMethods.map((pm, i) => ({
    id: `${clientId}-pm-${i}`,
    client_id: clientId,
    name: pm.name,
    type: pm.type,
    commission_pct: pm.commission_pct,
    fiscal_code: pm.fiscal_code || '',
    active: true,
  }))
  const pmCount = await upsert('pos_payment_methods', pmRows)

  // ── 5. role placeholders (pos_staff) ───────────────────────────────────────
  // One placeholder staff row per role so the new tenant has a starting role set.
  // Placeholders do not authenticate: inactive, random unexposed PIN. The owner
  // must assign a real employee and rotate their PIN before activation. Existing
  // employees/PINs are preserved, including installations created by older builds.
  let staffCount = 0
  const staffPins: Array<{ role: string; pin: string }> = []
  if ((await countFor('pos_staff', clientId)) === 0) {
    const staffRows = tpl.roles.map((role) => {
      const pin = String(randomInt(1_000_000_000, 10_000_000_000))
      return {
        id: `${clientId}-template-${role}`,
        client_id: clientId,
        name: `${role} (plantilla)`,
        pin,
        role,
        role_display: role,
        active: false,
        hourly_rate: 0,
        weekly_salary: 0,
      }
    })
    staffCount = await upsert('pos_staff', staffRows)
  }

  // ── 5b. combos semilla (pos_combos) ────────────────────────────────────────
  // Sin esto, el speed screen de un tenant counter nace vacío (gap Minute-0 #12
  // — visto en campo con carls-jr, cuyos combos se sembraron a mano el
  // 2026-08-29; este bloque hace lo mismo para todo tenant nuevo). Idempotente
  // por conteo: un re-provision no duplica ni pisa combos editados.
  let combosCount = 0
  if (preset?.combos?.length && (await countFor('pos_combos', clientId)) === 0) {
    const comboRows = preset.combos.map(c => ({
      id: `${clientId}-${c.idSuffix}`,
      client_id: clientId,
      name: c.name,
      price: c.price,
      items: c.items.map(it => ({
        menu_item_id: `${clientId}-${it.itemIdSuffix}`,
        name: it.name,
        substitutions: (it.substitutions || []).map(s => ({ id: `${clientId}-${s.itemIdSuffix}`, name: s.name })),
      })),
      upsell: c.upsell || null,
      active: true,
      schedule: null,
    }))
    combosCount = await upsert('pos_combos', comboRows)
  }

  // ── 6. mesas (floor plan) ──────────────────────────────────────────────────
  // Sin esto el POS del tenant nuevo abre con plano vacío (no se puede sentar
  // ni cobrar en mesa). Se siembra SOLO si el tenant aún no tiene mesas
  // (idempotente por conteo, ya que pos_mesas.id es uuid autogenerado).
  let mesasCount = 0
  if (mesas > 0 && (await countFor('pos_mesas', clientId)) === 0) {
    const PER_ROW = 5
    const mesaRows = Array.from({ length: mesas }, (_, i) => {
      const n = i + 1
      const col = i % PER_ROW
      const row = Math.floor(i / PER_ROW)
      return {
        client_id: clientId,
        number: n,
        capacity: 4,
        zone: 'Principal',
        x_pct: Math.min(92, 10 + col * 19),
        y_pct: Math.min(88, 14 + row * 20),
        shape: n % 3 === 0 ? 'round' : 'square',
        sort_order: n,
        active: true,
      }
    })
    mesasCount = await insertRows('pos_mesas', mesaRows)
  }

  // ── 7. inventory deduction gates (SKEL04 · A1) ─────────────────────────────
  // Sin estos dos gates la deducción de stock NUNCA corre para un tenant nuevo
  // (r1_reconcile_item, 004_functions.sql):
  //   • pos_mutation_authority.sale_authority DEBE ser 'r1'. Sin fila el default
  //     es 'legacy' → cada item cae en BLOCKED_OWNER_MISSING.
  //   • pos_item_inventory_policy DEBE existir por menu_item con inventory_mode
  //     != 'unclassified'. Sin fila → BLOCKED_UNCLASSIFIED.
  // Default por item = 'non_inventory': la venta reconcilia limpio
  // (NO_MUTATION_APPROVED) SIN descontar, hasta que el cliente capture una receta
  // (que flipa la policy del item a 'recipe' — ver setItemRecipe en pos-data).
  // Así nunca se bloquea la venta ni se "miente" descontando algo que no existe.
  const nowIso = new Date().toISOString()

  const authorityCount = await upsert('pos_mutation_authority', [{
    client_id: clientId,
    sale_authority: 'r1',
    cutover_at: nowIso,
    cutover_by: 'provision',
  }])

  const policyRows = itemRows.map(it => ({
    client_id: clientId,
    menu_item_id: it.id,
    inventory_mode: 'non_inventory',
    approved_at: nowIso,
    approved_by: 'provision',
  }))
  const policyCount = await upsertOnConflict(
    'pos_item_inventory_policy', policyRows, 'client_id,menu_item_id'
  )

  const staffSetupRequired = (await countFor('pos_staff', clientId, '&active=eq.true')) === 0
  if (!input.deferActivation) await activateProvisionedTenant(clientId)

  return {
    clientId,
    created: {
      clients: clientsCount,
      client_locations: locationsCount,
      pos_menu_categories: catsCount,
      pos_menu_items: itemsCount,
      pos_payment_methods: pmCount,
      pos_staff: staffCount,
      pos_mesas: mesasCount,
      pos_combos: combosCount,
      pos_mutation_authority: authorityCount,
      pos_item_inventory_policy: policyCount,
    },
    staffPins,
    staffSetupRequired,
    activationPending: !clientExists || (!existingRows[0].active && existingRows[0].pos_settings?.['onboarding.provisioning']?.state === 'pending'),
  }
}
