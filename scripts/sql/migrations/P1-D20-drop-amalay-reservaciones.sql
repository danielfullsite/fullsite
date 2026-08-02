-- P1-D20: Drop legacy amalay_reservaciones table
-- The generic `reservaciones` table (with client_id) is the replacement.
-- Run only after confirming no code references amalay_reservaciones.
-- grep -rn "amalay_reservaciones" src/ app/ lib/ agents/ → must return 0 hits before running.

DROP TABLE IF EXISTS amalay_reservaciones;

-- Verify
SELECT COUNT(*) AS remaining FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'amalay_reservaciones';
