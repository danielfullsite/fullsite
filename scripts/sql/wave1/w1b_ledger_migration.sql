-- ═════════════════════════════════════════════════════════════════════════════
-- W1-B · Ledger canónico: idempotencia a nivel BD (migración ADITIVA)
-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Columna idempotency_key explícita (reemplaza el check LIKE sobre notes).
-- 2. UNIQUE por (client_id, idempotency_key, ingredient_id): recordMovement
--    inserta una fila POR LÍNEA compartiendo la key del request, por lo que la
--    unicidad es por línea. Un replay total conflictúa completo; un replay tras
--    escritura parcial solo inserta las filas faltantes (auto-sana).
-- 3. Sin CHECK de movement_type (no existía; los tipos nuevos opening_balance /
--    transfer_out / transfer_in / return ya son válidos).
-- Rollback: DROP INDEX uq_inv_mov_idempotency; ALTER TABLE ... DROP COLUMN
-- idempotency_key. Aditiva — no toca filas ni policies RLS existentes.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE pos_inventory_movements
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_mov_idempotency
  ON pos_inventory_movements (client_id, idempotency_key, ingredient_id)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inv_mov_client_ingredient
  ON pos_inventory_movements (client_id, ingredient_id, id);
