# Entity Schema Matrix — Migration Engine v3

**Audited:** 2026-07-27  
**Method:** Repository evidence only — schema-export.json (116 tables), SQL migrations, TypeScript source files.  
**Constraint:** No PARTIAL by inference. Status changes require cited evidence.

---

## Summary

| Status | Count | Entities |
|--------|-------|---------|
| VERIFIED | 5 | 01, 03, 04, 05, 10 |
| PARTIAL | 8 | 06, 07, 11, 12, 13, 14, 15, 16 |
| NOT_IMPLEMENTED | 3 | 02, 08, 09 |
| UNKNOWN | 0 | — |
| **Total** | **16** | |

---

## 01 · CanonicalRestaurant → `clients` + `client_locations`

**Status: VERIFIED**

Evidence: `001_core_schema.sql` — `clients` table includes `rfc TEXT, razon_social TEXT, regimen_fiscal TEXT, codigo_postal TEXT, domicilio_fiscal JSONB`. `client_locations` provides multi-location support.

Commit adapter target: `clients` (one row per restaurant). Fiscal fields written here for is_primary=true FiscalConfig records.

---

## 02 · CanonicalArea

**Status: NOT_IMPLEMENTED**  
*Previous status: UNKNOWN*

Evidence: `dashboard-app/migrations/004_pos_mesas.sql` — column `zone text` (nullable) on `pos_mesas`. No separate area/zone table found in schema-export.json (116 tables) or any migration file.

Zone values (e.g. 'Entrada', 'Terraza', 'Barra', 'Toldo', 'Privado') are TEXT strings embedded in each mesa row. There is no area entity to migrate.

Limitation: CanonicalArea has no commit adapter target. Zone attribute migrates as part of CanonicalTable.

---

## 03 · CanonicalTable → `pos_mesas`

**Status: VERIFIED**  
*Previous status: PARTIAL*

Evidence: `dashboard-app/migrations/004_pos_mesas.sql`

```sql
CREATE TABLE IF NOT EXISTS pos_mesas (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  text        NOT NULL,
  number     integer     NOT NULL,
  capacity   integer     NOT NULL DEFAULT 4,
  zone       text,
  x_pct      numeric(6,2) NOT NULL,
  y_pct      numeric(6,2) NOT NULL,
  shape      text        NOT NULL,
  sort_order integer     NOT NULL DEFAULT 0,
  active     boolean     NOT NULL DEFAULT true,
  UNIQUE (client_id, number)
);
```

Confirmed: table is in production (applied 2026-07-24 via Supabase). Not present in schema-export.json because it was created after the export.

Commit adapter target: `pos_mesas` — full schema mapped to CanonicalTable.

---

## 04 · CanonicalCategory → `pos_menu_categories`

**Status: VERIFIED**

Evidence: schema-export.json — `id text NN, client_id, name text NN, color, sort_order, active, created_at`.

Commit adapter target: `pos_menu_categories`.

---

## 05 · CanonicalProduct → `pos_menu_items`

**Status: VERIFIED**

Evidence: schema-export.json — `id text NN, client_id, category_id text NN, name text NN, price, barcode, sort_order, active, aplica_2x1, aplica_descuento, aplica_cortesia, created_at`.

Commit adapter target: `pos_menu_items`.

---

## 06 · CanonicalModifierGroup → `pos_item_modifier_groups` (junction)

**Status: PARTIAL**

Evidence: schema-export.json — `pos_item_modifier_groups` has exactly 3 columns: `client_id text NN, item_id text NN, group_id text NN`. This is a pure junction table.

No master modifier-group entity table exists in the schema. `group_id` is a TEXT identifier referenced by `pos_modifiers.group_id`. There is no table with group name, sort_order, or other group-level attributes.

Limitation: CanonicalModifierGroup can only commit the junction (item_id → group_id). Group metadata (name) cannot be round-tripped through a master table.

---

## 07 · CanonicalModifier → `pos_modifiers`

**Status: PARTIAL**

Evidence: schema-export.json — `id text NN, client_id, group_id text NN, name text NN, price numeric, sort_order integer, active boolean, created_at`.

`group_id` is TEXT — no FK to a group master table (see 06). Commit adapter must ensure group_id consistency.

Limitation: modifier-to-item assignment goes through `pos_item_modifier_groups` junction (not a FK on `pos_modifiers` itself).

---

## 08 · CanonicalKDSStation

**Status: NOT_IMPLEMENTED**  
*Previous status: UNKNOWN*

Evidence: `dashboard-app/src/lib/pos-constants.ts`

```typescript
export type StationName = 'cocina' | 'barra' | 'caja'
export const STATION_CATEGORIES: Record<StationName, string[]> = { ... }
```

No KDS station table found in schema-export.json (116 tables checked). Device-level settings use localStorage. Station configuration is compile-time constants.

Limitation: No Supabase table to migrate into. Manual setup required per Electron deployment.

---

## 09 · CanonicalPrinter

**Status: NOT_IMPLEMENTED**  
*Previous status: UNKNOWN*

Evidence: `dashboard-app/src/lib/printer.ts` — printer assignments stored in localStorage (`printer_assignments` key) as `Map<PrinterSlot, PrinterConnection>`. Print bridge reads local config from disk.

`pos_print_jobs` exists in schema-export.json but is a job-log table only (`station TEXT NOT NULL` is a TEXT label, not an FK to any printer table). No printer registration table found.

Limitation: Printer config cannot be migrated to Supabase. Manual configuration per terminal after cutover.

---

## 10 · CanonicalSupplier → `pos_suppliers`

**Status: VERIFIED**

