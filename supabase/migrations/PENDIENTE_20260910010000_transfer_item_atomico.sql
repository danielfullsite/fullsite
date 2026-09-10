-- Candidate only. Apply with the coordinated rollout, never directly to production.
-- The receipt and BOTH orders commit together. A failed target cannot require a
-- destructive best-effort rollback; a lost HTTP response is recovered by op ID.
CREATE TABLE IF NOT EXISTS public.pos_transfer_operations (
  client_id text NOT NULL, operation_id text NOT NULL, intent jsonb NOT NULL,
  result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, operation_id)
);
ALTER TABLE public.pos_transfer_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_transfer_operations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pos_transfer_operations TO service_role;

CREATE OR REPLACE FUNCTION public.r1_transfer_item_atomic(
  p_client_id text, p_operation_id text, p_source_order_id text,
  p_item_id text, p_target_mesa integer, p_actor text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  src public.pos_orders%ROWTYPE; dst public.pos_orders%ROWTYPE;
  intent jsonb := jsonb_build_object('source',p_source_order_id,'item',p_item_id,'mesa',p_target_mesa);
  receipt public.pos_transfer_operations%ROWTYPE;
  source_items jsonb; target_items jsonb; item jsonb; output jsonb;
  gross numeric; source_gross numeric; target_gross numeric; moved_discount numeric;
  source_discount numeric; target_discount numeric; moved_tax numeric; source_tax numeric; target_tax numeric; destination_id text;
BEGIN
  IF nullif(p_client_id,'') IS NULL OR nullif(p_operation_id,'') IS NULL OR
     nullif(p_source_order_id,'') IS NULL OR nullif(p_item_id,'') IS NULL OR
     p_target_mesa IS NULL OR p_target_mesa < 1 THEN RAISE EXCEPTION 'INVALID_TRANSFER'; END IF;
  -- Serializes transfers for this tenant, including creation on an empty table.
  -- Ordinary writers still use row locks/revision checks; no process-local mutex.
  PERFORM pg_advisory_xact_lock(hashtextextended('transfer:' || p_client_id,0));
  SELECT * INTO receipt FROM public.pos_transfer_operations
    WHERE client_id=p_client_id AND operation_id=p_operation_id;
  IF FOUND THEN
    IF receipt.intent <> intent THEN RAISE EXCEPTION 'OPERATION_ID_REUSED'; END IF;
    RETURN receipt.result;
  END IF;
  -- Deterministic row lock order also avoids opposite-direction transfer deadlock.
  PERFORM id FROM public.pos_orders WHERE client_id=p_client_id
    AND (id=p_source_order_id OR mesa=p_target_mesa) ORDER BY id FOR UPDATE;
  SELECT * INTO src FROM public.pos_orders WHERE id=p_source_order_id AND client_id=p_client_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SOURCE_NOT_FOUND'; END IF;
  IF src.mesa=p_target_mesa THEN RAISE EXCEPTION 'SAME_TABLE'; END IF;
  IF coalesce(src.status,'') NOT IN ('abierta','enviada','preparando','lista') OR src.turno_id IS NULL
    OR coalesce(src.pagos,'[]'::jsonb) NOT IN ('[]'::jsonb,'null'::jsonb) THEN
    RAISE EXCEPTION 'SOURCE_NOT_OPEN';
  END IF;
  IF (SELECT count(*) FROM public.pos_orders WHERE client_id=p_client_id AND mesa=p_target_mesa
    AND location_id IS NOT DISTINCT FROM src.location_id
    AND status IN ('abierta','enviada','preparando','lista')) > 1 THEN RAISE EXCEPTION 'TARGET_AMBIGUOUS'; END IF;
  SELECT * INTO dst FROM public.pos_orders WHERE client_id=p_client_id AND mesa=p_target_mesa
    AND location_id IS NOT DISTINCT FROM src.location_id
    AND status IN ('abierta','enviada','preparando','lista');
  IF FOUND AND (dst.turno_id IS DISTINCT FROM src.turno_id OR
    coalesce(dst.pagos,'[]'::jsonb) NOT IN ('[]'::jsonb,'null'::jsonb)) THEN RAISE EXCEPTION 'TARGET_NOT_OPEN'; END IF;
  source_items := CASE WHEN jsonb_typeof(src.items)='string' THEN (src.items #>> '{}')::jsonb ELSE src.items END;
  target_items := CASE WHEN jsonb_typeof(dst.items)='string' THEN (dst.items #>> '{}')::jsonb ELSE coalesce(dst.items,'[]') END;
  IF jsonb_typeof(source_items)<>'array' OR jsonb_typeof(target_items)<>'array' THEN RAISE EXCEPTION 'INVALID_ITEMS'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(source_items) x WHERE x->>'id'=p_item_id)<>1 THEN RAISE EXCEPTION 'ITEM_NOT_IN_SOURCE'; END IF;
  SELECT x INTO item FROM jsonb_array_elements(source_items) x WHERE x->>'id'=p_item_id;
  IF coalesce((item->>'cancelled')::boolean,false) OR EXISTS
    (SELECT 1 FROM jsonb_array_elements(target_items) x WHERE x->>'id'=p_item_id) THEN RAISE EXCEPTION 'INVALID_ITEM'; END IF;
  SELECT coalesce(sum((x->>'subtotal')::numeric),0) INTO source_gross FROM jsonb_array_elements(source_items) x WHERE NOT coalesce((x->>'cancelled')::boolean,false);
  SELECT coalesce(sum((x->>'subtotal')::numeric),0) INTO target_gross FROM jsonb_array_elements(target_items) x WHERE NOT coalesce((x->>'cancelled')::boolean,false);
  gross := (item->>'subtotal')::numeric;
  IF gross IS NULL OR gross<0 OR source_gross<gross OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(source_items || target_items) x
    WHERE NOT coalesce((x->>'cancelled')::boolean,false) AND
      ((x->>'subtotal') IS NULL OR (x->>'subtotal')::numeric<0)
  ) THEN RAISE EXCEPTION 'INVALID_AMOUNTS'; END IF;
  source_discount := coalesce(src.descuento,0); target_discount := coalesce(dst.descuento,0);
  IF source_discount<0 OR source_discount>source_gross OR target_discount<0 OR target_discount>target_gross THEN RAISE EXCEPTION 'INVALID_DISCOUNT'; END IF;
  moved_discount := CASE WHEN source_gross=0 THEN 0 ELSE round(source_discount*gross/source_gross,2) END;
  -- Transfer recorded tax, not today's catalog rate. Preserve the exact sum of
  -- cents, including discounts and rounding when an account is split in two.
  source_tax := coalesce(src.iva,0); target_tax := coalesce(dst.iva,0);
  IF source_tax<0 OR target_tax<0 OR round(source_gross-source_discount+source_tax,2)<>src.total
    OR (dst.id IS NOT NULL AND round(target_gross-target_discount+target_tax,2)<>dst.total)
    THEN RAISE EXCEPTION 'INVALID_AMOUNTS'; END IF;
  moved_tax := CASE WHEN source_gross=source_discount THEN 0 ELSE
    round(source_tax*(gross-moved_discount)/(source_gross-source_discount),2) END;
  source_tax := source_tax-moved_tax; target_tax := target_tax+moved_tax;
  source_discount := source_discount-moved_discount; target_discount := target_discount+moved_discount;
  SELECT coalesce(jsonb_agg(x),'[]') INTO source_items FROM jsonb_array_elements(source_items) x WHERE x->>'id'<>p_item_id;
  target_items := target_items || jsonb_build_array(item);
  source_gross := source_gross-gross; target_gross := target_gross+gross;
  destination_id := coalesce(dst.id,gen_random_uuid()::text);
  UPDATE public.pos_orders SET items=source_items, subtotal=source_gross, descuento=source_discount,
    iva=source_tax, total=round(source_gross-source_discount+source_tax,2),
    order_revision=order_revision+1, updated_at=clock_timestamp()
    WHERE id=src.id AND client_id=p_client_id;
  IF dst.id IS NULL THEN
    INSERT INTO public.pos_orders(id,client_id,location_id,turno_id,mesa,mesero,status,items,subtotal,descuento,iva,total,order_revision)
    VALUES(destination_id,p_client_id,src.location_id,src.turno_id,p_target_mesa,src.mesero,'enviada',target_items,
      target_gross,target_discount,target_tax,round(target_gross-target_discount+target_tax,2),1);
  ELSE
    UPDATE public.pos_orders SET items=target_items, subtotal=target_gross, descuento=target_discount,
      iva=target_tax,total=round(target_gross-target_discount+target_tax,2),
      order_revision=order_revision+1, updated_at=clock_timestamp() WHERE id=dst.id AND client_id=p_client_id;
  END IF;
  output := jsonb_build_object('ok',true,'item_name',coalesce(item->>'nombre',item->>'name'),
    'target_order_id',destination_id,'target_items',target_items,
    'source_order',(SELECT to_jsonb(o) FROM public.pos_orders o WHERE id=src.id),
    'target_order',(SELECT to_jsonb(o) FROM public.pos_orders o WHERE id=destination_id));
  INSERT INTO public.pos_transfer_operations(client_id,operation_id,intent,result)
    VALUES(p_client_id,p_operation_id,intent,output || jsonb_build_object('approved_by',p_actor));
  RETURN output || jsonb_build_object('approved_by',p_actor);
END;
$$;
REVOKE ALL ON FUNCTION public.r1_transfer_item_atomic(text,text,text,text,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.r1_transfer_item_atomic(text,text,text,text,integer,text) TO service_role;
