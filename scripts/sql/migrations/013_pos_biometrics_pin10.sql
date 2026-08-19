-- ─────────────────────────────────────────────────────────────────────────────
-- 013 · PIN de 10 dígitos (huellas: la tabla ya existe, ver nota)
-- Ver docs/product/DESIGN-HUELLAS-PIN.md + FINGERPRINT-RESTORE.md (P0-A).
-- Aditivo e idempotente. Aplicar en prod = el fundador (MCP prod es read-only).
-- NO borra ni cambia PINs existentes; solo amplía el rango a 10 dígitos.
--
-- NOTA sobre biométricos: NO se crea tabla nueva. El servicio de huella
-- (print-bridge/fingerprint-service.cs) ya usa la tabla EXISTENTE
-- `pos_fingerprint_templates` (id, client_id, template, updated_at), con RLS
-- service_role + authenticated SELECT (sin anon). La versión anterior de esta
-- migración creaba `pos_staff_biometrics` por error (duplicada) — eliminado.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Permitir PIN de hasta 10 dígitos (los generados por el sistema).
-- Si existe un CHECK viejo que limitaba a 4–8, se reemplaza; los PINs actuales
-- (4–8 díg) siguen siendo válidos.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'pos_staff' AND constraint_name = 'pos_staff_pin_len_chk'
  ) THEN
    ALTER TABLE public.pos_staff DROP CONSTRAINT pos_staff_pin_len_chk;
  END IF;
END $$;

ALTER TABLE public.pos_staff
  ADD CONSTRAINT pos_staff_pin_len_chk
  CHECK (pin ~ '^[0-9]{4,10}$');

COMMIT;

-- ── Rollback ────────────────────────────────────────────────────────────────
-- ALTER TABLE public.pos_staff DROP CONSTRAINT IF EXISTS pos_staff_pin_len_chk;
