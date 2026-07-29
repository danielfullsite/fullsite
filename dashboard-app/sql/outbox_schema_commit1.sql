-- OFFLINE-IMPL-001 Commit 1: Outbox Schema
-- Aplicar PRIMERO en staging. No tocar producción hasta evidenciar las 7 verificaciones.
--
-- Verificaciones requeridas (ver OFFLINE-IMPL-001-OUTBOX-v2.2.md §Criterio de salida):
--   [ ] Idempotencia
--   [ ] Aislamiento por tenant
--   [ ] UNIQUE (restaurant_id, sequence)
--   [ ] CHECK type <> STATE_SYNC
--   [ ] Transición única activa
--   [ ] RLS pos_authority_transitions
--   [ ] pos_write_authority CHECK + DEFAULT
--
-- Este script es idempotente: puede ejecutarse varias veces sin error.
-- No introduce lógica de aplicación: solo schema, constraints, índices y RLS.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. pos_local_events
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pos_local_events (
  id             UUID    NOT NULL,
  sequence       INTEGER NOT NULL,
  type           TEXT    NOT NULL,
  ts             BIGINT  NOT NULL,
  terminal_id    UUID,                  -- dispositivo de origen; NULL si server-originated
  restaurant_id  TEXT    NOT NULL,      -- identidad del tenant; clients.id es TEXT
  payload        JSONB   NOT NULL,

  CONSTRAINT pos_local_events_pkey
    PRIMARY KEY (id),

  -- Dos eventos distintos (id diferente) no pueden compartir sequence en el mismo restaurante.
  -- Si se viola: indica corrupción del EventStore, no un retry normal.
  CONSTRAINT pos_local_events_unique_restaurant_seq
    UNIQUE (restaurant_id, sequence),

  -- El Outbox filtra STATE_SYNC antes de enviar; este constraint es defensa en profundidad.
  CONSTRAINT pos_local_events_type_not_state_sync
    CHECK (type <> 'STATE_SYNC')
);

-- Lectura paginada por el Outbox: FIFO garantizado por (restaurant_id, sequence).
CREATE INDEX IF NOT EXISTS pos_local_events_restaurant_seq_idx
  ON pos_local_events (restaurant_id, sequence);

-- Queries de audit por ventana de tiempo.
CREATE INDEX IF NOT EXISTS pos_local_events_restaurant_ts_idx
  ON pos_local_events (restaurant_id, ts);

ALTER TABLE pos_local_events ENABLE ROW LEVEL SECURITY;

