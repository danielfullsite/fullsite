-- PENDIENTE: aplicar sólo después de respaldo y validación en staging.
-- Evita que dos pantallas de cocina reemplacen el mapa completo con copias viejas.

CREATE OR REPLACE FUNCTION public.pos_apply_kds_item_delta(
  p_client_id text,
  p_location_id text,
  p_order_id text,
  p_item_index integer,
  p_done boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status jsonb;
BEGIN
  IF p_client_id IS NULL OR p_client_id = '' OR p_order_id IS NULL OR p_order_id = '' OR
     p_item_index IS NULL OR p_item_index < 0 OR p_item_index > 10000 OR p_done IS NULL THEN
    RAISE EXCEPTION 'KDS_INVALID_DELTA' USING ERRCODE = '22023';
  END IF;

  UPDATE public.pos_orders
  SET kds_item_status = jsonb_set(
        CASE
          WHEN kds_item_status IS NULL THEN '{}'::jsonb
          WHEN jsonb_typeof(kds_item_status) = 'object' THEN kds_item_status
          WHEN jsonb_typeof(kds_item_status) = 'string' THEN (kds_item_status #>> '{}')::jsonb
          ELSE '{}'::jsonb
        END,
        ARRAY[p_item_index::text],
        to_jsonb(p_done),
        true
      ),
      updated_at = now()
  WHERE id = p_order_id
    AND client_id = p_client_id
    AND (location_id = p_location_id OR (location_id IS NULL AND p_location_id IS NULL))
    AND status IN ('enviada', 'preparando', 'lista')
  RETURNING kds_item_status INTO v_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'KDS_ORDER_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_apply_kds_item_delta(text, text, text, integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_apply_kds_item_delta(text, text, text, integer, boolean)
  TO service_role;
