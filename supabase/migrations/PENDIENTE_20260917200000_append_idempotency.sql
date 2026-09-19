-- P0A · APPEND IDEMPOTENCY FOUNDATION. Candidata: NO aplicada.
--
-- EL PROBLEMA
--
-- Los appends de la cola offline no tienen identidad durable. Si la petición
-- llega y la respuesta se pierde, el replay inserta una fila NUEVA: el servidor
-- no tiene con qué reconocer «esto ya lo vi». Medido contra el schema el
-- 2026-09-17:
--
--   pos_cash_movements       id bigint / nextval  · sin unique de negocio · 0 filas
--   pos_audit_log            id bigint / nextval  · sin unique de negocio · 1,674 filas
--   pos_market_movements     id bigint / nextval  · sin unique de negocio · 238 filas
--   pos_inventory_movements  ya tiene
--       UNIQUE (client_id, movement_operation_key, movement_operation_line)
--       WHERE movement_operation_key IS NOT NULL
--     y ningún código de cliente llenaba esas columnas (cero referencias en
--     src/ al 2026-09-17). Por eso esta migración NO LE TOCA NADA: la identidad
--     ya existe en la base y lo que faltaba era usarla, que es cambio de código.
--
-- QUÉ HACE
--
--   3 columnas nuevas, text, NULL, SIN DEFAULT
--   3 índices únicos PARCIALES por tenant
--
-- Parciales a propósito: las 1,912 filas históricas quedan fuera del índice y no
-- hay que tocar ni una. Sin backfill, sin UPDATE, sin INSERT, sin DELETE.
-- Sin RLS, sin grants, sin triggers, sin funciones.
--
-- POR QUÉ DDL ESTRICTO (sin IF NOT EXISTS)
--
-- `IF NOT EXISTS` convierte un desajuste en silencio: si la columna ya existiera
-- —por una corrida previa a medias, o por alguien que la creó a mano con otro
-- tipo— la migración pasaría en verde sobre un estado que nadie verificó. Se
-- prefiere que falle y que el drift se vea.
--
-- POR QUÉ LOS TIMEOUTS
--
-- `ADD COLUMN` nullable sin default es sólo catálogo desde PG11: no reescribe la
-- tabla. `CREATE UNIQUE INDEX` (no CONCURRENTLY, que además no puede ir dentro
-- de una transacción) toma SHARE y bloquea escrituras mientras construye — con
-- 0, 1,674 y 238 filas eso son milisegundos. Los timeouts existen para el caso
-- que no controlo: si algo tuviera la tabla tomada, esto ABORTA a los 3 s en vez
-- de encolarse detrás y frenar una caja en servicio.
--
-- ORDEN DE DESPLIEGUE: primero esta migración, después el código. Al revés,
-- PostgREST responde PGRST204 «column not found» y las escrituras se caen.
--
-- Rollback simétrico: PENDIENTE_20260917200000_append_idempotency_ROLLBACK.sql

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.pos_cash_movements   ADD COLUMN client_op_id text;
ALTER TABLE public.pos_audit_log        ADD COLUMN client_op_id text;
ALTER TABLE public.pos_market_movements ADD COLUMN client_op_id text;

CREATE UNIQUE INDEX pos_cash_movements_client_op_id
  ON public.pos_cash_movements (client_id, client_op_id)
  WHERE client_op_id IS NOT NULL;

CREATE UNIQUE INDEX pos_audit_log_client_op_id
  ON public.pos_audit_log (client_id, client_op_id)
  WHERE client_op_id IS NOT NULL;

CREATE UNIQUE INDEX pos_market_movements_client_op_id
  ON public.pos_market_movements (client_id, client_op_id)
  WHERE client_op_id IS NOT NULL;

COMMIT;
