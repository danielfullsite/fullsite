-- ROLLBACK de PENDIENTE_20260925030000_pos_aprobaciones_usadas.sql. NO aplicado.
--
-- Borrar la tabla pierde el registro de usos: un token de aprobación aún vigente (15 min)
-- podría volver a usarse para otra operación. Antes de aplicar este rollback, apagar
-- POS_APROBACION_V2_ESTRICTA (si no, sin tabla no hay aprobaciones) y esperar 15 min.

begin;
set local lock_timeout = '3s';
drop table if exists public.pos_aprobaciones_usadas;
commit;
