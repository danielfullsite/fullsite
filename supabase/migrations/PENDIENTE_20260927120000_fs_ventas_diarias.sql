-- Ventas diarias desde el POS de Fullsite, agregadas DENTRO de Postgres.
--
-- Antes lib/pos-daily.ts bajaba las órdenes crudas con limit=8000 y sumaba en JS:
-- un restaurante de ~150 órdenes/día rebasa el tope en ~2 meses y el histórico salía
-- truncado sin avisar. Ahora que el POS de Fullsite es la FUENTE PRINCIPAL (no el
-- histórico importado), el agregado tiene que ser completo: se hace aquí, sin tope.
--
-- Mismo shape que wansoft_daily (lo consumen chat, coach, voz, agentes y reportes),
-- más ventas_por_grupo real (categoría del menú de cada platillo).
-- Día de venta: pos_orders.dia_venta (lo calcula la base por tenant); respaldo
-- created_at - 6h para filas viejas, igual que el código anterior.

create or replace function public.fs_ventas_diarias(p_client_id text, p_desde date, p_hasta date)
returns table (
  fecha date, ventas_dia numeric, ventas_brutas numeric, descuentos numeric, propinas_total numeric,
  tickets_count bigint, personas_restaurant bigint, efectivo numeric, tarjeta numeric,
  meseros jsonb, pago_metodos jsonb, platillos_top jsonb, ventas_por_grupo jsonb
)
language sql stable security definer set search_path = public as $$
with o as (
  select x.id, x.total::numeric as total, x.subtotal, x.descuento, x.propina, x.personas, x.mesero, x.metodo_pago, x.items,
         coalesce(x.dia_venta, (x.created_at - interval '6 hours')::date) as dia
  from pos_orders x
  where x.client_id = p_client_id and fs_es_venta(x.status)
    and x.created_at >= (p_desde - 2)::timestamp and x.created_at < (p_hasta + 3)::timestamp
),
o2 as (select * from o where dia between p_desde and p_hasta),
d as (
  select dia,
         sum(total) as ventas, sum(coalesce(nullif(subtotal, 0), total)) as brutas,
         sum(coalesce(descuento, 0)) as descs, sum(coalesce(propina, 0)) as props,
         count(*) as tickets, sum(coalesce(nullif(personas, 0), 1)) as pers,
         coalesce(sum(total) filter (where metodo_pago ilike '%efectivo%'), 0) as ef,
         coalesce(sum(total) filter (where metodo_pago ilike '%tarjeta%'), 0) as tj
  from o2 group by dia
),
mes as (
  select dia, jsonb_agg(jsonb_build_object('nombre', mesero, 'total', round(t)) order by t desc) as j
  from (select dia, mesero, sum(total) t from o2 where coalesce(mesero, '') <> '' group by 1, 2) s group by dia
),
pag as (
  select dia, jsonb_agg(jsonb_build_object('nombre', metodo_pago, 'total', round(t)) order by t desc) as j
  from (select dia, metodo_pago, sum(total) t from o2 where coalesce(metodo_pago, '') <> '' group by 1, 2) s group by dia
),
lin as (
  select o2.dia, e->>'nombre' as nombre, coalesce(e->>'menuItemId', e->>'id') as mid,
         coalesce(nullif(e->>'cantidad', '')::numeric, 1) as qty,
         coalesce(nullif(e->>'subtotal', '')::numeric,
                  coalesce(nullif(e->>'precio', '')::numeric, 0) * coalesce(nullif(e->>'cantidad', '')::numeric, 1)) as imp
  from o2
  cross join lateral jsonb_array_elements(
    case jsonb_typeof(o2.items) when 'array' then o2.items
         when 'string' then (o2.items #>> '{}')::jsonb else '[]'::jsonb end) e
  where e->>'nombre' is not null
),
pla as (
  select dia, jsonb_agg(jsonb_build_object('nombre', nombre, 'cantidad', q, 'total', round(t)) order by t desc) as j
  from (select dia, nombre, sum(qty) q, sum(imp) t from lin group by 1, 2) s group by dia
),
-- Categoría: por id del platillo; si el renglón no trae id (o no existe), por nombre.
-- El menú se carga UNA vez y se cruza con hash join (antes era una subconsulta con OR
-- por renglón: 1.7 s para 5k órdenes).
mi as (select id, name, category_id from pos_menu_items where client_id = p_client_id),
mi_nombre as (select distinct on (name) name, category_id from mi order by name, id),
lin_cat as (
  select l.dia, l.imp, coalesce(c.name, 'SIN CATEGORÍA') as grupo
  from lin l
  left join mi on mi.id = l.mid
  left join mi_nombre mn on mi.id is null and mn.name = l.nombre
  left join pos_menu_categories c on c.id = coalesce(mi.category_id, mn.category_id)
),
gru as (
  select dia, jsonb_agg(jsonb_build_object('nombre', grupo, 'total', round(t)) order by t desc) as j
  from (select dia, grupo, sum(imp) t from lin_cat group by 1, 2) s group by dia
)
select d.dia, round(d.ventas, 2), round(d.brutas, 2), round(d.descs, 2), round(d.props, 2), d.tickets, d.pers,
       round(d.ef, 2), round(d.tj, 2),
       coalesce(mes.j, '[]'::jsonb), coalesce(pag.j, '[]'::jsonb), coalesce(pla.j, '[]'::jsonb), coalesce(gru.j, '[]'::jsonb)
from d
left join mes on mes.dia = d.dia
left join pag on pag.dia = d.dia
left join pla on pla.dia = d.dia
left join gru on gru.dia = d.dia
order by d.dia desc
$$;

revoke all on function public.fs_ventas_diarias(text, date, date) from public, anon, authenticated;
grant execute on function public.fs_ventas_diarias(text, date, date) to service_role;
