-- Horarios de venta (dayparts) por restaurante. PENDIENTE: aplicar primero en staging.
--
-- Cada restaurante define SUS franjas (brunch, lunch, merienda, dinner… o las que use)
-- en clients.sales_dayparts. No se guardan totales por franja: se guarda la HORA de
-- cada orden y la clasificación se hace al consultar. Así, si el restaurante cambia
-- sus horarios, el histórico completo se recalcula solo — sin re-scrapear nada.
--
-- Fuentes de hora por orden:
--   · pos_orders.created_at        → restaurantes que cobran con el POS de Fullsite
--   · wansoft_order_times.hora     → restaurantes con histórico en Wansoft (AMALAY)
-- Si un cliente tiene filas de Wansoft en el rango, se usa SÓLO Wansoft (evita contar
-- dos veces la misma venta cuando conviven los dos sistemas durante la migración).

-- 1. Configuración por restaurante ------------------------------------------------
-- Forma: {"franjas":[{"key":"brunch","nombre":"Brunch","inicio":"08:00","fin":"13:00"},
--                    {"key":"dinner","nombre":"Dinner","inicio":"19:00","fin":null}]}
-- fin es INCLUSIVO al minuto (13:00 cuenta como brunch). fin null = hasta el cierre.
alter table public.clients add column if not exists sales_dayparts jsonb;

comment on column public.clients.sales_dayparts is
  'Franjas de venta del restaurante (brunch/lunch/dinner…). Ver lib/dayparts.ts. null = default genérico.';

-- AMALAY: horarios dados por el dueño el 2026-09-27. Sólo si aún no tiene config.
update public.clients
   set sales_dayparts = '{"franjas":[
     {"key":"brunch","nombre":"Brunch","inicio":"08:00","fin":"13:00"},
     {"key":"lunch","nombre":"Lunch","inicio":"13:01","fin":"17:00"},
     {"key":"merienda","nombre":"Merienda","inicio":"17:01","fin":"18:59"},
     {"key":"dinner","nombre":"Dinner","inicio":"19:00","fin":null}]}'::jsonb
 where id = 'amalay' and sales_dayparts is null;

-- 2. Hora por orden desde Wansoft -------------------------------------------------
-- Una fila por orden: la hora es la del PRIMER renglón de la orden (cuando se abrió).
create table if not exists public.wansoft_order_times (
  client_id     text not null,
  location_id   text,
  fecha         date not null,
  orden         text not null,
  hora          time not null,
  total         numeric not null default 0,
  total_comida  numeric not null default 0,
  total_bebida  numeric not null default 0,
  personas      integer,
  updated_at    timestamptz not null default now(),
  primary key (client_id, fecha, orden)
);

create index if not exists wansoft_order_times_client_fecha_idx
  on public.wansoft_order_times (client_id, fecha);

-- Sin políticas: sólo la service key (scraper y rutas server-side) lee y escribe.
alter table public.wansoft_order_times enable row level security;

