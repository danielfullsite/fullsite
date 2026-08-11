-- ============================================================================
-- delivery_orders — RLS tenant-scoped (fix del gap de delivery en el KDS)
--
-- ESTADO: PROPUESTA — **NO APLICADA A PRODUCCIÓN**. Compartida entre sesiones.
--
-- Contexto (hallazgo confirmado en prod AMALAY 2026-08-11):
--   `delivery_orders` tiene RLS ON pero **0 políticas + sin grants** → deny-all.
--   La cocina (dashboard-app .../cocina) lee `delivery_orders` con la ANON key;
--   el catch se traga el error → la comanda de Uber/Rappi NUNCA aparece en el KDS,
--   en silencio. El webhook SÍ escribe (service_key salta RLS), pero nadie la lee.
--
-- ESTE ARCHIVO = espejo EXACTO del estado ya VALIDADO en staging (jkcnxfbb),
--   donde delivery_orders corre con estas 5 políticas y la app funciona.
--   NO inventa nada nuevo. NO copia el pos_orders inseguro (que hoy da SELECT a
--   anon = fuga entre tenants). El modelo correcto es authenticated + service_role.
--
-- Depende de: private.user_has_client_access(text) [BUG-019 base]. En prod YA existe.
--
-- ⚠️ COORDINACIÓN CON EL APP (imprescindible, igual que BUG-019):
--   Con estas políticas, `anon` queda denegado. La cocina lee delivery_orders con
--   la ANON key → NO verá delivery hasta que lea con **sesión authenticated** o por
--   un **endpoint server** (service_role, client_id resuelto en servidor).
--   Sin ese cambio de app, esta migración NO "prende" el delivery en el KDS —
--   solo deja la base correcta y segura para cuando el app cambie. Va en el mismo
--   tren que BUG-019, no como parche suelto.
-- ============================================================================

begin;

-- Guard: helper de BUG-019 debe existir.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'user_has_client_access'
  ) then
    raise exception 'Falta private.user_has_client_access() — aplicar BUG-019 base primero.';
  end if;
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'delivery_orders'
  ) then
    raise exception 'delivery_orders no existe en este entorno.';
  end if;
end $$;

-- RLS on (idempotente) + quitar acceso directo de la anon key.
alter table public.delivery_orders enable row level security;
revoke all on public.delivery_orders from anon;

-- Políticas espejo de staging (tenant-scoped por authenticated + service_role).
drop policy if exists delivery_orders_sel on public.delivery_orders;
create policy delivery_orders_sel on public.delivery_orders
  for select to authenticated
  using (private.user_has_client_access(client_id));

drop policy if exists delivery_orders_ins on public.delivery_orders;
create policy delivery_orders_ins on public.delivery_orders
  for insert to authenticated
  with check (private.user_has_client_access(client_id));

drop policy if exists delivery_orders_upd on public.delivery_orders;
create policy delivery_orders_upd on public.delivery_orders
  for update to authenticated
  using       (private.user_has_client_access(client_id))
  with check  (private.user_has_client_access(client_id));

drop policy if exists delivery_orders_del on public.delivery_orders;
create policy delivery_orders_del on public.delivery_orders
  for delete to authenticated
  using (private.user_has_client_access(client_id));

-- service_role (endpoints server) — acceso completo. El webhook ya usa service_key.
drop policy if exists delivery_orders_svc on public.delivery_orders;
create policy delivery_orders_svc on public.delivery_orders
  for all to service_role
  using (true) with check (true);

commit;

-- ============================================================================
-- VERIFICACIÓN post-aplicación (correr como SELECT):
--   select has_table_privilege('anon','public.delivery_orders','SELECT');  -- false
--   -- + probar que authenticated de un tenant SOLO ve sus delivery_orders.
--
-- SIGUIENTE (app): la cocina debe leer delivery_orders por endpoint server
--   (service_role + client_id server-side) o con sesión authenticated —
--   NO con la anon key. Es la mitad-app del fix (BUG-019 app coordination).
-- ============================================================================
