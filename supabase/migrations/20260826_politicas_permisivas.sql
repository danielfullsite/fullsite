-- Cerrar las políticas RLS que dejan a CUALQUIER usuario con sesión leer o escribir
-- toda la tabla, sin importar de qué restaurante sea.
--
-- ESTADO: APLICADA en producción el 2026-08-26 con el nombre
-- `cerrar_politicas_permisivas_authenticated`, autorizada por Daniel. Los DROP llevan
-- IF EXISTS y los CREATE son de políticas nuevas, así que re-aplicarla no truena.
--
-- Efecto medido por impersonación, mismo usuario de `boruca`, misma consulta:
--
--   tabla                        antes → después
--   amalay_reservaciones            23 → 0
--   content                        258 → 0
--   parity_reports                  56 → 0
--   tasks                          505 → 0
--   wansoft_catalog                212 → 0
--   client_locations                 4 → 0   (boruca no tiene ubicación propia)
--   pos_sub_recipe_ingredients     690 → 0   (las 690 son de AMALAY)
--
-- Y el acceso legítimo sigue: un usuario con acceso a 6 tenants ve sus 3 ubicaciones
-- (las de sus tenants que tienen una) y las 690 líneas de receta de AMALAY. Ni de más
-- ni de menos.
--
-- CONTEXTO. Un `USING (true)` para el rol `authenticated` no distingue tenants: basta
-- tener cuenta en cualquier restaurante para ver las filas de todos. Es la misma clase
-- de fuga que las 10 vistas OCM (migración 20260826_cerrar_vistas_ocm.sql), pero en
-- tablas.
--
-- LO QUE **NO** ES UN PROBLEMA, para que nadie pierda tiempo ahí: hay ~90 políticas
-- `USING (true)` para el rol `service_role`. Ésas son irrelevantes — service_role
-- ignora RLS por diseño, así que la política ni se evalúa. Sólo importan las de
-- `authenticated`, que son 17 sobre 15 tablas.
--
-- HALLAZGO QUE CAMBIA EL PLAN: 14 de esas 15 tablas **no tienen columna de tenant**.
-- No se puede acotar por restaurante una tabla que no sabe a qué restaurante
-- pertenece. Así que el arreglo no es uno solo, son tres, según lo que cada tabla
-- permita — y tres tablas quedan fuera porque necesitan cambio de esquema, no de
-- política.
--
-- Medido el 2026-08-26 contra producción, read-only, antes de escribir esto.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- GRUPO A — quitar la política: nadie lee estas tablas con sesión de usuario
-- ─────────────────────────────────────────────────────────────────────────────
-- Verificado por barrido en TODO el repositorio (dashboard-app/src, .github/scripts,
-- electron-app, los HTML sueltos): cero consumidores. Los 63 scripts de Actions usan
-- SUPABASE_SERVICE_KEY, que ignora RLS, así que quitar una política de `authenticated`
-- no puede afectarlos.

DROP POLICY IF EXISTS "authread_amalay_reservaciones" ON public.amalay_reservaciones; -- 23 filas
DROP POLICY IF EXISTS "authread_content"              ON public.content;               -- 258 filas
DROP POLICY IF EXISTS "parity_select_authenticated"   ON public.parity_reports;        -- 56 filas
DROP POLICY IF EXISTS "anon_select"                   ON public.tasks;                 -- 505 filas
DROP POLICY IF EXISTS "Allow read"                    ON public.wansoft_catalog;       -- 212 filas

-- ─────────────────────────────────────────────────────────────────────────────
-- GRUPO B — acotar de verdad por tenant
-- ─────────────────────────────────────────────────────────────────────────────
-- client_locations tiene su propio client_id. Las otras dos no, pero heredan del
-- padre: pos_sub_recipes y pos_purchase_orders sí lo tienen. Todas las columnas
-- involucradas son `text`, igual que el argumento de private.user_has_client_access.

DROP POLICY IF EXISTS "Authenticated read" ON public.client_locations;
CREATE POLICY "client_locations_por_tenant" ON public.client_locations
  FOR SELECT TO authenticated
  USING (private.user_has_client_access(client_id));

-- Los ingredientes de una sub-receta son costos: saber qué lleva un platillo y cuánto
-- rinde es información competitiva del restaurante.
DROP POLICY IF EXISTS "authread_pos_sub_recipe_ingredients" ON public.pos_sub_recipe_ingredients;
CREATE POLICY "pos_sub_recipe_ingredients_por_tenant" ON public.pos_sub_recipe_ingredients
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.pos_sub_recipes sr
    WHERE sr.id = pos_sub_recipe_ingredients.sub_recipe_id
      AND private.user_has_client_access(sr.client_id)
  ));

