-- Folio de orden por DIA DE VENTA, no por turno.
--
-- REGLA (Eduardo Esquivel, AMALAY):
--   "Todos los dias empieza con la orden uno, pero el consecutivo del movimiento
--    [sigue]."
--
-- QUE HACIA ANTES
--
-- `set_pos_order_number()` reiniciaba el folio POR TURNO:
--
--   where client_id = new.client_id and turno_id = new.turno_id
--
-- Con dos turnos en un dia, el folio volvia a empezar en 1. Evidencia real, AMALAY,
-- dia de venta 2026-08-30:
--
--   turno mtgl6c29pkyt -> folios 1..15
--   turno mt9etv39o35q -> folios 2..4     <- encimados
--
-- Eso rompe la regla de Eduardo y hace que el corte no cuadre: dos ordenes "#2" el
-- mismo dia no se pueden distinguir en un ticket ni en una factura.
--
-- (Correccion de registro: en ADR-003-ADDENDUM se afirmo que reiniciaba por fecha de
-- calendario. Es falso — esa rama es un fallback legacy que solo corre cuando
-- turno_id es NULL. El reinicio real era por turno.)
--
-- QUE HACE AHORA
--
-- El folio se numera dentro del DIA DE VENTA del cliente, que sale de
-- `clients.business_day_start_local` (AMALAY: 05:00) y `clients.timezone`. Una orden
-- de la 1 a.m. pertenece al dia anterior, como en la operacion real.
--
-- SE CONSERVA el `pg_advisory_xact_lock` que ya existia — solo cambia la llave, de
-- (cliente, turno) a (cliente, dia de venta). Sin el, dos cajas insertando a la vez
-- pueden calcular el mismo MAX+1.

-- ── 1. Columna del dia de venta ─────────────────────────────────────────────
-- Se materializa porque un indice unico exige una expresion IMMUTABLE, y el dia de
-- venta depende de `clients` (otra tabla). Con la columna, el indice es trivial.
alter table public.pos_orders
  add column if not exists dia_venta date;

comment on column public.pos_orders.dia_venta is
  'Dia de venta del restaurante (no de calendario): se corre segun clients.business_day_start_local. Lo llena set_pos_order_number().';

-- ── 2. El trigger ───────────────────────────────────────────────────────────
create or replace function public.set_pos_order_number()
returns trigger
language plpgsql
as $$
declare
  v_tz     text;
  v_inicio time;
begin
  -- Config del tenant. Si el cliente no existe o no declara nada, se usan los
  -- defaults del producto (mismos que provision-tenant.ts). Nunca se aborta el
  -- insert por configuracion faltante: perder la orden es peor que un folio con
  -- default.
  select coalesce(c.timezone, 'America/Monterrey'),
         coalesce(c.business_day_start_local, '05:00:00'::time)
    into v_tz, v_inicio
    from public.clients c
   where c.id = new.client_id;

  if v_tz is null then
    v_tz := 'America/Monterrey';
    v_inicio := '05:00:00'::time;
  end if;

  -- El dia de venta se calcula SIEMPRE, aunque el folio venga dado: es lo que
  -- sostiene el indice unico y los reportes por dia.
  if new.dia_venta is null then
    new.dia_venta :=
      ((coalesce(new.created_at, now()) at time zone v_tz) - v_inicio)::date;
  end if;

  if new.order_number is null then
    -- Se serializa por (cliente, dia de venta). Antes la llave era (cliente, turno),
    -- que es justo lo que permitia dos series el mismo dia.
    perform pg_advisory_xact_lock(
      hashtextextended(coalesce(new.client_id, '') || ':' || new.dia_venta::text, 0)
    );

    select coalesce(max(order_number), 0) + 1
      into new.order_number
      from public.pos_orders
     where client_id = new.client_id
       and dia_venta = new.dia_venta;
  end if;

  return new;
end;
$$;

-- ── 3. Backfill ─────────────────────────────────────────────────────────────
-- Solo rellena la columna nueva. NO toca `order_number`: renumerar historia
-- cambiaria folios ya impresos en tickets y facturados. La historia se queda como
-- esta; lo que cambia es de aqui en adelante.
update public.pos_orders o
   set dia_venta = ((o.created_at at time zone coalesce(c.timezone, 'America/Monterrey'))
                    - coalesce(c.business_day_start_local, '05:00:00'::time))::date
  from public.clients c
 where c.id = o.client_id
   and o.dia_venta is null;

-- ── 4. Indice unico PARCIAL ─────────────────────────────────────────────────
-- Parcial a proposito. Medido el 2026-09-01 sobre produccion:
--
--   129,016 ordenes con folio
--   115,227 filas involucradas en duplicados (89%)
--   peor caso: el mismo folio 167 veces (tekila-rg)
--
-- Casi todo es data SEMILLA de demos (scyf-demo 110,789; tekila-rg 5,520;
-- diezmex-demo 5,013). AMALAY tiene 24 ordenes y 2 filas duplicadas — el par que
-- este cambio evita.
--
-- Un indice unico total fallaria al crearse. Renumerar o borrar historia de otros
-- tenants no es una decision que corresponda a este arreglo. Desde 2026-09-02 el
-- campo esta limpio (verificado: 0 duplicados), asi que se protege desde ahi.
create unique index if not exists pos_orders_folio_unico_por_dia
  on public.pos_orders (client_id, dia_venta, order_number)
  where dia_venta >= date '2026-09-02' and order_number is not null;

comment on index public.pos_orders_folio_unico_por_dia is
  'Parcial desde 2026-09-02: antes de esa fecha hay 115k filas con folio duplicado, casi todas semilla de demos. Ver la migracion para los numeros medidos.';

-- ── 5. Indice de apoyo ──────────────────────────────────────────────────────
-- El trigger consulta MAX(order_number) por (client_id, dia_venta) en cada insert.
-- Sin esto seria un scan de la tabla en cada comanda.
create index if not exists pos_orders_dia_venta_idx
  on public.pos_orders (client_id, dia_venta);

-- ── 6. Huerfanas sin tenant ─────────────────────────────────────────────────
-- Al aplicar en produccion quedaron 7 filas sin dia_venta: el UPDATE de arriba
-- une contra `clients` y esas ordenes tienen `client_id = ''` (cadena vacia), del
-- 2026-07-27. Son data huerfana — ordenes sin restaurante.
--
-- Viene de que `getActiveClientSlug()` devuelve '' cuando no hay mapeo, o sea que
-- FALLA ABIERTO. Eso es un hueco aparte y sigue sin arreglarse; aqui solo se
-- completa la columna con el default para que quede integra. No se les inventa
-- cliente.
update public.pos_orders
   set dia_venta = ((created_at at time zone 'America/Monterrey') - '05:00:00'::time)::date
 where dia_venta is null;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- drop index if exists public.pos_orders_folio_unico_por_dia;
-- drop index if exists public.pos_orders_dia_venta_idx;
-- -- y restaurar la version anterior de set_pos_order_number() (numeraba por turno).
-- -- La columna dia_venta puede quedarse: es aditiva y no estorba.
