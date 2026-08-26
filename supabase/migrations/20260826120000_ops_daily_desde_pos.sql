-- ops_daily desde el POS de Fullsite — cierre de deriva del baseline
--
-- Medido el 2026-08-26 por introspección read-only contra producción
-- (qjiomlvudfmzuvqvhwpk), comparado contra 00000000000000_baseline_esquema.sql (#123):
--
--   producción: 132 tablas · 11 vistas · 24 funciones propias · 345 políticas
--   baseline:   132 tablas · 10 vistas · 24 funciones propias · 345 políticas
--
-- Todo empata salvo tres vistas del pipeline de ops_daily:
--
--   1. `ops_daily_desde_pos` NO EXISTE en el repositorio — ni en el baseline ni en
--      ninguno de los 78 .sql. Agrega el cierre diario calculado directamente desde
--      `pos_orders`, que es lo que hace que el pipeline sirva datos del POS de Fullsite
--      y no sólo de la tabla histórica.
--   2. `ops_daily_history` en el baseline lee SÓLO de `ops_daily`. En producción une
--      `ops_daily_desde_pos` (prioridad 1) con `ops_daily` (prioridad 2), quedándose con
--      la primera por (client_id, fecha).
--   3. `ops_daily_live` en el baseline trae `true AS pipeline_fresh` — clavado. En
--      producción se calcula contra la fecha. Un clon construido desde el repositorio
--      reportaría el pipeline siempre fresco, aunque llevara días muerto.
--
-- Las definiciones de abajo son las que devuelve `pg_get_viewdef()` en producción,
-- no transcripción a mano.
--
-- Orden obligatorio: desde_pos → history → live (cada una depende de la anterior).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ops_daily_desde_pos — cierre diario calculado desde pos_orders
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.ops_daily_desde_pos AS
 WITH base AS (
         SELECT o.client_id,
            (o.created_at AT TIME ZONE 'America/Monterrey'::text)::date AS fecha,
            o.mesero,
            o.metodo_pago,
            o.mesa,
            o.personas,
            o.total,
            o.subtotal,
            o.iva,
            o.descuento,
            o.propina,
            o.items,
            o.created_at
           FROM pos_orders o
          WHERE COALESCE(o.status, ''::text) <> 'cancelada'::text AND o.client_id IS NOT NULL AND o.client_id <> ''::text
        ), agg AS (
         SELECT base.client_id,
            base.fecha,
            sum(base.total) AS ventas_dia,
            sum(COALESCE(base.subtotal, 0::numeric) + COALESCE(base.iva, 0::numeric)) AS ventas_brutas,
            sum(COALESCE(base.descuento, 0::numeric)) AS descuentos,
            sum(
                CASE
                    WHEN base.metodo_pago ~~* '%efec%'::text AND base.metodo_pago !~~* '%tarj%'::text THEN base.total
                    ELSE 0::numeric
                END) AS efectivo,
            sum(
                CASE
                    WHEN base.metodo_pago ~~* '%tarj%'::text AND base.metodo_pago !~~* '%efec%'::text THEN base.total
                    ELSE 0::numeric
                END) AS tarjeta,
            count(*)::integer AS tickets_count,
            count(DISTINCT base.mesa)::integer AS mesas_atendidas,
            sum(COALESCE(base.personas, 0))::integer AS personas_restaurant,
            sum(COALESCE(base.propina, 0::numeric)) AS propinas_total,
            max(base.created_at) AS ultima_orden
           FROM base
          GROUP BY base.client_id, base.fecha
        ), meseros AS (
         SELECT x.client_id,
            x.fecha,
            jsonb_agg(jsonb_build_object('nombre', x.mesero, 'total', x.t) ORDER BY x.t DESC) AS meseros
           FROM ( SELECT base.client_id,
                    base.fecha,
                    COALESCE(base.mesero, '(sin mesero)'::text) AS mesero,
                    sum(base.total) AS t
                   FROM base
                  GROUP BY base.client_id, base.fecha, (COALESCE(base.mesero, '(sin mesero)'::text))) x
          GROUP BY x.client_id, x.fecha
        ), pagos AS (
         SELECT y.client_id,
            y.fecha,
            jsonb_object_agg(COALESCE(y.metodo_pago, '(sin metodo)'::text), y.t) AS pago_metodos
           FROM ( SELECT base.client_id,
                    base.fecha,
                    base.metodo_pago,
                    sum(base.total) AS t
                   FROM base
                  GROUP BY base.client_id, base.fecha, base.metodo_pago) y
          GROUP BY y.client_id, y.fecha
        ), platillos AS (
         SELECT w.client_id,
            w.fecha,
            jsonb_agg(jsonb_build_object('nombre', w.nombre, 'cantidad', w.qty, 'total', w.imp) ORDER BY w.qty DESC) FILTER (WHERE w.rn <= 10) AS platillos_top
           FROM ( SELECT z.client_id,
                    z.fecha,
                    z.nombre,
                    z.qty,
                    z.imp,
                    row_number() OVER (PARTITION BY z.client_id, z.fecha ORDER BY z.qty DESC) AS rn
                   FROM ( SELECT b.client_id,
                            b.fecha,
                            it.value ->> 'nombre'::text AS nombre,
                            sum((it.value ->> 'cantidad'::text)::numeric) AS qty,
                            sum((it.value ->> 'subtotal'::text)::numeric) AS imp
                           FROM base b
                             CROSS JOIN LATERAL jsonb_array_elements(
                                CASE
                                    WHEN jsonb_typeof(b.items) = 'array'::text THEN b.items
                                    ELSE '[]'::jsonb
                                END) it(value)
                          WHERE it.value ? 'nombre'::text
                          GROUP BY b.client_id, b.fecha, (it.value ->> 'nombre'::text)) z) w
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
        CASE
            WHEN a.tickets_count > 0 THEN round(a.ventas_dia / a.tickets_count::numeric, 2)
            ELSE 0::numeric
        END AS ticket_promedio_restaurant,
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
     LEFT JOIN meseros m ON m.client_id = a.client_id AND m.fecha = a.fecha
     LEFT JOIN platillos p ON p.client_id = a.client_id AND p.fecha = a.fecha
     LEFT JOIN pagos g ON g.client_id = a.client_id AND g.fecha = a.fecha;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ops_daily_history — une el cierre del POS con el histórico
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.ops_daily_history AS
 SELECT DISTINCT ON (client_id, fecha) id,
    client_id,
    fecha,
    record_type,
    bucket_start,
    ventas_dia,
    ventas_brutas,
    descuentos,
    devoluciones,
    efectivo,
    tarjeta,
    tickets_count,
    mesas_atendidas,
    personas_restaurant,
    ticket_promedio_restaurant,
    propinas_total,
    meseros,
    platillos_top,
    ventas_por_grupo,
    pago_metodos,
    source_system,
    generated_at,
    data_freshness,
    rows_aggregated
   FROM ( SELECT 1 AS prioridad,
            v.id,
            v.client_id,
            v.fecha,
            v.record_type,
            v.bucket_start,
            v.ventas_dia,
            v.ventas_brutas,
            v.descuentos,
            v.devoluciones,
            v.efectivo,
            v.tarjeta,
            v.tickets_count,
            v.mesas_atendidas,
            v.personas_restaurant,
            v.ticket_promedio_restaurant,
            v.propinas_total,
            v.meseros,
            v.platillos_top,
            v.ventas_por_grupo,
            v.pago_metodos,
            v.source_system,
            v.generated_at,
            v.data_freshness,
            v.rows_aggregated
           FROM ops_daily_desde_pos v
        UNION ALL
         SELECT 2 AS prioridad,
            d.id,
            d.client_id,
            d.fecha,
            d.record_type,
            d.bucket_start,
            d.ventas_dia,
            d.ventas_brutas,
            d.descuentos,
            d.devoluciones,
            d.efectivo,
            d.tarjeta,
            d.tickets_count,
            d.mesas_atendidas,
            d.personas_restaurant,
            d.ticket_promedio_restaurant,
            d.propinas_total,
            d.meseros,
            d.platillos_top,
            d.ventas_por_grupo,
            d.pago_metodos,
            d.source_system,
            d.generated_at,
            d.data_freshness,
            d.rows_aggregated
           FROM ops_daily d
          WHERE d.record_type = ANY (ARRAY['cierre'::text, 'cierre_wansoft'::text])) u
  ORDER BY client_id, fecha, prioridad;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ops_daily_live — frescura calculada, no clavada
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.ops_daily_live AS
 SELECT id,
    client_id,
    fecha,
    record_type,
    bucket_start,
    ventas_dia,
    ventas_brutas,
    descuentos,
    devoluciones,
    efectivo,
    tarjeta,
    tickets_count,
    mesas_atendidas,
    personas_restaurant,
    ticket_promedio_restaurant,
    propinas_total,
    meseros,
    platillos_top,
    ventas_por_grupo,
    pago_metodos,
    source_system,
    generated_at,
    data_freshness,
    rows_aggregated,
    fecha >= ((now() AT TIME ZONE 'America/Monterrey'::text)::date - 1) AS pipeline_fresh
   FROM ops_daily_history h;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seguridad — que un clon nazca con el mismo aislamiento que producción
--
-- `security_invoker = on` es lo que cierra la fuga entre restaurantes: sin él la vista
-- corre como su dueño y se salta el RLS de las tablas base (PR #104: un usuario de
-- boruca veía 1,415 días de 5 restaurantes). Con él corre como quien consulta.
--
-- Comprobado en producción el 2026-08-26: `anon` recibe permission denied en las 11
-- vistas; `authenticated`, `service_role`, `fullsite_agent` y `fullsite_readonly` leen.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER VIEW public.ops_daily_desde_pos SET (security_invoker = on);
ALTER VIEW public.ops_daily_history   SET (security_invoker = on);
ALTER VIEW public.ops_daily_live      SET (security_invoker = on);

REVOKE ALL ON public.ops_daily_desde_pos FROM PUBLIC, anon;
REVOKE ALL ON public.ops_daily_history   FROM PUBLIC, anon;
REVOKE ALL ON public.ops_daily_live      FROM PUBLIC, anon;

GRANT SELECT ON public.ops_daily_desde_pos TO authenticated, service_role, fullsite_agent, fullsite_readonly;
GRANT SELECT ON public.ops_daily_history   TO authenticated, service_role, fullsite_agent, fullsite_readonly;
GRANT SELECT ON public.ops_daily_live      TO authenticated, service_role, fullsite_agent, fullsite_readonly;
