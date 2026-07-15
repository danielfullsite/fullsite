-- R2D: Save Operation Idempotency
-- Run in Supabase SQL Editor
-- ZERO production business state change. Schema + function only.

-- ═══════════════════════════════════════════════════════════════════
-- 1. TABLE: pos_save_operations
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pos_save_operations (
  client_id text NOT NULL,
  order_id text NOT NULL,
  save_operation_id text NOT NULL,
  payload_hash text NOT NULL,
  state text NOT NULL DEFAULT 'EXECUTING',
  committed_revision bigint,
  rejection_detail text,
  rejection_expected bigint,
  rejection_current bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (client_id, order_id, save_operation_id),
  CONSTRAINT chk_save_op_state CHECK (state IN ('EXECUTING', 'COMMITTED', 'REJECTED')),
  CONSTRAINT chk_save_op_committed CHECK (
    (state = 'COMMITTED' AND committed_revision IS NOT NULL AND rejection_detail IS NULL) OR
    (state = 'REJECTED'  AND committed_revision IS NULL     AND rejection_detail IS NOT NULL) OR
    (state = 'EXECUTING' AND committed_revision IS NULL     AND rejection_detail IS NULL)
  )
);

-- RLS: enabled, no browser access. Service role only via SECURITY DEFINER functions.
ALTER TABLE pos_save_operations ENABLE ROW LEVEL SECURITY;
-- No policies created = no anon/authenticated access. service_role bypasses RLS.

-- ═══════════════════════════════════════════════════════════════════
-- 2. FUNCTION: r1_save_order_idempotent
-- ═══════════════════════════════════════════════════════════════════
-- Wraps r1_save_order with exactly-once operation identity.
-- Uses INSERT-first claim with ON CONFLICT DO NOTHING for
-- database-global serialization of concurrent identical operations.
--
-- PostgreSQL behavior under READ COMMITTED:
-- Two concurrent INSERTs to the same PK: second BLOCKS on unique
-- index lock until first commits (conflict → 0 rows) or
-- rolls back (second INSERT succeeds).
--
-- EXECUTING state is transient within the executor's transaction.
-- Never externally visible: INSERT + save + UPDATE to COMMITTED/REJECTED
-- all commit atomically.

