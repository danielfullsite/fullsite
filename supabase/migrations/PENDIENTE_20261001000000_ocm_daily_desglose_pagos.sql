-- ocm_daily: desglose efectivo/tarjeta por los pagos reales del ticket, no por la primera forma de pago.
--
-- PENDIENTE DE AUTORIZACIÓN DE DANIEL. Es DDL sobre producción (una función nueva y un
-- CREATE OR REPLACE VIEW). No aplicar sin probarlo antes en staging con
-- supabase/tests/ocm_daily_desglose_pagos_test.sql.
--
-- CAUSA RAÍZ (leída en sólo lectura el 2026-10-01)
-- ------------------------------------------------
-- La parte `live` de public.ocm_daily clasifica cada ticket completo con
-- `pos_orders.metodo_pago`, que para los tickets importados del espejo (`wh-<ticket_id>`)
-- es la PRIMERA forma de pago (fs_sync_pos_orders_desde_historico: array_agg(forma_pago
-- ORDER BY pago_id)[1]), y le asigna el `total` COMPLETO:
--     efectivo = sum(total) FILTER (metodo_pago ~~* '%efec%' AND !~~* '%tarj%')
--     tarjeta  = sum(total) FILTER (metodo_pago ~~* '%tarj%' AND !~~* '%efec%')
-- En un pago mixto el ticket entero cae en un solo cajón. El total del día sí cuadra;
-- el desglose no.
--
-- Medido contra producción para AMALAY, día de venta 2026-09-30 (73 tickets, $49,761.00):
--     vista actual ......... efectivo $14,637.00 / tarjeta $30,663.00
--     por pagos reales ..... efectivo $13,863.00 / tarjeta $31,437.00 (apps $4,461.00 en ninguno)
--     diferencia ........... +$774.00 en efectivo, -$774.00 en tarjeta (simétrica)
-- Los valores corregidos coinciden al centavo con CortesPagosRegistros (PorVenta) de
-- NetSilver el 29 y el 30/09. Evidencia y consultas: docs/wansoft/atlas/ (rama
-- docs/atlas-evidencia-pagos).
--
-- POR QUÉ NO SE COPIA LA REGLA DE AMALAY TAL CUAL
-- -----------------------------------------------
-- La semántica de `pos_orders.pagos[].monto` NO es la misma en todos los orígenes
-- (últimos 60 días, cerradas):
--   * espejo AMALAY: monto de tarjeta INCLUYE propina y monto de efectivo INCLUYE cambio
--     (sum(monto) = total + propina + cambio).
--   * lab-resto, tekila-rg, diezmex-demo (nativos): sum(monto) = total en el 100% de sus
--     tickets; la propina va aparte y no hay cambio.
--   * demo (nativo): 308 de 322 con sum(monto) = total + propina.
-- Restar la propina de cada tarjeta "porque sí" dejaría mal a los nativos.
--
-- REGLA (fs_desglose_pago), sin supuestos por tenant ni por prefijo de id
-- -----------------------------------------------------------------------
--   exceso   = max(sum(monto) - total, 0)
--   propina_incluida = min(propina, exceso)        -- lo que explica la propina
--   cambio   = exceso - propina_incluida           -- el resto es cambio
--   efectivo = monto_efectivo - cambio
--   tarjeta  = monto_tarjeta  - propina_incluida
-- Sólo se aplica cuando el ticket queda EXPLICADO por esas dos formas:
--   hay pagos, sum(monto) >= total, TODOS los pagos son efectivo o tarjeta,
--   la propina incluida cabe en tarjeta y el cambio cabe en efectivo.
-- En cualquier otro caso (sin pagos, pagos no-array, apps/transferencia mezcladas, propina
-- sin tarjeta, subcobro) se conserva EXACTAMENTE el comportamiento anterior (primera forma
-- de pago x total). La propina NO se generaliza a transferencia ni a apps: sólo está
-- verificada contra el corte para tarjetas. En el histórico de AMALAY hay 87 tickets con
-- propina en transferencia y 18 de ellos también traen tarjeta; si la propina de un ticket
-- así cabe en la tarjeta, esta regla la restaría de la tarjeta aunque fuera de la
-- transferencia. Es un límite conocido: resolverlo exige propina por pago dentro de
-- pos_orders.pagos (cambio en el sync + backfill), fuera de este cambio mínimo.
--
-- EFECTO MEDIDO EN PRODUCCIÓN (lectura, ejecutando el cuerpo exacto de la función por
-- tickets cerrados de los últimos 60 días; el 2026-10-01):
--   * amalay 2026-09-30: efectivo 14,637.00 -> 13,863.00; tarjeta 30,663.00 -> 31,437.00
--   * amalay 2026-09-29: efectivo 19,273.50 -> 11,353.30; tarjeta 22,321.50 -> 30,241.70
--     (ambos coinciden con PorVenta del corte de NetSilver)
--   * amalay 60 días: 467 de 5,940 tickets cambian de cajón.
--   * lab-resto, demo, diezmex-demo, boruca, chickin-demo, scyf-demo: 0 tickets cambian.
--   * tekila-rg: 3,387 de 3,387 tickets cambian porque su `metodo_pago` es NULL en todos:
--     hoy su vista muestra efectivo 0 y tarjeta 0 y pasaría a mostrar el reparto real leído
--     de `pagos`. Es una corrección, pero es un cambio visible que Daniel debe conocer.
--
-- Equivalencia con la vista anterior donde no hay mezcla: para un ticket de una sola
-- forma (efectivo o tarjeta) con o sin propina incluida, el resultado es igual a `total`,
-- que es lo que la vista daba antes.
--
-- ALCANCE (un P0 por PR)
-- ----------------------
-- Cambia: función public.fs_desglose_pago y vista public.ocm_daily (mismas columnas, tipos y
-- orden; security_invoker se conserva y se reafirma).
-- NO cambia, por separado y con su razón en la descripción del PR:
--   * public.fs_ventas_diarias (mismo patrón en las columnas ef/tj): función grande; se
--     corrige con esta misma función en una migración aparte para revisarla sola.
--   * dashboard-app/src/lib/pos-daily.ts (respaldo en JS, sólo si falla el RPC): requiere
--     leer `pagos` y `propina` y su propia prueba.
--   * Pantallas POS (pos/turno, CierreCajaWizard, control-efectivo, pos-arqueo): leen su
--     propio turno; auditar aparte.
--
-- REVERSA EXACTA
-- --------------
-- Ejecutar el bloque "DEFINICIÓN ANTERIOR" del final (restaura la vista) y, opcionalmente,
-- DROP FUNCTION public.fs_desglose_pago(numeric, numeric, jsonb, text);
-- Nada se migra ni se reescribe en tablas: sólo cambia cómo se calcula la vista.
--
-- COMPROBACIÓN
-- ------------
-- supabase/tests/ocm_daily_desglose_pagos_test.sql (dos tenants, cambio y propina; corre en
-- una transacción y termina en ROLLBACK).

