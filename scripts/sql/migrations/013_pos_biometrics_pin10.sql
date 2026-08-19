-- ─────────────────────────────────────────────────────────────────────────────
-- 013 · Huellas (DigitalPersona/HID) + PIN de 10 dígitos
-- Ver docs/product/DESIGN-HUELLAS-PIN.md (P0-A).
-- Aditivo e idempotente. Aplicar en prod = el fundador (MCP prod es read-only).
-- NO borra ni cambia PINs existentes; solo amplía el rango y agrega la tabla de biométricos.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1) Permitir PIN de hasta 10 dígitos (los generados por el sistema).
--    Si existe un CHECK viejo que limitaba a 4–8, se reemplaza; los PINs actuales
--    (4–8 díg) siguen siendo válidos.
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

-- 2) Tabla de biométricos (templates de huella).
--    El template va CIFRADO por la app antes de guardarse; nunca se expone al cliente.
CREATE TABLE IF NOT EXISTS public.pos_staff_biometrics (
  id            TEXT PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  client_id     TEXT NOT NULL,
  staff_id      TEXT NOT NULL REFERENCES public.pos_staff(id) ON DELETE CASCADE,
  template      TEXT NOT NULL,              -- FMD/plantilla, CIFRADA por la app
  finger_index  INTEGER NOT NULL DEFAULT 1, -- por si se enrolan varios dedos
  terminal_id   TEXT,                       -- dónde se enroló
  enrolled_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, staff_id, finger_index)
);

CREATE INDEX IF NOT EXISTS idx_pos_biometrics_client_staff
  ON public.pos_staff_biometrics (client_id, staff_id);

-- 3) RLS: SOLO service_role. El template biométrico NUNCA se lee desde el cliente.
ALTER TABLE public.pos_staff_biometrics ENABLE ROW LEVEL SECURITY;
-- (Sin políticas para authenticated/anon → nadie lee/escribe salvo service_role,
--  que bypassa RLS. El servicio 7718 / la API admin usan service_role.)

COMMIT;

-- ── Rollback (si hiciera falta) ─────────────────────────────────────────────
-- DROP TABLE IF EXISTS public.pos_staff_biometrics;
-- ALTER TABLE public.pos_staff DROP CONSTRAINT IF EXISTS pos_staff_pin_len_chk;
