-- wansoft_data.data: convertir los escalares de tipo string a objetos y arreglos jsonb.
--
-- POR QUÉ
-- La columna es jsonb, pero los scrapers mandaban `json.dumps([...])` — un STRING de
-- Python. PostgREST lo guardaba como escalar JSON de tipo string, no como contenedor.
-- El dashboard nunca se dio cuenta porque todos sus lectores desenvuelven el string;
-- lo que quedó roto es la consulta desde SQL:
--
--     select jsonb_typeof(data), count(*) from wansoft_data group by 1;
--     -- string | 670     ← el bug
--     -- array  |  32
--
-- Sobre un escalar string, `data->>'campo'` devuelve NULL y `jsonb_array_elements(data)`
-- revienta. El escritor ya quedó arreglado (los 14 payloads mandan el valor directo).
-- Esta migración es para lo que ya se guardó mal antes de ese cambio.
--
-- OBJETO **O** ARREGLO. Aquí, a diferencia de agent_results, el arreglo es una forma
-- legítima: la mayoría de las claves (`platillos_full`, `food_cost_browser`, `tips_browser`…)
-- guardan una lista de renglones. Ni esta migración ni las pruebas exigen objeto.
--
-- ALCANCE MEDIDO EN PRODUCCIÓN (amalay, 2026-08-26, sólo lectura)
--   702 filas totales · 670 escalares string (95.4%) · 32 arreglos · 2,928 kB
--   Las 670 desenvuelven en UN solo paso — no hay doble escapado, ninguna queda en
--   string. Se reparten así:
--       → arreglo: 497 filas, 35 claves,   461 kB
--       → objeto:  173 filas, 12 claves, 1,394 kB
--   Las 32 que ya son arreglo son `platillos_full` y tres claves de costeo, escritas
--   por intraday_sales.py, que siempre mandó la lista directa. No se tocan.
--   Un solo tenant (amalay) en la tabla al día de hoy.
--
-- SEGURIDAD
--   · Corre en una transacción: si una fila trae JSON inválido, revienta el cast y
--     revierte TODO. No hay estado a medias.
--   · Es idempotente: el WHERE filtra por jsonb_typeof = 'string', así que una
--     segunda corrida no hace nada.
--   · Deja respaldo en `wansoft_data_respaldo_jsonb` antes de tocar nada. El respaldo
--     nace con RLS prendida y SIN policies: la tabla original tiene RLS con 6 policies,
--     y una copia sin protección sería una fuga de datos del tenant. Sólo service_role
--     (que salta RLS) la puede leer.
--
-- ESTO NO ES OBLIGATORIO PARA QUE EL DASHBOARD FUNCIONE. Todos los lectores (TS y
-- Python) toleran las dos formas. Lo que desbloquea es poder consultar el histórico
-- desde SQL y desde las vistas OCM.

begin;

-- 1. Respaldo. Si algo sale mal después del commit, de aquí se restaura.
--    La PK de wansoft_data es (client_id, fecha, data_key) — no hay columna id.
create table if not exists public.wansoft_data_respaldo_jsonb as
select client_id, fecha, data_key, data, now() as respaldado_en
from public.wansoft_data
where jsonb_typeof(data) = 'string';

alter table public.wansoft_data_respaldo_jsonb enable row level security;

-- 2. Conversión. `data #>> '{}'` saca el texto que está adentro del escalar string;
--    el cast lo vuelve a leer como jsonb, esta vez como objeto o como arreglo.
update public.wansoft_data
set data = (data #>> '{}')::jsonb
where jsonb_typeof(data) = 'string';

commit;

-- ── Verificación (correr aparte, después del commit) ────────────────────────────
--
--   select jsonb_typeof(data) as tipo, count(*)
--   from wansoft_data group by 1;
--   -- esperado: array | 529 · object | 173   (y ninguna fila 'string')
--
--   select jsonb_array_length(data) from wansoft_data
--   where data_key = 'cash_closing' order by fecha desc limit 1;
--   -- esperado: un entero   (antes reventaba: no se puede recorrer un string)
--
--   select data->>'count' from wansoft_data
--   where data_key = 'discounts_total' order by fecha desc limit 1;
--   -- esperado: 9   (antes devolvía NULL)
--
-- ── Reversa ─────────────────────────────────────────────────────────────────────
--
--   update public.wansoft_data w
--   set data = r.data
--   from public.wansoft_data_respaldo_jsonb r
--   where w.client_id = r.client_id and w.fecha = r.fecha and w.data_key = r.data_key;
--
-- Cuando la verificación pase y no se quiera volver atrás:
--   drop table public.wansoft_data_respaldo_jsonb;
