-- ══════════════════════════════════════════════════════════════════════
-- SKEL-04 · A1.3 — Default inventory policy on new menu items
-- ══════════════════════════════════════════════════════════════════════
--
-- Problema:
--   La deducción de stock (Sistema R1, r1_reconcile_item en 004_functions.sql)
--   bloquea cualquier item de menú SIN fila en pos_item_inventory_policy con
--   result='BLOCKED_UNCLASSIFIED'. provisionTenant siembra policies para los
--   items de plantilla, pero un item creado DESPUÉS (admin/menu, carga-masiva)
--   nace sin policy → al venderse cae en BLOCKED_UNCLASSIFIED. Para un cliente
--   nuevo que arma su menú real, eso es una falla silenciosa.
--
-- Solución:
--   Trigger AFTER INSERT en pos_menu_items que crea una policy no-bloqueante
--   ('non_inventory') SOLO para tenants con data_source='fullsite' (esqueleton /
--   clientes nuevos). AMALAY y cualquier tenant legacy (data_source='wansoft' o
--   NULL) conservan el default 'unclassified' de la columna → su disciplina de
--   clasificación de inventario queda INTACTA (los items nuevos siguen apareciendo
--   en su cola de "por clasificar").
--
-- Semántica resultante para un cliente nuevo:
--   item nuevo → policy 'non_inventory' (venta reconcilia limpio, NO descuenta) →
--   cuando el dueño captura una receta, /api/pos/recipe-sync flipa la policy a
--   'recipe' y crea la versión R1 → a partir de ahí SÍ descuenta. Sin fallos.
--
-- Idempotente: DROP TRIGGER IF EXISTS + CREATE OR REPLACE FUNCTION + ON CONFLICT
--              DO NOTHING. Re-aplicable sin efectos secundarios.
-- Multi-tenant safe: la policy hereda client_id del item; nada global se muta.
--
-- ══════════════════════════════════════════════════════════════════════
-- PREFLIGHT — verificar estado antes de aplicar
-- ══════════════════════════════════════════════════════════════════════
/*
-- (1) Confirmar el UNIQUE que usa el ON CONFLICT
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.pos_item_inventory_policy'::regclass AND contype = 'u';
-- Esperado: UNIQUE (client_id, menu_item_id)

-- (2) ¿Cuántos items 'fullsite' hoy NO tienen policy? (huecos que el trigger cubrirá a futuro)
SELECT mi.client_id, count(*) AS items_sin_policy
FROM pos_menu_items mi
JOIN clients c ON c.id = mi.client_id AND c.data_source = 'fullsite'
LEFT JOIN pos_item_inventory_policy p
  ON p.client_id = mi.client_id AND p.menu_item_id = mi.id
WHERE p.id IS NULL
GROUP BY mi.client_id;
*/

-- ══════════════════════════════════════════════════════════════════════
-- MIGRATION
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_default_inventory_policy_on_menu_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_data_source text;
BEGIN
  SELECT data_source INTO v_data_source FROM clients WHERE id = NEW.client_id;

  -- Solo tenants 'fullsite'. Legacy (wansoft/NULL) conserva default 'unclassified'.
  IF v_data_source = 'fullsite' THEN
    INSERT INTO pos_item_inventory_policy
      (client_id, menu_item_id, inventory_mode, approved_by, approved_at)
    VALUES
      (NEW.client_id, NEW.id, 'non_inventory', 'auto_trigger', now())
    ON CONFLICT (client_id, menu_item_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_default_inventory_policy_on_menu_item() IS
  'SKEL-04 A1.3: items de menú de tenants fullsite nacen con policy non_inventory '
  '(no-bloqueante) para no caer en BLOCKED_UNCLASSIFIED. Legacy conserva unclassified.';

DROP TRIGGER IF EXISTS trg_default_inventory_policy ON public.pos_menu_items;
CREATE TRIGGER trg_default_inventory_policy
  AFTER INSERT ON public.pos_menu_items
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_default_inventory_policy_on_menu_item();

-- ── Backfill: items de menú EXISTENTES de tenants 'fullsite' sin policy ────────
-- El trigger solo cubre inserts futuros. Los items ya creados antes de esta
-- migración (p.ej. esqueleton-demo, provisionado antes de A1) quedarían sin policy
-- → BLOCKED_UNCLASSIFIED al venderse. Los normalizamos a 'non_inventory'.
-- Solo fullsite, solo los que faltan (ON CONFLICT DO NOTHING). Idempotente.
INSERT INTO public.pos_item_inventory_policy
  (client_id, menu_item_id, inventory_mode, approved_by, approved_at)
SELECT mi.client_id, mi.id, 'non_inventory', 'auto_backfill', now()
FROM public.pos_menu_items mi
JOIN public.clients c ON c.id = mi.client_id AND c.data_source = 'fullsite'
LEFT JOIN public.pos_item_inventory_policy p
  ON p.client_id = mi.client_id AND p.menu_item_id = mi.id
WHERE p.id IS NULL
ON CONFLICT (client_id, menu_item_id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════
-- POSTFLIGHT — validar tras aplicar
-- ══════════════════════════════════════════════════════════════════════
/*
-- (A) El trigger existe
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgrelid = 'public.pos_menu_items'::regclass AND NOT tgisinternal;
-- Esperado: trg_default_inventory_policy | O (enabled)

-- (B) Smoke test en un tenant fullsite de prueba (reemplazar <client>):
--     insertar un item y confirmar que aparece la policy non_inventory.
-- INSERT INTO pos_menu_items (id, client_id, name, price, active)
--   VALUES ('<client>-smoke-a13', '<client>', 'Smoke A1.3', 10, true);
-- SELECT inventory_mode, approved_by FROM pos_item_inventory_policy
--   WHERE client_id='<client>' AND menu_item_id='<client>-smoke-a13';
--   Esperado: non_inventory | auto_trigger
-- Limpieza:
-- DELETE FROM pos_item_inventory_policy WHERE menu_item_id='<client>-smoke-a13';
-- DELETE FROM pos_menu_items WHERE id='<client>-smoke-a13';

-- (C) AMALAY NO se ve afectado: insertar un item de prueba para amalay y confirmar
--     que NO se crea policy (queda unclassified por default).
-- INSERT INTO pos_menu_items (id, client_id, name, price, active)
--   VALUES ('amalay-smoke-a13', 'amalay', 'Smoke A1.3', 10, true);
-- SELECT count(*) FROM pos_item_inventory_policy WHERE menu_item_id='amalay-smoke-a13';
--   Esperado: 0
-- DELETE FROM pos_menu_items WHERE id='amalay-smoke-a13';
*/

-- ══════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ══════════════════════════════════════════════════════════════════════
/*
DROP TRIGGER IF EXISTS trg_default_inventory_policy ON public.pos_menu_items;
DROP FUNCTION IF EXISTS public.fn_default_inventory_policy_on_menu_item();
-- Nota: las policies 'non_inventory' con approved_by='auto_trigger' ya creadas
-- son inofensivas (no-bloqueantes). Para revertirlas también:
-- DELETE FROM pos_item_inventory_policy WHERE approved_by='auto_trigger' AND inventory_mode='non_inventory';
*/
