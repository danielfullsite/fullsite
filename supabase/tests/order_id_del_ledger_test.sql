-- El descuento por receta guarda de qué orden vino — prueba repetible.
--
-- Corre contra STAGING después de aplicar manualmente
-- PENDIENTE_20260912120000_order_id_del_ledger_es_text.sql.
-- No deja basura: al final borra todo lo que sembró.
--
-- Lo que protege: que `pos_inventory_movements.order_id` siga siendo text y que
-- `r1_reconcile_item` siga escribiéndolo. Mientras la columna fue uuid, la rama de receta
-- lo dejaba en NULL —1,948 movimientos en amalay, 0 con orden— y el cruce contra
-- `ops_consumo` no podía separar un descuento duplicado de uno faltante.
--
-- El id de la orden a propósito NO es un UUID. Ése es el caso que importa: `tekila-rg` y
-- `lab-resto` no usan UUID en ninguna de sus 10,288 órdenes, y `scyf-demo` sólo en 3 de
-- 110,790. Una prueba con UUID pasaría aunque la columna volviera a ser uuid, que es
-- exactamente el error que dejó esto roto durante meses.
--
-- Uso:
--   psql "$STAGING_URL" -f supabase/tests/order_id_del_ledger_test.sql

create or replace function pg_temp.probar_order_id_del_ledger()
returns table(caso text, esperado text, resultado text, ok boolean)
language plpgsql as $$
declare
  v_cliente   text := '_test_order_id_' || substr(md5(random()::text), 1, 8);
  v_orden     text;
  v_version   bigint;
  v_tipo      text;
  v_con_orden bigint;
  v_cruce     bigint;
begin
  -- Un id con la forma real de tekila-rg, no un UUID.
  v_orden := 'tk-' || v_cliente || '-260909-1';

  -- ── Caso 1: el tipo de la columna ──────────────────────────────────────────
  select data_type into v_tipo
  from information_schema.columns
  where table_schema = 'public'
    and table_name   = 'pos_inventory_movements'
    and column_name  = 'order_id';

  caso := 'order_id admite ids que no son UUID';
  esperado := 'text';
  resultado := coalesce(v_tipo, '(la columna no existe)');
  ok := (v_tipo = 'text');
  return next;

  -- Si la columna volvió a uuid, lo demás no puede correr: el INSERT tronaría con
  -- `invalid input syntax for type uuid` y la prueba se vería como un error de
  -- infraestructura en vez de como la regresión que es.
  if v_tipo is distinct from 'text' then
    caso := 'los casos siguientes';
    esperado := 'corren';
    resultado := 'omitidos porque order_id ya no es text';
    ok := false;
    return next;
    return;
  end if;

  -- ── Siembra ────────────────────────────────────────────────────────────────
  insert into pos_orders (id, client_id, items)
  values (v_orden, v_cliente, '[{"nombre":"Prueba","cantidad":2}]'::jsonb);

  insert into pos_inventory (client_id, ingredient_id, stock, stock_unit)
  values (v_cliente, 'ing_prueba', 1000, 'g');

  insert into pos_recipe_versions (client_id, menu_item_id, active)
  values (v_cliente, 'ITEM_PRUEBA', true)
  returning id into v_version;

  insert into pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
  values (v_cliente, v_version, 'ing_prueba', 100, 'g');

  insert into pos_item_inventory_policy (client_id, menu_item_id, inventory_mode)
  values (v_cliente, 'ITEM_PRUEBA', 'recipe');

  -- ── Caso 2: el descuento escribe la orden ──────────────────────────────────
  perform r1_reconcile_item(v_cliente, v_orden, 'item-1', 'ITEM_PRUEBA', 2, 'r1');

  select count(*) into v_con_orden
  from pos_inventory_movements
  where client_id = v_cliente
    and movement_type = 'recipe_deduction'
    and order_id = v_orden;

  caso := 'el descuento por receta guarda su orden';
  esperado := '1 movimiento con order_id';
  resultado := v_con_orden || ' movimientos con order_id';
  ok := (v_con_orden = 1);
  return next;

  -- ── Caso 3: el cruce contra pos_orders deja de dar cero ────────────────────
  -- Ésta es la propiedad que pedía el detector de merma: poder decir "de estas
  -- órdenes", no sólo "faltan 18 huevos".
  select count(*) into v_cruce
  from pos_orders o
  join pos_inventory_movements m
    on m.order_id = o.id and m.client_id = o.client_id
  where o.client_id = v_cliente;

  caso := 'el join pos_orders <-> pos_inventory_movements encuentra la orden';
  esperado := 'al menos 1 fila';
  resultado := v_cruce || ' filas';
  ok := (v_cruce >= 1);
  return next;

  -- ── Limpieza ───────────────────────────────────────────────────────────────
  -- El orden importa: los movimientos referencian la reconciliación por FK.
  delete from pos_inventory_movements     where client_id = v_cliente;
  delete from pos_reconciliation_results  where client_id = v_cliente;
  delete from pos_item_inventory_policy   where client_id = v_cliente;
  delete from pos_recipe_lines            where client_id = v_cliente;
  delete from pos_recipe_versions         where client_id = v_cliente;
  delete from pos_inventory               where client_id = v_cliente;
  delete from pos_orders                  where client_id = v_cliente;
end;
$$;

select * from pg_temp.probar_order_id_del_ledger();
