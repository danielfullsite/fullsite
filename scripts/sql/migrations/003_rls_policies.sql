-- ═══════════════════════════════════════════════════════════
-- FULLSITE RLS POLICIES
-- Generated: 2026-07-21 from production
-- Policies: 194
-- ═══════════════════════════════════════════════════════════

-- ── agent_insights ──
ALTER TABLE agent_insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_insights" ON agent_insights;
CREATE POLICY "anon_read_insights" ON agent_insights
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "anon_update_insights" ON agent_insights;
CREATE POLICY "anon_update_insights" ON agent_insights
  FOR UPDATE
  TO anon
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "service_insert_insights" ON agent_insights;
CREATE POLICY "service_insert_insights" ON agent_insights
  FOR INSERT
  AS PERMISSIVE
  WITH CHECK (true)
;

-- ── agent_results ──
ALTER TABLE agent_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all" ON agent_results;
CREATE POLICY "authenticated_all" ON agent_results
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── agent_runs ──
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_agent_runs" ON agent_runs;
CREATE POLICY "anon_read_agent_runs" ON agent_runs
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "authenticated_read" ON agent_runs;
CREATE POLICY "authenticated_read" ON agent_runs
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;

-- ── amalay_reservaciones ──
ALTER TABLE amalay_reservaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon puede insertar" ON amalay_reservaciones;
CREATE POLICY "anon puede insertar" ON amalay_reservaciones
  FOR INSERT
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "anon puede leer activas" ON amalay_reservaciones;
CREATE POLICY "anon puede leer activas" ON amalay_reservaciones
  FOR SELECT
  AS PERMISSIVE
  USING ((status <> 'cancelled'::text))
;

-- ── client_locations ──
ALTER TABLE client_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read" ON client_locations;
CREATE POLICY "Authenticated read" ON client_locations
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;

-- ── client_users ──
ALTER TABLE client_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own client_users" ON client_users;
CREATE POLICY "Users can read own client_users" ON client_users
  FOR SELECT
  AS PERMISSIVE
  USING ((auth.uid() = user_id))
;

-- ── clients ──
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read" ON clients;
CREATE POLICY "anon_read" ON clients
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "authenticated_all" ON clients;
CREATE POLICY "authenticated_all" ON clients
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── content ──
ALTER TABLE content ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select" ON content;
CREATE POLICY "anon_select" ON content
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;

-- ── delivery_orders ──
ALTER TABLE delivery_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon insert" ON delivery_orders;
CREATE POLICY "anon insert" ON delivery_orders
  FOR INSERT
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "anon update" ON delivery_orders;
CREATE POLICY "anon update" ON delivery_orders
  FOR UPDATE
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "delivery_select" ON delivery_orders;
CREATE POLICY "delivery_select" ON delivery_orders
  FOR SELECT
  TO anon,authenticated
  AS PERMISSIVE
  USING (true)
;

-- ── delivery_platform_payments ──
ALTER TABLE delivery_platform_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all" ON delivery_platform_payments;
CREATE POLICY "service_all" ON delivery_platform_payments
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── events ──
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "events_insert_authenticated" ON events;
CREATE POLICY "events_insert_authenticated" ON events
  FOR INSERT
  TO authenticated
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "events_select_authenticated" ON events;
CREATE POLICY "events_select_authenticated" ON events
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;

-- ── ops_daily ──
ALTER TABLE ops_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_ops_daily" ON ops_daily;
CREATE POLICY "service_all_ops_daily" ON ops_daily
  FOR ALL
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── parity_reports ──
ALTER TABLE parity_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "parity_select_authenticated" ON parity_reports;
CREATE POLICY "parity_select_authenticated" ON parity_reports
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;

