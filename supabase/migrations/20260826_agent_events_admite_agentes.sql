-- agent_events rechazaba en silencio todo lo que mandaban los agentes de Python.
--
-- HALLAZGO (2026-08-26). La tabla tiene 12 filas; agent_insights tiene 2,387. La
-- diferencia no es que los agentes no encuentren nada: es que sus INSERT se rechazan.
--
--   CHECK (agent_id IN ('operations','inventory','fraud','staff','finance'))
--
-- Esos cinco son los agentes del motor de TypeScript. Los de Python usan otros siete
-- —antifraud-agent, close-predictor, menu-engineering, pos-intraday-snapshot,
-- proactive-alerts, staffing-optimizer, tips-analyzer— y ninguno pasa el CHECK.
--
-- Peor: `log_event()` atrapa la excepción y sólo escribe a stderr. Así que
-- `antifraud-agent` y `fraud_watcher` llevan meses reportando hallazgos AL VACÍO, sin
-- que nada lo dijera. Confirmado: cero filas suyas en la tabla.
--
-- POR QUÉ VALIDAR LA FORMA Y NO LA LISTA
-- Enumerar los doce sería condenarse a una migración de base de datos cada vez que
-- alguien escribe un agente nuevo. Eso es exactamente el tipo de fricción que hace que
-- un sistema no sea clonable: el agente nuevo falla en silencio hasta que alguien se
-- acuerda del CHECK. Se valida que sea un slug razonable y ya.
--
-- Lo que NO se toca: `status` sigue aceptando sólo new/acknowledged/resolved, y
-- `outcome` sólo correct/false_positive. Ahí el vocabulario cerrado SÍ vale, porque la
-- UI filtra por esos valores. `log_event()` escribía 'open', que no existe — eso se
-- corrige en el script, no ensanchando la base.

ALTER TABLE public.agent_events DROP CONSTRAINT IF EXISTS agent_events_agent_id_check;

ALTER TABLE public.agent_events
  ADD CONSTRAINT agent_events_agent_id_check
  CHECK (agent_id ~ '^[a-z][a-z0-9_-]{1,48}$');

-- ─────────────────────────────────────────────────────────────────────────────
-- REVERSA
-- ─────────────────────────────────────────────────────────────────────────────
-- ALTER TABLE public.agent_events DROP CONSTRAINT IF EXISTS agent_events_agent_id_check;
-- ALTER TABLE public.agent_events
--   ADD CONSTRAINT agent_events_agent_id_check
--   CHECK (agent_id = ANY (ARRAY['operations','inventory','fraud','staff','finance']));
--
-- Ojo: la reversa falla si para entonces ya hay filas de otros agentes. Habría que
-- borrarlas primero, y eso es pérdida de datos — por eso conviene revertir pronto o no
-- revertir.

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN — los doce agentes en uso deben pasar; la basura debe fallar
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT a AS agente, a ~ '^[a-z][a-z0-9_-]{1,48}$' AS pasa
-- FROM unnest(ARRAY['operations','close-predictor','antifraud-agent','tips-analyzer',
--                   'pos-intraday-snapshot','', 'Mayúsculas', '-empieza-con-guion',
--                   'con espacio']) a;