BEGIN;

CREATE OR REPLACE FUNCTION public.fs_desglose_pago(
  p_total numeric, p_propina numeric, p_pagos jsonb, p_metodo_pago text
)
RETURNS TABLE(efectivo numeric, tarjeta numeric)
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $fn$
  WITH base AS (
    SELECT COALESCE(p_total, 0) AS total,
           COALESCE(p_propina, 0) AS propina,
           CASE WHEN jsonb_typeof(p_pagos) = 'array' THEN p_pagos ELSE '[]'::jsonb END AS pagos
  ), a AS (
    SELECT b.total, b.propina,
           count(q.v) AS n,
           COALESCE(sum(q.v), 0) AS suma,
           COALESCE(sum(q.v) FILTER (WHERE q.me ~* 'efec' AND q.me !~* 'tarj'), 0) AS cash,
           COALESCE(sum(q.v) FILTER (WHERE q.me ~* 'tarj' AND q.me !~* 'efec'), 0) AS card,
           COALESCE(sum(q.v) FILTER (WHERE NOT (q.me ~* 'efec' OR q.me ~* 'tarj')), 0) AS otros
      FROM base b
      LEFT JOIN LATERAL (
        SELECT COALESCE(e->>'metodo', '') AS me,
               CASE WHEN e->>'monto' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (e->>'monto')::numeric END AS v
          FROM jsonb_array_elements(b.pagos) e
      ) q ON true
     GROUP BY b.total, b.propina
  ), c AS (
    SELECT a.*,
           greatest(a.suma - a.total, 0) AS exceso,
           least(a.propina, greatest(a.suma - a.total, 0)) AS prop_inc
      FROM a
  ), d AS (
    SELECT c.*,
           (c.exceso - c.prop_inc) AS cambio,
           (c.n > 0 AND c.suma >= c.total - 0.005 AND c.otros = 0
            AND c.prop_inc <= c.card + 0.005
            AND (c.exceso - c.prop_inc) <= c.cash + 0.005) AS aplica
      FROM c
  )
  SELECT
    CASE WHEN d.aplica THEN d.cash - d.cambio
         WHEN p_metodo_pago ~* 'efec' AND p_metodo_pago !~* 'tarj' THEN d.total
         ELSE 0::numeric END,
    CASE WHEN d.aplica THEN d.card - d.prop_inc
         WHEN p_metodo_pago ~* 'tarj' AND p_metodo_pago !~* 'efec' THEN d.total
         ELSE 0::numeric END
  FROM d