-- ── pos_attendance ──
ALTER TABLE pos_attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_insert" ON pos_attendance;
CREATE POLICY "anon_insert" ON pos_attendance
  FOR INSERT
  TO anon
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "anon_read" ON pos_attendance;
CREATE POLICY "anon_read" ON pos_attendance
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "auth_all" ON pos_attendance;
CREATE POLICY "auth_all" ON pos_attendance
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_audit_log ──
ALTER TABLE pos_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_insert_audit" ON pos_audit_log;
CREATE POLICY "anon_insert_audit" ON pos_audit_log
  FOR INSERT
  TO anon
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "anon_read" ON pos_audit_log;
CREATE POLICY "anon_read" ON pos_audit_log
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "anon_read_audit" ON pos_audit_log;
CREATE POLICY "anon_read_audit" ON pos_audit_log
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "audit_insert_only" ON pos_audit_log;
CREATE POLICY "audit_insert_only" ON pos_audit_log
  FOR INSERT
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "audit_no_delete" ON pos_audit_log;
CREATE POLICY "audit_no_delete" ON pos_audit_log
  FOR DELETE
  AS PERMISSIVE
  USING (false)
;
DROP POLICY IF EXISTS "audit_no_update" ON pos_audit_log;
CREATE POLICY "audit_no_update" ON pos_audit_log
  FOR UPDATE
  AS PERMISSIVE
  USING (false)
;
DROP POLICY IF EXISTS "audit_select_all" ON pos_audit_log;
CREATE POLICY "audit_select_all" ON pos_audit_log
  FOR SELECT
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "auth_all_audit" ON pos_audit_log;
CREATE POLICY "auth_all_audit" ON pos_audit_log
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "authenticated_all" ON pos_audit_log;
CREATE POLICY "authenticated_all" ON pos_audit_log
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "service_all_audit" ON pos_audit_log;
CREATE POLICY "service_all_audit" ON pos_audit_log
  FOR ALL
  TO service_role
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_billing_clients ──
ALTER TABLE pos_billing_clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_billing_clients" ON pos_billing_clients;
CREATE POLICY "anon_read_billing_clients" ON pos_billing_clients
  FOR SELECT
  AS PERMISSIVE
  USING (true)
;

-- ── pos_bridge_logs ──
ALTER TABLE pos_bridge_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON pos_bridge_logs;
CREATE POLICY "anon_all" ON pos_bridge_logs
  FOR ALL
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_cash_movements ──
ALTER TABLE pos_cash_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_insert" ON pos_cash_movements;
CREATE POLICY "anon_insert" ON pos_cash_movements
  FOR INSERT
  TO anon
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "anon_read" ON pos_cash_movements;
CREATE POLICY "anon_read" ON pos_cash_movements
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "auth_all" ON pos_cash_movements;
CREATE POLICY "auth_all" ON pos_cash_movements
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_category_modifiers ──
ALTER TABLE pos_category_modifiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon read" ON pos_category_modifiers;
CREATE POLICY "anon read" ON pos_category_modifiers
  FOR SELECT
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "authenticated_read" ON pos_category_modifiers;
CREATE POLICY "authenticated_read" ON pos_category_modifiers
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "authenticated_write" ON pos_category_modifiers;
CREATE POLICY "authenticated_write" ON pos_category_modifiers
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_cfdi_requests ──
ALTER TABLE pos_cfdi_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_insert_cfdi_requests" ON pos_cfdi_requests;
CREATE POLICY "anon_insert_cfdi_requests" ON pos_cfdi_requests
  FOR INSERT
  TO anon
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "anon_select_cfdi_requests" ON pos_cfdi_requests;
CREATE POLICY "anon_select_cfdi_requests" ON pos_cfdi_requests
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "authenticated_read" ON pos_cfdi_requests;
CREATE POLICY "authenticated_read" ON pos_cfdi_requests
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "authenticated_write" ON pos_cfdi_requests;
CREATE POLICY "authenticated_write" ON pos_cfdi_requests
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_cierres ──
ALTER TABLE pos_cierres ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_cierres" ON pos_cierres;
CREATE POLICY "anon_read_cierres" ON pos_cierres
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "anon_write_cierres" ON pos_cierres;
CREATE POLICY "anon_write_cierres" ON pos_cierres
  FOR INSERT
  TO anon
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "auth_all_cierres" ON pos_cierres;
CREATE POLICY "auth_all_cierres" ON pos_cierres
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "service_all_cierres" ON pos_cierres;
CREATE POLICY "service_all_cierres" ON pos_cierres
  FOR ALL
  TO service_role
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_clients ──
ALTER TABLE pos_clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON pos_clients;
CREATE POLICY "anon_all" ON pos_clients
  FOR ALL
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_combos ──
ALTER TABLE pos_combos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read" ON pos_combos;
CREATE POLICY "anon_read" ON pos_combos
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "auth_all" ON pos_combos;
CREATE POLICY "auth_all" ON pos_combos
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_customer_notes ──
ALTER TABLE pos_customer_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_notes" ON pos_customer_notes;
CREATE POLICY "anon_read_notes" ON pos_customer_notes
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "anon_write_notes" ON pos_customer_notes;
CREATE POLICY "anon_write_notes" ON pos_customer_notes
  FOR INSERT
  TO anon
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "auth_all_notes" ON pos_customer_notes;
CREATE POLICY "auth_all_notes" ON pos_customer_notes
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "service_all_notes" ON pos_customer_notes;
CREATE POLICY "service_all_notes" ON pos_customer_notes
  FOR ALL
  TO service_role
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_customer_visits ──
ALTER TABLE pos_customer_visits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pos_customer_visits_insert" ON pos_customer_visits;
CREATE POLICY "pos_customer_visits_insert" ON pos_customer_visits
  FOR INSERT
  TO anon
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "pos_customer_visits_select" ON pos_customer_visits;
CREATE POLICY "pos_customer_visits_select" ON pos_customer_visits
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;

