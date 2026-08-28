-- Enrolamiento de terminales por código de un solo uso.
--
-- POR QUÉ
-- La plataforma genera la identidad; el dispositivo NUNCA elige device_id, client_id ni
-- location_id. El flujo queda en dos fases:
--   1. enroll (admin)  → el servidor genera device_id y un código de un solo uso, guarda
--                        SÓLO el hash del código + los bindings (client_id, location_id,
--                        role), con expiración corta. El código en claro se devuelve una vez
--                        y jamás se guarda ni se registra.
--   2. claim (device)  → intercambia el código por su identidad asignada, una sola vez.
--
-- Un código vencido, ya usado o de otro tenant/sucursal falla cerrado: no hay forma de que
-- un device se enrole con un identificador que él haya elegido.
--
-- ADITIVA, IDEMPOTENTE. No aplicada a ningún remoto.

create table if not exists public.pos_terminal_enrollments (
  id          uuid primary key default gen_random_uuid(),
  client_id   text not null,
  location_id text not null,                 -- NOT NULL: toda alta nueva nace con sucursal
  role        text,
  label       text,
  device_id   text not null,                 -- generado por el servidor, se asigna al claim
  code_hash   text not null unique,          -- sha256(código). El código en claro NUNCA se guarda.
  expires_at  timestamptz not null,
  claimed_at  timestamptz,                   -- NULL = pendiente; se sella una sola vez al claim
  created_at  timestamptz not null default now()
);

-- La sucursal del enrolamiento pertenece al mismo tenant, garantizado por la base.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pte_client_location_fkey') then
    alter table public.pos_terminal_enrollments
      add constraint pte_client_location_fkey
      foreign key (client_id, location_id)
      references public.client_locations (client_id, id);
  end if;
end $$;

-- Búsqueda del claim: sólo enrolamientos pendientes, por hash.
create index if not exists idx_pte_unclaimed
  on public.pos_terminal_enrollments (code_hash) where claimed_at is null;

-- RLS fail-closed: sin política. Sólo service_role (que la bypassa) desde las rutas admin
-- y la ruta de claim; authenticated y anon quedan denegados por ausencia de política. El
-- código sólo vive como hash, así que aunque alguien leyera la tabla no obtiene el código.
alter table public.pos_terminal_enrollments enable row level security;

comment on table public.pos_terminal_enrollments is
  'Códigos de enrolamiento de un solo uso. code_hash = sha256 del código; el código en claro nunca se persiste. La identidad (device_id) la genera el servidor.';
