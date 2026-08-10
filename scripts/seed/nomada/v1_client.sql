-- PAE Café Nómada — v1_client.sql
-- Prerequisito: Deuda D-09 aplicada (sin DEFAULT 'amalay' en ninguna tabla).
-- Seguro para re-ejecutar: ON CONFLICT DO NOTHING.

INSERT INTO clients (
  id,
  display_name,
  city,
  timezone,
  mesas,
  data_source,
  pos_write_authority,
  type,
  receipt_footer,
  business_day_start_local,
  active,
  features,
  accent_color,
  default_theme,
  iva_rate
) VALUES (
  'nomada',
  'Café Nómada',
  'Monterrey',
  'America/Mexico_City',
  15,
  'fullsite',
  'supabase',
  'cafe',
  'Gracias por visitarnos.',
  '07:00:00',
  true,
  '{
    "pos": true,
    "kds": true,
    "dashboard": true,
    "staff": true,
    "recipes": true,
    "inventory": true,
    "agents": true,
    "reports": true,
    "customers": false,
    "cfdi": false,
    "reservaciones": false,
    "suppliers": false
  }'::jsonb,
  'emerald',
  'light',
  0.16
)
ON CONFLICT (id) DO NOTHING;
