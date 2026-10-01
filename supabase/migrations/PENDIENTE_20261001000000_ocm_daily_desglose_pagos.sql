-- ocm_daily: desglose de la venta por los pagos reales del ticket, con "no determinado" explícito.
--
-- PENDIENTE DE AUTORIZACIÓN DE DANIEL. Es DDL sobre producción (una función nueva y un
-- CREATE OR REPLACE VIEW que AGREGA 4 columnas al final). No aplicar sin probarlo antes en
-- PostgreSQL aislado/staging con supabase/tests/ocm_daily_desglose_pagos_test.sql y
-- supabase/tests/ocm_daily_acceso_test.sql.
--
-- CAUSA RAÍZ (leída en sólo lectura el 2026-10-01)
-- ------------------------------------------------
-- La parte `live` de public.ocm_daily clasifica cada ticket completo con
-- `pos_orders.metodo_pago`, que para los tickets importados del espejo (`wh-<ticket_id>`)
-- es la PRIMERA forma de pago, y le asigna el `total` COMPLETO:
--     efectivo = sum(total) FILTER (metodo_pago ~~* '%efec%' AND !~~* '%tarj%')
-- En un pago mixto el ticket entero cae en un solo cajón. El total del día cuadra; el
-- desglose no. AMALAY, día de venta 2026-09-30 (73 tickets, $49,761.00):
--     vista actual ... efectivo $14,637.00 / tarjeta $30,663.00
--     corte NetSilver  efectivo $13,863.00 / tarjeta $31,437.00 (apps $4,461.00 en ninguno)
-- Evidencia y consultas: docs/wansoft/atlas/ (rama docs/atlas-evidencia-pagos).
--
-- QUÉ SE SABE DE LA FUENTE (leído en producción el 2026-10-01)
-- ------------------------------------------------------------
--   * pos_orders.pagos[] sólo trae {metodo, monto}. NO trae propina ni cambio por pago, en
--     ningún tenant (llaves distintas medidas en 60 días: metodo, monto).
--   * historico_pagos (espejo AMALAY, fuente wansoft) SÍ conserva `propina` por pago, pero
--     no `cambio`; el sync no la copia a pos_orders.pagos.
--   * La semántica de `monto` NO es uniforme: espejo = monto con propina y cambio
--     (sum(monto) = total + propina + cambio); lab-resto, tekila-rg y diezmex-demo tienen
--     sum(monto) = total; el escritor nativo documenta total + propina (pos/page.tsx:4007,
--     pos-data.ts:1660) pero los datos no lo cumplen. La igualdad aritmética no prueba la
--     semántica, así que ESTA REGLA NO LA SUPONE.
--   * Ambigüedad conocida: de 18 tickets AMALAY con tarjeta y propina en transferencia, en 10
--     la propina está sólo en la transferencia, en 0 sólo en la tarjeta y en 8 en ambas.
--     Restar la propina de la tarjeta "porque cabe" habría estado mal en 10 de 18.
--
-- REGLA (fs_desglose_pago_v2): sólo reparte lo que es demostrable con los datos de la fila
-- ---------------------------------------------------------------------------------------
-- Clases de pago por nombre: efectivo (efec, sin tarj), tarjeta (tarj, sin efec), otros (todo
-- lo demás: transferencia, apps, "Dólares", "American Express", NetPay, etc.).
-- Con pagos válidos (array no vacío, montos numéricos >= 0, suma > 0), sea S = sum(monto),
-- T = total, P = propina del ticket, E = max(S - T, 0):
--   1. S = T ............................. cada clase con su monto. (No importa si el monto
--                                          era bruto o neto: nada que repartir.)
--   2. E > 0 y una sola clase con monto .. esa clase = T (propina y cambio salen de ese mismo
--                                          cajón, no hay nada que repartir entre clases).
--   3. E > 0, P = 0, el efectivo cubre E . E es cambio (sólo se da cambio en efectivo):
--                                          efectivo = monto_efectivo - E.
--   4. S < T, P = 0 ...................... clases con su monto; lo que falta = no_determinado.
--   5. Cualquier otro caso ............... no_determinado = T. Incluye tarjeta+transferencia
--                                          con propina, efectivo+tarjeta con E > 0 y P > 0,
--                                          y subcobro con propina. La propina y el cambio no
--                                          se asignan a ninguna clase por descarte.
-- Sin pagos detallados (nulo, no-array o vacío) o con pagos corruptos (monto no numérico o
-- negativo, suma 0): no_determinado = T. `metodo_pago` YA NO se usa: un método declarado sin
-- detalle de pagos no es un dato demostrado y no alimenta efectivo/tarjeta. (La v1 lo mandaba a
-- una clase como "declarado"; se retiró el 2026-10-01 por decisión de Daniel.) Efecto visible:
-- tenants que sólo guardan metodo_pago sin pagos (scyf-demo, boruca, chickin-demo, 5 tickets de
-- AMALAY) muestran su venta en no_determinado en vez de efectivo/tarjeta/otros.
-- Centavos: total, propina y cada monto se redondean a 2 decimales ANTES de clasificar; las
-- comparaciones son exactas (sin tolerancia). El residuo de fracción de centavo del total
-- original, si lo hubiera, queda explícito en no_determinado (el ticket sólo se cuenta en
-- tickets_no_determinado si ese residuo llega a >= 0.005).
-- En todos los casos efectivo + tarjeta + otros_medios + no_determinado = total (por ticket y
-- por día). `excedente_pagos` = max(S - T, 0) = propina incluida + cambio, SIN repartir entre
-- ambos; la propina sigue en `propinas_total` (Σ pos_orders.propina) y no se mezcla en ventas.
--
-- Este diseño no necesita saber si el tenant es espejo o nativo (ni mira metodo_pago): usa sólo los casos en los que
-- el reparto es el mismo bajo cualquier semántica. El costo es que los tickets mixtos con
-- propina y excedente quedan "no determinado" hasta que la fuente traiga la propina por pago.
-- Cómo resolverlos (NO incluido; requiere autorización): (a) que el sync copie
-- historico_pagos.propina a pos_orders.pagos[] y backfill del histórico, o (b) que el escritor
-- nativo registre propina y cambio por pago.
--
-- COLUMNAS NUEVAS (al final de ocm_daily; las existentes conservan nombre, tipo y orden)
-- ------------------------------------------------------------------------------------
--   otros_medios        numeric  venta pagada con transferencia/apps/otros
--   no_determinado      numeric  venta cuyo cajón no es demostrable con la fila
--   excedente_pagos     numeric  propina incluida + cambio, sin repartir
--   tickets_no_determinado integer  tickets con no_determinado <> 0
-- Las filas históricas (ops_daily) devuelven NULL en las cuatro. `efectivo` y `tarjeta` pasan a
-- significar "demostrado"; ya no son "lo que quedó".
--
-- EFECTO MEDIDO EN PRODUCCIÓN: ver docs/wansoft/atlas/EVIDENCIA-DESGLOSE-PAGOS-2026-09-30.md
-- sección "Implementación propuesta" (cifras de la v2, medidas en sólo lectura).
-- tekila-rg (demo, metodo_pago NULL en todos sus tickets) pasa de 0/0 a su reparto real:
-- cambio visible aceptado por Daniel el 2026-10-01; no autoriza aplicar.
--
-- ALCANCE (un P0 por PR)
-- ----------------------
-- Cambia: función nueva public.fs_desglose_pago_v2 y vista public.ocm_daily.
-- NO cambia (después de revisar esta regla común): public.fs_ventas_diarias,
-- dashboard-app/src/lib/pos-daily.ts y las pantallas POS. Mientras tanto esas rutas siguen
-- con la regla anterior y pueden contradecir a esta vista.
--
-- REVERSA EXACTA
-- --------------
-- Ejecutar el bloque "DEFINICIÓN ANTERIOR" del final (restaura la vista; al quitar las 4
-- columnas hace falta DROP VIEW + CREATE VIEW, ya incluido) y DROP FUNCTION
-- public.fs_desglose_pago_v2(numeric, numeric, jsonb). No se migran ni reescriben tablas.
-- Permisos: CREATE OR REPLACE conserva ACL; el DROP/CREATE de la reversa los pierde, por eso
-- el bloque los restaura (GRANT idénticos a producción al 2026-10-01).

