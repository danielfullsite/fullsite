-- ROLLBACK de PENDIENTE_20260923220000_actas_caducidad_y_agent_runs_tenant.sql
-- (P-00 de la contención PR5, 2026-09-24). NO APLICADO.
--
-- Parte 1: restaura private.user_has_client_access EXACTAMENTE como está en
--          supabase/migrations/00000000000000_baseline_esquema.sql:117-131 (texto
--          idéntico). CREATE OR REPLACE conserva dueño y GRANT de la función, igual
--          que al aplicar la migración.
-- Parte 2: quita el índice y la columna agent_runs.client_id. Se pierden los
--          client_id que se hayan escrito después de aplicar la migración.
--
-- Todo en UNA transacción, con DDL estricto (sin IF EXISTS): si la columna o el
-- índice no están, o si algo depende de la columna (p. ej. la política del paso d)
-- aplicada en otra migración), el rollback FALLA completo y no deja nada a medias.
-- En ese caso, revertir primero esa migración. Aplicar con
-- `psql -v ON_ERROR_STOP=1 -f <archivo>`.
--
-- Antes de usarlo en un entorno real, comparar md5(pg_get_functiondef) de la foto
-- previa (MIGRATION-STAGING-PLAN.md §2) con la del baseline: si la base real tenía
-- otra definición, restaurar ESA, no esta.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION "private"."user_has_client_access"("target_client_id" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL                 THEN false
    WHEN target_client_id IS NULL           THEN false
    WHEN target_client_id = ''              THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.user_id = auth.uid() AND cu.client_id = target_client_id
    )
  END;
$$;

DROP INDEX "public"."idx_agent_runs_client_created";
ALTER TABLE "public"."agent_runs" DROP COLUMN "client_id";

COMMIT;