-- 3. Agregado por franja y sucursal -----------------------------------------------
-- Devuelve una fila por (sucursal, franja). La franja '__fuera__' junta las órdenes
-- que no caen en ninguna franja configurada (para que el % nunca mienta).
create or replace function public.ventas_por_franja(
  p_client_id   text,
  p_desde       date,
  p_hasta       date,
  p_franjas     jsonb,
  p_tz          text default 'America/Monterrey',
  p_inicio_dia  time default '05:00'
)
returns table (
  location_id   text,
  franja        text,
  ordenes       bigint,
  dias          bigint,
  venta         numeric,
  venta_comida  numeric,
  venta_bebida  numeric,
  fuente        text
)
language sql
stable
security definer
set search_path = public
as $$
with ds as (
  select (extract(hour from p_inicio_dia) * 60 + extract(minute from p_inicio_dia))::int as m0
),
fr as (
  select f->>'key' as key,
         t.ord::int as ord,
         (extract(hour from (f->>'inicio')::time) * 60 + extract(minute from (f->>'inicio')::time))::int as ini,
         case when coalesce(f->>'fin', '') = '' then null
              else (extract(hour from (f->>'fin')::time) * 60 + extract(minute from (f->>'fin')::time))::int end as fin
  from jsonb_array_elements(coalesce(p_franjas, '[]'::jsonb)) with ordinality as t(f, ord)
),
-- Minutos "de jornada": lo anterior al inicio del día operativo pertenece a la noche previa.
frn as (
  select fr.key, fr.ord,
         case when fr.ini < ds.m0 then fr.ini + 1440 else fr.ini end as ini_n,
         case when fr.fin is null then ds.m0 + 1439
              when fr.fin < ds.m0 then fr.fin + 1440
              else fr.fin end as fin_n
  from fr, ds
),
hay_ws as (
  select exists (
    select 1 from wansoft_order_times w
    where w.client_id = p_client_id and w.fecha between p_desde and p_hasta
  ) as v
),
ws as (
  select w.location_id, w.fecha, w.total, w.total_comida as comida, w.total_bebida as bebida,
         (extract(hour from w.hora) * 60 + extract(minute from w.hora))::int as m,
         'wansoft'::text as fuente
  from wansoft_order_times w, hay_ws
  where hay_ws.v and w.client_id = p_client_id and w.fecha between p_desde and p_hasta
),
pos as (
  select o.location_id, o.id, o.total::numeric as total,
         (o.created_at at time zone p_tz) as local_ts,
         case jsonb_typeof(o.items) when 'string' then (o.items #>> '{}')::jsonb else o.items end as items
  from pos_orders o, hay_ws
  where not hay_ws.v
    and o.client_id = p_client_id
    and o.status = 'cerrada'
    and o.created_at >= ((p_desde::timestamp + p_inicio_dia) at time zone p_tz)
    and o.created_at <  (((p_hasta + 1)::timestamp + p_inicio_dia) at time zone p_tz)
),
-- Comida vs bebida por renglón: la estación del KDS manda (barra = bebida); si el
-- renglón no trae estación, se decide por el nombre.
pos_lineas as (
  select p.id,
         coalesce(nullif(e->>'subtotal', '')::numeric,
                  coalesce(nullif(e->>'precio', '')::numeric, 0) * coalesce(nullif(e->>'cantidad', '')::numeric, 1)) as linea,
         case
           when coalesce(e->>'station', e->>'estacion', '') <> ''
             then coalesce(e->>'station', e->>'estacion') = 'barra'
           else coalesce(e->>'nombre', '') ~* '(caf[eé]|latte|cap+uc+ino|americano|espresso|expreso|chemex|matcha|chai|\mt[eé]\M|jugo|agua|refresco|soda|limonada|naranjada|smoothie|frap+[eé]|malteada|cerveza|vino|mezcal|tequila|margarita|mojito|c[oó]ctel|coctel|bebida|coca|sangr[ií]a)'
         end as es_bebida
  from pos p
  cross join lateral jsonb_array_elements(case when jsonb_typeof(p.items) = 'array' then p.items else '[]'::jsonb end) e
),
pos_split as (
  select p.location_id, p.total, p.local_ts,
         coalesce(sum(l.linea), 0) as lt,
         coalesce(sum(l.linea) filter (where l.es_bebida), 0) as lb
  from pos p left join pos_lineas l on l.id = p.id
  group by p.id, p.location_id, p.total, p.local_ts
),
pos_norm as (
  select s.location_id,
         (s.local_ts - p_inicio_dia)::date as fecha,
         s.total,
         case when s.lt > 0 then s.total * (s.lt - s.lb) / s.lt else s.total end as comida,
         case when s.lt > 0 then s.total * s.lb / s.lt else 0 end as bebida,
         (extract(hour from s.local_ts) * 60 + extract(minute from s.local_ts))::int as m,
         'pos'::text as fuente
  from pos_split s
),
todas as (
  select location_id, fecha, total, comida, bebida, m, fuente from ws
  union all
  select location_id, fecha, total, comida, bebida, m, fuente from pos_norm
),
clasif as (
  select t.*,
         (select f.key from frn f
           where (case when t.m < ds.m0 then t.m + 1440 else t.m end) between f.ini_n and f.fin_n
           order by f.ord limit 1) as franja
  from todas t, ds
)
select coalesce(c.location_id, '(sin sucursal)'),
       coalesce(c.franja, '__fuera__'),
       count(*),
       count(distinct c.fecha),
       round(sum(c.total), 2),
       round(sum(c.comida), 2),
       round(sum(c.bebida), 2),
       string_agg(distinct c.fuente, ',')
from clasif c
group by 1, 2;
$$;

revoke all on function public.ventas_por_franja(text, date, date, jsonb, text, time) from public, anon, authenticated;
grant execute on function public.ventas_por_franja(text, date, date, jsonb, text, time) to service_role;
