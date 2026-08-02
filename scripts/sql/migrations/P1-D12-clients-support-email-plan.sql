-- P1-D12: Add support_email and plan columns to clients
-- support_email: replaces hardcoded hola@cafeamalay.com in reviews-manager
-- plan: makes plan tier queryable from DB (currently only in TypeScript types)

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS support_email text,
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'fullsite_software',
  ADD COLUMN IF NOT EXISTS social_media text;

-- Seed AMALAY values
UPDATE clients SET
  support_email = 'hola@cafeamalay.com',
  plan = 'fullsite_completo'
WHERE id = 'amalay';

-- Verify
SELECT id, support_email, plan FROM clients ORDER BY id;
