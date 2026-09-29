-- Costo de ventas TEÓRICO por mes: cada platillo vendido en el POS × el costo de su
-- ficha técnica (fs_food_cost). Es el food cost correcto para el Estado de Resultados
-- (antes: tabla de Wansoft o un 35% supuesto). `venta_con_receta` dice qué parte de la
-- venta tiene ficha: el % se calcula sobre ESA venta, y la cobertura se muestra.
create or replace function public.fs_costo_de_ventas(p_client_id text, p_desde date, p_hasta date)
returns table (mes text, venta_platillos numeric, venta_con_receta numeric, costo_teorico numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not fs_puede_leer(p_client_id) then
    raise exception 'sin acceso a %', p_client_id using errcode = '42501';
  end if;
  return query
  with fc as (select fs_norm(f.platillo) as k, max(f.costo) as costo
              from fs_food_cost(p_client_id) f where f.costo > 0 group by 1),
  o as (
    select x.items, coalesce(x.dia_venta, (x.created_at - interval '6 hours')::date) as dia
    from pos_orders x
    where x.client_id = p_client_id and fs_es_venta(x.status, x.payment_status)
      and x.created_at >= (p_desde - 2)::timestamp and x.created_at < (p_hasta + 3)::timestamp
  ),
  lin as (
    select to_char(o.dia, 'YYYY-MM') as m, e->>'nombre' as nombre,
           coalesce(nullif(e->>'cantidad', '')::numeric, 1) as qty,
           coalesce(nullif(e->>'subtotal', '')::numeric,
                    coalesce(nullif(e->>'precio', '')::numeric, 0) * coalesce(nullif(e->>'cantidad', '')::numeric, 1)) as imp
    from o
    cross join lateral jsonb_array_elements(
      case jsonb_typeof(o.items) when 'array' then o.items
           when 'string' then (o.items #>> '{}')::jsonb else '[]'::jsonb end) e
    where o.dia between p_desde and p_hasta and e->>'nombre' is not null
  )
  select l.m, round(sum(l.imp), 2),
         round(coalesce(sum(l.imp) filter (where fc.k is not null), 0), 2),
         round(coalesce(sum(l.qty * fc.costo), 0), 2)
  from lin l left join fc on fc.k = fs_norm(l.nombre)
  group by l.m order by l.m desc;
end $$;
revoke all on function public.fs_costo_de_ventas(text, date, date) from public, anon;
grant execute on function public.fs_costo_de_ventas(text, date, date) to authenticated, service_role;
