-- PENDIENTE: aplicar sólo en ventana controlada, con respaldo y prueba en staging.
-- El ledger de inventario ya sabía de qué orden venía cada descuento. No tenía dónde
-- escribirlo.
--
-- QUÉ ESTABA ROTO
-- `pos_inventory_movements.order_id` era `uuid`, pero `pos_orders.id` es `text` y varios
-- restaurantes no usan UUID. Medido en producción el 2026-09-09:
--
--     scyf-demo    110,790 órdenes,     3 son uuid
--     tekila-rg      5,520 órdenes,     0 son uuid
--     lab-resto      4,768 órdenes,     0 son uuid
--     amalay            36 órdenes,    36 son uuid   ← el único donde la columna servía
--
-- Por eso `r1_reconcile_item` dejaba `order_id` en NULL en su rama de receta (1,948
-- movimientos en amalay, 0 con orden) mientras su rama de `direct_stock`, en la MISMA
-- función, sí lo escribía: esa apunta a `pos_market_movements`, cuyo `order_id` siempre
-- fue text. El comentario que lo explicaba llevaba ahí desde el principio:
-- "order_id left NULL — uuid type mismatch".
--
-- POR QUÉ text Y NO uuid
-- No es preferencia. De las 11 tablas con `order_id` en producción, 9 ya son text
-- —incluidas `pos_market_movements` y `pos_reconciliation_results`, las dos hermanas de
-- este mismo ledger—. El `uuid` era el caso atípico. La única otra tabla con uuid es
-- `pos_customer_visits`, que tiene 0 filas y ningún escritor: mismo defecto, dormido, y
-- fuera del alcance de este cambio a propósito.
--
-- LO QUE NO ESTABA ROTO
-- La procedencia NO se había perdido. Los 2,349 movimientos por receta traen
-- `reconciliation_result_id`, y `pos_reconciliation_results.order_id` es text NOT NULL.
-- El cruce ya era posible en dos saltos; lo que faltaba era que fuera directo y que
-- funcionara para tenants sin UUID. El relleno de abajo usa justamente esa vía, que es
-- una lectura de procedencia registrada por FK, no una inferencia.
--
-- Verificado contra producción el 2026-09-09.

alter table public.pos_inventory_movements
  alter column order_id type text using order_id::text;

-- Relleno: `reconciliation_result_id` tiene FK a `pos_reconciliation_results`, así que la
-- correspondencia es exacta y no hay nada que adivinar. Se comprobó que ningún movimiento
-- apunta a una reconciliación de otro tenant (0 cruces sobre 2,349 filas) y el filtro por
-- client_id se deja puesto para que siga siendo cierto.
--
-- Los 58 movimientos que quedan en NULL (adjustment, invoice_entry, reversal, waste,
-- entry) no nacen de una orden y no tienen de dónde inferirla. Se dejan en NULL.
update public.pos_inventory_movements m
set order_id = r.order_id
from public.pos_reconciliation_results r
where m.reconciliation_result_id = r.id
  and m.client_id = r.client_id
  and m.order_id is null;

-- El cruce consumo x venta pega por (client_id, order_id).
create index if not exists idx_inv_mov_client_order
  on public.pos_inventory_movements (client_id, order_id)
  where order_id is not null;

