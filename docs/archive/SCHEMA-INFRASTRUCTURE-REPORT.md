# Schema Infrastructure Report

Generated: 2026-07-21
Total tables in Supabase: 116
Views: 6
Tables with migration SQL: 52
Tables WITHOUT migration SQL: 62
Constraints: 268
Indexes: 233
RLS policies: 194
Functions: 16
Triggers: 7
Extensions: 7

## Tables WITH Migration SQL (52)

| Table | Cols | Migration File |
|---|---|---|
| agent_audit_log | 10 | .github/migrations/002_agent_audit_log.sql |
| amalay_reservaciones | 17 | CLAUDE.md (documented, legacy) |
| pos_audit_log | 10 | lib/pos-data.ts (SQL comment) |
| pos_billing_clients | 17 | scripts/migrate-billing-clients.sql |
| pos_category_modifiers | 4 | dashboard-app/migrations/002_menu_to_db.sql |
| pos_cierres | 21 | dashboard-app/sql/pos_features_migration.sql |
| pos_combos | 9 | dashboard-app/docs/pos-combos-schema.sql |
| pos_customer_notes | 7 | dashboard-app/sql/pos_customer_notes.sql |
| pos_customer_visits | 7 | dashboard-app/sql/create_pos_customers.sql |
| pos_customers | 14 | dashboard-app/sql/create_pos_customers.sql |
| pos_delivery_zones | 8 | dashboard-app/sql/create_pos_admin_tables.sql |
| pos_facturas | 17 | lib/pos-data.ts (SQL comment) |
| pos_gift_cards | 7 | dashboard-app/sql/create_pos_admin_tables.sql |
| pos_ingredient_presentations | 9 | scripts/sql/migration-subrecipes-yield.sql |
| pos_ingredients | 16 | lib/pos-data.ts (SQL comment) |
| pos_inventory | 9 | lib/pos-data.ts (SQL comment) |
| pos_inventory_movements | 12 | dashboard-app/sql/create_pos_inventory_products.sql |
| pos_inventory_products | 10 | dashboard-app/sql/create_pos_inventory_products.sql |
| pos_item_inventory_policy | 9 | scripts/sql/migration-r1-canonical-inventory.sql |
| pos_market_movements | 11 | dashboard-app/sql/create_pos_market_stock.sql |
| pos_market_stock | 8 | dashboard-app/sql/create_pos_market_stock.sql |
| pos_menu_categories | 7 | dashboard-app/migrations/002_menu_to_db.sql |
| pos_menu_items | 12 | dashboard-app/migrations/002_menu_to_db.sql |
| pos_modifier_groups | 10 | dashboard-app/migrations/002_menu_to_db.sql |
| pos_modifiers | 8 | dashboard-app/migrations/002_menu_to_db.sql |
| pos_orders | 26 | lib/pos-data.ts (SQL comment) |
| pos_payment_methods | 8 | dashboard-app/sql/create_pos_admin_tables.sql |
| pos_presentations | 6 | scripts/sql/migration-subrecipes-yield.sql |
| pos_print_jobs | 12 | dashboard-app/docs/print-jobs-schema.sql |
| pos_promotions | 14 | dashboard-app/sql/create_pos_admin_tables.sql |
| pos_purchase_order_items | 10 | lib/pos-data.ts (SQL comment) |
| pos_purchase_orders | 15 | lib/pos-data.ts (SQL comment) |
| pos_recipe_lines | 6 | scripts/sql/migration-r1-canonical-inventory.sql |
| pos_recipe_versions | 14 | scripts/sql/migration-r1-canonical-inventory.sql |
| pos_recipes_old | 9 | scripts/sql/02-recetas.sql |
| pos_reconciliation_results | 14 | scripts/sql/migration-r1-canonical-inventory.sql |
| pos_retail_items | 10 | dashboard-app/sql/create_pos_admin_tables.sql |
| pos_save_operations | 11 | dashboard-app/sql/r2d_save_operation_idempotency.sql |
| pos_schedules | 8 | dashboard-app/sql/create_pos_admin_tables.sql |
| pos_sizes | 6 | dashboard-app/sql/create_pos_admin_tables.sql |
| pos_staff_shifts | 12 | dashboard-app/sql/pos_features_migration.sql |
| pos_sub_recipe_ingredients | 7 | scripts/sql/migration-subrecipes-yield.sql |
| pos_sub_recipes | 9 | scripts/sql/migration-subrecipes-yield.sql |
| pos_suppliers | 20 | scripts/sql/01-proveedores.sql |
| pos_unit_conversions | 6 | scripts/sql/migration-subrecipes-yield.sql |
| reservaciones | 18 | Created via Management API (Jul 21) |
| wansoft_data | 5 | dashboard-app/sql/create_wansoft_data.sql |
| wansoft_menu_config | 8 | dashboard-app/sql/create_wansoft_menu_config.sql |

## Tables WITHOUT Migration SQL (62)

These were created directly in Supabase SQL Editor. Need migration files.

