-- ═════════════════════════════════════════════════════════════════════════════
-- W1-D · Cierre canónico: sello inmutable + eventos compensatorios (ADITIVA)
-- ═════════════════════════════════════════════════════════════════════════════
-- Identidad canónica del cierre: (client_id, turno_id) — pos_cierres es un
-- cierre de caja POR TURNO (arqueo). Varios turnos (y por tanto varios cierres)
-- por (client_id, business_date) son legítimos; el "cierre del día" es la
-- agregación por fecha. La idempotencia por turno ya está garantizada por el
-- índice existente uq_cierres_turno_id (UNIQUE turno_id WHERE NOT NULL).
--
-- Este archivo agrega:
--   1. Columnas de sello: snapshot JSONB (reconstruibilidad económica) +
--      sealed_at.
--   2. Inmutabilidad a nivel BD: trigger BEFORE UPDATE/DELETE que rechaza
--      mutaciones (aplica también a service_role — los triggers no respetan
--      bypass de RLS). Excepción administrativa EXPLÍCITA y auditable:
--      SET LOCAL app.cierre_admin_unlock = 'on'  (queda en logs vía WARNING;
--      jamás debe usarse desde la aplicación).
--   3. pos_cierre_ajustes: eventos compensatorios post-cierre (append-only,
--      misma inmutabilidad). El cierre sellado NUNCA se reescribe; lo que
--      llega tarde se representa como ajuste + estado de reconciliación.
--   4. Triggers de guardia: cualquier INSERT/UPDATE financiero sobre
--      pos_orders o INSERT en pos_cash_movements cuyo turno ya esté sellado
--      genera el ajuste automáticamente (cubre replay offline, refunds,
--      cancelaciones y correcciones de caja — por CUALQUIER ruta de escritura,
--      incluida PostgREST directa).
--   5. Vista pos_cierres_estado: cierre + ajustes + estado de reconciliación.
--
-- Rollback:
--   DROP VIEW pos_cierres_estado;
--   DROP TRIGGER trg_orders_post_close ON pos_orders;
--   DROP TRIGGER trg_cash_post_close ON pos_cash_movements;
--   DROP TRIGGER trg_cierres_immutable ON pos_cierres;
--   DROP TRIGGER trg_cierre_ajustes_immutable ON pos_cierre_ajustes;
--   DROP FUNCTION w1d_sealed_guard(), w1d_orders_post_close(), w1d_cash_post_close();
--   DROP TABLE pos_cierre_ajustes;
--   ALTER TABLE pos_cierres DROP COLUMN snapshot, DROP COLUMN sealed_at;
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. Sello ──
ALTER TABLE pos_cierres ADD COLUMN IF NOT EXISTS snapshot JSONB;
ALTER TABLE pos_cierres ADD COLUMN IF NOT EXISTS sealed_at TIMESTAMPTZ DEFAULT now();

-- ── 3. Eventos compensatorios (append-only) ──
CREATE TABLE IF NOT EXISTS pos_cierre_ajustes (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT NOT NULL,
  cierre_id TEXT NOT NULL,
  turno_id TEXT,
  business_date DATE,
  tipo TEXT NOT NULL,           -- late_order | post_close_refund | post_close_cancellation
                                -- | post_close_adjustment | cash_correction
  monto NUMERIC DEFAULT 0,      -- impacto monetario (delta; negativo = reduce el día)
  source_operation TEXT NOT NULL, -- orden:revision / movimiento — idempotencia de origen
  motivo TEXT,
  actor TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE pos_cierre_ajustes
    ADD CONSTRAINT uq_cierre_ajuste_source UNIQUE (client_id, tipo, source_operation);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_cierre_ajustes_cierre ON pos_cierre_ajustes (client_id, cierre_id);
CREATE INDEX IF NOT EXISTS idx_cierre_ajustes_fecha ON pos_cierre_ajustes (client_id, business_date);

-- ── 2. Inmutabilidad (cierres y ajustes) ──
CREATE OR REPLACE FUNCTION w1d_sealed_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('app.cierre_admin_unlock', true), '') = 'on' THEN
    RAISE WARNING 'w1d_admin_unlock: % sobre %.% id=% por rol=%',
      TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME,
      CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END,
      current_user;
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'SEALED: % en % está prohibido — los cierres son inmutables. '
    'Correcciones: pos_cierre_ajustes (eventos compensatorios). '
    'Recuperación administrativa: SET LOCAL app.cierre_admin_unlock = ''on'' (auditada).',
    TG_OP, TG_TABLE_NAME;
END $$;

DROP TRIGGER IF EXISTS trg_cierres_immutable ON pos_cierres;
CREATE TRIGGER trg_cierres_immutable
  BEFORE UPDATE OR DELETE ON pos_cierres
  FOR EACH ROW EXECUTE FUNCTION w1d_sealed_guard();

DROP TRIGGER IF EXISTS trg_cierre_ajustes_immutable ON pos_cierre_ajustes;
CREATE TRIGGER trg_cierre_ajustes_immutable
  BEFORE UPDATE OR DELETE ON pos_cierre_ajustes
  FOR EACH ROW EXECUTE FUNCTION w1d_sealed_guard();

