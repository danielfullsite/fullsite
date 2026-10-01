-- ocm_daily: desglose de la venta por pagos reales con "no determinado" — prueba repetible.
--
-- Corre DESPUÉS de aplicar supabase/migrations/PENDIENTE_20261001000000_ocm_daily_desglose_pagos.sql
-- en PostgreSQL aislado o staging. Todo ocurre en una transacción y termina en ROLLBACK.
-- El aislamiento entre tenants y el acceso de anon/authenticated se prueba en
-- supabase/tests/ocm_daily_acceso_test.sql (necesita roles y RLS reales).
--
-- Qué protege:
--   * pago mixto: se reparte por pagos, no por la primera forma de pago;
--   * cambio sin propina (E > 0, P = 0): se resta del efectivo;
--   * una sola clase de pago: la venta va íntegra a esa clase aunque traiga propina/cambio;
--   * AMBIGUOS -> no_determinado, sin atribuir propina ni cambio por descarte:
--       tarjeta+transferencia con propina y excedente, efectivo+tarjeta con propina y excedente,
--       subcobro con propina, pagos corruptos, sin método ni pagos;
--   * varios pagos de la misma clase; datos incompletos (nulo, no-array, vacío, no numérico,
--     negativo);
--   * efectivo + tarjeta + otros_medios + no_determinado = total, por ticket y por día;
--   * excedente_pagos (propina incluida + cambio) se muestra aparte y sin repartir;
--   * propinas_total no se mezcla con las ventas; límites de fecha; sin duplicados.
--
-- Los importes son sintéticos y NO dependen de ningún día real ni de ningún restaurante.
--
-- Uso:
--   psql "$URL_AISLADA" -v ON_ERROR_STOP=1 -f supabase/tests/ocm_daily_desglose_pagos_test.sql
-- Debe imprimir todas las filas con ok = t y una última fila 'RESUMEN' con ok = t.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.ins(p_client text, p_id text, p_total numeric, p_propina numeric,
                                       p_metodo text, p_pagos jsonb, p_status text DEFAULT 'cerrada',
                                       p_ts timestamptz DEFAULT timestamptz '2026-09-30 12:00:00-06')
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.pos_orders (id, client_id, status, turno_id, total, subtotal, iva, descuento,
                                 propina, metodo_pago, pagos, mesa, personas, created_at)
  VALUES (p_id, p_client, p_status, 'tst-desglose', p_total, p_total, 0, 0,
          p_propina, p_metodo, p_pagos, 1, 1, p_ts);
$$;

