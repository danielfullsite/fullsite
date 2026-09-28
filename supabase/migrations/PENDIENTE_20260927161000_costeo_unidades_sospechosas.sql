-- Costeo robusto a un error de captura REAL del catálogo (medido en AMALAY 2026-09-27):
-- 22 insumos con unidad "GR" a $529 promedio y 37 con "ML" a $157 — son precios por
-- KILO / LITRO etiquetados como gramo / mililitro. Con eso un Chai salía en $19,000.
-- Regla: si la unidad del insumo es g/ml y cuesta > $1 por unidad (= más de $1,000 el
-- kg o L; ej. "AGUA MINERAL" a $15.90 por ML), se asume que el
-- precio es por kg/L. La línea se marca 'unidad_corregida' y se cuenta, para que el
-- dueño vea y arregle su catálogo — no se esconde.

create or replace function public.fs_unidad(p text, out familia text, out factor numeric)
language sql immutable as $$
  select case
           when u in ('kg','kgs','kilo','kilos','k') then 'masa' when u in ('g','gr','grs','gramo','gramos') then 'masa'
           when u in ('l','lt','lts','litro','litros') then 'vol' when u in ('ml','mls') then 'vol'
           else 'pieza' end,
         case when u in ('kg','kgs','kilo','kilos','k','l','lt','lts','litro','litros') then 1000 else 1 end
  from (select lower(trim(coalesce(p, ''))) as u) x
$$;

-- Factor efectivo del costo del insumo (corrige g/ml con precio de kg/L).
create or replace function public.fs_factor_costo(p_unidad text, p_costo numeric, out factor numeric, out corregida boolean)
language sql immutable as $$
  select case when u.familia in ('masa', 'vol') and u.factor = 1 and coalesce(p_costo, 0) > 1 then 1000 else u.factor end,
         (u.familia in ('masa', 'vol') and u.factor = 1 and coalesce(p_costo, 0) > 1)
  from fs_unidad(p_unidad) u
$$;

drop function if exists public.fs_food_cost(text);
create function public.fs_food_cost(p_client_id text)
returns table (platillo text, precio numeric, costo numeric, ingredientes jsonb, lineas int, lineas_sin_costo int, lineas_corregidas int)
language sql stable security definer set search_path = public as $$
with l as (
  select mi.name as platillo, mi.price as precio, i.name as insumo, rl.quantity, rl.recipe_unit, i.cost_per_unit, i.unit,
         fc.corregida,
         case when ru.familia = iu.familia and fc.factor > 0 and i.cost_per_unit is not null
              then rl.quantity * ru.factor / fc.factor * i.cost_per_unit end as costo_linea
  from pos_recipe_versions rv
  join pos_menu_items mi on mi.id = rv.menu_item_id and mi.client_id = rv.client_id
  join pos_recipe_lines rl on rl.recipe_version_id = rv.id
  left join pos_ingredients i on i.id = rl.ingredient_id
  cross join lateral fs_unidad(rl.recipe_unit) ru
  cross join lateral fs_unidad(i.unit) iu
  cross join lateral fs_factor_costo(i.unit, i.cost_per_unit) fc
  where rv.client_id = p_client_id and rv.active
)
select l.platillo, max(l.precio), round(coalesce(sum(l.costo_linea), 0), 2),
       jsonb_agg(jsonb_build_object('nombre', l.insumo, 'um', l.recipe_unit, 'porcion', l.quantity,
                                    'costo_um', l.cost_per_unit, 'unidad_costo', l.unit,
                                    'total', round(l.costo_linea, 2), 'unidad_corregida', coalesce(l.corregida, false))
                 order by l.costo_linea desc nulls last),
       count(*)::int,
       (count(*) filter (where l.costo_linea is null))::int,
       (count(*) filter (where l.corregida))::int
from l
group by l.platillo
order by l.platillo
$$;
revoke all on function public.fs_food_cost(text) from public, anon, authenticated;
grant execute on function public.fs_food_cost(text) to service_role;

-- fs_receta (Chat IA): misma corrección.
do $$
declare def text;
begin
  def := pg_get_functiondef('public.fs_receta(text,text)'::regprocedure);
  def := replace(def, 'case when ru.familia = iu.familia and iu.factor > 0',
                      'case when ru.familia = iu.familia and (fs_factor_costo(i.unit, i.cost_per_unit)).factor > 0');
  def := replace(def, 'round(rl.quantity * ru.factor / iu.factor * i.cost_per_unit, 2)',
                      'round(rl.quantity * ru.factor / (fs_factor_costo(i.unit, i.cost_per_unit)).factor * i.cost_per_unit, 2)');
  if position('fs_factor_costo' in def) = 0 then raise exception 'fs_receta: patrón no encontrado'; end if;
  execute def;
end $$;