-- Las partidas de una orden de compra traen proveedor, cantidades y costo unitario.
DROP POLICY IF EXISTS "authread_pos_purchase_order_items" ON public.pos_purchase_order_items;
CREATE POLICY "pos_purchase_order_items_por_tenant" ON public.pos_purchase_order_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.pos_purchase_orders po
    WHERE po.id = pos_purchase_order_items.order_id
      AND private.user_has_client_access(po.client_id)
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- GRUPO C — quitar la ESCRITURA, que es lo peor de la lista
-- ─────────────────────────────────────────────────────────────────────────────
-- wansoft_waiter_categories tenía `FOR ALL ... USING (true) WITH CHECK (true)` para
-- authenticated: cualquier usuario con sesión podía INSERT, UPDATE y DELETE la tabla
-- completa. Era la única política de escritura abierta a `authenticated` en todo el
-- esquema.
--
-- No tiene columna de tenant, así que no se puede acotar la lectura. Pero quitar la
-- escritura es una mejora estricta y no rompe a nadie: su único consumidor
-- (dashboard-app/src/lib/data.ts:221) filtra por `client_slug`, una columna que NO
-- EXISTE en esta tabla — sus columnas son fecha, data, items_count, updated_at. O sea
-- que esa consulta ya devolvía 400 y el código estaba muerto desde antes.

DROP POLICY IF EXISTS "authenticated_all" ON public.wansoft_waiter_categories;
CREATE POLICY "wansoft_waiter_categories_solo_lectura" ON public.wansoft_waiter_categories
  FOR SELECT TO authenticated
  USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- LO QUE SE QUEDA IGUAL, y por qué — para que nadie lo "arregle" sin leer
-- ─────────────────────────────────────────────────────────────────────────────
--
-- platform_settings · feature_flags
--   Configuración global de verdad, no datos de restaurante. Las llaves son
--   `announcement` y `support_url`; y `new_pos_ui`, `online_ordering`, `ds_v3`.
--   Verificado leyendo las llaves. Que todo usuario con sesión las lea está bien.
--
-- events
--   El POS inserta desde el navegador (lib/events.ts, "shadow-mode"). Quitar el
--   INSERT lo rompe. No tiene columna de tenant, pero sí `actor`; acotar por actor es
--   posible y es el siguiente paso natural. Se deja porque pos/page.tsx lo está
--   tocando otra sesión ahora mismo y no se pisan cambios ajenos.
--
-- reviews
--   5 filas, sin columna de tenant. La consume una herramienta interna fuera de
--   dashboard-app (fullsite-web/dashboard.html) que no se puede probar desde aquí.
--   Romper una herramienta que no puedo verificar es peor que el riesgo de 5 filas.
--
-- agent_runs (9,710 filas) · wansoft_kpis (1 fila)
--   SIN columna de tenant y CON consumidores reales en el cliente. Aquí RLS no puede
--   hacer nada: se necesita agregar la columna y rellenarla, que es migración de datos,
--   no de política. Queda anotado como el siguiente trabajo de verdad.
--   (wansoft_kpis además está congelada desde hace 71 días y es de una sola fila.)

-- ─────────────────────────────────────────────────────────────────────────────
-- REVERSA EXACTA — restaura el estado previo tal cual estaba
-- ─────────────────────────────────────────────────────────────────────────────
--
-- DROP POLICY IF EXISTS "client_locations_por_tenant" ON public.client_locations;
-- DROP POLICY IF EXISTS "pos_sub_recipe_ingredients_por_tenant" ON public.pos_sub_recipe_ingredients;
-- DROP POLICY IF EXISTS "pos_purchase_order_items_por_tenant" ON public.pos_purchase_order_items;
-- DROP POLICY IF EXISTS "wansoft_waiter_categories_solo_lectura" ON public.wansoft_waiter_categories;
--
-- CREATE POLICY "authread_amalay_reservaciones" ON public.amalay_reservaciones
--   FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "authread_content" ON public.content
--   FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "parity_select_authenticated" ON public.parity_reports
--   FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "anon_select" ON public.tasks
--   FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "Allow read" ON public.wansoft_catalog
--   FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "Authenticated read" ON public.client_locations
--   FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "authread_pos_sub_recipe_ingredients" ON public.pos_sub_recipe_ingredients
--   FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "authread_pos_purchase_order_items" ON public.pos_purchase_order_items
--   FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "authenticated_all" ON public.wansoft_waiter_categories
--   FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN — tiene que devolver CERO filas
-- ─────────────────────────────────────────────────────────────────────────────
--
-- SELECT tablename, policyname, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND roles::text = '{authenticated}'
--   AND (qual = 'true' OR with_check = 'true')
--   AND tablename NOT IN (
--     'platform_settings', 'feature_flags',   -- configuración global, a propósito
--     'events', 'reviews',                    -- documentadas arriba
--     'agent_runs', 'wansoft_kpis',           -- necesitan columna de tenant
--     'wansoft_waiter_categories'             -- lectura abierta a propósito, sin escritura
--   );
--
-- Y que no quede NINGUNA política de ESCRITURA abierta para authenticated,
-- salvo la de events. También cero filas:
--
-- SELECT tablename, policyname, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public' AND roles::text = '{authenticated}'
--   AND cmd IN ('ALL','INSERT','UPDATE','DELETE')
--   AND with_check = 'true'
--   AND tablename <> 'events';
