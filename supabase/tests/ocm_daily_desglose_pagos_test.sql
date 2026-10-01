-- ocm_daily: desglose efectivo/tarjeta por pagos reales — prueba repetible.
--
-- Corre contra STAGING (o una base desechable) DESPUÉS de aplicar
-- supabase/migrations/PENDIENTE_20261001000000_ocm_daily_desglose_pagos.sql.
-- Todo ocurre dentro de una transacción y termina en ROLLBACK: no deja filas.
--
-- Qué protege:
--   * pago mixto: el ticket se reparte por sus pagos, no por la primera forma de pago;
--   * cambio: se resta del efectivo; propina incluida en la tarjeta: se resta de la tarjeta;
--   * dos tenants con semánticas distintas de `monto` (A = espejo: monto con propina y
--     cambio; B = nativo: monto = total, propina aparte) no se cruzan ni se contaminan;
--   * la propina NO se generaliza a transferencia ni a apps (se conserva la regla anterior);
--   * pagos vacíos o no-array conservan el comportamiento anterior;
--   * metodo_pago NULL con pagos reales (caso tekila-rg) ahora se clasifica por sus pagos.
--
-- Uso:
--   psql "$STAGING_URL" -v ON_ERROR_STOP=1 -f supabase/tests/ocm_daily_desglose_pagos_test.sql
-- Debe imprimir todas las filas con ok = t y una última fila 'RESUMEN' con ok = t.

BEGIN;

-- Fila sintética mínima. Un ticket = una orden cerrada el 2026-09-30 a mediodía (America/Monterrey).
CREATE OR REPLACE FUNCTION pg_temp.ins(p_client text, p_id text, p_total numeric, p_propina numeric,
                                       p_metodo text, p_pagos jsonb, p_status text DEFAULT 'cerrada')
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.pos_orders (id, client_id, status, turno_id, total, subtotal, iva, descuento,
                                 propina, metodo_pago, pagos, mesa, personas, created_at)
  VALUES (p_id, p_client, p_status, 'tst-desglose', p_total, p_total, 0, 0,
          p_propina, p_metodo, p_pagos, 1, 1, timestamptz '2026-09-30 12:00:00-06');
$$;

-- ── Tenant A: espejo (monto de tarjeta incluye propina; monto de efectivo incluye cambio) ──
-- A1 efectivo con cambio: paga 600 por una cuenta de 500
SELECT pg_temp.ins('tst-desglose-a','tst-a1', 500, 0,   'Efectivo',
  '[{"metodo":"Efectivo","monto":600}]');
-- A2 tarjeta con propina incluida: cuenta 1000, propina 150, cargo 1150
SELECT pg_temp.ins('tst-desglose-a','tst-a2', 1000, 150, 'Tarjeta de crédito',
  '[{"metodo":"Tarjeta de crédito","monto":1150}]');
-- A3 mixto con cambio Y propina: cuenta 1000; efectivo 400 (cambio 100) + tarjeta 800 (propina 100)
--    La primera forma de pago es Efectivo: la vista anterior mandaba los 1000 a efectivo.
SELECT pg_temp.ins('tst-desglose-a','tst-a3', 1000, 100, 'Efectivo',
  '[{"metodo":"Efectivo","monto":400},{"metodo":"Tarjeta de débito","monto":800}]');
-- A4 sólo transferencia con propina: NO se resta propina de ningún lado (regla no generalizada)
SELECT pg_temp.ins('tst-desglose-a','tst-a4', 500, 50,  'Transferencia electrónica',
  '[{"metodo":"Transferencia electrónica","monto":550}]');
-- A5 app: no cae en efectivo ni en tarjeta
SELECT pg_temp.ins('tst-desglose-a','tst-a5', 970, 0,   'Rappi',
  '[{"metodo":"Rappi","monto":970}]');
-- A6 efectivo + app mezclados: no queda explicado por efectivo/tarjeta -> regla anterior
SELECT pg_temp.ins('tst-desglose-a','tst-a6', 300, 0,   'Efectivo',
  '[{"metodo":"Efectivo","monto":100},{"metodo":"Rappi","monto":200}]');
