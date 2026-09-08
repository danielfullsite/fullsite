-- ops_daily_desde_pos: dejar que el filtro por restaurante llegue hasta el indice.
--
-- EL PROBLEMA
--
-- La vista arma un CTE `base` sobre pos_orders y lo referencia CUATRO veces (agg,
-- meseros, pagos, platillos). Postgres, ante un CTE usado mas de una vez, lo MATERIALIZA:
-- lo calcula completo una sola vez y despues filtra. El `client_id=eq.amalay` que manda
-- PostgREST se aplica AFUERA, cuando ya se leyo todo.
--
-- Medido el 2026-09-08 en produccion:
--
--   pos_orders           128,161 filas de 10 restaurantes
--   de AMALAY                 36 filas
--   plan actual          Seq Scan sobre las 128,161, "Rows Removed by Filter: 128,124"
--   tiempo                   315 ms, 9,474 buffers, 6,105 bloques temp leidos (~48 MB)
--
-- No es una lentitud incomoda: PostgREST corre como `authenticator`, que tiene
-- statement_timeout=8s (service_role no lo sobrescribe, su rolconfig es NULL). Bajo carga
-- real la consulta cruza los 8 segundos y el servidor responde 500. El calificador de
-- predicciones —el unico bucle que mide la precision del sistema— llevaba 7 dias muriendo
-- asi, todos los dias a la misma hora, con GitHub Actions en verde.
--
-- Y no mejora solo: el costo crece con las filas de TODOS los restaurantes. Con mil
-- clientes esta vista es inservible para cualquiera de ellos.
--
-- EL CAMBIO
--
-- `NOT MATERIALIZED` obliga a Postgres a insertar el CTE en cada uso, y entonces si puede
-- empujar `client_id` hasta pos_orders_dia_venta_idx. Una palabra; el resto del SELECT es
-- identico, caracter por caracter.
--
--   plan nuevo           Index Scan using pos_orders_dia_venta_idx
--   tiempo                  0.64 ms  (492x mas rapido), 85 buffers, CERO archivos temp
--
-- EQUIVALENCIA COMPROBADA antes de escribir esto: EXCEPT en las dos direcciones sobre las
-- 412 filas de la vista, con las 12 columnas escalares, para los 10 restaurantes.
-- Diferencias: 0 y 0. `NOT MATERIALIZED` es una directiva al planeador, no cambia
-- semantica: `base` no tiene efectos secundarios ni funciones volatiles.
--
-- LO QUE ESTA MIGRACION NO ARREGLA
--
-- `fecha` se sigue calculando desde `created_at` en hora de Monterrey, ignorando la
-- columna `dia_venta`, que es la que respeta el dia de negocio de las 05:00. Hoy no hay
-- diferencia porque AMALAY no tiene ordenes despues de medianoche (comprobado: las tres
-- fechas con venta cuadran al centavo por las dos definiciones), pero para un restaurante
-- que cierre de madrugada esta vista va a partir las noches en dos. Va aparte, porque
-- cambiar la definicion de dia mueve numeros historicos y eso se decide, no se cuela en
-- una migracion de rendimiento.

