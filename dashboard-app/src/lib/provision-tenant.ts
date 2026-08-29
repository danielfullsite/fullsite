// Tenant provisioning — Control Plane domain module (Fase 3).
//
// Contract: `provisionTenant()` is the single reusable entry point for "dar de alta"
// a new tenant. Given a clientId + brand, it clones a FULL tenant skeleton
// (clients row, default location, menu, payment methods, role placeholders) from the
// global onboarding template. It is:
//   - IDEMPOTENT: every write is an UPSERT keyed on a deterministic id
//     (Prefer: resolution=merge-duplicates). Re-running yields the same tenant.
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
    pos_mutation_authority: number
    pos_item_inventory_policy: number
  }
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

function headers() {
  const key = serviceKey()
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    // Idempotent upsert on the table's primary key.
    Prefer: 'resolution=merge-duplicates,return=minimal',
  }
}

/** ¿Cuántas filas tiene `table` para este client? (para siembras idempotentes por conteo). */
async function countFor(table: string, clientId: string): Promise<number> {
  const res = await fetch(
    `${SB_URL}/rest/v1/${table}?client_id=eq.${encodeURIComponent(clientId)}&select=id`,
    { headers: { ...headers(), Prefer: 'count=exact', Range: '0-0' }, cache: 'no-store' }
  )
  const range = res.headers.get('content-range')
  if (range) { const total = range.split('/')[1]; return total === '*' ? 0 : parseInt(total, 10) }
  return 0
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
    const detail = await res.text().catch(() => '')
    throw new Error(`[provision] insert ${table} failed (${res.status}): ${detail}`)
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
    const detail = await res.text().catch(() => '')
    throw new Error(`[provision] upsert ${table} failed (${res.status}): ${detail}`)
  }
  return rows.length
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
    const detail = await res.text().catch(() => '')
    throw new Error(`[provision] upsert ${table} (on_conflict=${conflictCols}) failed (${res.status}): ${detail}`)
  }
  return rows.length
}

/**
 * Provision a full tenant skeleton. Fail-closed: throws if no service key.
 */
export async function provisionTenant(input: ProvisionInput): Promise<ProvisionResult> {
  const { clientId } = input
  if (!clientId) throw new Error('[provision] clientId required')
  if (!SB_URL) throw new Error('[provision] NEXT_PUBLIC_SUPABASE_URL not configured')
  if (!serviceKey()) throw new Error('[provision] SUPABASE_SERVICE_KEY not configured')

  const preset = input.vertical ? resolveVerticalPreset(input.vertical) : null
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
    active: true,
    features: JSON.stringify(features),
    mesas,
    // Tipo de restaurante (vertical preset). Columna `type` ya existe en `clients`.
    ...(input.vertical ? { type: input.vertical } : {}),
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
  // Deterministic id + pin per role keeps this idempotent. Shape mirrors
  // seed-restaurant.ts pos_staff (id = `${clientId}-${pin}`).
  const staffRows = tpl.roles.map((role, i) => {
    const pin = String(1001 + i)
    return {
      id: `${clientId}-${pin}`,
      client_id: clientId,
      name: `${role} (plantilla)`,
      pin,
      role,
      role_display: role,
      active: true,
      hourly_rate: 0,
      weekly_salary: 0,
    }
  })
  const staffCount = await upsert('pos_staff', staffRows)

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
      pos_mutation_authority: authorityCount,
      pos_item_inventory_policy: policyCount,
    },
  }
}