-- ── r1_reconcile_item: la rama de receta ahora escribe order_id ──────────────
-- Cuerpo idéntico al de scripts/sql/migrations/004_functions.sql. Se verificó que la
-- definición viva en producción empataba con el repo antes de tocarla (md5 del texto sin
-- espacios: f4ddb6126383eb697ac6e39610eb32bd), para no revertir el trabajo de nadie.
-- ── r1_reconcile_item: la rama de receta ahora escribe order_id ──────────────
-- El cuerpo NO es el que tenía esta función cuando se encontró el defecto: es el de
-- `20260910070000_merge_y_cobro_conservan_consumo.sql`, que entró después y trae el
-- manejo de la receta a medio dar de alta. Se comprobó que ese texto es el que está vivo
-- en producción (md5 normalizado f4d1274e6cfed96129bcb748cc14102a, 7,640 caracteres sin
-- comentarios ni espacios) antes de copiarlo, para no revertir ese trabajo. Lo único que
-- cambia aquí respecto a esa versión es el `order_id` del INSERT.
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

      -- Movement provenance. `order_id` es text desde la migración 20260912120000.
      -- Mientras fue uuid, esta rama lo dejaba NULL y la de direct_stock sí lo escribía,
      -- porque pos_market_movements.order_id siempre fue text. El id ya estaba en alcance
      -- (p_order_id); lo único que faltaba era una columna que lo admitiera.
      INSERT INTO pos_inventory_movements
        (client_id, ingredient_id, movement_type, quantity, order_id, actor, notes,
         reconciliation_result_id, mutation_revision)
      VALUES
        (p_client_id, v_plan_line.ingredient_id,
         CASE WHEN v_ing_delta > 0 THEN 'recipe_deduction' ELSE 'recipe_reversal' END,
         -v_ing_delta,
         p_order_id,
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
-- ── reconcile_order_inventory: sin el cast a uuid ────────────────────────────
-- Esta función no la pidió nadie, pero la migración la rompe si no se toca: sus tres
-- `p_order_id::uuid` quedarían comparando uuid contra una columna text, y `text = uuid`
-- no existe como operador. No tiene llamador en TypeScript y usa `pos_recipes_old`, así
-- que es legado; el cambio es sólo quitar el cast, nada más.
-- Los permisos no se tocan: CREATE OR REPLACE los conserva, y esta función es SECURITY
-- INVOKER (RLS sigue aplicando aunque su EXECUTE esté abierto).
CREATE OR REPLACE FUNCTION public.reconcile_order_inventory(p_order_id text)
 RETURNS TABLE(r_ingredient_id text, r_expected numeric, r_net_applied numeric, r_delta numeric, r_action text)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_client_id TEXT;
  v_items JSONB;
  v_rec RECORD;
  v_current_net NUMERIC;
  v_adjustment NUMERIC;
  v_rows INT;
BEGIN
  SELECT o.client_id, o.items INTO v_client_id, v_items
  FROM pos_orders o WHERE o.id = p_order_id FOR UPDATE;
  IF v_client_id IS NULL THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;
  IF v_items IS NOT NULL AND jsonb_typeof(v_items) = 'string' THEN v_items := (v_items #>> '{}')::jsonb; END IF;
  IF v_items IS NULL OR jsonb_typeof(v_items) != 'array' THEN v_items := '[]'::jsonb; END IF;

  FOR v_rec IN
    SELECT ing_id, ROUND(COALESCE(SUM(exp_qty), 0), 6) as expected_qty
    FROM (
      SELECT r.ingredient_id as ing_id, SUM(r.quantity * (elem->>'cantidad')::numeric) as exp_qty
      FROM jsonb_array_elements(v_items) elem
      JOIN pos_recipes_old r ON r.client_id = v_client_id AND lower(r.menu_item_name) = lower(elem->>'nombre')
      GROUP BY r.ingredient_id
      UNION ALL
      SELECT DISTINCT m2.ingredient_id as ing_id, 0::numeric as exp_qty
      FROM pos_inventory_movements m2
      WHERE m2.order_id = p_order_id AND m2.movement_type IN ('deduction','reversal')
        AND m2.ingredient_id NOT IN (
          SELECT r2.ingredient_id FROM jsonb_array_elements(v_items) e2
          JOIN pos_recipes_old r2 ON r2.client_id = v_client_id AND lower(r2.menu_item_name) = lower(e2->>'nombre'))
    ) combined GROUP BY ing_id
  LOOP
    SELECT ROUND(COALESCE(SUM(r.quantity * (elem->>'cantidad')::numeric), 0), 6) INTO v_rec.expected_qty
    FROM jsonb_array_elements(v_items) elem
    JOIN pos_recipes_old r ON r.client_id = v_client_id AND lower(r.menu_item_name) = lower(elem->>'nombre') AND r.ingredient_id = v_rec.ing_id;

    SELECT ROUND(COALESCE(SUM(m3.quantity), 0), 6) INTO v_current_net
    FROM pos_inventory_movements m3
    WHERE m3.order_id = p_order_id AND m3.ingredient_id = v_rec.ing_id AND m3.movement_type IN ('deduction','reversal');

    v_adjustment := ROUND(-v_rec.expected_qty, 6) - v_current_net;

    IF v_adjustment = 0 THEN
      r_ingredient_id := v_rec.ing_id; r_expected := v_rec.expected_qty; r_net_applied := -v_current_net; r_delta := 0; r_action := 'balanced';
      RETURN NEXT; CONTINUE;
    END IF;

    INSERT INTO pos_inventory_movements (client_id, ingredient_id, movement_type, quantity, order_id, actor, notes)
    VALUES (v_client_id, v_rec.ing_id, CASE WHEN v_adjustment < 0 THEN 'deduction' ELSE 'reversal' END,
            v_adjustment, p_order_id, 'system-reconcile', 'Reconciliation ' || ROUND(v_adjustment, 6));

    UPDATE pos_inventory AS inv SET stock = inv.stock + v_adjustment, updated_at = NOW()
    WHERE inv.client_id = v_client_id AND inv.ingredient_id = v_rec.ing_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 1 THEN RAISE EXCEPTION 'Multiple inventory rows for %, got %', v_rec.ing_id, v_rows; END IF;

    r_ingredient_id := v_rec.ing_id; r_expected := v_rec.expected_qty; r_net_applied := -v_current_net; r_delta := v_adjustment;
    r_action := CASE WHEN v_adjustment < 0 THEN 'deducted' ELSE 'reversed' END;
    RETURN NEXT;
  END LOOP;
END;
$function$
;

-- Se reafirman los permisos que r1_reconcile_item ya tenía en producción, para que un
-- clon nazca igual de cerrado y esto no dependa de que CREATE OR REPLACE los preserve.
revoke all on function public.r1_reconcile_item(text, text, text, text, numeric, text) from public, anon;
grant execute on function public.r1_reconcile_item(text, text, text, text, numeric, text) to service_role;
