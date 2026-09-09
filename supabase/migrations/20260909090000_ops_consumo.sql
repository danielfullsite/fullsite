-- Capa 1 del contrato: la tercera vista. Qué DEBIÓ consumirse según lo vendido.
--
-- POR QUÉ EXISTE
-- docs/ai/ARQUITECTURA-CRUCE.md llama a esto "el cruce más valioso del sistema":
--
--     Movimientos de salida = Σ(receta del platillo × cantidad vendida) ± merma declarada
--
-- Lo que sobra de esa resta es merma no declarada: producto que salió sin venderse. Esta
-- vista es el lado IZQUIERDO de la resta — el consumo teórico. El derecho ya existe
-- (`pos_inventory_movements`). Con las dos, el cruce se vuelve una consulta.
--
-- LA DEFINICIÓN NO ES NUEVA, ES LA DEL POS
-- Se lee de `pos_recipe_versions` (active) + `pos_recipe_lines`, que es lo que la
-- deducción de stock realmente usa — ver api/pos/recipe-sync/route.ts:5, donde se explica
-- que `pos_recipes_old` es la capa de EDICIÓN y se proyecta a la versionada. Usar la otra
-- daría un consumo teórico que no compara contra los movimientos que produjo el POS, y el
-- cruce mediría la diferencia entre dos definiciones en vez de merma.
--
-- La conversión a unidad de stock usa `convert_recipe_to_stock()`, la misma función que la
-- rebaja. Cuidado con la columna: la unidad canónica es `pos_inventory.stock_unit` (g, kg,
-- ml, lt, pz), NO `pos_ingredients.unit`, que es la del catálogo comercial (GRS, PZA, CAJ)
-- y con la que la conversión devuelve NULL siempre. Medido el 2026-09-09 contra la
-- correcta: 759/759 líneas convertibles en un tenant y 637/637 en otro.

create or replace view public.ops_consumo as
with vendido as not materialized (
  -- Una fila por línea vendida. `cantidad` puede venir ausente en capturas viejas; se
  -- asume 1 antes que descartar la venta, y eso se nota en `lineas` del resultado.
  select
    o.client_id,
    o.dia_venta,
    o.location_id,
    nullif(trim(i.value ->> 'menuItemId'), '') as menu_item_id,
    nullif(trim(i.value ->> 'nombre'), '')     as nombre,
    coalesce((i.value ->> 'cantidad')::numeric, 1) as cantidad
  from public.pos_orders o
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end
  ) i(value)
  where coalesce(o.status, '') <> all (array['cancelada', 'dividida'])
    and o.client_id is not null and o.client_id <> ''
    and o.dia_venta is not null
),
resuelto as (
  -- El platillo se resuelve por id y, si no viene, por nombre contra el menú.
  --
  -- El fallback no es cosmético: medido el 2026-09-09, los dos tenants con más volumen
  -- (15,705 y 11,124 líneas vendidas) traen `menuItemId` en el 0% de sus líneas y el
  -- nombre en el 100%. Sólo los tenants nuevos lo traen. Sin el fallback, esta vista
  -- quedaría ciega justo donde hay datos.
  select
    v.client_id, v.dia_venta, v.location_id, v.cantidad,
    coalesce(v.menu_item_id, mi.id::text) as menu_item_id
  from vendido v
  left join public.pos_menu_items mi
    on v.menu_item_id is null
   and mi.client_id = v.client_id
   and lower(trim(mi.name)) = lower(v.nombre)
),
con_receta as (
  select
    r.client_id, r.dia_venta, r.location_id, r.cantidad,
    rl.ingredient_id,
    rl.quantity   as qty_receta,
    rl.recipe_unit
  from resuelto r
  join public.pos_recipe_versions rv
    on rv.client_id = r.client_id and rv.menu_item_id = r.menu_item_id and rv.active
  join public.pos_recipe_lines rl
    on rl.recipe_version_id = rv.id
)
select
  c.client_id,
  c.dia_venta,
  c.location_id,
  c.ingredient_id,
  -- El nombre vive en `pos_ingredients`; `pos_inventory` sólo lleva existencias y unidad.
  ing.name                                        as ingrediente,
  c.recipe_unit,
  inv.stock_unit,

  -- Consumo teórico, en las dos unidades. La de receta siempre sale; la de stock sólo
  -- cuando la conversión existe, y NULL cuando no — nunca un cero, que se leería como
  -- "no se consumió" cuando significa "no se pudo convertir".
  sum(c.qty_receta * c.cantidad)                  as consumo_receta,
  sum(convert_recipe_to_stock(c.qty_receta * c.cantidad, c.recipe_unit, inv.stock_unit))
                                                  as consumo_stock,

  count(*)::int                                   as lineas,
  sum(c.cantidad)                                 as platillos_vendidos,

  -- Las sub-recetas NO cargan stock físico y la deducción las bloquea a propósito
  -- (lib/inventory.ts: "Sub-recipes do not carry physical stock"). Se marcan en vez de
  -- expandirse: expandir con recursión y yield en SQL duplicaría lo que cost-engine.ts ya
  -- hace probado. Importa saberlo — en un tenant son 95 de 637 líneas activas, y esas no
  -- van a tener contraparte en pos_inventory_movements.
  bool_or(c.ingredient_id like 'sub%')            as es_subreceta,

  -- Cobertura: sin esto, "consumo bajo" y "no se pudo calcular" se leen igual.
  count(*) filter (where inv.stock_unit is null)::int  as lineas_sin_unidad_stock,
  count(*) filter (
    where convert_recipe_to_stock(c.qty_receta * c.cantidad, c.recipe_unit, inv.stock_unit) is null
  )::int                                          as lineas_no_convertibles
