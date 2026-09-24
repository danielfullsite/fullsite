-- Esquema MÍNIMO que reproduce el estado de producción medido por catálogo el 2026-09-24
-- (output/fullsite-phase0-external-reads-20260924/APPENDIX-QB3-STRUCTURAL-EVIDENCE.md).
-- Sólo para un Postgres DESECHABLE. Datos 100% sintéticos (01_datos_sinteticos.sql).
--
-- Fuentes de cada bloque:
--   pos_staff DDL ............ baseline_esquema.sql:4014-4026 (+ unique_pin_per_client :5998)
--   pos_staff_audit .......... baseline_esquema.sql:4032-4057
--   políticas pos_staff ...... catálogo prod A-4 (= baseline :8083-8102)
--   client_users RLS ......... catálogo prod A-7 (= baseline :6866, :8237, :7719)
--   user_has_client_access ... baseline_esquema.sql:117-131 (huella prod = 7d8bd0f0…)
--   ACL anon/authenticated ... catálogo prod A-3 (sin MAINTAIN: el desechable es PG16)

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant anon, authenticated, service_role to postgres;

create schema auth;
create schema private;
grant usage on schema public, auth, private to anon, authenticated, service_role;

-- auth.uid() como en Supabase: lee el claim `sub` de la sesión
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Privilegios por defecto de Supabase (baseline:10406-10409): toda tabla nueva de postgres
-- nace con ALL para anon y authenticated. Se replican ANTES de crear las tablas.
alter default privileges for role postgres in schema public grant all on tables to anon;
alter default privileges for role postgres in schema public grant all on tables to authenticated;
alter default privileges for role postgres in schema public grant all on tables to service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;

-- ── client_users ───────────────────────────────────────────────────────────────────────
create table public.client_users (
  id uuid default gen_random_uuid() not null primary key,
  user_id uuid,
  client_id text,
  role text default 'viewer',
  created_at timestamptz default now()
);
alter table public.client_users enable row level security;
revoke all on table public.client_users from anon;          -- prod: anon sin privilegios
-- authenticated conserva ALL (default privileges), pero sólo hay política de SELECT
create policy svc_client_users on public.client_users to service_role using (true) with check (true);

-- ── función de acceso (baseline, sin caducidad de act-as) ─────────────────────────────
create or replace function private.user_has_client_access(target_client_id text)
  returns boolean
  language sql stable security definer
  set search_path to 'public', 'private'
as $$
  select case
    when auth.uid() is null                 then false
    when target_client_id is null           then false
    when target_client_id = ''              then false
    else exists (
      select 1 from public.client_users cu
      where cu.user_id = auth.uid() and cu.client_id = target_client_id
    )
  end;
$$;
revoke all on function private.user_has_client_access(text) from public;
grant all on function private.user_has_client_access(text) to authenticated;

create policy authread_client_users on public.client_users for select to authenticated
  using (private.user_has_client_access(client_id));

-- ── pos_staff ──────────────────────────────────────────────────────────────────────────
create table public.pos_staff (
  id text default (gen_random_uuid())::text not null primary key,
  client_id text,
  name text not null,
  pin text not null,
  role text default 'mesero' not null,
  active boolean default true,
  created_at timestamptz default now(),
  hourly_rate numeric default 0,
  weekly_salary numeric default 0,
  role_display text default 'mesero',
  constraint pos_staff_pin_len_chk check (pin ~ '^[0-9]{4,10}$'),
  constraint unique_pin_per_client unique (pin, client_id)
);
alter table public.pos_staff enable row level security;

-- ACL de producción (A-3): anon = SELECT,TRUNCATE,TRIGGER,REFERENCES; authenticated = ALL
revoke all on table public.pos_staff from anon, authenticated;
grant select, references, trigger, truncate on table public.pos_staff to anon;
grant all on table public.pos_staff to authenticated;

create policy pos_staff_del on public.pos_staff for delete to authenticated
  using (private.user_has_client_access(client_id));
create policy pos_staff_ins on public.pos_staff for insert to authenticated
  with check (private.user_has_client_access(client_id));
create policy pos_staff_sel on public.pos_staff for select to authenticated
  using (private.user_has_client_access(client_id));
create policy pos_staff_svc on public.pos_staff to service_role using (true) with check (true);
create policy pos_staff_upd on public.pos_staff for update to authenticated
  using (private.user_has_client_access(client_id))
  with check (private.user_has_client_access(client_id));

-- ── pos_staff_audit ────────────────────────────────────────────────────────────────────
create table public.pos_staff_audit (
  id bigserial primary key,
  client_id text,
  staff_id text not null,
  action text not null,
  changed_fields jsonb,
  changed_by text not null,
  created_at timestamptz default now()
);
alter table public.pos_staff_audit enable row level security;
revoke all on table public.pos_staff_audit from anon;
grant references, trigger, truncate on table public.pos_staff_audit to anon;
create policy authread_pos_staff_audit on public.pos_staff_audit for select to authenticated
  using (private.user_has_client_access(client_id));
create policy svc_pos_staff_audit on public.pos_staff_audit to service_role using (true) with check (true);

-- ── agent_runs mínima (la migración de PR5 le agrega client_id e índice) ──────────────────
create table public.agent_runs (id bigint primary key, agent_id text, created_at timestamptz default now());

-- ── otra tabla de negocio para probar TRUNCATE fuera de pos_staff ───────────────────────
create table public.ventas_sinteticas (id serial primary key, client_id text, total numeric);
alter table public.ventas_sinteticas enable row level security;
create policy ventas_sel on public.ventas_sinteticas for select to authenticated
  using (private.user_has_client_access(client_id));