$fn$;

COMMENT ON FUNCTION public.fs_desglose_pago(numeric, numeric, jsonb, text) IS
  'Reparte la venta de un ticket entre efectivo y tarjeta usando sus pagos reales (propina incluida en tarjeta, cambio en efectivo). Si el ticket no queda explicado por esas dos formas, conserva la regla anterior (primera forma de pago x total).';

CREATE OR REPLACE VIEW public.ocm_daily AS
 WITH live AS NOT MATERIALIZED (
         SELECT o.client_id,
            (o.created_at AT TIME ZONE 'America/Monterrey'::text)::date AS fecha,
            'fullsite'::text AS source_system,
            sum(o.total) AS ventas_dia,
            sum(COALESCE(o.subtotal, 0::numeric) + COALESCE(o.iva, 0::numeric)) AS ventas_brutas,
            sum(COALESCE(o.descuento, 0::numeric)) AS descuentos,
            sum(dp.efectivo) AS efectivo,
            sum(dp.tarjeta) AS tarjeta,
            count(*)::integer AS tickets_count,
            count(DISTINCT o.mesa)::integer AS mesas_atendidas,
            sum(COALESCE(o.personas, 0))::integer AS personas_restaurant,
            round(sum(o.total) / NULLIF(count(*), 0)::numeric, 2) AS ticket_promedio_restaurant,
            sum(COALESCE(o.propina, 0::numeric)) AS propinas_total,
            max(o.updated_at) AS generated_at
           FROM pos_orders o
             CROSS JOIN LATERAL public.fs_desglose_pago(o.total, o.propina, o.pagos, o.metodo_pago) dp
          WHERE o.status = ANY (ARRAY['cerrada'::text, 'completada'::text])
          GROUP BY o.client_id, ((o.created_at AT TIME ZONE 'America/Monterrey'::text)::date)
        ), hist AS (
         SELECT DISTINCT ON (d.client_id, d.fecha) d.client_id,
            d.fecha,
            COALESCE(d.source_system, 'wansoft'::text) AS source_system,
            d.ventas_dia,
            d.ventas_brutas,
            d.descuentos,
            d.efectivo,
            d.tarjeta,
            d.tickets_count,
            d.mesas_atendidas,
            d.personas_restaurant,
            d.ticket_promedio_restaurant,
            d.propinas_total,
            d.generated_at
           FROM ops_daily d
          WHERE d.record_type = ANY (ARRAY['cierre'::text, 'cierre_wansoft'::text])
          ORDER BY d.client_id, d.fecha, d.generated_at DESC
        )
 SELECT live.client_id,
    live.fecha,
    live.source_system,
    live.ventas_dia,
    live.ventas_brutas,
    live.descuentos,
    live.efectivo,
    live.tarjeta,
    live.tickets_count,
    live.mesas_atendidas,
    live.personas_restaurant,
    live.ticket_promedio_restaurant,
    live.propinas_total,
    live.generated_at
   FROM live
UNION ALL
 SELECT h.client_id,
    h.fecha,
    h.source_system,
    h.ventas_dia,
    h.ventas_brutas,
    h.descuentos,
    h.efectivo,
    h.tarjeta,
    h.tickets_count,
    h.mesas_atendidas,
    h.personas_restaurant,
    h.ticket_promedio_restaurant,
    h.propinas_total,
    h.generated_at
   FROM hist h
  WHERE NOT (EXISTS ( SELECT 1
           FROM live l
          WHERE l.client_id = h.client_id AND l.fecha = h.fecha));