-- RLS: solo lectura, solo admins/owners del propio restaurante.
-- service_role bypasea RLS por defecto en Supabase — no requiere policy propia.
DROP POLICY IF EXISTS pos_local_events_tenant_admin_read ON pos_local_events;
CREATE POLICY pos_local_events_tenant_admin_read
  ON pos_local_events
  FOR SELECT
  TO authenticated
  USING (
    restaurant_id IN (
      SELECT client_id
      FROM client_users
      WHERE user_id = auth.uid()
        AND role IN ('admin', 'owner')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. pos_authority_transitions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pos_authority_transitions (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id              TEXT        NOT NULL REFERENCES clients(id),

  -- Dirección del cambio de autoridad.
  direction                  TEXT        NOT NULL,

  -- Estado de origen (antes del cambio).
  from_authority             TEXT        NOT NULL,

  -- Estado objetivo (después del cambio).
  to_authority               TEXT        NOT NULL,

  -- Estado actual de la transición.
  status                     TEXT        NOT NULL DEFAULT 'pending',

  -- Timestamps de ciclo de vida.
  started_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at                 TIMESTAMPTZ NOT NULL,       -- started_at + 10 minutos (seteado por la aplicación)
  completed_at               TIMESTAMPTZ,
  cancelled_at               TIMESTAMPTZ,

  -- Coordinación de activación.
  outbox_ready_at            TIMESTAMPTZ,                -- Local Server confirmó shadow mode
  baseline_sequence          INTEGER,                    -- last_synced_sequence antes de iniciar
  shadow_sequence            INTEGER,                    -- highest sequence en shadow mode

  -- Coordinación de rollback.
  last_reconciled_sequence   INTEGER,                    -- sequence más alto confirmado en pos_orders
  reconciliation_status      TEXT,

  -- Trazabilidad.
  initiated_by               UUID,
  approved_by                UUID,
  failure_reason             TEXT,

  CONSTRAINT pat_direction_valid
    CHECK (direction IN ('activation', 'rollback')),

  CONSTRAINT pat_from_authority_valid
    CHECK (from_authority IN ('supabase', 'local_server')),

  CONSTRAINT pat_to_authority_valid
    CHECK (to_authority IN ('supabase', 'local_server')),

  CONSTRAINT pat_authorities_differ
    CHECK (from_authority <> to_authority),

  CONSTRAINT pat_status_valid
    CHECK (status IN (
      'pending',
      'shadow',       -- Local Server en shadow mode (solo activación)
      'completing',   -- Coordinator aprobó; propagando el cambio
      'completed',    -- Todos los componentes confirmaron
      'cancelled',    -- Cancelado manualmente
      'timed_out'     -- Expiró antes de completar
    )),

  CONSTRAINT pat_reconciliation_status_valid
    CHECK (
      reconciliation_status IS NULL OR
      reconciliation_status IN ('pending', 'verified', 'applied', 'blocked')
    )
);

-- Garantiza que no coexistan dos transiciones activas del mismo restaurante.
-- Permite múltiples filas históricas (completed/cancelled/timed_out) del mismo restaurante.
CREATE UNIQUE INDEX IF NOT EXISTS pos_authority_transitions_one_active_per_restaurant
  ON pos_authority_transitions (restaurant_id)
  WHERE status NOT IN ('completed', 'cancelled', 'timed_out');

-- Historial cronológico por restaurante.
CREATE INDEX IF NOT EXISTS pos_authority_transitions_history_idx
  ON pos_authority_transitions (restaurant_id, started_at DESC);

ALTER TABLE pos_authority_transitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pat_tenant_admin_read ON pos_authority_transitions;
CREATE POLICY pat_tenant_admin_read
  ON pos_authority_transitions
  FOR SELECT
  TO authenticated
  USING (
    restaurant_id IN (
      SELECT client_id
      FROM client_users
      WHERE user_id = auth.uid()
        AND role IN ('admin', 'owner')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. clients: columna pos_write_authority
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS pos_write_authority TEXT NOT NULL DEFAULT 'supabase';

-- Idempotente: drop + recreate del constraint.
ALTER TABLE clients
  DROP CONSTRAINT IF EXISTS clients_pos_write_authority_valid;

ALTER TABLE clients
  ADD CONSTRAINT clients_pos_write_authority_valid
  CHECK (pos_write_authority IN ('supabase', 'transitioning', 'local_server'));

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificación inline (ejecutar como queries separadas después de aplicar)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 1. Idempotencia:
--    INSERT INTO pos_local_events (id, sequence, type, ts, restaurant_id, payload)
--    VALUES ('00000000-0000-0000-0000-000000000001', 1, 'ORDER_SENT', 0, '<restaurant_id>', '{}');
--    -- Segunda vez con el mismo id → debe completar sin error (DO NOTHING)
--
-- 2. Aislamiento por tenant:
--    Conectar como usuario authenticated con rol admin de restaurante A.
--    SELECT * FROM pos_local_events WHERE restaurant_id = '<restaurante_B_id>';
--    -- Debe devolver 0 filas.
--
-- 3. UNIQUE (restaurant_id, sequence):
--    INSERT INTO pos_local_events (id, sequence, type, ts, restaurant_id, payload)
--    VALUES ('00000000-0000-0000-0000-000000000002', 1, 'ORDER_SENT', 0, '<restaurant_id>', '{}');
--    -- Mismo sequence, id diferente → debe fallar con constraint pos_local_events_unique_restaurant_seq
--
-- 4. CHECK STATE_SYNC:
--    INSERT INTO pos_local_events (id, sequence, type, ts, restaurant_id, payload)
--    VALUES ('00000000-0000-0000-0000-000000000003', 2, 'STATE_SYNC', 0, '<restaurant_id>', '{}');
--    -- Debe fallar con constraint pos_local_events_type_not_state_sync
--
-- 5. Transición única activa:
--    INSERT INTO pos_authority_transitions (restaurant_id, direction, from_authority, to_authority, expires_at)
--    VALUES ('<restaurant_id>', 'activation', 'supabase', 'local_server', NOW() + INTERVAL '10 minutes');
--    INSERT INTO pos_authority_transitions (restaurant_id, direction, from_authority, to_authority, expires_at)
--    VALUES ('<restaurant_id>', 'activation', 'supabase', 'local_server', NOW() + INTERVAL '10 minutes');
--    -- Segunda inserción → debe fallar con índice único parcial pos_authority_transitions_one_active_per_restaurant
--
-- 6. RLS pos_authority_transitions:
--    Misma prueba de tenant isolation que en punto 2, para esta tabla.
--
-- 7. pos_write_authority:
--    UPDATE clients SET pos_write_authority = 'invalid_value' WHERE id = '<restaurant_id>';
--    -- Debe fallar con clients_pos_write_authority_valid
--    SELECT pos_write_authority FROM clients WHERE id = '<restaurant_id>';
--    -- Debe devolver 'supabase' (DEFAULT) para restaurantes existentes
