# Migration Consolidation Map

| Table | Source Migration | Consolidated File | Notes |
|---|---|---|---|
| agent_audit_log | .github/migrations/002_agent_audit_log.sql | 010_consolidated_core.sql | |
| agent_results | None (created in SQL Editor) | 010_consolidated_core.sql | |
| agent_runs | None (created in SQL Editor) | 010_consolidated_core.sql | |
| amalay_reservaciones | None (created in SQL Editor) | 010_consolidated_core.sql | |
| calendar_sync_log | None (created in SQL Editor) | 011_consolidated_pipeline.sql | |
| chat_logs | None (created in SQL Editor) | 010_consolidated_core.sql | |
| clients | scripts/migrate-billing-clients.sql | 010_consolidated_core.sql | |
| client_locations | None (created in SQL Editor) | 010_consolidated_core.sql | |
| client_users | None (created in SQL Editor) | 010_consolidated_core.sql | |
| credentials_vault | None (created in SQL Editor) | 010_consolidated_core.sql | |
| delivery_orders | None (created in SQL Editor) | 010_consolidated_core.sql | |
| delivery_platform_payments | None (created in SQL Editor) | 011_consolidated_pipeline.sql | |
| events | None (created in SQL Editor) | 010_consolidated_core.sql | |
| memories | None (created in SQL Editor) | 010_consolidated_core.sql | |
| ops_daily | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_attendance | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_audit_log | .github/migrations/002_agent_audit_log.sql | 010_consolidated_core.sql | |
| pos_billing_clients | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_cash_movements | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_category_modifiers | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_cfdi_requests | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_cierres | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_combos | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_customer_notes | dashboard-app/sql/pos_customer_notes.sql | 010_consolidated_core.sql | |
| pos_customers | dashboard-app/sql/create_pos_customers.sql | 010_consolidated_core.sql | |
| pos_customer_visits | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_delivery_zones | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_facturas | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_gastos | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_gift_cards | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_presentations | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_ingredient_presentations | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_ingredients | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_insumos | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_inventory | dashboard-app/sql/create_pos_inventory_products.sql | 010_consolidated_core.sql | |
| pos_inventory_alerts | dashboard-app/sql/create_pos_inventory_products.sql | 010_consolidated_core.sql | |
| pos_inventory_products | dashboard-app/sql/create_pos_inventory_products.sql | 010_consolidated_core.sql | |
| pos_market_stock | dashboard-app/sql/create_pos_market_stock.sql | 010_consolidated_core.sql | |
| pos_menu_categories | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_menu_items | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_recipe_versions | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_reconciliation_results | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_inventory_movements | dashboard-app/sql/create_pos_inventory_products.sql | 010_consolidated_core.sql | |
| pos_item_inventory_policy | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_item_modifier_groups | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_market_movements | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_modifier_groups | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_modifiers | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_mutation_authority | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_orders | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_payment_methods | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_print_jobs | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_promotions | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_purchase_order_items | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_purchase_orders | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_recipe_lines | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_recipes | scripts/sql/migration-subrecipes-yield.sql | 010_consolidated_core.sql | |
| pos_recipes_old | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_retail_items | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_save_operations | dashboard-app/sql/r2d_save_operation_idempotency.sql | 010_consolidated_core.sql | |
| pos_schedules | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_sizes | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_staff | scripts/migrate-staff-and-payments.sql | 010_consolidated_core.sql | |
| pos_staff_audit | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_staff_shifts | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_sub_recipes | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_sub_recipe_ingredients | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_suppliers | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_turnos | None (created in SQL Editor) | 010_consolidated_core.sql | |
| pos_unit_conversions | None (created in SQL Editor) | 010_consolidated_core.sql | |
| prospects | None (created in SQL Editor) | 010_consolidated_core.sql | |
| push_subscriptions | None (created in SQL Editor) | 010_consolidated_core.sql | |
| reservaciones | None (created in SQL Editor) | 010_consolidated_core.sql | |
| reviews | None (created in SQL Editor) | 010_consolidated_core.sql | |
| wansoft_catalog | None (created in SQL Editor) | 011_consolidated_pipeline.sql | |
| wansoft_daily | dashboard-app/sql/create_wansoft_data.sql | 011_consolidated_pipeline.sql | |
| wansoft_data | dashboard-app/sql/create_wansoft_data.sql | 011_consolidated_pipeline.sql | |
| wansoft_food_cost | None (created in SQL Editor) | 011_consolidated_pipeline.sql | |
| wansoft_hourly | None (created in SQL Editor) | 011_consolidated_pipeline.sql | |
| wansoft_inventory | None (created in SQL Editor) | 011_consolidated_pipeline.sql | |
| wansoft_kpis | None (created in SQL Editor) | 011_consolidated_pipeline.sql | |
| wansoft_labor | None (created in SQL Editor) | 011_consolidated_pipeline.sql | |
| wansoft_menu_config | dashboard-app/sql/create_wansoft_menu_config.sql | 011_consolidated_pipeline.sql | |
| wansoft_persons_hourly | None (created in SQL Editor) | 011_consolidated_pipeline.sql | |
| wansoft_pnl | None (created in SQL Editor) | 011_consolidated_pipeline.sql | |
| wansoft_recipes | None (created in SQL Editor) | 011_consolidated_pipeline.sql | |
| wansoft_shrinkage | None (created in SQL Editor) | 011_consolidated_pipeline.sql | |
| wansoft_suppliers | None (created in SQL Editor) | 011_consolidated_pipeline.sql | |
| wansoft_tips | None (created in SQL Editor) | 011_consolidated_pipeline.sql | |
| wansoft_waiter_categories | None (created in SQL Editor) | 011_consolidated_pipeline.sql | |
| whatsapp_conversations | None (created in SQL Editor) | 010_consolidated_core.sql | |
| whatsapp_messages_log | None (created in SQL Editor) | 010_consolidated_core.sql | |
| whatsapp_whitelist | None (created in SQL Editor) | 010_consolidated_core.sql | |