-- A7 sin pagos: regla anterior por metodo_pago
SELECT pg_temp.ins('tst-desglose-a','tst-a7', 200, 0,   'Tarjeta', '[]');
-- A8 pagos que no es arreglo: regla anterior
SELECT pg_temp.ins('tst-desglose-a','tst-a8', 150, 0,   'Efectivo', '"texto"');
-- A9 cancelada: no cuenta
SELECT pg_temp.ins('tst-desglose-a','tst-a9', 999, 0,   'Efectivo',
  '[{"metodo":"Efectivo","monto":999}]', 'cancelada');

-- ── Tenant B: nativo (monto = total; propina aparte; sin cambio) ──
SELECT pg_temp.ins('tst-desglose-b','tst-b1', 800, 80,  'Tarjeta',
  '[{"metodo":"Tarjeta","monto":800}]');
SELECT pg_temp.ins('tst-desglose-b','tst-b2', 300, 30,  'Efectivo',
  '[{"metodo":"Efectivo","monto":300}]');
-- B3 mixto nativo: 200 efectivo + 300 tarjeta = 500, propina 50 aparte
SELECT pg_temp.ins('tst-desglose-b','tst-b3', 500, 50,  'Tarjeta',
  '[{"metodo":"Tarjeta","monto":300},{"metodo":"Efectivo","monto":200}]');
-- B4 efectivo con propina incluida en el monto (estilo demo): la propina no cabe en tarjeta
--    -> se conserva la regla anterior (efectivo = total)
SELECT pg_temp.ins('tst-desglose-b','tst-b4', 100, 10,  'Efectivo',
  '[{"metodo":"Efectivo","monto":110}]');
-- B5 metodo_pago NULL con pagos reales (tekila-rg hoy: 3,387 de 3,387 tickets): antes caía en
--    ningún cajón; ahora se lee de pagos. Es un CAMBIO DE COMPORTAMIENTO esperado y visible.
SELECT pg_temp.ins('tst-desglose-b','tst-b5', 100, 0,   NULL,
  '[{"metodo":"Efectivo","monto":100}]');

CREATE OR REPLACE FUNCTION pg_temp.probar()
RETURNS TABLE(caso text, esperado text, resultado text, ok boolean)
LANGUAGE plpgsql AS $$
DECLARE
  r record;
  fallos int := 0;