CREATE OR REPLACE FUNCTION r1_save_order_idempotent(
  p_client_id text,
  p_order_id text,
  p_save_operation_id text,
  p_expected_revision bigint,
  p_mesa integer DEFAULT NULL,
  p_customer_name text DEFAULT NULL,
  p_mesero text DEFAULT NULL,
  p_personas integer DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_subtotal numeric DEFAULT NULL,
  p_iva numeric DEFAULT NULL,
  p_total numeric DEFAULT NULL,
  p_descuento numeric DEFAULT NULL,
  p_propina numeric DEFAULT NULL,
  p_metodo_pago text DEFAULT NULL,
  p_pagos jsonb DEFAULT NULL,
  p_turno_id text DEFAULT NULL,
  p_notas text DEFAULT NULL,
  p_items jsonb DEFAULT NULL,
  p_closed_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_row_count integer;
  v_hash text;
  v_canonical jsonb;
  v_items_sorted jsonb;
  v_existing record;
  v_save_result jsonb;
BEGIN
  -- ── Legacy bypass: no operation ID → direct r1_save_order (non-idempotent) ──
  IF p_save_operation_id IS NULL OR p_save_operation_id = '' THEN
    v_save_result := r1_save_order(
      p_client_id, p_order_id, p_expected_revision,
      p_mesa, p_customer_name, p_mesero, p_personas,
      p_status, p_subtotal, p_iva, p_total,
      p_descuento, p_propina, p_metodo_pago, p_pagos,
      p_turno_id, p_notas, p_items, p_closed_at
    );
    RETURN v_save_result || jsonb_build_object(
      'first_execution', true, 'idempotent_replay', false);
  END IF;

  -- ── Step 1: Compute canonical payload hash ──
  -- Items sorted by item.id. Modifier arrays sorted alphabetically.
  -- save_operation_id, client_id, order_id excluded (part of operation identity key).
  -- JSONB build_object produces deterministic key ordering.
  -- No Unicode NFC normalization claimed — exact text values as supplied.
  v_items_sorted := (
    SELECT COALESCE(jsonb_agg(
      CASE
        WHEN item ? 'modificadores' AND jsonb_typeof(item->'modificadores') = 'array' THEN
          (item - 'modificadores') || jsonb_build_object('modificadores',
            (SELECT COALESCE(jsonb_agg(m ORDER BY m), '[]'::jsonb)
             FROM jsonb_array_elements_text(item->'modificadores') AS m))
        ELSE item
      END
      ORDER BY item->>'id'
    ), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS item
  );

  v_canonical := jsonb_build_object(
    'closed_at', p_closed_at,
    'customer_name', p_customer_name,
    'descuento', COALESCE(p_descuento, 0),
    'expected_revision', p_expected_revision,
    'iva', COALESCE(p_iva, 0),
    'items', v_items_sorted,
    'mesa', p_mesa,
    'mesero', p_mesero,
    'metodo_pago', p_metodo_pago,
    'notas', p_notas,
    'pagos', COALESCE(p_pagos, '[]'::jsonb),
    'personas', p_personas,
    'propina', COALESCE(p_propina, 0),
    'status', p_status,
    'subtotal', COALESCE(p_subtotal, 0),
    'total', COALESCE(p_total, 0),
    'turno_id', p_turno_id
  );

  v_hash := encode(digest(v_canonical::text, 'sha256'), 'hex');

  -- ── Step 2: Claim operation (INSERT-first serialization) ──
  INSERT INTO pos_save_operations (
    client_id, order_id, save_operation_id, payload_hash, state, created_at
  ) VALUES (
    p_client_id, p_order_id, p_save_operation_id, v_hash, 'EXECUTING', now()
  ) ON CONFLICT (client_id, order_id, save_operation_id) DO NOTHING;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  IF v_row_count = 0 THEN
    -- ── Claim failed: another executor already owns this operation ──
    -- Under READ COMMITTED + unique index lock, the other transaction
    -- has committed for ON CONFLICT to have triggered. Row is visible.
    SELECT * INTO v_existing FROM pos_save_operations
    WHERE client_id = p_client_id AND order_id = p_order_id
      AND save_operation_id = p_save_operation_id;

    IF v_existing IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'INTERNAL_INVARIANT_VIOLATION',
        'detail', 'INSERT conflict but row not found after commit');
    END IF;

    -- Verify payload identity
    IF v_existing.payload_hash != v_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'PAYLOAD_IDENTITY_CORRUPTION',
        'detail', 'save_operation_id reused with different canonical payload');
    END IF;

    -- Return based on committed state
    IF v_existing.state = 'COMMITTED' THEN
      RETURN jsonb_build_object(
        'ok', true,
        'revision', v_existing.committed_revision,
        'conflict', false,
        'first_execution', false,
        'idempotent_replay', true
      );
    ELSIF v_existing.state = 'REJECTED' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'conflict', true,
        'error', v_existing.rejection_detail,
        'expected_revision', v_existing.rejection_expected,
        'current_revision', v_existing.rejection_current,
        'first_execution', false,
        'idempotent_replay', true
      );
    ELSE
      -- EXECUTING visible externally contradicts approved transaction semantics
      RETURN jsonb_build_object('ok', false, 'error', 'INTERNAL_INVARIANT_VIOLATION',
        'detail', 'operation in EXECUTING state visible externally');
    END IF;
  END IF;

  -- ── Step 3: First executor — execute canonical save ──
  v_save_result := r1_save_order(
    p_client_id, p_order_id, p_expected_revision,
    p_mesa, p_customer_name, p_mesero, p_personas,
    p_status, p_subtotal, p_iva, p_total,
    p_descuento, p_propina, p_metodo_pago, p_pagos,
    p_turno_id, p_notas, p_items, p_closed_at
  );

  IF (v_save_result->>'ok')::boolean THEN
    -- Save committed: record in ledger (same transaction)
    UPDATE pos_save_operations SET
      state = 'COMMITTED',
      committed_revision = (v_save_result->>'revision')::bigint,
      completed_at = now()
    WHERE client_id = p_client_id AND order_id = p_order_id
      AND save_operation_id = p_save_operation_id;

    RETURN v_save_result || jsonb_build_object(
      'first_execution', true, 'idempotent_replay', false);
  ELSE
    -- Save rejected: record rejection in ledger (same transaction)
    UPDATE pos_save_operations SET
      state = 'REJECTED',
      rejection_detail = COALESCE(v_save_result->>'error', 'UNKNOWN_REJECTION'),
      rejection_expected = (v_save_result->>'expected_revision')::bigint,
      rejection_current = (v_save_result->>'current_revision')::bigint,
      completed_at = now()
    WHERE client_id = p_client_id AND order_id = p_order_id
      AND save_operation_id = p_save_operation_id;

    RETURN v_save_result || jsonb_build_object(
      'first_execution', true, 'idempotent_replay', false);
  END IF;
END;
$fn$;

-- ── ACL ──
REVOKE ALL ON FUNCTION r1_save_order_idempotent FROM PUBLIC;
REVOKE ALL ON FUNCTION r1_save_order_idempotent FROM anon;
REVOKE ALL ON FUNCTION r1_save_order_idempotent FROM authenticated;
GRANT EXECUTE ON FUNCTION r1_save_order_idempotent TO service_role;

-- ═══════════════════════════════════════════════════════════════════
-- 3. VERIFICATION (read-only)
-- ═══════════════════════════════════════════════════════════════════

-- Verify function exists and is SECURITY DEFINER
SELECT proname, prosecdef, proowner::regrole
FROM pg_proc WHERE proname = 'r1_save_order_idempotent';

-- Verify table exists with correct columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'pos_save_operations'
ORDER BY ordinal_position;

-- Verify RLS is enabled
SELECT relname, relrowsecurity
FROM pg_class WHERE relname = 'pos_save_operations';

-- Verify pgcrypto is available (required for digest/sha256)
SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') AS pgcrypto_available;