-- ── pos_customers ──
ALTER TABLE pos_customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pos_customers_insert" ON pos_customers;
CREATE POLICY "pos_customers_insert" ON pos_customers
  FOR INSERT
  TO anon
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "pos_customers_select" ON pos_customers;
CREATE POLICY "pos_customers_select" ON pos_customers
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "pos_customers_update" ON pos_customers;
CREATE POLICY "pos_customers_update" ON pos_customers
  FOR UPDATE
  TO anon
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_facturas ──
ALTER TABLE pos_facturas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fact_insert" ON pos_facturas;
CREATE POLICY "fact_insert" ON pos_facturas
  FOR INSERT
  TO anon,authenticated
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "fact_select" ON pos_facturas;
CREATE POLICY "fact_select" ON pos_facturas
  FOR SELECT
  TO anon,authenticated
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "fact_update" ON pos_facturas;
CREATE POLICY "fact_update" ON pos_facturas
  FOR UPDATE
  TO anon,authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_fingerprint_templates ──
ALTER TABLE pos_fingerprint_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON pos_fingerprint_templates;
CREATE POLICY "anon_all" ON pos_fingerprint_templates
  FOR ALL
  TO anon
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_gastos ──
ALTER TABLE pos_gastos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all_gastos" ON pos_gastos;
CREATE POLICY "anon_all_gastos" ON pos_gastos
  FOR ALL
  TO anon
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "auth_all_gastos" ON pos_gastos;
CREATE POLICY "auth_all_gastos" ON pos_gastos
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_ingredient_presentations ──
ALTER TABLE pos_ingredient_presentations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rls_ip_select" ON pos_ingredient_presentations;
CREATE POLICY "rls_ip_select" ON pos_ingredient_presentations
  FOR SELECT
  TO anon,authenticated
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "rls_ip_service" ON pos_ingredient_presentations;
CREATE POLICY "rls_ip_service" ON pos_ingredient_presentations
  FOR ALL
  TO service_role
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_ingredients ──
ALTER TABLE pos_ingredients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read" ON pos_ingredients;
CREATE POLICY "anon_read" ON pos_ingredients
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "anon_select_ingredients" ON pos_ingredients;
CREATE POLICY "anon_select_ingredients" ON pos_ingredients
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "authenticated_all" ON pos_ingredients;
CREATE POLICY "authenticated_all" ON pos_ingredients
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "ing_update_anon" ON pos_ingredients;
CREATE POLICY "ing_update_anon" ON pos_ingredients
  FOR UPDATE
  TO anon
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_insumos ──
ALTER TABLE pos_insumos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read pos_insumos" ON pos_insumos;
CREATE POLICY "Allow read pos_insumos" ON pos_insumos
  FOR SELECT
  AS PERMISSIVE
  USING (true)
;

-- ── pos_inventory ──
ALTER TABLE pos_inventory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inv_insert" ON pos_inventory;
CREATE POLICY "inv_insert" ON pos_inventory
  FOR INSERT
  TO anon,authenticated
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "inv_select" ON pos_inventory;
CREATE POLICY "inv_select" ON pos_inventory
  FOR SELECT
  TO anon,authenticated
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "inv_update" ON pos_inventory;
CREATE POLICY "inv_update" ON pos_inventory
  FOR UPDATE
  TO anon,authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_inventory_alerts ──
