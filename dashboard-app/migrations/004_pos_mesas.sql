-- Migration 004: pos_mesas — persistent floor plan
-- Applied: 2026-07-24 via Supabase MCP (create_pos_mesas)
--
-- PURPOSE:
--   Replaces the FLOOR_TABLES hardcode in mesas/page.tsx and plano/page.tsx
--   with a DB-backed table. Positions, shapes, zones, and capacities per client.
--   MESAS_CONFIG / FLOOR_TABLES remain as fallback until 7 stable days post-deploy.
--
-- ROLLBACK:
--   Code: both pages fall back to FLOOR_TABLES when DB returns 0 rows.
--   Data: DROP TABLE pos_mesas (no FK deps).

CREATE TABLE IF NOT EXISTS pos_mesas (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  text        NOT NULL,
  number     integer     NOT NULL,
  capacity   integer     NOT NULL DEFAULT 4,
  zone       text,
  x_pct      numeric(6,2) NOT NULL,
  y_pct      numeric(6,2) NOT NULL,
  shape      text        NOT NULL,
  sort_order integer     NOT NULL DEFAULT 0,
  active     boolean     NOT NULL DEFAULT true,
  UNIQUE (client_id, number)
);

COMMENT ON TABLE pos_mesas IS 'Physical floor plan per client: one row per table.';

CREATE INDEX IF NOT EXISTS idx_pos_mesas_client_active
  ON pos_mesas(client_id, sort_order)
  WHERE active;

ALTER TABLE pos_mesas ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "pos_mesas anon read"
  ON pos_mesas FOR SELECT TO anon, authenticated USING (true);

-- ─── Seed AMALAY (idempotent) ─────────────────────────────────────────────────
-- Positions from plano/page.tsx FLOOR_TABLES (canonical — has zones).
-- Capacities from AMALAY_MESA_CAPACITY in pos-data.ts.
-- Safe to re-run: INSERT ... ON CONFLICT (client_id, number) DO UPDATE
-- only touches rows where values are actually different.

INSERT INTO pos_mesas (client_id, number, capacity, zone, x_pct, y_pct, shape, sort_order)
VALUES
  -- Entrada
  ('amalay',  45, 4, 'Entrada',  9.00,  9.00, 'round',    0),
  ('amalay',   1, 4, 'Entrada', 22.00,  9.00, 'round',    1),
  ('amalay',   2, 4, 'Entrada', 30.00,  9.00, 'round',    2),
  ('amalay',   3, 4, 'Entrada', 38.00,  9.00, 'round',    3),
  ('amalay',   4, 4, 'Entrada', 31.00, 22.00, 'round',    4),
  -- Interior (Lámparas)
  ('amalay',   5, 4, 'Interior', 56.00,  9.00, 'rect-h',  5),
  ('amalay',   6, 4, 'Interior', 65.00,  9.00, 'rect-h',  6),
  ('amalay',   7, 4, 'Interior', 74.00,  9.00, 'rect-h',  7),
  ('amalay',   9, 4, 'Interior', 60.00, 22.00, 'round',   8),
  ('amalay',   8, 4, 'Interior', 69.00, 22.00, 'round',   9),
  -- Pasillo
  ('amalay',  44, 4, 'Pasillo',  9.00, 35.00, 'round',   10),
  ('amalay',  43, 4, 'Pasillo',  9.00, 58.00, 'round',   11),
  -- Terraza
  ('amalay',  21, 4, 'Terraza', 27.00, 35.00, 'square',  12),
  ('amalay',  20, 4, 'Terraza', 37.00, 35.00, 'round',   13),
  ('amalay',  32, 4, 'Terraza', 26.00, 47.00, 'round',   14),
  ('amalay',  31, 4, 'Terraza', 35.00, 47.00, 'round',   15),
  ('amalay',  30, 8, 'Terraza', 45.00, 47.00, 'round-lg',16),
  ('amalay',  42, 6, 'Terraza', 27.00, 59.00, 'rect-h',  17),
  ('amalay',  41, 6, 'Terraza', 36.50, 59.00, 'rect-h',  18),
  ('amalay',  40, 6, 'Terraza', 46.00, 59.00, 'rect-h',  19),
  -- Barra
  ('amalay',  10, 4, 'Barra',   57.00, 34.00, 'square',  20),
  ('amalay',  11, 4, 'Barra',   57.00, 46.00, 'square',  21),
  ('amalay',  12, 4, 'Barra',   57.00, 58.00, 'square',  22),
  -- Toldo
  ('amalay',  50, 4, 'Toldo',   12.00, 78.00, 'rect-h',  23),
  ('amalay',  53, 4, 'Toldo',   24.00, 78.00, 'rect-h',  24),
  ('amalay',  55, 4, 'Toldo',   36.00, 78.00, 'rect-h',  25),
  ('amalay',  51, 4, 'Toldo',   12.00, 91.00, 'rect-h',  26),
  ('amalay',  52, 4, 'Toldo',   24.00, 91.00, 'rect-h',  27),
  ('amalay',  54, 4, 'Toldo',   36.00, 91.00, 'rect-h',  28),
  -- Privado
  ('amalay',  61, 4, 'Privado', 68.00, 78.00, 'rect-h',  29),
  ('amalay',  63, 4, 'Privado', 80.00, 78.00, 'rect-h',  30),
  ('amalay',  60, 4, 'Privado', 68.00, 91.00, 'rect-h',  31),
  ('amalay',  62, 4, 'Privado', 80.00, 91.00, 'rect-h',  32)
ON CONFLICT (client_id, number) DO UPDATE
  SET capacity   = EXCLUDED.capacity,
      zone       = EXCLUDED.zone,
      x_pct      = EXCLUDED.x_pct,
      y_pct      = EXCLUDED.y_pct,
      shape      = EXCLUDED.shape,
      sort_order = EXCLUDED.sort_order
  WHERE pos_mesas.capacity   IS DISTINCT FROM EXCLUDED.capacity
     OR pos_mesas.zone       IS DISTINCT FROM EXCLUDED.zone
     OR pos_mesas.x_pct      IS DISTINCT FROM EXCLUDED.x_pct
     OR pos_mesas.y_pct      IS DISTINCT FROM EXCLUDED.y_pct
     OR pos_mesas.shape      IS DISTINCT FROM EXCLUDED.shape
     OR pos_mesas.sort_order IS DISTINCT FROM EXCLUDED.sort_order;