-- ── Tenant A: estilo espejo (monto de tarjeta con propina, monto de efectivo con cambio) ──
SELECT pg_temp.ins('tst-desglose-a','a1', 500, 0, 'Efectivo', '[{"metodo":"Efectivo","monto":600}]');                       -- efectivo con cambio
SELECT pg_temp.ins('tst-desglose-a','a2', 1000, 150, 'Tarjeta de crédito', '[{"metodo":"Tarjeta de crédito","monto":1150}]'); -- tarjeta con propina
SELECT pg_temp.ins('tst-desglose-a','a3', 1000, 100, 'Efectivo', '[{"metodo":"Efectivo","monto":400},{"metodo":"Tarjeta de débito","monto":800}]'); -- AMBIGUO: efectivo+tarjeta, propina y excedente
SELECT pg_temp.ins('tst-desglose-a','a3b', 1000, 0, 'Efectivo', '[{"metodo":"Efectivo","monto":600},{"metodo":"Tarjeta de débito","monto":500}]');   -- mixto con cambio, sin propina
SELECT pg_temp.ins('tst-desglose-a','a4', 500, 50, 'Transferencia electrónica', '[{"metodo":"Transferencia electrónica","monto":550}]'); -- transferencia sola con propina
SELECT pg_temp.ins('tst-desglose-a','a5', 970, 0, 'Rappi', '[{"metodo":"Rappi","monto":970}]');
SELECT pg_temp.ins('tst-desglose-a','a6', 300, 0, 'Efectivo', '[{"metodo":"Efectivo","monto":100},{"metodo":"Rappi","monto":200}]');
SELECT pg_temp.ins('tst-desglose-a','a7', 200, 0, 'Tarjeta', '[]');                                    -- sin pagos con metodo declarado: NO alimenta tarjeta, va a no_determinado
SELECT pg_temp.ins('tst-desglose-a','a8', 150, 0, 'Efectivo', '"texto"');                              -- pagos no-array con metodo declarado: no_determinado
SELECT pg_temp.ins('tst-desglose-a','a9', 999, 0, 'Efectivo', '[{"metodo":"Efectivo","monto":999}]', 'cancelada'); -- no cuenta
SELECT pg_temp.ins('tst-desglose-a','a10', 1000, 100, 'Tarjeta de crédito', '[{"metodo":"Tarjeta de crédito","monto":600},{"metodo":"Transferencia electrónica","monto":500}]'); -- AMBIGUO: tarjeta+transferencia con propina
SELECT pg_temp.ins('tst-desglose-a','a11', 1000, 50, 'Tarjeta de crédito', '[{"metodo":"Tarjeta de crédito","monto":600},{"metodo":"Transferencia electrónica","monto":400}]'); -- tarjeta+transferencia, suma = total
SELECT pg_temp.ins('tst-desglose-a','a12', 450, 0, 'Efectivo', '[{"metodo":"Efectivo","monto":200},{"metodo":"Efectivo","monto":300}]');          -- varios pagos misma clase, cambio
SELECT pg_temp.ins('tst-desglose-a','a13', 500, 0, 'Efectivo', '[{"metodo":"Efectivo","monto":300},{"metodo":"Tarjeta de débito","monto":200}]'); -- varios pagos, suma = total
SELECT pg_temp.ins('tst-desglose-a','a14', 500, 0, 'Tarjeta', '[{"metodo":"Tarjeta","monto":300}]');   -- subcobro sin propina
SELECT pg_temp.ins('tst-desglose-a','a15', 500, 20, 'Efectivo', '[{"metodo":"Efectivo","monto":300},{"metodo":"Tarjeta","monto":100}]'); -- subcobro con propina
SELECT pg_temp.ins('tst-desglose-a','a16', 300, 0, NULL, NULL);                                        -- sin metodo ni pagos
SELECT pg_temp.ins('tst-desglose-a','a17', 200, 0, 'Tarjeta', '[{"metodo":"Tarjeta","monto":"abc"}]'); -- pagos corruptos
SELECT pg_temp.ins('tst-desglose-a','a18', 200, 0, 'Tarjeta', '[{"metodo":"Tarjeta","monto":250},{"metodo":"Efectivo","monto":-50}]'); -- monto negativo

-- ── Tenant B: estilo nativo (sum(monto) = total; propina aparte) y semántica desconocida ──
SELECT pg_temp.ins('tst-desglose-b','b1', 800, 80, 'Tarjeta', '[{"metodo":"Tarjeta","monto":800}]');
SELECT pg_temp.ins('tst-desglose-b','b2', 300, 30, 'Efectivo', '[{"metodo":"Efectivo","monto":300}]');
SELECT pg_temp.ins('tst-desglose-b','b3', 500, 50, 'Tarjeta', '[{"metodo":"Tarjeta","monto":300},{"metodo":"Efectivo","monto":200}]');
SELECT pg_temp.ins('tst-desglose-b','b4', 100, 10, 'Efectivo', '[{"metodo":"Efectivo","monto":110}]');   -- una sola clase con excedente
SELECT pg_temp.ins('tst-desglose-b','b5', 100, 0, NULL, '[{"metodo":"Efectivo","monto":100}]');         -- metodo_pago NULL con pagos (caso tekila-rg)
SELECT pg_temp.ins('tst-desglose-b','b6', 450, 50, 'Tarjeta', '[{"metodo":"Tarjeta","monto":300},{"metodo":"Efectivo","monto":200}]'); -- AMBIGUO: semántica desconocida, E=P