BEGIN;

-- PREFLIGHT (falla cerrado, sin cambiar nada): la vista debe tener exactamente las 14 columnas
-- de hoy (primera aplicación) o las 18 de esta migración (reaplicación). Cualquier otra forma
-- significa que otra migración la cambió y esta definición la pisaría.
DO $pre$
DECLARE cols text;
BEGIN
  SELECT string_agg(attname, ',' ORDER BY attnum) INTO cols
    FROM pg_attribute WHERE attrelid = 'public.ocm_daily'::regclass AND attnum > 0 AND NOT attisdropped;
  IF cols IS NULL THEN
    RAISE EXCEPTION 'preflight: public.ocm_daily no existe';
  END IF;
  IF cols NOT IN (
    'client_id,fecha,source_system,ventas_dia,ventas_brutas,descuentos,efectivo,tarjeta,tickets_count,mesas_atendidas,personas_restaurant,ticket_promedio_restaurant,propinas_total,generated_at',
    'client_id,fecha,source_system,ventas_dia,ventas_brutas,descuentos,efectivo,tarjeta,tickets_count,mesas_atendidas,personas_restaurant,ticket_promedio_restaurant,propinas_total,generated_at,otros_medios,no_determinado,excedente_pagos,tickets_no_determinado') THEN
    RAISE EXCEPTION 'preflight: columnas inesperadas en public.ocm_daily (%). No se aplica.', cols;
  END IF;
