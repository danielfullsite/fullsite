-- Pending coordinated deployment. Reconcile from the committed order only.
-- Unprepared cancellation may return stock; prepared cancellation retains its
-- consumption. Pinned recipe/target and provenance stay in r1_reconcile_item.
BEGIN;
ALTER TABLE public.pos_reconciliation_results ADD COLUMN IF NOT EXISTS cancellation_disposition text
  CHECK (cancellation_disposition IN ('retain_consumption','return_stock'));
CREATE OR REPLACE FUNCTION "public"."r1_reconcile_order"("p_client_id" "text", "p_order_id" "text") RETURNS TABLE("r_item_id" "text", "r_result" "text", "r_applied" numeric, "r_delta" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_order RECORD;
  v_authority text;
  v_item jsonb;
  v_item_id text;
  v_menu_item_id text;
  v_desired numeric;
  v_current_ids text[] := '{}';
  v_orphan RECORD;
  v_is_cancelled boolean;
  v_all_complete boolean := true;
  v_order_rev bigint;
  v_items jsonb;
BEGIN
  -- ═══ STEP 1: Lock order row FOR UPDATE ═══
  SELECT * INTO v_order FROM pos_orders
  WHERE id = p_order_id AND client_id = p_client_id
  FOR UPDATE;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Order % not found for client %', p_order_id, p_client_id;
  END IF;

  v_order_rev := v_order.order_revision;

  -- ═══ STEP 2: Acquire authority FOR SHARE ═══
  SELECT sale_authority INTO v_authority
  FROM pos_mutation_authority
  WHERE client_id = p_client_id
  FOR SHARE;

  IF v_authority IS NULL THEN
    v_authority := 'legacy';  -- default if no authority row
  END IF;

  -- ═══ STEP 3: Determine if order is cancelled/voided ═══
  v_is_cancelled := v_order.status IN ('cancelada', 'anulada');

  -- Normalize the historical JSONB string representation, but never silently
  -- treat malformed data as an empty order (which would return all stock).
  v_items := COALESCE(v_order.items, '[]'::jsonb);
  IF jsonb_typeof(v_items) = 'string' THEN v_items := (v_items #>> '{}')::jsonb; END IF;
  IF jsonb_typeof(v_items) != 'array' THEN RAISE EXCEPTION 'INVALID_ORDER_ITEMS'; END IF;

  -- ═══ STEP 4: Process current items ═══
  IF v_order.items IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
      v_item_id := v_item->>'id';
      v_menu_item_id := v_item->>'menuItemId';
      -- Canonical course separators have no merchandise or consumption.
      IF v_menu_item_id='__tiempo__' AND COALESCE((v_item->>'subtotal')::numeric,0)=0 THEN CONTINUE; END IF;
      IF (v_is_cancelled OR COALESCE((v_item->>'cancelled')::boolean, false)) AND
        COALESCE(v_item->>'inventory_disposition','pending') NOT IN ('return_stock','retain_consumption') THEN
        RAISE EXCEPTION 'CANCELLATION_DISPOSITION_REQUIRED';
      END IF;
      v_desired := CASE WHEN (v_is_cancelled OR COALESCE((v_item->>'cancelled')::boolean, false)) AND v_item->>'inventory_disposition'='return_stock'
        THEN 0 ELSE (v_item->>'cantidad')::numeric END;

      IF v_item_id IS NULL OR v_menu_item_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ORDER_ITEM_IDENTITY';
      END IF;

      IF v_item_id = ANY(v_current_ids) THEN RAISE EXCEPTION 'DUPLICATE_ORDER_ITEM_IDENTITY'; END IF;
      IF v_desired IS NULL OR v_desired < 0 OR v_desired::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'INVALID_DESIRED_CONSUMPTION'; END IF;
      v_current_ids := array_append(v_current_ids, v_item_id);

      RETURN QUERY SELECT * FROM r1_reconcile_item(
        p_client_id, p_order_id, v_item_id, v_menu_item_id, v_desired, v_authority
      );
      IF v_is_cancelled OR COALESCE((v_item->>'cancelled')::boolean, false) THEN
        UPDATE pos_reconciliation_results SET cancellation_disposition=v_item->>'inventory_disposition'
        WHERE client_id=p_client_id AND order_id=p_order_id AND order_item_id=v_item_id;
      END IF;
    END LOOP;
  END IF;

  -- ═══ STEP 5: Discover removed/cancelled items → desired=0 ═══
  FOR v_orphan IN
    SELECT rr.order_item_id, rr.menu_item_id, rr.cancellation_disposition
    FROM pos_reconciliation_results rr
    WHERE rr.client_id = p_client_id
      AND rr.order_id = p_order_id
      AND rr.order_item_id != ALL(v_current_ids)
      AND rr.cancellation_disposition IS DISTINCT FROM 'retain_consumption'
      AND (rr.applied_consumption > 0 OR rr.pinned_mode IS NOT NULL)
  LOOP
    -- An empty cancelled order is not evidence that consumed goods came back.
    -- Fail the entire transaction rather than infer a physical disposition.
    IF v_is_cancelled AND v_orphan.cancellation_disposition IS DISTINCT FROM 'return_stock' THEN
      RAISE EXCEPTION 'CANCELLATION_DISPOSITION_REQUIRED';
    END IF;
    RETURN QUERY SELECT * FROM r1_reconcile_item(
      p_client_id, p_order_id, v_orphan.order_item_id, v_orphan.menu_item_id, 0::numeric, v_authority
    );
  END LOOP;

  -- ═══ STEP 6: Update revision lineage ═══
  -- Check if all intents for this order are terminally resolved
  SELECT bool_and(result IN ('RECONCILED', 'NO_MUTATION_APPROVED'))
  INTO v_all_complete
  FROM pos_reconciliation_results
  WHERE client_id = p_client_id AND order_id = p_order_id;

  IF v_all_complete IS NULL THEN
    v_all_complete := true;  -- no intents = complete
  END IF;

  UPDATE pos_orders SET
    last_inventory_processed_revision = v_order_rev,
    last_inventory_complete_revision = CASE
      WHEN v_all_complete THEN v_order_rev
      ELSE last_inventory_complete_revision  -- preserve prior
    END
  WHERE id = p_order_id AND client_id = p_client_id;

END;
$$;

REVOKE ALL ON FUNCTION public.r1_reconcile_order(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.r1_reconcile_order(text,text) TO service_role;
COMMIT;
