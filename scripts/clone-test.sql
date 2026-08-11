-- ============================================================================
-- CLONE-TEST — el seguro de la clonabilidad de Fullsite
-- ============================================================================
-- Verifica que un tenant NUEVO (sin datos) no rompe nada: cada vista canónica
-- OCM responde vacío-limpio (0 filas, sin error) y la capa de health es legible.
-- Si algo rompe la clonabilidad, RAISE EXCEPTION (falla el pipeline).
--
-- Uso: correr contra staging (o cualquier BD con las vistas OCM) en CI antes de
-- desplegar. Verde = un cliente nuevo (Cliente #2, etc.) arranca sin sorpresas.
--   psql "$DATABASE_URL" -f scripts/clone-test.sql
-- ============================================================================
do $$
declare
  v text; c bigint;
  test_id text := 'clonetest_ci';
  views text[] := array[
    'ocm_daily','ocm_orders','ocm_shifts','ocm_cash','ocm_customers',
    'ocm_suppliers','ocm_order_consumption','ocm_service_kitchen','ocm_customer_journey'
  ];
begin
  -- 1. Alta de un tenant nuevo desde cero (como haría el onboarding)
  insert into public.clients (id, display_name, data_source)
  values (test_id, 'Clone Test CI', 'fullsite')
  on conflict (id) do nothing;

  -- 2. Cada vista OCM debe existir y responder vacío-limpio para el tenant nuevo
  foreach v in array views loop
    begin
      execute format('select count(*) from public.%I where client_id = $1', v)
        into c using test_id;
    exception when others then
      raise exception 'CLONE-TEST FAIL: vista % no consultable (%). Rompe la clonabilidad.', v, sqlerrm;
    end;
    if c <> 0 then
      raise exception 'CLONE-TEST FAIL: % devolvió % filas para tenant nuevo (esperado 0 / empty-clean).', v, c;
    end if;
  end loop;

  -- 3. Health: la capa canónica de rollup es legible (sin acoplar a wansoft_daily)
  begin
    perform 1 from public.ops_daily limit 1;
  exception when others then
    raise exception 'CLONE-TEST FAIL: ops_daily no legible (%). Health rompería para tenant nuevo.', sqlerrm;
  end;

  -- 4. Teardown del tenant de prueba
  delete from public.client_users where client_id = test_id;
  delete from public.clients where id = test_id;

  raise notice 'CLONE-TEST PASS — % vistas OCM empty-clean para tenant nuevo + health OK. Clonable.', array_length(views,1);
end $$;
