-- Estaciones por sucursal — catálogo que hace el routing consciente de la location.
--
-- POR QUÉ
-- El routing de comandas (lib/pos-constants.ts getStationForItem) es HOY tenant-level:
-- resuelve cocina/barra/caja por categoría y por override en clients.pos_settings, igual para
-- todas las sucursales del tenant. Un grupo con 5 marcas donde una tiene barra y otra no, o
-- que enruta postres distinto, no se puede expresar. Esta tabla declara QUÉ estaciones existen
-- en CADA sucursal y sus overrides por categoría.
--
-- LEGACY COMPAT: si una sucursal no tiene filas aquí, el resolver cae al default de sistema
-- (getStationForItem), idéntico a hoy. La feature flag factory.stations_per_location controla
-- si se consultan estos overrides. Apagada o sin datos → comportamiento actual, bit a bit.
--
-- Apilada sobre #195: usa client_locations(client_id, id) [UNIQUE agregado por la migración de
-- pos_terminals]. ADITIVA, IDEMPOTENTE. No aplicada a ningún remoto.

create table if not exists public.pos_location_stations (
  client_id          text not null,
  location_id        text not null,
  station            text not null,
  has_kds_screen     boolean not null default true,   -- ¿esta estación tiene pantalla KDS propia?
  prints             boolean not null default true,    -- ¿genera comanda impresa?
  category_overrides jsonb not null default '{}'::jsonb, -- { "<categoryId>": "cocina|barra|caja" }
  sort               int not null default 0,
  created_at         timestamptz not null default now(),
  primary key (client_id, location_id, station),
  constraint pos_location_stations_station_ck
    check (station in ('cocina', 'barra', 'caja'))
);

-- La sucursal pertenece al mismo tenant, garantizado por la base.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pos_location_stations_client_location_fkey') then
    alter table public.pos_location_stations
      add constraint pos_location_stations_client_location_fkey
      foreign key (client_id, location_id)
      references public.client_locations (client_id, id);
  end if;
end $$;

-- category_overrides: sólo objeto, valores en {cocina,barra,caja}, sin secretos posibles (los
-- valores son nombres de estación). Tope de tamaño para no cargar basura.
create or replace function private.pos_location_overrides_ok(m jsonb)
returns boolean language sql immutable as $$
  select
    jsonb_typeof(m) = 'object'
    and pg_column_size(m) <= 8192
    and not exists (
      select 1 from jsonb_each_text(m) e
      where e.value not in ('cocina', 'barra', 'caja')
    )
$$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pos_location_stations_overrides_ck') then
    alter table public.pos_location_stations
      add constraint pos_location_stations_overrides_ck
      check (private.pos_location_overrides_ok(category_overrides));
  end if;
end $$;

create index if not exists idx_pos_location_stations_cl
  on public.pos_location_stations (client_id, location_id);

-- RLS fail-closed: lectura por tenant; escritura sólo service_role (rutas admin). Sin anon.
alter table public.pos_location_stations enable row level security;

drop policy if exists pos_location_stations_tenant_read on public.pos_location_stations;
create policy pos_location_stations_tenant_read
  on public.pos_location_stations
  for select to authenticated
  using (private.user_has_client_access(client_id));

comment on table public.pos_location_stations is
  'Estaciones habilitadas por sucursal + overrides de routing por categoría. Sin filas para una sucursal = default de sistema (legacy). Gate: feature flag factory.stations_per_location.';
