-- Turnos por sucursal — sólo el esquema. Ningún escritor lo usa todavía.
--
-- POR QUÉ
-- Un grupo con varias sucursales no puede tener cortes independientes: `pos_turnos`
-- no sabe en qué sucursal se abrió. Verificado el 2026-08-28 contra producción; sus
-- columnas eran id, client_id, opened_by, fondo_inicial, opened_at, closed_by,
-- fondo_final, efectivo_sistema, diferencia, closed_at, notas.
--
-- Al sembrar la demo de Diezmex (5 marcas) hubo que codificar la sucursal dentro del
-- `id` del turno como paliativo. Esto lo arregla de raíz.
--
-- Square lo tiene igual y es más estricto: en su objeto `Shift`, `location_id` es
-- OBLIGATORIO y un turno no puede abarcar dos sucursales — "the location should be
-- based on where the employee clocked in". Ver docs/competitive/SQUARE-MODELO-DE-DATOS.md §5-ter.
--
-- POR QUÉ NULLABLE Y POR QUÉ NO SE CABLEA AQUÍ
-- Los turnos viajan por la cola offline (`addToQueue('pos_turnos', ...)` en pos-data.ts)
-- y el service worker conoce su forma. El camino offline está CONGELADO y probado en
-- campo: docs/pos/PIPELINE-POS-KDS-OFFLINE.md dice "si regresa el offline de la caja,
-- revertir".
--
-- Por eso esta migración es puramente aditiva:
--   · la columna es NULLABLE — un turno encolado por código viejo sigue insertando
--   · NO hay backfill — nada se reescribe
--   · NO se toca pos-data.ts ni el service worker
--
-- Como ningún escritor pone `location_id` todavía, la llave foránea de abajo NO PUEDE
-- rechazar nada hoy. Empieza a aplicar cuando se cableen los escritores, y ese cambio
-- sí se prueba físicamente antes de ir a producción.

-- ── 1. Llave única compuesta en sucursales ───────────────────────────────────
-- Necesaria para poder referenciar (client_id, id) desde otras tablas. Es
-- redundante con la PK sobre `id`, así que no cambia qué filas son válidas:
-- sólo habilita la FK compuesta de abajo.
alter table public.client_locations
  drop constraint if exists client_locations_client_id_id_key;

alter table public.client_locations
  add constraint client_locations_client_id_id_key unique (client_id, id);

-- ── 2. La columna ────────────────────────────────────────────────────────────
alter table public.pos_turnos
  add column if not exists location_id text;

comment on column public.pos_turnos.location_id is
  'Sucursal donde se abrió el turno. NULL = el cliente todavía no usa multi-sucursal, '
  'o el turno viene de un POS con código anterior a esta columna. Un turno pertenece a '
  'UNA sucursal: no puede abarcar dos.';

-- ── 3. Integridad de tenant ──────────────────────────────────────────────────
-- La propiedad que importa NO es "la sucursal existe", es "la sucursal es DE ESTE
-- CLIENTE". Una FK compuesta lo dice en el esquema, donde no se puede olvidar.
--
-- Con MATCH SIMPLE (el default), una fila con location_id NULL satisface la
-- restricción — que es justo lo que permite que los turnos viejos y los de código
-- anterior sigan siendo válidos.
alter table public.pos_turnos
  drop constraint if exists pos_turnos_client_location_fk;

alter table public.pos_turnos
  add constraint pos_turnos_client_location_fk
  foreign key (client_id, location_id)
  references public.client_locations (client_id, id)
  on update cascade
  on delete restrict;

-- ── 4. Índice ────────────────────────────────────────────────────────────────
-- El acceso real es "los turnos abiertos de esta sucursal": el corte Z por sucursal
-- y el KDS filtrando por jornada vigente.
create index if not exists idx_pos_turnos_client_location_abiertos
  on public.pos_turnos (client_id, location_id, opened_at desc)
  where closed_at is null;

-- ── 5. Comprobación ──────────────────────────────────────────────────────────
do $$
declare
  v_col   int;
  v_fk    int;
  v_idx   int;
  v_rotos int;
begin
  select count(*) into v_col from information_schema.columns
   where table_schema='public' and table_name='pos_turnos' and column_name='location_id';

  select count(*) into v_fk from pg_constraint
   where conname = 'pos_turnos_client_location_fk';

  select count(*) into v_idx from pg_indexes
   where schemaname='public' and indexname='idx_pos_turnos_client_location_abiertos';

  -- Ningún turno existente puede haber quedado apuntando a otro cliente.
  select count(*) into v_rotos
    from pos_turnos t
   where t.location_id is not null
     and not exists (
       select 1 from client_locations l
        where l.id = t.location_id and l.client_id = t.client_id);

  if v_col <> 1 then raise exception 'falta la columna location_id'; end if;
  if v_fk  <> 1 then raise exception 'falta la FK de tenant'; end if;
  if v_idx <> 1 then raise exception 'falta el índice'; end if;
  if v_rotos > 0 then raise exception '% turnos apuntan a una sucursal de otro cliente', v_rotos; end if;

  raise notice 'turnos por sucursal: columna, FK e índice verificados; 0 turnos cruzados';
end $$;