Evidence: schema-export.json — `id text NN, client_id, name text NN, contact, phone, email, rfc, giro, payment_terms integer, delivery_days integer, expense_type, clave_wansoft text, authorized boolean, created_at`.

Notable: `clave_wansoft TEXT` column enables direct lookup from Wansoft source records during migration.

Commit adapter target: `pos_suppliers`.

---

## 11 · CanonicalIngredient → `pos_ingredients` + `pos_inventory_products`

**Status: PARTIAL**

Evidence: schema-export.json — two overlapping tables:

`pos_ingredients`: `id text NN, client_id, name text NN, unit text NN, cost_per_unit, category, supplier, yield_factor, active, sat_product_key, sat_unit_key, product_type, department, is_critical, sale_price`

`pos_inventory_products`: `id bigint NN, client_id, name text NN, unit text NN, cost_per_unit, stock numeric NN, reorder_point, category, active`

Two distinct systems: `pos_ingredients` is the recipe/cost system (TEXT id, has SAT keys); `pos_inventory_products` is the purchase tracking system (BIGSERIAL id, has stock). Commit adapter must write to both when applicable.

Limitation: `pos_ingredients.id` is TEXT (not BIGSERIAL) — source connector must supply stable string keys.

---

## 12 · CanonicalUnit → `pos_unit_conversions`

**Status: PARTIAL**  
*Previous status: UNKNOWN*

Evidence: schema-export.json — `pos_unit_conversions` table: `id bigint, client_id text NN, from_unit text NN, to_unit text NN, factor numeric NN, is_system boolean`.

No unit-master table exists. Unit values in `pos_inventory_products.unit` and `pos_ingredients.unit` are free-text strings ('g', 'ml', 'pz', 'kg', 'lt') — not FK-enforced.

CanonicalUnit maps only to conversion-factor rows. Unit name validation is at application layer, not DB constraint.

Limitation: No UUID-identified unit master entity. Commit adapter writes conversion factors; unit names are validated but not FK-enforced.

---

## 13 · CanonicalRecipe → `pos_recipe_versions` + `pos_recipe_lines`

**Status: PARTIAL**

Evidence: schema-export.json:

`pos_recipe_versions`: `id bigint NN, client_id text NN, menu_item_id text NN, version integer NN, active boolean NN, source text NN, source_batch, notes, created_by text NN, activated_by, deactivated_by, created_at, activated_at, deactivated_at`

`pos_recipe_lines`: `id bigint NN, client_id text NN, recipe_version_id bigint NN, ingredient_id text NN, quantity numeric NN, recipe_unit`

Commit adapter must write recipe_version first, then recipe_lines with FK to version id. `source` and `created_by` fields required NOT NULL.

Limitation: `active` field logic (deactivating prior versions) requires ordering — commit adapter must handle version activation sequence.

---

## 14 · CanonicalFiscalConfig → `clients` + `pos_billing_clients`

**Status: PARTIAL**  
*Previous status: UNKNOWN*

Evidence: `clients` table (001_core_schema.sql): `rfc TEXT, razon_social TEXT, regimen_fiscal TEXT, codigo_postal TEXT, domicilio_fiscal JSONB`.

schema-export.json — `pos_billing_clients` table: `id text NN, client_id text NN, nombre text NN, rfc text NN, regimen_fiscal, codigo_postal, email, calle, no_interior, no_exterior, colonia, ciudad, estado, pais, uso_cfdi, active boolean, created_at`.

Local DB persistence confirmed. Facturama API credentials (emisor, certificado, llave privada) are external config — not stored in any Fullsite table.

is_primary=true → commit adapter writes to `clients` table fiscal fields. is_primary=false → commit adapter writes to `pos_billing_clients`.

Limitation: Facturama API credentials require manual setup post-migration. CFDI request history (`pos_cfdi_requests`) is out of scope for v1 migration.

---

## 15 · CanonicalStaff → `pos_staff`

**Status: PARTIAL**

Evidence: schema-export.json — `id text NN, client_id, name text NN, pin text NOT NULL, role text NN, active boolean, created_at, hourly_rate, weekly_salary, role_display`.

Critical constraint: `pin TEXT NOT NULL`. Migration engine must NOT transport PINs. Commit adapter sets `pin` to a migration placeholder (e.g. `'MIGRATION_PENDING'`). `requires_credential_enrollment: true` signals the restaurant to re-enroll staff PINs after cutover.

Limitation: Staff cannot be fully operational immediately after migration — PIN enrollment step required.

---

## 16 · CanonicalStockBalance → `pos_inventory_products.stock`

**Status: PARTIAL**

Evidence: schema-export.json — `pos_inventory_products.stock numeric NOT NULL`.

Stock balance is an attribute on the product row, not a separate entity table. Commit adapter writes `stock` column during CanonicalIngredient commit.

Limitation: No separate stock-balance event table. Point-in-time balance cannot be replayed from history (no append-only stock ledger in scope for v1).

---

## Evidence File Index

| File | Tables / Symbols Found |
|------|----------------------|
| `scripts/sql/migrations/001_core_schema.sql` | clients, client_locations, pos_cfdi_requests, fiscal fields |
| `scripts/sql/schema-export.json` | 116 tables (full list) |
| `dashboard-app/migrations/004_pos_mesas.sql` | pos_mesas (zone TEXT, full schema) |
| `dashboard-app/src/lib/pos-constants.ts` | StationName type, STATION_CATEGORIES (hardcoded) |
| `dashboard-app/src/lib/printer.ts` | localStorage printer_assignments, PrinterSlot type |
| `dashboard-app/src/lib/pos-data.ts:3051` | PosMesa interface, zone: string \| null |
