-- R2D Tests — Run in Supabase SQL Editor AFTER r2d_save_operation_idempotency.sql
-- All test data is cleaned up at the end. ZERO production side effects.

-- ═══════════════════════════════════════════════════════════════════
-- SETUP: Create test order fixture
-- ═══════════════════════════════════════════════════════════════════

-- Ensure test order doesn't exist
DELETE FROM pos_save_operations WHERE order_id LIKE 'r2d-test-%';
DELETE FROM pos_reconciliation_results WHERE order_id LIKE 'r2d-test-%';
DELETE FROM pos_orders WHERE id LIKE 'r2d-test-%';

-- ═══════════════════════════════════════════════════════════════════
-- TEST 1: FIRST EXECUTION — new order, new operation ID
-- ═══════════════════════════════════════════════════════════════════

DO $test$
DECLARE
  v_result jsonb;
BEGIN
  v_result := r1_save_order_idempotent(
    'amalay', 'r2d-test-order-1', 'r2d-op-1',
    0, -- expected_revision
    99, -- mesa
    NULL, -- customer_name
    'Test Mesero', -- mesero
    2, -- personas
    'enviada', -- status
    100.00, 0.00, 100.00, 0.00, 0.00, -- subtotal, iva, total, descuento, propina
    NULL, NULL, NULL, NULL, -- metodo_pago, pagos, turno_id, notas
    '[{"id":"item-1","nombre":"Cafe Test","cantidad":1,"precio":50,"precioExtra":0,"subtotal":50},{"id":"item-2","nombre":"Jugo Test","cantidad":1,"precio":50,"precioExtra":0,"subtotal":50}]'::jsonb,
    NULL -- closed_at
  );

  RAISE NOTICE 'TEST 1 RESULT: %', v_result;
  ASSERT (v_result->>'ok')::boolean = true, 'TEST 1: save should succeed';
  ASSERT (v_result->>'revision')::int = 1, 'TEST 1: revision should be 1';
  ASSERT (v_result->>'first_execution')::boolean = true, 'TEST 1: should be first_execution';
  ASSERT (v_result->>'idempotent_replay')::boolean = false, 'TEST 1: should NOT be idempotent_replay';
  RAISE NOTICE 'TEST 1 PASS: First execution committed revision 1';
END;
$test$;

-- Verify ledger
DO $test$
DECLARE
  v_op record;
BEGIN
  SELECT * INTO v_op FROM pos_save_operations
  WHERE client_id = 'amalay' AND order_id = 'r2d-test-order-1' AND save_operation_id = 'r2d-op-1';

  ASSERT v_op IS NOT NULL, 'TEST 1b: ledger row should exist';
  ASSERT v_op.state = 'COMMITTED', 'TEST 1b: state should be COMMITTED';
  ASSERT v_op.committed_revision = 1, 'TEST 1b: committed_revision should be 1';
  ASSERT v_op.rejection_detail IS NULL, 'TEST 1b: rejection_detail should be NULL';
  ASSERT v_op.payload_hash IS NOT NULL AND length(v_op.payload_hash) = 64, 'TEST 1b: payload_hash should be 64-char hex (SHA-256)';
  RAISE NOTICE 'TEST 1b PASS: Ledger row verified — COMMITTED, revision=1, hash=%', v_op.payload_hash;
END;
$test$;

-- ═══════════════════════════════════════════════════════════════════
-- TEST 2: IDEMPOTENT REPLAY — same operation ID, same payload
-- (Simulates ambiguous commit: response lost, same operation replayed)
-- ═══════════════════════════════════════════════════════════════════

DO $test$
DECLARE
  v_result jsonb;
  v_order_rev_before bigint;
  v_order_rev_after bigint;
