-- ═════════════════════════════════════════════════════════════════════════════
-- W1-A · Cierre de cobertura de pos_item_inventory_policy
-- ═════════════════════════════════════════════════════════════════════════════
-- Contexto: al retirar Sistema A (deducción client-side por fuzzy match), R1 es
-- la única autoridad de depleción. R1 es fail-closed: los items 'unclassified'
-- producen BLOCKED_UNCLASSIFIED (visibles en inventory_status del save, nunca
-- depleción silenciosa). Este script cierra la cobertura de forma DETERMINISTA:
--
--   Regla R1: unclassified + líneas directas en pos_recipes_old (por menu_item_id,
--             solo ingredient_type='ingredient', sin sub-recetas) y CADA línea
--             prevalidable (ingrediente existe en pos_inventory + unidad
--             convertible, espejo de la prevalidación de r1_reconcile_item)
--             → materializa pos_recipe_versions + pos_recipe_lines y flip a 'recipe'.
--
--   Regla R2: unclassified + categoría 'mkt-%' (retail 1:1)
--             → crea fila pos_market_stock con stock=0 ("sin conteo inicial";
--             el negativo resultante es verdad operativa detectable, no se
--             inventa stock) y flip a 'direct_stock'.
--
--   Resto:    PERMANECE 'unclassified' (fail-closed, visible). El reporte final
--             lista los pendientes para clasificación humana.
--
-- Idempotente: re-ejecutar no duplica versiones (guard NOT EXISTS active) ni
-- filas market (ON CONFLICT DO NOTHING) ni re-flipea policies ya resueltas.
-- NO toca items ya clasificados. NO borra nada. NO modifica históricos.
--
-- Uso: reemplazar CLIENT_ID_HERE y ejecutar. Staging primero; prod solo con
-- autorización explícita (W1-A gate).
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_client   CONSTANT text := 'CLIENT_ID_HERE';
  v_batch    CONSTANT text := 'w1a_policy_backfill_v1';
  r          record;
  v_line     record;
  v_version_id bigint;
  v_ms_id      bigint;
  v_ok         boolean;
  v_n_recipe   int := 0;
  v_n_market   int := 0;
  v_n_skipped  int := 0;
BEGIN
  -- ── Regla R1: materializar recetas directas prevalidadas ──
  FOR r IN
    SELECT p.menu_item_id
    FROM pos_item_inventory_policy p
    WHERE p.client_id = v_client
      AND p.inventory_mode = 'unclassified'
      AND EXISTS (
        SELECT 1 FROM pos_recipes_old ro
        WHERE ro.client_id = v_client AND ro.menu_item_id = p.menu_item_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM pos_recipe_versions rv
        WHERE rv.client_id = v_client AND rv.menu_item_id = p.menu_item_id AND rv.active
      )
  LOOP
    -- Prevalidación completa (todo-o-nada, espejo de r1_reconcile_item PHASE A):
    -- toda línea debe ser ingrediente plano (sin sub-recetas), existir en
    -- pos_inventory y tener conversión de unidad válida (> 0).
    v_ok := NOT EXISTS (
      SELECT 1 FROM pos_recipes_old ro
      WHERE ro.client_id = v_client AND ro.menu_item_id = r.menu_item_id
        AND (coalesce(ro.ingredient_type, 'ingredient') <> 'ingredient'
             OR ro.ingredient_id LIKE 'sub\_%')
    );

    IF v_ok THEN
      FOR v_line IN
        SELECT ro.ingredient_id, sum(ro.quantity) AS quantity, min(ro.unit) AS unit
        FROM pos_recipes_old ro
        WHERE ro.client_id = v_client AND ro.menu_item_id = r.menu_item_id
        GROUP BY ro.ingredient_id
      LOOP
        -- El ingrediente debe existir en pos_inventory (target de stock del RPC),
        -- en pos_ingredients (FK de pos_recipe_lines) y la unidad ser convertible.
        PERFORM 1 FROM pos_inventory inv
        WHERE inv.client_id = v_client
          AND inv.ingredient_id = v_line.ingredient_id
          AND coalesce(convert_recipe_to_stock(v_line.quantity, v_line.unit, inv.stock_unit), 0) > 0
          AND EXISTS (SELECT 1 FROM pos_ingredients pi
                      WHERE pi.client_id = v_client AND pi.id = v_line.ingredient_id);
        IF NOT FOUND THEN
          v_ok := false;
          EXIT;
        END IF;
      END LOOP;
    END IF;

    IF NOT v_ok THEN
      v_n_skipped := v_n_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO pos_recipe_versions
      (client_id, menu_item_id, version, active, source, source_batch, created_by, activated_by, notes)
    VALUES
      (v_client, r.menu_item_id, 1, true, 'pos_recipes_old', v_batch, 'w1a_backfill', 'w1a_backfill',
       'W1-A: materializada desde pos_recipes_old (líneas directas por menu_item_id)')
    RETURNING id INTO v_version_id;

    INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
    SELECT v_client, v_version_id, ro.ingredient_id, sum(ro.quantity), min(ro.unit)
    FROM pos_recipes_old ro
    WHERE ro.client_id = v_client AND ro.menu_item_id = r.menu_item_id
    GROUP BY ro.ingredient_id;

    UPDATE pos_item_inventory_policy
    SET inventory_mode = 'recipe', approved_at = now(), approved_by = 'w1a_backfill', updated_at = now()
    WHERE client_id = v_client AND menu_item_id = r.menu_item_id AND inventory_mode = 'unclassified';

    v_n_recipe := v_n_recipe + 1;
  END LOOP;

  -- ── Regla R2: retail mkt-% → direct_stock con conteo inicial 0 ──
  FOR r IN
    SELECT p.menu_item_id
    FROM pos_item_inventory_policy p
    JOIN pos_menu_items m ON m.client_id = p.client_id AND m.id = p.menu_item_id
    WHERE p.client_id = v_client
      AND p.inventory_mode = 'unclassified'
      AND m.category_id LIKE 'mkt-%'
  LOOP
    INSERT INTO pos_market_stock (client_id, menu_item_id, stock)
    VALUES (v_client, r.menu_item_id, 0)
    ON CONFLICT (client_id, menu_item_id) DO NOTHING;

    SELECT id INTO v_ms_id FROM pos_market_stock
    WHERE client_id = v_client AND menu_item_id = r.menu_item_id;

    UPDATE pos_item_inventory_policy
    SET inventory_mode = 'direct_stock', market_stock_id = v_ms_id,
        approved_at = now(), approved_by = 'w1a_backfill', updated_at = now()
    WHERE client_id = v_client AND menu_item_id = r.menu_item_id AND inventory_mode = 'unclassified';

    v_n_market := v_n_market + 1;
  END LOOP;

  RAISE NOTICE 'W1-A backfill [%]: recipe=% direct_stock=% skipped_prevalidation=%',
    v_client, v_n_recipe, v_n_market, v_n_skipped;
END $$;

-- ── Reporte post-backfill: pendientes de clasificación humana (fail-closed) ──
-- SELECT p.menu_item_id, m.name, m.category_id, m.active
-- FROM pos_item_inventory_policy p
-- LEFT JOIN pos_menu_items m ON m.client_id = p.client_id AND m.id = p.menu_item_id
-- WHERE p.client_id = 'CLIENT_ID_HERE' AND p.inventory_mode = 'unclassified'
-- ORDER BY m.active DESC, m.category_id, m.name;
