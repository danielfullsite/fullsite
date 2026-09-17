-- P0A · APPEND IDEMPOTENCY FOUNDATION. Candidata: NO aplicada.
--
-- EL PROBLEMA
--
-- Los appends de la cola offline no tienen identidad durable. Si la petición
-- llega y la respuesta se pierde, el replay inserta una fila NUEVA: el servidor
-- no tiene con qué reconocer «esto ya lo vi». Medido contra el schema el
-- 2026-09-17:
--
--   pos_cash_movements       id bigint / nextval  · sin unique de negocio
--   pos_audit_log            id bigint / nextval  · sin unique de negocio
--   pos_market_movements     id bigint / nextval  · sin unique de negocio
--   pos_inventory_movements  id bigint / nextval  · PERO ya tiene
--       UNIQUE (client_id, movement_operation_key, movement_operation_line)
--       WHERE movement_operation_key IS NOT NULL
--     y ningún código de cliente llena esas columnas (cero referencias en src/).
--     Por eso esta migración NO le agrega nada: la identidad ya existe en la
--     base y lo que falta es usarla.
--
-- QUÉ HACE ESTA MIGRACIÓN
--
-- Agrega `client_op_id text NULL` a las tres tablas que no tienen identidad, y
-- un índice único PARCIAL por tenant. Parcial a propósito: las filas históricas
-- (1,674 de auditoría, 238 de market, 0 de caja al 2026-09-17) quedan fuera del
-- índice y no hay que tocar ni una.
--
-- NO hace backfill. NO altera filas existentes. NO cambia tipos ni defaults.
-- NO toca pos_inventory_movements.
--
-- IDENTIDAD: QUÉ VA EN client_op_id
--
--   pos_cash_movements   UUID aleatorio generado UNA vez, al confirmar el
--                        movimiento. Dos retiros de $500 en el mismo minuto son
--                        dos eventos legítimos: un determinista los colapsaría y
--                        borraría dinero declarado.
--   pos_audit_log        UUID aleatorio por evento. La bitácora registra
--                        observaciones, no estado; dos actores que observan lo
--                        mismo son dos hechos. La operación auditada viaja en
--                        `details` como METADATO, nunca como identidad.
--   pos_market_movements columna preparada, productor pendiente: hoy
--                        `logMarketMovement` no tiene ningún llamador y la venta
--                        de Market se descuenta server-side por
--                        r1_legacy_sale_deduction. Ver el reporte de P0A.
--
-- ORDEN DE DESPLIEGUE: primero esta migración, después el código. Al revés,
-- PostgREST responde PGRST204 «column not found» y las escrituras se caen.

ALTER TABLE public.pos_cash_movements   ADD COLUMN IF NOT EXISTS client_op_id text;
ALTER TABLE public.pos_audit_log        ADD COLUMN IF NOT EXISTS client_op_id text;
ALTER TABLE public.pos_market_movements ADD COLUMN IF NOT EXISTS client_op_id text;

CREATE UNIQUE INDEX IF NOT EXISTS pos_cash_movements_client_op_id
  ON public.pos_cash_movements (client_id, client_op_id)
  WHERE client_op_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pos_audit_log_client_op_id
  ON public.pos_audit_log (client_id, client_op_id)
  WHERE client_op_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pos_market_movements_client_op_id
  ON public.pos_market_movements (client_id, client_op_id)
  WHERE client_op_id IS NOT NULL;

COMMENT ON COLUMN public.pos_cash_movements.client_op_id IS
  'Identidad de la operación generada por el cliente al confirmar el movimiento. '
  'Misma en la escritura online y en el replay de la cola. Aleatoria: dos retiros '
  'iguales son dos eventos.';
COMMENT ON COLUMN public.pos_audit_log.client_op_id IS
  'Identidad del EVENTO de auditoría. Aleatoria por observación. La operación '
  'auditada va en details como metadato, no como identidad.';
COMMENT ON COLUMN public.pos_market_movements.client_op_id IS
  'Identidad de la operación. Columna preparada: al 2026-09-17 logMarketMovement '
  'no tiene llamadores y la venta se descuenta server-side.';