CREATE OR REPLACE VIEW public.ops_daily_desde_pos AS
WITH base AS NOT MATERIALIZED (
  SELECT o.client_id,
         (o.created_at AT TIME ZONE 'America/Monterrey')::date AS fecha,
         o.mesero, o.metodo_pago, o.mesa, o.personas, o.total, o.subtotal,
         o.iva, o.descuento, o.propina, o.items, o.created_at
    FROM pos_orders o
   WHERE COALESCE(o.status, '') <> 'cancelada'
     AND o.client_id IS NOT NULL
     AND o.client_id <> ''
), agg AS (
  SELECT base.client_id, base.fecha,
         sum(base.total) AS ventas_dia,
         sum(COALESCE(base.subtotal, 0::numeric) + COALESCE(base.iva, 0::numeric)) AS ventas_brutas,
         sum(COALESCE(base.descuento, 0::numeric)) AS descuentos,
         sum(CASE WHEN base.metodo_pago ILIKE '%efec%' AND base.metodo_pago NOT ILIKE '%tarj%'
                  THEN base.total ELSE 0::numeric END) AS efectivo,
         sum(CASE WHEN base.metodo_pago ILIKE '%tarj%' AND base.metodo_pago NOT ILIKE '%efec%'
                  THEN base.total ELSE 0::numeric END) AS tarjeta,
         count(*)::integer AS tickets_count,
         count(DISTINCT base.mesa)::integer AS mesas_atendidas,
         sum(COALESCE(base.personas, 0))::integer AS personas_restaurant,
         sum(COALESCE(base.propina, 0::numeric)) AS propinas_total,
         max(base.created_at) AS ultima_orden
    FROM base
   GROUP BY base.client_id, base.fecha
), meseros AS (
  SELECT x.client_id, x.fecha,
         jsonb_agg(jsonb_build_object('nombre', x.mesero, 'total', x.t) ORDER BY x.t DESC) AS meseros
    FROM (SELECT base.client_id, base.fecha,
                 COALESCE(base.mesero, '(sin mesero)'::text) AS mesero,
                 sum(base.total) AS t
            FROM base
           GROUP BY base.client_id, base.fecha, COALESCE(base.mesero, '(sin mesero)'::text)) x
   GROUP BY x.client_id, x.fecha
), pagos AS (
  SELECT y.client_id, y.fecha,
         jsonb_object_agg(COALESCE(y.metodo_pago, '(sin metodo)'::text), y.t) AS pago_metodos
    FROM (SELECT base.client_id, base.fecha, base.metodo_pago, sum(base.total) AS t
            FROM base
           GROUP BY base.client_id, base.fecha, base.metodo_pago) y
   GROUP BY y.client_id, y.fecha
), platillos AS (
  SELECT w.client_id, w.fecha,
         jsonb_agg(jsonb_build_object('nombre', w.nombre, 'cantidad', w.qty, 'total', w.imp)
                   ORDER BY w.qty DESC) FILTER (WHERE w.rn <= 10) AS platillos_top
    FROM (SELECT z.client_id, z.fecha, z.nombre, z.qty, z.imp,
                 row_number() OVER (PARTITION BY z.client_id, z.fecha ORDER BY z.qty DESC) AS rn
            FROM (SELECT b.client_id, b.fecha,
                         it.value ->> 'nombre'::text AS nombre,
                         sum((it.value ->> 'cantidad'::text)::numeric) AS qty,
                         sum((it.value ->> 'subtotal'::text)::numeric) AS imp
                    FROM base b
                    CROSS JOIN LATERAL jsonb_array_elements(
                         CASE WHEN jsonb_typeof(b.items) = 'array'::text THEN b.items
                              ELSE '[]'::jsonb END) it(value)
                   WHERE it.value ? 'nombre'::text
                   GROUP BY b.client_id, b.fecha, it.value ->> 'nombre'::text) z) w
   GROUP BY w.client_id, w.fecha
)
SELECT NULL::bigint AS id,
       a.client_id,
       a.fecha,
       'cierre'::text AS record_type,
       NULL::timestamp with time zone AS bucket_start,
       a.ventas_dia,
       a.ventas_brutas,
       a.descuentos,
       0::numeric AS devoluciones,
       a.efectivo,
       a.tarjeta,
       a.tickets_count,
       a.mesas_atendidas,
       a.personas_restaurant,
       CASE WHEN a.tickets_count > 0
            THEN round(a.ventas_dia / a.tickets_count::numeric, 2)
            ELSE 0::numeric END AS ticket_promedio_restaurant,
       a.propinas_total,
       m.meseros,
       p.platillos_top,
       NULL::jsonb AS ventas_por_grupo,
       g.pago_metodos,
       'fullsite'::text AS source_system,
       a.ultima_orden AS generated_at,
       a.ultima_orden AS data_freshness,
       a.tickets_count AS rows_aggregated
  FROM agg a
  LEFT JOIN meseros   m ON m.client_id = a.client_id AND m.fecha = a.fecha
  LEFT JOIN platillos p ON p.client_id = a.client_id AND p.fecha = a.fecha
  LEFT JOIN pagos     g ON g.client_id = a.client_id AND g.fecha = a.fecha;
