-- ═══════════════════════════════════════════════════════════════════════════
-- second_tenant_config.sql — Second clean tenant 'demo' (El Molcajete Demo)
-- Target: STAGING Supabase project ONLY (fullsite-staging).
-- NEVER run against AMALAY production (project ref qjiomlvudfmzuvqvhwpk).
--
-- Purpose: war-room clonability gate — a second tenant fully distinct from
--   AMALAY: distinct sucursal, distinct menu, distinct staff/roles, distinct
--   payment methods, distinct config. Zero AMALAY references.
--
-- Provenance: menu/staff dataset mirrors scripts/demo/demo_seed.py
--   (see scripts/demo/PROVENANCE.md — all data SIMULATED, no PII).
--   This file exists because demo_seed.py targets a schema shape
--   (pos_tables, source/environment columns, clients.slug/name) that does
--   NOT exist on the current staging schema; this SQL matches the real schema.
--
-- Idempotent: every INSERT is ON CONFLICT (id) DO UPDATE.
-- Reversible: run the TEARDOWN block at the bottom (deletes only
--   client_id='demo' rows — mirrors IG-07 in demo_reset.py).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Client (tenant root) ────────────────────────────────────────────────
INSERT INTO clients (id, display_name, city, timezone, iva_rate, type, mesas,
                     default_theme, accent_color, data_source, active,
                     receipt_footer, features, meseros)
