-- Capa 1 del contrato de datos: las dos vistas que faltaban.
--
-- POR QUE EXISTEN
-- docs/ai/ARQUITECTURA-CRUCE.md define un contrato de vistas que responden preguntas de
-- negocio, con la regla "ningun agente lee una tabla cruda". De las cuatro, solo
-- `ops_daily_history` existia. Estas son dos de las tres que faltaban:
--
--   ops_hourly    -> como va el dia por hora
--   ops_personal  -> quien trabajo, cuando, y que vendio
--
-- (`ops_consumo` sigue pendiente: necesita que un restaurante corra ventas E inventario
--  sobre Fullsite, que es el desbloqueo del laboratorio.)
--
-- Habilitan los tres cruces que la matriz del documento marca como posibles HOY con datos
-- vivos: venta x hora x mesero, metodo de pago x propina x mesero, y tiempo de mesa x
-- ticket. Los tres alimentan tanto al analista como al tablero de alertas.
--
-- MULTI-TENANT
-- Ninguna vista filtra por un cliente. Agrupan por client_id y el consumidor filtra. No
-- hay un solo nombre de restaurante en este archivo, a proposito.

-- ---------------------------------------------------------------------------
-- Base compartida
-- ---------------------------------------------------------------------------
-- Tres decisiones que valen mas que el SQL que las implementa:
--
-- 1) El dia sale de `dia_venta`, NO de recalcular la zona horaria.
--    `dia_venta` la escribe la base por tenant, con SU zona y SU corte de las 05:00
--    (20260901180000_folio_por_dia_de_venta.sql:99). Recalcular aqui con una zona fija
--    seria volver a clavar Monterrey para todos, justo lo que ese trigger resolvio.
--
--    NOTA DE INCONSISTENCIA CONOCIDA, no corregida aqui a proposito:
--    `ops_daily_desde_pos` si usa `(created_at at time zone 'America/Monterrey')::date`,
--    sin corte. Por eso cuenta las ordenes de madrugada en el dia calendario y no en el
--    dia de venta. Medido el 2026-09-09 sobre 30 dias: difieren 28,890 de 83,773 ordenes
--    en un tenant y 530 de 3,082 en otro, todas entre las 00 y las 04 horas. Es un
--    descuadre de nivel 4 (el dia contra sus partes) y merece su propio PR; mezclarlo
--    aqui rompe la regla de un problema por rama.
--
-- 2) Se excluye lo mismo que excluye `ops_daily_desde_pos`: cancelada y dividida. Que las
--    piezas del contrato no discrepen entre si por criterios distintos de filtrado.
--
-- 3) El metodo de pago se lee de `metodo_pago` y, cuando viene vacio, del primer elemento
--    del arreglo `pagos`. Sin esto un tenant entero queda ciego: medido el 2026-09-09,
--    uno tiene 2,396 ordenes con `metodo_pago` NULL y el metodo unicamente dentro de
--    `pagos`. El contrato existe justamente para que esa diferencia de captura no llegue
--    a los agentes.

create or replace view public.ops_hourly as
with base as not materialized (
  select
    o.client_id,
    o.dia_venta,
    o.location_id,
    extract(hour from (o.created_at at time zone coalesce(c.timezone, 'America/Monterrey')))::int as hora,
    o.total,
    o.personas,
    o.mesa
  from public.pos_orders o
  left join public.clients c on c.id = o.client_id
  where coalesce(o.status, '') <> all (array['cancelada', 'dividida'])
    and o.client_id is not null and o.client_id <> ''
    and o.dia_venta is not null
)
select
  client_id,
  dia_venta,
  hora,
  location_id,
  count(*)::int                                  as tickets,
  sum(coalesce(total, 0))                        as ventas,
  sum(coalesce(personas, 0))::int                as personas,
  count(distinct mesa)::int                      as mesas,
  case when count(*) > 0
       then round(sum(coalesce(total, 0)) / count(*), 2)
       else 0 end                                as ticket_promedio
from base
group by client_id, dia_venta, hora, location_id;

comment on view public.ops_hourly is
  'Contrato Capa 1: como va el dia por hora, por tenant y sucursal. La hora se calcula con '
  'la zona del tenant (clients.timezone); el dia sale de pos_orders.dia_venta, que ya trae '
  'el corte de las 05:00. Sustituye a las curvas horarias hardcodeadas en agent_common.py '
  'y close_predictor.py. Ver docs/ai/ARQUITECTURA-CRUCE.md, Capas 1 y 2.';

-- ---------------------------------------------------------------------------
-- ops_personal — quien trabajo, cuando, y que vendio
-- ---------------------------------------------------------------------------
-- Ademas del ranking, lleva las dos senales antifraude que el documento marca como
-- construibles hoy (mezcla de efectivo por mesero, y porcentaje de propina por mesero) y
-- el tiempo de mesa.
--
-- EL TIEMPO DE MESA SE LIMPIA, Y SE DICE CUANTO SE LIMPIO.
-- `closed_at - created_at` crudo no es tiempo de mesa: incluye ordenes que nadie cerro en
-- el POS hasta el dia siguiente, y ordenes con closed_at ANTERIOR a created_at. Medido el
-- 2026-09-09 sobre 30 dias, la diferencia no es cosmetica:
--
--   tenant      mediana cruda     mediana limpia
--   amalay      1,299.5 min       12.8 min        <- 100x
--   lab-resto      37.6 min       33.6 min
--
-- Un agente que lea la cruda reporta "las mesas duran 21 horas" y quema su credibilidad
-- en la primera alerta. Por eso:
--   - se descarta lo imposible (negativo, o mas de 8 horas en una mesa),
--   - se usa la MEDIANA y no el promedio, que un solo outlier de 41 horas desplaza,
--   - y se publica cuantas ordenes se descartaron, para que el consumidor sepa si el
--     numero se apoya en 3 ordenes o en 300.
-- Descartar en silencio seria el mismo error, con mejor cara.

