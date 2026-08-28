-- Turnos por sucursal + una caja/turno activo por regla. Corte Z sobre lo que ya existe.
--
-- POR QUÉ
-- pos_turnos ya existe (id, client_id, opened_by, fondo_inicial, opened_at, closed_by,
-- fondo_final, efectivo_sistema, diferencia, closed_at, notas) con RLS tenant-scoped y el
-- wizard de cierre (CierreCajaWizard) + arqueo + GUARD-08 ya construidos. Le faltan tres cosas
-- para el corte Z multisucursal:
--   1. location_id — a qué sucursal pertenece el turno.
--   2. status — abierto/cerrado/forzado, para poder exigir "una caja/turno activo por regla".
--   3. unicidad del turno activo por (client_id, location_id).
--
-- ADITIVA E IDEMPOTENTE. NO borra historial. NO reinicia la numeración fiscal (no escribe en
-- las tablas de facturación ni reinicia ninguna secuencia). NO agrega FK dura desde
-- pos_orders.turno_id (podría fallar sobre turnos legacy sueltos; endurecimiento posterior
-- documentado). NO toca la RLS existente de pos_turnos. No aplicada a ningún remoto.

-- ── status: se agrega y se DERIVA de closed_at (no se inventa, no se borra nada) ──
alter table public.pos_turnos add column if not exists status text;
-- Sólo toca filas sin status (el column recién nace NULL): abierto si no tiene cierre, cerrado
-- si ya cerró. Es derivación del estado real, no reescritura de historial.
update public.pos_turnos
  set status = case when closed_at is null then 'abierto' else 'cerrado' end
  where status is null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pos_turnos_status_ck') then
    alter table public.pos_turnos
      add constraint pos_turnos_status_ck check (status in ('abierto', 'cerrado', 'forzado'));
  end if;
end $$;

-- ── location_id: nullable (turnos legacy no la tienen; transición) ──
alter table public.pos_turnos add column if not exists location_id text;

-- client_locations necesita UNIQUE(client_id, id) para el FK compuesto. Idempotente: si la
-- migración de #195 ya lo agregó, este guard lo salta (mismo nombre de constraint).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'client_locations_client_id_id_key') then
    alter table public.client_locations
      add constraint client_locations_client_id_id_key unique (client_id, id);
  end if;
end $$;

-- La sucursal del turno pertenece al mismo tenant. MATCH SIMPLE: location_id NULL (legacy) no
-- se evalúa; cuando está puesta, (client_id, location_id) debe existir junta.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pos_turnos_client_location_fkey') then
    alter table public.pos_turnos
      add constraint pos_turnos_client_location_fkey
      foreign key (client_id, location_id)
      references public.client_locations (client_id, id);
  end if;
end $$;

-- ── Una caja/turno activo por sucursal ──
-- Índice único parcial: a lo sumo un turno 'abierto' por (client_id, location_id). Los turnos
-- legacy con location_id NULL no chocan entre sí (NULLs distintos), así que no rompe histórico;
-- protege sólo a los turnos nuevos, que sí traen sucursal.
create unique index if not exists uq_pos_turnos_activo_por_sucursal
  on public.pos_turnos (client_id, location_id)
  where status = 'abierto' and location_id is not null;

create index if not exists idx_pos_turnos_client_location
  on public.pos_turnos (client_id, location_id);

comment on column public.pos_turnos.status is
  'abierto | cerrado | forzado (cierre por admin). Derivado de closed_at para filas legacy.';
comment on column public.pos_turnos.location_id is
  'Sucursal del turno. NULL = turno legacy en transición. Unicidad de turno activo aplica cuando está puesta.';
