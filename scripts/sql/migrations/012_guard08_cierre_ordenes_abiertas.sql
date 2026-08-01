-- GUARD-08: Cierre con órdenes abiertas
-- Aplicada: 2026-07-31 (staging + prod via MCP)
-- Referencia: docs/certifications/OCS-P0-1-GUARD08.md

ALTER TABLE pos_cierres
  ADD COLUMN IF NOT EXISTS cierre_con_ordenes_abiertas boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS ordenes_pendientes          text[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cierre_autorizado_por       text,
  ADD COLUMN IF NOT EXISTS cierre_nota                 text;
