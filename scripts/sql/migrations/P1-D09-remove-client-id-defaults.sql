-- P1-D09: Remove DEFAULT 'amalay' from all tables
-- After this migration, every INSERT must explicitly provide client_id.
-- A missing client_id will error — not silently create AMALAY data.
--
-- Run AFTER verifying all INSERT paths in the codebase provide client_id explicitly.
-- Safe to run per table; if a table is missing, the error is non-fatal.

ALTER TABLE agent_insights          ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE agent_results           ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE chat_logs               ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE delivery_orders         ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE delivery_platform_payments ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_attendance          ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_audit_log           ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_billing_clients     ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_bridge_logs         ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_cash_movements      ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_category_modifiers  ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_cfdi_requests       ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_cierres             ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_clients             ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_combos              ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_customer_notes      ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_customer_visits     ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_customers           ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_delivery_zones      ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_facturas            ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_fingerprint_templates ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_gastos              ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_gift_cards          ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_ingredient_presentations ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_ingredients         ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_insumos             ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_inventory           ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_inventory_alerts    ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_inventory_movements ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_inventory_products  ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_item_modifier_groups ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_market_movements    ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_market_stock        ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_menu_categories     ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_menu_items          ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_modifier_groups     ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_modifiers           ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_orders              ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_payment_methods     ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_presentations       ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_price_types         ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_print_jobs          ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_promos              ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_promotions          ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_purchase_orders     ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_recipe_details      ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_recipes             ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_recipes_old         ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_retail_groups       ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_retail_items        ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_retail_promotions   ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_schedules           ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_sizes               ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_staff               ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_staff_audit         ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_staff_shifts        ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_sub_recipes         ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_suppliers           ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_turnos              ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_unit_conversions    ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE push_subscriptions      ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE reservaciones           ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE wansoft_food_cost       ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE wansoft_hourly          ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE wansoft_inventory       ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE wansoft_labor           ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE wansoft_persons_hourly  ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE wansoft_pnl             ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE wansoft_recipes         ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE wansoft_shrinkage       ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE wansoft_suppliers       ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE wansoft_tips            ALTER COLUMN client_id DROP DEFAULT;

-- Verify: should return 0 rows after migration
SELECT table_name FROM information_schema.columns
WHERE table_schema = 'public' AND column_name = 'client_id' AND column_default LIKE '%amalay%'
ORDER BY table_name;