-- CREATE OR REPLACE conserva opciones y permisos; se reafirma lo que ya tiene producción.
ALTER VIEW public.ocm_daily SET (security_invoker = on);

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- DEFINICIÓN ANTERIOR (reversa). Leída de producción con pg_get_viewdef el 2026-10-01.
-- Sólo difieren las dos columnas `efectivo` y `tarjeta` de la CTE `live` y su FROM.
-- ─────────────────────────────────────────────────────────────────────────────
-- BEGIN;
-- CREATE OR REPLACE VIEW public.ocm_daily AS
--  WITH live AS NOT MATERIALIZED (
--          SELECT o.client_id,
--             (o.created_at AT TIME ZONE 'America/Monterrey'::text)::date AS fecha,
--             'fullsite'::text AS source_system,
--             sum(o.total) AS ventas_dia,
--             sum(COALESCE(o.subtotal, 0::numeric) + COALESCE(o.iva, 0::numeric)) AS ventas_brutas,
--             sum(COALESCE(o.descuento, 0::numeric)) AS descuentos,
--             sum(
--                 CASE
--                     WHEN o.metodo_pago ~~* '%efec%'::text AND o.metodo_pago !~~* '%tarj%'::text THEN o.total
--                     ELSE 0::numeric
--                 END) AS efectivo,
--             sum(
--                 CASE
--                     WHEN o.metodo_pago ~~* '%tarj%'::text AND o.metodo_pago !~~* '%efec%'::text THEN o.total
--                     ELSE 0::numeric
--                 END) AS tarjeta,
--             count(*)::integer AS tickets_count,
--             count(DISTINCT o.mesa)::integer AS mesas_atendidas,
--             sum(COALESCE(o.personas, 0))::integer AS personas_restaurant,
--             round(sum(o.total) / NULLIF(count(*), 0)::numeric, 2) AS ticket_promedio_restaurant,
--             sum(COALESCE(o.propina, 0::numeric)) AS propinas_total,
--             max(o.updated_at) AS generated_at
--            FROM pos_orders o
--           WHERE o.status = ANY (ARRAY['cerrada'::text, 'completada'::text])
--           GROUP BY o.client_id, ((o.created_at AT TIME ZONE 'America/Monterrey'::text)::date)
--         ), hist AS (
--          SELECT DISTINCT ON (d.client_id, d.fecha) d.client_id,
--             d.fecha,
--             COALESCE(d.source_system, 'wansoft'::text) AS source_system,
--             d.ventas_dia,
--             d.ventas_brutas,
--             d.descuentos,
--             d.efectivo,
--             d.tarjeta,
--             d.tickets_count,
--             d.mesas_atendidas,
--             d.personas_restaurant,
--             d.ticket_promedio_restaurant,
--             d.propinas_total,
--             d.generated_at
--            FROM ops_daily d
--           WHERE d.record_type = ANY (ARRAY['cierre'::text, 'cierre_wansoft'::text])
--           ORDER BY d.client_id, d.fecha, d.generated_at DESC
--         )
--  SELECT live.client_id,
--     live.fecha,
--     live.source_system,
--     live.ventas_dia,
--     live.ventas_brutas,
--     live.descuentos,
--     live.efectivo,
--     live.tarjeta,
--     live.tickets_count,
--     live.mesas_atendidas,
--     live.personas_restaurant,
--     live.ticket_promedio_restaurant,
--     live.propinas_total,
--     live.generated_at
--    FROM live
-- UNION ALL
--  SELECT h.client_id,
--     h.fecha,
--     h.source_system,
--     h.ventas_dia,
--     h.ventas_brutas,
--     h.descuentos,
--     h.efectivo,
--     h.tarjeta,
--     h.tickets_count,
--     h.mesas_atendidas,
--     h.personas_restaurant,
--     h.ticket_promedio_restaurant,
--     h.propinas_total,
--     h.generated_at
--    FROM hist h
--   WHERE NOT (EXISTS ( SELECT 1
--            FROM live l
--           WHERE l.client_id = h.client_id AND l.fecha = h.fecha));
-- ALTER VIEW public.ocm_daily SET (security_invoker = on);
-- COMMIT;
