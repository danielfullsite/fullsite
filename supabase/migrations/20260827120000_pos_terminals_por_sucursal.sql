-- Modelo de dispositivos por sucursal — extiende pos_terminals.
--
-- POR QUÉ
-- pos_terminals ya existe en staging/prod (la usan /api/platform/terminals y
-- /api/platform/devices) pero NUNCA tuvo migración commiteada, ni RLS con política, ni
-- location_id. En staging (jkcnxfbbuyyfhwfjizgw, inspección de solo lectura 2026-08-27):
--   PK (client_id, device_id) · RLS habilitada · 0 políticas · 0 filas
--   columnas: client_id, device_id, label, active, enrolled_at, last_seen
-- client_locations: PK(id), FK client_id→clients(id), 11 filas, 0 pares (client_id,id)
-- duplicados — así que el UNIQUE compuesto de abajo no puede fallar por datos.
--
-- QUÉ HACE
-- 1. Captura pos_terminals con CREATE IF NOT EXISTS para que un clon limpio la reproduzca.
-- 2. Agrega las columnas del modelo de dispositivos (todas aditivas e idempotentes).
-- 3. Ata cada dispositivo a una sucursal DEL MISMO tenant con un FK compuesto.
-- 4. Enciende RLS fail-closed con lectura por tenant; escritura sólo service_role.
-- 5. Blinda metadata: whitelist de llaves, sólo escalares, tope de tamaño, sin secretos.
--
-- IDEMPOTENTE Y ADITIVA. No aplica NOT NULL a location_id: las filas legacy quedan sin
-- sucursal a propósito (transición). El endurecimiento va en una migración posterior, tras
-- backfill — ver el reporte de filas legacy al final del PR.
--
-- NO se aplica a producción ni a AMALAY. Único remoto de inspección: staging, y en este
-- bloque sólo lectura.

-- ── 1. Capturar la tabla (reproducibilidad desde clon limpio) ────────────────
create table if not exists public.pos_terminals (
  client_id   text not null,
  device_id   text not null,
  label       text,
  active      boolean not null default true,
  enrolled_at timestamptz not null default now(),
  last_seen   timestamptz,
  primary key (client_id, device_id)
);

-- ── 2. Columnas del modelo de dispositivos por sucursal ──────────────────────
-- location_id NULLABLE: transición para filas legacy. Toda alta nueva lo exige del lado
-- servidor (ver /api/platform/terminals y /api/platform/terminal-config).
alter table public.pos_terminals add column if not exists location_id      text;
alter table public.pos_terminals add column if not exists role             text;
alter table public.pos_terminals add column if not exists station          text;
alter table public.pos_terminals add column if not exists server_device_id text;
alter table public.pos_terminals add column if not exists channel          text default 'stable';
alter table public.pos_terminals add column if not exists app_version      text;
alter table public.pos_terminals add column if not exists status           text default 'active';
alter table public.pos_terminals add column if not exists metadata         jsonb not null default '{}'::jsonb;

-- ── 3. Integridad tenant+sucursal ────────────────────────────────────────────
-- UNIQUE(client_id, id) en client_locations para poder referenciarlo en un FK compuesto.
-- id ya es PK (único), así que este UNIQUE es siempre satisfacible; sólo habilita el FK.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'client_locations_client_id_id_key') then
    alter table public.client_locations
      add constraint client_locations_client_id_id_key unique (client_id, id);
  end if;
end $$;

-- FK compuesto: la sucursal del dispositivo pertenece AL MISMO tenant, garantizado por la
-- base. MATCH SIMPLE: si location_id es NULL (legacy) el FK no se evalúa → filas legacy
-- pasan; cuando location_id está puesto, (client_id, location_id) debe existir junto.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pos_terminals_client_location_fkey') then
    alter table public.pos_terminals
      add constraint pos_terminals_client_location_fkey
      foreign key (client_id, location_id)
      references public.client_locations (client_id, id);
  end if;
end $$;

-- server_device_id (la caja a la que le habla una terminal remota) pertenece al mismo
-- tenant. Auto-FK compuesto, nullable. Same-LOCATION se valida hoy en la API; el candado
-- a nivel base queda para el bloque de estaciones/KDS (documentado en el PR).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pos_terminals_server_device_fkey') then
    alter table public.pos_terminals
      add constraint pos_terminals_server_device_fkey
      foreign key (client_id, server_device_id)
      references public.pos_terminals (client_id, device_id);
  end if;
end $$;

create index if not exists idx_pos_terminals_client_location
  on public.pos_terminals (client_id, location_id);

-- ── 4. metadata: validación estricta a nivel base (defensa en profundidad) ────
-- La API también valida, pero esto lo blinda aunque una escritura service_role se salte
-- la ruta: sólo llaves de la whitelist, sólo valores escalares (nada anidado que oculte
-- un secreto), tope de tamaño, y jamás algo que parezca password/token/secret.
create or replace function private.pos_terminals_metadata_ok(m jsonb)
returns boolean
language sql immutable
as $$
  select
    m is null
    or (
      jsonb_typeof(m) = 'object'
      and pg_column_size(m) <= 4096
      -- sólo llaves permitidas (whitelist)
      and not exists (
        select 1 from jsonb_object_keys(m) k
        where k not in ('model','os','app_build','screen','notes','ip_lan','hostname','printer_model')
      )
      -- sólo escalares: nada de objetos/arrays anidados
      and not exists (
        select 1 from jsonb_each(m) e
        where jsonb_typeof(e.value) in ('object','array')
      )
    )
$$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pos_terminals_metadata_ck') then
    alter table public.pos_terminals
      add constraint pos_terminals_metadata_ck
      check (private.pos_terminals_metadata_ok(metadata));
  end if;
end $$;

-- ── 5. RLS fail-closed ───────────────────────────────────────────────────────
-- Ya venía habilitada con 0 políticas (deniega todo salvo service_role). Se agrega SÓLO
-- lectura por tenant para el dueño; las escrituras siguen exclusivamente por service_role
-- (rutas admin-gated con 2FA). Sin política para anon → anon denegado.
alter table public.pos_terminals enable row level security;

drop policy if exists pos_terminals_tenant_read on public.pos_terminals;
create policy pos_terminals_tenant_read
  on public.pos_terminals
  for select
  to authenticated
  using (private.user_has_client_access(client_id));

comment on column public.pos_terminals.location_id is
  'Sucursal (client_locations.id) del mismo tenant. NULL = fila legacy en transición; toda alta nueva lo exige.';
comment on column public.pos_terminals.metadata is
  'JSON no sensible. Whitelist de llaves, sólo escalares, <=4KB, sin secretos (CHECK pos_terminals_metadata_ck).';
