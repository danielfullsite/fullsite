-- =============================================================================
-- SKEL-01: VANTARA + NÓMADA-MINI tenant seed
-- Branch:  sandbox/second-customer-skeleton
-- Project: fullsite-sandbox (NEVER apply to qjiomlvudfmzuvqvhwpk)
--
-- Idempotente: re-ejecutar es seguro (ON CONFLICT DO NOTHING).
-- Scope: SOLO datos de tenant (clients, menu_categories, menu_items).
--        mesas = INTEGER en clients.mesas — no hay pos_spaces/pos_tables.
--        Auth users y client_users se crean en bootstrap_auth.py.
--
-- Orden de aplicación:
--   1. 000_extensions_sandbox.sql
--   2. 010_consolidated_core_sandbox.sql
--   3. 003_rls_policies_sandbox.sql
--   4. 004_functions_sandbox.sql
--   5. 008_realtime_sandbox.sql
--   6. ESTE ARCHIVO
--   7. python3 scripts/sql/sandbox/bootstrap_auth.py
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- TENANT 1: VANTARA — tenant principal del demo
-- clients.mesas = 12 → el POS renderiza 12 slots de mesa
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.clients (
  id, display_name, city, timezone,
  data_source, active, default_theme, accent_color,
  mesas, features, iva_rate, receipt_footer
) VALUES (
  'vantara',
  'Grupo VANTARA',
  'Monterrey',
  'America/Monterrey',
  'fullsite',
  true,
  'dark',
  'emerald',
  12,
  '{"pos": true, "kds": true, "dashboard": true, "inventory": false, "agents": false}'::jsonb,
  0.16,
  'Bienvenido a VANTARA — Gracias por tu visita'
) ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- TENANT 2: NÓMADA-MINI — segundo tenant para test de aislamiento
-- Un usuario NÓMADA-MINI no debe ver datos de VANTARA. Ver SKEL-04.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.clients (
  id, display_name, city, timezone,
  data_source, active, default_theme, accent_color,
  mesas, features, iva_rate, receipt_footer
) VALUES (
  'nomada-mini',
  'NÓMADA Mini (isolation test)',
  'Monterrey',
  'America/Monterrey',
  'fullsite',
  true,
  'light',
  'blue',
  4,
  '{"pos": true, "kds": false, "dashboard": true, "inventory": false, "agents": false}'::jsonb,
  0.16,
  'NÓMADA Mini — Test tenant'
) ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- VANTARA: categorías de menú
-- color usa clase Tailwind (convención de pos_menu_categories)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.pos_menu_categories (id, client_id, name, color, sort_order, active)
VALUES
  ('vantara-cat-entradas',   'vantara', 'Entradas',       'bg-emerald-600', 1, true),
  ('vantara-cat-principales','vantara', 'Platos Fuertes',  'bg-blue-600',    2, true),
  ('vantara-cat-bebidas',    'vantara', 'Bebidas',         'bg-amber-500',   3, true)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- VANTARA: platillos — mínimo para flujo completo de demo POS
-- pos_menu_items no tiene columna description (ver 010_consolidated_core.sql)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.pos_menu_items (id, client_id, category_id, name, price, active)
VALUES
  -- Entradas
  ('vantara-item-guacamole', 'vantara', 'vantara-cat-entradas',    'Guacamole',          120.00, true),
  ('vantara-item-quesadilla','vantara', 'vantara-cat-entradas',    'Quesadilla',           95.00, true),
  ('vantara-item-tostadas',  'vantara', 'vantara-cat-entradas',    'Tostadas de Tinga',   110.00, true),
  -- Platos fuertes
  ('vantara-item-ribeye',    'vantara', 'vantara-cat-principales', 'Ribeye 300g',          680.00, true),
  ('vantara-item-salmon',    'vantara', 'vantara-cat-principales', 'Salmón a la Plancha',  420.00, true),
  ('vantara-item-pollo',     'vantara', 'vantara-cat-principales', 'Pollo a la Brasa',     295.00, true),
  ('vantara-item-pasta',     'vantara', 'vantara-cat-principales', 'Pasta Alfredo',        240.00, true),
  -- Bebidas
  ('vantara-item-agua',      'vantara', 'vantara-cat-bebidas',     'Agua Mineral',          45.00, true),
  ('vantara-item-cafe',      'vantara', 'vantara-cat-bebidas',     'Café Americano',        55.00, true),
  ('vantara-item-limonada',  'vantara', 'vantara-cat-bebidas',     'Limonada Natural',      65.00, true),
  ('vantara-item-refresco',  'vantara', 'vantara-cat-bebidas',     'Refresco',              50.00, true)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- NÓMADA-MINI: menú mínimo — suficiente para prueba de aislamiento
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.pos_menu_categories (id, client_id, name, color, sort_order, active)
VALUES ('nomada-cat-principal', 'nomada-mini', 'Menú', 'bg-blue-500', 1, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pos_menu_items (id, client_id, category_id, name, price, active)
VALUES ('nomada-item-test', 'nomada-mini', 'nomada-cat-principal', 'Platillo de prueba NÓMADA', 150.00, true)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- =============================================================================
-- SIGUIENTE PASO: crear usuarios Auth
-- Ejecutar: python3 scripts/sql/sandbox/bootstrap_auth.py
-- Requiere: NEXT_PUBLIC_SUPABASE_URL_SANDBOX y SANDBOX_SERVICE_KEY en env
-- Crea:
--   owner@vantara.sandbox  → client_users(client_id='vantara',  role='dueño')
--   test@nomada.sandbox    → client_users(client_id='nomada-mini', role='dueño')
-- =============================================================================
