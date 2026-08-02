-- PAE Café Nómada — v1_payment_methods.sql
-- Prerequisito: v1_client.sql aplicado.

INSERT INTO pos_payment_methods (client_id, name, type, commission_pct, fiscal_code, active) VALUES
  ('nomada', 'Efectivo',           'cash',     0,    '01', true),
  ('nomada', 'Tarjeta de crédito', 'card',     3.6,  '04', true),
  ('nomada', 'Tarjeta de débito',  'card',     1.8,  '28', true),
  ('nomada', 'Transferencia',      'transfer', 0,    '03', true);

DO $$
DECLARE cnt integer;
BEGIN
  SELECT count(*) INTO cnt FROM pos_payment_methods WHERE client_id = 'nomada';
  IF cnt <> 4 THEN
    RAISE EXCEPTION 'v1_payment_methods: expected 4 rows for nomada, got %', cnt;
  END IF;
  RAISE NOTICE 'v1_payment_methods OK: % payment methods for nomada', cnt;
END $$;
