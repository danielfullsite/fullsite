-- PENDIENTE: despliegue coordinado con PENDIENTE_20260910010000 y PENDIENTE_20260910060000.
--
-- Dos P0 del barrido 2026-09-10 (inventario LENTE-1 y LENTE-2), la misma raíz:
-- el consumo físico ya aplicado a una orden se perdía o se duplicaba cuando los
-- renglones cambiaban de orden o desaparecían del `items`.
--
-- (1) FUSIONAR MESAS DESCONTABA DOS VECES. r1_merge_orders copiaba los
--     renglones del origen al destino (mismos ids) y ponía el origen en
--     'cancelada' sin disposición. Al reconciliar el destino, la clave
--     (client, destino, item) era nueva → r1_reconcile_item descontaba OTRA vez;
--     al reconciliar el origen, cancelada sin disposición → RAISE, y su consumo
--     quedaba aplicado para siempre. Cada fusión duplicaba la harina de lo ya
--     enviado. Arreglo: la misma preparación física, ahora cobrada en otra
--     cuenta — se RE-PARENTA la fila de pos_reconciliation_results (mismo patrón
--     que r1_transfer_item_atomic) y el origen queda sin renglones.
--
-- (2) EL COBRO BORRABA LA EVIDENCIA DE LO CANCELADO. handlePayment manda
--     `items = payingItems`, que EXCLUYE los cancelados; r1_save_order hacía
--     `items = coalesce(p_items, items)` y el renglón cancelado —con su
--     inventory_disposition— desaparecía. El reconcile lo veía como huérfano de
--     una orden cerrada → desired = 0 → el platillo que la cocina YA preparó
--     regresaba al inventario. Arreglo: r1_save_order conserva los renglones
--     cancelados que el cliente no manda. Los consumidores ya filtran
--     `cancelled` (save-order recomputa sin ellos; cancel-item ya los persiste
--     así desde antes de este cambio).
--
-- La tercera pata —un huérfano con consumo aplicado y sin disposición falla
-- cerrado sin importar el estado de la orden— vive en PENDIENTE_20260910060000
-- (STEP 5), donde está la función.

BEGIN;

-- ── (1) r1_merge_orders: re-parentar el consumo, vaciar el origen ────────────
CREATE OR REPLACE FUNCTION public.r1_merge_orders(
  p_client_id text, p_target_order_id text, p_target_expected_revision bigint,
  p_source_order_id text, p_source_expected_revision bigint, p_merged_items jsonb,
  p_total numeric, p_subtotal numeric, p_iva numeric, p_personas integer, p_notas text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_tgt RECORD;
  v_src RECORD;
  v_tgt_new_rev bigint;
  v_src_new_rev bigint;
  v_moved_ids text[];
  v_reparented integer := 0;
BEGIN
  IF p_target_order_id < p_source_order_id THEN
    SELECT * INTO v_tgt FROM pos_orders WHERE id = p_target_order_id AND client_id = p_client_id FOR UPDATE;
    SELECT * INTO v_src FROM pos_orders WHERE id = p_source_order_id AND client_id = p_client_id FOR UPDATE;
  ELSE
    SELECT * INTO v_src FROM pos_orders WHERE id = p_source_order_id AND client_id = p_client_id FOR UPDATE;
    SELECT * INTO v_tgt FROM pos_orders WHERE id = p_target_order_id AND client_id = p_client_id FOR UPDATE;
  END IF;

  IF v_tgt IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'TARGET_NOT_FOUND'); END IF;
  IF v_src IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'SOURCE_NOT_FOUND'); END IF;

  IF v_tgt.order_revision != p_target_expected_revision THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STALE_WRITE_REJECTED',
      'stale_order', 'target', 'expected', p_target_expected_revision, 'current', v_tgt.order_revision);
  END IF;
  IF v_src.order_revision != p_source_expected_revision THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STALE_WRITE_REJECTED',
      'stale_order', 'source', 'expected', p_source_expected_revision, 'current', v_src.order_revision);
  END IF;

  -- Ids de renglón que existen en el origen y viajan en la lista fusionada.
  SELECT coalesce(array_agg(s->>'id'), '{}')
  INTO v_moved_ids
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_src.items) = 'array' THEN v_src.items ELSE '[]'::jsonb END) s
  WHERE s->>'id' IS NOT NULL
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_merged_items) m WHERE m->>'id' = s->>'id');

  UPDATE pos_orders SET
    items = p_merged_items,
    total = p_total, subtotal = p_subtotal, iva = p_iva,
    personas = p_personas,
    notas = p_notas,
    order_revision = order_revision + 1
  WHERE id = p_target_order_id AND client_id = p_client_id
  RETURNING order_revision INTO v_tgt_new_rev;

  -- El origen se cancela SIN renglones: lo que se movió ya vive en el destino, y
  -- una cancelación sin renglones vivos no exige disposición.
  UPDATE pos_orders SET
    status = 'cancelada',
    items = '[]'::jsonb,
    notas = 'Merged to order ' || p_target_order_id,
    order_revision = order_revision + 1
  WHERE id = p_source_order_id AND client_id = p_client_id
  RETURNING order_revision INTO v_src_new_rev;

  -- La misma preparación física, ahora cobrada en otra cuenta: se mueve la
  -- intención de consumo conservando su PK y su receta fijada. Nunca se
  -- revierte ni se vuelve a descontar. (Patrón de r1_transfer_item_atomic.)
  IF cardinality(v_moved_ids) > 0 THEN
    UPDATE pos_reconciliation_results rr
      SET order_id = p_target_order_id, updated_at = clock_timestamp()
    WHERE rr.client_id = p_client_id
      AND rr.order_id = p_source_order_id
      AND rr.order_item_id = ANY(v_moved_ids)
      AND NOT EXISTS (
        SELECT 1 FROM pos_reconciliation_results t
        WHERE t.client_id = p_client_id AND t.order_id = p_target_order_id AND t.order_item_id = rr.order_item_id
      );
    GET DIAGNOSTICS v_reparented = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('ok', true,
    'target_revision', v_tgt_new_rev,
    'source_revision', v_src_new_rev,
    'reparented_intents', v_reparented);
