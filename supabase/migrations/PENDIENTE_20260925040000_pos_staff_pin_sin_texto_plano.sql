-- PENDIENTE: NO aplicada. F5 de docs/security/PLAN-PIN-HASH.md. Requiere autorización de Daniel.
-- Aplicar con `psql -v ON_ERROR_STOP=1 -f <archivo>`, DESPUÉS de:
--   F1 (PENDIENTE_20260914120000, columnas pin_hash/pin_hash_v),
--   F3 (backfill completo y verificado),
--   F4 en producción y certificado (POS_PIN_AUTHORITY=hash, T-24 validado en campo).
-- Rollback: PENDIENTE_20260925040000_pos_staff_pin_sin_texto_plano_ROLLBACK.sql
--
-- Qué habilita: que los escritores dejen de guardar el PIN en claro (POS_PIN_WRITE_PLAIN=off,
-- pos-staff-pin-write.ts). Hasta aquí `pin` es NOT NULL, así que dejar de escribirlo rompía el
-- alta. No borra ningún PIN existente: eso es F6, destructivo e irreversible, con su propia
-- autorización.
--
-- Qué garantiza: toda fila conserva ALGUNA credencial — `pin` o `pin_hash`. El CHECK de formato
-- `pos_staff_pin_len_chk` se conserva: con `pin` NULL da NULL y el CHECK pasa, y con valor
-- sigue exigiendo 4–10 dígitos.

begin;

set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'pos_staff' and column_name = 'pin_hash') then
    raise exception 'F5 requiere F1: pos_staff.pin_hash no existe';
  end if;
end $$;

alter table public.pos_staff alter column pin drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pos_staff_alguna_credencial_chk') then
    alter table public.pos_staff
      add constraint pos_staff_alguna_credencial_chk check (pin is not null or pin_hash is not null);
  end if;
end $$;

commit;