-- ── Tenant C: límites de fecha (día calendario America/Monterrey, como la vista) ──
SELECT pg_temp.ins('tst-desglose-c','c1', 100, 0, 'Efectivo', '[{"metodo":"Efectivo","monto":100}]', 'cerrada', timestamptz '2026-09-30 23:59:59-06');
SELECT pg_temp.ins('tst-desglose-c','c2', 200, 0, 'Tarjeta',  '[{"metodo":"Tarjeta","monto":200}]',  'cerrada', timestamptz '2026-10-01 00:00:01-06');

-- ── Tenant D: frontera de centavos (montos y total con fracciones de centavo) ──
SELECT pg_temp.ins('tst-desglose-d','d1', 100, 0, 'Efectivo', '[{"metodo":"Efectivo","monto":100.004}]');                -- 100.004 -> 100.00
SELECT pg_temp.ins('tst-desglose-d','d2', 100, 0, 'Tarjeta',  '[{"metodo":"Tarjeta","monto":99.996}]');                 -- 99.996 -> 100.00
SELECT pg_temp.ins('tst-desglose-d','d3', 100, 0, 'Efectivo', '[{"metodo":"Efectivo","monto":50.004},{"metodo":"Tarjeta","monto":49.996}]'); -- suma 100.000
SELECT pg_temp.ins('tst-desglose-d','d4', 100.004, 0, 'Efectivo', '[{"metodo":"Efectivo","monto":100.00}]');             -- total con fracción: residuo explícito
SELECT pg_temp.ins('tst-desglose-d','d5', 100, 0, 'Efectivo', '[{"metodo":"Efectivo","monto":100.006}]');               -- 100.006 -> 100.01: excedente 0.01
SELECT pg_temp.ins('tst-desglose-d','d6', 100, 0, 'Efectivo', '[{"metodo":"Efectivo","monto":60.004},{"metodo":"Tarjeta","monto":40.006}]'); -- 60.00 + 40.01: cambio 0.01 al efectivo

-- Esperado por ticket: efectivo, tarjeta, otros, no_determinado, excedente_pagos
CREATE TEMP TABLE _esp(id text PRIMARY KEY, ef numeric, tj numeric, ot numeric, nd numeric, ex numeric);
INSERT INTO _esp VALUES
 ('a1',  500,   0,   0,    0, 100),
 ('a2',    0, 1000,  0,    0, 150),
 ('a3',    0,   0,   0, 1000, 200),
 ('a3b', 500, 500,   0,    0, 100),
 ('a4',    0,   0, 500,    0,  50),
 ('a5',    0,   0, 970,    0,   0),
 ('a6',  100,   0, 200,    0,   0),
 ('a7',    0,   0,   0,  200,   0),
 ('a8',    0,   0,   0,  150,   0),
 ('a10',   0,   0,   0, 1000, 100),
 ('a11',   0, 600, 400,    0,   0),
 ('a12', 450,   0,   0,    0,  50),
 ('a13', 300, 200,   0,    0,   0),
 ('a14',   0, 300,   0,  200,   0),
 ('a15',   0,   0,   0,  500,   0),
 ('a16',   0,   0,   0,  300,   0),
 ('a17',   0,   0,   0,  200,   0),
 ('a18',   0,   0,   0,  200,   0),
 ('b1',    0, 800,   0,    0,   0),
 ('b2',  300,   0,   0,    0,   0),
 ('b3',  200, 300,   0,    0,   0),
 ('b4',  100,   0,   0,    0,  10),
 ('b5',  100,   0,   0,    0,   0),
 ('b6',    0,   0,   0,  450,  50),
 ('d1',  100,   0,   0,    0,   0),
 ('d2',    0, 100,   0,    0,   0),
 ('d3',   50,  50,   0,    0,   0),
 ('d4',  100,   0,   0,  0.004,   0),
 ('d5',  100,   0,   0,    0, 0.01),
 ('d6', 59.99, 40.01,  0,    0, 0.01),
 ('c1',  100,   0,   0,    0,   0),
 ('c2',    0, 200,   0,    0,   0);

