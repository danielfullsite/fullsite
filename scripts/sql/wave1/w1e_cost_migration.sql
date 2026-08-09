-- ═════════════════════════════════════════════════════════════════════════════
-- W1-E · Verdad de costo canónica: reconocimiento inmutable de COGS (ADITIVA)
-- ═════════════════════════════════════════════════════════════════════════════
-- EVENTO CANÓNICO DE RECONOCIMIENTO: r1_reconcile_item PHASE B — el mismo
-- instante transaccional en que R1 depleta inventario (delta por revisión,
-- receta PINNEADA). El costo se sella ahí con el weighted-average vigente de
-- pos_ingredients.cost_per_unit EN ESA TRANSACCIÓN. Nada del navegador se
-- confía (items[].recipe_cost se ignora); nada histórico se recalcula después.
--
-- IDENTIDAD ECONÓMICA: (reconciliation_result_id, mutation_revision) — la
-- misma maquinaria exactly-once certificada en W1-A. UNIQUE a nivel BD.
--
-- REVERSA: usa el SNAPSHOT ORIGINAL — proporcional a applied_cost /
-- applied_consumption acumulados en el intent (jamás el precio actual del
-- ingrediente). Reversa total → applied_cost vuelve a 0 exacto.
--
-- COBERTURA (fail-closed, sin fabricar COGS):
--   FULL     = todas las líneas con cost_per_unit > 0
--   PARTIAL  = alguna línea sin costo conocido (total_cost = solo lo conocido)
--   UNKNOWN  = sin base de costo canónica (direct_stock/market) → total_cost NULL
--   REVERSAL = reversa proporcional al snapshot original
--
-- La mutación de INVENTARIO del RPC queda BYTE-IDÉNTICA a la certificada en
-- W1-A (solo se añade captura de costo y el insert del evento).
--
-- Rollback:
--   DROP TRIGGER trg_cost_events_immutable ON pos_cost_events;
--   DROP TABLE pos_cost_events;
--   ALTER TABLE pos_reconciliation_results DROP COLUMN applied_cost;
--   (re-crear r1_reconcile_item desde 004_functions.sql — versión W1-A)
--   (re-crear vista pos_cierres_estado desde w1d_close_migration.sql)
-- NOTA: 004_functions.sql se re-consolidará en el release gate de Wave 1.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. Evento de costo inmutable ──
CREATE TABLE IF NOT EXISTS pos_cost_events (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  order_item_id TEXT NOT NULL,
  menu_item_id TEXT NOT NULL,
  reconciliation_result_id BIGINT NOT NULL REFERENCES pos_reconciliation_results(id),
  mutation_revision INT NOT NULL,
  recipe_version_id BIGINT,
  delta_qty NUMERIC NOT NULL,          -- porciones reconocidas (+) o reversadas (−)
  total_cost NUMERIC,                  -- NULL = sin base de costo (UNKNOWN); NUNCA 0 fabricado
  cost_coverage TEXT NOT NULL,         -- FULL | PARTIAL | UNKNOWN | REVERSAL
  breakdown JSONB,                     -- [{ingredient_id, qty_consumed, unit_cost, line_cost, cost_known}]
                                       -- o {basis:'original_snapshot_average', ...} en reversas
  created_at TIMESTAMPTZ DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE pos_cost_events
    ADD CONSTRAINT uq_cost_event_identity UNIQUE (client_id, reconciliation_result_id, mutation_revision);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_cost_events_order ON pos_cost_events (client_id, order_id);
CREATE INDEX IF NOT EXISTS idx_cost_events_created ON pos_cost_events (client_id, created_at);

-- Inmutabilidad: mismo guard de W1-D (unlock administrativo explícito auditado)
DROP TRIGGER IF EXISTS trg_cost_events_immutable ON pos_cost_events;
CREATE TRIGGER trg_cost_events_immutable
  BEFORE UPDATE OR DELETE ON pos_cost_events
  FOR EACH ROW EXECUTE FUNCTION w1d_sealed_guard();

-- ── 2. Acumulador de costo reconocido en el intent (base de la reversa) ──
ALTER TABLE pos_reconciliation_results ADD COLUMN IF NOT EXISTS applied_cost NUMERIC DEFAULT 0;

-- ── 3. r1_reconcile_item con reconocimiento de costo ──
CREATE OR REPLACE FUNCTION public.r1_reconcile_item(p_client_id text, p_order_id text, p_item_id text, p_menu_item_id text, p_desired numeric, p_sale_authority text)
 RETURNS TABLE(r_item_id text, r_result text, r_applied numeric, r_delta numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- W1-E
  v_line_cost numeric;
  v_total_cost numeric := 0;
  v_unknown_lines int := 0;
  v_known_lines int := 0;
  v_breakdown jsonb := '[]'::jsonb;
  v_cost_coverage text;
  v_event_cost numeric;
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
    v_mode := v_intent.pinned_mode;
    v_recipe_version_id := v_intent.pinned_recipe_version_id;
    v_market_stock_id := v_intent.pinned_market_stock_id;
  ELSE
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
      IF NOT EXISTS (SELECT 1 FROM pos_market_stock WHERE client_id = p_client_id AND id = v_market_stock_id) THEN
        UPDATE pos_reconciliation_results SET
          cantidad = p_desired, result = 'BLOCKED_TARGET_MISSING', updated_at = now()
        WHERE id = v_intent.id;
        RETURN QUERY SELECT p_item_id, 'BLOCKED_TARGET_MISSING'::text, v_intent.applied_consumption, 0::numeric;
        RETURN;
      END IF;
    END IF;
  END IF;

  -- ═══ STEP 4: NON_INVENTORY — sin consumo, sin costo ═══
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

  -- ═══ STEP 6: Authority check ═══
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

    -- PHASE A: prevalidación (idéntica a W1-A)
    FOR v_plan_line IN
      SELECT l.ingredient_id, l.quantity AS recipe_qty, l.recipe_unit,
             inv.stock_unit, inv.ingredient_id AS inv_target
      FROM pos_recipe_lines l
      JOIN pos_inventory inv ON inv.client_id = l.client_id AND inv.ingredient_id = l.ingredient_id
      WHERE l.client_id = p_client_id AND l.recipe_version_id = v_recipe_version_id
      ORDER BY l.ingredient_id
    LOOP
      v_converted := convert_recipe_to_stock(v_plan_line.recipe_qty, v_plan_line.recipe_unit, v_plan_line.stock_unit);
      IF v_converted IS NULL OR v_converted <= 0 THEN
        UPDATE pos_reconciliation_results SET
          cantidad = p_desired, result = 'BLOCKED_UNIT_MISSING', updated_at = now()
        WHERE id = v_intent.id;
        RETURN QUERY SELECT p_item_id, 'BLOCKED_UNIT_MISSING'::text, v_intent.applied_consumption, 0::numeric;
        RETURN;
      END IF;
    END LOOP;

    -- PHASE A.2: locks deterministas (idéntico a W1-A)
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

    IF v_locked_count != (SELECT count(DISTINCT ingredient_id) FROM pos_recipe_lines
                          WHERE client_id = p_client_id AND recipe_version_id = v_recipe_version_id) THEN
      RAISE EXCEPTION 'Recipe target lock count mismatch: locked=% expected=%',
        v_locked_count,
        (SELECT count(DISTINCT ingredient_id) FROM pos_recipe_lines
         WHERE client_id = p_client_id AND recipe_version_id = v_recipe_version_id);
    END IF;

    -- PHASE B: mutación de inventario (idéntica a W1-A) + captura de costo W1-E
    FOR v_plan_line IN
      SELECT l.ingredient_id, l.quantity AS recipe_qty, l.recipe_unit,
             inv.stock_unit,
             pi.cost_per_unit
      FROM pos_recipe_lines l
      JOIN pos_inventory inv ON inv.client_id = l.client_id AND inv.ingredient_id = l.ingredient_id
      LEFT JOIN pos_ingredients pi ON pi.client_id = l.client_id AND pi.id = l.ingredient_id
      WHERE l.client_id = p_client_id AND l.recipe_version_id = v_recipe_version_id
      ORDER BY l.ingredient_id
    LOOP
      v_converted := convert_recipe_to_stock(v_plan_line.recipe_qty, v_plan_line.recipe_unit, v_plan_line.stock_unit);
      v_ing_delta := v_converted * v_delta;

      UPDATE pos_inventory
      SET stock = stock - v_ing_delta, updated_at = now()
      WHERE client_id = p_client_id AND ingredient_id = v_plan_line.ingredient_id;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated != 1 THEN
        RAISE EXCEPTION 'Ingredient % update failed: rows=%', v_plan_line.ingredient_id, v_updated;
      END IF;

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

      -- W1-E: captura de costo SOLO en consumo hacia adelante — la reversa usa
      -- el snapshot original acumulado, nunca el precio actual.
      IF v_delta > 0 THEN
        IF v_plan_line.cost_per_unit IS NOT NULL AND v_plan_line.cost_per_unit > 0 THEN
          v_line_cost := round(v_ing_delta * v_plan_line.cost_per_unit, 6);
          v_total_cost := v_total_cost + v_line_cost;
          v_known_lines := v_known_lines + 1;
        ELSE
          v_line_cost := NULL;
          v_unknown_lines := v_unknown_lines + 1;
        END IF;
        v_breakdown := v_breakdown || jsonb_build_object(
          'ingredient_id', v_plan_line.ingredient_id,
          'qty_consumed', v_ing_delta,
          'unit_cost', v_plan_line.cost_per_unit,
          'line_cost', v_line_cost,
          'cost_known', (v_plan_line.cost_per_unit IS NOT NULL AND v_plan_line.cost_per_unit > 0));
      END IF;
    END LOOP;

    -- W1-E: evento económico exactly-once (identidad = intent + revisión)
    IF v_delta > 0 THEN
      v_cost_coverage := CASE
        WHEN v_unknown_lines = 0 THEN 'FULL'
        WHEN v_known_lines = 0 THEN 'UNKNOWN'
        ELSE 'PARTIAL' END;
      v_event_cost := CASE WHEN v_known_lines = 0 THEN NULL ELSE round(v_total_cost, 4) END;
    ELSE
      -- Reversa proporcional al costo ORIGINAL reconocido en este intent
      v_cost_coverage := 'REVERSAL';
      IF v_intent.applied_consumption > 0 AND v_intent.applied_cost IS NOT NULL THEN
        v_event_cost := round(v_intent.applied_cost / v_intent.applied_consumption * v_delta, 4);
      ELSE
        v_event_cost := NULL;
      END IF;
      v_breakdown := jsonb_build_object(
        'basis', 'original_snapshot_average',
        'applied_cost_before', v_intent.applied_cost,
        'applied_consumption_before', v_intent.applied_consumption,
        'reversed_qty', v_delta);
    END IF;

    INSERT INTO pos_cost_events
      (client_id, order_id, order_item_id, menu_item_id, reconciliation_result_id,
       mutation_revision, recipe_version_id, delta_qty, total_cost, cost_coverage, breakdown)
    VALUES
      (p_client_id, p_order_id, p_item_id, p_menu_item_id, v_intent.id,
       v_next_rev, v_recipe_version_id, v_delta, v_event_cost, v_cost_coverage, v_breakdown)
    ON CONFLICT (client_id, reconciliation_result_id, mutation_revision) DO NOTHING;

    UPDATE pos_reconciliation_results SET
      pinned_mode = COALESCE(v_intent.pinned_mode, 'recipe'),
      pinned_recipe_version_id = COALESCE(v_intent.pinned_recipe_version_id, v_recipe_version_id),
      cantidad = p_desired,
      applied_consumption = p_desired,
      applied_cost = round(coalesce(v_intent.applied_cost, 0) + coalesce(v_event_cost, 0), 4),
      last_mutation_revision = v_next_rev,
      result = 'RECONCILED',
      updated_at = now()
    WHERE id = v_intent.id;

    RETURN QUERY SELECT p_item_id, 'RECONCILED'::text, p_desired, v_delta;
    RETURN;

  -- ═══ STEP 8: DIRECT_STOCK MODE ═══
  ELSIF v_mode = 'direct_stock' THEN

    UPDATE pos_market_stock
    SET stock = stock - v_delta, updated_at = now()
    WHERE client_id = p_client_id AND id = v_market_stock_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated != 1 THEN
      RAISE EXCEPTION 'Market stock % update failed: rows=%', v_market_stock_id, v_updated;
    END IF;

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

    -- W1-E: sin base de costo canónica para retail — UNKNOWN explícito, NUNCA 0
    INSERT INTO pos_cost_events
      (client_id, order_id, order_item_id, menu_item_id, reconciliation_result_id,
       mutation_revision, recipe_version_id, delta_qty, total_cost, cost_coverage, breakdown)
    VALUES
      (p_client_id, p_order_id, p_item_id, p_menu_item_id, v_intent.id,
       v_next_rev, NULL, v_delta, NULL, 'UNKNOWN',
       jsonb_build_object('reason', 'direct_stock_sin_base_de_costo', 'market_stock_id', v_market_stock_id))
    ON CONFLICT (client_id, reconciliation_result_id, mutation_revision) DO NOTHING;

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

  RAISE EXCEPTION 'Unhandled mode: %', v_mode;
END;
$function$;

-- ── 4. Vista de cierre con COGS sellado vs post-cierre (extiende W1-D) ──
-- DROP+CREATE: Postgres no permite reordenar/insertar columnas con OR REPLACE.
DROP VIEW IF EXISTS pos_cierres_estado;
CREATE VIEW pos_cierres_estado AS
SELECT c.id, c.client_id, c.turno_id, c.fecha AS business_date,
       c.total_ventas, c.efectivo_sistema, c.tarjeta_sistema,
       c.transferencias_sistema, c.total_contado, c.diferencia,
       c.closed_by, c.sealed_at, c.snapshot,
       count(DISTINCT a.id) AS ajustes_count,
       coalesce(max(AJ.monto), 0) AS ajustes_monto,
       coalesce(max(COGS.cogs_sealed), 0) AS cogs_sealed,
       coalesce(max(COGS.cogs_post_close), 0) AS cogs_post_close,
       coalesce(max(COGS.cogs_unknown_events), 0) AS cogs_unknown_events,
       CASE WHEN count(DISTINCT a.id) = 0 AND coalesce(max(COGS.cogs_post_close), 0) = 0 THEN 'SEALED'
            ELSE 'SEALED_WITH_ADJUSTMENTS' END AS estado
FROM pos_cierres c
LEFT JOIN pos_cierre_ajustes a
  ON a.client_id = c.client_id AND a.cierre_id = c.id
LEFT JOIN LATERAL (
  SELECT sum(a2.monto) AS monto FROM pos_cierre_ajustes a2
  WHERE a2.client_id = c.client_id AND a2.cierre_id = c.id
) AJ ON true
LEFT JOIN LATERAL (
  SELECT
    sum(ce.total_cost) FILTER (WHERE ce.created_at <= c.sealed_at) AS cogs_sealed,
    sum(ce.total_cost) FILTER (WHERE ce.created_at >  c.sealed_at) AS cogs_post_close,
    count(*) FILTER (WHERE ce.cost_coverage = 'UNKNOWN') AS cogs_unknown_events
  FROM pos_cost_events ce
  JOIN pos_orders o ON o.id = ce.order_id AND o.client_id = ce.client_id
  WHERE ce.client_id = c.client_id AND o.turno_id = c.turno_id
) COGS ON true
GROUP BY c.id, c.client_id, c.turno_id, c.fecha, c.total_ventas,
         c.efectivo_sistema, c.tarjeta_sistema, c.transferencias_sistema,
         c.total_contado, c.diferencia, c.closed_by, c.sealed_at, c.snapshot;