| Table | Cols | Classification | Priority |
|---|---|---|---|
| agent_insights | 16 | Agents | Low |
| agent_messages | 6 | Agents | Low |
| agent_results | 8 | Agents | High |
| agent_runs | 15 | Agents | High |
| calendar_sync_log | 8 | Sync | Low |
| chat_logs | 11 | Chat | Medium |
| client_locations | 6 | Infrastructure | High |
| client_users | 5 | Infrastructure | Critical |
| clients | 38 | Infrastructure | Critical |
| content | 7 | CMS | Low |
| credentials_vault | 11 | Admin | Medium |
| delivery_orders | 32 | Delivery | Medium |
| delivery_platform_payments | 13 | Delivery | Low |
| events | 9 | Event store | Medium |
| memories | 10 | AI | Low |
| ops_daily | 24 | Ops | Medium |
| parity_reports | 9 | Ops | Low |
| pos_attendance | 9 | Staff | Medium |
| pos_bridge_logs | 7 | Print | Low |
| pos_cash_movements | 9 | POS Core | High |
| pos_cfdi_requests | 20 | CFDI | High |
| pos_clients | 16 | Legacy/duplicate | Low |
| pos_fingerprint_templates | 4 | Auth | Medium |
| pos_gastos | 15 | Finance | Medium |
| pos_insumos | 12 | Legacy Wansoft view | Low |
| pos_inventory_alerts | 7 | Inventory | Medium |
| pos_item_modifier_groups | 3 | Menu | High |
| pos_mutation_authority | 4 | R1 System | Low |
| pos_price_types | 6 | POS Admin | Low |
| pos_promos | 10 | POS | Medium |
| pos_recipe_details | 14 | Legacy | Low |
| pos_recipes | 9 | Wansoft flat view | Low |
| pos_retail_groups | 5 | Retail | Low |
| pos_retail_promotions | 9 | Retail | Low |
| pos_staff | 10 | POS Core | Critical |
| pos_staff_audit | 7 | Staff | Medium |
| pos_survey | 7 | Survey | Low |
| pos_turnos | 11 | POS Core | Critical |
| prospects | 9 | CRM/Sales | Low |
| push_subscriptions | 6 | Notifications | Low |
| r1_observation_baseline | 19 | Unknown | Unknown |
| r1_observation_final | 25 | Unknown | Unknown |
| r1_observation_log | 21 | Unknown | Unknown |
| reviews | 12 | Reviews | Low |
| tasks | 8 | Internal | Low |
| wansoft_catalog | 17 | Pipeline | Low |
| wansoft_daily | 24 | Pipeline | High |
| wansoft_food_cost | 5 | Pipeline | Medium |
| wansoft_hourly | 4 | Pipeline | Medium |
| wansoft_inventory | 5 | Pipeline | Medium |
| wansoft_kpis | 38 | Pipeline | High |
| wansoft_labor | 5 | Pipeline | Low |
| wansoft_persons_hourly | 5 | Pipeline | Low |
| wansoft_pnl | 5 | Pipeline | Low |
| wansoft_recipes | 8 | Pipeline | Medium |
| wansoft_shrinkage | 5 | Pipeline | Low |
| wansoft_suppliers | 6 | Pipeline | Low |
| wansoft_tips | 5 | Pipeline | Medium |
| wansoft_waiter_categories | 4 | Pipeline | Low |
| whatsapp_conversations | 11 | WhatsApp | Medium |
| whatsapp_messages_log | 9 | WhatsApp | Medium |
| whatsapp_whitelist | 7 | WhatsApp | Low |

## Views (6)

- **ops_daily_history**:  SELECT DISTINCT ON (client_id, fecha) id,
    client_id,
    fecha,
    record_type,
    bucket_sta...
- **ops_daily_live**:  SELECT DISTINCT ON (client_id, fecha) id,
    client_id,
    fecha,
    record_type,
    bucket_sta...
- **pos_recipes_canonical**:  SELECT v.client_id,
    v.menu_item_id,
    m.name AS menu_item_name,
    l.ingredient_id,
    l.qu...
- **reservaciones_activas**:  SELECT id,
    fecha,
    espacio,
    horario_inicio,
    horario_fin,
    status
   FROM amalay_r...
- **reservaciones_hoy**:  SELECT nombre,
    espacio,
    horario_inicio,
    horario_fin,
    guests,
    paquete,
    total...
- **reviews_pending**:  SELECT id,
    review_id,
    author,
    rating,
    text,
    date,
    status,
    draft_respons...

## Functions (custom, excluding dblink)

- activate_recipe_version
- cancel_stale_pending_reservations
- convert_recipe_to_stock
- gen_codigo_reserva
- r1_adjust_market_stock
- r1_legacy_sale_deduction
- r1_merge_orders
- r1_observation_sample
- r1_reconcile_item
- r1_reconcile_order
- r1_save_order
- r1_save_order_idempotent
- reconcile_order_inventory
- reject_mutation
- set_pos_order_number
- set_updated_at

## Triggers

- amalay_reservaciones.set_codigo_reserva (INSERT)
- amalay_reservaciones.trg_reservaciones_updated_at (UPDATE)
- events.events_immutable (DELETE)
- events.events_immutable (UPDATE)
- pos_orders.trg_pos_order_number (INSERT)
- pos_orders.trg_pos_orders_updated_at (UPDATE)
- reviews.reviews_set_updated_at (UPDATE)

## Extensions

- dblink v1.2
- pg_cron v1.6.4
- pg_stat_statements v1.11
- pgcrypto v1.3
- plpgsql v1.0
- supabase_vault v0.3.1
- uuid-ossp v1.1

## Strategy

### Auto-generatable (from schema export)
All 62 tables can be auto-generated from the schema JSON.
The column definitions, types, and defaults are all captured.

### Requires manual review
- RLS policies (194 total) — need to be extracted and included
- Functions (custom: 16) — need full body extraction
- Triggers (7) — need exact definitions
- Views (6) — need view definitions
- CHECK constraints — need exact expressions
- Indexes (custom, beyond PK) — need exact definitions