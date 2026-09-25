-- ROLLBACK de PENDIENTE_20260925010000_pos_staff_endurecimiento.sql. NO aplicado.
-- Aplicar con `psql -v ON_ERROR_STOP=1 -f <archivo>`. Una sola transacción.
--
-- Devuelve pos_staff y pos_staff_audit al estado que deja PR3
-- (PENDIENTE_20260924060000_pos_staff_pin_fuera_de_authenticated.sql), que es el estado previo
-- en el orden de despliegue planeado (M-01 PR3 → esta migración). Para volver al baseline de
-- producción (antes de PR3) hay que correr DESPUÉS el rollback de PR3 (bloque ROLLBACK en la
-- cabecera de ese archivo). No se ofrece un atajo directo al baseline a propósito: el baseline
-- deja leer y reescribir PINs a cualquier miembro.
--
-- Qué NO revierte, a propósito:
--   · Los privilegios de `anon` (SELECT/TRUNCATE/TRIGGER/REFERENCES/MAINTAIN en pos_staff y
--     pos_staff_audit, secuencia). Ningún lector legítimo los usa —anon leía 0 filas por RLS y
--     TRUNCATE vaciaba la tabla— y el guardián de CI (test_migraciones_no_exponen_a_anon.py)
--     prohíbe, con razón, cualquier GRANT a anon, también en un rollback. Revertir este
--     endurecimiento no puede reabrir el TRUNCATE público.
--
-- Además:
--   · La columna pos_staff_audit.origen se conserva (aditiva; las filas que el trigger escribió
--     siguen siendo evidencia y conservan su origen).
--   · Las filas de auditoría escritas mientras estuvo activo el trigger no se borran.

begin;

set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Triggers y funciones
drop trigger if exists pos_staff_audit_trg on public.pos_staff;
drop trigger if exists pos_staff_client_id_inmutable on public.pos_staff;
drop function if exists private.pos_staff_audit_trg();
drop function if exists private.pos_staff_client_id_inmutable();

-- Políticas de escritura de authenticated (texto idéntico al de producción, leído del catálogo
-- el 2026-09-24: APPENDIX-QB3-STRUCTURAL-EVIDENCE.md §2.1 C-5)
drop policy if exists pos_staff_ins on public.pos_staff;
drop policy if exists pos_staff_upd on public.pos_staff;
drop policy if exists pos_staff_del on public.pos_staff;
create policy pos_staff_ins on public.pos_staff for insert to authenticated
  with check (private.user_has_client_access(client_id));
create policy pos_staff_upd on public.pos_staff for update to authenticated
  using (private.user_has_client_access(client_id))
  with check (private.user_has_client_access(client_id));
create policy pos_staff_del on public.pos_staff for delete to authenticated
  using (private.user_has_client_access(client_id));

-- Privilegios de pos_staff = estado PR3
revoke all on table public.pos_staff from anon, authenticated;
revoke select (id, client_id, name, role, role_display, active, created_at)
  on table public.pos_staff from authenticated;
grant delete, references, trigger, truncate on table public.pos_staff to authenticated;
grant select (id, client_id, name, role, role_display, active, created_at, hourly_rate, weekly_salary)
  on table public.pos_staff to authenticated;
grant update (name, active, hourly_rate, weekly_salary)
  on table public.pos_staff to authenticated;

-- Privilegios de pos_staff_audit = baseline
revoke all on table public.pos_staff_audit from anon, authenticated;
grant all on table public.pos_staff_audit to authenticated;
grant all on sequence public.pos_staff_audit_id_seq to authenticated;

-- MAINTAIN existe desde PostgreSQL 17 (producción lo tiene en la ACL). En 16 no existe.
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'grant maintain on table public.pos_staff to authenticated';
  end if;
end
$$;

commit;
