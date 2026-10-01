-- ocm_daily: acceso efectivo por rol y aislamiento entre tenants — prueba repetible.
--
-- Requiere roles y RLS REALES: corre en PostgreSQL aislado con
-- supabase/tests/aislado/00_estructura_representativa.sql + la migración PENDIENTE_20261001...,
-- como superusuario. Cada lectura cambia de rol con SET LOCAL ROLE y simula el JWT con
-- request.jwt.claims (lo que lee auth.uid()). Termina en ROLLBACK.
--
-- Responde, con evidencia ejecutada:
--   * un tenant no puede leer a otro por la vista (rama live ni rama histórica);
--   * anon no ve datos: sin SELECT en la vista ni en ops_daily; en pos_orders tiene SELECT de
--     tabla pero RLS sin política le devuelve 0 filas;
--   * fullsite_readonly / fullsite_agent tienen SELECT de tabla y SIN política: ven 0 filas
--     (hallazgo a revisar: si se esperaba que leyeran datos, hoy no leen nada);
--   * security_invoker: la vista no ve más que la tabla para el mismo rol;
--   * función fs_desglose_pago: pura, no SECURITY DEFINER, ejecutable sólo por los roles que
--     ya leen la vista (anon revocado);
--   * las concesiones de escritura de anon/authenticated sobre la vista no permiten escribir
--     (la vista no es actualizable) y no cambian con la migración.

BEGIN;

INSERT INTO public.pos_orders (id, client_id, status, turno_id, total, subtotal, iva, propina, metodo_pago, pagos, mesa, personas, created_at)
VALUES ('acc-a1','tst-acc-a','cerrada','t',100,100,0,0,'Efectivo','[{"metodo":"Efectivo","monto":100}]',1,1,timestamptz '2026-09-30 12:00:00-06'),
       ('acc-b1','tst-acc-b','cerrada','t',200,200,0,0,'Tarjeta','[{"metodo":"Tarjeta","monto":200}]',1,1,timestamptz '2026-09-30 12:00:00-06');
INSERT INTO public.ops_daily (client_id, fecha, record_type, source_system, ventas_dia, efectivo, tarjeta, tickets_count, generated_at)
VALUES ('tst-acc-a', date '2026-01-10', 'cierre', 'wansoft', 1000, 600, 400, 10, now()),
       ('tst-acc-b', date '2026-01-10', 'cierre', 'wansoft', 5000, 3000, 2000, 50, now());
