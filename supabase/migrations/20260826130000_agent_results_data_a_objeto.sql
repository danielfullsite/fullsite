-- agent_results.data: convertir los escalares de tipo string a objetos jsonb.
--
-- POR QUÉ
-- La columna es jsonb, pero los agentes mandaban `json.dumps({...})` — un STRING de
-- Python. PostgREST lo guardaba como escalar JSON de tipo string, no como objeto. El
-- dashboard nunca se dio cuenta porque todos sus lectores desenvuelven el string; lo
-- que quedó roto es la consulta desde SQL:
--
--     select jsonb_typeof(data), data->>'sin_stock' from agent_results
--     where agent_id='stock-alert' order by fecha desc limit 1;
--     -- "string", null
--
-- El escritor ya quedó arreglado (los 19 agentes mandan el dict directo). Esta
-- migración es para lo que ya se guardó mal antes de ese cambio.
--
-- ALCANCE MEDIDO EN PRODUCCIÓN (amalay, 2026-08-26, sólo lectura)
--   1,048 filas totales · 1,034 escalares string (98.7%) · 14 objetos · 810 kB
--   Las 1,034 desenvuelven a 'object' en UN solo paso — no hay doble escapado.
--   Las 14 que ya son objeto son la siembra del tenant demo `boruca` (2026-08-21),
--   insertadas por fuera del camino de Python. Esta migración no las toca.
--
-- SEGURIDAD
--   · Corre en una transacción: si una fila trae JSON inválido, revienta el cast y
--     revierte TODO. No hay estado a medias.
--   · Es idempotente: el WHERE filtra por jsonb_typeof = 'string', así que una
--     segunda corrida no hace nada.
--   · Deja respaldo en `agent_results_respaldo_jsonb` antes de tocar nada.
--
-- ESTO NO ES OBLIGATORIO PARA QUE EL DASHBOARD FUNCIONE. Todos los lectores (TS y
-- Python) toleran ambos formatos. Lo que desbloquea es poder consultar el histórico
-- desde SQL y desde las vistas OCM.

begin;

-- 1. Respaldo. Si algo sale mal después del commit, de aquí se restaura.
create table if not exists public.agent_results_respaldo_jsonb as
select id, client_id, agent_id, fecha, data, now() as respaldado_en
from public.agent_results
where jsonb_typeof(data) = 'string';

-- 2. Conversión. `data #>> '{}'` saca el texto que está adentro del escalar string;
--    el cast lo vuelve a leer como jsonb, esta vez como objeto.
update public.agent_results
set data = (data #>> '{}')::jsonb
where jsonb_typeof(data) = 'string';

commit;

-- ── Verificación (correr aparte, después del commit) ────────────────────────────
--
--   select jsonb_typeof(data) as tipo, count(*)
--   from agent_results group by 1;
--   -- esperado: object | 1048   (y ninguna fila 'string')
--
--   select data->>'sin_stock' from agent_results
--   where agent_id='stock-alert' order by fecha desc limit 1;
--   -- esperado: 225   (antes devolvía NULL)
--
-- ── Reversa ─────────────────────────────────────────────────────────────────────
--
--   update public.agent_results a
--   set data = r.data
--   from public.agent_results_respaldo_jsonb r
--   where a.id = r.id;
--
-- Cuando la verificación pase y no se quiera volver atrás:
--   drop table public.agent_results_respaldo_jsonb;
