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


-- ── (3) r1_reconcile_item: un insumo sin fila de inventario bloquea, no aborta ──
-- Copia integra de la funcion del baseline con UN cambio: el RAISE del conteo de
-- candados se vuelve resultado BLOCKED_TARGET_MISSING (ver comentario adentro).
CREATE OR REPLACE FUNCTION "public"."r1_reconcile_item"("p_client_id" "text", "p_order_id" "text", "p_item_id" "text", "p_menu_item_id" "text", "p_desired" numeric, "p_sale_authority" "text") RETURNS TABLE("r_item_id" "text", "r_result" "text", "r_applied" numeric, "r_delta" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_intent pos_reconciliation_results%ROWTYPE;
  v_mode text;
  v_recipe_version_id bigint;
  v_market_stock_id bigint;
  v_delta numeric;
  v_next_rev int;
  v_converted numeric;
  v_ing_delta numeric;
  v_plan_line RECORD;
  v_locked_count int;
  v_updated int;
BEGIN
  -- ═══ STEP 1: Idempotent intent creation + lock ═══
  INSERT INTO pos_reconciliation_results
    (client_id, order_id, order_item_id, menu_item_id, cantidad)
  VALUES (p_client_id, p_order_id, p_item_id, p_menu_item_id, p_desired)
  ON CONFLICT (client_id, order_id, order_item_id) DO NOTHING;

  SELECT * INTO v_intent FROM pos_reconciliation_results
  WHERE client_id = p_client_id AND order_id = p_order_id AND order_item_id = p_item_id
  FOR UPDATE;

  -- ═══ STEP 2: Identity corruption check ═══
  IF v_intent.menu_item_id != p_menu_item_id THEN
    RAISE EXCEPTION 'Identity corruption: intent menu_item_id=% but observed=%',
      v_intent.menu_item_id, p_menu_item_id;
  END IF;

  -- ═══ STEP 3: Resolve treatment ═══
  IF v_intent.pinned_mode IS NOT NULL THEN
    -- Use pinned (historical immutability)
    v_mode := v_intent.pinned_mode;
    v_recipe_version_id := v_intent.pinned_recipe_version_id;
    v_market_stock_id := v_intent.pinned_market_stock_id;
  ELSE
    -- First terminal decision: resolve from current policy
    SELECT inventory_mode, market_stock_id
    INTO v_mode, v_market_stock_id
    FROM pos_item_inventory_policy
    WHERE client_id = p_client_id AND menu_item_id = p_menu_item_id;

    IF v_mode IS NULL OR v_mode = 'unclassified' THEN
      UPDATE pos_reconciliation_results SET
        cantidad = p_desired, result = 'BLOCKED_UNCLASSIFIED', updated_at = now()
      WHERE id = v_intent.id;
      RETURN QUERY SELECT p_item_id, 'BLOCKED_UNCLASSIFIED'::text, v_intent.applied_consumption, 0::numeric;
      RETURN;
    END IF;

    IF v_mode = 'recipe' THEN
      SELECT id INTO v_recipe_version_id FROM pos_recipe_versions
      WHERE client_id = p_client_id AND menu_item_id = p_menu_item_id AND active = true;
      IF v_recipe_version_id IS NULL THEN
        UPDATE pos_reconciliation_results SET
          cantidad = p_desired, result = 'BLOCKED_RECIPE_MISSING', updated_at = now()
        WHERE id = v_intent.id;
        RETURN QUERY SELECT p_item_id, 'BLOCKED_RECIPE_MISSING'::text, v_intent.applied_consumption, 0::numeric;
        RETURN;
      END IF;
    END IF;

    IF v_mode = 'direct_stock' THEN
      IF v_market_stock_id IS NULL THEN
        UPDATE pos_reconciliation_results SET
          cantidad = p_desired, result = 'BLOCKED_TARGET_MISSING', updated_at = now()
        WHERE id = v_intent.id;
        RETURN QUERY SELECT p_item_id, 'BLOCKED_TARGET_MISSING'::text, v_intent.applied_consumption, 0::numeric;
        RETURN;
      END IF;
      -- Verify target exists
      IF NOT EXISTS (SELECT 1 FROM pos_market_stock WHERE client_id = p_client_id AND id = v_market_stock_id) THEN
        UPDATE pos_reconciliation_results SET
          cantidad = p_desired, result = 'BLOCKED_TARGET_MISSING', updated_at = now()
        WHERE id = v_intent.id;
        RETURN QUERY SELECT p_item_id, 'BLOCKED_TARGET_MISSING'::text, v_intent.applied_consumption, 0::numeric;
        RETURN;
      END IF;
    END IF;
  END IF;

  -- ═══ STEP 4: NON_INVENTORY — before delta computation ═══
  IF v_mode = 'non_inventory' THEN
    UPDATE pos_reconciliation_results SET
      pinned_mode = COALESCE(v_intent.pinned_mode, 'non_inventory'),
      cantidad = p_desired,
      result = 'NO_MUTATION_APPROVED',
      updated_at = now()
    WHERE id = v_intent.id;
    RETURN QUERY SELECT p_item_id, 'NO_MUTATION_APPROVED'::text, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  -- ═══ STEP 5: Consumption delta ═══
  v_delta := p_desired - v_intent.applied_consumption;

  IF v_delta = 0 THEN
    UPDATE pos_reconciliation_results SET
      cantidad = p_desired, result = 'RECONCILED', updated_at = now()
    WHERE id = v_intent.id;
    RETURN QUERY SELECT p_item_id, 'RECONCILED'::text, v_intent.applied_consumption, 0::numeric;
    RETURN;
  END IF;

  -- ═══ STEP 6: Authority check — MUST be r1 for sale mutation ═══
  IF p_sale_authority != 'r1' THEN
    UPDATE pos_reconciliation_results SET
      cantidad = p_desired, result = 'BLOCKED_OWNER_MISSING', updated_at = now()
    WHERE id = v_intent.id;
    RETURN QUERY SELECT p_item_id, 'BLOCKED_OWNER_MISSING'::text, v_intent.applied_consumption, 0::numeric;
    RETURN;
  END IF;

  v_next_rev := v_intent.last_mutation_revision + 1;

  -- ═══ STEP 7: RECIPE MODE ═══
  IF v_mode = 'recipe' THEN

    -- PHASE A: Complete prevalidation — zero mutation
    FOR v_plan_line IN
      SELECT l.ingredient_id, l.quantity AS recipe_qty, l.recipe_unit,
             inv.stock_unit, inv.ingredient_id AS inv_target
      FROM pos_recipe_lines l
      JOIN pos_inventory inv ON inv.client_id = l.client_id AND inv.ingredient_id = l.ingredient_id
      WHERE l.client_id = p_client_id AND l.recipe_version_id = v_recipe_version_id
      ORDER BY l.ingredient_id
    LOOP
      v_converted := convert_recipe_to_stock(v_plan_line.recipe_qty, v_plan_line.recipe_unit, v_plan_line.stock_unit);
      IF v_converted IS NULL THEN
        UPDATE pos_reconciliation_results SET
          cantidad = p_desired, result = 'BLOCKED_UNIT_MISSING', updated_at = now()
        WHERE id = v_intent.id;
        RETURN QUERY SELECT p_item_id, 'BLOCKED_UNIT_MISSING'::text, v_intent.applied_consumption, 0::numeric;
        RETURN;
      END IF;
      IF v_converted <= 0 THEN
        UPDATE pos_reconciliation_results SET
          cantidad = p_desired, result = 'BLOCKED_UNIT_MISSING', updated_at = now()
        WHERE id = v_intent.id;
        RETURN QUERY SELECT p_item_id, 'BLOCKED_UNIT_MISSING'::text, v_intent.applied_consumption, 0::numeric;
        RETURN;
      END IF;
    END LOOP;

    -- PHASE A.2: Acquire ALL ingredient target locks in deterministic order
    SELECT count(*) INTO v_locked_count
    FROM (
      SELECT ingredient_id FROM pos_inventory
      WHERE client_id = p_client_id
        AND ingredient_id IN (
          SELECT ingredient_id FROM pos_recipe_lines
          WHERE client_id = p_client_id AND recipe_version_id = v_recipe_version_id
        )
      ORDER BY ingredient_id
      FOR UPDATE
    ) locked;

    -- Verify all targets locked. Un insumo de la receta SIN fila en pos_inventory
    -- (o con mas de una) no es corrupcion: es una receta a medio dar de alta. Antes
    -- se lanzaba RAISE y abortaba la conciliacion de TODA la orden (barrido
    -- 2026-09-10, inventario LENTE-6). Ahora es un resultado BLOCKED explicito,
    -- como los demas: la orden queda pendiente, visible, y sin tocar stock.
    IF v_locked_count != (SELECT count(DISTINCT ingredient_id) FROM pos_recipe_lines
                          WHERE client_id = p_client_id AND recipe_version_id = v_recipe_version_id) THEN
      UPDATE pos_reconciliation_results SET
        cantidad = p_desired, result = 'BLOCKED_TARGET_MISSING', updated_at = now()
      WHERE id = v_intent.id;
      RETURN QUERY SELECT p_item_id, 'BLOCKED_TARGET_MISSING'::text, v_intent.applied_consumption, 0::numeric;
      RETURN;
    END IF;

    -- PHASE B: Mutation (all-or-nothing — any failure = RAISE = tx abort)
    FOR v_plan_line IN
      SELECT l.ingredient_id, l.quantity AS recipe_qty, l.recipe_unit,
             inv.stock_unit
      FROM pos_recipe_lines l
      JOIN pos_inventory inv ON inv.client_id = l.client_id AND inv.ingredient_id = l.ingredient_id
      WHERE l.client_id = p_client_id AND l.recipe_version_id = v_recipe_version_id
      ORDER BY l.ingredient_id
    LOOP
      v_converted := convert_recipe_to_stock(v_plan_line.recipe_qty, v_plan_line.recipe_unit, v_plan_line.stock_unit);
      v_ing_delta := v_converted * v_delta;

      -- Atomic stock update — no clamping, allows negative
      UPDATE pos_inventory
      SET stock = stock - v_ing_delta, updated_at = now()
      WHERE client_id = p_client_id AND ingredient_id = v_plan_line.ingredient_id;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated != 1 THEN
        RAISE EXCEPTION 'Ingredient % update failed: rows=%', v_plan_line.ingredient_id, v_updated;
      END IF;

      -- Movement provenance (order_id left NULL — uuid type mismatch; use reconciliation_result_id)
      INSERT INTO pos_inventory_movements
        (client_id, ingredient_id, movement_type, quantity, actor, notes,
         reconciliation_result_id, mutation_revision)
      VALUES
        (p_client_id, v_plan_line.ingredient_id,
         CASE WHEN v_ing_delta > 0 THEN 'recipe_deduction' ELSE 'recipe_reversal' END,
         -v_ing_delta,
         'r1_reconciler',
         'rv=' || v_recipe_version_id || ' rev=' || v_next_rev || ' oi=' || p_item_id,
         v_intent.id, v_next_rev);
    END LOOP;

    -- Commit pin + applied state
    UPDATE pos_reconciliation_results SET
      pinned_mode = COALESCE(v_intent.pinned_mode, 'recipe'),
      pinned_recipe_version_id = COALESCE(v_intent.pinned_recipe_version_id, v_recipe_version_id),
      cantidad = p_desired,
      applied_consumption = p_desired,
      last_mutation_revision = v_next_rev,
      result = 'RECONCILED',
      updated_at = now()
    WHERE id = v_intent.id;

    RETURN QUERY SELECT p_item_id, 'RECONCILED'::text, p_desired, v_delta;
    RETURN;

  -- ═══ STEP 8: DIRECT_STOCK MODE ═══
  ELSIF v_mode = 'direct_stock' THEN

    -- Atomic market stock update — no clamping
    UPDATE pos_market_stock
    SET stock = stock - v_delta, updated_at = now()
    WHERE client_id = p_client_id AND id = v_market_stock_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated != 1 THEN
      RAISE EXCEPTION 'Market stock % update failed: rows=%', v_market_stock_id, v_updated;
    END IF;

    -- Movement provenance
    INSERT INTO pos_market_movements
      (client_id, menu_item_id, movement_type, quantity, order_id, actor, notes,
       reconciliation_result_id, mutation_revision)
    VALUES
      (p_client_id, p_menu_item_id,
       CASE WHEN v_delta > 0 THEN 'venta' ELSE 'devolucion' END,
       -v_delta, p_order_id,
       'r1_reconciler',
       'mkt=' || v_market_stock_id || ' rev=' || v_next_rev || ' oi=' || p_item_id,
       v_intent.id, v_next_rev);

    -- Commit pin + applied state
    UPDATE pos_reconciliation_results SET
      pinned_mode = COALESCE(v_intent.pinned_mode, 'direct_stock'),
      pinned_market_stock_id = COALESCE(v_intent.pinned_market_stock_id, v_market_stock_id),
      cantidad = p_desired,
      applied_consumption = p_desired,
      last_mutation_revision = v_next_rev,
      result = 'RECONCILED',
      updated_at = now()
    WHERE id = v_intent.id;

    RETURN QUERY SELECT p_item_id, 'RECONCILED'::text, p_desired, v_delta;
    RETURN;

  END IF;

  -- Should not reach here
  RAISE EXCEPTION 'Unhandled mode: %', v_mode;
END;
$$;

-- ── (4) r1_legacy_sale_deduction: idempotente por orden (replay offline) ─────
CREATE OR REPLACE FUNCTION "public"."r1_legacy_sale_deduction"("p_client_id" "text", "p_order_id" "text", "p_actor" "text", "p_items" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_authority text;
  v_item jsonb;
  v_mid text;
  v_qty numeric;
  v_current_stock numeric;
  v_new_stock numeric;
  v_deductions jsonb := '[]'::jsonb;
  v_updated int;
BEGIN
  -- 1. Acquire authority FOR SHARE (participates in serialized transition protocol)
  SELECT sale_authority INTO v_authority
  FROM pos_mutation_authority
  WHERE client_id = p_client_id
  FOR SHARE;

  IF v_authority IS NULL OR v_authority != 'legacy' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'AUTHORITY_NOT_LEGACY',
      'current_authority', COALESCE(v_authority, 'none'));
  END IF;

  -- 2. IDEMPOTENTE POR ORDEN. El cobro offline encola esta llamada y la cola
  -- reintenta ante una respuesta perdida: sin esto cada reintento descontaba otra
  -- vez (barrido 2026-09-10, inventario LENTE-3). Si la orden ya tiene movimientos
  -- de venta, se devuelven los que hubo y no se toca nada.
  IF EXISTS (SELECT 1 FROM pos_market_movements
             WHERE client_id = p_client_id AND order_id = p_order_id AND movement_type = 'venta') THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('menu_item_id', m.menu_item_id, 'cantidad', -m.quantity,
             'new_stock', (SELECT s.stock FROM pos_market_stock s WHERE s.client_id = p_client_id AND s.menu_item_id = m.menu_item_id))), '[]'::jsonb)
    INTO v_deductions
    FROM pos_market_movements m
    WHERE m.client_id = p_client_id AND m.order_id = p_order_id AND m.movement_type = 'venta';
    RETURN jsonb_build_object('ok', true, 'already_applied', true, 'deductions', v_deductions);
  END IF;

  -- 3. Process each item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_mid := v_item->>'menu_item_id';
    v_qty := (v_item->>'cantidad')::numeric;

    IF v_mid IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;

    -- Atomic stock decrement (no clamp — allows negative)
    UPDATE pos_market_stock
    SET stock = stock - v_qty, updated_at = now()
    WHERE client_id = p_client_id AND menu_item_id = v_mid
    RETURNING stock INTO v_new_stock;

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated = 1 THEN
      -- Movement provenance
      INSERT INTO pos_market_movements
        (client_id, menu_item_id, movement_type, quantity, order_id, actor, notes)
      VALUES
        (p_client_id, v_mid, 'venta', -v_qty, p_order_id, p_actor,
         'legacy_sale_rpc');

      v_deductions := v_deductions || jsonb_build_object(
        'menu_item_id', v_mid, 'cantidad', v_qty, 'new_stock', v_new_stock);
    END IF;
    -- If item not in pos_market_stock, skip silently (matches legacy behavior)
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'deductions', v_deductions);
END;
$$;

COMMIT;