ALTER TABLE pos_inventory_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON pos_inventory_alerts;
CREATE POLICY "anon_all" ON pos_inventory_alerts
  FOR ALL
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_inventory_movements ──
ALTER TABLE pos_inventory_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_insert_inv_movements" ON pos_inventory_movements;
CREATE POLICY "anon_insert_inv_movements" ON pos_inventory_movements
  FOR INSERT
  TO anon
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "anon_read_inv_movements" ON pos_inventory_movements;
CREATE POLICY "anon_read_inv_movements" ON pos_inventory_movements
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "auth_insert_inv_movements" ON pos_inventory_movements;
CREATE POLICY "auth_insert_inv_movements" ON pos_inventory_movements
  FOR INSERT
  TO authenticated
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "auth_read_inv_movements" ON pos_inventory_movements;
CREATE POLICY "auth_read_inv_movements" ON pos_inventory_movements
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;

-- ── pos_inventory_products ──
ALTER TABLE pos_inventory_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_insert_inv_products" ON pos_inventory_products;
CREATE POLICY "anon_insert_inv_products" ON pos_inventory_products
  FOR INSERT
  TO anon
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "anon_read_inv_products" ON pos_inventory_products;
CREATE POLICY "anon_read_inv_products" ON pos_inventory_products
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "anon_update_inv_products" ON pos_inventory_products;
CREATE POLICY "anon_update_inv_products" ON pos_inventory_products
  FOR UPDATE
  TO anon
  AS PERMISSIVE
  USING (true)
;

-- ── pos_item_modifier_groups ──
ALTER TABLE pos_item_modifier_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon read" ON pos_item_modifier_groups;
CREATE POLICY "anon read" ON pos_item_modifier_groups
  FOR SELECT
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "anon_all" ON pos_item_modifier_groups;
CREATE POLICY "anon_all" ON pos_item_modifier_groups
  FOR ALL
  TO anon
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_market_movements ──
ALTER TABLE pos_market_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_insert_market_mov" ON pos_market_movements;
CREATE POLICY "anon_insert_market_mov" ON pos_market_movements
  FOR INSERT
  TO anon
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "anon_read_market_mov" ON pos_market_movements;
CREATE POLICY "anon_read_market_mov" ON pos_market_movements
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;

-- ── pos_market_stock ──
ALTER TABLE pos_market_stock ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_insert_market_stock" ON pos_market_stock;
CREATE POLICY "anon_insert_market_stock" ON pos_market_stock
  FOR INSERT
  TO anon
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "anon_read_market_stock" ON pos_market_stock;
CREATE POLICY "anon_read_market_stock" ON pos_market_stock
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "anon_update_market_stock" ON pos_market_stock;
CREATE POLICY "anon_update_market_stock" ON pos_market_stock
  FOR UPDATE
  TO anon
  AS PERMISSIVE
  USING (true)
;