END
$pre$;

-- La función se llama _v2 y tiene firma propia (3 argumentos, 5 columnas): no choca con ninguna
-- versión anterior de fs_desglose_pago (en producción no existe ninguna, medido 2026-10-01) y
-- CREATE OR REPLACE nunca necesita cambiar un tipo de retorno. Si algún entorno ya tuviera una
-- fs_desglose_pago de otra forma, queda intacta.
CREATE OR REPLACE FUNCTION public.fs_desglose_pago_v2(
  p_total numeric, p_propina numeric, p_pagos jsonb
)
RETURNS TABLE(efectivo numeric, tarjeta numeric, otros_medios numeric,
              no_determinado numeric, excedente_pagos numeric)
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $fn$
  WITH base AS (
    -- Se normaliza a centavos ANTES de clasificar: total, propina y cada monto.
    SELECT COALESCE(p_total, 0) AS total_raw,
           round(COALESCE(p_total, 0), 2) AS total,
           round(COALESCE(p_propina, 0), 2) AS propina,
           CASE WHEN jsonb_typeof(p_pagos) = 'array' THEN p_pagos ELSE '[]'::jsonb END AS pagos
  ), a AS (
    SELECT b.total_raw, b.total, b.propina,
           count(q.e) AS n_el,
           count(q.v) FILTER (WHERE q.v >= 0) AS n_ok,
           COALESCE(sum(q.v), 0) AS suma,
           COALESCE(sum(q.v) FILTER (WHERE q.me ~* 'efec' AND q.me !~* 'tarj'), 0) AS cash,
           COALESCE(sum(q.v) FILTER (WHERE q.me ~* 'tarj' AND q.me !~* 'efec'), 0) AS card,
           COALESCE(sum(q.v) FILTER (WHERE NOT (q.me ~* 'efec' AND q.me !~* 'tarj')
                                       AND NOT (q.me ~* 'tarj' AND q.me !~* 'efec')), 0) AS otros
      FROM base b
      LEFT JOIN LATERAL (
        SELECT e,
               COALESCE(e->>'metodo', '') AS me,
               CASE WHEN jsonb_typeof(e->'monto') IN ('number','string')
                     AND (e->>'monto') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN round((e->>'monto')::numeric, 2) END AS v
          FROM jsonb_array_elements(b.pagos) e
      ) q ON true
     GROUP BY b.total_raw, b.total, b.propina
  ), c AS (
    SELECT a.*,
           (a.n_el > 0 AND a.n_el = a.n_ok AND a.suma > 0) AS valido,
           greatest(a.suma - a.total, 0) AS exceso,
           greatest(a.total - a.suma, 0) AS falta,
           ((a.cash > 0)::int + (a.card > 0)::int + (a.otros > 0)::int) AS clases
      FROM a
  ), d AS (
    SELECT c.*,
           CASE
             WHEN NOT c.valido THEN 'nd'          -- sin pagos detallados o pagos corruptos
             WHEN c.exceso = 0 AND c.falta = 0 THEN 'monto'
             WHEN c.exceso > 0 AND c.clases = 1 THEN 'unica'
             WHEN c.exceso > 0 AND c.propina = 0 AND c.cash >= c.exceso THEN 'cambio'
             WHEN c.falta > 0 AND c.propina = 0 THEN 'falta'
             ELSE 'nd'
           END AS modo
      FROM c
  ), e AS (
    SELECT d.*,
           -- venta ya clasificada (con montos en centavos) según el modo
           CASE d.modo WHEN 'monto' THEN d.suma WHEN 'unica' THEN d.total
                       WHEN 'cambio' THEN d.total WHEN 'falta' THEN d.suma
                       ELSE 0::numeric END AS clasificado
      FROM d
  )
  SELECT
    CASE e.modo WHEN 'unica' THEN CASE WHEN e.cash > 0 THEN e.total ELSE 0::numeric END
                WHEN 'cambio' THEN e.cash - e.exceso
                WHEN 'monto' THEN e.cash WHEN 'falta' THEN e.cash
                ELSE 0::numeric END,
    CASE e.modo WHEN 'unica' THEN CASE WHEN e.card > 0 THEN e.total ELSE 0::numeric END
                WHEN 'cambio' THEN e.card
                WHEN 'monto' THEN e.card WHEN 'falta' THEN e.card
                ELSE 0::numeric END,
    CASE e.modo WHEN 'unica' THEN CASE WHEN e.otros > 0 THEN e.total ELSE 0::numeric END
                WHEN 'cambio' THEN e.otros
                WHEN 'monto' THEN e.otros WHEN 'falta' THEN e.otros
                ELSE 0::numeric END,
    -- residuo explícito: lo no clasificado + cualquier fracción de centavo del total original
    e.total_raw - e.clasificado,
    CASE WHEN e.valido THEN e.exceso ELSE 0::numeric END
  FROM e
