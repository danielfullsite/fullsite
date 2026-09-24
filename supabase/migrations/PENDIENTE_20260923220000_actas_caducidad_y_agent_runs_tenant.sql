-- PENDIENTE: requiere que Daniel la aplique por el camino normal de migraciones.
-- NO se aplicó en ningún entorno. El código de la contención PR5 funciona SIN ella
-- (degrada de forma segura); esta migración cierra la mitad que vive en la base.
--
-- Contención PR5 · TENANT_AND_ROLE_ENFORCEMENT (auditoría 2026-09-23, F-05 y F-06).
--
-- ── PARTE 1 · F-05: la caducidad de act-as también en RLS ─────────────────────
--
-- /api/platform/act-as inserta en client_users una fila role='platform_actas'.
-- En el SERVIDOR (dashboard-app/src/lib/api-auth.ts) esa fila ya caduca a los
-- ACTAS_TTL_MINUTES (default 60) contados desde client_users.created_at. Pero las
-- lecturas del NAVEGADOR van directo a PostgREST con el JWT del admin y las decide
-- RLS vía private.user_has_client_access(), que hoy no mira ni el rol ni la edad:
-- sin esta parte el admin sigue viendo el tenant hasta el exit o la revocación.
--
-- Mantener el intervalo igual a ACTAS_TTL_MINUTES (si se cambia la variable en
-- Vercel, cambiar también el '60 minutes' de abajo; el servidor la topa en 240).
-- Igual que en el servidor, una fila con created_at en el futuro (más de 1 min)
-- no cuenta.
--
-- Cuerpo copiado de 00000000000000_baseline_esquema.sql:117-131; lo único nuevo
-- es la condición sobre cu.role / cu.created_at. CREATE OR REPLACE FUNCTION
-- conserva los GRANT existentes de la función.

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
        AND (cu.role IS DISTINCT FROM 'platform_actas'
             OR (cu.created_at > now() - interval '60 minutes'
                 AND cu.created_at <= now() + interval '1 minute'))
    )
  END;
$$;

-- ── PARTE 2 · F-06: agent_runs con tenant ─────────────────────────────────────
--
-- agent_runs no tiene columna de tenant y su política es
--   agent_runs_read ... FOR SELECT TO authenticated USING (true)
-- (baseline:6849), o sea que cualquier usuario autenticado de cualquier
-- restaurante lee la telemetría de todos. /mission-control y /roi ya NO la leen
-- desde el navegador (van por /mission-control/telemetria, admin de plataforma con
-- service_role), y /api/chat ya no escribe pregunta/respuesta ahí. Pero otros
-- lectores de restaurante siguen leyéndola directo (home, dashboard-clasico,
-- NotificationBell vía src/lib/data.ts:463).
--
-- ORDEN DE DESPLIEGUE (dependencia explícita, NO aplicar la política antes):
--   a) columna + índice (aditivo, sin efecto);
--   b) que los escritores pongan client_id (.github/scripts/*, lib/agents/engine.ts,
--      /api/chat, proxy anti-scraping) — fuera de este PR;
--   c) relleno de filas viejas donde se pueda deducir el tenant (p. ej. engine.ts
--      escribe "<clientId>: N hallazgo(s)" en output_summary); el resto queda NULL
--      = sólo visible para service_role / admin de plataforma;
--   d) recién entonces, la política por tenant.
-- En este archivo sólo quedan ACTIVOS a) (aditivo) y la Parte 1. d) y la
-- limpieza de datos están comentados: nada destructivo corre al aplicarlo.

ALTER TABLE "public"."agent_runs" ADD COLUMN IF NOT EXISTS "client_id" "text";
CREATE INDEX IF NOT EXISTS "idx_agent_runs_client_created"
  ON "public"."agent_runs" USING "btree" ("client_id", "created_at" DESC);

-- Paso d) — COMENTADO A PROPÓSITO (revisión PR5, H2): reemplaza la política
-- vigente y no debe entrar al aplicar este archivo; sólo cuando b) y c) estén
-- hechos, como migración aparte y con su propio rollback (abajo).
-- DROP POLICY IF EXISTS "agent_runs_read" ON "public"."agent_runs";
-- CREATE POLICY "agent_runs_tenant_read" ON "public"."agent_runs"
--   FOR SELECT TO "authenticated"
--   USING ("client_id" IS NOT NULL AND "private"."user_has_client_access"("client_id"));

-- Limpieza de contenido ya escrito (contenido de chat en telemetría global).
-- Se deja COMENTADO a propósito: es borrado de datos y necesita autorización y
-- respaldo propios. Verificar antes con:
--   SELECT count(*) FROM public.agent_runs WHERE agent_id = 'chat-feedback' AND output_summary LIKE 'Q: %';
-- UPDATE public.agent_runs SET output_summary = 'respuesta sin datos (contenido en chat_logs)'
--  WHERE agent_id = 'chat-feedback' AND output_summary LIKE 'Q: %';

-- ── ROLLBACK ──────────────────────────────────────────────────────────────────
-- Parte 1: re-ejecutar la definición de baseline_esquema.sql:117-131.
-- Parte 2:
--   DROP POLICY IF EXISTS "agent_runs_tenant_read" ON "public"."agent_runs";
--   CREATE POLICY "agent_runs_read" ON "public"."agent_runs" FOR SELECT TO "authenticated" USING (true);
--   DROP INDEX IF EXISTS "public"."idx_agent_runs_client_created";
--   ALTER TABLE "public"."agent_runs" DROP COLUMN IF EXISTS "client_id";
