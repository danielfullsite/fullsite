-- BUG-019 · Full-stack LOCAL isolation assertions (tras aplicar la migración real)
-- Cada bloque corre bajo un rol/claim distinto y emite check_name/pass.
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'

\echo '===== TENANT A (amalay) authenticated ====='
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111111')::text, false);
select 'A-orders-own'   as check_name, count(*) as n, count(*)=2 as pass from pos_orders;                 -- solo amalay (2)
select 'A-orders-cross' as check_name, count(*) as n, count(*)=0 as pass from pos_orders where client_id<>'amalay';
select 'A-cats-own'     as check_name, count(*) as n, count(*)=1 as pass from pos_menu_categories;
select 'A-staff-own'    as check_name, count(*) as n, count(*)=1 as pass from pos_staff;
select 'A-child-own'    as check_name, count(*) as n, count(*)=1 as pass from pos_purchase_order_items; -- solo el item bajo padre amalay
select 'A-wansoft-read' as check_name, count(*) as n, count(*)=1 as pass from wansoft_daily;             -- legacy: authenticated read-only
select 'A-audit-own'    as check_name, count(*) as n, count(*)=1 as pass from pos_audit_log;            -- solo amalay
-- audit inmutable: UPDATE debe FALLAR (revocado)
do $$ begin
  begin update pos_audit_log set actor='tamper' where client_id='amalay';
    raise exception 'A-audit-immutable FAIL: se permitió UPDATE del audit';
  exception when insufficient_privilege then raise notice 'A-audit-immutable PASS (update denegado)';
  end;
end $$;
-- INSERT cross-tenant debe FALLAR (with check)
do $$ begin
  begin insert into pos_orders(client_id,total,mesero) values('nomada',999,'intruso');
    raise exception 'A-insert-cross FAIL: se permitió insertar en nomada';
  exception when insufficient_privilege or check_violation then raise notice 'A-insert-cross PASS (rechazado)';
  end;
end $$;
-- INSERT hija bajo padre de OTRO tenant debe FALLAR
do $$ begin
  begin insert into pos_purchase_order_items(order_id,ingrediente,cantidad) values(2,'robo',1); -- order_id=2 es de nomada
    raise exception 'A-child-insert-cross FAIL: se permitió insertar hija bajo padre nomada';
  exception when insufficient_privilege or check_violation then raise notice 'A-child-insert-cross PASS (rechazado)';
  end;
end $$;
reset role;

\echo '===== TENANT B (nomada) authenticated ====='
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','22222222-2222-2222-2222-222222222222')::text, false);
select 'B-orders-own'   as check_name, count(*) as n, count(*)=2 as pass from pos_orders;
select 'B-orders-cross' as check_name, count(*) as n, count(*)=0 as pass from pos_orders where client_id<>'nomada';
select 'B-child-own'    as check_name, count(*) as n, count(*)=1 as pass from pos_purchase_order_items;
reset role;

\echo '===== ANON (sin sesión) ====='
set role anon;
select set_config('request.jwt.claims', '', false);
-- anon fue revocado; SELECT debe fallar por permisos. Capturamos.
do $$ begin
  begin perform 1 from pos_orders limit 1;
    raise exception 'ANON-orders FAIL: anon pudo leer pos_orders';
  exception when insufficient_privilege then raise notice 'ANON-orders PASS (permission denied)';
  end;
end $$;
reset role;

\echo '===== SERVICE_ROLE (backend) ====='
set role service_role;
select 'SVC-sees-all' as check_name, count(*) as n, count(*)=4 as pass from pos_orders;  -- ve los 4 (2A+2B)
reset role;
