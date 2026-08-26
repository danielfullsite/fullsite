-- Los agentes de IA leían una tabla que dejó de alimentarse hace semanas.
--
-- SÍNTOMA MEDIDO (2026-08-26): 283 corridas en estado `no_data` en 14 días, de OCHO
-- agentes que no produjeron absolutamente nada. Sus propias razones lo dicen:
--
--   upselling          → "wansoft_kpis empty"
--   close-predictor    → "no KPI data for today"
--   anomaly-detector   → "no_today_kpis"
--   waste-detector     → "wansoft_daily returned 0 rows"
--   tips-analyzer      → "no wansoft_daily rows in last 7 days"
--   antifraud-agent    → "only 0 days available, need 3+"
--   menu-engineering   → "only 0 days available, need 7+"
--   staffing-optimizer → "only 0 days available, need 7+"
--
-- CAUSA RAÍZ
-- `ops_daily_live` y `ops_daily_history` leían `FROM ops_daily`, la tabla que el propio
-- CLAUDE.md declara muerta. Los agentes no estaban imprecisos: estaban sin comer.
--
-- Y lo que importa para vender: aunque mañana entre un cliente nuevo con el POS de
-- Fullsite funcionando, esos ocho agentes seguirían callados, porque su fuente sólo
-- tuvo datos de AMALAY vía un scraper que murió el 13 de julio.
--
-- SOLUCIÓN: UNION, NO REEMPLAZO
-- Se agrega `pos_orders` como fuente viva, conservando `ops_daily` como histórico.
-- Reemplazar en vez de unir habría borrado el pasado de AMALAY, que tiene CERO filas en
-- pos_orders porque opera en Wansoft. Cuando hay dato vivo y dato viejo para el mismo
-- día, gana el vivo.
--
-- CONTRATO: las 24 columnas y sus tipos se conservan exactos, así que NINGÚN script de
-- agente cambia. Verificado contra information_schema antes de escribir esto.
--
-- REVERSA: las definiciones anteriores están en
-- supabase/migrations/00000000000000_baseline_esquema.sql (PR #123), con su
-- `WITH ("security_invoker"='on')`. Buscar `VIEW "public"."ops_daily_live"`.

-- ─────────────────────────────────────────────────────────────────────────────
-- Fuente viva: un día de operación reconstruido desde las órdenes del POS.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.ops_daily_desde_pos
WITH (security_invoker = on) AS
WITH base AS (
  SELECT o.client_id,
         (o.created_at AT TIME ZONE 'America/Monterrey')::date AS fecha,
         o.mesero, o.metodo_pago, o.mesa, o.personas,
         o.total, o.subtotal, o.iva, o.descuento, o.propina, o.items,
         o.created_at
  FROM public.pos_orders o
  WHERE coalesce(o.status, '') <> 'cancelada'
    AND o.client_id IS NOT NULL
    AND o.client_id <> ''          -- hay órdenes huérfanas con client_id vacío
),
agg AS (
  SELECT client_id, fecha,
         sum(total)                                        AS ventas_dia,
         sum(coalesce(subtotal,0) + coalesce(iva,0))       AS ventas_brutas,
         sum(coalesce(descuento,0))                        AS descuentos,
         sum(CASE WHEN metodo_pago ILIKE '%efec%' AND metodo_pago NOT ILIKE '%tarj%'
                  THEN total ELSE 0 END)                   AS efectivo,
         sum(CASE WHEN metodo_pago ILIKE '%tarj%' AND metodo_pago NOT ILIKE '%efec%'
                  THEN total ELSE 0 END)                   AS tarjeta,
         count(*)::int                                     AS tickets_count,
         count(DISTINCT mesa)::int                         AS mesas_atendidas,
         sum(coalesce(personas,0))::int                    AS personas_restaurant,
         sum(coalesce(propina,0))                          AS propinas_total,
         max(created_at)                                   AS ultima_orden
  FROM base GROUP BY 1,2
),
meseros AS (
  SELECT client_id, fecha,
         jsonb_agg(jsonb_build_object('nombre', mesero, 'total', t) ORDER BY t DESC) AS meseros
  FROM (SELECT client_id, fecha, coalesce(mesero, '(sin mesero)') AS mesero, sum(total) AS t
        FROM base GROUP BY 1,2,3) x
  GROUP BY 1,2
),
pagos AS (
  SELECT client_id, fecha,
         jsonb_object_agg(coalesce(metodo_pago, '(sin método)'), t) AS pago_metodos
  FROM (SELECT client_id, fecha, metodo_pago, sum(total) AS t FROM base GROUP BY 1,2,3) y
  GROUP BY 1,2
),
platillos AS (
  SELECT client_id, fecha,
         jsonb_agg(jsonb_build_object('nombre', nombre, 'cantidad', qty, 'total', imp)
                   ORDER BY qty DESC) FILTER (WHERE rn <= 10) AS platillos_top
  FROM (
    SELECT client_id, fecha, nombre, qty, imp,
           row_number() OVER (PARTITION BY client_id, fecha ORDER BY qty DESC) AS rn
    FROM (
      SELECT b.client_id, b.fecha,
             it->>'nombre'                        AS nombre,
             sum((it->>'cantidad')::numeric)      AS qty,
             sum((it->>'subtotal')::numeric)      AS imp
      FROM base b
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(b.items) = 'array' THEN b.items ELSE '[]'::jsonb END) it
      WHERE it ? 'nombre'
      GROUP BY 1,2,3
    ) z
  ) w GROUP BY 1,2
)
SELECT
  NULL::bigint                                              AS id,
  a.client_id,
  a.fecha,
  'cierre'::text                                            AS record_type,
  NULL::timestamptz                                         AS bucket_start,
  a.ventas_dia,
  a.ventas_brutas,
  a.descuentos,
  0::numeric                                                AS devoluciones,
  a.efectivo,
  a.tarjeta,
  a.tickets_count,
  a.mesas_atendidas,
  a.personas_restaurant,
  CASE WHEN a.tickets_count > 0
       THEN round(a.ventas_dia / a.tickets_count, 2) ELSE 0 END AS ticket_promedio_restaurant,
  a.propinas_total,
  m.meseros,
  p.platillos_top,
  -- `items` no trae categoría; agruparlo exigiría cruzar por nombre contra el menú,
  -- que es frágil. Se deja NULL a propósito: el único consumidor es menu-engineering,
  -- y prefiero que reporte "sin datos" a que reporte una agrupación adivinada.
  NULL::jsonb                                               AS ventas_por_grupo,
  g.pago_metodos,
  'fullsite'::text                                          AS source_system,
  a.ultima_orden                                            AS generated_at,
  a.ultima_orden                                            AS data_freshness,
  a.tickets_count                                           AS rows_aggregated
