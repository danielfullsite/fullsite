-- r1_add_items: atomically append net-new items to an existing open order.
-- Idempotent: items already present by their id are silently skipped.
-- Safe without OCC because item IDs are client-generated UUIDs (globally unique).
-- Two terminals calling concurrently serialize on the row lock; each sees the
-- pre-update snapshot of o.items when evaluating the NOT EXISTS filter.
CREATE OR REPLACE FUNCTION r1_add_items(
  p_client_id text,
  p_order_id  text,
  p_items     jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_new_revision bigint;
BEGIN
  -- Reject non-array input and empty arrays early to avoid a spurious revision bump.
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ITEMS_MUST_BE_NONEMPTY_ARRAY');
  END IF;

  UPDATE pos_orders AS o
  SET
    items = COALESCE(o.items, '[]'::jsonb) || (
      -- Append only items whose id is not already in the order.
      -- DISTINCT ON deduplicates within p_items itself (retry safety).
      -- Null-id items are excluded to prevent them from bypassing idempotency.
      -- o.items reference reads the pre-update locked-row value (PostgreSQL guarantee).
      SELECT COALESCE(jsonb_agg(new_item), '[]'::jsonb)
      FROM (
        SELECT DISTINCT ON (new_item->>'id') new_item
        FROM   jsonb_array_elements(p_items) new_item
        WHERE  new_item->>'id' IS NOT NULL
        ORDER  BY new_item->>'id'
      ) deduped
      WHERE NOT EXISTS (
        SELECT 1
        FROM   jsonb_array_elements(COALESCE(o.items, '[]'::jsonb)) existing_item
        WHERE  existing_item->>'id' = deduped.new_item->>'id'
      )
    ),
    order_revision = o.order_revision + 1,
    updated_at     = now(),
    status         = CASE WHEN o.status = 'abierta' THEN 'enviada' ELSE o.status END
  WHERE o.id        = p_order_id
    AND o.client_id = p_client_id
    AND o.status NOT IN ('cerrada', 'cancelada', 'void')
  RETURNING order_revision INTO v_new_revision;

  IF v_new_revision IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORDER_CLOSED_OR_NOT_FOUND');
  END IF;

  -- 'requested' is the count received; actual net-new count may be lower on retries.
  RETURN jsonb_build_object(
    'ok',        true,
    'revision',  v_new_revision,
    'requested', jsonb_array_length(p_items)
  );
END;
$fn$;

-- ACL: only service_role may call this function (API routes use SUPABASE_SERVICE_KEY)
REVOKE ALL ON FUNCTION r1_add_items(text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION r1_add_items(text, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION r1_add_items(text, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION r1_add_items(text, text, jsonb) TO service_role;
