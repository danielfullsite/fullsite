-- r1_add_items: atomically append items to an existing open order.
-- Safe without OCC because item IDs are client-generated UUIDs (globally unique).
-- Used by the POS to resolve write conflicts: instead of retrying a full save,
-- the client appends only the net-new items it hasn't sent yet.
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
  UPDATE pos_orders
  SET
    items          = COALESCE(items, '[]'::jsonb) || p_items,
    order_revision = order_revision + 1,
    updated_at     = now(),
    status         = CASE WHEN status = 'abierta' THEN 'enviada' ELSE status END
  WHERE id        = p_order_id
    AND client_id = p_client_id
    AND status NOT IN ('cerrada', 'cancelada', 'void')
  RETURNING order_revision INTO v_new_revision;

  IF v_new_revision IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORDER_CLOSED_OR_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object(
    'ok',      true,
    'revision', v_new_revision,
    'added',   jsonb_array_length(p_items)
  );
END;
$fn$;
