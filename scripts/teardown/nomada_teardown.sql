-- PAE Café Nómada — teardown completo
-- Elimina TODOS los datos de client_id='nomada' en orden FK-safe.
-- Ejecutar con service_role (bypassa RLS para limpieza completa).
-- Seguir con nomada_verify_clean.sql para confirmar.
--
-- POLÍTICA PAE: nunca reparar datos corruptos de nomada manualmente.
-- Si hay corrupción, teardown + re-provision.

BEGIN;

-- 1. Tablas hoja (sin dependencias downstream)
DELETE FROM pos_recipe_lines          WHERE client_id = 'nomada';
DELETE FROM pos_item_modifier_groups  WHERE client_id = 'nomada';

-- 2. Tablas intermedias
DELETE FROM pos_recipe_versions       WHERE client_id = 'nomada';
DELETE FROM pos_modifiers             WHERE client_id = 'nomada';
DELETE FROM pos_modifier_groups       WHERE client_id = 'nomada';

-- 3. Catálogo
DELETE FROM pos_menu_items            WHERE client_id = 'nomada';
DELETE FROM pos_menu_categories       WHERE client_id = 'nomada';
DELETE FROM pos_ingredients           WHERE client_id = 'nomada';
DELETE FROM pos_payment_methods       WHERE client_id = 'nomada';
DELETE FROM pos_staff                 WHERE client_id = 'nomada';

-- 4. Tablas transaccionales (vacías post-seed, incluidas para teardown post-smoke)
DELETE FROM pos_recipe_lines          WHERE client_id = 'nomada';  -- re-check
DELETE FROM pos_recipes               WHERE client_id = 'nomada';
DELETE FROM pos_orders                WHERE client_id = 'nomada';
DELETE FROM pos_cierres               WHERE client_id = 'nomada';
DELETE FROM pos_turnos                WHERE client_id = 'nomada';
DELETE FROM pos_cash_movements        WHERE client_id = 'nomada';
DELETE FROM pos_gastos                WHERE client_id = 'nomada';
DELETE FROM pos_facturas              WHERE client_id = 'nomada';
DELETE FROM pos_cfdi_requests         WHERE client_id = 'nomada';
DELETE FROM pos_print_jobs            WHERE client_id = 'nomada';
DELETE FROM pos_audit_log             WHERE client_id = 'nomada';
DELETE FROM pos_inventory             WHERE client_id = 'nomada';
DELETE FROM pos_inventory_movements   WHERE client_id = 'nomada';
DELETE FROM pos_purchase_orders       WHERE client_id = 'nomada';
DELETE FROM pos_purchase_order_items  WHERE client_id = 'nomada';
DELETE FROM pos_customers             WHERE client_id = 'nomada';
DELETE FROM pos_staff_shifts          WHERE client_id = 'nomada';
DELETE FROM pos_schedules             WHERE client_id = 'nomada';
DELETE FROM pos_promotions            WHERE client_id = 'nomada';
DELETE FROM delivery_orders           WHERE client_id = 'nomada';
DELETE FROM agent_runs                WHERE client_id = 'nomada';
DELETE FROM agent_events              WHERE client_id = 'nomada';
DELETE FROM integration_store_mappings WHERE client_id = 'nomada';
DELETE FROM integration_webhook_events WHERE client_id = 'nomada';
DELETE FROM integration_audit_log     WHERE client_id = 'nomada';

-- 5. Auth links (si existen — F1 los crea)
DELETE FROM client_users              WHERE client_id = 'nomada';

-- 6. Fila raíz del tenant
DELETE FROM clients                   WHERE id = 'nomada';

COMMIT;

\echo 'Teardown nomada completado. Ejecutar nomada_verify_clean.sql para confirmar.'
