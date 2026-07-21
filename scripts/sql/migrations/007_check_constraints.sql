-- ═══════════════════════════════════════════════════════════
-- FULLSITE CHECK CONSTRAINTS
-- Generated: 2026-07-21 from production
-- Constraints: 50
-- ═══════════════════════════════════════════════════════════

ALTER TABLE wansoft_daily ADD CONSTRAINT wansoft_daily_report_type_check CHECK ((report_type = ANY (ARRAY['avance'::text, 'cierre'::text])));
ALTER TABLE reviews ADD CONSTRAINT reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)));
ALTER TABLE reviews ADD CONSTRAINT reviews_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'draft'::text, 'approved'::text, 'published'::text])));
ALTER TABLE amalay_reservaciones ADD CONSTRAINT amalay_reservaciones_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'cancelled'::text])));
ALTER TABLE whatsapp_whitelist ADD CONSTRAINT whatsapp_whitelist_role_check CHECK ((role = ANY (ARRAY['viewer'::text, 'manager'::text, 'admin'::text])));
ALTER TABLE whatsapp_conversations ADD CONSTRAINT whatsapp_conversations_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'tool'::text])));
ALTER TABLE whatsapp_messages_log ADD CONSTRAINT whatsapp_messages_log_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text])));
ALTER TABLE calendar_sync_log ADD CONSTRAINT calendar_sync_log_action_check CHECK ((action = ANY (ARRAY['confirmed'::text, 'no_match'::text, 'duplicate'::text, 'error'::text])));
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_data_status_check CHECK ((data_status = ANY (ARRAY['ok'::text, 'no_data'::text, 'stale_data'::text, 'partial'::text, 'error'::text])));
ALTER TABLE pos_orders ADD CONSTRAINT chk_revision_ordering CHECK (((order_revision >= last_inventory_processed_revision) AND (last_inventory_processed_revision >= last_inventory_complete_revision) AND (last_inventory_complete_revision >= 0)));
ALTER TABLE pos_orders ADD CONSTRAINT orders_require_turno CHECK ((turno_id IS NOT NULL));
ALTER TABLE pos_ingredients ADD CONSTRAINT chk_product_type_valid CHECK ((product_type = ANY (ARRAY['materia_prima'::text, 'producto_terminado'::text, 'subproducto'::text, 'indirecto'::text])));
ALTER TABLE pos_ingredients ADD CONSTRAINT chk_yield_factor_positive CHECK ((yield_factor > (0)::numeric));
ALTER TABLE pos_recipes_old ADD CONSTRAINT chk_recipe_ingredient_type CHECK ((ingredient_type = ANY (ARRAY['ingredient'::text, 'sub_recipe'::text])));
ALTER TABLE pos_inventory ADD CONSTRAINT pos_inventory_stock_unit_check CHECK (((stock_unit IS NULL) OR (stock_unit = ANY (ARRAY['kg'::text, 'g'::text, 'lt'::text, 'ml'::text, 'pz'::text]))));
ALTER TABLE events ADD CONSTRAINT envelope_actor_complete CHECK (((actor ? 'userId'::text) AND (actor ? 'deviceId'::text)));
ALTER TABLE events ADD CONSTRAINT sensitive_requires_audit CHECK (((type <> ALL (ARRAY['orders.item.cancelled.v1'::text, 'orders.discount.applied.v1'::text, 'payments.cash.withdrawn.v1'::text, 'inventory.waste.recorded.v1'::text, 'inventory.adjusted.v1'::text])) OR ((audit IS NOT NULL) AND ((audit ->> 'approvedBy'::text) IS NOT NULL))));
ALTER TABLE pos_attendance ADD CONSTRAINT pos_attendance_type_check CHECK ((type = ANY (ARRAY['entrada'::text, 'salida'::text])));
ALTER TABLE pos_cash_movements ADD CONSTRAINT pos_cash_movements_type_check CHECK ((type = ANY (ARRAY['retiro'::text, 'deposito'::text])));
ALTER TABLE agent_insights ADD CONSTRAINT agent_insights_severity_check CHECK ((severity = ANY (ARRAY['critical'::text, 'high'::text, 'medium'::text, 'info'::text])));
ALTER TABLE agent_insights ADD CONSTRAINT agent_insights_status_check CHECK ((status = ANY (ARRAY['new'::text, 'viewed'::text, 'acknowledged'::text, 'resolved'::text, 'dismissed'::text])));
ALTER TABLE ops_daily ADD CONSTRAINT ops_daily_record_type_check CHECK ((record_type = ANY (ARRAY['snapshot'::text, 'cierre'::text, 'cierre_wansoft'::text])));
ALTER TABLE ops_daily ADD CONSTRAINT ops_daily_snapshot_has_bucket CHECK (((record_type = 'snapshot'::text) = (bucket_start IS NOT NULL)));
ALTER TABLE ops_daily ADD CONSTRAINT ops_daily_source_check CHECK ((source_system = ANY (ARRAY['wansoft'::text, 'fullsite'::text])));
ALTER TABLE ops_daily ADD CONSTRAINT ops_daily_source_record_coherence CHECK ((((record_type = 'cierre_wansoft'::text) AND (source_system = 'wansoft'::text)) OR ((record_type = ANY (ARRAY['snapshot'::text, 'cierre'::text])) AND (source_system = 'fullsite'::text))));
ALTER TABLE pos_recipe_versions ADD CONSTRAINT pos_recipe_versions_check CHECK ((((active = false) AND (activated_at IS NULL) AND (activated_by IS NULL) AND (deactivated_at IS NULL) AND (deactivated_by IS NULL)) OR ((active = true) AND (activated_at IS NOT NULL) AND (activated_by IS NOT NULL) AND (deactivated_at IS NULL) AND (deactivated_by IS NULL)) OR ((active = false) AND (activated_at IS NOT NULL) AND (activated_by IS NOT NULL) AND (deactivated_at IS NOT NULL) AND (deactivated_by IS NOT NULL))));
ALTER TABLE pos_recipe_lines ADD CONSTRAINT pos_recipe_lines_quantity_check CHECK ((quantity > (0)::numeric));
ALTER TABLE pos_recipe_lines ADD CONSTRAINT pos_recipe_lines_recipe_unit_check CHECK (((recipe_unit IS NULL) OR (recipe_unit = ANY (ARRAY['kg'::text, 'g'::text, 'lt'::text, 'ml'::text, 'pz'::text]))));
ALTER TABLE pos_item_inventory_policy ADD CONSTRAINT pos_item_inventory_policy_check CHECK ((((inventory_mode = 'direct_stock'::text) AND (market_stock_id IS NOT NULL)) OR ((inventory_mode <> 'direct_stock'::text) AND (market_stock_id IS NULL))));
ALTER TABLE pos_item_inventory_policy ADD CONSTRAINT pos_item_inventory_policy_check1 CHECK (((inventory_mode = 'unclassified'::text) OR ((inventory_mode = ANY (ARRAY['recipe'::text, 'direct_stock'::text, 'non_inventory'::text])) AND (approved_at IS NOT NULL) AND (approved_by IS NOT NULL))));
ALTER TABLE pos_item_inventory_policy ADD CONSTRAINT pos_item_inventory_policy_inventory_mode_check CHECK ((inventory_mode = ANY (ARRAY['recipe'::text, 'direct_stock'::text, 'non_inventory'::text, 'unclassified'::text])));
ALTER TABLE pos_reconciliation_results ADD CONSTRAINT pos_reconciliation_results_check CHECK ((((pinned_mode IS NULL) AND (pinned_recipe_version_id IS NULL) AND (pinned_market_stock_id IS NULL)) OR ((pinned_mode = 'recipe'::text) AND (pinned_recipe_version_id IS NOT NULL) AND (pinned_market_stock_id IS NULL)) OR ((pinned_mode = 'direct_stock'::text) AND (pinned_market_stock_id IS NOT NULL) AND (pinned_recipe_version_id IS NULL)) OR ((pinned_mode = 'non_inventory'::text) AND (pinned_recipe_version_id IS NULL) AND (pinned_market_stock_id IS NULL))));
ALTER TABLE pos_reconciliation_results ADD CONSTRAINT pos_reconciliation_results_pinned_mode_check CHECK (((pinned_mode IS NULL) OR (pinned_mode = ANY (ARRAY['recipe'::text, 'direct_stock'::text, 'non_inventory'::text]))));
ALTER TABLE pos_reconciliation_results ADD CONSTRAINT pos_reconciliation_results_result_check CHECK ((result = ANY (ARRAY['PENDING'::text, 'RECONCILED'::text, 'NO_MUTATION_APPROVED'::text, 'BLOCKED_UNCLASSIFIED'::text, 'BLOCKED_OWNER_MISSING'::text, 'BLOCKED_TARGET_MISSING'::text, 'BLOCKED_RECIPE_MISSING'::text, 'BLOCKED_UNIT_MISSING'::text, 'BLOCKED_MUTATION_FAILED'::text])));
ALTER TABLE pos_mutation_authority ADD CONSTRAINT pos_mutation_authority_sale_authority_check CHECK ((sale_authority = ANY (ARRAY['legacy'::text, 'paused'::text, 'r1'::text])));
ALTER TABLE pos_save_operations ADD CONSTRAINT chk_save_op_committed CHECK ((((state = 'COMMITTED'::text) AND (committed_revision IS NOT NULL) AND (rejection_detail IS NULL)) OR ((state = 'REJECTED'::text) AND (committed_revision IS NULL) AND (rejection_detail IS NOT NULL)) OR ((state = 'EXECUTING'::text) AND (committed_revision IS NULL) AND (rejection_detail IS NULL))));
ALTER TABLE pos_save_operations ADD CONSTRAINT chk_save_op_state CHECK ((state = ANY (ARRAY['EXECUTING'::text, 'COMMITTED'::text, 'REJECTED'::text])));
ALTER TABLE pos_sub_recipes ADD CONSTRAINT chk_sub_yield_positive CHECK ((yield_quantity > (0)::numeric));
ALTER TABLE pos_sub_recipes ADD CONSTRAINT chk_sub_yield_unit_not_empty CHECK ((yield_unit <> ''::text));
ALTER TABLE pos_sub_recipe_ingredients ADD CONSTRAINT chk_sri_no_self_ref CHECK (((ingredient_type <> 'sub_recipe'::text) OR (ingredient_id <> sub_recipe_id)));
ALTER TABLE pos_sub_recipe_ingredients ADD CONSTRAINT chk_sri_quantity_positive CHECK ((quantity > (0)::numeric));
ALTER TABLE pos_sub_recipe_ingredients ADD CONSTRAINT chk_sri_type CHECK ((ingredient_type = ANY (ARRAY['ingredient'::text, 'sub_recipe'::text])));
ALTER TABLE pos_sub_recipe_ingredients ADD CONSTRAINT chk_sri_unit_not_empty CHECK ((unit <> ''::text));
ALTER TABLE pos_unit_conversions ADD CONSTRAINT chk_uc_different_units CHECK ((from_unit <> to_unit));
ALTER TABLE pos_unit_conversions ADD CONSTRAINT chk_uc_factor_positive CHECK ((factor > (0)::numeric));
ALTER TABLE pos_unit_conversions ADD CONSTRAINT chk_uc_units_not_empty CHECK (((from_unit <> ''::text) AND (to_unit <> ''::text)));
ALTER TABLE pos_presentations ADD CONSTRAINT chk_pres_code_not_empty CHECK ((code <> ''::text));
ALTER TABLE pos_ingredient_presentations ADD CONSTRAINT chk_ip_cost_non_negative CHECK ((cost_per_presentation >= (0)::numeric));
ALTER TABLE pos_ingredient_presentations ADD CONSTRAINT chk_ip_quantity_positive CHECK ((contains_quantity > (0)::numeric));
ALTER TABLE pos_ingredient_presentations ADD CONSTRAINT chk_ip_unit_not_empty CHECK ((contains_unit <> ''::text));
