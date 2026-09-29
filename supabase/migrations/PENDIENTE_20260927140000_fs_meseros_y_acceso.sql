-- 1) Acceso desde el navegador a funciones fs_*: el usuario debe pertenecer al
--    restaurante (client_users) o ser el servidor (service_role). Falla CERRADO.
create or replace function public.fs_puede_leer(p_client_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.role(), '') = 'service_role'
      or exists (select 1 from client_users cu where cu.user_id = auth.uid() and cu.client_id = p_client_id)
$$;
revoke all on function public.fs_puede_leer(text) from public, anon;
grant execute on function public.fs_puede_leer(text) to authenticated, service_role;

-- 2) KPIs por mesero desde el POS de Fullsite, con el MISMO shape que la tabla legacy
--    wansoft_waiter_categories (así /meseros no cambia su render) y la MISMA lógica del
--    scraper (ticket_detail_scraper.compute_waiter_categories):
--      H&H / Pan / Postres = piezas cuyos nombres contienen las palabras de
--      clients.menu_categories (hh/pan/postres); defaults del scraper si no hay.
--      2da Bebida = bebidas extra por ticket (sum(max(0, bebidas-1))).
--      Bebida = estación barra, o categoría en clients.bebida_groups, o nombre de bebida.
--    A diferencia de la legacy, ESTA sí va por restaurante.
create or replace function public.fs_meseros_categorias(p_client_id text, p_desde date, p_hasta date)
returns table (fecha date, data jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not fs_puede_leer(p_client_id) then
    raise exception 'sin acceso a %', p_client_id using errcode = '42501';
  end if;
  return query
  with cfg as (
    select coalesce(c.menu_categories, '{}'::jsonb) as mc, coalesce(c.bebida_groups, '[]'::jsonb) as bg
    from clients c where c.id = p_client_id
  ),
  kw as (
    select
      coalesce((select array_agg(upper(x)) from jsonb_array_elements_text(cfg.mc->'hh') x), array['HALF', 'HALF HALF']) as hh,
      coalesce((select array_agg(upper(x)) from jsonb_array_elements_text(cfg.mc->'pan') x), array['TOAST', 'BAGEL', 'CROISSANT']) as pan,
      coalesce((select array_agg(upper(x)) from jsonb_array_elements_text(cfg.mc->'postres') x), array['BROWNIE', 'CHEESECAKE', 'CAKE', 'PANCAKE']) as postres,
      coalesce((select array_agg(upper(x)) from jsonb_array_elements_text(cfg.bg) x), array[]::text[]) as beb
    from cfg
  ),
  o as (
    select x.id, x.mesero, coalesce(nullif(x.personas, 0), 1) as pers, x.total::numeric as total, x.items,
           coalesce(x.dia_venta, (x.created_at - interval '6 hours')::date) as dia
    from pos_orders x
    where x.client_id = p_client_id and fs_es_venta(x.status, x.payment_status)
      and coalesce(x.mesero, '') <> ''
      and x.created_at >= (p_desde - 2)::timestamp and x.created_at < (p_hasta + 3)::timestamp
  ),
  o2 as (select * from o where o.dia between p_desde and p_hasta),
  mi as (select m.id, m.name, m.category_id from pos_menu_items m where m.client_id = p_client_id),
  mi_nombre as (select distinct on (mi.name) mi.name, mi.category_id from mi order by mi.name, mi.id),
  lin as (
    select o2.id, o2.dia, o2.mesero, e->>'nombre' as nombre, upper(e->>'nombre') as nom,
           coalesce(e->>'menuItemId', e->>'id') as mid, coalesce(e->>'station', e->>'estacion', '') as st,
           coalesce(nullif(e->>'cantidad', '')::numeric, 1) as qty,
           coalesce(nullif(e->>'subtotal', '')::numeric,
                    coalesce(nullif(e->>'precio', '')::numeric, 0) * coalesce(nullif(e->>'cantidad', '')::numeric, 1)) as imp
    from o2
    cross join lateral jsonb_array_elements(
      case jsonb_typeof(o2.items) when 'array' then o2.items
           when 'string' then (o2.items #>> '{}')::jsonb else '[]'::jsonb end) e
    where e->>'nombre' is not null
  ),
  lin2 as (
    select l.*, coalesce(c.name, 'SIN CATEGORÍA') as grupo
    from lin l
    left join mi on mi.id = l.mid
    left join mi_nombre mn on mi.id is null and mn.name = l.nombre
    left join pos_menu_categories c on c.id = coalesce(mi.category_id, mn.category_id)
  ),
  lin3 as (
    select l.*,
      (l.st = 'barra' or upper(l.grupo) = any (k.beb)
        or (l.st = '' and l.nom ~ '(CAF[EÉ]|LATTE|CAP+UC+INO|AMERICANO|ESPRESSO|MATCHA|CHAI|JUGO|AGUA|REFRESCO|SODA|LIMONADA|SMOOTHIE|FRAP|MALTEADA|CERVEZA|VINO|MEZCAL|TEQUILA|MARGARITA|MOJITO|C[OÓ]CTEL|BEBIDA|COCA)')) as es_beb,
      exists (select 1 from unnest(k.hh) w where l.nom like '%' || w || '%') as es_hh,
      exists (select 1 from unnest(k.pan) w where l.nom like '%' || w || '%') as es_pan,
      exists (select 1 from unnest(k.postres) w where l.nom like '%' || w || '%') as es_postre
    from lin2 l, kw k
  ),
  bev as (select b.dia, b.mesero, b.id, sum(b.qty) filter (where b.es_beb) as n from lin3 b group by 1, 2, 3),
  bev2 as (select b.dia, b.mesero, sum(greatest(coalesce(b.n, 0) - 1, 0)) as extra from bev b group by 1, 2),
  cats as (
    select c.dia, c.mesero,
           coalesce(sum(c.qty) filter (where c.es_hh), 0) as hh,
           coalesce(sum(c.qty) filter (where c.es_pan), 0) as pan,
           coalesce(sum(c.qty) filter (where c.es_postre), 0) as postres
    from lin3 c group by 1, 2
  ),
  grp as (
    select s.dia, s.mesero, jsonb_object_agg(s.grupo, round(s.t)) as j
    from (select dia, mesero, grupo, sum(imp) t from lin3 group by 1, 2, 3) s group by 1, 2
  ),
  pla as (
    select s.dia, s.mesero, jsonb_object_agg(s.nombre, s.q) as j
    from (select dia, mesero, nombre, sum(qty) q from lin3 group by 1, 2, 3) s group by 1, 2
  ),
  k2 as (select dia, mesero, sum(total) as v, count(*) as tickets, sum(pers) as pers from o2 group by 1, 2),
  porm as (
    select k2.dia, k2.mesero,
      jsonb_build_object(
        'KPIs', jsonb_build_object('total_ventas', round(k2.v, 2), 'tickets', k2.tickets, 'mesas', k2.tickets,
                                   'personas', k2.pers, 'ticket_promedio', round(k2.v / nullif(k2.pers, 0), 2)),
        'H&H', coalesce(c.hh, 0), 'Pan', coalesce(c.pan, 0), 'Postres', coalesce(c.postres, 0),
        '2da Bebida', coalesce(b.extra, 0),
        '__por_mesero_grupo', coalesce(g.j, '{}'::jsonb), '__por_mesero_platillo', coalesce(p.j, '{}'::jsonb)
      ) as d
    from k2
    left join cats c on c.dia = k2.dia and c.mesero = k2.mesero
    left join bev2 b on b.dia = k2.dia and b.mesero = k2.mesero
    left join grp g on g.dia = k2.dia and g.mesero = k2.mesero
    left join pla p on p.dia = k2.dia and p.mesero = k2.mesero
  )
  select porm.dia, jsonb_object_agg(porm.mesero, porm.d) from porm group by porm.dia order by porm.dia desc;
end $$;
revoke all on function public.fs_meseros_categorias(text, date, date) from public, anon;
grant execute on function public.fs_meseros_categorias(text, date, date) to authenticated, service_role;
