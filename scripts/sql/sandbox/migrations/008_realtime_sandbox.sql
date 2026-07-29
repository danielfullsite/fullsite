-- =============================================================================
-- SANDBOX-SAFE MIGRATION
-- Source:  008_realtime.sql
-- Branch:  sandbox/second-customer-skeleton
-- Project: fullsite-sandbox (NEVER apply to qjiomlvudfmzuvqvhwpk)
--
-- Transformations applied:
--   [1] No transformations — file is clean
-- =============================================================================

-- Supabase Realtime Publications
ALTER PUBLICATION supabase_realtime ADD TABLE pos_inventory;
ALTER PUBLICATION supabase_realtime ADD TABLE pos_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE pos_staff_shifts;