create or replace view public.ops_personal as
with base as not materialized (
  select
    o.client_id,
    o.dia_venta,
    o.location_id,
    coalesce(nullif(trim(o.mesero), ''), '(sin mesero)') as mesero,
    o.total,
    o.propina,
    o.personas,
    o.mesa,
    coalesce(
      nullif(trim(o.metodo_pago), ''),
      case when jsonb_typeof(o.pagos) = 'array' and jsonb_array_length(o.pagos) > 0
           then o.pagos -> 0 ->> 'metodo' end
    ) as metodo,
    case
      when o.closed_at is null then null
      else extract(epoch from (o.closed_at - o.created_at)) / 60.0
    end as minutos_mesa
  from public.pos_orders o
  where coalesce(o.status, '') <> all (array['cancelada', 'dividida'])
    and o.client_id is not null and o.client_id <> ''
    and o.dia_venta is not null
),
marcado as (
  select
    b.*,
    -- Una mesa de restaurante no dura mas de 8 horas ni menos de cero. Fuera de ese
    -- rango no es un tiempo lento: es una orden que nadie cerro, o un reloj torcido.
    (b.minutos_mesa is not null and b.minutos_mesa >= 0 and b.minutos_mesa <= 480) as tiempo_valido
  from base b
)
select
  client_id,
  dia_venta,
  mesero,
  location_id,
  count(*)::int                                          as tickets,
  sum(coalesce(total, 0))                                as ventas,
  sum(coalesce(personas, 0))::int                        as personas,
  count(distinct mesa)::int                              as mesas,
  case when count(*) > 0
       then round(sum(coalesce(total, 0)) / count(*), 2)
       else 0 end                                        as ticket_promedio,

  -- Senal antifraude 1 — la propina. Un mesero muy por debajo de sus companeros en
  -- propina declarada, con ventas normales, es la firma clasica del cobro por fuera.
  sum(coalesce(propina, 0))                              as propina_total,
  case when sum(coalesce(total, 0)) > 0
       then round(100 * sum(coalesce(propina, 0)) / sum(coalesce(total, 0)), 2)
       else null end                                     as pct_propina,

  -- Senal antifraude 2 — la mezcla de efectivo. El efectivo es lo unico que se puede
  -- desviar sin dejar rastro bancario; una mezcla anomala PARA ESE restaurante es el
  -- primer indicio. El umbral de "anomala" no vive aqui: esta vista da el numero, el
  -- detector lo compara contra el perfil del restaurante (Capa 2).
  sum(case when metodo ilike '%efec%' and metodo not ilike '%tarj%'
           then coalesce(total, 0) else 0 end)           as ventas_efectivo,
  sum(case when metodo ilike '%tarj%' and metodo not ilike '%efec%'
           then coalesce(total, 0) else 0 end)           as ventas_tarjeta,
  case when sum(coalesce(total, 0)) > 0
       then round(100 * sum(case when metodo ilike '%efec%' and metodo not ilike '%tarj%'
                                 then coalesce(total, 0) else 0 end)
                  / sum(coalesce(total, 0)), 2)
       else null end                                     as pct_efectivo,

  -- Tiempo de mesa, limpio y con su denominador a la vista.
  round(percentile_cont(0.5) within group (
        order by minutos_mesa) filter (where tiempo_valido)::numeric, 1) as tiempo_mesa_p50,
  round(percentile_cont(0.95) within group (
        order by minutos_mesa) filter (where tiempo_valido)::numeric, 1) as tiempo_mesa_p95,
  count(*) filter (where tiempo_valido)::int             as ordenes_con_tiempo,
  count(*) filter (where minutos_mesa is null)::int      as ordenes_sin_cierre,
  count(*) filter (where minutos_mesa is not null
                     and not tiempo_valido)::int         as ordenes_tiempo_descartado,

  -- Cobertura del metodo de pago. Sin esto, "0% efectivo" y "no se capturo el metodo"
  -- se leen igual, y son cosas opuestas.
  count(*) filter (where metodo is null)::int            as ordenes_sin_metodo
from marcado
group by client_id, dia_venta, mesero, location_id;

comment on view public.ops_personal is
  'Contrato Capa 1: quien trabajo, cuando y que vendio, por tenant y sucursal. Incluye las '
  'dos senales antifraude construibles hoy (pct_propina y pct_efectivo por mesero) y el '
  'tiempo de mesa limpio. El metodo de pago cae a pagos[0].metodo cuando metodo_pago viene '
  'vacio. Las columnas ordenes_sin_cierre / ordenes_tiempo_descartado / ordenes_sin_metodo '
  'son el denominador: publican cuanta de la senal falta, para que un cero por falta de '
  'captura no se confunda con un cero real. Ver docs/ai/ARQUITECTURA-CRUCE.md, Capas 1 y 3.';

-- ---------------------------------------------------------------------------
-- Permisos — mismo criterio que el resto del contrato: lectura por la API.
-- ---------------------------------------------------------------------------
grant select on public.ops_hourly    to anon, authenticated, service_role;
grant select on public.ops_personal  to anon, authenticated, service_role;