VALUES ('demo', 'El Molcajete Demo', 'Guadalajara, JAL', 'America/Mexico_City',
        0.16, 'Mexican Restaurant Demo', 10, 'dark', 'orange', 'demo', true,
        'Gracias por su visita — El Molcajete Demo',
        '{"pos": true, "posRestaurant": true, "chatIA": true, "agentesIA": false, "inventory": true, "facturacion": false}'::jsonb,
        '[]'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name, city = EXCLUDED.city,
  timezone = EXCLUDED.timezone, iva_rate = EXCLUDED.iva_rate,
  type = EXCLUDED.type, mesas = EXCLUDED.mesas,
  default_theme = EXCLUDED.default_theme, accent_color = EXCLUDED.accent_color,
  data_source = EXCLUDED.data_source, active = EXCLUDED.active,
  receipt_footer = EXCLUDED.receipt_footer, features = EXCLUDED.features;

-- ─── 2. Sucursal (distinct branch) ──────────────────────────────────────────
INSERT INTO client_locations (id, client_id, name, address, active)
VALUES ('demo-centro', 'demo', 'Sucursal Centro Demo',
        'Av. Simulada 123, Col. Centro, Guadalajara, JAL', true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, address = EXCLUDED.address, active = EXCLUDED.active;

-- ─── 3. Menu categories (5, distinct from AMALAY's Wansoft groups) ──────────
INSERT INTO pos_menu_categories (id, client_id, name, color, sort_order, active) VALUES
  ('demo-cat-entradas',  'demo', 'Entradas',          'bg-emerald-700', 1, true),
  ('demo-cat-fuertes',   'demo', 'Platillos fuertes', 'bg-rose-700',    2, true),
  ('demo-cat-tacos',     'demo', 'Tacos',             'bg-amber-600',   3, true),
  ('demo-cat-bebidas',   'demo', 'Bebidas',           'bg-sky-600',     4, true),
  ('demo-cat-postres',   'demo', 'Postres',           'bg-purple-600',  5, true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, color = EXCLUDED.color,
  sort_order = EXCLUDED.sort_order, active = EXCLUDED.active;

-- ─── 4. Menu items (30 = 5 × 6, from demo_seed.py dataset) ─────────────────
INSERT INTO pos_menu_items (id, client_id, category_id, name, price, sort_order, active) VALUES
  ('demo-item-001', 'demo', 'demo-cat-entradas', 'Guacamole',                95.00, 1, true),
  ('demo-item-002', 'demo', 'demo-cat-entradas', 'Elote en vaso',            75.00, 2, true),
  ('demo-item-003', 'demo', 'demo-cat-entradas', 'Sopa de lima',            120.00, 3, true),
  ('demo-item-004', 'demo', 'demo-cat-entradas', 'Tostadas de tinga',       110.00, 4, true),
  ('demo-item-005', 'demo', 'demo-cat-entradas', 'Queso fundido',           145.00, 5, true),
  ('demo-item-006', 'demo', 'demo-cat-entradas', 'Quesadillas surtidas',    130.00, 6, true),
  ('demo-item-007', 'demo', 'demo-cat-fuertes',  'Enchiladas verdes',       175.00, 1, true),
  ('demo-item-008', 'demo', 'demo-cat-fuertes',  'Mole negro con pollo',    210.00, 2, true),
  ('demo-item-009', 'demo', 'demo-cat-fuertes',  'Chiles en nogada',        240.00, 3, true),
  ('demo-item-010', 'demo', 'demo-cat-fuertes',  'Tamales oaxaqueños',      155.00, 4, true),
  ('demo-item-011', 'demo', 'demo-cat-fuertes',  'Pozole rojo',             185.00, 5, true),
  ('demo-item-012', 'demo', 'demo-cat-fuertes',  'Tlayuda con tasajo',      225.00, 6, true),
  ('demo-item-013', 'demo', 'demo-cat-tacos',    'Taco de carnitas',         65.00, 1, true),
  ('demo-item-014', 'demo', 'demo-cat-tacos',    'Taco de barbacoa',         70.00, 2, true),
  ('demo-item-015', 'demo', 'demo-cat-tacos',    'Taco de canasta',          45.00, 3, true),
  ('demo-item-016', 'demo', 'demo-cat-tacos',    'Taco de chapulines',       85.00, 4, true),
  ('demo-item-017', 'demo', 'demo-cat-tacos',    'Taco de frijoles',         50.00, 5, true),
  ('demo-item-018', 'demo', 'demo-cat-tacos',    'Taco de cochinita',        72.00, 6, true),
  ('demo-item-019', 'demo', 'demo-cat-bebidas',  'Agua de horchata',         55.00, 1, true),
  ('demo-item-020', 'demo', 'demo-cat-bebidas',  'Agua de jamaica',          50.00, 2, true),
  ('demo-item-021', 'demo', 'demo-cat-bebidas',  'Tepache',                  65.00, 3, true),
  ('demo-item-022', 'demo', 'demo-cat-bebidas',  'Mezcal artesanal (50ml)', 120.00, 4, true),
  ('demo-item-023', 'demo', 'demo-cat-bebidas',  'Café de olla',             60.00, 5, true),
  ('demo-item-024', 'demo', 'demo-cat-bebidas',  'Agua mineral',             40.00, 6, true),
  ('demo-item-025', 'demo', 'demo-cat-postres',  'Flan napolitano',          85.00, 1, true),
  ('demo-item-026', 'demo', 'demo-cat-postres',  'Arroz con leche',          75.00, 2, true),
  ('demo-item-027', 'demo', 'demo-cat-postres',  'Buñuelos',                 70.00, 3, true),
  ('demo-item-028', 'demo', 'demo-cat-postres',  'Capirotada',               80.00, 4, true),
  ('demo-item-029', 'demo', 'demo-cat-postres',  'Pay de limón',             90.00, 5, true),
  ('demo-item-030', 'demo', 'demo-cat-postres',  'Helado artesanal',         65.00, 6, true)
ON CONFLICT (id) DO UPDATE SET
  category_id = EXCLUDED.category_id, name = EXCLUDED.name,
  price = EXCLUDED.price, sort_order = EXCLUDED.sort_order, active = EXCLUDED.active;

-- ─── 5. Staff (5, distinct names + distinct roles; synthetic, no PII) ──────
INSERT INTO pos_staff (id, client_id, name, pin, role, role_display, active) VALUES
  ('demo-staff-01', 'demo', 'Ana García',      '1111', 'admin',  'Gerente', true),
  ('demo-staff-02', 'demo', 'Carlos Méndez',   '2222', 'cajero', 'Cajero',  true),
  ('demo-staff-03', 'demo', 'Diana Torres',    '3333', 'mesero', 'Mesera',  true),
  ('demo-staff-04', 'demo', 'Eduardo Reyes',   '4444', 'mesero', 'Mesero',  true),
  ('demo-staff-05', 'demo', 'Fernanda López',  '5555', 'mesero', 'Mesera',  true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, pin = EXCLUDED.pin, role = EXCLUDED.role,
  role_display = EXCLUDED.role_display, active = EXCLUDED.active;

-- ─── 6. Payment methods (distinct set — no Ubereats, unlike AMALAY) ────────
INSERT INTO pos_payment_methods (id, client_id, name, type, commission_pct, active) VALUES
  ('demo-pay-efectivo',      'demo', 'Efectivo',           'cash',  0,   true),
  ('demo-pay-tarjeta',       'demo', 'Tarjeta',            'card',  2.5, true),
  ('demo-pay-transferencia', 'demo', 'Transferencia',      'other', 0,   true),
  ('demo-pay-vales',         'demo', 'Vales de despensa',  'other', 1.0, true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, type = EXCLUDED.type,
  commission_pct = EXCLUDED.commission_pct, active = EXCLUDED.active;

-- ═══════════════════════════════════════════════════════════════════════════
-- PRINTERS (no DB table — printers live in the Bridge's local printers.json,
-- electron-app/local-server). Distinct demo printer config for the Bridge:
--
--   {
--     "version": 2,
--     "client_id": "demo",
--     "printers": [
--       { "id": "demo-cocina", "name": "COCINA-DEMO", "station": "cocina",
--         "type": "network", "ip": "192.168.100.201", "port": 9100 },
--       { "id": "demo-barra",  "name": "BARRA-DEMO",  "station": "barra",
--         "type": "network", "ip": "192.168.100.202", "port": 9100 },
--       { "id": "demo-caja",   "name": "CAJA-DEMO",   "station": "caja",
--         "type": "network", "ip": "192.168.100.203", "port": 9100 }
--     ]
--   }
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- AUTH USER (cannot be created via plain SQL — use Supabase Admin API):
--   curl -X POST "$STAGING_SUPABASE_URL/auth/v1/admin/users" \
--     -H "apikey: $STAGING_SUPABASE_KEY" \
--     -H "Authorization: Bearer $STAGING_SUPABASE_KEY" \
--     -H "Content-Type: application/json" \
--     -d '{"email":"owner@demo.sandbox","password":"<choose>","email_confirm":true}'
-- then link:
--   INSERT INTO client_users (user_id, client_id, role)
--   VALUES ('<new auth user uuid>', 'demo', 'dueño');
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- TEARDOWN (full reversal — only client_id='demo' rows, per IG-07):
--
--   DELETE FROM pos_payment_methods  WHERE client_id = 'demo';
--   DELETE FROM pos_staff            WHERE client_id = 'demo';
--   DELETE FROM pos_menu_items       WHERE client_id = 'demo';
--   DELETE FROM pos_menu_categories  WHERE client_id = 'demo';
--   DELETE FROM client_locations     WHERE client_id = 'demo';
--   DELETE FROM client_users         WHERE client_id = 'demo';
--   DELETE FROM clients              WHERE id = 'demo';
-- ═══════════════════════════════════════════════════════════════════════════