END;
$$;

REVOKE ALL ON FUNCTION public.r1_merge_orders(text,text,bigint,text,bigint,jsonb,numeric,numeric,numeric,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.r1_merge_orders(text,text,bigint,text,bigint,jsonb,numeric,numeric,numeric,integer,text) TO service_role;

-- ── (2) r1_save_order: los renglones cancelados no se pierden al cobrar ──────
create or replace function public.r1_save_order(
  p_client_id        text,
  p_order_id         text,
  p_expected_revision bigint,
  p_mesa             integer     default null,
  p_customer_name    text        default null,
  p_mesero           text        default null,
  p_personas         integer     default null,
  p_status           text        default null,
  p_subtotal         numeric     default null,
  p_iva              numeric     default null,
  p_total            numeric     default null,
  p_descuento        numeric     default null,
  p_propina          numeric     default null,
  p_metodo_pago      text        default null,
  p_pagos            jsonb       default null,
  p_turno_id         text        default null,
  p_notas            text        default null,
  p_items            jsonb       default null,
  p_closed_at        timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_new_revision     bigint;
  v_current_revision bigint;
  v_exists           boolean;
begin
  if not private.can_write_client(p_client_id) then
    return jsonb_build_object('ok', false, 'revision', null, 'conflict', false,
      'error', 'FORBIDDEN_CLIENT');
  end if;

  select exists(select 1 from pos_orders where id = p_order_id and client_id = p_client_id)
  into v_exists;

  if not v_exists and p_expected_revision = 0 then
    begin
      insert into pos_orders (
        id, client_id, mesa, customer_name, mesero, personas, status,
        subtotal, iva, total, descuento, propina, metodo_pago, pagos,
        turno_id, notas, items, closed_at, order_revision
      ) values (
        p_order_id, p_client_id, p_mesa, p_customer_name, p_mesero, p_personas,
        coalesce(p_status, 'abierta'), coalesce(p_subtotal, 0), coalesce(p_iva, 0),
        coalesce(p_total, 0), coalesce(p_descuento, 0), coalesce(p_propina, 0),
        p_metodo_pago, p_pagos, p_turno_id, p_notas, p_items, p_closed_at, 1
      );
      return jsonb_build_object('ok', true, 'revision', 1, 'conflict', false,
        'first_execution', true, 'idempotent_replay', false);
    exception when unique_violation then
      select order_revision into v_current_revision
      from pos_orders where id = p_order_id and client_id = p_client_id;
      return jsonb_build_object('ok', false, 'revision', v_current_revision, 'conflict', true,
        'error', 'STALE_WRITE_REJECTED',
        'expected_revision', 0,
        'current_revision', v_current_revision);
    end;
  end if;

  if not v_exists then
    return jsonb_build_object('ok', false, 'revision', null, 'conflict', false,
      'error', 'ORDER_NOT_FOUND');
  end if;

  update pos_orders set
    mesa           = coalesce(p_mesa, mesa),
    customer_name  = coalesce(p_customer_name, customer_name),
    mesero         = coalesce(p_mesero, mesero),
    personas       = coalesce(p_personas, personas),
    status         = coalesce(p_status, status),
    subtotal       = coalesce(p_subtotal, subtotal),
    iva            = coalesce(p_iva, iva),
    total          = coalesce(p_total, total),
    descuento      = coalesce(p_descuento, descuento),
    propina        = coalesce(p_propina, propina),
    metodo_pago    = coalesce(p_metodo_pago, metodo_pago),
    pagos          = coalesce(p_pagos, pagos),
    turno_id       = coalesce(p_turno_id, turno_id),
    notas          = coalesce(p_notas, notas),
    -- Un renglón cancelado que el cliente no manda se CONSERVA: trae la
    -- disposición de inventario y es la evidencia de la cancelación. Sólo aplica
    -- cuando ambos lados son arreglos; cualquier otra forma se guarda tal cual.
    items          = case
      when p_items is null then items
      when jsonb_typeof(p_items) = 'array' and jsonb_typeof(items) = 'array' then
        p_items || coalesce((
          select jsonb_agg(i)
          from jsonb_array_elements(items) i
          where (i->>'cancelled')::boolean is true
            and i->>'id' is not null
            and not exists (select 1 from jsonb_array_elements(p_items) j where j->>'id' = i->>'id')
        ), '[]'::jsonb)
      else p_items
    end,
    closed_at      = coalesce(p_closed_at, closed_at),
    order_revision = order_revision + 1
  where id = p_order_id
    and client_id = p_client_id
    and order_revision = p_expected_revision
  returning order_revision into v_new_revision;

  if v_new_revision is not null then
    return jsonb_build_object('ok', true, 'revision', v_new_revision, 'conflict', false,
      'first_execution', true, 'idempotent_replay', false);
  end if;

  select order_revision into v_current_revision
  from pos_orders where id = p_order_id and client_id = p_client_id;

  return jsonb_build_object('ok', false, 'revision', v_current_revision, 'conflict', true,
    'error', 'STALE_WRITE_REJECTED',
    'expected_revision', p_expected_revision,
    'current_revision', v_current_revision);
end;
$function$;

COMMIT;