INSERT INTO public.client_users (user_id, client_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000a1','tst-acc-a','owner'),
  ('00000000-0000-0000-0000-0000000000b2','tst-acc-b','owner');

-- Lee con un rol y un JWT; devuelve 'filas:<n>' o 'DENEGADO:<sqlstate>' (siempre restaura el rol)
CREATE OR REPLACE FUNCTION pg_temp.leer(p_rol text, p_sub text, p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM set_config('request.jwt.claims', CASE WHEN p_sub IS NULL THEN '' ELSE json_build_object('sub', p_sub, 'role', p_rol)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
  BEGIN
    EXECUTE p_sql INTO n;
    RESET ROLE;
    RETURN 'filas:' || coalesce(n::text, 'ok');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RETURN 'DENEGADO:' || SQLSTATE;
  END;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.probar() RETURNS TABLE(caso text, esperado text, resultado text, ok boolean)
LANGUAGE plpgsql AS $$
DECLARE
  ua constant text := '00000000-0000-0000-0000-0000000000a1';
  ub constant text := '00000000-0000-0000-0000-0000000000b2';
  uz constant text := '00000000-0000-0000-0000-0000000000c3';  -- sin mapping
  r text;
  q_todo  constant text := $q$SELECT count(*) FROM public.ocm_daily WHERE client_id LIKE 'tst-acc-%'$q$;
  q_a     constant text := $q$SELECT count(*) FROM public.ocm_daily WHERE client_id = 'tst-acc-a'$q$;
  q_b     constant text := $q$SELECT count(*) FROM public.ocm_daily WHERE client_id = 'tst-acc-b'$q$;
  q_a_live constant text := $q$SELECT count(*) FROM public.ocm_daily WHERE client_id = 'tst-acc-a' AND source_system = 'fullsite'$q$;
  q_b_hist constant text := $q$SELECT count(*) FROM public.ocm_daily WHERE client_id = 'tst-acc-b' AND source_system = 'wansoft'$q$;
  q_tab   constant text := $q$SELECT count(*) FROM public.pos_orders WHERE client_id LIKE 'tst-acc-%'$q$;
  q_ops   constant text := $q$SELECT count(*) FROM public.ops_daily WHERE client_id LIKE 'tst-acc-%'$q$;
  q_fn    constant text := $q$SELECT count(*) FROM public.fs_desglose_pago(100,0,'[]'::jsonb,'Efectivo')$q$;
BEGIN
  -- Aislamiento authenticated
  r := pg_temp.leer('authenticated', ua, q_todo); RETURN QUERY SELECT 'authenticated A: ve sólo lo de A (live + histórico)', 'filas:2', r, r='filas:2';
  r := pg_temp.leer('authenticated', ua, q_b);    RETURN QUERY SELECT 'authenticated A: no ve nada de B por la vista', 'filas:0', r, r='filas:0';
  r := pg_temp.leer('authenticated', ub, q_todo); RETURN QUERY SELECT 'authenticated B: ve sólo lo de B (live + histórico)', 'filas:2', r, r='filas:2';
  r := pg_temp.leer('authenticated', ub, q_a);    RETURN QUERY SELECT 'authenticated B: no ve nada de A por la vista', 'filas:0', r, r='filas:0';
  r := pg_temp.leer('authenticated', uz, q_todo); RETURN QUERY SELECT 'authenticated sin mapping: 0 filas', 'filas:0', r, r='filas:0';
  r := pg_temp.leer('authenticated', NULL, q_todo); RETURN QUERY SELECT 'authenticated sin JWT (sub nulo): 0 filas', 'filas:0', r, r='filas:0';
  r := pg_temp.leer('authenticated', ua, q_b_hist); RETURN QUERY SELECT 'authenticated A: no ve el histórico (ops_daily) de B', 'filas:0', r, r='filas:0';
  r := pg_temp.leer('authenticated', ua, q_a_live); RETURN QUERY SELECT 'authenticated A: sí ve su rama live', 'filas:1', r, r='filas:1';
  r := pg_temp.leer('authenticated', ua, q_tab);  RETURN QUERY SELECT 'security_invoker: la tabla muestra a A sólo su orden (1), la vista no amplía', 'filas:1', r, r='filas:1';
  -- anon
  r := pg_temp.leer('anon', NULL, q_todo); RETURN QUERY SELECT 'anon: sin SELECT en ocm_daily', 'DENEGADO:42501', r, r='DENEGADO:42501';
  r := pg_temp.leer('anon', NULL, q_ops);  RETURN QUERY SELECT 'anon: sin SELECT en ops_daily', 'DENEGADO:42501', r, r='DENEGADO:42501';
  r := pg_temp.leer('anon', NULL, q_tab);  RETURN QUERY SELECT 'anon: SELECT de tabla en pos_orders pero RLS sin política = 0 filas', 'filas:0', r, r='filas:0';
  r := pg_temp.leer('anon', ua, q_tab);    RETURN QUERY SELECT 'anon con claims de A: sigue sin filas (el claim no cambia el rol)', 'filas:0', r, r='filas:0';
  r := pg_temp.leer('anon', NULL, q_fn);   RETURN QUERY SELECT 'anon: sin EXECUTE en fs_desglose_pago', 'DENEGADO:42501', r, r='DENEGADO:42501';
  r := pg_temp.leer('anon', NULL, $q$INSERT INTO public.ocm_daily (client_id) VALUES ('tst-acc-a')$q$);
  RETURN QUERY SELECT 'anon: INSERT en la vista falla (vista no actualizable)', 'DENEGADO', substr(r,1,8), substr(r,1,8)='DENEGADO';
  r := pg_temp.leer('authenticated', ua, $q$DELETE FROM public.ocm_daily WHERE client_id='tst-acc-a'$q$);
  RETURN QUERY SELECT 'authenticated: DELETE en la vista falla (vista no actualizable)', 'DENEGADO', substr(r,1,8), substr(r,1,8)='DENEGADO';
  -- roles de lectura sin política
  r := pg_temp.leer('fullsite_readonly', NULL, q_todo); RETURN QUERY SELECT 'fullsite_readonly: SELECT permitido, RLS sin política = 0 filas', 'filas:0', r, r='filas:0';
  r := pg_temp.leer('fullsite_agent', NULL, q_todo);    RETURN QUERY SELECT 'fullsite_agent: SELECT permitido, RLS sin política = 0 filas', 'filas:0', r, r='filas:0';
  r := pg_temp.leer('ia_lector', NULL, q_todo);         RETURN QUERY SELECT 'ia_lector: sin privilegio sobre ocm_daily', 'DENEGADO:42501', r, r='DENEGADO:42501';
  -- service_role
  r := pg_temp.leer('service_role', NULL, q_todo); RETURN QUERY SELECT 'service_role: ve ambos tenants (BYPASSRLS)', 'filas:4', r, r='filas:4';
  -- función ejecutable por quien lee la vista
  r := pg_temp.leer('authenticated', ua, q_fn);       RETURN QUERY SELECT 'authenticated: EXECUTE en fs_desglose_pago', 'filas:1', r, r='filas:1';
  r := pg_temp.leer('fullsite_readonly', NULL, q_fn); RETURN QUERY SELECT 'fullsite_readonly: EXECUTE en fs_desglose_pago', 'filas:1', r, r='filas:1';
  r := pg_temp.leer('service_role', NULL, q_fn);      RETURN QUERY SELECT 'service_role: EXECUTE en fs_desglose_pago', 'filas:1', r, r='filas:1';
  -- Atributos de la función y la vista
  RETURN QUERY SELECT 'fs_desglose_pago: no SECURITY DEFINER, IMMUTABLE, search_path fijo', 'f/i/pg_catalog, public',
    (SELECT p.prosecdef::text||'/'||p.provolatile::text||'/'||coalesce(p.proconfig::text,'∅')
       FROM pg_proc p WHERE p.oid='public.fs_desglose_pago(numeric,numeric,jsonb,text)'::regprocedure),
    (SELECT NOT p.prosecdef AND p.provolatile='i' AND p.proconfig::text LIKE '%search_path=pg_catalog, public%'
       FROM pg_proc p WHERE p.oid='public.fs_desglose_pago(numeric,numeric,jsonb,text)'::regprocedure);
  RETURN QUERY SELECT 'fs_desglose_pago: el cuerpo no nombra tablas', 'sin tablas',
    'comprobado', (SELECT p.prosrc !~* '(pos_orders|ops_daily|client_users|historico_)' FROM pg_proc p WHERE p.oid='public.fs_desglose_pago(numeric,numeric,jsonb,text)'::regprocedure);
  RETURN QUERY SELECT 'ocm_daily conserva security_invoker=on', 'security_invoker=on',
    (SELECT coalesce(array_to_string(reloptions, ','),'∅') FROM pg_class WHERE oid='public.ocm_daily'::regclass),
    (SELECT reloptions::text LIKE '%security_invoker=on%' FROM pg_class WHERE oid='public.ocm_daily'::regclass);
  RETURN QUERY SELECT 'ACL de ocm_daily como producción (anon sin SELECT, con escritura nominal)', 'ver relacl',
    (SELECT relacl::text FROM pg_class WHERE oid='public.ocm_daily'::regclass),
    (SELECT NOT has_table_privilege('anon','public.ocm_daily','SELECT')
        AND has_table_privilege('authenticated','public.ocm_daily','SELECT')
        AND has_table_privilege('service_role','public.ocm_daily','SELECT')
        AND has_table_privilege('fullsite_readonly','public.ocm_daily','SELECT')
        AND has_table_privilege('fullsite_agent','public.ocm_daily','SELECT')
        AND has_table_privilege('anon','public.ocm_daily','INSERT')
        AND NOT has_table_privilege('ia_lector','public.ocm_daily','SELECT'));
END $$;

CREATE TEMP TABLE _resultado AS SELECT * FROM pg_temp.probar();
SELECT * FROM _resultado;
SELECT 'RESUMEN'::text AS caso, 'todas las filas ok'::text AS esperado,
       count(*) FILTER (WHERE NOT ok)::text || ' fallos de ' || count(*)::text AS resultado,
       bool_and(ok) AS ok
  FROM _resultado;

ROLLBACK;
