-- ROLLBACK de PENDIENTE_20260925040000_pos_staff_pin_sin_texto_plano.sql. NO aplicado.
--
-- Sólo funciona mientras NINGUNA fila tenga `pin` NULL: `set not null` falla (y la transacción
-- entera se revierte) si alguien ya fue dado de alta o cambió de PIN con POS_PIN_WRITE_PLAIN=off.
-- En ese caso, antes: POS_PIN_WRITE_PLAIN=on y re-asignar PIN (reset_pin) a esas personas.
-- Falla cerrado: nunca inventa un PIN para rellenar.

begin;
set local lock_timeout = '3s';
alter table public.pos_staff drop constraint if exists pos_staff_alguna_credencial_chk;
alter table public.pos_staff alter column pin set not null;
commit;
