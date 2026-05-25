-- Enable RLS on POS admin tables that were missing it
-- These tables have client_id columns — policies restrict by authenticated user

ALTER TABLE pos_sizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_delivery_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_gift_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_retail_items ENABLE ROW LEVEL SECURITY;

-- Also enable on wansoft tables that had it disabled
ALTER TABLE wansoft_menu_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE wansoft_data ENABLE ROW LEVEL SECURITY;

-- Policies: authenticated users can read all rows (single-tenant for now)
-- When multi-tenant launches, replace USING (true) with USING (client_id = auth.jwt()->>'client_id')

CREATE POLICY "auth_read" ON pos_sizes FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write" ON pos_sizes FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_read" ON pos_schedules FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write" ON pos_schedules FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_read" ON pos_payment_methods FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write" ON pos_payment_methods FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_read" ON pos_promotions FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write" ON pos_promotions FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_read" ON pos_delivery_zones FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write" ON pos_delivery_zones FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_read" ON pos_gift_cards FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write" ON pos_gift_cards FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_read" ON pos_retail_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write" ON pos_retail_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_read" ON wansoft_menu_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write" ON wansoft_menu_config FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_read" ON wansoft_data FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write" ON wansoft_data FOR ALL TO authenticated USING (true) WITH CHECK (true);
