-- BUG-019 · Full-stack LOCAL isolation harness — bootstrap
-- Replica el entorno Supabase mínimo (roles + auth.uid + private.user_has_client_access)
-- y un esquema REPRESENTATIVO que ejercita las 3 formas de política de la migración real:
--   §1  tablas con client_id (pos_orders, pos_menu_categories, pos_staff)
--   §7a legacy sin client_id ni padre (wansoft_daily)
--   §7b hijas sin client_id vía padre (pos_purchase_order_items -> pos_purchase_orders)
-- + client_users/clients (caso especial). NADA propietario; datos sintéticos.

-- ── Roles Supabase ──
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

-- ── auth shim: auth.uid() lee el claim sub del JWT de sesión (patrón Supabase) ──
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb, '{}'::jsonb)
$$;

-- ── Esquema representativo (client_users PRIMERO: la función lo referencia) ──
create table public.clients (id text primary key, display_name text);
create table public.client_users (user_id uuid, client_id text, role text, primary key (user_id, client_id));

-- ── private schema + user_has_client_access (definición REAL de SKEL04-B0) ──
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create or replace function private.user_has_client_access(target_client_id text)
returns boolean language sql stable security definer set search_path=public, private as $$
  select case
    when auth.uid() is null then false
    when target_client_id is null then false
    when target_client_id = '' then false
    else exists (select 1 from public.client_users cu
                 where cu.user_id = auth.uid() and cu.client_id = target_client_id)
  end;
$$;
revoke all on function private.user_has_client_access(text) from public, anon;
grant execute on function private.user_has_client_access(text) to authenticated;

-- pos_orders con la forma REAL relevante a BUG-019-C: id text (namespace 'qr-'),
-- status, turno_id. La migración §1b añade el CHECK pos_orders_turno_id_check.
create table public.pos_orders (
  id text primary key default gen_random_uuid()::text,
  client_id text not null,
  status text not null default 'abierta',
  turno_id text,
  total numeric, mesero text
);
create table public.pos_menu_categories (id text primary key, client_id text not null, name text);
create table public.pos_staff (id text primary key, client_id text not null, name text, pin text);
-- pos_turnos: caja/turno por tenant (tiene client_id -> §1 la aísla automáticamente).
create table public.pos_turnos (
  id text primary key, client_id text not null, opened_by text not null,
  opened_at timestamptz default now(), closed_at timestamptz, closed_by text,
  fondo_inicial numeric default 0 not null
);

-- §1 + §2: audit log con client_id, inmutable (la migración le quita update/delete)
create table public.pos_audit_log (id bigserial primary key, client_id text not null, action text, actor text, created_at timestamptz default now());

-- §7a legacy sin client_id
create table public.wansoft_daily (fecha date primary key, ventas_dia numeric);

-- §7b padre/hija
create table public.pos_purchase_orders (id bigserial primary key, client_id text not null, folio text);
create table public.pos_purchase_order_items (id bigserial primary key, order_id bigint not null, ingrediente text, cantidad numeric);

-- RLS ON en todas (la migración también lo hace, pero lo dejamos explícito)
alter table public.clients enable row level security;
alter table public.client_users enable row level security;
alter table public.pos_orders enable row level security;
alter table public.pos_turnos enable row level security;
alter table public.pos_menu_categories enable row level security;
alter table public.pos_staff enable row level security;
alter table public.pos_audit_log enable row level security;
alter table public.wansoft_daily enable row level security;
alter table public.pos_purchase_orders enable row level security;
alter table public.pos_purchase_order_items enable row level security;

-- ── Seed: 2 tenants, 2 usuarios ──
insert into public.clients values ('amalay','AMALAY'),('nomada','Café Nómada');
insert into public.client_users values
  ('11111111-1111-1111-1111-111111111111','amalay','dueño'),
  ('22222222-2222-2222-2222-222222222222','nomada','dueño');
-- turnos abiertos (uno por tenant) — de aquí el server resuelve el turno de la sesión
insert into public.pos_turnos (id,client_id,opened_by) values
  ('t-amalay','amalay','amalay-s1'),('t-nomada','nomada','nomada-s1');
-- órdenes normales: id uuid, turno NOT NULL (el CHECK lo exige a las no-qr)
insert into public.pos_orders (id,client_id,status,turno_id,total,mesero) values
  ('o-amalay-1','amalay','enviada','t-amalay',185,'Omar'),
  ('o-amalay-2','amalay','enviada','t-amalay',240,'Hector'),
  ('o-nomada-1','nomada','enviada','t-nomada',95,'Ana'),
  ('o-nomada-2','nomada','enviada','t-nomada',120,'Carlos');
insert into public.pos_menu_categories values
  ('amalay-des','amalay','Desayunos'),('nomada-caf','nomada','Cafés');
insert into public.pos_staff values
  ('amalay-s1','amalay','Omar Aguilera','1234'),('nomada-s1','nomada','Ana García','5678');
insert into public.pos_audit_log (client_id,action,actor) values ('amalay','order_sent','Omar'),('nomada','order_sent','Ana');
insert into public.wansoft_daily values ('2026-08-09', 39504.5);
insert into public.pos_purchase_orders (client_id,folio) values ('amalay','OC-A1'),('nomada','OC-N1');
-- items: 1 bajo el padre amalay (id=1), 1 bajo el padre nomada (id=2)
insert into public.pos_purchase_order_items (order_id,ingrediente,cantidad) values
  (1,'Aguacate',10),(2,'Café en grano',5);

-- ── Baseline Supabase: service_role tiene BYPASSRLS + grants amplios ──
--    (la migración §1 asume esto; solo crea la policy _svc, no el grant de tabla).
alter role service_role bypassrls;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
