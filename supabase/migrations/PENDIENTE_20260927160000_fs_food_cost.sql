-- Food cost desde las FICHAS TÉCNICAS de Fullsite (pos_recipe_versions activas +
-- pos_recipe_lines + pos_ingredients), no desde wansoft_recipes. Costo por platillo =
-- suma de líneas con conversión de unidades (fs_unidad). `lineas_sin_costo` dice
-- cuántos ingredientes no tienen costo o tienen unidades incompatibles: un food cost
-- con huecos NO se presenta como si estuviera completo.
create or replace function public.fs_food_cost(p_client_id text)
returns table (platillo text, precio numeric, costo numeric, ingredientes jsonb, lineas int, lineas_sin_costo int)
language sql stable security definer set search_path = public as $$
with l as (
  select mi.name as platillo, mi.price as precio, i.name as insumo, rl.quantity, rl.recipe_unit, i.cost_per_unit,
         case when ru.familia = iu.familia and iu.factor > 0 and i.cost_per_unit is not null
              then rl.quantity * ru.factor / iu.factor * i.cost_per_unit end as costo_linea
  from pos_recipe_versions rv
  join pos_menu_items mi on mi.id = rv.menu_item_id and mi.client_id = rv.client_id
  join pos_recipe_lines rl on rl.recipe_version_id = rv.id
  left join pos_ingredients i on i.id = rl.ingredient_id
  cross join lateral fs_unidad(rl.recipe_unit) ru
  cross join lateral fs_unidad(i.unit) iu
  where rv.client_id = p_client_id and rv.active
)
select l.platillo, max(l.precio), round(coalesce(sum(l.costo_linea), 0), 2),
       jsonb_agg(jsonb_build_object('nombre', l.insumo, 'um', l.recipe_unit, 'porcion', l.quantity,
                                    'costo_um', l.cost_per_unit, 'total', round(l.costo_linea, 2))
                 order by l.costo_linea desc nulls last),
       count(*)::int, (count(*) filter (where l.costo_linea is null))::int
from l
group by l.platillo
order by l.platillo
$$;
revoke all on function public.fs_food_cost(text) from public, anon, authenticated;
grant execute on function public.fs_food_cost(text) to service_role;