BEGIN
  -- Record order revision before replay
  SELECT order_revision INTO v_order_rev_before FROM pos_orders WHERE id = 'r2d-test-order-1';

  -- Replay SAME operation with SAME payload (expected_revision=0, same items)
  v_result := r1_save_order_idempotent(
    'amalay', 'r2d-test-order-1', 'r2d-op-1',
    0, -- SAME expected_revision as original
    99, NULL, 'Test Mesero', 2, 'enviada',
    100.00, 0.00, 100.00, 0.00, 0.00,
    NULL, NULL, NULL, NULL,
    '[{"id":"item-1","nombre":"Cafe Test","cantidad":1,"precio":50,"precioExtra":0,"subtotal":50},{"id":"item-2","nombre":"Jugo Test","cantidad":1,"precio":50,"precioExtra":0,"subtotal":50}]'::jsonb,
    NULL
  );

  -- Record order revision after replay
  SELECT order_revision INTO v_order_rev_after FROM pos_orders WHERE id = 'r2d-test-order-1';

  RAISE NOTICE 'TEST 2 RESULT: %', v_result;
  ASSERT (v_result->>'ok')::boolean = true, 'TEST 2: should return ok=true (idempotent)';
  ASSERT (v_result->>'revision')::int = 1, 'TEST 2: should return original committed revision 1';
  ASSERT (v_result->>'first_execution')::boolean = false, 'TEST 2: should NOT be first_execution';
  ASSERT (v_result->>'idempotent_replay')::boolean = true, 'TEST 2: should be idempotent_replay';
  ASSERT (v_result->>'conflict')::boolean = false, 'TEST 2: should NOT be a conflict';
  ASSERT v_order_rev_before = v_order_rev_after, 'TEST 2: order_revision must NOT advance on replay';
  RAISE NOTICE 'TEST 2 PASS: Idempotent replay returned original revision=1, zero state mutation, order_revision unchanged at %', v_order_rev_after;
END;
$test$;

-- ═══════════════════════════════════════════════════════════════════
-- TEST 3: PAYLOAD IDENTITY CORRUPTION — same operation ID, different payload
-- ═══════════════════════════════════════════════════════════════════

DO $test$
DECLARE
  v_result jsonb;
  v_order_rev_before bigint;
  v_order_rev_after bigint;
BEGIN
  SELECT order_revision INTO v_order_rev_before FROM pos_orders WHERE id = 'r2d-test-order-1';

  -- Same operation ID but DIFFERENT payload (added an item)
  v_result := r1_save_order_idempotent(
    'amalay', 'r2d-test-order-1', 'r2d-op-1',
    0,
    99, NULL, 'Test Mesero', 2, 'enviada',
    150.00, 0.00, 150.00, 0.00, 0.00, -- different total
    NULL, NULL, NULL, NULL,
    '[{"id":"item-1","nombre":"Cafe Test","cantidad":1,"precio":50,"precioExtra":0,"subtotal":50},{"id":"item-2","nombre":"Jugo Test","cantidad":1,"precio":50,"precioExtra":0,"subtotal":50},{"id":"item-3","nombre":"Extra","cantidad":1,"precio":50,"precioExtra":0,"subtotal":50}]'::jsonb,
    NULL
  );

  SELECT order_revision INTO v_order_rev_after FROM pos_orders WHERE id = 'r2d-test-order-1';

  RAISE NOTICE 'TEST 3 RESULT: %', v_result;
  ASSERT (v_result->>'ok')::boolean = false, 'TEST 3: should fail';
  ASSERT v_result->>'error' = 'PAYLOAD_IDENTITY_CORRUPTION', 'TEST 3: should be PAYLOAD_IDENTITY_CORRUPTION';
  ASSERT v_order_rev_before = v_order_rev_after, 'TEST 3: order_revision must NOT change';
  RAISE NOTICE 'TEST 3 PASS: Payload identity corruption detected, no mutation';
END;
$test$;

-- ═══════════════════════════════════════════════════════════════════
-- TEST 4: DIFFERENT OPERATION, STALE REVISION — OCC still works
-- ═══════════════════════════════════════════════════════════════════

DO $test$
DECLARE
  v_result jsonb;
BEGIN
  -- New operation ID, but expected_revision=0 while server is at 1
  v_result := r1_save_order_idempotent(
    'amalay', 'r2d-test-order-1', 'r2d-op-2-stale',
    0, -- expected_revision=0, but server is at 1 → STALE
    99, NULL, 'Test Mesero', 2, 'enviada',
    100.00, 0.00, 100.00, 0.00, 0.00,
    NULL, NULL, NULL, NULL,
    '[{"id":"item-1","nombre":"Cafe Test","cantidad":1,"precio":50,"precioExtra":0,"subtotal":50}]'::jsonb,
    NULL
  );

  RAISE NOTICE 'TEST 4 RESULT: %', v_result;
  ASSERT (v_result->>'ok')::boolean = false, 'TEST 4: should fail';
  ASSERT (v_result->>'conflict')::boolean = true, 'TEST 4: should be conflict';
  ASSERT v_result->>'error' = 'STALE_WRITE_REJECTED', 'TEST 4: should be STALE_WRITE_REJECTED';
  ASSERT (v_result->>'first_execution')::boolean = true, 'TEST 4: is first_execution (new op ID)';
  ASSERT (v_result->>'idempotent_replay')::boolean = false, 'TEST 4: not idempotent_replay';
  RAISE NOTICE 'TEST 4 PASS: Different operation correctly rejected as stale (expected 0, server at %).', v_result->>'current_revision';
