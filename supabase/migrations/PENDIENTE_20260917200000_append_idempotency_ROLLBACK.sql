-- ROLLBACK simétrico de PENDIENTE_20260917200000_append_idempotency.sql
--
-- Deshace exactamente lo que aquélla creó, en ORDEN INVERSO: primero los tres
-- índices, después las tres columnas. Nada más.
--
-- Es limpio mientras el código que manda `client_op_id` NO esté desplegado —por
-- eso el orden de despliegue es DDL primero, código después, y el de reversa es
-- código primero, DDL después.
--
-- Al soltar la columna se pierden los `client_op_id` ya escritos. Eso NO borra
-- movimientos: la fila de negocio sigue intacta; lo que se pierde es la llave de
-- idempotencia, y con ella la capacidad de reconocer un reintento. Si ya hubo
-- escrituras con identidad, esto se decide mirando, no por reflejo.
--
-- DDL estricto: sin IF EXISTS. Si algo no está donde se espera, que falle.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DROP INDEX public.pos_market_movements_client_op_id;
DROP INDEX public.pos_audit_log_client_op_id;
DROP INDEX public.pos_cash_movements_client_op_id;

ALTER TABLE public.pos_market_movements DROP COLUMN client_op_id;
ALTER TABLE public.pos_audit_log        DROP COLUMN client_op_id;
ALTER TABLE public.pos_cash_movements   DROP COLUMN client_op_id;

COMMIT;
