-- Conocimiento nativo del Chat IA: todo sale de las tablas PROPIAS de Fullsite
-- (pos_orders, recetas, insumos, proveedores), no de Wansoft. Funciones de sólo
-- lectura, security definer, ejecutables sólo por service_role (las llama la ruta
-- server-side /api/chat, que ya validó al tenant con requireTenant).

-- Estados que cuentan como venta (mismo criterio que lib/pos-daily.ts).
create or replace function public.fs_es_venta(p_status text) returns boolean
language sql immutable as $$ select p_status in ('cerrada','pagada','cobrada','entregada') $$;

-- Normaliza texto para buscar sin acentos ni mayúsculas.
create or replace function public.fs_norm(p text) returns text
language sql immutable as $$
  select lower(translate(coalesce(p, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))
$$;

-- Factor a unidad base (g, ml o pieza) para costear recetas con unidades mezcladas.
create or replace function public.fs_unidad(p text, out familia text, out factor numeric)
language sql immutable as $$
  select case
           when u in ('kg','kgs','kilo','kilos') then 'masa' when u in ('g','gr','grs','gramo','gramos') then 'masa'
           when u in ('l','lt','lts','litro','litros') then 'vol' when u in ('ml','mls') then 'vol'
           else 'pieza' end,
         case when u in ('kg','kgs','kilo','kilos','l','lt','lts','litro','litros') then 1000 else 1 end
  from (select lower(trim(coalesce(p, ''))) as u) x
$$;

-- 1. Frescura: qué tan al día está el POS de Fullsite (no depende de Wansoft).
create or replace function public.fs_frescura(p_client_id text, p_tz text default 'America/Monterrey')
returns table (ultima_orden_pos timestamptz, ordenes_pos_hoy bigint, venta_pos_hoy numeric)
language sql stable security definer set search_path = public as $$
  select
    (select max(coalesce(o.closed_at, o.created_at)) from pos_orders o where o.client_id = p_client_id and fs_es_venta(o.status)),
    (select count(*) from pos_orders o where o.client_id = p_client_id and fs_es_venta(o.status)
       and (o.created_at at time zone p_tz)::date = (now() at time zone p_tz)::date),
    (select coalesce(sum(o.total), 0) from pos_orders o where o.client_id = p_client_id and fs_es_venta(o.status)
       and (o.created_at at time zone p_tz)::date = (now() at time zone p_tz)::date)
$$;

-- 2. Ventas de CUALQUIER producto (platillo, bebida o market) con historial de precio.
--    Busca en los renglones de pos_orders; p_busqueda vacío = top 40 del periodo.
create or replace function public.fs_ventas_producto(
  p_client_id text, p_desde date, p_hasta date, p_busqueda text default '', p_tz text default 'America/Monterrey')
returns table (producto text, piezas numeric, venta numeric, precio_promedio numeric, precio_min numeric,
               precio_max numeric, primera_venta date, ultima_venta date, precio_por_mes jsonb)
language sql stable security definer set search_path = public as $$
with lineas as (
  select coalesce(e->>'nombre', e->>'name') as producto,
         coalesce(nullif(e->>'cantidad', '')::numeric, 1) as qty,
         coalesce(nullif(e->>'subtotal', '')::numeric,
                  coalesce(nullif(e->>'precio', '')::numeric, 0) * coalesce(nullif(e->>'cantidad', '')::numeric, 1)) as importe,
         nullif(e->>'precio', '')::numeric as precio,
         (o.created_at at time zone p_tz)::date as dia
  from pos_orders o
  cross join lateral jsonb_array_elements(
    case jsonb_typeof(o.items) when 'array' then o.items
         when 'string' then (o.items #>> '{}')::jsonb else '[]'::jsonb end) e
  where o.client_id = p_client_id and fs_es_venta(o.status)
    and (o.created_at at time zone p_tz)::date between p_desde and p_hasta
),
filtradas as (
  select * from lineas
  where producto is not null
    and (coalesce(p_busqueda, '') = ''
         or (select bool_and(fs_norm(producto) like '%' || t || '%')
             from unnest(string_to_array(fs_norm(p_busqueda), ' ')) t where t <> ''))
),
por_mes as (
  select producto, to_char(dia, 'YYYY-MM') mes, round(avg(precio), 2) p
  from filtradas where precio is not null group by 1, 2
)
select f.producto, sum(f.qty), round(sum(f.importe), 2), round(avg(f.precio), 2), min(f.precio), max(f.precio),
       min(f.dia), max(f.dia),
       (select jsonb_object_agg(m.mes, m.p order by m.mes) from por_mes m where m.producto = f.producto)
from filtradas f
group by f.producto
order by sum(f.importe) desc
limit 40
$$;

-- 3. Receta de un platillo: gramos/ml/piezas por insumo, costo por línea y proveedor.
create or replace function public.fs_receta(p_client_id text, p_busqueda text)
returns table (platillo text, precio_venta numeric, insumo text, cantidad numeric, unidad text,
               costo_unitario numeric, unidad_costo text, costo_linea numeric, proveedor text)
language sql stable security definer set search_path = public as $$
select mi.name, mi.price, i.name, rl.quantity, rl.recipe_unit, i.cost_per_unit, i.unit,
       case when ru.familia = iu.familia and iu.factor > 0
            then round(rl.quantity * ru.factor / iu.factor * i.cost_per_unit, 2) end,
       i.supplier
from pos_recipe_versions rv
join pos_menu_items mi on mi.id = rv.menu_item_id and mi.client_id = rv.client_id
join pos_recipe_lines rl on rl.recipe_version_id = rv.id
left join pos_ingredients i on i.id = rl.ingredient_id
cross join lateral fs_unidad(rl.recipe_unit) ru
cross join lateral fs_unidad(i.unit) iu
where rv.client_id = p_client_id and rv.active
  and (select bool_and(fs_norm(mi.name) like '%' || t || '%')
       from unnest(string_to_array(fs_norm(p_busqueda), ' ')) t where t <> '')
order by mi.name, i.name
limit 120
$$;

-- 4. Insumos: costo, unidad, proveedor (con contacto) y en qué platillos se usan.
create or replace function public.fs_insumo(p_client_id text, p_busqueda text)
returns table (insumo text, unidad text, costo_unitario numeric, proveedor text, proveedor_telefono text,
               proveedor_contacto text, dias_entrega text, usado_en text[])
language sql stable security definer set search_path = public as $$
select i.name, i.unit, i.cost_per_unit, i.supplier, s.phone, s.contact, s.delivery_days::text,
       (select array_agg(distinct mi.name) from pos_recipe_lines rl
          join pos_recipe_versions rv on rv.id = rl.recipe_version_id and rv.active
          join pos_menu_items mi on mi.id = rv.menu_item_id
         where rl.ingredient_id = i.id)
from pos_ingredients i
left join lateral (
  select * from pos_suppliers s
  where s.client_id = i.client_id and fs_norm(s.name) = fs_norm(i.supplier) limit 1) s on true
where i.client_id = p_client_id and coalesce(i.active, true)
  and (select bool_and(fs_norm(i.name) like '%' || t || '%')
       from unnest(string_to_array(fs_norm(p_busqueda), ' ')) t where t <> '')
order by i.name
limit 30
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.fs_frescura(text,text)',
    'public.fs_ventas_producto(text,date,date,text,text)',
    'public.fs_receta(text,text)',
    'public.fs_insumo(text,text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
