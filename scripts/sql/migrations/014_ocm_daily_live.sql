-- ─────────────────────────────────────────────────────────────────────────────
-- 014 · OCM Fase 1 — ocm_daily VIVO (agrega pos_orders directo)
-- Ver docs/platform/OCM-REVIEW-2026-08-19.md
--
-- PROBLEMA: ocm_daily leía la tabla `ops_daily`, que dejó de alimentarse en el
-- switchover a POS propio (última fecha jul-12). El `pos_daily_aggregator` que la
-- llenaría está BLOCKED. Resultado: la IA leía data muerta y un cliente nuevo no
-- tenía nada.
--
-- FIX: ocm_daily ahora AGREGA `pos_orders` en vivo (sin job intermedio, funciona
-- para cualquier tenant) y hace UNION con la historia de `ops_daily` SOLO para las
-- fechas que NO tienen órdenes en pos_orders (conserva el histórico rico pre-cutover
-- de AMALAY sin doble-contar).
--
-- Validado: creado en staging (fullsite-staging) + lógica corrida read-only contra
-- prod (AMALAY) → días fullsite recientes + historia wansoft, transición limpia.
-- Aditivo: mismas columnas/tipos que la vista anterior (no rompe consumidores).
-- Aplicar en prod = el fundador (MCP prod es read-only).
--
-- Refinamientos futuros (no bloquean): día-de-negocio 05:00 (hoy usa fecha calendario
-- MX); split efectivo/tarjeta ignora pagos mixtos (aprox); status 'entregada' no cuenta
-- como venta (solo 'cerrada'/'completada').
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.ocm_daily AS
WITH live AS (
  SELECT
    o.client_id,
    (o.created_at AT TIME ZONE 'America/Monterrey')::date            AS fecha,
    'fullsite'::text                                                 AS source_system,
    SUM(o.total)                                                     AS ventas_dia,
    SUM(COALESCE(o.subtotal,0) + COALESCE(o.iva,0))                  AS ventas_brutas,
    SUM(COALESCE(o.descuento,0))                                     AS descuentos,
    SUM(CASE WHEN o.metodo_pago ILIKE '%efec%' AND o.metodo_pago NOT ILIKE '%tarj%' THEN o.total ELSE 0 END) AS efectivo,
    SUM(CASE WHEN o.metodo_pago ILIKE '%tarj%' AND o.metodo_pago NOT ILIKE '%efec%' THEN o.total ELSE 0 END) AS tarjeta,
    COUNT(*)::integer                                                AS tickets_count,
    COUNT(DISTINCT o.mesa)::integer                                  AS mesas_atendidas,
    SUM(COALESCE(o.personas,0))::integer                            AS personas_restaurant,
    ROUND(SUM(o.total) / NULLIF(COUNT(*),0), 2)                     AS ticket_promedio_restaurant,
    SUM(COALESCE(o.propina,0))                                       AS propinas_total,
    MAX(o.updated_at)                                                AS generated_at
  FROM public.pos_orders o
  WHERE o.status IN ('cerrada','completada')
  GROUP BY o.client_id, (o.created_at AT TIME ZONE 'America/Monterrey')::date
),
hist AS (
  SELECT DISTINCT ON (d.client_id, d.fecha)
    d.client_id, d.fecha, COALESCE(d.source_system,'wansoft')::text AS source_system,
    d.ventas_dia, d.ventas_brutas, d.descuentos, d.efectivo, d.tarjeta,
    d.tickets_count, d.mesas_atendidas, d.personas_restaurant,
    d.ticket_promedio_restaurant, d.propinas_total, d.generated_at
  FROM public.ops_daily d
  WHERE d.record_type IN ('cierre','cierre_wansoft')
  ORDER BY d.client_id, d.fecha, d.generated_at DESC
)
SELECT * FROM live
UNION ALL
SELECT h.* FROM hist h
WHERE NOT EXISTS (
  SELECT 1 FROM live l WHERE l.client_id = h.client_id AND l.fecha = h.fecha
);