from con_receta c
left join public.pos_inventory inv
  on inv.client_id = c.client_id and inv.ingredient_id = c.ingredient_id
left join public.pos_ingredients ing
  on ing.client_id = c.client_id and ing.id = c.ingredient_id
group by c.client_id, c.dia_venta, c.location_id, c.ingredient_id,
         ing.name, c.recipe_unit, inv.stock_unit;

comment on view public.ops_consumo is
  'Contrato Capa 1: que ingredientes DEBIERON consumirse segun lo vendido, por tenant, dia '
  'y sucursal. Es el lado teorico del cruce consumo x venta; el lado real es '
  'pos_inventory_movements, y la diferencia entre ambos es merma no declarada. Usa '
  'pos_recipe_versions(active) + pos_recipe_lines, la MISMA definicion que la deduccion de '
  'stock, y convert_recipe_to_stock() contra pos_inventory.stock_unit (NO contra '
  'pos_ingredients.unit, que es la del catalogo comercial y da NULL siempre). Las '
  'sub-recetas se marcan con es_subreceta y no se expanden: no cargan stock fisico y la '
  'deduccion las bloquea. consumo_stock en NULL significa que no se pudo convertir, no que '
  'no se consumio. Ver docs/ai/ARQUITECTURA-CRUCE.md, Capa 0 nivel 3.';

-- ---------------------------------------------------------------------------
-- ops_consumo_cobertura — cuanto de lo vendido tiene receta
-- ---------------------------------------------------------------------------
-- La vista de arriba solo puede hablar de lo que TIENE receta. Sin saber que fraccion de
-- las ventas es esa, cualquier comparacion contra los movimientos reales da un faltante
-- enorme que parece robo y es catalogo incompleto.
--
-- Medido el 2026-09-09: un tenant tiene 192 platillos con receta de 687 en su menu. Un
-- detector de merma que ignore ese denominador acusa a alguien por el 72% del menu que
-- nadie ha capturado.

create or replace view public.ops_consumo_cobertura as
with vendido as not materialized (
  select
    o.client_id, o.dia_venta,
    nullif(trim(i.value ->> 'menuItemId'), '') as menu_item_id,
    nullif(trim(i.value ->> 'nombre'), '')     as nombre,
    coalesce((i.value ->> 'cantidad')::numeric, 1) as cantidad,
    coalesce((i.value ->> 'subtotal')::numeric, 0) as importe
  from public.pos_orders o
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end
  ) i(value)
  where coalesce(o.status, '') <> all (array['cancelada', 'dividida'])
    and o.client_id is not null and o.client_id <> ''
    and o.dia_venta is not null
),
resuelto as (
  select
    v.*,
    coalesce(v.menu_item_id, mi.id::text) as mid
  from vendido v
  left join public.pos_menu_items mi
    on v.menu_item_id is null
   and mi.client_id = v.client_id
   and lower(trim(mi.name)) = lower(v.nombre)
)
select
  r.client_id,
  r.dia_venta,
  count(*)::int                                              as lineas_vendidas,
  count(*) filter (where rv.id is not null)::int             as lineas_con_receta,
  round(100.0 * count(*) filter (where rv.id is not null) / nullif(count(*), 0), 1)
                                                             as pct_lineas_con_receta,
  sum(r.importe)                                             as importe_vendido,
  sum(r.importe) filter (where rv.id is not null)            as importe_con_receta,
  round(100.0 * coalesce(sum(r.importe) filter (where rv.id is not null), 0)
        / nullif(sum(r.importe), 0), 1)                      as pct_importe_con_receta,
  count(distinct r.nombre) filter (where rv.id is null)::int as platillos_sin_receta
from resuelto r
left join public.pos_recipe_versions rv
  on rv.client_id = r.client_id and rv.menu_item_id = r.mid and rv.active
group by r.client_id, r.dia_venta;

comment on view public.ops_consumo_cobertura is
  'Contrato Capa 1: que fraccion de lo vendido tiene receta activa, por tenant y dia. Es el '
  'denominador obligatorio de ops_consumo. Sin el, un detector de merma compara el consumo '
  'teorico de una parte del menu contra los movimientos reales de TODO el menu, y el '
  'faltante resultante parece robo cuando es catalogo incompleto.';

grant select on public.ops_consumo           to anon, authenticated, service_role;
grant select on public.ops_consumo_cobertura to anon, authenticated, service_role;