BEGIN
  -- Totales por tenant desde la vista real (fecha de venta 2026-09-30)
  -- A: efectivo = A1 500 + A3 300 + A6 300(regla anterior) + A8 150(regla anterior) = 1250
  --    tarjeta  = A2 1000 + A3 700 + A7 200(regla anterior) = 1900
  --    venta    = 500+1000+1000+500+970+300+200+150 = 4620 (A9 cancelada fuera)
  FOR r IN SELECT * FROM public.ocm_daily WHERE client_id = 'tst-desglose-a' AND fecha = date '2026-09-30' LOOP
    RETURN QUERY SELECT 'A ventas_dia'::text, '4620.00'::text, r.ventas_dia::text, r.ventas_dia = 4620;
    RETURN QUERY SELECT 'A efectivo'::text,   '1250.00'::text, r.efectivo::text,   r.efectivo = 1250;
    RETURN QUERY SELECT 'A tarjeta'::text,    '1900.00'::text, r.tarjeta::text,    r.tarjeta = 1900;
    RETURN QUERY SELECT 'A propinas_total (sin cambio por el desglose)'::text, '300.00'::text, r.propinas_total::text, r.propinas_total = 300;
    RETURN QUERY SELECT 'A tickets'::text, '8'::text, r.tickets_count::text, r.tickets_count = 8;
  END LOOP;
  -- B: efectivo = B2 300 + B3 200 + B4 100(regla anterior) + B5 100(metodo_pago NULL, por pagos) = 700
  --    tarjeta = B1 800 + B3 300 = 1100 ; venta 1800
  FOR r IN SELECT * FROM public.ocm_daily WHERE client_id = 'tst-desglose-b' AND fecha = date '2026-09-30' LOOP
    RETURN QUERY SELECT 'B ventas_dia'::text, '1800.00'::text, r.ventas_dia::text, r.ventas_dia = 1800;
    RETURN QUERY SELECT 'B efectivo'::text,   '700.00'::text,  r.efectivo::text,   r.efectivo = 700;
    RETURN QUERY SELECT 'B tarjeta'::text,    '1100.00'::text, r.tarjeta::text,    r.tarjeta = 1100;
    RETURN QUERY SELECT 'B tickets'::text, '5'::text, r.tickets_count::text, r.tickets_count = 5;
  END LOOP;
  -- Aislamiento: ningún tenant ve filas del otro y no hay más filas de prueba que las dos
  RETURN QUERY SELECT 'aislamiento: filas de prueba'::text, '2'::text,
    (SELECT count(*) FROM public.ocm_daily WHERE client_id LIKE 'tst-desglose-%' AND fecha = date '2026-09-30')::text,
    (SELECT count(*) FROM public.ocm_daily WHERE client_id LIKE 'tst-desglose-%' AND fecha = date '2026-09-30') = 2;
  -- Casos puntuales de la función
  RETURN QUERY SELECT 'A3 por la función: efectivo 300 / tarjeta 700 (cambio 100, propina 100)'::text, '300/700'::text,
    (SELECT efectivo::text || '/' || tarjeta::text FROM public.fs_desglose_pago(1000, 100,
       '[{"metodo":"Efectivo","monto":400},{"metodo":"Tarjeta de débito","monto":800}]'::jsonb, 'Efectivo')),
    (SELECT efectivo = 300 AND tarjeta = 700 FROM public.fs_desglose_pago(1000, 100,
       '[{"metodo":"Efectivo","monto":400},{"metodo":"Tarjeta de débito","monto":800}]'::jsonb, 'Efectivo'));
  RETURN QUERY SELECT 'A4 transferencia con propina: 0 / 0 (propina no generalizada)'::text, '0/0'::text,
    (SELECT efectivo::text || '/' || tarjeta::text FROM public.fs_desglose_pago(500, 50,
       '[{"metodo":"Transferencia electrónica","monto":550}]'::jsonb, 'Transferencia electrónica')),
    (SELECT efectivo = 0 AND tarjeta = 0 FROM public.fs_desglose_pago(500, 50,
       '[{"metodo":"Transferencia electrónica","monto":550}]'::jsonb, 'Transferencia electrónica'));
  RETURN QUERY SELECT 'entradas nulas: 0 / 0'::text, '0/0'::text,
    (SELECT coalesce(efectivo,-1)::text || '/' || coalesce(tarjeta,-1)::text FROM public.fs_desglose_pago(NULL, NULL, NULL, NULL)),
    (SELECT efectivo = 0 AND tarjeta = 0 FROM public.fs_desglose_pago(NULL, NULL, NULL, NULL));
  -- Monto no numérico no revienta la vista: cae a la regla anterior
  RETURN QUERY SELECT 'monto no numérico: regla anterior (tarjeta = total)'::text, '0/200'::text,
    (SELECT efectivo::text || '/' || tarjeta::text FROM public.fs_desglose_pago(200, 0,
       '[{"metodo":"Tarjeta","monto":"abc"}]'::jsonb, 'Tarjeta')),
    (SELECT efectivo = 0 AND tarjeta = 200 FROM public.fs_desglose_pago(200, 0,
       '[{"metodo":"Tarjeta","monto":"abc"}]'::jsonb, 'Tarjeta'));
END;
$$;

CREATE TEMP TABLE _resultado AS SELECT * FROM pg_temp.probar();
SELECT * FROM _resultado;
SELECT 'RESUMEN'::text AS caso, 'todas las filas ok'::text AS esperado,
       count(*) FILTER (WHERE NOT ok)::text || ' fallos de ' || count(*)::text AS resultado,
       bool_and(ok) AS ok
  FROM _resultado;

ROLLBACK;