FROM agg a
LEFT JOIN meseros   m ON m.client_id = a.client_id AND m.fecha = a.fecha
LEFT JOIN platillos p ON p.client_id = a.client_id AND p.fecha = a.fecha
LEFT JOIN pagos     g ON g.client_id = a.client_id AND g.fecha = a.fecha;

-- ─────────────────────────────────────────────────────────────────────────────
-- Histórico: vivo primero, legado después. Un día que existe en las dos fuentes
-- se resuelve a favor del vivo.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.ops_daily_history
WITH (security_invoker = on) AS
SELECT DISTINCT ON (client_id, fecha)
  id, client_id, fecha, record_type, bucket_start, ventas_dia, ventas_brutas,
  descuentos, devoluciones, efectivo, tarjeta, tickets_count, mesas_atendidas,
  personas_restaurant, ticket_promedio_restaurant, propinas_total, meseros,
  platillos_top, ventas_por_grupo, pago_metodos, source_system, generated_at,
  data_freshness, rows_aggregated
FROM (
  SELECT 1 AS prioridad, v.* FROM public.ops_daily_desde_pos v
  UNION ALL
  SELECT 2 AS prioridad,
         d.id, d.client_id, d.fecha, d.record_type, d.bucket_start, d.ventas_dia,
         d.ventas_brutas, d.descuentos, d.devoluciones, d.efectivo, d.tarjeta,
         d.tickets_count, d.mesas_atendidas, d.personas_restaurant,
         d.ticket_promedio_restaurant, d.propinas_total, d.meseros, d.platillos_top,
         d.ventas_por_grupo, d.pago_metodos, d.source_system, d.generated_at,
         d.data_freshness, d.rows_aggregated
  FROM public.ops_daily d
  WHERE d.record_type = ANY (ARRAY['cierre'::text, 'cierre_wansoft'::text])
) u
ORDER BY client_id, fecha, prioridad;

CREATE OR REPLACE VIEW public.ops_daily_live
WITH (security_invoker = on) AS
SELECT h.*,
       -- `pipeline_fresh` era la señal de si el agregador venía corriendo. Con la
       -- fuente viva se vuelve una pregunta sobre el dato: ¿es de hoy o de ayer?
       (h.fecha >= (now() AT TIME ZONE 'America/Monterrey')::date - 1) AS pipeline_fresh
FROM public.ops_daily_history h;

-- Ninguna de las tres debe ser legible por `anon` — misma propiedad que cerró #104.
REVOKE ALL ON public.ops_daily_desde_pos FROM anon;
REVOKE ALL ON public.ops_daily_history  FROM anon;
REVOKE ALL ON public.ops_daily_live     FROM anon;
GRANT SELECT ON public.ops_daily_desde_pos TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN — debe devolver una fila por restaurante CON datos recientes
-- ─────────────────────────────────────────────────────────────────────────────
--
-- SELECT client_id, max(fecha) AS ultimo_dia, count(*) AS dias
-- FROM public.ops_daily_history GROUP BY client_id ORDER BY 2 DESC;
--
-- Y que anon siga sin ver nada (cero filas):
--
-- SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname='public' AND c.relname LIKE 'ops_daily%'
--   AND has_table_privilege('anon', c.oid, 'SELECT');
