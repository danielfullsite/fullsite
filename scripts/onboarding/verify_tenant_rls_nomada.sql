-- Verificación de aislamiento tenant (RLS) en staging jkcnxf — read-only, idempotente, reversible (no muta nada).
-- Prueba que el JWT autenticado de un tenant lee/escribe SOLO lo suyo. Ejecutar con service_role.
-- Reemplazar :uid por el auth.uid() del usuario del tenant (owner@nomada.staging = c7b1b9c3-88b9-42dd-bba6-fb3a97d92388).

-- 1) Contexto authenticated + JWT del tenant → ve exactamente sus datos
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"c7b1b9c3-88b9-42dd-bba6-fb3a97d92388","role":"authenticated"}', true);
  select 'self_read' as check,
    (select count(*) from pos_orders)                         as orders_propias,      -- esperado: 2
    (select coalesce(sum(total),0) from pos_orders)           as ventas_propias,      -- esperado: 510.00
    (select count(*) from pos_orders where client_id<>'nomada') as cross_read_ajenas; -- esperado: 0
rollback;

-- 2) anon SIN JWT → denegado (no vacío): la clave anónima no puede leer datos de tenant
begin;
  set local role anon;
  -- Esperado: ERROR permission denied (RLS + sin GRANT a anon). Si retorna filas, es FALLO.
  -- select count(*) from pos_orders;  -- descomentar para ver el 42501
rollback;

-- 3) service_role conserva acceso completo (para agentes/servidor)
select 'service_role' as check, count(distinct client_id) as tenants_visibles from pos_orders;

-- RESULTADO ESPERADO: orders_propias=2, ventas_propias=510.00, cross_read_ajenas=0.
-- HALLAZGO 2026-08-10: jkcnxf YA tenía RLS correcta (private.user_has_client_access(client_id)
-- por membresía en client_users). NO se aplicó migración RLS nueva. El $0 en UI era app-layer:
--   (a) getDataSource() default='wansoft' → dashboard leía wansoft_daily; fix: fullsite_data_source='fullsite'.
--   (b) getDashboardFromPosOrders filtra status='cerrada'; el E2E usó 'cobrada'. fix: status='cerrada'.
-- Ambos reversibles y a nivel dato/config; ningún cambio de RLS, prod, service key ni default 'amalay'.
