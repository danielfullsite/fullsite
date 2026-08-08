-- ═════════════════════════════════════════════════════════════════════════════
-- W1-B · Saldo inicial (opening_balance) — punto de partida de reconstrucción
-- ═════════════════════════════════════════════════════════════════════════════
-- Inserta UN movimiento 'opening_balance' por ingrediente con el STOCK ACTUAL
-- ALMACENADO como cantidad (incluidos negativos: el negativo es verdad operativa
-- conocida y queda registrado como tal, no se "corrige").
--
-- Invariante desde el cutover:
--   pos_inventory.stock == opening.quantity + SUM(movimientos con id > opening.id)
--
-- NO reescribe historia: los movimientos previos al opening quedan intactos como
-- histórico; la reconstrucción arranca EN el opening (el drift histórico previo
-- se REPORTA con w1b_drift_report.sql, no se absorbe ni se borra).
--
-- Idempotente: key estable `w1b_opening_{client}_{ingredient}` + UNIQUE
-- (client_id, idempotency_key, ingredient_id) → re-ejecución no duplica.
-- Requiere: w1b_ledger_migration.sql aplicado.
-- Uso: reemplazar CLIENT_ID_HERE. Staging primero; prod solo con autorización.
-- ═════════════════════════════════════════════════════════════════════════════

INSERT INTO pos_inventory_movements
  (client_id, ingredient_id, movement_type, quantity, actor, idempotency_key, notes)
SELECT
  inv.client_id,
  inv.ingredient_id,
  'opening_balance',
  inv.stock,
  'w1b_backfill',
  'w1b_opening_' || inv.client_id || '_' || inv.ingredient_id,
  'W1-B saldo inicial: preserva stock conocido al cutover (stock=' || inv.stock || ')'
FROM pos_inventory inv
WHERE inv.client_id = 'CLIENT_ID_HERE'
ON CONFLICT (client_id, idempotency_key, ingredient_id) WHERE idempotency_key IS NOT NULL
DO NOTHING;
