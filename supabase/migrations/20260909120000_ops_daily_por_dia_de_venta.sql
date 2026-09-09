-- `ops_daily_desde_pos` agrupaba por el dia de CALENDARIO en Monterrey. Ahora agrupa
-- por el DIA DE VENTA del tenant.
--
-- QUE HACIA ANTES
--
--   (o.created_at at time zone 'America/Monterrey')::date AS fecha
--
-- Esa linea tiene dos defectos, y son independientes:
--
--   1. Clava la zona de Monterrey para TODOS los tenants. Hoy en produccion hay
--      restaurantes en America/Mexico_City y uno en America/Chicago — que en septiembre
--      va una hora adelante de Monterrey, porque Chicago observa horario de verano y
--      Monterrey dejo de observarlo en 2022.
--   2. No aplica el corte del dia de venta. Una orden de la 1 a.m. cae en el dia de
--      calendario siguiente, no en la noche que la produjo.
--
-- LA VERDAD YA EXISTIA
--
-- `pos_orders.dia_venta` la escribe la base por tenant, con SU zona y SU corte
-- (20260901180000_folio_por_dia_de_venta.sql:99). Esta vista la ignoraba y recalculaba
-- mal lo que el trigger ya calculaba bien.
--
-- CUANTO IMPORTA — medido el 2026-09-09 contra produccion, 30 dias, comparando la suma
-- de `pos_orders.total` agrupada por `dia_venta` contra `ops_daily_history.ventas_dia`:
--
--   tenant         dias   descuadran   diferencia maxima
--   lab-resto        31           28         $105,502.00
--   scyf-demo        24           22         $133,331.39
--   boruca           11           11           $2,235.00
--   amalay            3            0               $0.00
--   diezmex-demo     20            0               $0.00
--   tekila-rg        20            0               $0.00
--
-- Los que cierran en $0.00 son exactamente los tenants sin ventas entre las 00 y las 04
-- horas — o, en el caso de amalay, cuyas dos ordenes de madrugada estan canceladas y la
-- vista ya las excluia. Eso aisla la causa al corte del dia y descarta cualquier otra.
--
-- LOS NUMEROS DIARIOS CAMBIAN. ESO ES LA CORRECCION, NO UNA REGRESION.
-- Para los tenants con venta de madrugada, el cierre de un dia deja de incluir la
-- madrugada del dia siguiente y pasa a incluir la propia. El total del periodo no se
-- mueve; se mueve el dia al que se le atribuye cada orden. Es la misma regla que ya usan
-- el folio, el corte de caja y `ops_hourly` / `ops_personal`.
--
-- INVARIANTE QUE SE VERIFICO ANTES DE ESCRIBIR ESTO
-- `dia_venta` esta poblada al 100% (0 nulos en 128,200 ordenes) y es 100% reproducible
-- desde la config vigente de cada tenant: cero filas donde `dia_venta` difiera de
-- `((created_at at time zone clients.timezone) - clients.business_day_start_local)::date`.
-- Aun asi la vista filtra `dia_venta is not null`: si manana entrara una orden sin dia de
-- venta, dejarla fuera es correcto y contarla en un dia equivocado no lo es.
--
-- REVERSA: la definicion anterior esta en
-- supabase/migrations/20260826_ops_daily_fuente_viva.sql (la ultima que corre de las dos
-- que definen esta vista; la otra es 20260826120000_ops_daily_desde_pos.sql).
--
-- LO QUE ESTE PR NO TOCA, A PROPOSITO
-- `ops_daily_live.pipeline_fresh` sigue comparando contra
-- `(now() at time zone 'America/Monterrey')::date - 1`, o sea sigue clavando Monterrey.
-- Es el mismo defecto de zona pero sobre una ventana de dos dias, donde una hora de sesgo
-- casi nunca cambia el resultado. Es una bandera de frescura, no una cifra de dinero, y
-- moverla cambiaria una senal que leen los agentes sin evidencia de que hoy este mal.
-- Queda anotado, no arreglado: un problema por rama.
--
-- APLICADO EN PRODUCCION EL 2026-09-09. Esta definicion se alineo con la que estaba
-- viva en la base, que traia tres cosas que NINGUNA migracion del repositorio produce:
-- `not materialized`, desempates deterministas en los agregados JSONB
-- (`order by t desc, mesero` y `order by qty desc, nombre`) y el filtro de `dividida`.
-- Alguien las aplico con SQL fuera de git. Aplicar la version anterior de este archivo
-- las habria borrado en silencio; los desempates importan porque sin ellos dos meseros
-- empatados salen en orden arbitrario y el JSONB cambia entre consultas.
--
-- Tambien se agrego `security_invoker = on`, que esta vista NO tenia aunque
-- `ops_daily_history` y `ops_daily_live` —que leen de ella— si. Como la posee `postgres`
-- (rolbypassrls = true), corria como dueno y se saltaba el RLS de `pos_orders` para
-- cualquier usuario `authenticated`: la fuga de #104 seguia abierta en el eslabon de
-- abajo. Verificado despues de aplicar: anon no lee y las tres vistas traen la opcion.

