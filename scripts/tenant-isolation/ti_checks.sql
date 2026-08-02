-- PAE Café Nómada — Tenant Isolation Checks TI-01…TI-06
--
-- MODO DE EJECUCIÓN OBLIGATORIO:
--   Correr autenticado como la sesión de nomada (no service_role).
--   Con service_role, RLS se bypassa y los checks no son confiables.
--
-- Para tests automatizados: usar el Supabase JS client con
--   supabase.auth.signInWithPassword({ email: 'admin@nomada.test', password: ... })
--   y ejecutar estos selects desde esa sesión autenticada.
--
-- Los checks TI-04 y TI-06 son manuales (UI y AI chat) — ver README.md.

-- -------------------------------------------------------
-- TI-01 — pos_orders: 0 órdenes de otros tenants visibles
-- -------------------------------------------------------
-- Espera: 0 filas
SELECT 'TI-01' AS check_name,
       count(*) AS total_visible,
       count(*) = 0 AS pass,
       'ninguna orden de otro tenant debe ser visible' AS descripcion
  FROM pos_orders
 WHERE client_id <> 'nomada';

-- -------------------------------------------------------
-- TI-02 — pos_menu_categories: 0 categorías de otros tenants
-- -------------------------------------------------------
-- Espera: 0 filas
SELECT 'TI-02' AS check_name,
       count(*) AS total_visible,
       count(*) = 0 AS pass,
       'ninguna categoría de otro tenant debe ser visible' AS descripcion
  FROM pos_menu_categories
 WHERE client_id <> 'nomada';

-- -------------------------------------------------------
-- TI-03 — pos_staff: 0 staff de otros tenants
-- -------------------------------------------------------
-- Espera: 0 filas
SELECT 'TI-03' AS check_name,
       count(*) AS total_visible,
       count(*) = 0 AS pass,
       'ningún staff de otro tenant debe ser visible' AS descripcion
  FROM pos_staff
 WHERE client_id <> 'nomada';

-- -------------------------------------------------------
-- TI-05 — Dashboard: 0 datos de ventas de otros tenants
-- -------------------------------------------------------
-- Espera: 0 filas
SELECT 'TI-05' AS check_name,
       count(*) AS total_visible,
       count(*) = 0 AS pass,
       'ninguna orden/cierre de amalay o vantara visible' AS descripcion
  FROM pos_orders
 WHERE client_id IN ('amalay', 'vantara', 'nomada-mini');

-- -------------------------------------------------------
-- Resumen consolidado (los 4 checks automáticos)
-- -------------------------------------------------------
SELECT check_name, total_visible, pass FROM (
  SELECT 'TI-01' AS check_name, count(*) AS total_visible, count(*) = 0 AS pass
    FROM pos_orders WHERE client_id <> 'nomada'
  UNION ALL
  SELECT 'TI-02', count(*), count(*) = 0
    FROM pos_menu_categories WHERE client_id <> 'nomada'
  UNION ALL
  SELECT 'TI-03', count(*), count(*) = 0
    FROM pos_staff WHERE client_id <> 'nomada'
  UNION ALL
  SELECT 'TI-05', count(*), count(*) = 0
    FROM pos_orders WHERE client_id IN ('amalay', 'vantara', 'nomada-mini')
) t
ORDER BY pass ASC, check_name;
