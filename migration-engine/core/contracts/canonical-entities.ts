// 16 canonical entity types for Migration Engine v3.
// Status annotation reflects schema audit 2026-07-27 (docs/architecture/entity-schema-matrix.md).

// VERIFIED — clients + client_locations
export interface CanonicalRestaurant {
  source_id: string
  name: string
  slug: string
  phone?: string
  address?: string
  timezone: string
  locale: string
}

// NOT_IMPLEMENTED — areas are zone TEXT in pos_mesas; no separate area table.
// Zone migrates as an attribute of CanonicalTable.
export type CanonicalArea = { readonly _status: 'NOT_IMPLEMENTED' }

// VERIFIED — pos_mesas (dashboard-app/migrations/004_pos_mesas.sql)
export interface CanonicalTable {
  source_id: string
  number: number
  capacity: number
  zone: string | null
  x_pct: number
  y_pct: number
  shape: string
  sort_order: number
  active: boolean
}

// VERIFIED — pos_menu_categories
export interface CanonicalCategory {
  source_id: string
  name: string
  color?: string
  sort_order: number
  active: boolean
}

// VERIFIED — pos_menu_items
export interface CanonicalProduct {
  source_id: string
  category_source_id: string
  name: string
  price: number
  barcode?: string
  sort_order: number
  active: boolean
  aplica_2x1?: boolean
  aplica_descuento?: boolean
  aplica_cortesia?: boolean
}

// PARTIAL — pos_item_modifier_groups is a junction table (item_id → group_id) only;
// no master modifier-group entity table exists.
export interface CanonicalModifierGroup {
  source_id: string       // group_id TEXT
  item_source_id: string  // item this group applies to
  name?: string           // not persisted in a master table; informational only
}

// PARTIAL — pos_modifiers; group_id is TEXT (no FK to a master group table).
export interface CanonicalModifier {
  source_id: string
  group_source_id: string
  name: string
  price: number
  sort_order: number
  active: boolean
}

// NOT_IMPLEMENTED — KDS stations are compile-time constants in pos-constants.ts;
// no Supabase table. Manual setup required per Electron deployment.
export type CanonicalKDSStation = { readonly _status: 'NOT_IMPLEMENTED' }

// NOT_IMPLEMENTED — printer config in localStorage + local bridge;
// pos_print_jobs is a job log, not a printer registry.
export type CanonicalPrinter = { readonly _status: 'NOT_IMPLEMENTED' }

// VERIFIED — pos_suppliers (clave_wansoft TEXT enables migration lookup)
export interface CanonicalSupplier {
  source_id: string
  name: string
  contact?: string
  phone?: string
  email?: string
  rfc?: string
  giro?: string
  payment_terms?: number
  delivery_days?: number
  expense_type?: string
  clave_wansoft?: string
  authorized: boolean
}

// PARTIAL — two overlapping systems: pos_ingredients (recipe system, id TEXT, SAT keys)
// and pos_inventory_products (purchase tracking, id BIGSERIAL, stock column).
// Commit adapter writes to both where applicable.
export interface CanonicalIngredient {
  source_id: string
  name: string
  unit: string
  cost_per_unit?: number
  category?: string
  supplier_source_id?: string
  sat_product_key?: string
  sat_unit_key?: string
  reorder_point?: number
  stock?: number
}

// PARTIAL — no unit-master table; pos_unit_conversions stores conversion factors only.
// Unit names are TEXT in product/ingredient records (not FK-enforced).
export interface CanonicalUnit {
  source_id: string
  from_unit: string
  to_unit: string
  factor: number
  is_system: boolean
}

export interface CanonicalRecipeLine {
  ingredient_source_id: string
  quantity: number
  recipe_unit?: string
}

// PARTIAL — pos_recipe_versions + pos_recipe_lines.
// Commit adapter must write version first, then lines.
export interface CanonicalRecipe {
  source_id: string
  menu_item_source_id: string
  version: number
  lines: CanonicalRecipeLine[]
  notes?: string
  created_by: string
}

// PARTIAL — clients (rfc, razon_social, regimen_fiscal, cp, domicilio_fiscal)
// and pos_billing_clients (multi-RFC support). Facturama API credentials are external config.
// is_primary=true → clients table; is_primary=false → pos_billing_clients.
export interface CanonicalFiscalConfig {
  source_id: string
  rfc: string
  razon_social?: string
  regimen_fiscal?: string
  codigo_postal?: string
  email?: string
  uso_cfdi?: string
  is_primary: boolean
}

// PARTIAL — pos_staff.pin is NOT NULL. Engine must NOT transport PINs.
// Commit adapter writes pin='MIGRATION_PENDING'. requires_credential_enrollment=true
// signals the restaurant to re-enroll staff PINs after cutover.
export interface CanonicalStaff {
  source_id: string
  name: string
  role: string
  active: boolean
  requires_credential_enrollment: true  // always true during migration
}

// PARTIAL — stock is an attribute of pos_inventory_products, not a separate entity table.
export interface CanonicalStockBalance {
  source_id: string   // references CanonicalIngredient source_id
  stock: number
  unit: string
}

export type CanonicalEntityType =
  | 'CanonicalRestaurant'
  | 'CanonicalArea'
  | 'CanonicalTable'
  | 'CanonicalCategory'
  | 'CanonicalProduct'
  | 'CanonicalModifierGroup'
  | 'CanonicalModifier'
  | 'CanonicalKDSStation'
  | 'CanonicalPrinter'
  | 'CanonicalSupplier'
  | 'CanonicalIngredient'
  | 'CanonicalUnit'
  | 'CanonicalRecipe'
  | 'CanonicalFiscalConfig'
  | 'CanonicalStaff'
  | 'CanonicalStockBalance'

export type CanonicalEntity =
  | CanonicalRestaurant
  | CanonicalTable
  | CanonicalCategory
  | CanonicalProduct
  | CanonicalModifierGroup
  | CanonicalModifier
  | CanonicalSupplier
  | CanonicalIngredient
  | CanonicalUnit
  | CanonicalRecipe
  | CanonicalFiscalConfig
  | CanonicalStaff
  | CanonicalStockBalance

export const NOT_IMPLEMENTED_ENTITIES: CanonicalEntityType[] = [
  'CanonicalArea',
  'CanonicalKDSStation',
  'CanonicalPrinter',
]