create or replace view public.ops_daily_desde_pos
with (security_invoker = on) as
with base as not materialized (
  select o.client_id,
         -- Antes: (o.created_at at time zone 'America/Monterrey')::date
         o.dia_venta as fecha,
         o.mesero, o.metodo_pago, o.mesa, o.personas,
         o.total, o.subtotal, o.iva, o.descuento, o.propina, o.items,
         o.created_at
  from public.pos_orders o
  -- `dividida` no existe hoy en produccion (0 filas: cerrada, cancelada, enviada,
  -- abierta, entregada). Se agrega para que el filtro sea IDENTICO al de `ops_hourly` y
  -- `ops_personal`, que ya la excluyen. Hoy no mueve un solo peso; evita que el dia
  -- que ese estado aparezca, las tres piezas del contrato empiecen a discrepar en
  -- silencio por criterios de filtrado distintos.
  where coalesce(o.status, '') <> all (array['cancelada', 'dividida'])
    and o.client_id is not null
    and o.client_id <> ''          -- hay ordenes huerfanas con client_id vacio
    and o.dia_venta is not null
),
agg as (
  select client_id, fecha,
         sum(total)                                        as ventas_dia,
         sum(coalesce(subtotal,0) + coalesce(iva,0))       as ventas_brutas,
         sum(coalesce(descuento,0))                        as descuentos,
         sum(case when metodo_pago ilike '%efec%' and metodo_pago not ilike '%tarj%'
                  then total else 0 end)                   as efectivo,
         sum(case when metodo_pago ilike '%tarj%' and metodo_pago not ilike '%efec%'
                  then total else 0 end)                   as tarjeta,
         count(*)::int                                     as tickets_count,
         count(distinct mesa)::int                         as mesas_atendidas,
         sum(coalesce(personas,0))::int                    as personas_restaurant,
         sum(coalesce(propina,0))                          as propinas_total,
         max(created_at)                                   as ultima_orden
  from base group by 1,2
),
meseros as (
  select client_id, fecha,
         jsonb_agg(jsonb_build_object('nombre', mesero, 'total', t) order by t desc, mesero) as meseros
  from (select client_id, fecha, coalesce(mesero, '(sin mesero)') as mesero, sum(total) as t
        from base group by 1,2,3) x
  group by 1,2
),
pagos as (
  select client_id, fecha,
         jsonb_object_agg(coalesce(metodo_pago, '(sin metodo)'), t) as pago_metodos
  from (select client_id, fecha, metodo_pago, sum(total) as t from base group by 1,2,3) y
  group by 1,2
),
platillos as (
  select client_id, fecha,
         jsonb_agg(jsonb_build_object('nombre', nombre, 'cantidad', qty, 'total', imp)
                   order by qty desc, nombre) filter (where rn <= 10) as platillos_top
  from (
    select client_id, fecha, nombre, qty, imp,
           row_number() over (partition by client_id, fecha order by qty desc, nombre) as rn
    from (
      select b.client_id, b.fecha,
             it->>'nombre'                        as nombre,
             sum((it->>'cantidad')::numeric)      as qty,
             sum((it->>'subtotal')::numeric)      as imp
      from base b
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(b.items) = 'array' then b.items else '[]'::jsonb end) it
      where it ? 'nombre'
      group by 1,2,3
    ) z
  ) w group by 1,2
)
select
  null::bigint                                              as id,
  a.client_id,
  a.fecha,
  'cierre'::text                                            as record_type,
  null::timestamptz                                         as bucket_start,
  a.ventas_dia,
  a.ventas_brutas,
  a.descuentos,
  0::numeric                                                as devoluciones,
  a.efectivo,
  a.tarjeta,
  a.tickets_count,
  a.mesas_atendidas,
  a.personas_restaurant,
  case when a.tickets_count > 0
       then round(a.ventas_dia / a.tickets_count, 2) else 0 end as ticket_promedio_restaurant,
  a.propinas_total,
  m.meseros,
  p.platillos_top,
  -- `items` no trae categoria; agruparlo exigiria cruzar por nombre contra el menu, que
  -- es fragil. Se deja NULL a proposito, igual que antes.
  null::jsonb                                               as ventas_por_grupo,
  g.pago_metodos,
  'fullsite'::text                                          as source_system,
  a.ultima_orden                                            as generated_at,
  a.ultima_orden                                            as data_freshness,
  a.tickets_count                                           as rows_aggregated
from agg a
left join meseros   m on m.client_id = a.client_id and m.fecha = a.fecha
left join platillos p on p.client_id = a.client_id and p.fecha = a.fecha
left join pagos     g on g.client_id = a.client_id and g.fecha = a.fecha;

comment on view public.ops_daily_desde_pos is
  'Contrato: cierre diario vivo desde pos_orders. El dia sale de pos_orders.dia_venta '
  '(zona del tenant + corte de las 05:00), NO de recalcular la zona. Misma regla que '
  'ops_hourly y ops_personal. Ver 20260909120000_ops_daily_por_dia_de_venta.sql.';

-- Las 24 columnas y sus tipos no cambian, asi que `ops_daily_history` y `ops_daily_live`
-- no se redefinen. Se reafirman los permisos porque CREATE OR REPLACE VIEW los conserva
-- pero un clon construido desde cero depende de que esten escritos.
alter view public.ops_daily_desde_pos set (security_invoker = on);
revoke all on public.ops_daily_desde_pos from public, anon;
grant select on public.ops_daily_desde_pos
  to authenticated, service_role, fullsite_agent, fullsite_readonly;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACION — debe devolver CERO filas. Cada fila es un dia que no cierra.
--
-- with esperado as (
--   select o.client_id, o.dia_venta as fecha, sum(coalesce(o.total,0)) as suma_ordenes
--   from public.pos_orders o
--   where coalesce(o.status,'') <> all (array['cancelada','dividida'])
--     and o.client_id is not null and o.client_id <> '' and o.dia_venta is not null
--   group by 1,2
-- )
-- select e.client_id, e.fecha, e.suma_ordenes, h.ventas_dia
-- from esperado e
-- join public.ops_daily_history h on h.client_id = e.client_id and h.fecha = e.fecha
-- where round(abs(h.ventas_dia - e.suma_ordenes), 2) > 0.01;
-- ─────────────────────────────────────────────────────────────────────────────