-- ── pos_menu_categories ──
ALTER TABLE pos_menu_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_menu_categories" ON pos_menu_categories;
CREATE POLICY "anon_read_menu_categories" ON pos_menu_categories
  FOR SELECT
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "anon_update_menu_categories" ON pos_menu_categories;
CREATE POLICY "anon_update_menu_categories" ON pos_menu_categories
  FOR UPDATE
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "anon_write_menu_categories" ON pos_menu_categories;
CREATE POLICY "anon_write_menu_categories" ON pos_menu_categories
  FOR INSERT
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "authenticated_read" ON pos_menu_categories;
CREATE POLICY "authenticated_read" ON pos_menu_categories
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "authenticated_write" ON pos_menu_categories;
CREATE POLICY "authenticated_write" ON pos_menu_categories
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_menu_items ──
ALTER TABLE pos_menu_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_menu_items" ON pos_menu_items;
CREATE POLICY "anon_read_menu_items" ON pos_menu_items
  FOR SELECT
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "anon_update_menu_items" ON pos_menu_items;
CREATE POLICY "anon_update_menu_items" ON pos_menu_items
  FOR UPDATE
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "anon_write_menu_items" ON pos_menu_items;
CREATE POLICY "anon_write_menu_items" ON pos_menu_items
  FOR INSERT
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "authenticated_read" ON pos_menu_items;
CREATE POLICY "authenticated_read" ON pos_menu_items
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "authenticated_write" ON pos_menu_items;
CREATE POLICY "authenticated_write" ON pos_menu_items
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_modifier_groups ──
ALTER TABLE pos_modifier_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon read" ON pos_modifier_groups;
CREATE POLICY "anon read" ON pos_modifier_groups
  FOR SELECT
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "authenticated_read" ON pos_modifier_groups;
CREATE POLICY "authenticated_read" ON pos_modifier_groups
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "authenticated_write" ON pos_modifier_groups;
CREATE POLICY "authenticated_write" ON pos_modifier_groups
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_modifiers ──
ALTER TABLE pos_modifiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon read" ON pos_modifiers;
CREATE POLICY "anon read" ON pos_modifiers
  FOR SELECT
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "authenticated_read" ON pos_modifiers;
CREATE POLICY "authenticated_read" ON pos_modifiers
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "authenticated_write" ON pos_modifiers;
CREATE POLICY "authenticated_write" ON pos_modifiers
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_orders ──
ALTER TABLE pos_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_insert_orders" ON pos_orders;
CREATE POLICY "anon_insert_orders" ON pos_orders
  FOR INSERT
  TO anon
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "anon_read" ON pos_orders;
CREATE POLICY "anon_read" ON pos_orders
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "anon_update_orders" ON pos_orders;
CREATE POLICY "anon_update_orders" ON pos_orders
  FOR UPDATE
  TO anon
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "authenticated_all" ON pos_orders;
CREATE POLICY "authenticated_all" ON pos_orders
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_payment_methods ──
ALTER TABLE pos_payment_methods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_payment_methods" ON pos_payment_methods;
CREATE POLICY "anon_read_payment_methods" ON pos_payment_methods
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "authenticated_read" ON pos_payment_methods;
CREATE POLICY "authenticated_read" ON pos_payment_methods
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "authenticated_write" ON pos_payment_methods;
CREATE POLICY "authenticated_write" ON pos_payment_methods
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_presentations ──
ALTER TABLE pos_presentations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rls_pres_select" ON pos_presentations;
CREATE POLICY "rls_pres_select" ON pos_presentations
  FOR SELECT
  TO anon,authenticated
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "rls_pres_service" ON pos_presentations;
CREATE POLICY "rls_pres_service" ON pos_presentations
  FOR ALL
  TO service_role
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_print_jobs ──
ALTER TABLE pos_print_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON pos_print_jobs;
CREATE POLICY "anon_all" ON pos_print_jobs
  FOR ALL
  TO anon
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "auth_all" ON pos_print_jobs;
CREATE POLICY "auth_all" ON pos_print_jobs
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_promos ──
ALTER TABLE pos_promos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON pos_promos;
CREATE POLICY "anon_all" ON pos_promos
  FOR ALL
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_promotions ──
ALTER TABLE pos_promotions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read" ON pos_promotions;
CREATE POLICY "anon_read" ON pos_promotions
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "auth_all" ON pos_promotions;
CREATE POLICY "auth_all" ON pos_promotions
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_purchase_order_items ──
ALTER TABLE pos_purchase_order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "poi_insert" ON pos_purchase_order_items;
CREATE POLICY "poi_insert" ON pos_purchase_order_items
  FOR INSERT
  TO anon,authenticated
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "poi_select" ON pos_purchase_order_items;
CREATE POLICY "poi_select" ON pos_purchase_order_items
  FOR SELECT
  TO anon,authenticated
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "poi_update" ON pos_purchase_order_items;
CREATE POLICY "poi_update" ON pos_purchase_order_items
  FOR UPDATE
  TO anon,authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_purchase_orders ──
ALTER TABLE pos_purchase_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "po_insert" ON pos_purchase_orders;
CREATE POLICY "po_insert" ON pos_purchase_orders
  FOR INSERT
  TO anon,authenticated
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "po_select" ON pos_purchase_orders;
CREATE POLICY "po_select" ON pos_purchase_orders
  FOR SELECT
  TO anon,authenticated
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "po_update" ON pos_purchase_orders;
CREATE POLICY "po_update" ON pos_purchase_orders
  FOR UPDATE
  TO anon,authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_recipe_details ──
