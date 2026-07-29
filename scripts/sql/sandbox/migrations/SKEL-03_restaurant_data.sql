-- =============================================================================
-- SKEL-03: VANTARA restaurant data — modificadores, métodos de pago, staff
-- Branch:  sandbox/second-customer-skeleton
-- Project: fullsite-sandbox (NEVER apply to qjiomlvudfmzuvqvhwpk)
--
-- Idempotente: re-ejecutar es seguro (ON CONFLICT DO NOTHING).
-- Depende de: SKEL-01_seed_vantara.sql (clients, menu_categories, menu_items)
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- VANTARA: grupos de modificadores
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.pos_modifier_groups (
  id, client_id, name, sort_order, active, level,
  min_selections, max_selections, required
) VALUES
  ('vantara-mg-punto',    'vantara', 'Punto de Cocción',  1, true, 1, 1, 1,    true),
  ('vantara-mg-temp',     'vantara', 'Temperatura',       2, true, 1, 0, 1,    false),
  ('vantara-mg-extras',   'vantara', 'Extras',            3, true, 1, 0, 3,    false)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- VANTARA: modificadores por grupo
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.pos_modifiers (id, client_id, group_id, name, price, sort_order, active)
VALUES
  -- Punto de Cocción
  ('vantara-mod-rojo',       'vantara', 'vantara-mg-punto',  'Término Rojo',    0, 1, true),
  ('vantara-mod-medio',      'vantara', 'vantara-mg-punto',  'Tres Cuartos',    0, 2, true),
  ('vantara-mod-bien',       'vantara', 'vantara-mg-punto',  'Bien Cocido',     0, 3, true),
  -- Temperatura
  ('vantara-mod-caliente',   'vantara', 'vantara-mg-temp',   'Caliente',        0, 1, true),
  ('vantara-mod-frio',       'vantara', 'vantara-mg-temp',   'Frío',            0, 2, true),
  ('vantara-mod-tiempo',     'vantara', 'vantara-mg-temp',   'Al Tiempo',       0, 3, true),
  -- Extras (con cargo)
  ('vantara-mod-queso',      'vantara', 'vantara-mg-extras', 'Queso Extra',    25, 1, true),
  ('vantara-mod-aguacate',   'vantara', 'vantara-mg-extras', 'Aguacate Extra', 35, 2, true),
  ('vantara-mod-sin-cebolla','vantara', 'vantara-mg-extras', 'Sin Cebolla',     0, 3, true)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- VANTARA: vincular ítems a grupos de modificadores
-- pos_item_modifier_groups PK = (client_id, item_id, group_id)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.pos_item_modifier_groups (client_id, item_id, group_id)
VALUES
  -- Ribeye requiere punto de cocción + puede pedir extras
  ('vantara', 'vantara-item-ribeye',   'vantara-mg-punto'),
  ('vantara', 'vantara-item-ribeye',   'vantara-mg-extras'),
  -- Salmón puede pedir extras
  ('vantara', 'vantara-item-salmon',   'vantara-mg-extras'),
  -- Café puede pedir temperatura
  ('vantara', 'vantara-item-cafe',     'vantara-mg-temp'),
  -- Limonada puede pedir temperatura
  ('vantara', 'vantara-item-limonada', 'vantara-mg-temp')
ON CONFLICT (client_id, item_id, group_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- VANTARA: métodos de pago
-- type: cash | card_credit | card_debit | transfer | platform
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.pos_payment_methods (id, client_id, name, type, commission_pct, active)
VALUES
  ('vantara-pm-efectivo',  'vantara', 'Efectivo',            'cash',         0,    true),
  ('vantara-pm-credito',   'vantara', 'Tarjeta de Crédito',  'card_credit',  0.035,true),
  ('vantara-pm-debito',    'vantara', 'Tarjeta de Débito',   'card_debit',   0.025,true),
  ('vantara-pm-transfer',  'vantara', 'Transferencia',       'transfer',     0,    true)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- VANTARA: staff
-- PIN único por cliente. PINs de 4 dígitos.
-- Cambiar contraseñas antes de demo real.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.pos_staff (id, client_id, name, pin, role, role_display, active)
VALUES
  ('vantara-staff-admin',   'vantara', 'Carlos Mendoza',   '9001', 'admin',  'Gerente', true),
  ('vantara-staff-sofia',   'vantara', 'Sofia Torres',     '1001', 'mesero', 'Mesero',  true),
  ('vantara-staff-diego',   'vantara', 'Diego Ramírez',    '1002', 'mesero', 'Mesero',  true),
  ('vantara-staff-ana',     'vantara', 'Ana Gutiérrez',    '1003', 'mesero', 'Mesero',  true)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- NÓMADA-MINI: datos mínimos para test de aislamiento
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.pos_payment_methods (id, client_id, name, type, active)
VALUES ('nomada-pm-efectivo', 'nomada-mini', 'Efectivo', 'cash', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pos_staff (id, client_id, name, pin, role, role_display, active)
VALUES ('nomada-staff-owner', 'nomada-mini', 'Test Owner', '0001', 'admin', 'Gerente', true)
ON CONFLICT (id) DO NOTHING;

COMMIT;
