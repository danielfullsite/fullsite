-- PAE Café Nómada — v1_staff.sql
-- PINs son ficticios y solo válidos en staging.
-- Prerequisito: v1_client.sql aplicado.

INSERT INTO pos_staff (client_id, name, pin, role, role_display, active) VALUES
  ('nomada', 'Ana García',     '9001', 'admin',  'Gerente',  true),
  ('nomada', 'Carlos Méndez',  '1001', 'mesero', 'Mesero',   true),
  ('nomada', 'Diana Torres',   '1002', 'mesero', 'Mesero',   true),
  ('nomada', 'Eduardo Reyes',  '1003', 'mesero', 'Mesero',   true);

-- Verificación rápida
DO $$
DECLARE cnt integer;
BEGIN
  SELECT count(*) INTO cnt FROM pos_staff WHERE client_id = 'nomada';
  IF cnt <> 4 THEN
    RAISE EXCEPTION 'v1_staff: expected 4 rows for nomada, got %', cnt;
  END IF;
  RAISE NOTICE 'v1_staff OK: % staff rows for nomada', cnt;
END $$;