END;
$test$;

-- Verify stale rejection is also recorded in ledger
DO $test$
DECLARE
  v_op record;
BEGIN
  SELECT * INTO v_op FROM pos_save_operations
  WHERE client_id = 'amalay' AND order_id = 'r2d-test-order-1' AND save_operation_id = 'r2d-op-2-stale';

  ASSERT v_op IS NOT NULL, 'TEST 4b: ledger row should exist for rejected operation';
  ASSERT v_op.state = 'REJECTED', 'TEST 4b: state should be REJECTED';
  ASSERT v_op.committed_revision IS NULL, 'TEST 4b: committed_revision should be NULL';
  ASSERT v_op.rejection_detail = 'STALE_WRITE_REJECTED', 'TEST 4b: rejection_detail should be STALE_WRITE_REJECTED';
  RAISE NOTICE 'TEST 4b PASS: Rejected operation recorded in ledger';
END;
$test$;

-- ═══════════════════════════════════════════════════════════════════
-- TEST 5: REPLAY OF REJECTED OPERATION — same stale operation replayed
-- ═══════════════════════════════════════════════════════════════════

DO $test$
DECLARE
  v_result jsonb;
BEGIN
  -- Replay the stale operation from TEST 4
  v_result := r1_save_order_idempotent(
    'amalay', 'r2d-test-order-1', 'r2d-op-2-stale',
    0, -- same expected_revision as original
    99, NULL, 'Test Mesero', 2, 'enviada',
    100.00, 0.00, 100.00, 0.00, 0.00,
    NULL, NULL, NULL, NULL,
    '[{"id":"item-1","nombre":"Cafe Test","cantidad":1,"precio":50,"precioExtra":0,"subtotal":50}]'::jsonb,
    NULL
  );

  RAISE NOTICE 'TEST 5 RESULT: %', v_result;
  ASSERT (v_result->>'ok')::boolean = false, 'TEST 5: should fail (replay of rejection)';
  ASSERT (v_result->>'conflict')::boolean = true, 'TEST 5: conflict=true';
  ASSERT (v_result->>'idempotent_replay')::boolean = true, 'TEST 5: should be idempotent_replay';
  ASSERT (v_result->>'first_execution')::boolean = false, 'TEST 5: not first_execution';
  RAISE NOTICE 'TEST 5 PASS: Replay of rejected operation returns original rejection, no re-execution';
END;
$test$;

-- ═══════════════════════════════════════════════════════════════════
-- TEST 6: LEGITIMATE SECOND OPERATION — different ID, correct revision
-- ═══════════════════════════════════════════════════════════════════

DO $test$
DECLARE
  v_result jsonb;
BEGIN
  -- New operation with correct expected_revision=1
  v_result := r1_save_order_idempotent(
    'amalay', 'r2d-test-order-1', 'r2d-op-3-legit',
    1, -- correct current revision
    99, NULL, 'Test Mesero', 2, 'enviada',
    150.00, 0.00, 150.00, 0.00, 0.00,
    NULL, NULL, NULL, NULL,
    '[{"id":"item-1","nombre":"Cafe Test","cantidad":1,"precio":50,"precioExtra":0,"subtotal":50},{"id":"item-3","nombre":"Espresso","cantidad":1,"precio":100,"precioExtra":0,"subtotal":100}]'::jsonb,
    NULL
  );

  RAISE NOTICE 'TEST 6 RESULT: %', v_result;
  ASSERT (v_result->>'ok')::boolean = true, 'TEST 6: should succeed';
  ASSERT (v_result->>'revision')::int = 2, 'TEST 6: revision should be 2';
  ASSERT (v_result->>'first_execution')::boolean = true, 'TEST 6: first_execution';
  RAISE NOTICE 'TEST 6 PASS: Legitimate second operation committed revision 2';
