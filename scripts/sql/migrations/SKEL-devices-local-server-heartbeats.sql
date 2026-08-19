-- ══════════════════════════════════════════════════════════════════════
-- ESQUELETON · Vista de hardware (Feature 2, Fase 0) — local_server_heartbeats
-- ══════════════════════════════════════════════════════════════════════
--
-- El código del heartbeat de Pedro (electron-app/local-server/telemetry/heartbeat.js)
-- YA existe y hace POST cada 5 min con upsert por server_id — pero la tabla nunca se
-- creó, así que Pedro no reporta nada a la nube. Con solo crearla, cada Local Server
-- empieza a reportar online/versión/salud/cola-de-sync por cliente → tablero
-- "¿está viva la caja de cada restaurante?" (base de /platform/devices).
--
-- RLS (consistente con BLINDAJE B2): service_role full (plataforma lee todo);
-- authenticated scopeado por restaurant_id (el service-account local_server hace
-- upsert de SU propio heartbeat; el dashboard del tenant puede leer el suyo).
-- Idempotente.
--
-- Nota: para que el write aterrice, Pedro debe autenticar como su cuenta local_server
-- (JWT authenticated, miembro del client), no con anon key.
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.local_server_heartbeats (
  server_id         TEXT PRIMARY KEY,
  restaurant_id     TEXT NOT NULL,
  reported_at       TIMESTAMPTZ NOT NULL,
  version           TEXT,
  protocol_version  TEXT,
  platform          TEXT,
  uptime_seconds    INTEGER,
  clients_connected INTEGER,
  sync_queue_size   INTEGER,
  last_sync_at      TIMESTAMPTZ,
  print_jobs_failed INTEGER,
  health_status     TEXT,
  disk_free_mb      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_lsh_restaurant ON public.local_server_heartbeats(restaurant_id);

ALTER TABLE public.local_server_heartbeats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hb_svc ON public.local_server_heartbeats;
CREATE POLICY hb_svc ON public.local_server_heartbeats FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS hb_auth_sel ON public.local_server_heartbeats;
CREATE POLICY hb_auth_sel ON public.local_server_heartbeats FOR SELECT TO authenticated USING (private.user_has_client_access(restaurant_id));

DROP POLICY IF EXISTS hb_auth_ins ON public.local_server_heartbeats;
CREATE POLICY hb_auth_ins ON public.local_server_heartbeats FOR INSERT TO authenticated WITH CHECK (private.user_has_client_access(restaurant_id));

DROP POLICY IF EXISTS hb_auth_upd ON public.local_server_heartbeats;
CREATE POLICY hb_auth_upd ON public.local_server_heartbeats FOR UPDATE TO authenticated
  USING (private.user_has_client_access(restaurant_id)) WITH CHECK (private.user_has_client_access(restaurant_id));