CREATE OR REPLACE FUNCTION pg_temp.probar()
RETURNS TABLE(caso text, esperado text, resultado text, ok boolean)
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  -- 1. Cada ticket por la función real
  FOR r IN
    SELECT o.id, o.total, e.*, f.efectivo, f.tarjeta, f.otros_medios, f.no_determinado, f.excedente_pagos
      FROM public.pos_orders o
      JOIN _esp e USING (id)
      CROSS JOIN LATERAL public.fs_desglose_pago_v2(o.total, o.propina, o.pagos) f
     ORDER BY o.id
  LOOP
    RETURN QUERY SELECT 'ticket ' || r.id,
      r.ef::text||'/'||r.tj::text||'/'||r.ot::text||'/'||r.nd::text||' exc '||r.ex::text,
      r.efectivo::text||'/'||r.tarjeta::text||'/'||r.otros_medios::text||'/'||r.no_determinado::text||' exc '||r.excedente_pagos::text,
      r.efectivo = r.ef AND r.tarjeta = r.tj AND r.otros_medios = r.ot AND r.no_determinado = r.nd AND r.excedente_pagos = r.ex;
    -- conservación del total por ticket
    RETURN QUERY SELECT 'conserva total ' || r.id, r.total::text,
      (r.efectivo + r.tarjeta + r.otros_medios + r.no_determinado)::text,
      r.efectivo + r.tarjeta + r.otros_medios + r.no_determinado = r.total;
  END LOOP;
  -- 2. Vista, tenant A (fecha 2026-09-30; a9 cancelada fuera) -> 18 tickets
  FOR r IN SELECT * FROM public.ocm_daily WHERE client_id='tst-desglose-a' AND fecha=date '2026-09-30' LOOP
    RETURN QUERY SELECT 'A vista ventas/efectivo/tarjeta/otros/nd', '10270/1850/2600/2070/3750',
      r.ventas_dia::text||'/'||r.efectivo::text||'/'||r.tarjeta::text||'/'||r.otros_medios::text||'/'||r.no_determinado::text,
      r.ventas_dia=10270 AND r.efectivo=1850 AND r.tarjeta=2600 AND r.otros_medios=2070 AND r.no_determinado=3750;
    RETURN QUERY SELECT 'A vista propinas_total (aparte de ventas)', '470', r.propinas_total::text, r.propinas_total=470;
    RETURN QUERY SELECT 'A vista excedente_pagos (propina incluida + cambio, sin repartir)', '750', r.excedente_pagos::text, r.excedente_pagos=750;
    RETURN QUERY SELECT 'A vista tickets / tickets_no_determinado', '18/9', r.tickets_count::text||'/'||r.tickets_no_determinado::text, r.tickets_count=18 AND r.tickets_no_determinado=9;
    RETURN QUERY SELECT 'A vista conserva total del día', r.ventas_dia::text,
      (r.efectivo+r.tarjeta+r.otros_medios+r.no_determinado)::text,
      r.efectivo+r.tarjeta+r.otros_medios+r.no_determinado = r.ventas_dia;
  END LOOP;
  -- 3. Vista, tenant B -> 6 tickets
  FOR r IN SELECT * FROM public.ocm_daily WHERE client_id='tst-desglose-b' AND fecha=date '2026-09-30' LOOP
    RETURN QUERY SELECT 'B vista ventas/efectivo/tarjeta/otros/nd', '2250/700/1100/0/450',
      r.ventas_dia::text||'/'||r.efectivo::text||'/'||r.tarjeta::text||'/'||r.otros_medios::text||'/'||r.no_determinado::text,
      r.ventas_dia=2250 AND r.efectivo=700 AND r.tarjeta=1100 AND r.otros_medios=0 AND r.no_determinado=450;
    RETURN QUERY SELECT 'B vista propinas/excedente/tickets/tk_nd', '220/60/6/1',
      r.propinas_total::text||'/'||r.excedente_pagos::text||'/'||r.tickets_count::text||'/'||r.tickets_no_determinado::text,
      r.propinas_total=220 AND r.excedente_pagos=60 AND r.tickets_count=6 AND r.tickets_no_determinado=1;
  END LOOP;
  -- 3b. Vista, tenant D (centavos)
  FOR r IN SELECT * FROM public.ocm_daily WHERE client_id='tst-desglose-d' AND fecha=date '2026-09-30' LOOP
    RETURN QUERY SELECT 'D vista ventas/efectivo/tarjeta/otros/nd (centavos)', '600.004/409.99/190.01/0/0.004',
      r.ventas_dia::text||'/'||r.efectivo::text||'/'||r.tarjeta::text||'/'||r.otros_medios::text||'/'||r.no_determinado::text,
      r.ventas_dia=600.004 AND r.efectivo=409.99 AND r.tarjeta=190.01 AND r.otros_medios=0 AND r.no_determinado=0.004;
    RETURN QUERY SELECT 'D vista conserva el total EXACTO (sin tolerancia)', r.ventas_dia::text,
      (r.efectivo+r.tarjeta+r.otros_medios+r.no_determinado)::text,
      r.efectivo+r.tarjeta+r.otros_medios+r.no_determinado = r.ventas_dia;
    RETURN QUERY SELECT 'D residuo sub-centavo no cuenta como ticket no determinado', '0', r.tickets_no_determinado::text, r.tickets_no_determinado = 0;
  END LOOP;
  -- 4. Fechas
  FOR r IN SELECT * FROM public.ocm_daily WHERE client_id='tst-desglose-c' AND fecha=date '2026-09-30' LOOP
    RETURN QUERY SELECT 'C 30/09 23:59:59', '100/100/0/0/1',
      r.ventas_dia::text||'/'||r.efectivo::text||'/'||r.tarjeta::text||'/'||r.no_determinado::text||'/'||r.tickets_count::text,
      r.ventas_dia=100 AND r.efectivo=100 AND r.tarjeta=0 AND r.no_determinado=0 AND r.tickets_count=1;
  END LOOP;
  FOR r IN SELECT * FROM public.ocm_daily WHERE client_id='tst-desglose-c' AND fecha=date '2026-10-01' LOOP
    RETURN QUERY SELECT 'C 01/10 00:00:01', '200/0/200/0/1',
      r.ventas_dia::text||'/'||r.efectivo::text||'/'||r.tarjeta::text||'/'||r.no_determinado::text||'/'||r.tickets_count::text,
      r.ventas_dia=200 AND r.efectivo=0 AND r.tarjeta=200 AND r.no_determinado=0 AND r.tickets_count=1;
  END LOOP;
  -- 5. Filas, duplicados
  RETURN QUERY SELECT 'filas de prueba en la vista (A, B, D, C x 2 días)', '5',
    (SELECT count(*) FROM public.ocm_daily WHERE client_id LIKE 'tst-desglose-%')::text,
    (SELECT count(*) FROM public.ocm_daily WHERE client_id LIKE 'tst-desglose-%') = 5;
  RETURN QUERY SELECT 'sin duplicados: ventas de la vista = suma directa de pos_orders', 'igual',
    (SELECT sum(ventas_dia)::text FROM public.ocm_daily WHERE client_id LIKE 'tst-desglose-%')||' vs '||
    (SELECT sum(total)::text FROM public.pos_orders WHERE client_id LIKE 'tst-desglose-%' AND status='cerrada'),
    (SELECT sum(ventas_dia) FROM public.ocm_daily WHERE client_id LIKE 'tst-desglose-%')
      = (SELECT sum(total) FROM public.pos_orders WHERE client_id LIKE 'tst-desglose-%' AND status='cerrada');
  BEGIN
    PERFORM pg_temp.ins('tst-desglose-a','a1', 500, 0, 'Efectivo', '[{"metodo":"Efectivo","monto":600}]');
    RETURN QUERY SELECT 'id duplicado rechazado', 'unique_violation', 'se insertó', false;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT 'id duplicado rechazado', 'unique_violation', 'unique_violation', true;
  END;
  -- 6. Entradas nulas y casos de función directa
  RETURN QUERY SELECT 'entradas nulas: todo 0', '0/0/0/0/0',
    (SELECT efectivo::text||'/'||tarjeta::text||'/'||otros_medios::text||'/'||no_determinado::text||'/'||excedente_pagos::text
       FROM public.fs_desglose_pago_v2(NULL,NULL,NULL)),
    (SELECT efectivo=0 AND tarjeta=0 AND otros_medios=0 AND no_determinado=0 AND excedente_pagos=0
       FROM public.fs_desglose_pago_v2(NULL,NULL,NULL));
  RETURN QUERY SELECT 'tarjeta+transferencia con propina SOLO en transferencia: no se asigna a tarjeta', '0/0/0/1000',
    (SELECT efectivo::text||'/'||tarjeta::text||'/'||otros_medios::text||'/'||no_determinado::text
       FROM public.fs_desglose_pago_v2(1000,100,'[{"metodo":"Tarjeta","monto":600},{"metodo":"Transferencia","monto":500}]'::jsonb)),
    (SELECT no_determinado=1000 AND tarjeta=0 AND otros_medios=0
       FROM public.fs_desglose_pago_v2(1000,100,'[{"metodo":"Tarjeta","monto":600},{"metodo":"Transferencia","monto":500}]'::jsonb));
  RETURN QUERY SELECT 'tarjeta+transferencia con propina SOLO en tarjeta: tampoco se asigna', '0/0/0/1000',
    (SELECT efectivo::text||'/'||tarjeta::text||'/'||otros_medios::text||'/'||no_determinado::text
       FROM public.fs_desglose_pago_v2(1000,100,'[{"metodo":"Tarjeta","monto":700},{"metodo":"Transferencia","monto":400}]'::jsonb)),
    (SELECT no_determinado=1000
       FROM public.fs_desglose_pago_v2(1000,100,'[{"metodo":"Tarjeta","monto":700},{"metodo":"Transferencia","monto":400}]'::jsonb));
  RETURN QUERY SELECT 'centavos literales: total 100.00, un pago 100.004 / otro 99.996', '100/0/0/0 y 0/100/0/0',
    (SELECT efectivo::text||'/'||tarjeta::text||'/'||otros_medios::text||'/'||no_determinado::text FROM public.fs_desglose_pago_v2(100,0,'[{"metodo":"Efectivo","monto":100.004}]'::jsonb))
    ||' y '||(SELECT efectivo::text||'/'||tarjeta::text||'/'||otros_medios::text||'/'||no_determinado::text FROM public.fs_desglose_pago_v2(100,0,'[{"metodo":"Tarjeta","monto":99.996}]'::jsonb)),
    (SELECT efectivo=100 AND tarjeta=0 AND no_determinado=0 FROM public.fs_desglose_pago_v2(100,0,'[{"metodo":"Efectivo","monto":100.004}]'::jsonb))
    AND (SELECT efectivo=0 AND tarjeta=100 AND no_determinado=0 FROM public.fs_desglose_pago_v2(100,0,'[{"metodo":"Tarjeta","monto":99.996}]'::jsonb));
  RETURN QUERY SELECT 'sin pagos: metodo_pago no se usa (la firma ni lo recibe)', '0/0/0/200',
    (SELECT efectivo::text||'/'||tarjeta::text||'/'||otros_medios::text||'/'||no_determinado::text FROM public.fs_desglose_pago_v2(200,0,'[]'::jsonb)),
    (SELECT efectivo=0 AND tarjeta=0 AND otros_medios=0 AND no_determinado=200 FROM public.fs_desglose_pago_v2(200,0,'[]'::jsonb));
  RETURN QUERY SELECT 'mismos pagos, distinto orden: mismo resultado', 'igual',
    'comparado',
    (SELECT row(a.*) = row(b.*) FROM
       public.fs_desglose_pago_v2(1000,0,'[{"metodo":"Efectivo","monto":600},{"metodo":"Tarjeta","monto":500}]'::jsonb) a,
       public.fs_desglose_pago_v2(1000,0,'[{"metodo":"Tarjeta","monto":500},{"metodo":"Efectivo","monto":600}]'::jsonb) b);
END;
$$;

CREATE TEMP TABLE _resultado AS SELECT * FROM pg_temp.probar();
SELECT * FROM _resultado;
SELECT 'RESUMEN'::text AS caso, 'todas las filas ok'::text AS esperado,
       count(*) FILTER (WHERE NOT ok)::text || ' fallos de ' || count(*)::text AS resultado,
       bool_and(ok) AS ok
  FROM _resultado;

ROLLBACK;