$fn$;

COMMENT ON FUNCTION public.fs_desglose_pago_v2(numeric, numeric, jsonb) IS
  'Reparte la venta de un ticket entre efectivo, tarjeta y otros medios sólo cuando es demostrable con sus pagos (normalizados a centavos); el resto queda en no_determinado, que absorbe también el residuo sub-centavo (efectivo+tarjeta+otros+no_determinado = total exacto). Sin pagos detallados = no_determinado: no usa metodo_pago. excedente_pagos = propina incluida + cambio sin repartir. No asume semántica bruta/neta del monto.';

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
            max(o.updated_at) AS generated_at,
            sum(dp.otros_medios) AS otros_medios,
            sum(dp.no_determinado) AS no_determinado,
            sum(dp.excedente_pagos) AS excedente_pagos,
            (count(*) FILTER (WHERE abs(dp.no_determinado) >= 0.005))::integer AS tickets_no_determinado
           FROM pos_orders o
             CROSS JOIN LATERAL public.fs_desglose_pago_v2(o.total, o.propina, o.pagos) dp
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
    live.generated_at,
    live.otros_medios,
    live.no_determinado,
    live.excedente_pagos,
    live.tickets_no_determinado
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
    h.generated_at,
    NULL::numeric,
    NULL::numeric,
    NULL::numeric,
    NULL::integer
   FROM hist h
  WHERE NOT (EXISTS ( SELECT 1
           FROM live l
          WHERE l.client_id = h.client_id AND l.fecha = h.fecha));

-- La vista es security_invoker: quien la consulta ejecuta la función con SUS privilegios. Se
-- limita a los roles que ya pueden leer ocm_daily (anon no puede leerla, así que no necesita
-- la función). Es pura (IMMUTABLE, sin acceso a tablas): no abre datos a nadie.
REVOKE ALL ON FUNCTION public.fs_desglose_pago_v2(numeric, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fs_desglose_pago_v2(numeric, numeric, jsonb)
  TO authenticated, service_role, fullsite_readonly, fullsite_agent;

-- CREATE OR REPLACE conserva opciones y permisos; se reafirma lo que ya tiene producción.
ALTER VIEW public.ocm_daily SET (security_invoker = on);

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- DEFINICIÓN ANTERIOR (reversa). Leída de producción con pg_get_viewdef el 2026-10-01.
-- Difieren: `efectivo`/`tarjeta` de la CTE `live` y su FROM, y las 4 columnas nuevas. Quitar
-- columnas exige DROP VIEW (sin CASCADE a propósito: si alguien creó una vista dependiente, la
-- reversa ABORTA sin cambiar nada; medido el 2026-10-01: ninguna dependiente ni función que la
-- nombre). Se restauran los GRANT exactos de producción.
-- ─────────────────────────────────────────────────────────────────────────────
-- BEGIN;
-- DROP VIEW public.ocm_daily;
-- CREATE VIEW public.ocm_daily AS
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
-- GRANT ALL ON public.ocm_daily TO authenticated, service_role;
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.ocm_daily TO anon;
-- GRANT SELECT ON public.ocm_daily TO fullsite_readonly, fullsite_agent;
-- DROP FUNCTION public.fs_desglose_pago_v2(numeric, numeric, jsonb);
-- COMMIT;
