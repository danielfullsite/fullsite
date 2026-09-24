-- PENDIENTE: NO aplicada. Requiere autorización de Daniel; staging primero.
-- Aplicar con `psql -v ON_ERROR_STOP=1 -f <archivo>`.
-- Rollback: PENDIENTE_20260925020000_revocar_truncate_anon_authenticated_ROLLBACK.sql
--
-- ── EL HALLAZGO ─────────────────────────────────────────────────────────────────────────
-- El baseline otorga TRUNCATE a `anon` y `authenticated` sobre prácticamente todas las tablas
-- de `public` (169 `GRANT ALL ... TO anon|authenticated`, más los GRANT explícitos de
-- REFERENCES,TRIGGER,TRUNCATE,MAINTAIN), y los privilegios por defecto
-- (`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon,
-- authenticated`, baseline:10407-10408) se lo dan a toda tabla NUEVA.
-- En producción está confirmado para pos_staff (APPENDIX-QB3 §2.1 C-3).
--
-- TRUNCATE NO pasa por RLS. Hoy no es alcanzable desde la API HTTP (PostgREST no tiene verbo
-- para TRUNCATE), pero basta una función SECURITY INVOKER expuesta que lo ejecute, o un
-- camino SQL con esos roles, para vaciar una tabla de cualquier restaurante.
--
-- ── POR QUÉ NO ROMPE NINGUNA RUTA LEGÍTIMA ──────────────────────────────────────────────
--   1. PostgREST no emite TRUNCATE: ningún cliente HTTP lo usa.
--   2. Ninguna función de las migraciones del repo ejecuta TRUNCATE (`grep -niE '\btruncate\b'`
--      sobre supabase/migrations/*.sql: sólo aparecen líneas GRANT).
--   3. El código de la app, scripts y Electron no ejecutan TRUNCATE con esos roles
--      (inventario en POS-STAFF-HARDENING-TEST-MATRIX.md §TRUNCATE).
--   4. `service_role` y `postgres` conservan TRUNCATE (teardown/seeds usan DELETE o postgres).
--   Pendiente antes de aplicar (lectura de catálogo autorizada): confirmar en producción que
--   ninguna función ejecutable por anon/authenticated contiene TRUNCATE, porque producción
--   tiene objetos fuera del historial de migraciones (EXTERNAL-READS-RESULTS §5).
--
-- ── ALCANCE ─────────────────────────────────────────────────────────────────────────────
-- Sólo TRUNCATE. TRIGGER, REFERENCES y MAINTAIN de anon/authenticated también sobran, pero
-- se tratan aparte para que este cambio sea mínimo y revertible por sí solo.

begin;

set local lock_timeout = '3s';
set local statement_timeout = '60s';

revoke truncate on all tables in schema public from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke truncate on tables from anon, authenticated;

commit;