-- ── 4a. Guardia post-cierre sobre órdenes ──
-- Cubre: orden offline que sincroniza tras el sello (INSERT tardío o primer
-- UPDATE financiero), refund/cancelación posterior (total baja / status cambia)
-- y cualquier mutación financiera por cualquier ruta. No bloquea la operación
-- (la verdad no se pierde) — la registra como ajuste del cierre sellado.
CREATE OR REPLACE FUNCTION w1d_orders_post_close() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_cierre RECORD;
  v_tipo TEXT;
  v_monto NUMERIC;
BEGIN
  IF NEW.turno_id IS NULL THEN RETURN NEW; END IF;

  SELECT id, fecha INTO v_cierre FROM pos_cierres
  WHERE turno_id = NEW.turno_id AND client_id = NEW.client_id
  LIMIT 1;
  IF v_cierre.id IS NULL THEN RETURN NEW; END IF;  -- turno aún abierto

  IF TG_OP = 'INSERT' THEN
    v_tipo := 'late_order';
    v_monto := coalesce(NEW.total, 0);
  ELSE
    -- Solo cambios con relevancia financiera
    IF coalesce(NEW.total, 0) = coalesce(OLD.total, 0)
       AND NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.items IS NOT DISTINCT FROM OLD.items THEN
      RETURN NEW;
    END IF;
    IF NEW.status IN ('cancelada', 'anulada') AND OLD.status NOT IN ('cancelada', 'anulada') THEN
      v_tipo := 'post_close_cancellation';
    ELSIF coalesce(NEW.total, 0) < coalesce(OLD.total, 0) THEN
      v_tipo := 'post_close_refund';
    ELSE
      v_tipo := 'post_close_adjustment';
    END IF;
    v_monto := coalesce(NEW.total, 0) - coalesce(OLD.total, 0);
  END IF;

  INSERT INTO pos_cierre_ajustes
    (client_id, cierre_id, turno_id, business_date, tipo, monto, source_operation, motivo, actor)
  VALUES
    (NEW.client_id, v_cierre.id, NEW.turno_id, v_cierre.fecha, v_tipo, v_monto,
     NEW.id || ':' || coalesce(NEW.order_revision, 0) ||
       CASE WHEN TG_OP = 'INSERT' THEN ':ins' ELSE '' END,
     'auto: ' || TG_OP || ' sobre orden con turno sellado',
     coalesce(NEW.mesero, 'sistema'))
  ON CONFLICT (client_id, tipo, source_operation) DO NOTHING;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_orders_post_close ON pos_orders;
CREATE TRIGGER trg_orders_post_close
  AFTER INSERT OR UPDATE ON pos_orders
  FOR EACH ROW EXECUTE FUNCTION w1d_orders_post_close();

-- ── 4b. Guardia post-cierre sobre movimientos de caja ──
CREATE OR REPLACE FUNCTION w1d_cash_post_close() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_cierre RECORD;
BEGIN
  IF NEW.turno_id IS NULL THEN RETURN NEW; END IF;
  SELECT id, fecha INTO v_cierre FROM pos_cierres
  WHERE turno_id = NEW.turno_id AND client_id = NEW.client_id LIMIT 1;
  IF v_cierre.id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO pos_cierre_ajustes
    (client_id, cierre_id, turno_id, business_date, tipo, monto, source_operation, motivo, actor)
  VALUES
    (NEW.client_id, v_cierre.id, NEW.turno_id, v_cierre.fecha, 'cash_correction',
     CASE WHEN NEW.type = 'retiro' THEN -NEW.amount ELSE NEW.amount END,
     'cashmov:' || NEW.id,
     coalesce(NEW.reason, 'movimiento de caja post-cierre'),
     NEW.actor)
  ON CONFLICT (client_id, tipo, source_operation) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cash_post_close ON pos_cash_movements;
CREATE TRIGGER trg_cash_post_close
  AFTER INSERT ON pos_cash_movements
  FOR EACH ROW EXECUTE FUNCTION w1d_cash_post_close();

-- ── 5. Estado de reconciliación ──
CREATE OR REPLACE VIEW pos_cierres_estado AS
SELECT c.id, c.client_id, c.turno_id, c.fecha AS business_date,
       c.total_ventas, c.efectivo_sistema, c.tarjeta_sistema,
       c.transferencias_sistema, c.total_contado, c.diferencia,
       c.closed_by, c.sealed_at, c.snapshot,
       count(a.id) AS ajustes_count,
       coalesce(sum(a.monto), 0) AS ajustes_monto,
       CASE WHEN count(a.id) = 0 THEN 'SEALED'
            ELSE 'SEALED_WITH_ADJUSTMENTS' END AS estado
FROM pos_cierres c
LEFT JOIN pos_cierre_ajustes a
  ON a.client_id = c.client_id AND a.cierre_id = c.id
GROUP BY c.id, c.client_id, c.turno_id, c.fecha, c.total_ventas,
         c.efectivo_sistema, c.tarjeta_sistema, c.transferencias_sistema,
         c.total_contado, c.diferencia, c.closed_by, c.sealed_at, c.snapshot;
