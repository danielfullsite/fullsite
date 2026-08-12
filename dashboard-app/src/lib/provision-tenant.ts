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
  template?: OnboardingTemplate // optional override; defaults to code template
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
  }
}

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''

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
 * Provision a full tenant skeleton. Fail-closed: throws if no service key.
 */
export async function provisionTenant(input: ProvisionInput): Promise<ProvisionResult> {
  const { clientId } = input
  if (!clientId) throw new Error('[provision] clientId required')
  if (!SB_URL) throw new Error('[provision] NEXT_PUBLIC_SUPABASE_URL not configured')
  if (!serviceKey()) throw new Error('[provision] SUPABASE_SERVICE_KEY not configured')

  const tpl = input.template || DEFAULT_ONBOARDING_TEMPLATE
  const displayName = input.display_name || clientId
  const mesas = input.mesas ?? 10

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
    features: JSON.stringify(DEFAULT_FEATURES),
    mesas,
    data_source: 'fullsite',
    // 'plan' NO es columna real de `clients` (validado contra el esquema en staging) → no se escribe.
  }])

  // ── 2. default location ────────────────────────────────────────────────────
  const locationsCount = await upsert('client_locations', [{
    id: `${clientId}-principal`,
    client_id: clientId,
    name: 'Principal',
    address: '',
    active: true,
  }])

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
    },
  }
}
