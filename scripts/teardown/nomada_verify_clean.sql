-- PAE Café Nómada — verificación post-teardown
-- Todos los valores en la columna "total" deben ser 0.
-- Si cualquier fila muestra total > 0, el teardown está incompleto.

\echo '--- Verificación post-teardown: todos deben ser 0 ---'

SELECT tabla, total, total = 0 AS ok FROM (
  SELECT 'clients'                 AS tabla, count(*) AS total FROM clients                   WHERE id = 'nomada'
  UNION ALL SELECT 'client_users',              count(*) FROM client_users              WHERE client_id = 'nomada'
  UNION ALL SELECT 'pos_staff',                 count(*) FROM pos_staff                 WHERE client_id = 'nomada'
  UNION ALL SELECT 'pos_payment_methods',       count(*) FROM pos_payment_methods       WHERE client_id = 'nomada'
  UNION ALL SELECT 'pos_menu_categories',       count(*) FROM pos_menu_categories       WHERE client_id = 'nomada'
  UNION ALL SELECT 'pos_menu_items',            count(*) FROM pos_menu_items            WHERE client_id = 'nomada'
  UNION ALL SELECT 'pos_modifier_groups',       count(*) FROM pos_modifier_groups       WHERE client_id = 'nomada'
  UNION ALL SELECT 'pos_modifiers',             count(*) FROM pos_modifiers             WHERE client_id = 'nomada'
  UNION ALL SELECT 'pos_item_modifier_groups',  count(*) FROM pos_item_modifier_groups  WHERE client_id = 'nomada'
  UNION ALL SELECT 'pos_ingredients',           count(*) FROM pos_ingredients           WHERE client_id = 'nomada'
  UNION ALL SELECT 'pos_recipe_versions',       count(*) FROM pos_recipe_versions       WHERE client_id = 'nomada'
  UNION ALL SELECT 'pos_recipe_lines',          count(*) FROM pos_recipe_lines          WHERE client_id = 'nomada'
  UNION ALL SELECT 'pos_orders',                count(*) FROM pos_orders                WHERE client_id = 'nomada'
  UNION ALL SELECT 'pos_cierres',               count(*) FROM pos_cierres               WHERE client_id = 'nomada'
  UNION ALL SELECT 'pos_turnos',                count(*) FROM pos_turnos                WHERE client_id = 'nomada'
  UNION ALL SELECT 'pos_cash_movements',        count(*) FROM pos_cash_movements        WHERE client_id = 'nomada'
  UNION ALL SELECT 'pos_gastos',                count(*) FROM pos_gastos                WHERE client_id = 'nomada'
  UNION ALL SELECT 'pos_facturas',              count(*) FROM pos_facturas              WHERE client_id = 'nomada'
  UNION ALL SELECT 'pos_inventory',             count(*) FROM pos_inventory             WHERE client_id = 'nomada'
  UNION ALL SELECT 'pos_purchase_orders',       count(*) FROM pos_purchase_orders       WHERE client_id = 'nomada'
  UNION ALL SELECT 'pos_customers',             count(*) FROM pos_customers             WHERE client_id = 'nomada'
  UNION ALL SELECT 'agent_runs',                count(*) FROM agent_runs                WHERE client_id = 'nomada'
  UNION ALL SELECT 'delivery_orders',           count(*) FROM delivery_orders           WHERE client_id = 'nomada'
  UNION ALL SELECT 'integration_store_mappings',count(*) FROM integration_store_mappings WHERE client_id = 'nomada'
) t
ORDER BY ok ASC, tabla;
