-- ventas_por_franja: la fuente se elige DÍA POR DÍA. Antes, si en el rango había un
-- solo día con horas de Wansoft, se ignoraba todo el POS (y viceversa). Ahora:
-- días con wansoft_order_times → Wansoft; el resto → pos_orders (Fullsite).
create or replace function public.ventas_por_franja(p_client_id text, p_desde date, p_hasta date, p_franjas jsonb, p_tz text default 'America/Monterrey', p_inicio_dia time default '05:00')
returns table(location_id text, franja text, ordenes bigint, dias bigint, venta numeric, venta_comida numeric, venta_bebida numeric, fuente text)
language sql stable security definer set search_path to 'public' as $function$
with ds as (
  select (extract(hour from p_inicio_dia) * 60 + extract(minute from p_inicio_dia))::int as m0
),
fr as (
  select f->>'key' as key, t.ord::int as ord,
         (extract(hour from (f->>'inicio')::time) * 60 + extract(minute from (f->>'inicio')::time))::int as ini,
         case when coalesce(f->>'fin', '') = '' then null
              else (extract(hour from (f->>'fin')::time) * 60 + extract(minute from (f->>'fin')::time))::int end as fin
  from jsonb_array_elements(coalesce(p_franjas, '[]'::jsonb)) with ordinality as t(f, ord)
),
frn as (
  select fr.key, fr.ord,
         case when fr.ini < ds.m0 then fr.ini + 1440 else fr.ini end as ini_n,
         case when fr.fin is null then ds.m0 + 1439 when fr.fin < ds.m0 then fr.fin + 1440 else fr.fin end as fin_n
  from fr, ds
),
ws as (
  select w.location_id, w.fecha, w.total, w.total_comida as comida, w.total_bebida as bebida,
         (extract(hour from w.hora) * 60 + extract(minute from w.hora))::int as m, 'wansoft'::text as fuente
  from wansoft_order_times w
  where w.client_id = p_client_id and w.fecha between p_desde and p_hasta
),
dias_ws as (select distinct fecha from ws),
pos as (
  select o.location_id, o.id, o.total::numeric as total, (o.created_at at time zone p_tz) as local_ts,
         case jsonb_typeof(o.items) when 'string' then (o.items #>> '{}')::jsonb else o.items end as items
  from pos_orders o
  where o.client_id = p_client_id and fs_es_venta(o.status, o.payment_status)
    and o.created_at >= ((p_desde::timestamp + p_inicio_dia) at time zone p_tz)
    and o.created_at <  (((p_hasta + 1)::timestamp + p_inicio_dia) at time zone p_tz)
),
pos_lineas as (
  select p.id,
         coalesce(nullif(e->>'subtotal', '')::numeric,
                  coalesce(nullif(e->>'precio', '')::numeric, 0) * coalesce(nullif(e->>'cantidad', '')::numeric, 1)) as linea,
         case when coalesce(e->>'station', e->>'estacion', '') <> '' then coalesce(e->>'station', e->>'estacion') = 'barra'
              else coalesce(e->>'nombre', '') ~* '(caf[eé]|latte|cap+uc+ino|americano|espresso|expreso|chemex|matcha|chai|\mt[eé]\M|jugo|agua|refresco|soda|limonada|naranjada|smoothie|frap+[eé]|malteada|cerveza|vino|mezcal|tequila|margarita|mojito|c[oó]ctel|coctel|bebida|coca|sangr[ií]a)'
         end as es_bebida
  from pos p
  cross join lateral jsonb_array_elements(case when jsonb_typeof(p.items) = 'array' then p.items else '[]'::jsonb end) e
),
pos_split as (
  select p.location_id, p.total, p.local_ts,
         coalesce(sum(l.linea), 0) as lt, coalesce(sum(l.linea) filter (where l.es_bebida), 0) as lb
  from pos p left join pos_lineas l on l.id = p.id
  group by p.id, p.location_id, p.total, p.local_ts
),
pos_norm as (
  select s.location_id, (s.local_ts - p_inicio_dia)::date as fecha, s.total,
         case when s.lt > 0 then s.total * (s.lt - s.lb) / s.lt else s.total end as comida,
         case when s.lt > 0 then s.total * s.lb / s.lt else 0 end as bebida,
         (extract(hour from s.local_ts) * 60 + extract(minute from s.local_ts))::int as m, 'pos'::text as fuente
  from pos_split s
),
todas as (
  select location_id, fecha, total, comida, bebida, m, fuente from ws
  union all
  select location_id, fecha, total, comida, bebida, m, fuente from pos_norm
  where fecha not in (select fecha from dias_ws)
),
clasif as (
  select t.*,
         (select f.key from frn f
           where (case when t.m < ds.m0 then t.m + 1440 else t.m end) between f.ini_n and f.fin_n
           order by f.ord limit 1) as franja
  from todas t, ds
)
select coalesce(c.location_id, '(sin sucursal)'), coalesce(c.franja, '__fuera__'),
       count(*), count(distinct c.fecha), round(sum(c.total), 2), round(sum(c.comida), 2), round(sum(c.bebida), 2),
       string_agg(distinct c.fuente, ',')
from clasif c group by 1, 2;
$function$;