END;
$test$;

-- ═══════════════════════════════════════════════════════════════════
-- TEST 7: AMBIGUOUS COMMIT — replay of op-1 after order advanced to rev 2
-- The original op-1 committed rev 1. Order is now at rev 2.
-- Replay must recognize op-1, NOT return STALE_WRITE_REJECTED.
-- ═══════════════════════════════════════════════════════════════════

DO $test$
DECLARE
  v_result jsonb;
  v_order_rev bigint;
BEGIN
  SELECT order_revision INTO v_order_rev FROM pos_orders WHERE id = 'r2d-test-order-1';
  RAISE NOTICE 'TEST 7 PRE: order_revision=%', v_order_rev;

  -- Replay op-1 (which committed rev 1, now order is at rev 2)
  v_result := r1_save_order_idempotent(
    'amalay', 'r2d-test-order-1', 'r2d-op-1',
    0, -- original expected_revision
    99, NULL, 'Test Mesero', 2, 'enviada',
    100.00, 0.00, 100.00, 0.00, 0.00,
    NULL, NULL, NULL, NULL,
    '[{"id":"item-1","nombre":"Cafe Test","cantidad":1,"precio":50,"precioExtra":0,"subtotal":50},{"id":"item-2","nombre":"Jugo Test","cantidad":1,"precio":50,"precioExtra":0,"subtotal":50}]'::jsonb,
    NULL
  );

  SELECT order_revision INTO v_order_rev FROM pos_orders WHERE id = 'r2d-test-order-1';

  RAISE NOTICE 'TEST 7 RESULT: %', v_result;
  ASSERT (v_result->>'ok')::boolean = true, 'TEST 7: should return ok=true (idempotent recognition)';
  ASSERT (v_result->>'revision')::int = 1, 'TEST 7: should return ORIGINAL committed revision 1';
  ASSERT (v_result->>'idempotent_replay')::boolean = true, 'TEST 7: idempotent_replay';
  ASSERT (v_result->>'conflict')::boolean = false, 'TEST 7: NOT a conflict';
  ASSERT v_order_rev = 2, 'TEST 7: order_revision must remain at 2';
  RAISE NOTICE 'TEST 7 PASS: Replay of op-1 recognized even after order advanced to rev %. Returns original rev 1. No false STALE_WRITE_REJECTED.', v_order_rev;
END;
$test$;

-- ═══════════════════════════════════════════════════════════════════
-- TEST 8: LEGACY — no save_operation_id
-- ═══════════════════════════════════════════════════════════════════

DO $test$
DECLARE
  v_result jsonb;
BEGIN
  -- Legacy call without operation ID (NULL)
  v_result := r1_save_order_idempotent(
    'amalay', 'r2d-test-order-1', NULL,
    2, -- current revision
    99, NULL, 'Test Mesero', 2, 'enviada',
    150.00, 0.00, 150.00, 0.00, 0.00,
    NULL, NULL, NULL, NULL,
    '[{"id":"item-1","nombre":"Cafe Test","cantidad":1,"precio":50,"precioExtra":0,"subtotal":50}]'::jsonb,
    NULL
  );

  RAISE NOTICE 'TEST 8 RESULT: %', v_result;
  ASSERT (v_result->>'ok')::boolean = true, 'TEST 8: should succeed (legacy bypass)';
  ASSERT (v_result->>'revision')::int = 3, 'TEST 8: revision should be 3';
  ASSERT (v_result->>'first_execution')::boolean = true, 'TEST 8: first_execution (legacy = always first)';
  ASSERT (v_result->>'idempotent_replay')::boolean = false, 'TEST 8: not idempotent_replay';
  RAISE NOTICE 'TEST 8 PASS: Legacy call (no operation ID) bypasses idempotency, uses direct r1_save_order';
END;
$test$;

-- ═══════════════════════════════════════════════════════════════════
-- CLEANUP
-- ═══════════════════════════════════════════════════════════════════

DELETE FROM pos_save_operations WHERE order_id LIKE 'r2d-test-%';
DELETE FROM pos_reconciliation_results WHERE order_id LIKE 'r2d-test-%';
DELETE FROM pos_orders WHERE id LIKE 'r2d-test-%';

SELECT 'ALL R2D TESTS PASSED' AS result;