ALTER TABLE pos_recipe_details ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rd_select" ON pos_recipe_details;
CREATE POLICY "rd_select" ON pos_recipe_details
  FOR SELECT
  TO anon,authenticated
  AS PERMISSIVE
  USING (true)
;

-- ── pos_recipes ──
ALTER TABLE pos_recipes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read pos_recipes_new" ON pos_recipes;
CREATE POLICY "Allow read pos_recipes_new" ON pos_recipes
  FOR SELECT
  AS PERMISSIVE
  USING (true)
;

-- ── pos_recipes_old ──
ALTER TABLE pos_recipes_old ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read pos_recipes" ON pos_recipes_old;
CREATE POLICY "Allow read pos_recipes" ON pos_recipes_old
  FOR SELECT
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "anon_read" ON pos_recipes_old;
CREATE POLICY "anon_read" ON pos_recipes_old
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "anon_select_recipes" ON pos_recipes_old;
CREATE POLICY "anon_select_recipes" ON pos_recipes_old
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "authenticated_all" ON pos_recipes_old;
CREATE POLICY "authenticated_all" ON pos_recipes_old
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_staff ──
ALTER TABLE pos_staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_staff" ON pos_staff;
CREATE POLICY "anon_read_staff" ON pos_staff
  FOR SELECT
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "authenticated_all" ON pos_staff;
CREATE POLICY "authenticated_all" ON pos_staff
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_staff_audit ──
ALTER TABLE pos_staff_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON pos_staff_audit;
CREATE POLICY "anon_all" ON pos_staff_audit
  FOR ALL
  TO anon
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_staff_shifts ──
ALTER TABLE pos_staff_shifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_shifts" ON pos_staff_shifts;
CREATE POLICY "anon_read_shifts" ON pos_staff_shifts
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "anon_update_shifts" ON pos_staff_shifts;
CREATE POLICY "anon_update_shifts" ON pos_staff_shifts
  FOR UPDATE
  TO anon
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "anon_write_shifts" ON pos_staff_shifts;
CREATE POLICY "anon_write_shifts" ON pos_staff_shifts
  FOR INSERT
  TO anon
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "auth_all_shifts" ON pos_staff_shifts;
CREATE POLICY "auth_all_shifts" ON pos_staff_shifts
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "service_all_shifts" ON pos_staff_shifts;
CREATE POLICY "service_all_shifts" ON pos_staff_shifts
  FOR ALL
  TO service_role
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_sub_recipe_ingredients ──
ALTER TABLE pos_sub_recipe_ingredients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rls_sri_select" ON pos_sub_recipe_ingredients;
CREATE POLICY "rls_sri_select" ON pos_sub_recipe_ingredients
  FOR SELECT
  TO anon,authenticated
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "rls_sri_service" ON pos_sub_recipe_ingredients;
CREATE POLICY "rls_sri_service" ON pos_sub_recipe_ingredients
  FOR ALL
  TO service_role
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_sub_recipes ──
ALTER TABLE pos_sub_recipes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rls_sub_recipes_select" ON pos_sub_recipes;
CREATE POLICY "rls_sub_recipes_select" ON pos_sub_recipes
  FOR SELECT
  TO anon,authenticated
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "rls_sub_recipes_service" ON pos_sub_recipes;
CREATE POLICY "rls_sub_recipes_service" ON pos_sub_recipes
  FOR ALL
  TO service_role
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_suppliers ──
ALTER TABLE pos_suppliers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow insert pos_suppliers" ON pos_suppliers;
CREATE POLICY "Allow insert pos_suppliers" ON pos_suppliers
  FOR INSERT
  TO authenticated
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "Allow read pos_suppliers" ON pos_suppliers;
CREATE POLICY "Allow read pos_suppliers" ON pos_suppliers
  FOR SELECT
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "Allow update pos_suppliers" ON pos_suppliers;
CREATE POLICY "Allow update pos_suppliers" ON pos_suppliers
  FOR UPDATE
  TO authenticated
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "anon_insert_suppliers" ON pos_suppliers;
CREATE POLICY "anon_insert_suppliers" ON pos_suppliers
  FOR INSERT
  TO anon
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "anon_read_suppliers" ON pos_suppliers;
CREATE POLICY "anon_read_suppliers" ON pos_suppliers
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "anon_update_suppliers" ON pos_suppliers;
CREATE POLICY "anon_update_suppliers" ON pos_suppliers
  FOR UPDATE
  TO anon
  AS PERMISSIVE
  USING (true)
