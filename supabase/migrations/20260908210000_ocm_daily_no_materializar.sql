-- ocm_daily: dejar que el filtro por restaurante llegue hasta el indice.
--
-- El MISMO defecto que 20260908140000 arreglo en ops_daily_desde_pos, en la vista que
-- CLAUDE.md declara "la fuente viva". Dos de dos: no es un caso aislado, es el patron de
-- autoria de estas vistas.
--
-- EL PROBLEMA
--
-- El CTE `live` se referencia DOS veces — en el SELECT principal y dentro del
-- NOT EXISTS que descarta el historico duplicado. Postgres, ante un CTE usado mas de una
-- vez, lo MATERIALIZA: agrega TODAS las ordenes de TODOS los restaurantes antes de que el
-- `client_id=eq.X` que manda PostgREST pueda aplicarse.
--
-- Medido en produccion el 2026-09-08, EXPLAIN (ANALYZE, BUFFERS) de
-- `select * from ocm_daily where client_id = 'amalay'`:
--
--   filas leidas de pos_orders   128,146   para devolver 3
--   en el plan                   "CTE Scan on live ... Rows Removed by Filter: 406"
--   buffers                      15,568
--   a disco                      temp read=1219 written=1224, Peak Disk 9,752 kB
--   tiempo                       8,497 ms  — POR ENCIMA del statement_timeout de 8s
--
-- Sobre el tiempo hay que ser preciso, porque es la cifra menos confiable: en corridas
-- separadas del mismo plan se midio entre 615 ms y 8,497 ms segun la temperatura del cache
-- y la contencion. Lo estable, y lo que crece con los otros restaurantes, es el TRABAJO:
-- 128,146 filas agregadas y 9,752 kB derramados a disco en CADA llamada, pregunte quien
-- pregunte. Por eso no falla con un error: falla como 500 intermitente.
--
-- POR QUE IMPORTA HOY Y NO EN UN AÑO
--
-- AMALAY todavia no pasa por aqui: `agent_daily_source.py` lo enruta a ops_daily_live
-- mientras siga en LEGACY_DAILY_TENANTS. O sea que esta exento POR ACCIDENTE de la
-- transicion — y entra el dia del cutover, que es justo cuando menos conviene descubrirlo.
-- Mientras tanto el consumidor vivo es lab-resto (lab-24-7.yml, cron cada 30 min), y
-- CUALQUIER restaurante nuevo nace en la ruta rota. Es exactamente el caso de "clonar a
-- mil restaurantes".
--
-- EL CAMBIO
--
-- `NOT MATERIALIZED`. Una palabra; el resto del SELECT queda identico. Medido:
--
--   filas leidas de pos_orders   9        (Index Cond: client_id = 'amalay')
--   buffers                      905
--   a disco                      cero
--
-- Las DOS referencias al CTE reciben el filtro: la primera por
-- pos_orders_dia_venta_idx y la segunda por idx_pos_orders_status.
--
-- EQUIVALENCIA COMPROBADA antes de escribir esto: EXCEPT en las dos direcciones sobre las
-- 1,600 filas de la vista, todas las columnas, los 10 restaurantes. Diferencias: 0 y 0.
--
-- CAVEAT MEDIDO: el 235x depende de que quien consulte mande su client_id. Sin filtro de
-- tenant, NOT MATERIALIZED baja de 8,497 ms a ~500 ms pero sigue recorriendo todo, dos
-- veces. Si algun consumidor lee ocm_daily sin filtrar, hay que filtrarlo tambien.

CREATE OR REPLACE VIEW public.ocm_daily AS
WITH live AS NOT MATERIALIZED (
  SELECT o.client_id,
         (o.created_at AT TIME ZONE 'America/Monterrey'::text)::date AS fecha,
         'fullsite'::text AS source_system,
         sum(o.total) AS ventas_dia,
         sum(COALESCE(o.subtotal, 0::numeric) + COALESCE(o.iva, 0::numeric)) AS ventas_brutas,
         sum(COALESCE(o.descuento, 0::numeric)) AS descuentos,
         sum(CASE WHEN o.metodo_pago ~~* '%efec%'::text AND o.metodo_pago !~~* '%tarj%'::text
                  THEN o.total ELSE 0::numeric END) AS efectivo,
         sum(CASE WHEN o.metodo_pago ~~* '%tarj%'::text AND o.metodo_pago !~~* '%efec%'::text
                  THEN o.total ELSE 0::numeric END) AS tarjeta,
         count(*)::integer AS tickets_count,
         count(DISTINCT o.mesa)::integer AS mesas_atendidas,
         sum(COALESCE(o.personas, 0))::integer AS personas_restaurant,
         round(sum(o.total) / NULLIF(count(*), 0)::numeric, 2) AS ticket_promedio_restaurant,
         sum(COALESCE(o.propina, 0::numeric)) AS propinas_total,
         max(o.updated_at) AS generated_at
    FROM pos_orders o
   WHERE o.status = ANY (ARRAY['cerrada'::text, 'completada'::text])
   GROUP BY o.client_id, ((o.created_at AT TIME ZONE 'America/Monterrey'::text)::date)
), hist AS (
  SELECT DISTINCT ON (d.client_id, d.fecha)
         d.client_id, d.fecha,
         COALESCE(d.source_system, 'wansoft'::text) AS source_system,
         d.ventas_dia, d.ventas_brutas, d.descuentos, d.efectivo, d.tarjeta,
         d.tickets_count, d.mesas_atendidas, d.personas_restaurant,
         d.ticket_promedio_restaurant, d.propinas_total, d.generated_at
    FROM ops_daily d
   WHERE d.record_type = ANY (ARRAY['cierre'::text, 'cierre_wansoft'::text])
   ORDER BY d.client_id, d.fecha, d.generated_at DESC
)
SELECT live.client_id, live.fecha, live.source_system, live.ventas_dia, live.ventas_brutas,
       live.descuentos, live.efectivo, live.tarjeta, live.tickets_count, live.mesas_atendidas,
       live.personas_restaurant, live.ticket_promedio_restaurant, live.propinas_total,
       live.generated_at
  FROM live
UNION ALL
SELECT h.client_id, h.fecha, h.source_system, h.ventas_dia, h.ventas_brutas,
       h.descuentos, h.efectivo, h.tarjeta, h.tickets_count, h.mesas_atendidas,
       h.personas_restaurant, h.ticket_promedio_restaurant, h.propinas_total,
       h.generated_at
  FROM hist h
 WHERE NOT (EXISTS (SELECT 1 FROM live l
                     WHERE l.client_id = h.client_id AND l.fecha = h.fecha));
