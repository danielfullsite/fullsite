-- agent_events.evidence y agent_insights.evidence: convertir los escalares de tipo
-- string a objetos jsonb.
--
-- POR QUÉ
-- Las dos columnas son jsonb, pero `log_event()` y `create_insight()` mandaban
-- `json.dumps(evidence)` — una cadena de Python. PostgREST la guardaba como escalar
-- JSON de tipo string, no como objeto. La fila se escribía y nadie se quejaba, pero
-- la evidencia quedaba escrita y NO consultable:
--
--     select jsonb_typeof(evidence), evidence->>'codigo' from agent_events
--     where agent_id='cuadre' order by created_at desc limit 1;
--     -- "string", null
--
-- Sin `evidence->>'codigo'` no se puede agrupar por código de descuadre, ni filtrar
-- por fecha dentro de la evidencia, ni construir métricas sobre el bucle de valor —
-- que es justo para lo que existe agent_events.
--
-- Es el MISMO patrón que ya se cerró en agent_results el 2026-08-26
-- (20260826130000_agent_results_data_a_objeto.sql). Aquí seguía abierto.
--
-- El escritor ya quedó arreglado en el mismo PR que trae esta migración:
-- `.github/scripts/agent_common.py` manda el dict directo en los dos helpers, y
-- `.github/scripts/test_log_event.py` fija que el cuerpo lleve un objeto y no una
-- cadena (clase LaEvidenciaViajaComoObjetoNoComoCadena). Esta migración es sólo para
-- lo que ya se guardó mal antes de ese cambio.
--
-- ALCANCE MEDIDO EN PRODUCCIÓN (amalay, 2026-09-09, sólo lectura)
--
--   agent_events    195 filas · 74 escalares string (38%) · 121 objetos · 408 kB
--   agent_insights 3,225 filas · 2,820 escalares string (87%) · 0 objetos · 405 NULL · 1,864 kB
--
--   Las 2,894 desenvuelven a 'object' en UN solo paso — no hay doble escapado.
--   Verificado antes de escribir esta migración:
--     count(*) filter (where jsonb_typeof(evidence)='string') = 74 / 2,820
--     count(*) filter (where jsonb_typeof((evidence #>> '{}')::jsonb)='object') = 74 / 2,820
--
--   Los 121 objetos de agent_events son los que escribe dashboard-app/src/lib/agents/
--   engine.ts, que siempre mandó el objeto (TypeScript no pasa por json.dumps). Esta
--   migración no los toca. Las 74 malas son de `cuadre` (52) y `close-predictor` (13
--   al momento de la medición inicial) — los dos que escriben vía agent_common.py.
--
--   Los 405 NULL de agent_insights se quedan como están: evidence ahí es NULLABLE sin
--   default, y su NULL significa "el agente no adjuntó evidencia". No es el mismo caso.
--
-- SEGURIDAD
--   · Corre en una transacción: si una fila trae JSON inválido, revienta el cast y
--     revierte TODO. No hay estado a medias.
--   · Es idempotente: el WHERE filtra por jsonb_typeof = 'string', así que una
--     segunda corrida no hace nada.
--   · Deja respaldo en `agent_events_respaldo_jsonb` y `agent_insights_respaldo_jsonb`
--     antes de tocar nada.
--   · No toca filas 'object' ni NULL.
--
-- OJO CON LA VENTANA: mientras esta migración no corra, los agentes que ya traen el
-- fix escriben objetos y los que corran con código viejo escribirían strings. El
-- filtro por jsonb_typeof hace que se pueda re-correr sin daño si quedara alguna.

begin;

-- 1. Respaldo. Si algo sale mal después del commit, de aquí se restaura.
create table if not exists public.agent_events_respaldo_jsonb as
select id, client_id, agent_id, evidence, created_at, now() as respaldado_en
from public.agent_events
where jsonb_typeof(evidence) = 'string';

create table if not exists public.agent_insights_respaldo_jsonb as
select id, client_id, agent_id, evidence, created_at, now() as respaldado_en
from public.agent_insights
where jsonb_typeof(evidence) = 'string';

-- 2. Conversión. `evidence #>> '{}'` saca el texto que está adentro del escalar
--    string; el cast lo vuelve a leer como jsonb, esta vez como objeto.
update public.agent_events
set evidence = (evidence #>> '{}')::jsonb
where jsonb_typeof(evidence) = 'string';

update public.agent_insights
set evidence = (evidence #>> '{}')::jsonb
where jsonb_typeof(evidence) = 'string';

commit;

-- ── Verificación (correr aparte, después del commit) ────────────────────────────
--
--   select jsonb_typeof(evidence) as tipo, count(*) from agent_events group by 1;
--   -- esperado: object | 195   (y ninguna fila 'string')
--
--   select jsonb_typeof(evidence) as tipo, count(*) from agent_insights group by 1;
--   -- esperado: object | 2820 · NULL | 405   (y ninguna fila 'string')
--
--   select evidence->>'codigo' as codigo, count(*)
--   from agent_events where agent_id='cuadre' group by 1 order by 2 desc;
--   -- esperado: dia_vs_ordenes | N   (antes el codigo salía NULL en todas)
--
-- ── Reversa ─────────────────────────────────────────────────────────────────────
--
--   update public.agent_events a
--   set evidence = r.evidence
--   from public.agent_events_respaldo_jsonb r
--   where a.id = r.id;
--
--   update public.agent_insights a
--   set evidence = r.evidence
--   from public.agent_insights_respaldo_jsonb r
--   where a.id = r.id;
--
-- Cuando la verificación pase y no se quiera volver atrás:
--   drop table public.agent_events_respaldo_jsonb;
--   drop table public.agent_insights_respaldo_jsonb;
