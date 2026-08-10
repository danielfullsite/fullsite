-- BUG-019 · Esquema representativo para el STACK LOCAL OFICIAL (Auth/JWT/PostgREST reales).
-- NO crea roles ni auth.uid()/auth.jwt() (ya existen en Supabase). client_users se
-- siembra aparte con los UUIDs de los usuarios reales de GoTrue. Datos sintéticos.
-- clients + client_users PRIMERO (la función SQL los referencia en su cuerpo).
create table public.clients (id text primary key, display_name text, iva_rate numeric default 0.16);
create table public.client_users (user_id uuid, client_id text, role text, primary key (user_id, client_id));

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create or replace function private.user_has_client_access(target_client_id text)
returns boolean language sql stable security definer set search_path=public, private as $$
  select case
    when auth.uid() is null then false
    when target_client_id is null or target_client_id = '' then false
    else exists (select 1 from public.client_users cu
                 where cu.user_id = auth.uid() and cu.client_id = target_client_id)
  end;
$$;
revoke all on function private.user_has_client_access(text) from public, anon;
grant execute on function private.user_has_client_access(text) to authenticated;

create table public.pos_orders (
  id text primary key default gen_random_uuid()::text, client_id text not null,
  status text not null default 'abierta', turno_id text, total numeric, mesero text);
create table public.pos_turnos (
  id text primary key, client_id text not null, opened_by text not null,
  opened_at timestamptz default now(), closed_at timestamptz, closed_by text,
  fondo_inicial numeric default 0 not null);
create table public.pos_menu_categories (id text primary key, client_id text not null, name text);
create table public.pos_staff (id text primary key, client_id text not null, name text, pin text);
create table public.pos_audit_log (id bigserial primary key, client_id text not null, action text, actor text, created_at timestamptz default now());
create table public.wansoft_daily (fecha date primary key, ventas_dia numeric);
create table public.pos_purchase_orders (id bigserial primary key, client_id text not null, folio text);
create table public.pos_purchase_order_items (id bigserial primary key, order_id bigint not null, ingrediente text, cantidad numeric);

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

insert into public.clients values ('amalay','AMALAY',0.16),('nomada','Café Nómada',0.16);
insert into public.pos_turnos (id,client_id,opened_by) values ('t-amalay','amalay','amalay-s1'),('t-nomada','nomada','nomada-s1');
insert into public.pos_orders (id,client_id,status,turno_id,total,mesero) values
  ('o-amalay-1','amalay','enviada','t-amalay',185,'Omar'),
  ('o-amalay-2','amalay','enviada','t-amalay',240,'Hector'),
  ('o-nomada-1','nomada','enviada','t-nomada',95,'Ana'),
  ('o-nomada-2','nomada','enviada','t-nomada',120,'Carlos');
insert into public.pos_menu_categories values ('amalay-des','amalay','Desayunos'),('nomada-caf','nomada','Cafés');
insert into public.pos_staff values ('amalay-s1','amalay','Omar','1234'),('nomada-s1','nomada','Ana','5678');
insert into public.pos_audit_log (client_id,action,actor) values ('amalay','order_sent','Omar'),('nomada','order_sent','Ana');
insert into public.wansoft_daily values ('2026-08-09',39504.5);
insert into public.pos_purchase_orders (client_id,folio) values ('amalay','OC-A1'),('nomada','OC-N1');
insert into public.pos_purchase_order_items (order_id,ingrediente,cantidad) values (1,'Aguacate',10),(2,'Café',5);

-- Baseline Supabase: service_role tiene grants amplios sobre public (default privileges de
-- Supabase). Al crear tablas vía psql directo hay que reproducirlo — la migración §1 lo asume
-- (solo crea la policy _svc, no el grant). service_role ya tiene BYPASSRLS en Supabase.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
