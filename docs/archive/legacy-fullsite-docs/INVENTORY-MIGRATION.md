# Inventory Data Model Migration

Status: **compatibility bridge active** (2026-06-26)

## Why this document exists

The POS inventory system has two coexisting data models. A partial migration
created `pos_inventory_products` and `pos_inventory_movements` with a new
schema, but the rest of the code was never updated. This document tracks the
current state and the plan for completing the migration.

## Two models

### Legacy model (active in all POS code today)

| Table | PK type | Purpose |
|---|---|---|
| `pos_ingredients` | TEXT (`"1105"`, `"monk_fruit"`) | Ingredient catalog |
| `pos_inventory` | FK `ingredient_id` TEXT | Stock levels per ingredient |
| `pos_recipes_old` | FK `ingredient_id` TEXT | Recipe definitions (1 row per ingredient) |

Used by: `saveOrder`, `deductIngredientsForOrder`, `updateInventoryStock`,
`getInventory`, `getRecipes`, merma, inventario fisico, recepcion factura,
facturas proveedor, cocina page, cutover sync.

### New model (partially created, not yet used by POS code)

| Table | PK type | Purpose |
|---|---|---|
| `pos_inventory_products` | BIGINT (auto-increment) | Product catalog with stock |
| `pos_inventory_movements` | FK `product_id` BIGINT | Audit trail (immutable) |
| `pos_recipes` | JSONB `ingredientes` | Recipe definitions (JSONB array) |

Used by: `compras/page.tsx` reads from `pos_inventory_products`.

## The problem

`pos_inventory_movements` was created with `product_id BIGINT NOT NULL` referencing
the new model, but every piece of code that writes to it sends `ingredient_id` TEXT
from the legacy model. Result: every POST returned 400 and the table had zero records.

## Compatibility bridge (current state)

Applied 2026-06-26:

- Added `ingredient_id TEXT` column to `pos_inventory_movements`
- Made `product_id` nullable

This allows the 6 existing writers to insert movements using `ingredient_id` without
any code changes. The audit trail is now functional.

## Data overlap

Measured 2026-06-26:

| Metric | Count |
|---|---|
| Active ingredients (`pos_ingredients`) | 1,050 |
| Active products (`pos_inventory_products`) | 769 |
| Exact name match (case-insensitive) | 740 |
| Ingredients without product match | 310 |
| Products without ingredient match | 117 |
| Recipe ingredients with product match | 576 / 777 (74%) |
| Recipe ingredients without match | 201 (26%) |
| Duplicate ingredient names | 10 names |
| Duplicate product names | 0 |
| Ambiguous matches (1 ingredient to N products) | 0 |

The name-based mapping is 1:1 where it exists, but covers only 74% of recipe
ingredients. The remaining 26% are market items, sub-recipes, and ingredients
with slightly different names between systems.

## Migration plan (future)

When ready to complete the migration:

1. **Create missing products**: Add the 201 ingredients that have no match in
   `pos_inventory_products` (market items, sub-recipes, name variants).

2. **Build mapping table**: Create `ingredient_product_map(ingredient_id TEXT,
   product_id BIGINT)` with verified 1:1 relationships. Require manual review
   for the 10 duplicate ingredient names.

3. **Migrate stock**: Copy `pos_inventory.stock` to `pos_inventory_products.stock`
   using the mapping table.

4. **Migrate recipes**: Convert `pos_recipes_old` rows to `pos_recipes` JSONB
   format, replacing `ingredient_id` with `product_id`.

5. **Update code**: Change all POS code to use `product_id` BIGINT:
   - `logInventoryMovement()` in `pos-data.ts`
   - `deductIngredientsForOrder()` in `pos-data.ts`
   - `updateInventoryStock()` in `pos-data.ts`
   - `getInventory()` in `pos-data.ts`
   - Direct fetches in: `merma/page.tsx`, `inventario-fisico/page.tsx`,
     `recepcion-factura/page.tsx`, `facturas-proveedor/page.tsx`
   - `cutover_inventory_sync.py`

6. **Backfill movements**: Populate `product_id` in `pos_inventory_movements`
   for all records that have `ingredient_id`, using the mapping table.

7. **Cleanup**: Make `product_id` NOT NULL again, drop `ingredient_id` column,
   drop legacy tables (`pos_ingredients`, `pos_inventory`, `pos_recipes_old`).

## What NOT to do

- Do not create a heuristic name-based mapping at runtime. The 26% gap and
  duplicate names make this unreliable.
- Do not introduce a third inventory model. Either use the legacy model or
  complete the migration to the new one.
- Do not silently swallow 400 errors from `pos_inventory_movements`. The
  compatibility bridge exists so movements are actually recorded.