;

-- ── pos_turnos ──
ALTER TABLE pos_turnos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all_turnos" ON pos_turnos;
CREATE POLICY "anon_all_turnos" ON pos_turnos
  FOR ALL
  TO anon
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "anon_insert_turnos" ON pos_turnos;
CREATE POLICY "anon_insert_turnos" ON pos_turnos
  FOR INSERT
  TO anon
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "anon_read_turnos" ON pos_turnos;
CREATE POLICY "anon_read_turnos" ON pos_turnos
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "anon_update_turnos" ON pos_turnos;
CREATE POLICY "anon_update_turnos" ON pos_turnos
  FOR UPDATE
  TO anon
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "auth_all_turnos" ON pos_turnos;
CREATE POLICY "auth_all_turnos" ON pos_turnos
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "service_all_turnos" ON pos_turnos;
CREATE POLICY "service_all_turnos" ON pos_turnos
  FOR ALL
  TO service_role
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── pos_unit_conversions ──
ALTER TABLE pos_unit_conversions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rls_uc_select" ON pos_unit_conversions;
CREATE POLICY "rls_uc_select" ON pos_unit_conversions
  FOR SELECT
  TO anon,authenticated
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "rls_uc_service" ON pos_unit_conversions;
CREATE POLICY "rls_uc_service" ON pos_unit_conversions
  FOR ALL
  TO service_role
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── push_subscriptions ──
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all" ON push_subscriptions;
CREATE POLICY "authenticated_all" ON push_subscriptions
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

-- ── reservaciones ──
ALTER TABLE reservaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reservaciones_read" ON reservaciones;
CREATE POLICY "reservaciones_read" ON reservaciones
  FOR SELECT
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "reservaciones_update" ON reservaciones;
CREATE POLICY "reservaciones_update" ON reservaciones
  FOR UPDATE
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "reservaciones_write" ON reservaciones;
CREATE POLICY "reservaciones_write" ON reservaciones
  FOR INSERT
  AS PERMISSIVE
  WITH CHECK (true)
;

-- ── reviews ──
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select" ON reviews;
CREATE POLICY "anon_select" ON reviews
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "anon_update_draft" ON reviews;
CREATE POLICY "anon_update_draft" ON reviews
  FOR UPDATE
  TO authenticated
  AS PERMISSIVE
  USING ((status = ANY (ARRAY['pending'::text, 'draft'::text])))
  WITH CHECK ((status = ANY (ARRAY['pending'::text, 'draft'::text])))
;

-- ── tasks ──
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select" ON tasks;
CREATE POLICY "anon_select" ON tasks
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;

-- ── wansoft_catalog ──
ALTER TABLE wansoft_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read" ON wansoft_catalog;
CREATE POLICY "Allow read" ON wansoft_catalog
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;

-- ── wansoft_daily ──
ALTER TABLE wansoft_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_read" ON wansoft_daily;
CREATE POLICY "authenticated_read" ON wansoft_daily
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "public_read_wansoft_daily" ON wansoft_daily;
CREATE POLICY "public_read_wansoft_daily" ON wansoft_daily
  FOR SELECT
  AS PERMISSIVE
  USING (true)
;

-- ── wansoft_data ──
ALTER TABLE wansoft_data ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read" ON wansoft_data;
CREATE POLICY "Allow read" ON wansoft_data
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "anon_survey_insert" ON wansoft_data;
CREATE POLICY "anon_survey_insert" ON wansoft_data
  FOR INSERT
  TO anon
  AS PERMISSIVE
  WITH CHECK ((data_key ~~ 'survey%'::text))
;
DROP POLICY IF EXISTS "anon_survey_select" ON wansoft_data;
CREATE POLICY "anon_survey_select" ON wansoft_data
  FOR SELECT
  TO anon
  AS PERMISSIVE
  USING ((data_key ~~ 'survey%'::text))
;

