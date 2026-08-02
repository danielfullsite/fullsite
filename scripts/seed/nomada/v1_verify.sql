-- PAE Café Nómada — v1_verify.sql
-- Ejecutar DESPUÉS de todos los seeds v1_*.sql.
-- Todos los conteos deben coincidir con los valores esperados.

\echo '--- PAE Café Nómada: Verificación post-seed ---'

SELECT 'clients'               AS tabla, count(*) AS total, 1  AS esperado, count(*) = 1  AS ok FROM clients              WHERE id = 'nomada'
UNION ALL
SELECT 'pos_staff',              count(*), 4,  count(*) = 4  FROM pos_staff              WHERE client_id = 'nomada'
UNION ALL
SELECT 'pos_payment_methods',    count(*), 4,  count(*) = 4  FROM pos_payment_methods    WHERE client_id = 'nomada'
UNION ALL
SELECT 'pos_menu_categories',    count(*), 10, count(*) = 10 FROM pos_menu_categories    WHERE client_id = 'nomada'
UNION ALL
SELECT 'pos_menu_items',         count(*), 40, count(*) = 40 FROM pos_menu_items         WHERE client_id = 'nomada'
UNION ALL
SELECT 'pos_ingredients',        count(*), 20, count(*) = 20 FROM pos_ingredients        WHERE client_id = 'nomada'
UNION ALL
SELECT 'pos_recipe_versions',    count(*), 10, count(*) = 10 FROM pos_recipe_versions    WHERE client_id = 'nomada'
UNION ALL
SELECT 'pos_recipe_lines',       count(*), 33, count(*) = 33 FROM pos_recipe_lines       WHERE client_id = 'nomada'
ORDER BY ok ASC, tabla;

\echo ''
\echo 'Contaminación cruzada (todos deben ser 0):'

SELECT 'pos_orders cross-tenant' AS check_name,
       count(*) AS total,
       count(*) = 0 AS ok
  FROM pos_orders
 WHERE client_id <> 'nomada';