-- ── wansoft_food_cost ──
ALTER TABLE wansoft_food_cost ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read wansoft_food_cost" ON wansoft_food_cost;
CREATE POLICY "Allow read wansoft_food_cost" ON wansoft_food_cost
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;

-- ── wansoft_hourly ──
ALTER TABLE wansoft_hourly ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow delete" ON wansoft_hourly;
CREATE POLICY "Allow delete" ON wansoft_hourly
  FOR DELETE
  TO authenticated
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "Allow insert" ON wansoft_hourly;
CREATE POLICY "Allow insert" ON wansoft_hourly
  FOR INSERT
  TO authenticated
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "Allow read" ON wansoft_hourly;
CREATE POLICY "Allow read" ON wansoft_hourly
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "Allow update" ON wansoft_hourly;
CREATE POLICY "Allow update" ON wansoft_hourly
  FOR UPDATE
  TO authenticated
  AS PERMISSIVE
  USING (true)
;

-- ── wansoft_inventory ──
ALTER TABLE wansoft_inventory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read wansoft_inventory" ON wansoft_inventory;
CREATE POLICY "Allow read wansoft_inventory" ON wansoft_inventory
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;

-- ── wansoft_kpis ──
ALTER TABLE wansoft_kpis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read" ON wansoft_kpis;
CREATE POLICY "Allow read" ON wansoft_kpis
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "public_read_wansoft_kpis" ON wansoft_kpis;
CREATE POLICY "public_read_wansoft_kpis" ON wansoft_kpis
  FOR SELECT
  AS PERMISSIVE
  USING (true)
;

-- ── wansoft_labor ──
ALTER TABLE wansoft_labor ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read" ON wansoft_labor;
CREATE POLICY "Allow read" ON wansoft_labor
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;

-- ── wansoft_menu_config ──
ALTER TABLE wansoft_menu_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read" ON wansoft_menu_config;
CREATE POLICY "Allow read" ON wansoft_menu_config
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;

-- ── wansoft_persons_hourly ──
ALTER TABLE wansoft_persons_hourly ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read" ON wansoft_persons_hourly;
CREATE POLICY "Allow read" ON wansoft_persons_hourly
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;

-- ── wansoft_pnl ──
ALTER TABLE wansoft_pnl ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read" ON wansoft_pnl;
CREATE POLICY "Allow read" ON wansoft_pnl
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;

-- ── wansoft_recipes ──
ALTER TABLE wansoft_recipes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read wansoft_recipes" ON wansoft_recipes;
CREATE POLICY "Allow read wansoft_recipes" ON wansoft_recipes
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;

-- ── wansoft_shrinkage ──
ALTER TABLE wansoft_shrinkage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read" ON wansoft_shrinkage;
CREATE POLICY "Allow read" ON wansoft_shrinkage
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;

-- ── wansoft_suppliers ──
ALTER TABLE wansoft_suppliers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read" ON wansoft_suppliers;
CREATE POLICY "Allow read" ON wansoft_suppliers
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;

-- ── wansoft_tips ──
ALTER TABLE wansoft_tips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow delete tips" ON wansoft_tips;
CREATE POLICY "Allow delete tips" ON wansoft_tips
  FOR DELETE
  TO authenticated
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "Allow insert tips" ON wansoft_tips;
CREATE POLICY "Allow insert tips" ON wansoft_tips
  FOR INSERT
  TO authenticated
  AS PERMISSIVE
  WITH CHECK (true)
;
DROP POLICY IF EXISTS "Allow read wansoft_tips" ON wansoft_tips;
CREATE POLICY "Allow read wansoft_tips" ON wansoft_tips
  FOR SELECT
  TO authenticated
  AS PERMISSIVE
  USING (true)
;
DROP POLICY IF EXISTS "Allow update tips" ON wansoft_tips;
CREATE POLICY "Allow update tips" ON wansoft_tips
  FOR UPDATE
  TO authenticated
  AS PERMISSIVE
  USING (true)
;

-- ── wansoft_waiter_categories ──
ALTER TABLE wansoft_waiter_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all" ON wansoft_waiter_categories;
CREATE POLICY "authenticated_all" ON wansoft_waiter_categories
  FOR ALL
  TO authenticated
  AS PERMISSIVE
  USING (true)
  WITH CHECK (true)
;

