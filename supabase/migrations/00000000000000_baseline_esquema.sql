-- Preámbulo del baseline — los roles que el volcado necesita pero no trae.
--
-- `pg_dump` NO vuelca roles: son objetos del clúster, no de la base. El baseline
-- generado hace 342 `GRANT` a `fullsite_readonly` y `fullsite_agent`, así que
-- aplicado a un proyecto nuevo truena en el primero:
--
--     ERROR: role "fullsite_readonly" does not exist
--
-- Eso hacía que el baseline no sirviera para lo único que existe: construir una base
-- de Fullsite desde el repositorio. Los roles sí estaban definidos —en
-- `.github/migrations/001_create_readonly_role.sql`— pero fuera de
-- `supabase/migrations/`, así que nunca corrían antes.
--
-- Este archivo se antepone al volcado al generar el baseline
-- (ver `.github/workflows/esquema-baseline.yml`). No se aplica solo: vive dentro del
-- baseline, arriba de todo, para que el orden esté garantizado por construcción y no
-- por el nombre del archivo.
--
-- Sólo crea los roles. Los permisos NO van aquí: los trae el volcado, que es la
-- fuente fiel de lo que hay en producción. Duplicarlos aquí sería inventar una
-- segunda verdad que se desincroniza en silencio.
--
-- Idempotente. En una base que ya los tiene, no hace nada.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fullsite_readonly') THEN
    CREATE ROLE fullsite_readonly NOINHERIT LOGIN;
    RAISE NOTICE 'Creado el rol fullsite_readonly';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fullsite_agent') THEN
    CREATE ROLE fullsite_agent NOINHERIT LOGIN;
    RAISE NOTICE 'Creado el rol fullsite_agent';
  END IF;
END
$$;

-- Sin contraseña a propósito. `LOGIN` sin contraseña no puede autenticarse: el rol
-- existe para recibir los `GRANT` del volcado, y quien lo necesite para conectarse le
-- pone contraseña aparte, fuera del repositorio.




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "private"."can_write_client"("p_client_id" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_role text;
begin
  v_role := coalesce(
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'role',
    ''
  );
  if v_role = 'service_role' then
    return true;
  end if;
  return private.user_has_client_access(p_client_id);
end;
$$;


ALTER FUNCTION "private"."can_write_client"("p_client_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."pos_terminal_client_id"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL                                                   THEN NULL
    WHEN (auth.jwt()->'app_metadata'->>'actor') IS DISTINCT FROM 'pos_terminal' THEN NULL
    WHEN COALESCE(auth.jwt()->'app_metadata'->>'terminal_id', '') = ''        THEN NULL
    WHEN COALESCE(auth.jwt()->'app_metadata'->>'client_id',   '') = ''        THEN NULL
    ELSE auth.jwt()->'app_metadata'->>'client_id'
  END;
$$;


ALTER FUNCTION "private"."pos_terminal_client_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."user_has_client_access"("target_client_id" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL                 THEN false
    WHEN target_client_id IS NULL           THEN false
    WHEN target_client_id = ''              THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.user_id = auth.uid() AND cu.client_id = target_client_id
    )
  END;
$$;


ALTER FUNCTION "private"."user_has_client_access"("target_client_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."activate_recipe_version"("p_client_id" "text", "p_menu_item_id" "text", "p_new_version" integer, "p_actor" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$ DECLARE v_target_row pos_recipe_versions%ROWTYPE; v_rows_activated int; v_active_count int; BEGIN PERFORM 1 FROM pos_menu_items WHERE client_id = p_client_id AND id = p_menu_item_id FOR UPDATE; SELECT * INTO v_target_row FROM pos_recipe_versions WHERE client_id = p_client_id AND menu_item_id = p_menu_item_id AND version = p_new_version; IF v_target_row.id IS NULL THEN RAISE EXCEPTION 'Version % does not exist for item % in client %', p_new_version, p_menu_item_id, p_client_id; END IF; UPDATE pos_recipe_versions SET active = false, deactivated_at = now(), deactivated_by = p_actor WHERE client_id = p_client_id AND menu_item_id = p_menu_item_id AND active = true; UPDATE pos_recipe_versions SET active = true, activated_at = now(), activated_by = p_actor WHERE id = v_target_row.id; GET DIAGNOSTICS v_rows_activated = ROW_COUNT; IF v_rows_activated != 1 THEN RAISE EXCEPTION 'Expected 1 row activated, got %', v_rows_activated; END IF; SELECT count(*) INTO v_active_count FROM pos_recipe_versions WHERE client_id = p_client_id AND menu_item_id = p_menu_item_id AND active = true; IF v_active_count != 1 THEN RAISE EXCEPTION 'Expected exactly 1 active version, found %', v_active_count; END IF; END; $$;


ALTER FUNCTION "public"."activate_recipe_version"("p_client_id" "text", "p_menu_item_id" "text", "p_new_version" integer, "p_actor" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_stale_pending_reservations"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  UPDATE public.amalay_reservaciones
  SET status = 'cancelled',
      notas = COALESCE(notas, '') || ' [auto-cancelada: pending >2h sin anticipo]'
  WHERE status = 'pending'
    AND created_at < NOW() - INTERVAL '2 hours';
END;
$$;


ALTER FUNCTION "public"."cancel_stale_pending_reservations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."convert_recipe_to_stock"("p_quantity" numeric, "p_recipe_unit" "text", "p_stock_unit" "text") RETURNS numeric
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
BEGIN
  IF p_quantity IS NULL OR p_recipe_unit IS NULL OR p_stock_unit IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_recipe_unit = p_stock_unit THEN
    RETURN p_quantity;
  END IF;

  IF p_recipe_unit = 'g'  AND p_stock_unit = 'kg' THEN RETURN p_quantity / 1000; END IF;
  IF p_recipe_unit = 'kg' AND p_stock_unit = 'g'  THEN RETURN p_quantity * 1000; END IF;
  IF p_recipe_unit = 'ml' AND p_stock_unit = 'lt' THEN RETURN p_quantity / 1000; END IF;
  IF p_recipe_unit = 'lt' AND p_stock_unit = 'ml' THEN RETURN p_quantity * 1000; END IF;

  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."convert_recipe_to_stock"("p_quantity" numeric, "p_recipe_unit" "text", "p_stock_unit" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_default_inventory_policy_on_menu_item"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_data_source text;
BEGIN
  SELECT data_source INTO v_data_source FROM clients WHERE id = NEW.client_id;
  IF v_data_source = 'fullsite' THEN
    INSERT INTO pos_item_inventory_policy
      (client_id, menu_item_id, inventory_mode, approved_by, approved_at)
    VALUES (NEW.client_id, NEW.id, 'non_inventory', 'auto_trigger', now())
    ON CONFLICT (client_id, menu_item_id) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;


ALTER FUNCTION "public"."fn_default_inventory_policy_on_menu_item"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."gen_codigo_reserva"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  candidate TEXT;
BEGIN
  IF NEW.codigo_reserva IS NULL THEN
    LOOP
      candidate := 'AMA-' || LPAD(floor(random() * 10000)::INT::TEXT, 4, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.amalay_reservaciones
        WHERE codigo_reserva = candidate
      );
    END LOOP;
    NEW.codigo_reserva := candidate;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."gen_codigo_reserva"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_platform_admin"("p_email" "text" DEFAULT NULL::"text", "p_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.active
      and ( (p_email is not null and lower(pa.email) = lower(p_email))
         or (p_user_id is not null and pa.user_id = p_user_id) )
  );
$$;


ALTER FUNCTION "public"."is_platform_admin"("p_email" "text", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."platform_audit_log_immutable"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$ begin raise exception 'platform_audit_log es append-only (inmutable): % no permitido', tg_op; end $$;


ALTER FUNCTION "public"."platform_audit_log_immutable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."r1_add_items"("p_client_id" "text", "p_order_id" "text", "p_items" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_new_revision bigint;
BEGIN
  IF COALESCE(jsonb_typeof(p_items), '') != 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ITEMS_MUST_BE_NONEMPTY_ARRAY');
  END IF;

  UPDATE pos_orders AS o
  SET
    items = COALESCE(o.items, '[]'::jsonb) || (
      SELECT COALESCE(jsonb_agg(new_item), '[]'::jsonb)
      FROM (
        SELECT DISTINCT ON (new_item->>'id') new_item
        FROM   jsonb_array_elements(p_items) new_item
        WHERE  new_item->>'id' IS NOT NULL
        ORDER  BY new_item->>'id'
      ) deduped
      WHERE NOT EXISTS (
        SELECT 1
        FROM   jsonb_array_elements(COALESCE(o.items, '[]'::jsonb)) existing_item
        WHERE  existing_item->>'id' = deduped.new_item->>'id'
      )
    ),
    order_revision = o.order_revision + 1,
    updated_at     = now(),
    status         = CASE WHEN o.status = 'abierta' THEN 'enviada' ELSE o.status END
  WHERE o.id        = p_order_id
    AND o.client_id = p_client_id
    AND o.status NOT IN ('cerrada', 'cancelada', 'void')
  RETURNING order_revision INTO v_new_revision;

  IF v_new_revision IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORDER_CLOSED_OR_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object(
    'ok',        true,
    'revision',  v_new_revision,
    'requested', jsonb_array_length(p_items)
  );
END;
$$;


ALTER FUNCTION "public"."r1_add_items"("p_client_id" "text", "p_order_id" "text", "p_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."r1_adjust_market_stock"("p_client_id" "text", "p_menu_item_id" "text", "p_adjustment_type" "text", "p_quantity" numeric, "p_actor" "text", "p_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_delta numeric;
  v_current numeric;
  v_new_stock numeric;
  v_updated int;
BEGIN
  IF p_adjustment_type NOT IN ('entrada', 'merma', 'ajuste_absoluto') THEN
    RAISE EXCEPTION 'Invalid adjustment type: %', p_adjustment_type;
  END IF;

  IF p_adjustment_type = 'entrada' THEN
    v_delta := abs(p_quantity);
    UPDATE pos_market_stock
    SET stock = stock + v_delta, updated_at = now()
    WHERE client_id = p_client_id AND menu_item_id = p_menu_item_id
    RETURNING stock INTO v_new_stock;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      INSERT INTO pos_market_stock (client_id, menu_item_id, stock, updated_at)
      VALUES (p_client_id, p_menu_item_id, v_delta, now())
      RETURNING stock INTO v_new_stock;
    END IF;

  ELSIF p_adjustment_type = 'merma' THEN
    v_delta := -abs(p_quantity);
    UPDATE pos_market_stock
    SET stock = stock + v_delta, updated_at = now()
    WHERE client_id = p_client_id AND menu_item_id = p_menu_item_id
    RETURNING stock INTO v_new_stock;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      RAISE EXCEPTION 'Item % not found for merma', p_menu_item_id;
    END IF;

  ELSIF p_adjustment_type = 'ajuste_absoluto' THEN
    SELECT stock INTO v_current FROM pos_market_stock
    WHERE client_id = p_client_id AND menu_item_id = p_menu_item_id
    FOR UPDATE;

    IF NOT FOUND THEN
      v_current := 0;
      v_delta := p_quantity;
      v_new_stock := p_quantity;
      INSERT INTO pos_market_stock (client_id, menu_item_id, stock, updated_at)
      VALUES (p_client_id, p_menu_item_id, p_quantity, now());
    ELSE
      v_delta := p_quantity - v_current;
      v_new_stock := p_quantity;
      UPDATE pos_market_stock
      SET stock = p_quantity, updated_at = now()
      WHERE client_id = p_client_id AND menu_item_id = p_menu_item_id;
    END IF;
  END IF;

  INSERT INTO pos_market_movements
    (client_id, menu_item_id, movement_type, quantity, actor, notes)
  VALUES (p_client_id, p_menu_item_id, p_adjustment_type, v_delta, p_actor,
    COALESCE(p_notes, p_adjustment_type));

  RETURN jsonb_build_object('ok', true, 'new_stock', v_new_stock, 'delta', v_delta);
END;
$$;


ALTER FUNCTION "public"."r1_adjust_market_stock"("p_client_id" "text", "p_menu_item_id" "text", "p_adjustment_type" "text", "p_quantity" numeric, "p_actor" "text", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."r1_legacy_sale_deduction"("p_client_id" "text", "p_order_id" "text", "p_actor" "text", "p_items" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_authority text;
  v_item jsonb;
  v_mid text;
  v_qty numeric;
  v_current_stock numeric;
  v_new_stock numeric;
  v_deductions jsonb := '[]'::jsonb;
  v_updated int;
BEGIN
  -- 1. Acquire authority FOR SHARE (participates in serialized transition protocol)
  SELECT sale_authority INTO v_authority
  FROM pos_mutation_authority
  WHERE client_id = p_client_id
  FOR SHARE;

  IF v_authority IS NULL OR v_authority != 'legacy' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'AUTHORITY_NOT_LEGACY',
      'current_authority', COALESCE(v_authority, 'none'));
  END IF;

  -- 2. Process each item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_mid := v_item->>'menu_item_id';
    v_qty := (v_item->>'cantidad')::numeric;

    IF v_mid IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;

    -- Atomic stock decrement (no clamp — allows negative)
    UPDATE pos_market_stock
    SET stock = stock - v_qty, updated_at = now()
    WHERE client_id = p_client_id AND menu_item_id = v_mid
    RETURNING stock INTO v_new_stock;

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated = 1 THEN
      -- Movement provenance
      INSERT INTO pos_market_movements
        (client_id, menu_item_id, movement_type, quantity, order_id, actor, notes)
      VALUES
        (p_client_id, v_mid, 'venta', -v_qty, p_order_id, p_actor,
         'legacy_sale_rpc');

      v_deductions := v_deductions || jsonb_build_object(
        'menu_item_id', v_mid, 'cantidad', v_qty, 'new_stock', v_new_stock);
    END IF;
    -- If item not in pos_market_stock, skip silently (matches legacy behavior)
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'deductions', v_deductions);
END;
$$;


ALTER FUNCTION "public"."r1_legacy_sale_deduction"("p_client_id" "text", "p_order_id" "text", "p_actor" "text", "p_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."r1_merge_orders"("p_client_id" "text", "p_target_order_id" "text", "p_target_expected_revision" bigint, "p_source_order_id" "text", "p_source_expected_revision" bigint, "p_merged_items" "jsonb", "p_total" numeric, "p_subtotal" numeric, "p_iva" numeric, "p_personas" integer, "p_notas" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_tgt RECORD;
  v_src RECORD;
  v_tgt_new_rev bigint;
  v_src_new_rev bigint;
BEGIN
  -- Lock BOTH orders in deterministic key order (alphabetical by id)
  IF p_target_order_id < p_source_order_id THEN
    SELECT * INTO v_tgt FROM pos_orders WHERE id = p_target_order_id AND client_id = p_client_id FOR UPDATE;
    SELECT * INTO v_src FROM pos_orders WHERE id = p_source_order_id AND client_id = p_client_id FOR UPDATE;
  ELSE
    SELECT * INTO v_src FROM pos_orders WHERE id = p_source_order_id AND client_id = p_client_id FOR UPDATE;
    SELECT * INTO v_tgt FROM pos_orders WHERE id = p_target_order_id AND client_id = p_client_id FOR UPDATE;
  END IF;

  IF v_tgt IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TARGET_NOT_FOUND');
  END IF;
  IF v_src IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SOURCE_NOT_FOUND');
  END IF;

  -- Validate both revisions
  IF v_tgt.order_revision != p_target_expected_revision THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STALE_WRITE_REJECTED',
      'stale_order', 'target', 'expected', p_target_expected_revision, 'current', v_tgt.order_revision);
  END IF;
  IF v_src.order_revision != p_source_expected_revision THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STALE_WRITE_REJECTED',
      'stale_order', 'source', 'expected', p_source_expected_revision, 'current', v_src.order_revision);
  END IF;

  -- Atomic target update: merged items + revision
  UPDATE pos_orders SET
    items = p_merged_items,
    total = p_total, subtotal = p_subtotal, iva = p_iva,
    personas = p_personas,
    notas = p_notas,
    order_revision = order_revision + 1
  WHERE id = p_target_order_id AND client_id = p_client_id
  RETURNING order_revision INTO v_tgt_new_rev;

  -- Atomic source cancellation + revision
  UPDATE pos_orders SET
    status = 'cancelada',
    notas = 'Merged to order ' || p_target_order_id,
    order_revision = order_revision + 1
  WHERE id = p_source_order_id AND client_id = p_client_id
  RETURNING order_revision INTO v_src_new_rev;

  RETURN jsonb_build_object('ok', true,
    'target_revision', v_tgt_new_rev,
    'source_revision', v_src_new_rev);
END;
$$;


ALTER FUNCTION "public"."r1_merge_orders"("p_client_id" "text", "p_target_order_id" "text", "p_target_expected_revision" bigint, "p_source_order_id" "text", "p_source_expected_revision" bigint, "p_merged_items" "jsonb", "p_total" numeric, "p_subtotal" numeric, "p_iva" numeric, "p_personas" integer, "p_notas" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."r1_observation_sample"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$                                                                                                                                                                                                      
  DECLARE                                                                                                                                                                                                      
    v_bl r1_observation_baseline;                                                                                                                                                                              
    v_pending int;                                                                                                                                                                                             
    v_pending_age int;                                                                                                                                                                                       
    v_blocked int;                      
    v_blocked_set jsonb;
    v_dup int;                                                                                                                                                                                                 
    v_lineage int;                                                              
    v_neg_inv int;                                                                                                                                                                                             
    v_neg_inv_set jsonb;                                                                                                                                                                                     
    v_neg_mkt int;                                                                                                                                                                                             
    v_neg_mkt_set jsonb;                
    v_corruption int;                                                                                                                                                                                          
    v_rejected int;                                                                                                                                                                                            
    v_unexpected_rej int;                                                      
    v_status text := 'PASS';                                                                                                                                                                                   
  BEGIN                                                                                                                                                                                                      
    SELECT * INTO v_bl                                                         
    FROM r1_observation_baseline                                                                                                                                                                               
    WHERE id = 'obs-48h-20260715';      
    IF v_bl IS NULL THEN RETURN; END IF;                                                                                                                                                                       
    IF now() > v_bl.ends_at THEN RETURN; END IF;                                                                                                                                                               
                                                                                
    SELECT count(*),                                                                                                                                                                                           
      COALESCE(extract(epoch FROM                                                                                                                                                                            
        (now() - min(o.updated_at)))::int, 0)                                                                                                                                                                  
    INTO v_pending, v_pending_age                                               
    FROM pos_orders o                                                                                                                                                                                          
    WHERE o.client_id='amalay'                                                                                                                                                                               
      AND o.status NOT IN                                                                                                                                                                                      
        ('cerrada','cancelada','anulada')                                       
      AND (o.last_inventory_processed_revision                                                                                                                                                                 
             IS NULL                                                                                                                                                                                         
        OR o.last_inventory_processed_revision                                                                                                                                                                 
             < o.order_revision);                                                                                                                                                                            
                                                                                                                                                                                                               
    SELECT count(*), COALESCE(jsonb_agg(                                                                                                                                                                       
      jsonb_build_object(                                                                                                                                                                                      
        'order_id', order_id,                                                                                                                                                                                  
        'order_item_id', order_item_id,                                                                                                                                                                        
        'menu_item_id', menu_item_id,                                                                                                                                                                          
        'result', result                                                       
      )), '[]'::jsonb)                                                                                                                                                                                         
    INTO v_blocked, v_blocked_set                                                                                                                                                                            
    FROM pos_reconciliation_results
    WHERE client_id='amalay'                                                                                                                                                                                   
      AND result LIKE 'BLOCKED%';                                               
                                                                                                                                                                                                               
    SELECT count(*) INTO v_dup FROM (                                                                                                                                                                        
      SELECT order_id, order_item_id                                                                                                                                                                           
      FROM pos_reconciliation_results   
      WHERE client_id='amalay'                                                                                                                                                                                 
      GROUP BY order_id, order_item_id                                                                                                                                                                         
      HAVING count(*) > 1) d;                                                  
                                                                                                                                                                                                               
    SELECT count(*) INTO v_lineage                                                                                                                                                                           
    FROM pos_orders
    WHERE client_id='amalay'                                                                                                                                                                                   
      AND last_inventory_processed_revision
            IS NOT NULL                                                                                                                                                                                        
      AND (last_inventory_complete_revision                                                                                                                                                                  
             > last_inventory_processed_revision
        OR last_inventory_processed_revision
             > order_revision);                                                                                                                                                                                
                                                                                
    SELECT count(*), COALESCE(jsonb_agg(                                                                                                                                                                       
      jsonb_build_object(                                                                                                                                                                                    
        'ingredient_id', ingredient_id,                                                                                                                                                                        
        'stock', stock                                                          
      )), '[]'::jsonb)                                                                                                                                                                                         
    INTO v_neg_inv, v_neg_inv_set                                                                                                                                                                            
    FROM pos_inventory                                                                                                                                                                                         
    WHERE client_id='amalay' AND stock < 0;
                                                                                                                                                                                                               
    SELECT count(*), COALESCE(jsonb_agg(                                                                                                                                                                     
      jsonb_build_object(               
        'menu_item_id', menu_item_id,
        'stock', stock                                                                                                                                                                                         
      )), '[]'::jsonb)                                                          
    INTO v_neg_mkt, v_neg_mkt_set                                                                                                                                                                              
    FROM pos_market_stock                                                                                                                                                                                    
    WHERE client_id='amalay' AND stock < 0;                                                                                                                                                                    
                                                                               
    SELECT count(*) INTO v_corruption                                                                                                                                                                          
    FROM pos_save_operations                                                                                                                                                                                 
    WHERE client_id='amalay'
      AND rejection_detail                                                                                                                                                                                     
          ='PAYLOAD_IDENTITY_CORRUPTION';                                      
                                                                                                                                                                                                               
    SELECT count(*) INTO v_rejected                                                                                                                                                                          
    FROM pos_save_operations
    WHERE client_id='amalay'                                                                                                                                                                                   
      AND state='REJECTED';                                                     
                                                                                                                                                                                                               
    v_unexpected_rej := GREATEST(                                                                                                                                                                            
      0, v_rejected - v_bl.rejected_ops_count);                                                                                                                                                                
                                                                               
    IF v_pending > 0 AND v_pending_age > 7200 THEN                                                                                                                                                             
      v_status := 'ALERT: pending >2h';                                                                                                                                                                        
    END IF;                                                                    
    IF v_dup > v_bl.dup_mutation_count THEN                                                                                                                                                                    
      v_status := 'ALERT: dup mutation';                                                                                                                                                                     
    END IF;                                                                                                                                                                                                    
    IF v_lineage > v_bl.lineage_violation_count THEN                                                                                                                                                           
      v_status := 'ALERT: lineage violation';                                  
    END IF;                                                                                                                                                                                                    
    IF v_corruption > v_bl.payload_corruption_count                                                                                                                                                          
    THEN                                                                                                                                                                                                       
      v_status := 'ALERT: payload corruption';                                                                                                                                                                 
    END IF;                                                                     
    IF v_unexpected_rej > 0 THEN                                                                                                                                                                               
      IF EXISTS (                                                                                                                                                                                            
        SELECT 1 FROM pos_save_operations s                                                                                                                                                                    
        WHERE s.client_id='amalay'                                              
          AND s.state='REJECTED'                                                                                                                                                                               
          AND NOT EXISTS (                                                                                                                                                                                   
            SELECT 1 FROM jsonb_array_elements(                                                                                                                                                                
              v_bl.known_rejected_ops) k                                       
            WHERE k->>'save_operation_id'                                                                                                                                                                      
                  = s.save_operation_id                                                                                                                                                                      
              AND k->>'order_id' = s.order_id                                  
          )                                                                                                                                                                                                    
      ) THEN                            
        v_status := 'ALERT: unexpected rejection';                                                                                                                                                             
      END IF;                                                                                                                                                                                                  
    END IF;                                                                     
    IF v_blocked > v_bl.blocked_count THEN                                                                                                                                                                     
      IF EXISTS (                                                                                                                                                                                            
        SELECT 1 FROM pos_reconciliation_results r                                                                                                                                                             
        WHERE r.client_id='amalay'                                             
          AND r.result LIKE 'BLOCKED%'                                                                                                                                                                         
          AND NOT EXISTS (                                                                                                                                                                                   
            SELECT 1 FROM jsonb_array_elements(
              v_bl.blocked_set) b                                                                                                                                                                              
            WHERE b->>'order_item_id'                                           
                  = r.order_item_id                                                                                                                                                                            
              AND b->>'order_id' = r.order_id                                                                                                                                                                
          )                                                                                                                                                                                                    
      ) THEN                                                                    
        v_status := 'ALERT: new blocked item';                                                                                                                                                                 
      END IF;                                                                                                                                                                                                
    END IF;                                                                                                                                                                                                    
   
    INSERT INTO r1_observation_log (                                                                                                                                                                           
      checked_at, observation_id,                                                                                                                                                                            
      pending_count, pending_max_age_seconds,
      blocked_count, blocked_set,                                              
      dup_mutation_count,                                                                                                                                                                                      
      lineage_violation_count,                                                 
      neg_inventory_count, neg_inventory_set,                                                                                                                                                                  
      neg_market_count, neg_market_set,                                                                                                                                                                        
      payload_corruption_count,
      rejected_ops_count,                                                                                                                                                                                      
      unexpected_rejected_count,                                                                                                                                                                             
      legacy_sale_count, writer_bypass_count,                                                                                                                                                                  
      r0_caller_count, r0_5_caller_count,                                                                                                                                                                    
      observation_status                                                                                                                                                                                       
    ) VALUES (                                                                  
      now(), 'obs-48h-20260715',                                                                                                                                                                               
      v_pending, v_pending_age,                                                                                                                                                                              
      v_blocked, v_blocked_set,                                                                                                                                                                                
      v_dup, v_lineage,                                                        
      v_neg_inv, v_neg_inv_set,                                                                                                                                                                                
      v_neg_mkt, v_neg_mkt_set,                                                                                                                                                                              
      v_corruption,
      v_rejected, v_unexpected_rej,                                                                                                                                                                            
      0, 0, 0, 0,                                                               
      v_status                                                                                                                                                                                                 
    );                                                                                                                                                                                                       
  END;                                                                                                                                                                                                         
  $$;


ALTER FUNCTION "public"."r1_observation_sample"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."r1_reconcile_item"("p_client_id" "text", "p_order_id" "text", "p_item_id" "text", "p_menu_item_id" "text", "p_desired" numeric, "p_sale_authority" "text") RETURNS TABLE("r_item_id" "text", "r_result" "text", "r_applied" numeric, "r_delta" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_intent pos_reconciliation_results%ROWTYPE;
  v_mode text;
  v_recipe_version_id bigint;
  v_market_stock_id bigint;
  v_delta numeric;
  v_next_rev int;
  v_converted numeric;
  v_ing_delta numeric;
  v_plan_line RECORD;
  v_locked_count int;
  v_updated int;
BEGIN
  -- ═══ STEP 1: Idempotent intent creation + lock ═══
  INSERT INTO pos_reconciliation_results
    (client_id, order_id, order_item_id, menu_item_id, cantidad)
  VALUES (p_client_id, p_order_id, p_item_id, p_menu_item_id, p_desired)
  ON CONFLICT (client_id, order_id, order_item_id) DO NOTHING;

  SELECT * INTO v_intent FROM pos_reconciliation_results
  WHERE client_id = p_client_id AND order_id = p_order_id AND order_item_id = p_item_id
  FOR UPDATE;

  -- ═══ STEP 2: Identity corruption check ═══
  IF v_intent.menu_item_id != p_menu_item_id THEN
    RAISE EXCEPTION 'Identity corruption: intent menu_item_id=% but observed=%',
      v_intent.menu_item_id, p_menu_item_id;
  END IF;

  -- ═══ STEP 3: Resolve treatment ═══
  IF v_intent.pinned_mode IS NOT NULL THEN
    -- Use pinned (historical immutability)
    v_mode := v_intent.pinned_mode;
    v_recipe_version_id := v_intent.pinned_recipe_version_id;
    v_market_stock_id := v_intent.pinned_market_stock_id;
  ELSE
    -- First terminal decision: resolve from current policy
    SELECT inventory_mode, market_stock_id
    INTO v_mode, v_market_stock_id
    FROM pos_item_inventory_policy
    WHERE client_id = p_client_id AND menu_item_id = p_menu_item_id;

    IF v_mode IS NULL OR v_mode = 'unclassified' THEN
      UPDATE pos_reconciliation_results SET
        cantidad = p_desired, result = 'BLOCKED_UNCLASSIFIED', updated_at = now()
      WHERE id = v_intent.id;
      RETURN QUERY SELECT p_item_id, 'BLOCKED_UNCLASSIFIED'::text, v_intent.applied_consumption, 0::numeric;
      RETURN;
    END IF;

    IF v_mode = 'recipe' THEN
      SELECT id INTO v_recipe_version_id FROM pos_recipe_versions
      WHERE client_id = p_client_id AND menu_item_id = p_menu_item_id AND active = true;
      IF v_recipe_version_id IS NULL THEN
        UPDATE pos_reconciliation_results SET
          cantidad = p_desired, result = 'BLOCKED_RECIPE_MISSING', updated_at = now()
        WHERE id = v_intent.id;
        RETURN QUERY SELECT p_item_id, 'BLOCKED_RECIPE_MISSING'::text, v_intent.applied_consumption, 0::numeric;
        RETURN;
      END IF;
    END IF;

    IF v_mode = 'direct_stock' THEN
      IF v_market_stock_id IS NULL THEN
        UPDATE pos_reconciliation_results SET
          cantidad = p_desired, result = 'BLOCKED_TARGET_MISSING', updated_at = now()
        WHERE id = v_intent.id;
        RETURN QUERY SELECT p_item_id, 'BLOCKED_TARGET_MISSING'::text, v_intent.applied_consumption, 0::numeric;
        RETURN;
      END IF;
      -- Verify target exists
      IF NOT EXISTS (SELECT 1 FROM pos_market_stock WHERE client_id = p_client_id AND id = v_market_stock_id) THEN
        UPDATE pos_reconciliation_results SET
          cantidad = p_desired, result = 'BLOCKED_TARGET_MISSING', updated_at = now()
        WHERE id = v_intent.id;
        RETURN QUERY SELECT p_item_id, 'BLOCKED_TARGET_MISSING'::text, v_intent.applied_consumption, 0::numeric;
        RETURN;
      END IF;
    END IF;
  END IF;

  -- ═══ STEP 4: NON_INVENTORY — before delta computation ═══
  IF v_mode = 'non_inventory' THEN
    UPDATE pos_reconciliation_results SET
      pinned_mode = COALESCE(v_intent.pinned_mode, 'non_inventory'),
      cantidad = p_desired,
      result = 'NO_MUTATION_APPROVED',
      updated_at = now()
    WHERE id = v_intent.id;
    RETURN QUERY SELECT p_item_id, 'NO_MUTATION_APPROVED'::text, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  -- ═══ STEP 5: Consumption delta ═══
  v_delta := p_desired - v_intent.applied_consumption;

  IF v_delta = 0 THEN
    UPDATE pos_reconciliation_results SET
      cantidad = p_desired, result = 'RECONCILED', updated_at = now()
    WHERE id = v_intent.id;
    RETURN QUERY SELECT p_item_id, 'RECONCILED'::text, v_intent.applied_consumption, 0::numeric;
    RETURN;
  END IF;

  -- ═══ STEP 6: Authority check — MUST be r1 for sale mutation ═══
  IF p_sale_authority != 'r1' THEN
    UPDATE pos_reconciliation_results SET
      cantidad = p_desired, result = 'BLOCKED_OWNER_MISSING', updated_at = now()
    WHERE id = v_intent.id;
    RETURN QUERY SELECT p_item_id, 'BLOCKED_OWNER_MISSING'::text, v_intent.applied_consumption, 0::numeric;
    RETURN;
  END IF;

  v_next_rev := v_intent.last_mutation_revision + 1;

  -- ═══ STEP 7: RECIPE MODE ═══
  IF v_mode = 'recipe' THEN

    -- PHASE A: Complete prevalidation — zero mutation
    FOR v_plan_line IN
      SELECT l.ingredient_id, l.quantity AS recipe_qty, l.recipe_unit,
             inv.stock_unit, inv.ingredient_id AS inv_target
      FROM pos_recipe_lines l
      JOIN pos_inventory inv ON inv.client_id = l.client_id AND inv.ingredient_id = l.ingredient_id
      WHERE l.client_id = p_client_id AND l.recipe_version_id = v_recipe_version_id
      ORDER BY l.ingredient_id
    LOOP
      v_converted := convert_recipe_to_stock(v_plan_line.recipe_qty, v_plan_line.recipe_unit, v_plan_line.stock_unit);
      IF v_converted IS NULL THEN
        UPDATE pos_reconciliation_results SET
          cantidad = p_desired, result = 'BLOCKED_UNIT_MISSING', updated_at = now()
        WHERE id = v_intent.id;
        RETURN QUERY SELECT p_item_id, 'BLOCKED_UNIT_MISSING'::text, v_intent.applied_consumption, 0::numeric;
        RETURN;
      END IF;
      IF v_converted <= 0 THEN
        UPDATE pos_reconciliation_results SET
          cantidad = p_desired, result = 'BLOCKED_UNIT_MISSING', updated_at = now()
        WHERE id = v_intent.id;
        RETURN QUERY SELECT p_item_id, 'BLOCKED_UNIT_MISSING'::text, v_intent.applied_consumption, 0::numeric;
        RETURN;
      END IF;
    END LOOP;

    -- PHASE A.2: Acquire ALL ingredient target locks in deterministic order
    SELECT count(*) INTO v_locked_count
    FROM (
      SELECT ingredient_id FROM pos_inventory
      WHERE client_id = p_client_id
        AND ingredient_id IN (
          SELECT ingredient_id FROM pos_recipe_lines
          WHERE client_id = p_client_id AND recipe_version_id = v_recipe_version_id
        )
      ORDER BY ingredient_id
      FOR UPDATE
    ) locked;

    -- Verify all targets locked
    IF v_locked_count != (SELECT count(DISTINCT ingredient_id) FROM pos_recipe_lines
                          WHERE client_id = p_client_id AND recipe_version_id = v_recipe_version_id) THEN
      RAISE EXCEPTION 'Recipe target lock count mismatch: locked=% expected=%',
        v_locked_count,
        (SELECT count(DISTINCT ingredient_id) FROM pos_recipe_lines
         WHERE client_id = p_client_id AND recipe_version_id = v_recipe_version_id);
    END IF;

    -- PHASE B: Mutation (all-or-nothing — any failure = RAISE = tx abort)
    FOR v_plan_line IN
      SELECT l.ingredient_id, l.quantity AS recipe_qty, l.recipe_unit,
             inv.stock_unit
      FROM pos_recipe_lines l
      JOIN pos_inventory inv ON inv.client_id = l.client_id AND inv.ingredient_id = l.ingredient_id
      WHERE l.client_id = p_client_id AND l.recipe_version_id = v_recipe_version_id
      ORDER BY l.ingredient_id
    LOOP
      v_converted := convert_recipe_to_stock(v_plan_line.recipe_qty, v_plan_line.recipe_unit, v_plan_line.stock_unit);
      v_ing_delta := v_converted * v_delta;

      -- Atomic stock update — no clamping, allows negative
      UPDATE pos_inventory
      SET stock = stock - v_ing_delta, updated_at = now()
      WHERE client_id = p_client_id AND ingredient_id = v_plan_line.ingredient_id;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated != 1 THEN
        RAISE EXCEPTION 'Ingredient % update failed: rows=%', v_plan_line.ingredient_id, v_updated;
      END IF;

      -- Movement provenance (order_id left NULL — uuid type mismatch; use reconciliation_result_id)
      INSERT INTO pos_inventory_movements
        (client_id, ingredient_id, movement_type, quantity, actor, notes,
         reconciliation_result_id, mutation_revision)
      VALUES
        (p_client_id, v_plan_line.ingredient_id,
         CASE WHEN v_ing_delta > 0 THEN 'recipe_deduction' ELSE 'recipe_reversal' END,
         -v_ing_delta,
         'r1_reconciler',
         'rv=' || v_recipe_version_id || ' rev=' || v_next_rev || ' oi=' || p_item_id,
         v_intent.id, v_next_rev);
    END LOOP;

    -- Commit pin + applied state
    UPDATE pos_reconciliation_results SET
      pinned_mode = COALESCE(v_intent.pinned_mode, 'recipe'),
      pinned_recipe_version_id = COALESCE(v_intent.pinned_recipe_version_id, v_recipe_version_id),
      cantidad = p_desired,
      applied_consumption = p_desired,
      last_mutation_revision = v_next_rev,
      result = 'RECONCILED',
      updated_at = now()
    WHERE id = v_intent.id;

    RETURN QUERY SELECT p_item_id, 'RECONCILED'::text, p_desired, v_delta;
    RETURN;

  -- ═══ STEP 8: DIRECT_STOCK MODE ═══
  ELSIF v_mode = 'direct_stock' THEN

    -- Atomic market stock update — no clamping
    UPDATE pos_market_stock
    SET stock = stock - v_delta, updated_at = now()
    WHERE client_id = p_client_id AND id = v_market_stock_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated != 1 THEN
      RAISE EXCEPTION 'Market stock % update failed: rows=%', v_market_stock_id, v_updated;
    END IF;

    -- Movement provenance
    INSERT INTO pos_market_movements
      (client_id, menu_item_id, movement_type, quantity, order_id, actor, notes,
       reconciliation_result_id, mutation_revision)
    VALUES
      (p_client_id, p_menu_item_id,
       CASE WHEN v_delta > 0 THEN 'venta' ELSE 'devolucion' END,
       -v_delta, p_order_id,
       'r1_reconciler',
       'mkt=' || v_market_stock_id || ' rev=' || v_next_rev || ' oi=' || p_item_id,
       v_intent.id, v_next_rev);

    -- Commit pin + applied state
    UPDATE pos_reconciliation_results SET
      pinned_mode = COALESCE(v_intent.pinned_mode, 'direct_stock'),
      pinned_market_stock_id = COALESCE(v_intent.pinned_market_stock_id, v_market_stock_id),
      cantidad = p_desired,
      applied_consumption = p_desired,
      last_mutation_revision = v_next_rev,
      result = 'RECONCILED',
      updated_at = now()
    WHERE id = v_intent.id;

    RETURN QUERY SELECT p_item_id, 'RECONCILED'::text, p_desired, v_delta;
    RETURN;

  END IF;

  -- Should not reach here
  RAISE EXCEPTION 'Unhandled mode: %', v_mode;
END;
$$;


ALTER FUNCTION "public"."r1_reconcile_item"("p_client_id" "text", "p_order_id" "text", "p_item_id" "text", "p_menu_item_id" "text", "p_desired" numeric, "p_sale_authority" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."r1_reconcile_order"("p_client_id" "text", "p_order_id" "text") RETURNS TABLE("r_item_id" "text", "r_result" "text", "r_applied" numeric, "r_delta" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_order RECORD;
  v_authority text;
  v_item jsonb;
  v_item_id text;
  v_menu_item_id text;
  v_desired numeric;
  v_current_ids text[] := '{}';
  v_orphan RECORD;
  v_is_cancelled boolean;
  v_all_complete boolean := true;
  v_order_rev bigint;
BEGIN
  -- ═══ STEP 1: Lock order row FOR UPDATE ═══
  SELECT * INTO v_order FROM pos_orders
  WHERE id = p_order_id AND client_id = p_client_id
  FOR UPDATE;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Order % not found for client %', p_order_id, p_client_id;
  END IF;

  v_order_rev := v_order.order_revision;

  -- ═══ STEP 2: Acquire authority FOR SHARE ═══
  SELECT sale_authority INTO v_authority
  FROM pos_mutation_authority
  WHERE client_id = p_client_id
  FOR SHARE;

  IF v_authority IS NULL THEN
    v_authority := 'legacy';  -- default if no authority row
  END IF;

  -- ═══ STEP 3: Determine if order is cancelled/voided ═══
  v_is_cancelled := v_order.status IN ('cancelada', 'anulada');

  -- ═══ STEP 4: Process current items ═══
  IF NOT v_is_cancelled AND v_order.items IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_order.items) LOOP
      v_item_id := v_item->>'id';
      v_menu_item_id := v_item->>'menuItemId';
      v_desired := COALESCE((v_item->>'cantidad')::numeric, 0);

      IF v_item_id IS NULL OR v_menu_item_id IS NULL THEN
        CONTINUE;  -- skip malformed items
      END IF;

      v_current_ids := array_append(v_current_ids, v_item_id);

      RETURN QUERY SELECT * FROM r1_reconcile_item(
        p_client_id, p_order_id, v_item_id, v_menu_item_id, v_desired, v_authority
      );
    END LOOP;
  END IF;

  -- ═══ STEP 5: Discover removed/cancelled items → desired=0 ═══
  FOR v_orphan IN
    SELECT rr.order_item_id, rr.menu_item_id
    FROM pos_reconciliation_results rr
    WHERE rr.client_id = p_client_id
      AND rr.order_id = p_order_id
      AND rr.order_item_id != ALL(v_current_ids)
      AND (rr.applied_consumption > 0 OR rr.pinned_mode IS NOT NULL)
  LOOP
    RETURN QUERY SELECT * FROM r1_reconcile_item(
      p_client_id, p_order_id, v_orphan.order_item_id, v_orphan.menu_item_id, 0::numeric, v_authority
    );
  END LOOP;

  -- ═══ STEP 6: Update revision lineage ═══
  -- Check if all intents for this order are terminally resolved
  SELECT bool_and(result IN ('RECONCILED', 'NO_MUTATION_APPROVED'))
  INTO v_all_complete
  FROM pos_reconciliation_results
  WHERE client_id = p_client_id AND order_id = p_order_id;

  IF v_all_complete IS NULL THEN
    v_all_complete := true;  -- no intents = complete
  END IF;

  UPDATE pos_orders SET
    last_inventory_processed_revision = v_order_rev,
    last_inventory_complete_revision = CASE
      WHEN v_all_complete THEN v_order_rev
      ELSE last_inventory_complete_revision  -- preserve prior
    END
  WHERE id = p_order_id AND client_id = p_client_id;

END;
$$;


ALTER FUNCTION "public"."r1_reconcile_order"("p_client_id" "text", "p_order_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."r1_save_order"("p_client_id" "text", "p_order_id" "text", "p_expected_revision" bigint, "p_mesa" integer DEFAULT NULL::integer, "p_customer_name" "text" DEFAULT NULL::"text", "p_mesero" "text" DEFAULT NULL::"text", "p_personas" integer DEFAULT NULL::integer, "p_status" "text" DEFAULT NULL::"text", "p_subtotal" numeric DEFAULT NULL::numeric, "p_iva" numeric DEFAULT NULL::numeric, "p_total" numeric DEFAULT NULL::numeric, "p_descuento" numeric DEFAULT NULL::numeric, "p_propina" numeric DEFAULT NULL::numeric, "p_metodo_pago" "text" DEFAULT NULL::"text", "p_pagos" "jsonb" DEFAULT NULL::"jsonb", "p_turno_id" "text" DEFAULT NULL::"text", "p_notas" "text" DEFAULT NULL::"text", "p_items" "jsonb" DEFAULT NULL::"jsonb", "p_closed_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_new_revision bigint;
  v_current_revision bigint;
  v_exists boolean;
BEGIN
  -- Tenant guard
  IF NOT private.can_write_client(p_client_id) THEN
    RETURN jsonb_build_object('ok', false, 'revision', NULL, 'conflict', false,
      'error', 'FORBIDDEN_CLIENT');
  END IF;

  SELECT EXISTS(SELECT 1 FROM pos_orders WHERE id = p_order_id AND client_id = p_client_id)
  INTO v_exists;

  IF NOT v_exists AND p_expected_revision = 0 THEN
    INSERT INTO pos_orders (
      id, client_id, mesa, customer_name, mesero, personas, status,
      subtotal, iva, total, descuento, propina, metodo_pago, pagos,
      turno_id, notas, items, closed_at, order_revision
    ) VALUES (
      p_order_id, p_client_id, p_mesa, p_customer_name, p_mesero, p_personas,
      COALESCE(p_status, 'abierta'), COALESCE(p_subtotal, 0), COALESCE(p_iva, 0),
      COALESCE(p_total, 0), COALESCE(p_descuento, 0), COALESCE(p_propina, 0),
      p_metodo_pago, p_pagos, p_turno_id, p_notas, p_items, p_closed_at, 1
    );
    RETURN jsonb_build_object('ok', true, 'revision', 1, 'conflict', false);
  END IF;

  IF NOT v_exists THEN
    RETURN jsonb_build_object('ok', false, 'revision', NULL, 'conflict', false,
      'error', 'ORDER_NOT_FOUND');
  END IF;

  UPDATE pos_orders SET
    mesa = COALESCE(p_mesa, mesa),
    customer_name = COALESCE(p_customer_name, customer_name),
    mesero = COALESCE(p_mesero, mesero),
    personas = COALESCE(p_personas, personas),
    status = COALESCE(p_status, status),
    subtotal = COALESCE(p_subtotal, subtotal),
    iva = COALESCE(p_iva, iva),
    total = COALESCE(p_total, total),
    descuento = COALESCE(p_descuento, descuento),
    propina = COALESCE(p_propina, propina),
    metodo_pago = COALESCE(p_metodo_pago, metodo_pago),
    pagos = COALESCE(p_pagos, pagos),
    turno_id = COALESCE(p_turno_id, turno_id),
    notas = COALESCE(p_notas, notas),
    items = COALESCE(p_items, items),
    closed_at = COALESCE(p_closed_at, closed_at),
    order_revision = order_revision + 1
  WHERE id = p_order_id
    AND client_id = p_client_id
    AND order_revision = p_expected_revision
  RETURNING order_revision INTO v_new_revision;

  IF v_new_revision IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'revision', v_new_revision, 'conflict', false);
  END IF;

  SELECT order_revision INTO v_current_revision
  FROM pos_orders WHERE id = p_order_id AND client_id = p_client_id;

  RETURN jsonb_build_object('ok', false, 'revision', v_current_revision, 'conflict', true,
    'error', 'STALE_WRITE_REJECTED',
    'expected_revision', p_expected_revision,
    'current_revision', v_current_revision);
END;
$$;


ALTER FUNCTION "public"."r1_save_order"("p_client_id" "text", "p_order_id" "text", "p_expected_revision" bigint, "p_mesa" integer, "p_customer_name" "text", "p_mesero" "text", "p_personas" integer, "p_status" "text", "p_subtotal" numeric, "p_iva" numeric, "p_total" numeric, "p_descuento" numeric, "p_propina" numeric, "p_metodo_pago" "text", "p_pagos" "jsonb", "p_turno_id" "text", "p_notas" "text", "p_items" "jsonb", "p_closed_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."r1_save_order"("p_client_id" "text", "p_order_id" "text", "p_expected_revision" bigint, "p_mesa" "text", "p_customer_name" "text", "p_mesero" "text", "p_personas" integer, "p_status" "text", "p_subtotal" numeric, "p_iva" numeric, "p_total" numeric, "p_descuento" numeric, "p_propina" numeric, "p_metodo_pago" "text", "p_pagos" "jsonb", "p_turno_id" "text", "p_notas" "text", "p_items" "jsonb", "p_closed_at" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_new_revision bigint;
  v_current_revision bigint;
  v_exists boolean;
BEGIN
  -- Tenant guard
  IF NOT private.can_write_client(p_client_id) THEN
    RETURN jsonb_build_object('ok', false, 'revision', NULL, 'conflict', false,
      'error', 'FORBIDDEN_CLIENT');
  END IF;

  SELECT EXISTS(SELECT 1 FROM pos_orders WHERE id = p_order_id AND client_id = p_client_id)
  INTO v_exists;

  IF NOT v_exists AND p_expected_revision = 0 THEN
    BEGIN
      INSERT INTO pos_orders (
        id, client_id, mesa, customer_name, mesero, personas, status,
        subtotal, iva, total, descuento, propina, metodo_pago, pagos,
        turno_id, notas, items, closed_at, order_revision
      ) VALUES (
        p_order_id, p_client_id, p_mesa, p_customer_name, p_mesero, p_personas,
        COALESCE(p_status, 'abierta'), COALESCE(p_subtotal, 0), COALESCE(p_iva, 0),
        COALESCE(p_total, 0), COALESCE(p_descuento, 0), COALESCE(p_propina, 0),
        p_metodo_pago, p_pagos, p_turno_id, p_notas, p_items, p_closed_at, 1
      );
      RETURN jsonb_build_object('ok', true, 'revision', 1, 'conflict', false,
        'first_execution', true, 'idempotent_replay', false);
    EXCEPTION WHEN unique_violation THEN
      SELECT order_revision INTO v_current_revision
      FROM pos_orders WHERE id = p_order_id AND client_id = p_client_id;
      RETURN jsonb_build_object('ok', false, 'revision', v_current_revision, 'conflict', true,
        'error', 'STALE_WRITE_REJECTED',
        'expected_revision', 0,
        'current_revision', v_current_revision);
    END;
  END IF;

  IF NOT v_exists THEN
    RETURN jsonb_build_object('ok', false, 'revision', NULL, 'conflict', false,
      'error', 'ORDER_NOT_FOUND');
  END IF;

  UPDATE pos_orders SET
    mesa = COALESCE(p_mesa, mesa),
    customer_name = COALESCE(p_customer_name, customer_name),
    mesero = COALESCE(p_mesero, mesero),
    personas = COALESCE(p_personas, personas),
    status = COALESCE(p_status, status),
    subtotal = COALESCE(p_subtotal, subtotal),
    iva = COALESCE(p_iva, iva),
    total = COALESCE(p_total, total),
    descuento = COALESCE(p_descuento, descuento),
    propina = COALESCE(p_propina, propina),
    metodo_pago = COALESCE(p_metodo_pago, metodo_pago),
    pagos = COALESCE(p_pagos, pagos),
    turno_id = COALESCE(p_turno_id, turno_id),
    notas = COALESCE(p_notas, notas),
    items = COALESCE(p_items, items),
    closed_at = COALESCE(p_closed_at, closed_at),
    order_revision = order_revision + 1
  WHERE id = p_order_id
    AND client_id = p_client_id
    AND order_revision = p_expected_revision
  RETURNING order_revision INTO v_new_revision;

  IF v_new_revision IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'revision', v_new_revision, 'conflict', false,
      'first_execution', true, 'idempotent_replay', false);
  END IF;

  SELECT order_revision INTO v_current_revision
  FROM pos_orders WHERE id = p_order_id AND client_id = p_client_id;

  RETURN jsonb_build_object('ok', false, 'revision', v_current_revision, 'conflict', true,
    'error', 'STALE_WRITE_REJECTED',
    'expected_revision', p_expected_revision,
    'current_revision', v_current_revision);
END;
$$;


ALTER FUNCTION "public"."r1_save_order"("p_client_id" "text", "p_order_id" "text", "p_expected_revision" bigint, "p_mesa" "text", "p_customer_name" "text", "p_mesero" "text", "p_personas" integer, "p_status" "text", "p_subtotal" numeric, "p_iva" numeric, "p_total" numeric, "p_descuento" numeric, "p_propina" numeric, "p_metodo_pago" "text", "p_pagos" "jsonb", "p_turno_id" "text", "p_notas" "text", "p_items" "jsonb", "p_closed_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."r1_save_order_idempotent"("p_client_id" "text", "p_order_id" "text", "p_save_operation_id" "text", "p_expected_revision" bigint, "p_mesa" integer DEFAULT NULL::integer, "p_customer_name" "text" DEFAULT NULL::"text", "p_mesero" "text" DEFAULT NULL::"text", "p_personas" integer DEFAULT NULL::integer, "p_status" "text" DEFAULT NULL::"text", "p_subtotal" numeric DEFAULT NULL::numeric, "p_iva" numeric DEFAULT NULL::numeric, "p_total" numeric DEFAULT NULL::numeric, "p_descuento" numeric DEFAULT NULL::numeric, "p_propina" numeric DEFAULT NULL::numeric, "p_metodo_pago" "text" DEFAULT NULL::"text", "p_pagos" "jsonb" DEFAULT NULL::"jsonb", "p_turno_id" "text" DEFAULT NULL::"text", "p_notas" "text" DEFAULT NULL::"text", "p_items" "jsonb" DEFAULT NULL::"jsonb", "p_closed_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  DECLARE
    v_row_count integer;
    v_hash text;
    v_canonical jsonb;
    v_items_sorted jsonb;
    v_existing record;
    v_save_result jsonb;
  BEGIN
    -- Tenant guard: reject before touching pos_save_operations.
    IF NOT private.can_write_client(p_client_id) THEN
      RETURN jsonb_build_object('ok', false, 'conflict', false, 'error', 'FORBIDDEN_CLIENT');
    END IF;

    IF p_save_operation_id IS NULL OR p_save_operation_id = '' THEN
      v_save_result := r1_save_order(
        p_client_id, p_order_id, p_expected_revision,
        p_mesa, p_customer_name, p_mesero, p_personas,
        p_status, p_subtotal, p_iva, p_total,
        p_descuento, p_propina, p_metodo_pago, p_pagos,
        p_turno_id, p_notas, p_items, p_closed_at
      );
      RETURN v_save_result || jsonb_build_object(
        'first_execution', true, 'idempotent_replay', false);
    END IF;

    v_items_sorted := (
      SELECT COALESCE(jsonb_agg(
        CASE
          WHEN item ? 'modificadores' AND jsonb_typeof(item->'modificadores') = 'array' THEN
            (item - 'modificadores') || jsonb_build_object('modificadores',
              (SELECT COALESCE(jsonb_agg(m ORDER BY m), '[]'::jsonb)
               FROM jsonb_array_elements_text(item->'modificadores') AS m))
          ELSE item
        END
        ORDER BY item->>'id'
      ), '[]'::jsonb)
      FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS item
    );

    v_canonical := jsonb_build_object(
      'closed_at', p_closed_at,
      'customer_name', p_customer_name,
      'descuento', COALESCE(p_descuento, 0),
      'expected_revision', p_expected_revision,
      'iva', COALESCE(p_iva, 0),
      'items', v_items_sorted,
      'mesa', p_mesa,
      'mesero', p_mesero,
      'metodo_pago', p_metodo_pago,
      'notas', p_notas,
      'pagos', COALESCE(p_pagos, '[]'::jsonb),
      'personas', p_personas,
      'propina', COALESCE(p_propina, 0),
      'status', p_status,
      'subtotal', COALESCE(p_subtotal, 0),
      'total', COALESCE(p_total, 0),
      'turno_id', p_turno_id
    );

    v_hash := encode(digest(v_canonical::text, 'sha256'), 'hex');

    INSERT INTO pos_save_operations (
      client_id, order_id, save_operation_id, payload_hash, state, created_at
    ) VALUES (
      p_client_id, p_order_id, p_save_operation_id, v_hash, 'EXECUTING', now()
    ) ON CONFLICT (client_id, order_id, save_operation_id) DO NOTHING;

    GET DIAGNOSTICS v_row_count = ROW_COUNT;

    IF v_row_count = 0 THEN
      SELECT * INTO v_existing FROM pos_save_operations
      WHERE client_id = p_client_id AND order_id = p_order_id
        AND save_operation_id = p_save_operation_id;

      IF v_existing IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'INTERNAL_INVARIANT_VIOLATION',
          'detail', 'INSERT conflict but row not found after commit');
      END IF;

      IF v_existing.payload_hash != v_hash THEN
        RETURN jsonb_build_object('ok', false, 'error', 'PAYLOAD_IDENTITY_CORRUPTION',
          'detail', 'save_operation_id reused with different canonical payload');
      END IF;

      IF v_existing.state = 'COMMITTED' THEN
        RETURN jsonb_build_object(
          'ok', true,
          'revision', v_existing.committed_revision,
          'conflict', false,
          'first_execution', false,
          'idempotent_replay', true
        );
      ELSIF v_existing.state = 'REJECTED' THEN
        RETURN jsonb_build_object(
          'ok', false,
          'conflict', true,
          'error', v_existing.rejection_detail,
          'expected_revision', v_existing.rejection_expected,
          'current_revision', v_existing.rejection_current,
          'first_execution', false,
          'idempotent_replay', true
        );
      ELSE
        RETURN jsonb_build_object('ok', false, 'error', 'INTERNAL_INVARIANT_VIOLATION',
          'detail', 'operation in EXECUTING state visible externally');
      END IF;
    END IF;

    v_save_result := r1_save_order(
      p_client_id, p_order_id, p_expected_revision,
      p_mesa, p_customer_name, p_mesero, p_personas,
      p_status, p_subtotal, p_iva, p_total,
      p_descuento, p_propina, p_metodo_pago, p_pagos,
      p_turno_id, p_notas, p_items, p_closed_at
    );

    IF (v_save_result->>'ok')::boolean THEN
      UPDATE pos_save_operations SET
        state = 'COMMITTED',
        committed_revision = (v_save_result->>'revision')::bigint,
        completed_at = now()
      WHERE client_id = p_client_id AND order_id = p_order_id
        AND save_operation_id = p_save_operation_id;

      RETURN v_save_result || jsonb_build_object(
        'first_execution', true, 'idempotent_replay', false);
    ELSE
      UPDATE pos_save_operations SET
        state = 'REJECTED',
        rejection_detail = COALESCE(v_save_result->>'error', 'UNKNOWN_REJECTION'),
        rejection_expected = (v_save_result->>'expected_revision')::bigint,
        rejection_current = (v_save_result->>'current_revision')::bigint,
        completed_at = now()
      WHERE client_id = p_client_id AND order_id = p_order_id
        AND save_operation_id = p_save_operation_id;

      RETURN v_save_result || jsonb_build_object(
        'first_execution', true, 'idempotent_replay', false);
    END IF;
  END;
$$;


ALTER FUNCTION "public"."r1_save_order_idempotent"("p_client_id" "text", "p_order_id" "text", "p_save_operation_id" "text", "p_expected_revision" bigint, "p_mesa" integer, "p_customer_name" "text", "p_mesero" "text", "p_personas" integer, "p_status" "text", "p_subtotal" numeric, "p_iva" numeric, "p_total" numeric, "p_descuento" numeric, "p_propina" numeric, "p_metodo_pago" "text", "p_pagos" "jsonb", "p_turno_id" "text", "p_notas" "text", "p_items" "jsonb", "p_closed_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reconcile_order_inventory"("p_order_id" "text") RETURNS TABLE("r_ingredient_id" "text", "r_expected" numeric, "r_net_applied" numeric, "r_delta" numeric, "r_action" "text")
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_client_id TEXT;
  v_items JSONB;
  v_rec RECORD;
  v_current_net NUMERIC;
  v_adjustment NUMERIC;
  v_rows INT;
BEGIN
  SELECT o.client_id, o.items INTO v_client_id, v_items
  FROM pos_orders o WHERE o.id = p_order_id FOR UPDATE;
  IF v_client_id IS NULL THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;
  IF v_items IS NOT NULL AND jsonb_typeof(v_items) = 'string' THEN v_items := (v_items #>> '{}')::jsonb; END IF;
  IF v_items IS NULL OR jsonb_typeof(v_items) != 'array' THEN v_items := '[]'::jsonb; END IF;

  FOR v_rec IN
    SELECT ing_id, ROUND(COALESCE(SUM(exp_qty), 0), 6) as expected_qty
    FROM (
      SELECT r.ingredient_id as ing_id, SUM(r.quantity * (elem->>'cantidad')::numeric) as exp_qty
      FROM jsonb_array_elements(v_items) elem
      JOIN pos_recipes_old r ON r.client_id = v_client_id AND lower(r.menu_item_name) = lower(elem->>'nombre')
      GROUP BY r.ingredient_id
      UNION ALL
      SELECT DISTINCT m2.ingredient_id as ing_id, 0::numeric as exp_qty
      FROM pos_inventory_movements m2
      WHERE m2.order_id = p_order_id::uuid AND m2.movement_type IN ('deduction','reversal')
        AND m2.ingredient_id NOT IN (
          SELECT r2.ingredient_id FROM jsonb_array_elements(v_items) e2
          JOIN pos_recipes_old r2 ON r2.client_id = v_client_id AND lower(r2.menu_item_name) = lower(e2->>'nombre'))
    ) combined GROUP BY ing_id
  LOOP
    SELECT ROUND(COALESCE(SUM(r.quantity * (elem->>'cantidad')::numeric), 0), 6) INTO v_rec.expected_qty
    FROM jsonb_array_elements(v_items) elem
    JOIN pos_recipes_old r ON r.client_id = v_client_id AND lower(r.menu_item_name) = lower(elem->>'nombre') AND r.ingredient_id = v_rec.ing_id;

    SELECT ROUND(COALESCE(SUM(m3.quantity), 0), 6) INTO v_current_net
    FROM pos_inventory_movements m3
    WHERE m3.order_id = p_order_id::uuid AND m3.ingredient_id = v_rec.ing_id AND m3.movement_type IN ('deduction','reversal');

    v_adjustment := ROUND(-v_rec.expected_qty, 6) - v_current_net;

    IF v_adjustment = 0 THEN
      r_ingredient_id := v_rec.ing_id; r_expected := v_rec.expected_qty; r_net_applied := -v_current_net; r_delta := 0; r_action := 'balanced';
      RETURN NEXT; CONTINUE;
    END IF;

    INSERT INTO pos_inventory_movements (client_id, ingredient_id, movement_type, quantity, order_id, actor, notes)
    VALUES (v_client_id, v_rec.ing_id, CASE WHEN v_adjustment < 0 THEN 'deduction' ELSE 'reversal' END,
            v_adjustment, p_order_id::uuid, 'system-reconcile', 'Reconciliation ' || ROUND(v_adjustment, 6));

    UPDATE pos_inventory AS inv SET stock = inv.stock + v_adjustment, updated_at = NOW()
    WHERE inv.client_id = v_client_id AND inv.ingredient_id = v_rec.ing_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 1 THEN RAISE EXCEPTION 'Multiple inventory rows for %, got %', v_rec.ing_id, v_rows; END IF;

    r_ingredient_id := v_rec.ing_id; r_expected := v_rec.expected_qty; r_net_applied := -v_current_net; r_delta := v_adjustment;
    r_action := CASE WHEN v_adjustment < 0 THEN 'deducted' ELSE 'reversed' END;
    RETURN NEXT;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."reconcile_order_inventory"("p_order_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reject_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
  begin raise exception 'events is append-only'; end $$;


ALTER FUNCTION "public"."reject_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_pos_order_number"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.order_number IS NULL THEN
    SELECT COALESCE(MAX(order_number), 0) + 1 INTO NEW.order_number
    FROM pos_orders
    WHERE client_id = NEW.client_id
      AND (created_at AT TIME ZONE 'America/Monterrey')::date
          = (now() AT TIME ZONE 'America/Monterrey')::date;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_pos_order_number"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."agent_audit_log" (
    "id" bigint NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"(),
    "agent_name" "text" NOT NULL,
    "trigger_type" "text",
    "action_type" "text" NOT NULL,
    "tables_touched" "text"[],
    "result" "text",
    "detail" "text",
    "duration_ms" integer,
    "auth_role" "text"
);


ALTER TABLE "public"."agent_audit_log" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."agent_audit_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."agent_audit_log_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."agent_audit_log_id_seq" OWNED BY "public"."agent_audit_log"."id";



CREATE TABLE IF NOT EXISTS "public"."agent_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "text" NOT NULL,
    "agent_id" "text" NOT NULL,
    "type" "text" NOT NULL,
    "severity" "text" DEFAULT 'info'::"text" NOT NULL,
    "title" "text" NOT NULL,
    "explanation" "text" DEFAULT ''::"text" NOT NULL,
    "evidence" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "suggested_action" "text" DEFAULT ''::"text" NOT NULL,
    "confidence" numeric(3,2) DEFAULT 0.80 NOT NULL,
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "estimated_value" numeric(10,2),
    "outcome" "text",
    CONSTRAINT "agent_events_agent_id_check" CHECK (("agent_id" = ANY (ARRAY['operations'::"text", 'inventory'::"text", 'fraud'::"text", 'staff'::"text", 'finance'::"text"]))),
    CONSTRAINT "agent_events_confidence_check" CHECK ((("confidence" >= (0)::numeric) AND ("confidence" <= (1)::numeric))),
    CONSTRAINT "agent_events_outcome_check" CHECK (("outcome" = ANY (ARRAY['correct'::"text", 'false_positive'::"text"]))),
    CONSTRAINT "agent_events_severity_check" CHECK (("severity" = ANY (ARRAY['info'::"text", 'warning'::"text", 'critical'::"text"]))),
    CONSTRAINT "agent_events_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'acknowledged'::"text", 'resolved'::"text"])))
);


ALTER TABLE "public"."agent_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agent_insights" (
    "id" bigint NOT NULL,
    "agent_id" "text" NOT NULL,
    "client_id" "text",
    "category" "text" NOT NULL,
    "severity" "text" NOT NULL,
    "title" "text" NOT NULL,
    "summary" "text",
    "evidence" "jsonb",
    "recommended_action" "text",
    "deep_link" "text",
    "data_freshness" timestamp with time zone,
    "confidence" numeric,
    "status" "text" DEFAULT 'new'::"text",
    "acknowledged_by" "text",
    "resolved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "agent_insights_severity_check" CHECK (("severity" = ANY (ARRAY['critical'::"text", 'high'::"text", 'medium'::"text", 'info'::"text"]))),
    CONSTRAINT "agent_insights_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'viewed'::"text", 'acknowledged'::"text", 'resolved'::"text", 'dismissed'::"text"])))
);


ALTER TABLE "public"."agent_insights" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."agent_insights_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."agent_insights_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."agent_insights_id_seq" OWNED BY "public"."agent_insights"."id";



CREATE TABLE IF NOT EXISTS "public"."agent_messages" (
    "id" bigint NOT NULL,
    "from_agent" "text" NOT NULL,
    "to_agent" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "read" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."agent_messages" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."agent_messages_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."agent_messages_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."agent_messages_id_seq" OWNED BY "public"."agent_messages"."id";



CREATE TABLE IF NOT EXISTS "public"."agent_results" (
    "id" bigint NOT NULL,
    "client_id" "text" NOT NULL,
    "agent_id" "text" NOT NULL,
    "fecha" "date" NOT NULL,
    "data" "jsonb" NOT NULL,
    "summary" "text",
    "priority" "text" DEFAULT 'info'::"text",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."agent_results" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."agent_results_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."agent_results_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."agent_results_id_seq" OWNED BY "public"."agent_results"."id";



CREATE TABLE IF NOT EXISTS "public"."agent_runs" (
    "id" bigint NOT NULL,
    "agent_id" "text" NOT NULL,
    "trigger_type" "text" NOT NULL,
    "status" "text" NOT NULL,
    "duration_ms" integer,
    "output_summary" "text",
    "error_message" "text",
    "tokens_in" integer,
    "tokens_out" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tentacle" "text",
    "input_freshness" timestamp with time zone,
    "rows_processed" integer DEFAULT 0,
    "skip_reason" "text",
    "data_status" "text" DEFAULT 'ok'::"text",
    CONSTRAINT "agent_runs_data_status_check" CHECK (("data_status" = ANY (ARRAY['ok'::"text", 'no_data'::"text", 'stale_data'::"text", 'partial'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."agent_runs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."agent_runs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."agent_runs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."agent_runs_id_seq" OWNED BY "public"."agent_runs"."id";



CREATE TABLE IF NOT EXISTS "public"."amalay_reservaciones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text" NOT NULL,
    "telefono" "text",
    "fecha" "date" NOT NULL,
    "espacio" "text" NOT NULL,
    "horario_inicio" time without time zone NOT NULL,
    "horario_fin" time without time zone NOT NULL,
    "guests" integer NOT NULL,
    "paquete" "text",
    "pastel" "text",
    "entradas" "text"[],
    "deco" "text",
    "total" numeric(10,2),
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "codigo_reserva" "text" NOT NULL,
    CONSTRAINT "amalay_reservaciones_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."amalay_reservaciones" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."calendar_sync_log" (
    "id" bigint NOT NULL,
    "event_id" "text" NOT NULL,
    "event_title" "text",
    "event_start" timestamp with time zone,
    "matched_reserva_id" "uuid",
    "matched_codigo" "text",
    "action" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "calendar_sync_log_action_check" CHECK (("action" = ANY (ARRAY['confirmed'::"text", 'no_match'::"text", 'duplicate'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."calendar_sync_log" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."calendar_sync_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."calendar_sync_log_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."calendar_sync_log_id_seq" OWNED BY "public"."calendar_sync_log"."id";



CREATE TABLE IF NOT EXISTS "public"."chat_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "text" NOT NULL,
    "user_id" "text",
    "user_message" "text" NOT NULL,
    "ai_response" "text" NOT NULL,
    "model" "text" DEFAULT 'groq'::"text",
    "tokens_used" integer,
    "latency_ms" integer,
    "had_error" boolean DEFAULT false,
    "error_type" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."chat_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_locations" (
    "id" "text" NOT NULL,
    "client_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "address" "text",
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."client_locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "client_id" "text",
    "role" "text" DEFAULT 'viewer'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."client_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "city" "text",
    "timezone" "text" DEFAULT 'America/Mexico_City'::"text",
    "wansoft_subsidiary_id" "text",
    "wansoft_user" "text",
    "wansoft_pass" "text",
    "telegram_chat_ids" "jsonb",
    "staff_exclude_meseros" "jsonb",
    "staff_market" "jsonb",
    "menu_categories" "jsonb",
    "bebida_groups" "jsonb",
    "reservaciones_table" "text",
    "kpis_row_id" "text",
    "business_context" "text",
    "report_recipients" "jsonb",
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "default_theme" "text" DEFAULT 'light'::"text",
    "accent_color" "text" DEFAULT 'emerald'::"text",
    "mesas" integer DEFAULT 16,
    "meseros" "jsonb" DEFAULT '[]'::"jsonb",
    "features" "jsonb" DEFAULT '{}'::"jsonb",
    "iva_rate" numeric DEFAULT 0.16,
    "logo_url" "text",
    "type" "text",
    "data_source" "text" DEFAULT 'supabase'::"text",
    "rfc" "text",
    "razon_social" "text",
    "regimen_fiscal" "text",
    "codigo_postal" "text",
    "domicilio_fiscal" "jsonb",
    "staff_supervisors" "jsonb",
    "address" "text",
    "phone" "text",
    "receipt_footer" "text" DEFAULT 'Gracias por tu visita!'::"text",
    "business_day_start_local" time without time zone,
    "wansoft_cookies" "jsonb",
    "pos_settings" "jsonb" DEFAULT '{}'::"jsonb",
    "support_email" "text",
    "plan" "text" DEFAULT 'fullsite_software'::"text" NOT NULL,
    "social_media" "text",
    "pos_write_authority" "text" DEFAULT 'supabase'::"text" NOT NULL,
    CONSTRAINT "clients_pos_write_authority_valid" CHECK (("pos_write_authority" = ANY (ARRAY['supabase'::"text", 'transitioning'::"text", 'local_server'::"text"])))
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


COMMENT ON COLUMN "public"."clients"."business_day_start_local" IS 'Local time marking the start of a business day. Orders closed before this time belong to the previous business day. All producers must read this config — no hardcoded fallbacks.';



CREATE TABLE IF NOT EXISTS "public"."content" (
    "id" bigint NOT NULL,
    "title" "text" NOT NULL,
    "client" "text",
    "platform" "text",
    "status" "text" DEFAULT 'idea'::"text",
    "date" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."content" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."content_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."content_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."content_id_seq" OWNED BY "public"."content"."id";



CREATE TABLE IF NOT EXISTS "public"."credentials_vault" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "text" DEFAULT 'fullsite'::"text" NOT NULL,
    "category" "text" NOT NULL,
    "name" "text" NOT NULL,
    "username" "text",
    "password_encrypted" "text",
    "url" "text",
    "notes" "text",
    "created_by" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."credentials_vault" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."credentials_vault" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."delivery_dlq" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text" NOT NULL,
    "provider_store_id" "text",
    "correlation_id" "text",
    "raw_payload" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."delivery_dlq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."delivery_orders" (
    "id" "text" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "text" NOT NULL,
    "platform" "text" NOT NULL,
    "platform_order_id" "text",
    "status" "text" DEFAULT 'nueva'::"text" NOT NULL,
    "customer_name" "text",
    "customer_phone" "text",
    "items" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "subtotal" numeric DEFAULT 0,
    "delivery_fee" numeric DEFAULT 0,
    "platform_commission" numeric DEFAULT 0,
    "total" numeric DEFAULT 0,
    "notes" "text",
    "estimated_pickup" "text",
    "driver_name" "text",
    "driver_phone" "text",
    "raw_payload" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "accepted_at" timestamp with time zone,
    "ready_at" timestamp with time zone,
    "picked_up_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "address" "text",
    "phone" "text",
    "payment_method" "text",
    "cash_received" numeric,
    "change_due" numeric,
    "driver_id" "text",
    "en_route_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "closed_at" timestamp with time zone,
    "webhook_event_id" "uuid"
);


ALTER TABLE "public"."delivery_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."delivery_platform_payments" (
    "id" "text" NOT NULL,
    "client_id" "text",
    "platform" "text" NOT NULL,
    "lot_id" "text",
    "period_start" "date",
    "period_end" "date",
    "paid_date" "date",
    "total" numeric(12,2),
    "status" "text",
    "payment_ref" "text",
    "raw_json" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."delivery_platform_payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events" (
    "sequence" bigint NOT NULL,
    "id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "version" integer NOT NULL,
    "occurred_at" timestamp with time zone NOT NULL,
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actor" "jsonb" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "audit" "jsonb",
    CONSTRAINT "envelope_actor_complete" CHECK ((("actor" ? 'userId'::"text") AND ("actor" ? 'deviceId'::"text"))),
    CONSTRAINT "sensitive_requires_audit" CHECK ((("type" <> ALL (ARRAY['orders.item.cancelled.v1'::"text", 'orders.discount.applied.v1'::"text", 'payments.cash.withdrawn.v1'::"text", 'inventory.waste.recorded.v1'::"text", 'inventory.adjusted.v1'::"text"])) OR (("audit" IS NOT NULL) AND (("audit" ->> 'approvedBy'::"text") IS NOT NULL))))
);


ALTER TABLE "public"."events" OWNER TO "postgres";


ALTER TABLE "public"."events" ALTER COLUMN "sequence" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."events_sequence_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."feature_flags" (
    "key" "text" NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "description" "text",
    "rollout" "jsonb" DEFAULT '{"cohort": "all"}'::"jsonb" NOT NULL,
    "updated_by" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."feature_flags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."integration_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text" NOT NULL,
    "client_id" "text",
    "correlation_id" "uuid",
    "action" "text" NOT NULL,
    "request_summary" "jsonb",
    "response_summary" "jsonb",
    "status_code" integer,
    "duration_ms" integer,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."integration_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."integration_providers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "provider_version" "text" DEFAULT '1.0.0'::"text" NOT NULL,
    "provider_account_id" "text",
    "oauth_client_id" "text",
    "oauth_client_secret_enc" "text",
    "access_token_enc" "text",
    "token_expires_at" timestamp with time zone,
    "scopes" "text"[] DEFAULT '{}'::"text"[],
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "certification_state" "text" DEFAULT 'uncertified'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "refresh_token_enc" "text",
    CONSTRAINT "integration_providers_certification_state_check" CHECK (("certification_state" = ANY (ARRAY['uncertified'::"text", 'sandbox_passed'::"text", 'production_certified'::"text"]))),
    CONSTRAINT "integration_providers_provider_check" CHECK (("provider" = ANY (ARRAY['ubereats'::"text", 'rappi'::"text", 'didi'::"text", 'clip'::"text", 'mercadopago'::"text"]))),
    CONSTRAINT "integration_providers_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'active'::"text", 'suspended'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."integration_providers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."integration_store_mappings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text" NOT NULL,
    "provider_store_id" "text" NOT NULL,
    "client_id" "text" NOT NULL,
    "menu_sync_enabled" boolean DEFAULT true,
    "oos_sync_enabled" boolean DEFAULT true,
    "store_open" boolean DEFAULT true,
    "last_menu_sync" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."integration_store_mappings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."integration_webhook_dlq" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "webhook_event_id" "uuid",
    "provider" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "client_id" "text",
    "payload" "jsonb" NOT NULL,
    "failure_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."integration_webhook_dlq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."integration_webhook_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text" NOT NULL,
    "provider_event_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "correlation_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "text",
    "store_id" "text",
    "payload" "jsonb" NOT NULL,
    "status" "text" DEFAULT 'received'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "integration_webhook_events_status_check" CHECK (("status" = ANY (ARRAY['received'::"text", 'processing'::"text", 'processed'::"text", 'failed'::"text", 'dlq'::"text"])))
);


ALTER TABLE "public"."integration_webhook_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lab_issues" (
    "id" bigint NOT NULL,
    "client_id" "text" NOT NULL,
    "order_id" "text",
    "kind" "text" NOT NULL,
    "severity" "text" DEFAULT 'high'::"text" NOT NULL,
    "detail" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."lab_issues" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."lab_issues_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."lab_issues_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."lab_issues_id_seq" OWNED BY "public"."lab_issues"."id";



CREATE TABLE IF NOT EXISTS "public"."local_server_heartbeats" (
    "server_id" "text" NOT NULL,
    "restaurant_id" "text" NOT NULL,
    "reported_at" timestamp with time zone NOT NULL,
    "version" "text",
    "protocol_version" "text",
    "platform" "text",
    "uptime_seconds" integer,
    "clients_connected" integer,
    "sync_queue_size" integer,
    "last_sync_at" timestamp with time zone,
    "print_jobs_failed" integer,
    "health_status" "text",
    "disk_free_mb" integer
);


ALTER TABLE "public"."local_server_heartbeats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."memories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agent_id" "text" NOT NULL,
    "content" "text" NOT NULL,
    "salience" double precision DEFAULT 1.0,
    "sector" "text" DEFAULT 'episodic'::"text",
    "mission_context" "text",
    "keywords" "text",
    "client" "text" DEFAULT 'AMALAY'::"text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "accessed_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."memories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ops_daily" (
    "id" bigint NOT NULL,
    "client_id" "text" NOT NULL,
    "fecha" "date" NOT NULL,
    "record_type" "text" NOT NULL,
    "bucket_start" timestamp with time zone,
    "ventas_dia" numeric,
    "ventas_brutas" numeric,
    "descuentos" numeric,
    "devoluciones" numeric,
    "efectivo" numeric,
    "tarjeta" numeric,
    "tickets_count" integer,
    "mesas_atendidas" integer,
    "personas_restaurant" integer,
    "ticket_promedio_restaurant" numeric,
    "propinas_total" numeric,
    "meseros" "jsonb",
    "platillos_top" "jsonb",
    "ventas_por_grupo" "jsonb",
    "pago_metodos" "jsonb",
    "source_system" "text" NOT NULL,
    "generated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "data_freshness" timestamp with time zone,
    "rows_aggregated" integer DEFAULT 0,
    CONSTRAINT "ops_daily_record_type_check" CHECK (("record_type" = ANY (ARRAY['snapshot'::"text", 'cierre'::"text", 'cierre_wansoft'::"text"]))),
    CONSTRAINT "ops_daily_snapshot_has_bucket" CHECK ((("record_type" = 'snapshot'::"text") = ("bucket_start" IS NOT NULL))),
    CONSTRAINT "ops_daily_source_check" CHECK (("source_system" = ANY (ARRAY['wansoft'::"text", 'fullsite'::"text"]))),
    CONSTRAINT "ops_daily_source_record_coherence" CHECK (((("record_type" = 'cierre_wansoft'::"text") AND ("source_system" = 'wansoft'::"text")) OR (("record_type" = ANY (ARRAY['snapshot'::"text", 'cierre'::"text"])) AND ("source_system" = 'fullsite'::"text"))))
);


ALTER TABLE "public"."ops_daily" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_orders" (
    "id" "text" DEFAULT ("gen_random_uuid"())::"text" NOT NULL,
    "client_id" "text",
    "mesa" integer,
    "mesero" "text",
    "personas" integer DEFAULT 1,
    "status" "text" DEFAULT 'abierta'::"text",
    "subtotal" numeric DEFAULT 0,
    "iva" numeric DEFAULT 0,
    "total" numeric DEFAULT 0,
    "descuento" numeric DEFAULT 0,
    "metodo_pago" "text",
    "notas" "text",
    "items" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "closed_at" timestamp with time zone,
    "propina" numeric DEFAULT 0,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "location_id" "text" DEFAULT 'amalay-spgg'::"text",
    "customer_name" "text",
    "order_number" integer,
    "pagos" "jsonb",
    "turno_id" "text",
    "kds_item_status" "jsonb",
    "order_revision" bigint DEFAULT 0 NOT NULL,
    "last_inventory_processed_revision" bigint DEFAULT 0 NOT NULL,
    "last_inventory_complete_revision" bigint DEFAULT 0 NOT NULL,
    "comanda_batches" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "chk_revision_ordering" CHECK ((("order_revision" >= "last_inventory_processed_revision") AND ("last_inventory_processed_revision" >= "last_inventory_complete_revision") AND ("last_inventory_complete_revision" >= 0))),
    CONSTRAINT "orders_require_turno" CHECK (("turno_id" IS NOT NULL))
);


ALTER TABLE "public"."pos_orders" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."ocm_daily" WITH ("security_invoker"='on') AS
 WITH "live" AS (
         SELECT "o"."client_id",
            (("o"."created_at" AT TIME ZONE 'America/Monterrey'::"text"))::"date" AS "fecha",
            'fullsite'::"text" AS "source_system",
            "sum"("o"."total") AS "ventas_dia",
            "sum"((COALESCE("o"."subtotal", (0)::numeric) + COALESCE("o"."iva", (0)::numeric))) AS "ventas_brutas",
            "sum"(COALESCE("o"."descuento", (0)::numeric)) AS "descuentos",
            "sum"(
                CASE
                    WHEN (("o"."metodo_pago" ~~* '%efec%'::"text") AND ("o"."metodo_pago" !~~* '%tarj%'::"text")) THEN "o"."total"
                    ELSE (0)::numeric
                END) AS "efectivo",
            "sum"(
                CASE
                    WHEN (("o"."metodo_pago" ~~* '%tarj%'::"text") AND ("o"."metodo_pago" !~~* '%efec%'::"text")) THEN "o"."total"
                    ELSE (0)::numeric
                END) AS "tarjeta",
            ("count"(*))::integer AS "tickets_count",
            ("count"(DISTINCT "o"."mesa"))::integer AS "mesas_atendidas",
            ("sum"(COALESCE("o"."personas", 0)))::integer AS "personas_restaurant",
            "round"(("sum"("o"."total") / (NULLIF("count"(*), 0))::numeric), 2) AS "ticket_promedio_restaurant",
            "sum"(COALESCE("o"."propina", (0)::numeric)) AS "propinas_total",
            "max"("o"."updated_at") AS "generated_at"
           FROM "public"."pos_orders" "o"
          WHERE ("o"."status" = ANY (ARRAY['cerrada'::"text", 'completada'::"text"]))
          GROUP BY "o"."client_id", ((("o"."created_at" AT TIME ZONE 'America/Monterrey'::"text"))::"date")
        ), "hist" AS (
         SELECT DISTINCT ON ("d"."client_id", "d"."fecha") "d"."client_id",
            "d"."fecha",
            COALESCE("d"."source_system", 'wansoft'::"text") AS "source_system",
            "d"."ventas_dia",
            "d"."ventas_brutas",
            "d"."descuentos",
            "d"."efectivo",
            "d"."tarjeta",
            "d"."tickets_count",
            "d"."mesas_atendidas",
            "d"."personas_restaurant",
            "d"."ticket_promedio_restaurant",
            "d"."propinas_total",
            "d"."generated_at"
           FROM "public"."ops_daily" "d"
          WHERE ("d"."record_type" = ANY (ARRAY['cierre'::"text", 'cierre_wansoft'::"text"]))
          ORDER BY "d"."client_id", "d"."fecha", "d"."generated_at" DESC
        )
 SELECT "live"."client_id",
    "live"."fecha",
    "live"."source_system",
    "live"."ventas_dia",
    "live"."ventas_brutas",
    "live"."descuentos",
    "live"."efectivo",
    "live"."tarjeta",
    "live"."tickets_count",
    "live"."mesas_atendidas",
    "live"."personas_restaurant",
    "live"."ticket_promedio_restaurant",
    "live"."propinas_total",
    "live"."generated_at"
   FROM "live"
UNION ALL
 SELECT "h"."client_id",
    "h"."fecha",
    "h"."source_system",
    "h"."ventas_dia",
    "h"."ventas_brutas",
    "h"."descuentos",
    "h"."efectivo",
    "h"."tarjeta",
    "h"."tickets_count",
    "h"."mesas_atendidas",
    "h"."personas_restaurant",
    "h"."ticket_promedio_restaurant",
    "h"."propinas_total",
    "h"."generated_at"
   FROM "hist" "h"
  WHERE (NOT (EXISTS ( SELECT 1
           FROM "live" "l"
          WHERE (("l"."client_id" = "h"."client_id") AND ("l"."fecha" = "h"."fecha")))));


ALTER VIEW "public"."ocm_daily" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_menu_categories" (
    "id" "text" NOT NULL,
    "client_id" "text",
    "name" "text" NOT NULL,
    "color" "text" DEFAULT 'bg-slate-500'::"text",
    "sort_order" integer DEFAULT 0,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."pos_menu_categories" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_menu_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_menu_items" (
    "id" "text" NOT NULL,
    "client_id" "text",
    "category_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "price" numeric DEFAULT 0,
    "barcode" "text",
    "sort_order" integer DEFAULT 0,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "aplica_2x1" boolean DEFAULT false,
    "aplica_descuento" boolean DEFAULT true,
    "aplica_cortesia" boolean DEFAULT true,
    "recipe_ref" "text"
);


ALTER TABLE "public"."pos_menu_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."pos_menu_items"."recipe_ref" IS 'Canonical lookup key: matches LOWER(pos_recipes_old.menu_item_name). NULL means use fuzzy fallback.';



CREATE OR REPLACE VIEW "public"."ocm_menu_groups" WITH ("security_invoker"='on') AS
 SELECT "o"."client_id",
    (("o"."created_at" AT TIME ZONE 'America/Monterrey'::"text"))::"date" AS "fecha",
    COALESCE("c"."name", "mi"."category_id", 'Sin grupo'::"text") AS "grupo",
    "round"("sum"((("it"."value" ->> 'subtotal'::"text"))::numeric), 2) AS "ventas",
    ("sum"(COALESCE((("it"."value" ->> 'cantidad'::"text"))::numeric, (0)::numeric)))::integer AS "cantidad"
   FROM ((("public"."pos_orders" "o"
     CROSS JOIN LATERAL "jsonb_array_elements"(
        CASE
            WHEN ("jsonb_typeof"("o"."items") = 'array'::"text") THEN "o"."items"
            ELSE '[]'::"jsonb"
        END) "it"("value"))
     LEFT JOIN "public"."pos_menu_items" "mi" ON ((("mi"."id" = ("it"."value" ->> 'menuItemId'::"text")) AND ("mi"."client_id" = "o"."client_id"))))
     LEFT JOIN "public"."pos_menu_categories" "c" ON ((("c"."id" = "mi"."category_id") AND ("c"."client_id" = "o"."client_id"))))
  WHERE ("o"."status" = ANY (ARRAY['cerrada'::"text", 'completada'::"text"]))
  GROUP BY "o"."client_id", ((("o"."created_at" AT TIME ZONE 'America/Monterrey'::"text"))::"date"), COALESCE("c"."name", "mi"."category_id", 'Sin grupo'::"text");


ALTER VIEW "public"."ocm_menu_groups" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."ocm_menu_items" WITH ("security_invoker"='on') AS
 SELECT "o"."client_id",
    (("o"."created_at" AT TIME ZONE 'America/Monterrey'::"text"))::"date" AS "fecha",
    ("it"."value" ->> 'nombre'::"text") AS "platillo",
    ("sum"(COALESCE((("it"."value" ->> 'cantidad'::"text"))::numeric, (0)::numeric)))::integer AS "cantidad",
    "round"("sum"((("it"."value" ->> 'subtotal'::"text"))::numeric), 2) AS "ventas"
   FROM ("public"."pos_orders" "o"
     CROSS JOIN LATERAL "jsonb_array_elements"(
        CASE
            WHEN ("jsonb_typeof"("o"."items") = 'array'::"text") THEN "o"."items"
            ELSE '[]'::"jsonb"
        END) "it"("value"))
  WHERE (("o"."status" = ANY (ARRAY['cerrada'::"text", 'completada'::"text"])) AND (("it"."value" ->> 'nombre'::"text") IS NOT NULL))
  GROUP BY "o"."client_id", ((("o"."created_at" AT TIME ZONE 'America/Monterrey'::"text"))::"date"), ("it"."value" ->> 'nombre'::"text");


ALTER VIEW "public"."ocm_menu_items" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."ocm_waiter_rankings" WITH ("security_invoker"='on') AS
 SELECT "client_id",
    (("created_at" AT TIME ZONE 'America/Monterrey'::"text"))::"date" AS "fecha",
    "mesero",
    "sum"("total") AS "ventas",
    ("count"(*))::integer AS "tickets",
    ("sum"(COALESCE("personas", 0)))::integer AS "personas",
    "round"(("sum"("total") / (NULLIF("count"(*), 0))::numeric), 2) AS "ticket_promedio",
    "sum"(COALESCE("propina", (0)::numeric)) AS "propinas"
   FROM "public"."pos_orders" "o"
  WHERE (("status" = ANY (ARRAY['cerrada'::"text", 'completada'::"text"])) AND ("mesero" IS NOT NULL) AND ("mesero" <> ''::"text"))
  GROUP BY "client_id", ((("created_at" AT TIME ZONE 'America/Monterrey'::"text"))::"date"), "mesero";


ALTER VIEW "public"."ocm_waiter_rankings" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."ops_daily_history" WITH ("security_invoker"='on') AS
 SELECT DISTINCT ON ("client_id", "fecha") "id",
    "client_id",
    "fecha",
    "record_type",
    "bucket_start",
    "ventas_dia",
    "ventas_brutas",
    "descuentos",
    "devoluciones",
    "efectivo",
    "tarjeta",
    "tickets_count",
    "mesas_atendidas",
    "personas_restaurant",
    "ticket_promedio_restaurant",
    "propinas_total",
    "meseros",
    "platillos_top",
    "ventas_por_grupo",
    "pago_metodos",
    "source_system",
    "generated_at",
    "data_freshness",
    "rows_aggregated"
   FROM "public"."ops_daily"
  WHERE ("record_type" = ANY (ARRAY['cierre'::"text", 'cierre_wansoft'::"text"]))
  ORDER BY "client_id", "fecha",
        CASE "record_type"
            WHEN 'cierre'::"text" THEN 1
            WHEN 'cierre_wansoft'::"text" THEN 2
            ELSE NULL::integer
        END;


ALTER VIEW "public"."ops_daily_history" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."ops_daily_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."ops_daily_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."ops_daily_id_seq" OWNED BY "public"."ops_daily"."id";



CREATE OR REPLACE VIEW "public"."ops_daily_live" WITH ("security_invoker"='on') AS
 SELECT DISTINCT ON ("client_id", "fecha") "id",
    "client_id",
    "fecha",
    "record_type",
    "bucket_start",
    "ventas_dia",
    "ventas_brutas",
    "descuentos",
    "devoluciones",
    "efectivo",
    "tarjeta",
    "tickets_count",
    "mesas_atendidas",
    "personas_restaurant",
    "ticket_promedio_restaurant",
    "propinas_total",
    "meseros",
    "platillos_top",
    "ventas_por_grupo",
    "pago_metodos",
    "source_system",
    "generated_at",
    "data_freshness",
    "rows_aggregated",
    "pipeline_fresh"
   FROM ( SELECT "ops_daily"."id",
            "ops_daily"."client_id",
            "ops_daily"."fecha",
            "ops_daily"."record_type",
            "ops_daily"."bucket_start",
            "ops_daily"."ventas_dia",
            "ops_daily"."ventas_brutas",
            "ops_daily"."descuentos",
            "ops_daily"."devoluciones",
            "ops_daily"."efectivo",
            "ops_daily"."tarjeta",
            "ops_daily"."tickets_count",
            "ops_daily"."mesas_atendidas",
            "ops_daily"."personas_restaurant",
            "ops_daily"."ticket_promedio_restaurant",
            "ops_daily"."propinas_total",
            "ops_daily"."meseros",
            "ops_daily"."platillos_top",
            "ops_daily"."ventas_por_grupo",
            "ops_daily"."pago_metodos",
            "ops_daily"."source_system",
            "ops_daily"."generated_at",
            "ops_daily"."data_freshness",
            "ops_daily"."rows_aggregated",
            true AS "pipeline_fresh"
           FROM "public"."ops_daily"
          WHERE ("ops_daily"."record_type" = ANY (ARRAY['cierre'::"text", 'cierre_wansoft'::"text"]))
        UNION ALL
         SELECT "ops_daily"."id",
            "ops_daily"."client_id",
            "ops_daily"."fecha",
            "ops_daily"."record_type",
            "ops_daily"."bucket_start",
            "ops_daily"."ventas_dia",
            "ops_daily"."ventas_brutas",
            "ops_daily"."descuentos",
            "ops_daily"."devoluciones",
            "ops_daily"."efectivo",
            "ops_daily"."tarjeta",
            "ops_daily"."tickets_count",
            "ops_daily"."mesas_atendidas",
            "ops_daily"."personas_restaurant",
            "ops_daily"."ticket_promedio_restaurant",
            "ops_daily"."propinas_total",
            "ops_daily"."meseros",
            "ops_daily"."platillos_top",
            "ops_daily"."ventas_por_grupo",
            "ops_daily"."pago_metodos",
            "ops_daily"."source_system",
            "ops_daily"."generated_at",
            "ops_daily"."data_freshness",
            "ops_daily"."rows_aggregated",
            ("ops_daily"."generated_at" > ("now"() - '00:45:00'::interval)) AS "pipeline_fresh"
           FROM "public"."ops_daily"
          WHERE ("ops_daily"."record_type" = 'snapshot'::"text")) "sub"
  WHERE ("pipeline_fresh" = true)
  ORDER BY "client_id", "fecha",
        CASE
            WHEN ("record_type" = 'cierre'::"text") THEN 1
            WHEN (("record_type" = 'snapshot'::"text") AND "pipeline_fresh") THEN 2
            WHEN ("record_type" = 'cierre_wansoft'::"text") THEN 3
            ELSE NULL::integer
        END, "generated_at" DESC NULLS LAST;


ALTER VIEW "public"."ops_daily_live" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."parity_reports" (
    "id" bigint NOT NULL,
    "day" "date" NOT NULL,
    "ran_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "legacy_ops" integer NOT NULL,
    "event_ops" integer NOT NULL,
    "matched" integer NOT NULL,
    "diffs" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "unaudited_cancellations" integer DEFAULT 0 NOT NULL,
    "ok" boolean NOT NULL
);


ALTER TABLE "public"."parity_reports" OWNER TO "postgres";


ALTER TABLE "public"."parity_reports" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."parity_reports_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."platform_2fa_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "code_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "consumed_at" timestamp with time zone,
    "attempts" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."platform_2fa_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."platform_2fa_enrollment" (
    "user_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "recovery_codes" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "enrolled_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."platform_2fa_enrollment" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."platform_admins" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "user_id" "uuid",
    "name" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."platform_admins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."platform_audit_log" (
    "id" bigint NOT NULL,
    "actor_email" "text" NOT NULL,
    "actor_user_id" "uuid",
    "action" "text" NOT NULL,
    "scope" "text" DEFAULT 'tenant'::"text" NOT NULL,
    "target_tenant" "text",
    "detail" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "affected_count" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "platform_audit_log_scope_check" CHECK (("scope" = ANY (ARRAY['global'::"text", 'tenant'::"text"])))
);


ALTER TABLE "public"."platform_audit_log" OWNER TO "postgres";


ALTER TABLE "public"."platform_audit_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."platform_audit_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."platform_settings" (
    "key" "text" NOT NULL,
    "value" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "description" "text",
    "updated_by" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."platform_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_attendance" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "text" NOT NULL,
    "staff_id" "text" NOT NULL,
    "staff_name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "registered_at" timestamp with time zone DEFAULT "now"(),
    "method" "text" DEFAULT 'pin'::"text",
    "device_id" "text",
    "notes" "text",
    CONSTRAINT "pos_attendance_type_check" CHECK (("type" = ANY (ARRAY['entrada'::"text", 'salida'::"text"])))
);

ALTER TABLE ONLY "public"."pos_attendance" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_attendance" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_audit_log" (
    "id" bigint NOT NULL,
    "client_id" "text",
    "order_id" "text",
    "action" "text" NOT NULL,
    "actor" "text" NOT NULL,
    "mesa" integer,
    "details" "jsonb",
    "reason" "text",
    "approved_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."pos_audit_log" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_audit_log" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pos_audit_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pos_audit_log_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pos_audit_log_id_seq" OWNED BY "public"."pos_audit_log"."id";



CREATE TABLE IF NOT EXISTS "public"."pos_authority_transitions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "text" NOT NULL,
    "direction" "text" NOT NULL,
    "from_authority" "text" NOT NULL,
    "to_authority" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "completed_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "outbox_ready_at" timestamp with time zone,
    "baseline_sequence" integer,
    "shadow_sequence" integer,
    "last_reconciled_sequence" integer,
    "reconciliation_status" "text",
    "initiated_by" "uuid",
    "approved_by" "uuid",
    "failure_reason" "text",
    CONSTRAINT "pat_authorities_differ" CHECK (("from_authority" <> "to_authority")),
    CONSTRAINT "pat_direction_valid" CHECK (("direction" = ANY (ARRAY['activation'::"text", 'rollback'::"text"]))),
    CONSTRAINT "pat_from_authority_valid" CHECK (("from_authority" = ANY (ARRAY['supabase'::"text", 'local_server'::"text"]))),
    CONSTRAINT "pat_reconciliation_status_valid" CHECK ((("reconciliation_status" IS NULL) OR ("reconciliation_status" = ANY (ARRAY['pending'::"text", 'verified'::"text", 'applied'::"text", 'blocked'::"text"])))),
    CONSTRAINT "pat_status_valid" CHECK (("status" = ANY (ARRAY['pending'::"text", 'shadow'::"text", 'completing'::"text", 'completed'::"text", 'cancelled'::"text", 'timed_out'::"text"]))),
    CONSTRAINT "pat_to_authority_valid" CHECK (("to_authority" = ANY (ARRAY['supabase'::"text", 'local_server'::"text"])))
);


ALTER TABLE "public"."pos_authority_transitions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_billing_clients" (
    "id" "text" DEFAULT ("gen_random_uuid"())::"text" NOT NULL,
    "client_id" "text" NOT NULL,
    "nombre" "text" NOT NULL,
    "rfc" "text" NOT NULL,
    "regimen_fiscal" "text",
    "codigo_postal" "text",
    "email" "text",
    "calle" "text",
    "no_interior" "text",
    "no_exterior" "text",
    "colonia" "text",
    "ciudad" "text",
    "estado" "text",
    "pais" "text" DEFAULT 'MEXICO'::"text",
    "uso_cfdi" "text" DEFAULT 'G03'::"text",
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pos_billing_clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_bridge_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "text" NOT NULL,
    "method" "text",
    "url" "text",
    "status" integer,
    "detail" "text",
    "logged_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pos_bridge_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_cash_movements" (
    "id" bigint NOT NULL,
    "client_id" "text",
    "turno_id" "text",
    "type" "text" NOT NULL,
    "amount" numeric NOT NULL,
    "reason" "text" NOT NULL,
    "actor" "text" NOT NULL,
    "approved_by" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "pos_cash_movements_type_check" CHECK (("type" = ANY (ARRAY['retiro'::"text", 'deposito'::"text"])))
);

ALTER TABLE ONLY "public"."pos_cash_movements" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_cash_movements" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pos_cash_movements_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pos_cash_movements_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pos_cash_movements_id_seq" OWNED BY "public"."pos_cash_movements"."id";



CREATE TABLE IF NOT EXISTS "public"."pos_category_modifiers" (
    "id" bigint NOT NULL,
    "client_id" "text",
    "category_id" "text" NOT NULL,
    "modifier_group_id" "text" NOT NULL
);

ALTER TABLE ONLY "public"."pos_category_modifiers" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_category_modifiers" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pos_category_modifiers_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pos_category_modifiers_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pos_category_modifiers_id_seq" OWNED BY "public"."pos_category_modifiers"."id";



CREATE TABLE IF NOT EXISTS "public"."pos_cfdi_requests" (
    "id" "text" NOT NULL,
    "client_id" "text",
    "order_id" "text",
    "rfc" "text" NOT NULL,
    "razon_social" "text" NOT NULL,
    "regimen_fiscal" "text" NOT NULL,
    "uso_cfdi" "text" NOT NULL,
    "codigo_postal" "text" NOT NULL,
    "email" "text" NOT NULL,
    "subtotal" numeric DEFAULT 0,
    "iva" numeric DEFAULT 0,
    "total" numeric DEFAULT 0,
    "status" "text" DEFAULT 'pendiente'::"text",
    "folio_fiscal" "text",
    "pdf_url" "text",
    "xml_url" "text",
    "error_msg" "text",
    "requested_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."pos_cfdi_requests" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_cfdi_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_cierres" (
    "id" "text" NOT NULL,
    "client_id" "text",
    "turno_id" "text",
    "fecha" "date" NOT NULL,
    "fondo_inicial" numeric DEFAULT 0,
    "billetes" "jsonb",
    "monedas" "jsonb",
    "total_contado" numeric DEFAULT 0,
    "efectivo_sistema" numeric DEFAULT 0,
    "tarjeta_sistema" numeric DEFAULT 0,
    "transferencias_sistema" numeric DEFAULT 0,
    "diferencia" numeric DEFAULT 0,
    "total_ventas" numeric DEFAULT 0,
    "tickets_count" integer DEFAULT 0,
    "cancelaciones" integer DEFAULT 0,
    "descuentos" numeric DEFAULT 0,
    "propinas" numeric DEFAULT 0,
    "notas" "text",
    "closed_by" "text",
    "approved_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "cierre_con_ordenes_abiertas" boolean DEFAULT false,
    "ordenes_pendientes" "text"[] DEFAULT '{}'::"text"[],
    "cierre_autorizado_por" "text",
    "cierre_nota" "text"
);

ALTER TABLE ONLY "public"."pos_cierres" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_cierres" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "text" NOT NULL,
    "nombre" "text",
    "apellido" "text",
    "telefono" "text",
    "email" "text",
    "cumpleanos" "text",
    "visitas" integer DEFAULT 0,
    "ultima_visita" "text",
    "gasto_total" numeric DEFAULT 0,
    "gasto_por_visita" numeric DEFAULT 0,
    "tags" "text",
    "notas" "text",
    "idioma" "text" DEFAULT 'Español'::"text",
    "source" "text" DEFAULT 'reservy'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pos_clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_combos" (
    "id" "text" NOT NULL,
    "client_id" "text",
    "name" "text" NOT NULL,
    "items" "jsonb" NOT NULL,
    "price" numeric NOT NULL,
    "upsell" "jsonb",
    "active" boolean DEFAULT true,
    "schedule" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."pos_combos" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_combos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_customer_notes" (
    "id" "text" NOT NULL,
    "client_id" "text",
    "mesa" integer NOT NULL,
    "note" "text" NOT NULL,
    "type" "text" DEFAULT 'general'::"text",
    "created_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."pos_customer_notes" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_customer_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_customer_visits" (
    "id" bigint NOT NULL,
    "client_id" "text" NOT NULL,
    "customer_id" bigint NOT NULL,
    "order_id" "uuid",
    "amount" numeric DEFAULT 0 NOT NULL,
    "items_count" integer DEFAULT 0 NOT NULL,
    "visited_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pos_customer_visits" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pos_customer_visits_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pos_customer_visits_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pos_customer_visits_id_seq" OWNED BY "public"."pos_customer_visits"."id";



CREATE TABLE IF NOT EXISTS "public"."pos_customers" (
    "id" bigint NOT NULL,
    "client_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "phone" "text",
    "email" "text",
    "notes" "text",
    "total_visits" integer DEFAULT 0 NOT NULL,
    "total_spent" numeric DEFAULT 0 NOT NULL,
    "avg_ticket" numeric DEFAULT 0 NOT NULL,
    "last_visit" timestamp with time zone,
    "first_visit" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "birthday" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pos_customers" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pos_customers_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pos_customers_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pos_customers_id_seq" OWNED BY "public"."pos_customers"."id";



CREATE TABLE IF NOT EXISTS "public"."pos_delivery_zones" (
    "id" "text" DEFAULT ("gen_random_uuid"())::"text" NOT NULL,
    "client_id" "text",
    "name" "text" NOT NULL,
    "min_order" numeric DEFAULT 0,
    "delivery_fee" numeric DEFAULT 0,
    "delivery_time" "text",
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pos_delivery_zones" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_facturas" (
    "id" "text" NOT NULL,
    "client_id" "text",
    "purchase_order_id" "text",
    "supplier" "text" NOT NULL,
    "folio" "text",
    "subtotal" numeric DEFAULT 0,
    "iva" numeric DEFAULT 0,
    "total" numeric DEFAULT 0,
    "status" "text" DEFAULT 'capturada'::"text",
    "captured_by" "text" NOT NULL,
    "approved_by" "text",
    "paid_at" timestamp with time zone,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "payment_terms" integer DEFAULT 15,
    "due_date" "date",
    "uuid_sat" "text"
);


ALTER TABLE "public"."pos_facturas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_fingerprint_templates" (
    "id" "text" NOT NULL,
    "client_id" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "template" "text"
);


ALTER TABLE "public"."pos_fingerprint_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_gastos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "text" NOT NULL,
    "tipo" "text" DEFAULT 'factura'::"text" NOT NULL,
    "proveedor" "text" NOT NULL,
    "concepto" "text",
    "subtotal" numeric DEFAULT 0,
    "iva" numeric DEFAULT 0,
    "total" numeric DEFAULT 0,
    "fecha" "date" DEFAULT CURRENT_DATE NOT NULL,
    "fecha_pago" "date",
    "status" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "categoria" "text" DEFAULT 'Otros'::"text",
    "notas" "text",
    "xml_data" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."pos_gastos" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_gastos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_gift_cards" (
    "id" "text" DEFAULT ("gen_random_uuid"())::"text" NOT NULL,
    "client_id" "text",
    "code" "text" NOT NULL,
    "balance" numeric DEFAULT 0,
    "original_amount" numeric DEFAULT 0,
    "status" "text" DEFAULT 'active'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pos_gift_cards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_ingredient_presentations" (
    "id" bigint NOT NULL,
    "client_id" "text" NOT NULL,
    "ingredient_id" "text" NOT NULL,
    "presentation_id" "text" NOT NULL,
    "contains_quantity" numeric NOT NULL,
    "contains_unit" "text" NOT NULL,
    "cost_per_presentation" numeric DEFAULT 0,
    "supplier_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "chk_ip_cost_non_negative" CHECK (("cost_per_presentation" >= (0)::numeric)),
    CONSTRAINT "chk_ip_quantity_positive" CHECK (("contains_quantity" > (0)::numeric)),
    CONSTRAINT "chk_ip_unit_not_empty" CHECK (("contains_unit" <> ''::"text"))
);


ALTER TABLE "public"."pos_ingredient_presentations" OWNER TO "postgres";


COMMENT ON TABLE "public"."pos_ingredient_presentations" IS 'Vinculo producto-presentacion con equivalencia. Ej: ACEITE OLIVA en BOTE 3.8LT = 3.8 LT.';



CREATE SEQUENCE IF NOT EXISTS "public"."pos_ingredient_presentations_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pos_ingredient_presentations_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pos_ingredient_presentations_id_seq" OWNED BY "public"."pos_ingredient_presentations"."id";



CREATE TABLE IF NOT EXISTS "public"."pos_ingredients" (
    "id" "text" NOT NULL,
    "client_id" "text",
    "name" "text" NOT NULL,
    "unit" "text" NOT NULL,
    "cost_per_unit" numeric DEFAULT 0,
    "category" "text",
    "supplier" "text",
    "yield_factor" numeric DEFAULT 1,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "product_type" "text" DEFAULT 'materia_prima'::"text",
    "department" "text",
    "is_critical" boolean DEFAULT false,
    "sale_price" numeric DEFAULT 0,
    "sat_product_key" "text",
    "sat_unit_key" "text",
    CONSTRAINT "chk_product_type_valid" CHECK (("product_type" = ANY (ARRAY['materia_prima'::"text", 'producto_terminado'::"text", 'subproducto'::"text", 'indirecto'::"text"]))),
    CONSTRAINT "chk_yield_factor_positive" CHECK (("yield_factor" > (0)::numeric))
);

ALTER TABLE ONLY "public"."pos_ingredients" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_ingredients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_insumos" (
    "id" bigint NOT NULL,
    "client_id" "text",
    "nombre" "text" NOT NULL,
    "categoria" "text",
    "merma_pct" numeric DEFAULT 0,
    "rendimiento_pct" numeric DEFAULT 0,
    "proveedor" "text",
    "um" "text",
    "precio_presentacion" numeric DEFAULT 0,
    "precio_limpio" numeric DEFAULT 0,
    "source" "text" DEFAULT 'excel'::"text",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pos_insumos" OWNER TO "postgres";


ALTER TABLE "public"."pos_insumos" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."pos_insumos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."pos_inventory" (
    "id" bigint NOT NULL,
    "client_id" "text",
    "ingredient_id" "text" NOT NULL,
    "stock" numeric DEFAULT 0 NOT NULL,
    "reorder_point" numeric DEFAULT 0,
    "reorder_quantity" numeric DEFAULT 0,
    "last_restock" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "stock_unit" "text",
    CONSTRAINT "pos_inventory_stock_unit_check" CHECK ((("stock_unit" IS NULL) OR ("stock_unit" = ANY (ARRAY['kg'::"text", 'g'::"text", 'lt'::"text", 'ml'::"text", 'pz'::"text"]))))
);


ALTER TABLE "public"."pos_inventory" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_inventory_alerts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "text" NOT NULL,
    "message" "text" NOT NULL,
    "order_id" "text",
    "actor" "text",
    "resolved" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pos_inventory_alerts" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pos_inventory_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pos_inventory_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pos_inventory_id_seq" OWNED BY "public"."pos_inventory"."id";



CREATE TABLE IF NOT EXISTS "public"."pos_inventory_movements" (
    "id" bigint NOT NULL,
    "client_id" "text",
    "product_id" bigint,
    "movement_type" "text" NOT NULL,
    "quantity" numeric NOT NULL,
    "order_id" "uuid",
    "actor" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "ingredient_id" "text",
    "reconciliation_result_id" bigint,
    "mutation_revision" integer
);

ALTER TABLE ONLY "public"."pos_inventory_movements" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_inventory_movements" OWNER TO "postgres";


COMMENT ON COLUMN "public"."pos_inventory_movements"."product_id" IS 'Target column — maps to pos_inventory_products.id (BIGINT). Currently nullable during legacy compatibility period.';



COMMENT ON COLUMN "public"."pos_inventory_movements"."ingredient_id" IS 'COMPAT BRIDGE: temporary column — maps to pos_ingredients.id (TEXT). Will be removed when full inventory migration to pos_inventory_products is complete.';



CREATE SEQUENCE IF NOT EXISTS "public"."pos_inventory_movements_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pos_inventory_movements_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pos_inventory_movements_id_seq" OWNED BY "public"."pos_inventory_movements"."id";



CREATE TABLE IF NOT EXISTS "public"."pos_inventory_products" (
    "id" bigint NOT NULL,
    "client_id" "text",
    "name" "text" NOT NULL,
    "unit" "text" NOT NULL,
    "cost_per_unit" numeric,
    "stock" numeric DEFAULT 0 NOT NULL,
    "reorder_point" numeric DEFAULT 0,
    "category" "text",
    "active" boolean DEFAULT true,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pos_inventory_products" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pos_inventory_products_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pos_inventory_products_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pos_inventory_products_id_seq" OWNED BY "public"."pos_inventory_products"."id";



CREATE TABLE IF NOT EXISTS "public"."pos_item_inventory_policy" (
    "id" bigint NOT NULL,
    "client_id" "text" NOT NULL,
    "menu_item_id" "text" NOT NULL,
    "inventory_mode" "text" DEFAULT 'unclassified'::"text" NOT NULL,
    "market_stock_id" bigint,
    "approved_at" timestamp with time zone,
    "approved_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "pos_item_inventory_policy_check" CHECK (((("inventory_mode" = 'direct_stock'::"text") AND ("market_stock_id" IS NOT NULL)) OR (("inventory_mode" <> 'direct_stock'::"text") AND ("market_stock_id" IS NULL)))),
    CONSTRAINT "pos_item_inventory_policy_check1" CHECK ((("inventory_mode" = 'unclassified'::"text") OR (("inventory_mode" = ANY (ARRAY['recipe'::"text", 'direct_stock'::"text", 'non_inventory'::"text"])) AND ("approved_at" IS NOT NULL) AND ("approved_by" IS NOT NULL)))),
    CONSTRAINT "pos_item_inventory_policy_inventory_mode_check" CHECK (("inventory_mode" = ANY (ARRAY['recipe'::"text", 'direct_stock'::"text", 'non_inventory'::"text", 'unclassified'::"text"])))
);


ALTER TABLE "public"."pos_item_inventory_policy" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pos_item_inventory_policy_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pos_item_inventory_policy_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pos_item_inventory_policy_id_seq" OWNED BY "public"."pos_item_inventory_policy"."id";



CREATE TABLE IF NOT EXISTS "public"."pos_item_modifier_groups" (
    "client_id" "text" NOT NULL,
    "item_id" "text" NOT NULL,
    "group_id" "text" NOT NULL
);


ALTER TABLE "public"."pos_item_modifier_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_local_events" (
    "id" "uuid" NOT NULL,
    "sequence" integer NOT NULL,
    "type" "text" NOT NULL,
    "ts" bigint NOT NULL,
    "terminal_id" "uuid",
    "restaurant_id" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    CONSTRAINT "pos_local_events_type_not_state_sync" CHECK (("type" <> 'STATE_SYNC'::"text"))
);


ALTER TABLE "public"."pos_local_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_market_movements" (
    "id" bigint NOT NULL,
    "client_id" "text",
    "menu_item_id" "text" NOT NULL,
    "movement_type" "text" NOT NULL,
    "quantity" numeric NOT NULL,
    "order_id" "text",
    "actor" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "reconciliation_result_id" bigint,
    "mutation_revision" integer
);


ALTER TABLE "public"."pos_market_movements" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pos_market_movements_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pos_market_movements_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pos_market_movements_id_seq" OWNED BY "public"."pos_market_movements"."id";



CREATE TABLE IF NOT EXISTS "public"."pos_market_stock" (
    "id" bigint NOT NULL,
    "client_id" "text",
    "menu_item_id" "text" NOT NULL,
    "stock" numeric DEFAULT 0 NOT NULL,
    "reorder_point" numeric DEFAULT 0,
    "reorder_quantity" numeric DEFAULT 0,
    "last_restock" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pos_market_stock" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pos_market_stock_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pos_market_stock_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pos_market_stock_id_seq" OWNED BY "public"."pos_market_stock"."id";



CREATE TABLE IF NOT EXISTS "public"."pos_menu_item_recipes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "text" NOT NULL,
    "menu_item_name" "text" NOT NULL,
    "recipe_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "text" DEFAULT 'seed'::"text" NOT NULL
);


ALTER TABLE "public"."pos_menu_item_recipes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_mesas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "text" NOT NULL,
    "number" integer NOT NULL,
    "capacity" integer DEFAULT 4 NOT NULL,
    "zone" "text",
    "x_pct" numeric(6,2) NOT NULL,
    "y_pct" numeric(6,2) NOT NULL,
    "shape" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."pos_mesas" OWNER TO "postgres";


COMMENT ON TABLE "public"."pos_mesas" IS 'Physical floor plan per client: one row per table.';



CREATE TABLE IF NOT EXISTS "public"."pos_modifier_groups" (
    "id" "text" NOT NULL,
    "client_id" "text",
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "level" integer DEFAULT 1 NOT NULL,
    "min_selections" integer DEFAULT 0 NOT NULL,
    "max_selections" integer,
    "required" boolean DEFAULT false NOT NULL
);

ALTER TABLE ONLY "public"."pos_modifier_groups" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_modifier_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_modifiers" (
    "id" "text" NOT NULL,
    "client_id" "text",
    "group_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "price" numeric DEFAULT 0,
    "sort_order" integer DEFAULT 0,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."pos_modifiers" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_modifiers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_mutation_authority" (
    "client_id" "text" NOT NULL,
    "sale_authority" "text" DEFAULT 'legacy'::"text" NOT NULL,
    "cutover_at" timestamp with time zone,
    "cutover_by" "text",
    CONSTRAINT "pos_mutation_authority_sale_authority_check" CHECK (("sale_authority" = ANY (ARRAY['legacy'::"text", 'paused'::"text", 'r1'::"text"])))
);


ALTER TABLE "public"."pos_mutation_authority" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_payment_methods" (
    "id" "text" DEFAULT ("gen_random_uuid"())::"text" NOT NULL,
    "client_id" "text",
    "name" "text" NOT NULL,
    "type" "text" DEFAULT 'cash'::"text",
    "commission_pct" numeric DEFAULT 0,
    "fiscal_code" "text" DEFAULT ''::"text",
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."pos_payment_methods" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_payment_methods" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_presentations" (
    "id" "text" DEFAULT ('pres-'::"text" || ("gen_random_uuid"())::"text") NOT NULL,
    "client_id" "text" NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "chk_pres_code_not_empty" CHECK (("code" <> ''::"text"))
);


ALTER TABLE "public"."pos_presentations" OWNER TO "postgres";


COMMENT ON TABLE "public"."pos_presentations" IS 'Presentaciones COMERCIALES de compra (CAJA 15KG, BIDON 20LT). NO son conversiones fisicas.';



CREATE TABLE IF NOT EXISTS "public"."pos_price_types" (
    "id" "text" DEFAULT ("gen_random_uuid"())::"text" NOT NULL,
    "client_id" "text",
    "name" "text" NOT NULL,
    "multiplier" numeric DEFAULT 1,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pos_price_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_print_jobs" (
    "id" "text" NOT NULL,
    "client_id" "text",
    "order_id" "text",
    "station" "text" NOT NULL,
    "type" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "retries" integer DEFAULT 0,
    "error" "text",
    "meta" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "printed_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."pos_print_jobs" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_print_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_promos" (
    "id" "text" NOT NULL,
    "client_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" DEFAULT 'percentage'::"text" NOT NULL,
    "value" numeric DEFAULT 0 NOT NULL,
    "min_items" integer DEFAULT 1,
    "applies_to" "jsonb" DEFAULT '[]'::"jsonb",
    "schedule" "jsonb",
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pos_promos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_promotions" (
    "id" "text" NOT NULL,
    "client_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "value" numeric(12,2) DEFAULT 0,
    "applies_to" "text" DEFAULT 'order'::"text",
    "category_ids" "jsonb" DEFAULT '[]'::"jsonb",
    "item_ids" "jsonb" DEFAULT '[]'::"jsonb",
    "schedule" "jsonb" DEFAULT '{}'::"jsonb",
    "auto_apply" boolean DEFAULT false,
    "max_per_day" integer,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."pos_promotions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_promotions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_purchase_order_items" (
    "id" bigint NOT NULL,
    "order_id" "text" NOT NULL,
    "ingredient_id" "text" NOT NULL,
    "ingredient_name" "text" NOT NULL,
    "quantity_ordered" numeric NOT NULL,
    "quantity_received" numeric,
    "unit" "text" NOT NULL,
    "unit_cost" numeric DEFAULT 0,
    "total_cost" numeric DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pos_purchase_order_items" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pos_purchase_order_items_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pos_purchase_order_items_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pos_purchase_order_items_id_seq" OWNED BY "public"."pos_purchase_order_items"."id";



CREATE TABLE IF NOT EXISTS "public"."pos_purchase_orders" (
    "id" "text" NOT NULL,
    "client_id" "text",
    "supplier" "text" NOT NULL,
    "status" "text" DEFAULT 'borrador'::"text",
    "created_by" "text" NOT NULL,
    "approved_by" "text",
    "notes" "text",
    "subtotal" numeric DEFAULT 0,
    "iva" numeric DEFAULT 0,
    "total" numeric DEFAULT 0,
    "ai_suggested" boolean DEFAULT false,
    "sent_at" timestamp with time zone,
    "received_at" timestamp with time zone,
    "received_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pos_purchase_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_recipe_details" (
    "id" "text" NOT NULL,
    "client_id" "text",
    "name" "text" NOT NULL,
    "category" "text",
    "portion_size" "text",
    "prep_time" "text",
    "cook_time" "text",
    "serving_temp" "text",
    "plate" "text",
    "presentation" "text",
    "elaboration" "text",
    "equipment" "text",
    "allergens" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pos_recipe_details" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_recipe_lines" (
    "id" bigint NOT NULL,
    "client_id" "text" NOT NULL,
    "recipe_version_id" bigint NOT NULL,
    "ingredient_id" "text" NOT NULL,
    "quantity" numeric NOT NULL,
    "recipe_unit" "text",
    CONSTRAINT "pos_recipe_lines_quantity_check" CHECK (("quantity" > (0)::numeric)),
    CONSTRAINT "pos_recipe_lines_recipe_unit_check" CHECK ((("recipe_unit" IS NULL) OR ("recipe_unit" = ANY (ARRAY['kg'::"text", 'g'::"text", 'lt'::"text", 'ml'::"text", 'pz'::"text"]))))
);


ALTER TABLE "public"."pos_recipe_lines" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pos_recipe_lines_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pos_recipe_lines_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pos_recipe_lines_id_seq" OWNED BY "public"."pos_recipe_lines"."id";



CREATE TABLE IF NOT EXISTS "public"."pos_recipe_versions" (
    "id" bigint NOT NULL,
    "client_id" "text" NOT NULL,
    "menu_item_id" "text" NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "active" boolean DEFAULT false NOT NULL,
    "source" "text" NOT NULL,
    "source_batch" "text",
    "notes" "text",
    "created_by" "text" NOT NULL,
    "activated_by" "text",
    "deactivated_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "activated_at" timestamp with time zone,
    "deactivated_at" timestamp with time zone,
    CONSTRAINT "pos_recipe_versions_check" CHECK (((("active" = false) AND ("activated_at" IS NULL) AND ("activated_by" IS NULL) AND ("deactivated_at" IS NULL) AND ("deactivated_by" IS NULL)) OR (("active" = true) AND ("activated_at" IS NOT NULL) AND ("activated_by" IS NOT NULL) AND ("deactivated_at" IS NULL) AND ("deactivated_by" IS NULL)) OR (("active" = false) AND ("activated_at" IS NOT NULL) AND ("activated_by" IS NOT NULL) AND ("deactivated_at" IS NOT NULL) AND ("deactivated_by" IS NOT NULL))))
);


ALTER TABLE "public"."pos_recipe_versions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pos_recipe_versions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pos_recipe_versions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pos_recipe_versions_id_seq" OWNED BY "public"."pos_recipe_versions"."id";



CREATE TABLE IF NOT EXISTS "public"."pos_recipes" (
    "id" bigint NOT NULL,
    "client_id" "text",
    "nombre" "text" NOT NULL,
    "precio_venta" numeric DEFAULT 0,
    "costo_total" numeric DEFAULT 0,
    "pct_costo" numeric DEFAULT 0,
    "ingredientes" "jsonb" DEFAULT '[]'::"jsonb",
    "source" "text" DEFAULT 'excel'::"text",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pos_recipes" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."pos_recipes_canonical" WITH ("security_invoker"='on') AS
 SELECT "v"."client_id",
    "v"."menu_item_id",
    "m"."name" AS "menu_item_name",
    "l"."ingredient_id",
    "l"."quantity",
    "inv"."stock_unit",
    "l"."recipe_unit"
   FROM ((("public"."pos_recipe_versions" "v"
     JOIN "public"."pos_recipe_lines" "l" ON ((("l"."recipe_version_id" = "v"."id") AND ("l"."client_id" = "v"."client_id"))))
     JOIN "public"."pos_menu_items" "m" ON ((("m"."id" = "v"."menu_item_id") AND ("m"."client_id" = "v"."client_id"))))
     JOIN "public"."pos_inventory" "inv" ON ((("inv"."client_id" = "v"."client_id") AND ("inv"."ingredient_id" = "l"."ingredient_id"))))
  WHERE ("v"."active" = true);


ALTER VIEW "public"."pos_recipes_canonical" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_recipes_old" (
    "id" bigint NOT NULL,
    "client_id" "text",
    "menu_item_id" "text" NOT NULL,
    "menu_item_name" "text" NOT NULL,
    "ingredient_id" "text" NOT NULL,
    "quantity" numeric NOT NULL,
    "unit" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "ingredient_type" "text" DEFAULT 'ingredient'::"text",
    CONSTRAINT "chk_recipe_ingredient_type" CHECK (("ingredient_type" = ANY (ARRAY['ingredient'::"text", 'sub_recipe'::"text"])))
);

ALTER TABLE ONLY "public"."pos_recipes_old" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_recipes_old" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pos_recipes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pos_recipes_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pos_recipes_id_seq" OWNED BY "public"."pos_recipes_old"."id";



ALTER TABLE "public"."pos_recipes" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."pos_recipes_id_seq1"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."pos_reconciliation_results" (
    "id" bigint NOT NULL,
    "client_id" "text" NOT NULL,
    "order_id" "text" NOT NULL,
    "order_item_id" "text" NOT NULL,
    "menu_item_id" "text" NOT NULL,
    "result" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "cantidad" numeric DEFAULT 0 NOT NULL,
    "pinned_mode" "text",
    "pinned_recipe_version_id" bigint,
    "pinned_market_stock_id" bigint,
    "applied_consumption" numeric DEFAULT 0 NOT NULL,
    "last_mutation_revision" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "pos_reconciliation_results_check" CHECK (((("pinned_mode" IS NULL) AND ("pinned_recipe_version_id" IS NULL) AND ("pinned_market_stock_id" IS NULL)) OR (("pinned_mode" = 'recipe'::"text") AND ("pinned_recipe_version_id" IS NOT NULL) AND ("pinned_market_stock_id" IS NULL)) OR (("pinned_mode" = 'direct_stock'::"text") AND ("pinned_market_stock_id" IS NOT NULL) AND ("pinned_recipe_version_id" IS NULL)) OR (("pinned_mode" = 'non_inventory'::"text") AND ("pinned_recipe_version_id" IS NULL) AND ("pinned_market_stock_id" IS NULL)))),
    CONSTRAINT "pos_reconciliation_results_pinned_mode_check" CHECK ((("pinned_mode" IS NULL) OR ("pinned_mode" = ANY (ARRAY['recipe'::"text", 'direct_stock'::"text", 'non_inventory'::"text"])))),
    CONSTRAINT "pos_reconciliation_results_result_check" CHECK (("result" = ANY (ARRAY['PENDING'::"text", 'RECONCILED'::"text", 'NO_MUTATION_APPROVED'::"text", 'BLOCKED_UNCLASSIFIED'::"text", 'BLOCKED_OWNER_MISSING'::"text", 'BLOCKED_TARGET_MISSING'::"text", 'BLOCKED_RECIPE_MISSING'::"text", 'BLOCKED_UNIT_MISSING'::"text", 'BLOCKED_MUTATION_FAILED'::"text"])))
);


ALTER TABLE "public"."pos_reconciliation_results" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pos_reconciliation_results_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pos_reconciliation_results_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pos_reconciliation_results_id_seq" OWNED BY "public"."pos_reconciliation_results"."id";



CREATE TABLE IF NOT EXISTS "public"."pos_retail_groups" (
    "id" "text" DEFAULT ("gen_random_uuid"())::"text" NOT NULL,
    "client_id" "text",
    "name" "text" NOT NULL,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pos_retail_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_retail_items" (
    "id" "text" DEFAULT ("gen_random_uuid"())::"text" NOT NULL,
    "client_id" "text",
    "name" "text" NOT NULL,
    "code" "text",
    "department" "text",
    "price" numeric DEFAULT 0,
    "cost" numeric DEFAULT 0,
    "stock" numeric DEFAULT 0,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pos_retail_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_retail_promotions" (
    "id" "text" DEFAULT ("gen_random_uuid"())::"text" NOT NULL,
    "client_id" "text",
    "name" "text" NOT NULL,
    "type" "text" DEFAULT 'percentage'::"text",
    "value" numeric DEFAULT 0,
    "start_date" "date",
    "end_date" "date",
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pos_retail_promotions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_save_operations" (
    "client_id" "text" NOT NULL,
    "order_id" "text" NOT NULL,
    "save_operation_id" "text" NOT NULL,
    "payload_hash" "text" NOT NULL,
    "state" "text" DEFAULT 'EXECUTING'::"text" NOT NULL,
    "committed_revision" bigint,
    "rejection_detail" "text",
    "rejection_expected" bigint,
    "rejection_current" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "chk_save_op_committed" CHECK (((("state" = 'COMMITTED'::"text") AND ("committed_revision" IS NOT NULL) AND ("rejection_detail" IS NULL)) OR (("state" = 'REJECTED'::"text") AND ("committed_revision" IS NULL) AND ("rejection_detail" IS NOT NULL)) OR (("state" = 'EXECUTING'::"text") AND ("committed_revision" IS NULL) AND ("rejection_detail" IS NULL)))),
    CONSTRAINT "chk_save_op_state" CHECK (("state" = ANY (ARRAY['EXECUTING'::"text", 'COMMITTED'::"text", 'REJECTED'::"text"])))
);


ALTER TABLE "public"."pos_save_operations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_schedules" (
    "id" "text" DEFAULT ("gen_random_uuid"())::"text" NOT NULL,
    "client_id" "text",
    "name" "text" NOT NULL,
    "start_time" time without time zone,
    "end_time" time without time zone,
    "days" "text"[] DEFAULT '{}'::"text"[],
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pos_schedules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "staff_id" "text" NOT NULL,
    "staff_name" "text" NOT NULL,
    "terminal_id" "text" NOT NULL,
    "client_id" "text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_heartbeat" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pos_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_sizes" (
    "id" "text" DEFAULT ("gen_random_uuid"())::"text" NOT NULL,
    "client_id" "text",
    "name" "text" NOT NULL,
    "multiplier" numeric DEFAULT 1,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pos_sizes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_staff" (
    "id" "text" DEFAULT ("gen_random_uuid"())::"text" NOT NULL,
    "client_id" "text",
    "name" "text" NOT NULL,
    "pin" "text" NOT NULL,
    "role" "text" DEFAULT 'mesero'::"text" NOT NULL,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "hourly_rate" numeric DEFAULT 0,
    "weekly_salary" numeric DEFAULT 0,
    "role_display" "text" DEFAULT 'mesero'::"text",
    CONSTRAINT "pos_staff_pin_len_chk" CHECK (("pin" ~ '^[0-9]{4,10}$'::"text"))
);


ALTER TABLE "public"."pos_staff" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_staff_audit" (
    "id" bigint NOT NULL,
    "client_id" "text",
    "staff_id" "text" NOT NULL,
    "action" "text" NOT NULL,
    "changed_fields" "jsonb",
    "changed_by" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pos_staff_audit" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pos_staff_audit_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pos_staff_audit_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pos_staff_audit_id_seq" OWNED BY "public"."pos_staff_audit"."id";



CREATE TABLE IF NOT EXISTS "public"."pos_staff_shifts" (
    "id" "text" NOT NULL,
    "client_id" "text",
    "staff_id" "text" NOT NULL,
    "staff_name" "text" NOT NULL,
    "clock_in" timestamp with time zone NOT NULL,
    "clock_out" timestamp with time zone,
    "breaks" "jsonb" DEFAULT '[]'::"jsonb",
    "hours_worked" numeric,
    "orders_count" integer DEFAULT 0,
    "sales_total" numeric DEFAULT 0,
    "tips_total" numeric DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."pos_staff_shifts" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_staff_shifts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_sub_recipe_ingredients" (
    "id" bigint NOT NULL,
    "sub_recipe_id" "text" NOT NULL,
    "ingredient_id" "text" NOT NULL,
    "ingredient_type" "text" DEFAULT 'ingredient'::"text" NOT NULL,
    "quantity" numeric NOT NULL,
    "unit" "text" DEFAULT 'KG'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "chk_sri_no_self_ref" CHECK ((("ingredient_type" <> 'sub_recipe'::"text") OR ("ingredient_id" <> "sub_recipe_id"))),
    CONSTRAINT "chk_sri_quantity_positive" CHECK (("quantity" > (0)::numeric)),
    CONSTRAINT "chk_sri_type" CHECK (("ingredient_type" = ANY (ARRAY['ingredient'::"text", 'sub_recipe'::"text"]))),
    CONSTRAINT "chk_sri_unit_not_empty" CHECK (("unit" <> ''::"text"))
);


ALTER TABLE "public"."pos_sub_recipe_ingredients" OWNER TO "postgres";


COMMENT ON COLUMN "public"."pos_sub_recipe_ingredients"."ingredient_type" IS 'ingredient = materia prima de pos_ingredients, sub_recipe = otra sub-receta de pos_sub_recipes';



COMMENT ON CONSTRAINT "chk_sri_no_self_ref" ON "public"."pos_sub_recipe_ingredients" IS 'Impide self-reference directa. Ciclos indirectos se validan en API server-side.';



CREATE SEQUENCE IF NOT EXISTS "public"."pos_sub_recipe_ingredients_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pos_sub_recipe_ingredients_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pos_sub_recipe_ingredients_id_seq" OWNED BY "public"."pos_sub_recipe_ingredients"."id";



CREATE TABLE IF NOT EXISTS "public"."pos_sub_recipes" (
    "id" "text" DEFAULT ('sub-'::"text" || ("gen_random_uuid"())::"text") NOT NULL,
    "client_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "yield_quantity" numeric DEFAULT 1 NOT NULL,
    "yield_unit" "text" DEFAULT 'KG'::"text" NOT NULL,
    "notes" "text",
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "chk_sub_yield_positive" CHECK (("yield_quantity" > (0)::numeric)),
    CONSTRAINT "chk_sub_yield_unit_not_empty" CHECK (("yield_unit" <> ''::"text"))
);


ALTER TABLE "public"."pos_sub_recipes" OWNER TO "postgres";


COMMENT ON TABLE "public"."pos_sub_recipes" IS 'Sub-recetas (salsas, bases, preparaciones). Costo SIEMPRE derivado, nunca persistido.';



CREATE TABLE IF NOT EXISTS "public"."pos_suppliers" (
    "id" "text" NOT NULL,
    "client_id" "text",
    "name" "text" NOT NULL,
    "contact" "text",
    "phone" "text",
    "email" "text",
    "authorized" boolean DEFAULT true,
    "authorized_by" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "payment_terms" integer DEFAULT 15,
    "delivery_days" integer DEFAULT 1,
    "rfc" "text",
    "giro" "text",
    "clave_wansoft" "text",
    "category" "text",
    "invoice_count" integer DEFAULT 0,
    "invoice_total" numeric DEFAULT 0,
    "expense_type" "text",
    "invoice_period" "text"
);

ALTER TABLE ONLY "public"."pos_suppliers" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_suppliers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_survey" (
    "id" bigint NOT NULL,
    "q1_como_consigues_dato" "text",
    "q2_que_preguntarias" "text",
    "q3_cuanto_pagarias" "text",
    "nombre" "text",
    "restaurante" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pos_survey" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pos_survey_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pos_survey_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pos_survey_id_seq" OWNED BY "public"."pos_survey"."id";



CREATE TABLE IF NOT EXISTS "public"."pos_time_clock" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "text" NOT NULL,
    "staff_id" "text" NOT NULL,
    "staff_name" "text",
    "type" "text" NOT NULL,
    "method" "text" DEFAULT 'pin'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pos_time_clock_type_check" CHECK (("type" = ANY (ARRAY['entrada'::"text", 'salida'::"text"])))
);


ALTER TABLE "public"."pos_time_clock" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_turnos" (
    "id" "text" NOT NULL,
    "client_id" "text",
    "opened_by" "text" NOT NULL,
    "fondo_inicial" numeric DEFAULT 0 NOT NULL,
    "opened_at" timestamp with time zone DEFAULT "now"(),
    "closed_by" "text",
    "fondo_final" numeric,
    "efectivo_sistema" numeric,
    "diferencia" numeric,
    "closed_at" timestamp with time zone,
    "notas" "text"
);

ALTER TABLE ONLY "public"."pos_turnos" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_turnos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_unit_conversions" (
    "id" bigint NOT NULL,
    "client_id" "text" NOT NULL,
    "from_unit" "text" NOT NULL,
    "to_unit" "text" NOT NULL,
    "factor" numeric NOT NULL,
    "is_system" boolean DEFAULT false,
    CONSTRAINT "chk_uc_different_units" CHECK (("from_unit" <> "to_unit")),
    CONSTRAINT "chk_uc_factor_positive" CHECK (("factor" > (0)::numeric)),
    CONSTRAINT "chk_uc_units_not_empty" CHECK ((("from_unit" <> ''::"text") AND ("to_unit" <> ''::"text")))
);


ALTER TABLE "public"."pos_unit_conversions" OWNER TO "postgres";


COMMENT ON TABLE "public"."pos_unit_conversions" IS 'Conversiones FISICAS entre unidades. NO mezclar con presentaciones comerciales.';



CREATE SEQUENCE IF NOT EXISTS "public"."pos_unit_conversions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pos_unit_conversions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pos_unit_conversions_id_seq" OWNED BY "public"."pos_unit_conversions"."id";



CREATE TABLE IF NOT EXISTS "public"."prospects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text",
    "restaurante" "text",
    "email" "text",
    "telefono" "text",
    "pos" "text",
    "status" "text" DEFAULT 'nuevo'::"text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."prospects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."provisioning_tokens" (
    "code" "text" NOT NULL,
    "client_id" "text" NOT NULL,
    "terminal_role" "text" NOT NULL,
    "terminal_name" "text" NOT NULL,
    "pos_server_ip" "text",
    "kds_station" "text",
    "local_ui" boolean DEFAULT true NOT NULL,
    "created_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "redeemed_at" timestamp with time zone,
    "redeemed_by_terminal" "text"
);


ALTER TABLE "public"."provisioning_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "id" bigint NOT NULL,
    "client_id" "text",
    "endpoint" "text" NOT NULL,
    "keys" "jsonb" NOT NULL,
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."push_subscriptions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."push_subscriptions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."push_subscriptions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."push_subscriptions_id_seq" OWNED BY "public"."push_subscriptions"."id";



CREATE TABLE IF NOT EXISTS "public"."r1_observation_baseline" (
    "id" "text" DEFAULT 'obs-48h-20260715'::"text" NOT NULL,
    "started_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone NOT NULL,
    "pending_count" integer DEFAULT 0 NOT NULL,
    "blocked_count" integer DEFAULT 0 NOT NULL,
    "blocked_set" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "dup_mutation_count" integer DEFAULT 0 NOT NULL,
    "lineage_violation_count" integer DEFAULT 0 NOT NULL,
    "neg_inventory_count" integer DEFAULT 0 NOT NULL,
    "neg_inventory_set" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "neg_market_count" integer DEFAULT 0 NOT NULL,
    "neg_market_set" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "payload_corruption_count" integer DEFAULT 0 NOT NULL,
    "rejected_ops_count" integer DEFAULT 0 NOT NULL,
    "known_rejected_ops" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "legacy_sale_count" integer DEFAULT 0 NOT NULL,
    "r0_caller_count" integer DEFAULT 0 NOT NULL,
    "r0_5_caller_count" integer DEFAULT 0 NOT NULL,
    "writer_bypass_count" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."r1_observation_baseline" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."r1_observation_final" (
    "id" "text" DEFAULT 'obs-48h-20260715'::"text" NOT NULL,
    "evaluated_at" timestamp with time zone DEFAULT "now"(),
    "sample_count" integer,
    "first_sample" timestamp with time zone,
    "last_sample" timestamp with time zone,
    "max_pending_age_seconds" integer,
    "alert_count" integer,
    "blocked_baseline_count" integer,
    "blocked_final_count" integer,
    "new_blocked" "jsonb",
    "neg_inv_baseline_count" integer,
    "neg_inv_final_count" integer,
    "new_neg_inv" "jsonb",
    "neg_mkt_baseline_count" integer,
    "neg_mkt_final_count" integer,
    "new_neg_mkt" "jsonb",
    "dup_mutation_max" integer,
    "lineage_violation_max" integer,
    "payload_corruption_delta" integer,
    "unexpected_rejected_delta" integer,
    "legacy_movement_delta" integer,
    "writer_bypass_max" integer,
    "r0_caller_drift" integer,
    "r0_5_caller_drift" integer,
    "result" "text"
);


ALTER TABLE "public"."r1_observation_final" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."r1_observation_log" (
    "id" bigint NOT NULL,
    "checked_at" timestamp with time zone DEFAULT "now"(),
    "observation_id" "text" DEFAULT 'obs-48h-20260715'::"text",
    "pending_count" integer,
    "pending_max_age_seconds" integer,
    "blocked_count" integer,
    "blocked_set" "jsonb",
    "dup_mutation_count" integer,
    "lineage_violation_count" integer,
    "neg_inventory_count" integer,
    "neg_inventory_set" "jsonb",
    "neg_market_count" integer,
    "neg_market_set" "jsonb",
    "payload_corruption_count" integer,
    "rejected_ops_count" integer,
    "unexpected_rejected_count" integer,
    "legacy_sale_count" integer,
    "writer_bypass_count" integer,
    "r0_caller_count" integer,
    "r0_5_caller_count" integer,
    "observation_status" "text"
);


ALTER TABLE "public"."r1_observation_log" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."r1_observation_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."r1_observation_log_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."r1_observation_log_id_seq" OWNED BY "public"."r1_observation_log"."id";



CREATE TABLE IF NOT EXISTS "public"."reservaciones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "text" NOT NULL,
    "codigo_reserva" "text",
    "nombre" "text",
    "telefono" "text",
    "fecha" "date",
    "espacio" "text",
    "horario_inicio" time without time zone,
    "horario_fin" time without time zone,
    "guests" integer,
    "paquete" "text",
    "pastel" "text",
    "deco" "text",
    "total" numeric,
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "entradas" "text"[]
);


ALTER TABLE "public"."reservaciones" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."reservaciones_activas" WITH ("security_invoker"='on') AS
 SELECT "id",
    "fecha",
    "espacio",
    "horario_inicio",
    "horario_fin",
    "status"
   FROM "public"."amalay_reservaciones"
  WHERE ("status" <> 'cancelled'::"text");


ALTER VIEW "public"."reservaciones_activas" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."reservaciones_hoy" WITH ("security_invoker"='on') AS
 SELECT "nombre",
    "espacio",
    "horario_inicio",
    "horario_fin",
    "guests",
    "paquete",
    "total",
    "status"
   FROM "public"."amalay_reservaciones"
  WHERE (("fecha" = CURRENT_DATE) AND ("status" <> 'cancelled'::"text"))
  ORDER BY "horario_inicio";


ALTER VIEW "public"."reservaciones_hoy" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reviews" (
    "id" bigint NOT NULL,
    "review_id" "text" NOT NULL,
    "author" "text" DEFAULT 'Anónimo'::"text" NOT NULL,
    "rating" smallint NOT NULL,
    "text" "text" DEFAULT ''::"text" NOT NULL,
    "date" timestamp with time zone,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "draft_response" "text" DEFAULT ''::"text" NOT NULL,
    "published_response" "text" DEFAULT ''::"text" NOT NULL,
    "location_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reviews_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5))),
    CONSTRAINT "reviews_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'draft'::"text", 'approved'::"text", 'published'::"text"])))
);


ALTER TABLE "public"."reviews" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."reviews_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."reviews_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."reviews_id_seq" OWNED BY "public"."reviews"."id";



CREATE OR REPLACE VIEW "public"."reviews_pending" WITH ("security_invoker"='on') AS
 SELECT "id",
    "review_id",
    "author",
    "rating",
    "text",
    "date",
    "status",
    "draft_response",
    "published_response",
    "location_id",
    "created_at",
    "updated_at"
   FROM "public"."reviews"
  WHERE ("status" = ANY (ARRAY['pending'::"text", 'draft'::"text"]))
  ORDER BY "date" DESC NULLS LAST;


ALTER VIEW "public"."reviews_pending" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" bigint NOT NULL,
    "title" "text" NOT NULL,
    "client" "text",
    "agent" "text",
    "priority" "text" DEFAULT 'medium'::"text",
    "status" "text" DEFAULT 'pending'::"text",
    "due" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."tasks" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."tasks_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."tasks_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."tasks_id_seq" OWNED BY "public"."tasks"."id";



CREATE TABLE IF NOT EXISTS "public"."wansoft_catalog" (
    "id" bigint NOT NULL,
    "explored_at" timestamp with time zone DEFAULT "now"(),
    "explorer_version" "text" NOT NULL,
    "path" "text" NOT NULL,
    "parent_path" "text",
    "level" integer NOT NULL,
    "item_type" "text" NOT NULL,
    "ui_label" "text",
    "ui_selector" "text",
    "screenshot_path" "text",
    "has_export" boolean DEFAULT false,
    "export_format" "text",
    "xlsx_sheets" "jsonb",
    "xlsx_sample_path" "text",
    "endpoints" "jsonb",
    "filters" "jsonb",
    "notes" "text"
);


ALTER TABLE "public"."wansoft_catalog" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."wansoft_catalog_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."wansoft_catalog_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."wansoft_catalog_id_seq" OWNED BY "public"."wansoft_catalog"."id";



CREATE TABLE IF NOT EXISTS "public"."wansoft_daily" (
    "fecha" "date" DEFAULT CURRENT_DATE NOT NULL,
    "ventas_brutas" numeric,
    "ventas_dia" numeric,
    "descuentos" numeric,
    "devoluciones" numeric,
    "efectivo" numeric,
    "tarjeta" numeric,
    "chilaquiles_total" numeric,
    "half_half_total" numeric,
    "meseros" "jsonb",
    "platillos_top" "jsonb",
    "ventas_por_grupo" "jsonb",
    "pago_metodos" "jsonb",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "propinas_total" numeric,
    "mesas_atendidas" integer,
    "ordenes_llevar" integer,
    "tickets_count" integer,
    "personas_restaurant" integer,
    "cuentas_restaurant" integer,
    "ticket_promedio_restaurant" numeric,
    "client_slug" "text" DEFAULT 'amalay'::"text" NOT NULL,
    "report_type" "text" DEFAULT 'cierre'::"text" NOT NULL,
    "location_id" "text" DEFAULT 'amalay-spgg'::"text",
    CONSTRAINT "wansoft_daily_report_type_check" CHECK (("report_type" = ANY (ARRAY['avance'::"text", 'cierre'::"text"])))
);


ALTER TABLE "public"."wansoft_daily" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wansoft_data" (
    "client_id" "text" NOT NULL,
    "fecha" "date" NOT NULL,
    "data_key" "text" NOT NULL,
    "data" "jsonb" DEFAULT '[]'::"jsonb",
    "updated_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."wansoft_data" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."wansoft_data" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wansoft_food_cost" (
    "id" bigint NOT NULL,
    "client_id" "text" NOT NULL,
    "fecha" "date" NOT NULL,
    "data" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."wansoft_food_cost" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."wansoft_food_cost" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."wansoft_food_cost_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."wansoft_food_cost_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."wansoft_food_cost_id_seq" OWNED BY "public"."wansoft_food_cost"."id";



CREATE TABLE IF NOT EXISTS "public"."wansoft_hourly" (
    "fecha" "date" NOT NULL,
    "client_id" "text" NOT NULL,
    "data" "jsonb",
    "updated_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."wansoft_hourly" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."wansoft_hourly" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wansoft_inventory" (
    "id" bigint NOT NULL,
    "client_id" "text" NOT NULL,
    "fecha" "date" NOT NULL,
    "data" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."wansoft_inventory" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."wansoft_inventory" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."wansoft_inventory_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."wansoft_inventory_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."wansoft_inventory_id_seq" OWNED BY "public"."wansoft_inventory"."id";



CREATE TABLE IF NOT EXISTS "public"."wansoft_kpis" (
    "id" "text" DEFAULT 'amalay'::"text" NOT NULL,
    "ordenes_abiertas" integer,
    "total_ordenes_mxn" numeric,
    "ultima_venta" "text",
    "facturas" integer,
    "devoluciones" integer,
    "ordenes_compra" integer,
    "transferencias" integer,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "ventas_dia" numeric,
    "egresos_dia" numeric,
    "efectivo" numeric,
    "tarjeta" numeric,
    "inventario_critico" "text",
    "productos_top" "text",
    "cierre_caja" "text",
    "margen_dia" numeric,
    "tickets_count" integer,
    "hora_pico" "text",
    "notas" "text",
    "chilaquiles_count" integer,
    "chilaquiles_total" numeric,
    "half_half_count" integer,
    "half_half_total" numeric,
    "ticket_promedio_restaurant" numeric,
    "personas_restaurant" integer,
    "cuentas_restaurant" integer,
    "meseros" "jsonb",
    "platillos_top" "jsonb",
    "propinas_meseros" "jsonb",
    "pago_metodos" "jsonb",
    "ventas_por_grupo" "jsonb",
    "ventas_brutas" numeric,
    "descuentos" numeric,
    "fecha_reporte" "text",
    "propinas_total" numeric,
    "mesas_atendidas" integer,
    "ordenes_llevar" integer
);


ALTER TABLE "public"."wansoft_kpis" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wansoft_labor" (
    "id" bigint NOT NULL,
    "client_id" "text" NOT NULL,
    "fecha" "date" NOT NULL,
    "data" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."wansoft_labor" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."wansoft_labor" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."wansoft_labor_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."wansoft_labor_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."wansoft_labor_id_seq" OWNED BY "public"."wansoft_labor"."id";



CREATE TABLE IF NOT EXISTS "public"."wansoft_menu_config" (
    "client_id" "text" NOT NULL,
    "fecha" "date" NOT NULL,
    "groups" "jsonb" DEFAULT '[]'::"jsonb",
    "saucers" "jsonb" DEFAULT '[]'::"jsonb",
    "saucers_with_cost" "jsonb" DEFAULT '[]'::"jsonb",
    "complements" "jsonb" DEFAULT '[]'::"jsonb",
    "promotions" "jsonb" DEFAULT '[]'::"jsonb",
    "updated_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."wansoft_menu_config" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."wansoft_menu_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wansoft_persons_hourly" (
    "id" bigint NOT NULL,
    "client_id" "text" NOT NULL,
    "fecha" "date" NOT NULL,
    "data" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."wansoft_persons_hourly" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."wansoft_persons_hourly" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."wansoft_persons_hourly_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."wansoft_persons_hourly_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."wansoft_persons_hourly_id_seq" OWNED BY "public"."wansoft_persons_hourly"."id";



CREATE TABLE IF NOT EXISTS "public"."wansoft_pnl" (
    "id" bigint NOT NULL,
    "client_id" "text" NOT NULL,
    "periodo" "text" NOT NULL,
    "data" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."wansoft_pnl" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."wansoft_pnl" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."wansoft_pnl_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."wansoft_pnl_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."wansoft_pnl_id_seq" OWNED BY "public"."wansoft_pnl"."id";



CREATE TABLE IF NOT EXISTS "public"."wansoft_recipes" (
    "id" bigint NOT NULL,
    "client_id" "text" NOT NULL,
    "saucer_id" "text" NOT NULL,
    "saucer_name" "text",
    "budget_cost" numeric,
    "ingredients" "jsonb",
    "raw" "jsonb",
    "scraped_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."wansoft_recipes" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."wansoft_recipes" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."wansoft_recipes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."wansoft_recipes_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."wansoft_recipes_id_seq" OWNED BY "public"."wansoft_recipes"."id";



CREATE TABLE IF NOT EXISTS "public"."wansoft_shrinkage" (
    "id" bigint NOT NULL,
    "client_id" "text" NOT NULL,
    "fecha" "date" NOT NULL,
    "data" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."wansoft_shrinkage" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."wansoft_shrinkage" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."wansoft_shrinkage_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."wansoft_shrinkage_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."wansoft_shrinkage_id_seq" OWNED BY "public"."wansoft_shrinkage"."id";



CREATE TABLE IF NOT EXISTS "public"."wansoft_suppliers" (
    "id" bigint NOT NULL,
    "client_id" "text" NOT NULL,
    "fecha" "date" NOT NULL,
    "periodo" "text" DEFAULT 'month'::"text" NOT NULL,
    "data" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."wansoft_suppliers" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."wansoft_suppliers" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."wansoft_suppliers_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."wansoft_suppliers_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."wansoft_suppliers_id_seq" OWNED BY "public"."wansoft_suppliers"."id";



CREATE TABLE IF NOT EXISTS "public"."wansoft_tips" (
    "id" bigint NOT NULL,
    "client_id" "text" NOT NULL,
    "fecha" "date" NOT NULL,
    "data" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."wansoft_tips" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."wansoft_tips" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."wansoft_tips_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."wansoft_tips_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."wansoft_tips_id_seq" OWNED BY "public"."wansoft_tips"."id";



CREATE TABLE IF NOT EXISTS "public"."wansoft_waiter_categories" (
    "fecha" "date" NOT NULL,
    "data" "jsonb" NOT NULL,
    "items_count" integer,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."wansoft_waiter_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_conversations" (
    "id" bigint NOT NULL,
    "phone_number" "text" NOT NULL,
    "role" "text" NOT NULL,
    "content" "text",
    "tool_name" "text",
    "tool_input" "jsonb",
    "tool_output" "jsonb",
    "tokens_input" integer,
    "tokens_output" integer,
    "model_used" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "whatsapp_conversations_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'assistant'::"text", 'tool'::"text"])))
);


ALTER TABLE "public"."whatsapp_conversations" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."whatsapp_conversations_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."whatsapp_conversations_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."whatsapp_conversations_id_seq" OWNED BY "public"."whatsapp_conversations"."id";



CREATE TABLE IF NOT EXISTS "public"."whatsapp_messages_log" (
    "id" bigint NOT NULL,
    "direction" "text" NOT NULL,
    "phone_number" "text" NOT NULL,
    "message_id" "text",
    "message_type" "text",
    "content" "text",
    "status" "text",
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "whatsapp_messages_log_direction_check" CHECK (("direction" = ANY (ARRAY['inbound'::"text", 'outbound'::"text"])))
);


ALTER TABLE "public"."whatsapp_messages_log" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."whatsapp_messages_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."whatsapp_messages_log_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."whatsapp_messages_log_id_seq" OWNED BY "public"."whatsapp_messages_log"."id";



CREATE TABLE IF NOT EXISTS "public"."whatsapp_whitelist" (
    "id" bigint NOT NULL,
    "phone_number" "text" NOT NULL,
    "user_name" "text" NOT NULL,
    "restaurante" "text" DEFAULT 'amalay'::"text",
    "role" "text" DEFAULT 'viewer'::"text",
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "whatsapp_whitelist_role_check" CHECK (("role" = ANY (ARRAY['viewer'::"text", 'manager'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."whatsapp_whitelist" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."whatsapp_whitelist_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."whatsapp_whitelist_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."whatsapp_whitelist_id_seq" OWNED BY "public"."whatsapp_whitelist"."id";



ALTER TABLE ONLY "public"."agent_audit_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."agent_audit_log_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."agent_insights" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."agent_insights_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."agent_messages" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."agent_messages_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."agent_results" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."agent_results_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."agent_runs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."agent_runs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."calendar_sync_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."calendar_sync_log_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."content" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."content_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."lab_issues" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."lab_issues_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."ops_daily" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."ops_daily_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pos_audit_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pos_audit_log_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pos_cash_movements" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pos_cash_movements_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pos_category_modifiers" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pos_category_modifiers_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pos_customer_visits" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pos_customer_visits_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pos_customers" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pos_customers_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pos_ingredient_presentations" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pos_ingredient_presentations_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pos_inventory" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pos_inventory_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pos_inventory_movements" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pos_inventory_movements_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pos_inventory_products" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pos_inventory_products_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pos_item_inventory_policy" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pos_item_inventory_policy_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pos_market_movements" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pos_market_movements_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pos_market_stock" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pos_market_stock_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pos_purchase_order_items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pos_purchase_order_items_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pos_recipe_lines" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pos_recipe_lines_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pos_recipe_versions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pos_recipe_versions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pos_recipes_old" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pos_recipes_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pos_reconciliation_results" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pos_reconciliation_results_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pos_staff_audit" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pos_staff_audit_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pos_sub_recipe_ingredients" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pos_sub_recipe_ingredients_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pos_survey" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pos_survey_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pos_unit_conversions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pos_unit_conversions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."push_subscriptions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."push_subscriptions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."r1_observation_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."r1_observation_log_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."reviews" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."reviews_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."tasks" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."tasks_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."wansoft_catalog" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."wansoft_catalog_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."wansoft_food_cost" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."wansoft_food_cost_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."wansoft_inventory" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."wansoft_inventory_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."wansoft_labor" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."wansoft_labor_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."wansoft_persons_hourly" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."wansoft_persons_hourly_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."wansoft_pnl" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."wansoft_pnl_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."wansoft_recipes" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."wansoft_recipes_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."wansoft_shrinkage" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."wansoft_shrinkage_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."wansoft_suppliers" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."wansoft_suppliers_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."wansoft_tips" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."wansoft_tips_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."whatsapp_conversations" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."whatsapp_conversations_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."whatsapp_messages_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."whatsapp_messages_log_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."whatsapp_whitelist" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."whatsapp_whitelist_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."agent_audit_log"
    ADD CONSTRAINT "agent_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_events"
    ADD CONSTRAINT "agent_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_insights"
    ADD CONSTRAINT "agent_insights_agent_id_client_id_title_created_at_key" UNIQUE ("agent_id", "client_id", "title", "created_at");



ALTER TABLE ONLY "public"."agent_insights"
    ADD CONSTRAINT "agent_insights_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_messages"
    ADD CONSTRAINT "agent_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_results"
    ADD CONSTRAINT "agent_results_client_id_agent_id_fecha_key" UNIQUE ("client_id", "agent_id", "fecha");



ALTER TABLE ONLY "public"."agent_results"
    ADD CONSTRAINT "agent_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_runs"
    ADD CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."amalay_reservaciones"
    ADD CONSTRAINT "amalay_reservaciones_codigo_reserva_key" UNIQUE ("codigo_reserva");



ALTER TABLE ONLY "public"."amalay_reservaciones"
    ADD CONSTRAINT "amalay_reservaciones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calendar_sync_log"
    ADD CONSTRAINT "calendar_sync_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_logs"
    ADD CONSTRAINT "chat_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_locations"
    ADD CONSTRAINT "client_locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_users"
    ADD CONSTRAINT "client_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content"
    ADD CONSTRAINT "content_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."credentials_vault"
    ADD CONSTRAINT "credentials_vault_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."delivery_dlq"
    ADD CONSTRAINT "delivery_dlq_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."delivery_orders"
    ADD CONSTRAINT "delivery_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."delivery_orders"
    ADD CONSTRAINT "delivery_orders_platform_platform_order_id_key" UNIQUE ("platform", "platform_order_id");



ALTER TABLE ONLY "public"."delivery_platform_payments"
    ADD CONSTRAINT "delivery_platform_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_id_key" UNIQUE ("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("sequence");



ALTER TABLE ONLY "public"."feature_flags"
    ADD CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."integration_audit_log"
    ADD CONSTRAINT "integration_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."integration_providers"
    ADD CONSTRAINT "integration_providers_client_id_provider_key" UNIQUE ("client_id", "provider");



ALTER TABLE ONLY "public"."integration_providers"
    ADD CONSTRAINT "integration_providers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."integration_store_mappings"
    ADD CONSTRAINT "integration_store_mappings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."integration_store_mappings"
    ADD CONSTRAINT "integration_store_mappings_provider_provider_store_id_key" UNIQUE ("provider", "provider_store_id");



ALTER TABLE ONLY "public"."integration_webhook_dlq"
    ADD CONSTRAINT "integration_webhook_dlq_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."integration_webhook_events"
    ADD CONSTRAINT "integration_webhook_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."integration_webhook_events"
    ADD CONSTRAINT "integration_webhook_events_provider_provider_event_id_key" UNIQUE ("provider", "provider_event_id");



ALTER TABLE ONLY "public"."lab_issues"
    ADD CONSTRAINT "lab_issues_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."local_server_heartbeats"
    ADD CONSTRAINT "local_server_heartbeats_pkey" PRIMARY KEY ("server_id");



ALTER TABLE ONLY "public"."memories"
    ADD CONSTRAINT "memories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ops_daily"
    ADD CONSTRAINT "ops_daily_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."parity_reports"
    ADD CONSTRAINT "parity_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_2fa_codes"
    ADD CONSTRAINT "platform_2fa_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_2fa_enrollment"
    ADD CONSTRAINT "platform_2fa_enrollment_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."platform_admins"
    ADD CONSTRAINT "platform_admins_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."platform_admins"
    ADD CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_audit_log"
    ADD CONSTRAINT "platform_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_settings"
    ADD CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."pos_attendance"
    ADD CONSTRAINT "pos_attendance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_audit_log"
    ADD CONSTRAINT "pos_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_authority_transitions"
    ADD CONSTRAINT "pos_authority_transitions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_billing_clients"
    ADD CONSTRAINT "pos_billing_clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_billing_clients"
    ADD CONSTRAINT "pos_billing_clients_rfc_client_id_key" UNIQUE ("rfc", "client_id");



ALTER TABLE ONLY "public"."pos_bridge_logs"
    ADD CONSTRAINT "pos_bridge_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_cash_movements"
    ADD CONSTRAINT "pos_cash_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_category_modifiers"
    ADD CONSTRAINT "pos_category_modifiers_client_id_category_id_modifier_group_key" UNIQUE ("client_id", "category_id", "modifier_group_id");



ALTER TABLE ONLY "public"."pos_category_modifiers"
    ADD CONSTRAINT "pos_category_modifiers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_cfdi_requests"
    ADD CONSTRAINT "pos_cfdi_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_cierres"
    ADD CONSTRAINT "pos_cierres_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_clients"
    ADD CONSTRAINT "pos_clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_combos"
    ADD CONSTRAINT "pos_combos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_customer_notes"
    ADD CONSTRAINT "pos_customer_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_customer_visits"
    ADD CONSTRAINT "pos_customer_visits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_customers"
    ADD CONSTRAINT "pos_customers_client_id_phone_key" UNIQUE ("client_id", "phone");



ALTER TABLE ONLY "public"."pos_customers"
    ADD CONSTRAINT "pos_customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_delivery_zones"
    ADD CONSTRAINT "pos_delivery_zones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_facturas"
    ADD CONSTRAINT "pos_facturas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_fingerprint_templates"
    ADD CONSTRAINT "pos_fingerprint_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_gastos"
    ADD CONSTRAINT "pos_gastos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_gift_cards"
    ADD CONSTRAINT "pos_gift_cards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_ingredient_presentations"
    ADD CONSTRAINT "pos_ingredient_presentations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_ingredients"
    ADD CONSTRAINT "pos_ingredients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_insumos"
    ADD CONSTRAINT "pos_insumos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_inventory_alerts"
    ADD CONSTRAINT "pos_inventory_alerts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_inventory"
    ADD CONSTRAINT "pos_inventory_client_id_ingredient_id_key" UNIQUE ("client_id", "ingredient_id");



ALTER TABLE ONLY "public"."pos_inventory_movements"
    ADD CONSTRAINT "pos_inventory_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_inventory"
    ADD CONSTRAINT "pos_inventory_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_inventory_products"
    ADD CONSTRAINT "pos_inventory_products_client_id_name_key" UNIQUE ("client_id", "name");



ALTER TABLE ONLY "public"."pos_inventory_products"
    ADD CONSTRAINT "pos_inventory_products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_item_inventory_policy"
    ADD CONSTRAINT "pos_item_inventory_policy_client_id_menu_item_id_key" UNIQUE ("client_id", "menu_item_id");



ALTER TABLE ONLY "public"."pos_item_inventory_policy"
    ADD CONSTRAINT "pos_item_inventory_policy_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_item_modifier_groups"
    ADD CONSTRAINT "pos_item_modifier_groups_pkey" PRIMARY KEY ("client_id", "item_id", "group_id");



ALTER TABLE ONLY "public"."pos_local_events"
    ADD CONSTRAINT "pos_local_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_local_events"
    ADD CONSTRAINT "pos_local_events_unique_restaurant_seq" UNIQUE ("restaurant_id", "sequence");



ALTER TABLE ONLY "public"."pos_market_movements"
    ADD CONSTRAINT "pos_market_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_market_stock"
    ADD CONSTRAINT "pos_market_stock_client_id_menu_item_id_key" UNIQUE ("client_id", "menu_item_id");



ALTER TABLE ONLY "public"."pos_market_stock"
    ADD CONSTRAINT "pos_market_stock_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_menu_categories"
    ADD CONSTRAINT "pos_menu_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_menu_item_recipes"
    ADD CONSTRAINT "pos_menu_item_recipes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_menu_items"
    ADD CONSTRAINT "pos_menu_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_mesas"
    ADD CONSTRAINT "pos_mesas_client_id_number_key" UNIQUE ("client_id", "number");



ALTER TABLE ONLY "public"."pos_mesas"
    ADD CONSTRAINT "pos_mesas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_modifier_groups"
    ADD CONSTRAINT "pos_modifier_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_modifiers"
    ADD CONSTRAINT "pos_modifiers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_mutation_authority"
    ADD CONSTRAINT "pos_mutation_authority_pkey" PRIMARY KEY ("client_id");



ALTER TABLE ONLY "public"."pos_orders"
    ADD CONSTRAINT "pos_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_payment_methods"
    ADD CONSTRAINT "pos_payment_methods_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_presentations"
    ADD CONSTRAINT "pos_presentations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_price_types"
    ADD CONSTRAINT "pos_price_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_print_jobs"
    ADD CONSTRAINT "pos_print_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_promos"
    ADD CONSTRAINT "pos_promos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_promotions"
    ADD CONSTRAINT "pos_promotions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_purchase_order_items"
    ADD CONSTRAINT "pos_purchase_order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_purchase_orders"
    ADD CONSTRAINT "pos_purchase_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_recipe_details"
    ADD CONSTRAINT "pos_recipe_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_recipe_lines"
    ADD CONSTRAINT "pos_recipe_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_recipe_lines"
    ADD CONSTRAINT "pos_recipe_lines_recipe_version_id_ingredient_id_key" UNIQUE ("recipe_version_id", "ingredient_id");



ALTER TABLE ONLY "public"."pos_recipe_versions"
    ADD CONSTRAINT "pos_recipe_versions_client_id_menu_item_id_id_key" UNIQUE ("client_id", "menu_item_id", "id");



ALTER TABLE ONLY "public"."pos_recipe_versions"
    ADD CONSTRAINT "pos_recipe_versions_client_id_menu_item_id_version_key" UNIQUE ("client_id", "menu_item_id", "version");



ALTER TABLE ONLY "public"."pos_recipe_versions"
    ADD CONSTRAINT "pos_recipe_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_recipes_old"
    ADD CONSTRAINT "pos_recipes_client_id_menu_item_id_ingredient_id_key" UNIQUE ("client_id", "menu_item_id", "ingredient_id");



ALTER TABLE ONLY "public"."pos_recipes_old"
    ADD CONSTRAINT "pos_recipes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_recipes"
    ADD CONSTRAINT "pos_recipes_pkey1" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_reconciliation_results"
    ADD CONSTRAINT "pos_reconciliation_results_client_id_order_id_order_item_id_key" UNIQUE ("client_id", "order_id", "order_item_id");



ALTER TABLE ONLY "public"."pos_reconciliation_results"
    ADD CONSTRAINT "pos_reconciliation_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_retail_groups"
    ADD CONSTRAINT "pos_retail_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_retail_items"
    ADD CONSTRAINT "pos_retail_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_retail_promotions"
    ADD CONSTRAINT "pos_retail_promotions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_save_operations"
    ADD CONSTRAINT "pos_save_operations_pkey" PRIMARY KEY ("client_id", "order_id", "save_operation_id");



ALTER TABLE ONLY "public"."pos_schedules"
    ADD CONSTRAINT "pos_schedules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_sessions"
    ADD CONSTRAINT "pos_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_sizes"
    ADD CONSTRAINT "pos_sizes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_staff_audit"
    ADD CONSTRAINT "pos_staff_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_staff"
    ADD CONSTRAINT "pos_staff_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_staff_shifts"
    ADD CONSTRAINT "pos_staff_shifts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_sub_recipe_ingredients"
    ADD CONSTRAINT "pos_sub_recipe_ingredients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_sub_recipes"
    ADD CONSTRAINT "pos_sub_recipes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_suppliers"
    ADD CONSTRAINT "pos_suppliers_client_name_key" UNIQUE ("client_id", "name");



ALTER TABLE ONLY "public"."pos_suppliers"
    ADD CONSTRAINT "pos_suppliers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_survey"
    ADD CONSTRAINT "pos_survey_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_time_clock"
    ADD CONSTRAINT "pos_time_clock_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_turnos"
    ADD CONSTRAINT "pos_turnos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_unit_conversions"
    ADD CONSTRAINT "pos_unit_conversions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prospects"
    ADD CONSTRAINT "prospects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."provisioning_tokens"
    ADD CONSTRAINT "provisioning_tokens_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE ("endpoint");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."r1_observation_baseline"
    ADD CONSTRAINT "r1_observation_baseline_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."r1_observation_final"
    ADD CONSTRAINT "r1_observation_final_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."r1_observation_log"
    ADD CONSTRAINT "r1_observation_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reservaciones"
    ADD CONSTRAINT "reservaciones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_review_id_key" UNIQUE ("review_id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_staff"
    ADD CONSTRAINT "unique_pin_per_client" UNIQUE ("pin", "client_id");



ALTER TABLE ONLY "public"."pos_ingredients"
    ADD CONSTRAINT "uq_ingredients_client_id" UNIQUE ("client_id", "id");



ALTER TABLE ONLY "public"."pos_ingredient_presentations"
    ADD CONSTRAINT "uq_ip_client_ingredient_pres" UNIQUE ("client_id", "ingredient_id", "presentation_id");



ALTER TABLE ONLY "public"."pos_market_stock"
    ADD CONSTRAINT "uq_market_stock_client_item_id" UNIQUE ("client_id", "menu_item_id", "id");



ALTER TABLE ONLY "public"."pos_menu_items"
    ADD CONSTRAINT "uq_menu_items_client_id" UNIQUE ("client_id", "id");



ALTER TABLE ONLY "public"."pos_menu_item_recipes"
    ADD CONSTRAINT "uq_pos_mir_client_item_recipe" UNIQUE ("client_id", "menu_item_name", "recipe_name");



ALTER TABLE ONLY "public"."pos_presentations"
    ADD CONSTRAINT "uq_pres_client_code" UNIQUE ("client_id", "code");



ALTER TABLE ONLY "public"."pos_recipe_versions"
    ADD CONSTRAINT "uq_recipe_versions_client_id" UNIQUE ("client_id", "id");



ALTER TABLE ONLY "public"."pos_sub_recipes"
    ADD CONSTRAINT "uq_sub_recipes_client_name" UNIQUE ("client_id", "name");



ALTER TABLE ONLY "public"."pos_unit_conversions"
    ADD CONSTRAINT "uq_uc_client_units" UNIQUE ("client_id", "from_unit", "to_unit");



ALTER TABLE ONLY "public"."wansoft_catalog"
    ADD CONSTRAINT "wansoft_catalog_path_explorer_version_key" UNIQUE ("path", "explorer_version");



ALTER TABLE ONLY "public"."wansoft_catalog"
    ADD CONSTRAINT "wansoft_catalog_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wansoft_daily"
    ADD CONSTRAINT "wansoft_daily_fecha_key" UNIQUE ("fecha");



ALTER TABLE ONLY "public"."wansoft_daily"
    ADD CONSTRAINT "wansoft_daily_pkey" PRIMARY KEY ("client_slug", "fecha", "report_type");



ALTER TABLE ONLY "public"."wansoft_data"
    ADD CONSTRAINT "wansoft_data_pkey" PRIMARY KEY ("client_id", "fecha", "data_key");



ALTER TABLE ONLY "public"."wansoft_food_cost"
    ADD CONSTRAINT "wansoft_food_cost_client_id_fecha_key" UNIQUE ("client_id", "fecha");



ALTER TABLE ONLY "public"."wansoft_food_cost"
    ADD CONSTRAINT "wansoft_food_cost_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wansoft_hourly"
    ADD CONSTRAINT "wansoft_hourly_pkey" PRIMARY KEY ("fecha", "client_id");



ALTER TABLE ONLY "public"."wansoft_inventory"
    ADD CONSTRAINT "wansoft_inventory_client_id_fecha_key" UNIQUE ("client_id", "fecha");



ALTER TABLE ONLY "public"."wansoft_inventory"
    ADD CONSTRAINT "wansoft_inventory_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wansoft_kpis"
    ADD CONSTRAINT "wansoft_kpis_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wansoft_labor"
    ADD CONSTRAINT "wansoft_labor_client_id_fecha_key" UNIQUE ("client_id", "fecha");



ALTER TABLE ONLY "public"."wansoft_labor"
    ADD CONSTRAINT "wansoft_labor_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wansoft_menu_config"
    ADD CONSTRAINT "wansoft_menu_config_pkey" PRIMARY KEY ("client_id", "fecha");



ALTER TABLE ONLY "public"."wansoft_persons_hourly"
    ADD CONSTRAINT "wansoft_persons_hourly_client_id_fecha_key" UNIQUE ("client_id", "fecha");



ALTER TABLE ONLY "public"."wansoft_persons_hourly"
    ADD CONSTRAINT "wansoft_persons_hourly_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wansoft_pnl"
    ADD CONSTRAINT "wansoft_pnl_client_id_periodo_key" UNIQUE ("client_id", "periodo");



ALTER TABLE ONLY "public"."wansoft_pnl"
    ADD CONSTRAINT "wansoft_pnl_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wansoft_recipes"
    ADD CONSTRAINT "wansoft_recipes_client_id_saucer_id_key" UNIQUE ("client_id", "saucer_id");



ALTER TABLE ONLY "public"."wansoft_recipes"
    ADD CONSTRAINT "wansoft_recipes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wansoft_shrinkage"
    ADD CONSTRAINT "wansoft_shrinkage_client_id_fecha_key" UNIQUE ("client_id", "fecha");



ALTER TABLE ONLY "public"."wansoft_shrinkage"
    ADD CONSTRAINT "wansoft_shrinkage_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wansoft_suppliers"
    ADD CONSTRAINT "wansoft_suppliers_client_id_fecha_periodo_key" UNIQUE ("client_id", "fecha", "periodo");



ALTER TABLE ONLY "public"."wansoft_suppliers"
    ADD CONSTRAINT "wansoft_suppliers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wansoft_tips"
    ADD CONSTRAINT "wansoft_tips_client_id_fecha_key" UNIQUE ("client_id", "fecha");



ALTER TABLE ONLY "public"."wansoft_tips"
    ADD CONSTRAINT "wansoft_tips_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wansoft_waiter_categories"
    ADD CONSTRAINT "wansoft_waiter_categories_pkey" PRIMARY KEY ("fecha");



ALTER TABLE ONLY "public"."whatsapp_conversations"
    ADD CONSTRAINT "whatsapp_conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_messages_log"
    ADD CONSTRAINT "whatsapp_messages_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_whitelist"
    ADD CONSTRAINT "whatsapp_whitelist_phone_number_key" UNIQUE ("phone_number");



ALTER TABLE ONLY "public"."whatsapp_whitelist"
    ADD CONSTRAINT "whatsapp_whitelist_pkey" PRIMARY KEY ("id");



CREATE INDEX "agent_events_by_agent" ON "public"."agent_events" USING "btree" ("client_id", "agent_id", "status", "created_at" DESC);



CREATE INDEX "agent_events_lookup" ON "public"."agent_events" USING "btree" ("client_id", "severity", "status", "created_at" DESC);



CREATE INDEX "idx_agent_messages_unread" ON "public"."agent_messages" USING "btree" ("to_agent", "created_at" DESC) WHERE ("read" = false);



CREATE INDEX "idx_agent_results_agent" ON "public"."agent_results" USING "btree" ("client_id", "agent_id", "fecha" DESC);



CREATE INDEX "idx_agent_runs_agent_created" ON "public"."agent_runs" USING "btree" ("agent_id", "created_at" DESC);



CREATE INDEX "idx_attendance_staff" ON "public"."pos_attendance" USING "btree" ("client_id", "staff_id", "registered_at" DESC);



CREATE INDEX "idx_audit_action" ON "public"."pos_audit_log" USING "btree" ("action");



CREATE INDEX "idx_audit_agent_ts" ON "public"."agent_audit_log" USING "btree" ("agent_name", "ts" DESC);



CREATE INDEX "idx_audit_created" ON "public"."pos_audit_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_order" ON "public"."pos_audit_log" USING "btree" ("order_id");



CREATE INDEX "idx_bridge_logs_client_time" ON "public"."pos_bridge_logs" USING "btree" ("client_id", "logged_at" DESC);



CREATE INDEX "idx_cfdi_created" ON "public"."pos_cfdi_requests" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_cfdi_rfc" ON "public"."pos_cfdi_requests" USING "btree" ("rfc");



CREATE INDEX "idx_cfdi_status" ON "public"."pos_cfdi_requests" USING "btree" ("status");



CREATE INDEX "idx_chat_logs_client" ON "public"."chat_logs" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "idx_chat_logs_error" ON "public"."chat_logs" USING "btree" ("had_error") WHERE ("had_error" = true);



CREATE INDEX "idx_cierres_fecha" ON "public"."pos_cierres" USING "btree" ("fecha" DESC);



CREATE INDEX "idx_cierres_turno" ON "public"."pos_cierres" USING "btree" ("turno_id");



CREATE INDEX "idx_delivery_orders_platform" ON "public"."delivery_orders" USING "btree" ("platform", "platform_order_id");



CREATE INDEX "idx_delivery_orders_status" ON "public"."delivery_orders" USING "btree" ("client_id", "status", "created_at" DESC);



CREATE INDEX "idx_dlq_provider" ON "public"."integration_webhook_dlq" USING "btree" ("provider", "created_at" DESC);



CREATE INDEX "idx_iaudit_action" ON "public"."integration_audit_log" USING "btree" ("action", "created_at" DESC);



CREATE INDEX "idx_iaudit_correlation" ON "public"."integration_audit_log" USING "btree" ("correlation_id");



CREATE INDEX "idx_iaudit_provider" ON "public"."integration_audit_log" USING "btree" ("provider", "created_at" DESC);



CREATE INDEX "idx_insights_client" ON "public"."agent_insights" USING "btree" ("client_id");



CREATE INDEX "idx_insights_created" ON "public"."agent_insights" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_insights_severity" ON "public"."agent_insights" USING "btree" ("severity");



CREATE INDEX "idx_insights_status" ON "public"."agent_insights" USING "btree" ("status");



CREATE INDEX "idx_inv_mov_created" ON "public"."pos_inventory_movements" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_inv_mov_product" ON "public"."pos_inventory_movements" USING "btree" ("product_id");



CREATE INDEX "idx_inv_mov_reconciliation" ON "public"."pos_inventory_movements" USING "btree" ("reconciliation_result_id") WHERE ("reconciliation_result_id" IS NOT NULL);



CREATE INDEX "idx_inv_mov_type" ON "public"."pos_inventory_movements" USING "btree" ("movement_type");



CREATE INDEX "idx_inv_products_client" ON "public"."pos_inventory_products" USING "btree" ("client_id");



CREATE INDEX "idx_inv_products_name" ON "public"."pos_inventory_products" USING "btree" ("name");



CREATE INDEX "idx_ip_ingredient" ON "public"."pos_ingredient_presentations" USING "btree" ("ingredient_id");



CREATE INDEX "idx_iwh_events_correlation" ON "public"."integration_webhook_events" USING "btree" ("correlation_id");



CREATE INDEX "idx_iwh_events_status" ON "public"."integration_webhook_events" USING "btree" ("provider", "status", "created_at");



CREATE INDEX "idx_lab_issues_client_time" ON "public"."lab_issues" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "idx_lsh_restaurant" ON "public"."local_server_heartbeats" USING "btree" ("restaurant_id");



CREATE INDEX "idx_market_mov_created" ON "public"."pos_market_movements" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_market_mov_item" ON "public"."pos_market_movements" USING "btree" ("menu_item_id");



CREATE INDEX "idx_market_stock_item" ON "public"."pos_market_stock" USING "btree" ("menu_item_id");



CREATE INDEX "idx_memories_agent" ON "public"."memories" USING "btree" ("agent_id");



CREATE INDEX "idx_memories_client" ON "public"."memories" USING "btree" ("client");



CREATE INDEX "idx_memories_salience" ON "public"."memories" USING "btree" ("salience" DESC);



CREATE INDEX "idx_menu_cat_client" ON "public"."pos_menu_categories" USING "btree" ("client_id");



CREATE INDEX "idx_menu_items_cat" ON "public"."pos_menu_items" USING "btree" ("category_id");



CREATE INDEX "idx_menu_items_client" ON "public"."pos_menu_items" USING "btree" ("client_id");



CREATE INDEX "idx_mkt_mov_reconciliation" ON "public"."pos_market_movements" USING "btree" ("reconciliation_result_id") WHERE ("reconciliation_result_id" IS NOT NULL);



CREATE INDEX "idx_modifiers_group" ON "public"."pos_modifiers" USING "btree" ("group_id");



CREATE INDEX "idx_notes_mesa" ON "public"."pos_customer_notes" USING "btree" ("mesa", "client_id");



CREATE INDEX "idx_ops_daily_fecha" ON "public"."ops_daily" USING "btree" ("client_id", "fecha" DESC);



CREATE INDEX "idx_ops_daily_latest" ON "public"."ops_daily" USING "btree" ("client_id", "fecha" DESC, "record_type");



CREATE INDEX "idx_parity_reports_day" ON "public"."parity_reports" USING "btree" ("day" DESC);



CREATE INDEX "idx_platform_2fa_codes_user_active" ON "public"."platform_2fa_codes" USING "btree" ("user_id", "created_at" DESC) WHERE ("consumed_at" IS NULL);



CREATE INDEX "idx_pos_audit_log_client" ON "public"."pos_audit_log" USING "btree" ("client_id");



CREATE INDEX "idx_pos_audit_log_client_created" ON "public"."pos_audit_log" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "idx_pos_cash_movements_client" ON "public"."pos_cash_movements" USING "btree" ("client_id");



CREATE INDEX "idx_pos_cierres_client" ON "public"."pos_cierres" USING "btree" ("client_id");



CREATE INDEX "idx_pos_clients_email" ON "public"."pos_clients" USING "btree" ("client_id", "email");



CREATE INDEX "idx_pos_clients_phone" ON "public"."pos_clients" USING "btree" ("client_id", "telefono");



CREATE INDEX "idx_pos_customer_visits_client" ON "public"."pos_customer_visits" USING "btree" ("client_id");



CREATE INDEX "idx_pos_customer_visits_customer" ON "public"."pos_customer_visits" USING "btree" ("customer_id");



CREATE INDEX "idx_pos_customer_visits_date" ON "public"."pos_customer_visits" USING "btree" ("visited_at" DESC);



CREATE INDEX "idx_pos_customers_client_id" ON "public"."pos_customers" USING "btree" ("client_id");



CREATE INDEX "idx_pos_customers_last_visit" ON "public"."pos_customers" USING "btree" ("client_id", "last_visit" DESC);



CREATE INDEX "idx_pos_customers_phone" ON "public"."pos_customers" USING "btree" ("client_id", "phone");



CREATE INDEX "idx_pos_menu_items_recipe_ref" ON "public"."pos_menu_items" USING "btree" ("client_id", "recipe_ref") WHERE ("recipe_ref" IS NOT NULL);



CREATE INDEX "idx_pos_mesas_client_active" ON "public"."pos_mesas" USING "btree" ("client_id", "sort_order") WHERE "active";



CREATE INDEX "idx_pos_mir_lookup" ON "public"."pos_menu_item_recipes" USING "btree" ("client_id", "menu_item_name");



CREATE INDEX "idx_pos_modifiers_client" ON "public"."pos_modifiers" USING "btree" ("client_id");



CREATE INDEX "idx_pos_orders_mesa" ON "public"."pos_orders" USING "btree" ("mesa", "status");



CREATE INDEX "idx_pos_orders_status" ON "public"."pos_orders" USING "btree" ("client_id", "status", "created_at" DESC);



CREATE INDEX "idx_pos_recipes_client" ON "public"."pos_recipes" USING "btree" ("client_id");



CREATE INDEX "idx_pos_time_clock_staff" ON "public"."pos_time_clock" USING "btree" ("client_id", "staff_id", "ts" DESC);



CREATE INDEX "idx_pos_turnos_client" ON "public"."pos_turnos" USING "btree" ("client_id", "closed_at");



CREATE INDEX "idx_print_jobs_status" ON "public"."pos_print_jobs" USING "btree" ("client_id", "status");



CREATE INDEX "idx_provisioning_tokens_client" ON "public"."provisioning_tokens" USING "btree" ("client_id");



CREATE INDEX "idx_provisioning_tokens_unredeemed" ON "public"."provisioning_tokens" USING "btree" ("redeemed_at") WHERE ("redeemed_at" IS NULL);



CREATE INDEX "idx_push_client" ON "public"."push_subscriptions" USING "btree" ("client_id");



CREATE INDEX "idx_recon_results_order" ON "public"."pos_reconciliation_results" USING "btree" ("client_id", "order_id");



CREATE INDEX "idx_res_espacio" ON "public"."amalay_reservaciones" USING "btree" ("espacio");



CREATE INDEX "idx_res_fecha" ON "public"."amalay_reservaciones" USING "btree" ("fecha");



CREATE INDEX "idx_res_status" ON "public"."amalay_reservaciones" USING "btree" ("status");



CREATE INDEX "idx_shifts_client" ON "public"."pos_staff_shifts" USING "btree" ("client_id");



CREATE INDEX "idx_shifts_date" ON "public"."pos_staff_shifts" USING "btree" ("clock_in" DESC);



CREATE INDEX "idx_shifts_staff" ON "public"."pos_staff_shifts" USING "btree" ("staff_id", "clock_in" DESC);



CREATE INDEX "idx_sri_ingredient" ON "public"."pos_sub_recipe_ingredients" USING "btree" ("ingredient_id");



CREATE INDEX "idx_sri_sub_recipe" ON "public"."pos_sub_recipe_ingredients" USING "btree" ("sub_recipe_id");



CREATE INDEX "idx_sub_recipes_client" ON "public"."pos_sub_recipes" USING "btree" ("client_id");



CREATE INDEX "idx_sync_log_codigo" ON "public"."calendar_sync_log" USING "btree" ("matched_codigo");



CREATE INDEX "idx_sync_log_created" ON "public"."calendar_sync_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_vault_client" ON "public"."credentials_vault" USING "btree" ("client_id", "category");



CREATE INDEX "idx_wansoft_daily_client_fecha" ON "public"."wansoft_daily" USING "btree" ("client_slug", "fecha" DESC);



CREATE UNIQUE INDEX "idx_wansoft_daily_fecha" ON "public"."wansoft_daily" USING "btree" ("fecha") WHERE ("ventas_dia" > (0)::numeric);



CREATE INDEX "idx_wansoft_data_key" ON "public"."wansoft_data" USING "btree" ("client_id", "data_key", "fecha" DESC);



CREATE INDEX "idx_whatsapp_conv_phone_date" ON "public"."whatsapp_conversations" USING "btree" ("phone_number", "created_at" DESC);



CREATE INDEX "idx_whatsapp_msg_phone_date" ON "public"."whatsapp_messages_log" USING "btree" ("phone_number", "created_at" DESC);



CREATE UNIQUE INDEX "no_double_booking" ON "public"."amalay_reservaciones" USING "btree" ("fecha", "espacio", "horario_inicio") WHERE ("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text"]));



CREATE INDEX "platform_audit_log_created_idx" ON "public"."platform_audit_log" USING "btree" ("created_at" DESC);



CREATE INDEX "platform_audit_log_tenant_idx" ON "public"."platform_audit_log" USING "btree" ("target_tenant");



CREATE INDEX "pos_authority_transitions_history_idx" ON "public"."pos_authority_transitions" USING "btree" ("restaurant_id", "started_at" DESC);



CREATE UNIQUE INDEX "pos_authority_transitions_one_active_per_restaurant" ON "public"."pos_authority_transitions" USING "btree" ("restaurant_id") WHERE ("status" <> ALL (ARRAY['completed'::"text", 'cancelled'::"text", 'timed_out'::"text"]));



CREATE UNIQUE INDEX "pos_inventory_movements_gate_failure_uniq" ON "public"."pos_inventory_movements" USING "btree" ("client_id", "order_id") WHERE ("movement_type" = 'policy_gate_failure'::"text");



CREATE INDEX "pos_local_events_restaurant_seq_idx" ON "public"."pos_local_events" USING "btree" ("restaurant_id", "sequence");



CREATE INDEX "pos_local_events_restaurant_ts_idx" ON "public"."pos_local_events" USING "btree" ("restaurant_id", "ts");



CREATE INDEX "pos_sessions_staff_client" ON "public"."pos_sessions" USING "btree" ("staff_id", "client_id", "last_heartbeat");



CREATE UNIQUE INDEX "pos_sessions_terminal_client" ON "public"."pos_sessions" USING "btree" ("terminal_id", "client_id");



CREATE INDEX "reviews_date_idx" ON "public"."reviews" USING "btree" ("date" DESC NULLS LAST);



CREATE INDEX "reviews_rating_idx" ON "public"."reviews" USING "btree" ("rating");



CREATE INDEX "reviews_status_idx" ON "public"."reviews" USING "btree" ("status");



CREATE UNIQUE INDEX "uq_cierres_turno_id" ON "public"."pos_cierres" USING "btree" ("turno_id") WHERE ("turno_id" IS NOT NULL);



CREATE UNIQUE INDEX "uq_ops_daily_close" ON "public"."ops_daily" USING "btree" ("client_id", "fecha", "record_type") WHERE ("record_type" = ANY (ARRAY['cierre'::"text", 'cierre_wansoft'::"text"]));



CREATE UNIQUE INDEX "uq_ops_daily_snapshot" ON "public"."ops_daily" USING "btree" ("client_id", "fecha", "bucket_start") WHERE ("record_type" = 'snapshot'::"text");



CREATE UNIQUE INDEX "uq_recipe_active" ON "public"."pos_recipe_versions" USING "btree" ("client_id", "menu_item_id") WHERE ("active" = true);



CREATE OR REPLACE TRIGGER "events_immutable" BEFORE DELETE OR UPDATE ON "public"."events" FOR EACH ROW EXECUTE FUNCTION "public"."reject_mutation"();



CREATE OR REPLACE TRIGGER "platform_audit_log_no_mutate" BEFORE DELETE OR UPDATE ON "public"."platform_audit_log" FOR EACH ROW EXECUTE FUNCTION "public"."platform_audit_log_immutable"();



CREATE OR REPLACE TRIGGER "reviews_set_updated_at" BEFORE UPDATE ON "public"."reviews" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_codigo_reserva" BEFORE INSERT ON "public"."amalay_reservaciones" FOR EACH ROW EXECUTE FUNCTION "public"."gen_codigo_reserva"();



CREATE OR REPLACE TRIGGER "trg_default_inventory_policy" AFTER INSERT ON "public"."pos_menu_items" FOR EACH ROW EXECUTE FUNCTION "public"."fn_default_inventory_policy_on_menu_item"();



CREATE OR REPLACE TRIGGER "trg_pos_order_number" BEFORE INSERT ON "public"."pos_orders" FOR EACH ROW EXECUTE FUNCTION "public"."set_pos_order_number"();



CREATE OR REPLACE TRIGGER "trg_pos_orders_updated_at" BEFORE UPDATE ON "public"."pos_orders" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_reservaciones_updated_at" BEFORE UPDATE ON "public"."amalay_reservaciones" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."client_locations"
    ADD CONSTRAINT "client_locations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."client_users"
    ADD CONSTRAINT "client_users_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."client_users"
    ADD CONSTRAINT "client_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."delivery_orders"
    ADD CONSTRAINT "delivery_orders_webhook_event_id_fkey" FOREIGN KEY ("webhook_event_id") REFERENCES "public"."integration_webhook_events"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."integration_webhook_dlq"
    ADD CONSTRAINT "integration_webhook_dlq_webhook_event_id_fkey" FOREIGN KEY ("webhook_event_id") REFERENCES "public"."integration_webhook_events"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ops_daily"
    ADD CONSTRAINT "ops_daily_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."pos_authority_transitions"
    ADD CONSTRAINT "pos_authority_transitions_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."pos_customer_visits"
    ADD CONSTRAINT "pos_customer_visits_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."pos_customers"("id");



ALTER TABLE ONLY "public"."pos_ingredient_presentations"
    ADD CONSTRAINT "pos_ingredient_presentations_presentation_id_fkey" FOREIGN KEY ("presentation_id") REFERENCES "public"."pos_presentations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pos_inventory_movements"
    ADD CONSTRAINT "pos_inventory_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."pos_inventory_products"("id");



ALTER TABLE ONLY "public"."pos_inventory_movements"
    ADD CONSTRAINT "pos_inventory_movements_reconciliation_result_id_fkey" FOREIGN KEY ("reconciliation_result_id") REFERENCES "public"."pos_reconciliation_results"("id");



ALTER TABLE ONLY "public"."pos_item_inventory_policy"
    ADD CONSTRAINT "pos_item_inventory_policy_client_id_menu_item_id_fkey" FOREIGN KEY ("client_id", "menu_item_id") REFERENCES "public"."pos_menu_items"("client_id", "id");



ALTER TABLE ONLY "public"."pos_item_inventory_policy"
    ADD CONSTRAINT "pos_item_inventory_policy_client_id_menu_item_id_market_st_fkey" FOREIGN KEY ("client_id", "menu_item_id", "market_stock_id") REFERENCES "public"."pos_market_stock"("client_id", "menu_item_id", "id");



ALTER TABLE ONLY "public"."pos_market_movements"
    ADD CONSTRAINT "pos_market_movements_reconciliation_result_id_fkey" FOREIGN KEY ("reconciliation_result_id") REFERENCES "public"."pos_reconciliation_results"("id");



ALTER TABLE ONLY "public"."pos_menu_item_recipes"
    ADD CONSTRAINT "pos_menu_item_recipes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pos_menu_items"
    ADD CONSTRAINT "pos_menu_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."pos_menu_categories"("id");



ALTER TABLE ONLY "public"."pos_modifiers"
    ADD CONSTRAINT "pos_modifiers_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."pos_modifier_groups"("id");



ALTER TABLE ONLY "public"."pos_mutation_authority"
    ADD CONSTRAINT "pos_mutation_authority_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."pos_recipe_lines"
    ADD CONSTRAINT "pos_recipe_lines_client_id_ingredient_id_fkey" FOREIGN KEY ("client_id", "ingredient_id") REFERENCES "public"."pos_ingredients"("client_id", "id");



ALTER TABLE ONLY "public"."pos_recipe_lines"
    ADD CONSTRAINT "pos_recipe_lines_client_id_ingredient_id_fkey1" FOREIGN KEY ("client_id", "ingredient_id") REFERENCES "public"."pos_inventory"("client_id", "ingredient_id");



ALTER TABLE ONLY "public"."pos_recipe_lines"
    ADD CONSTRAINT "pos_recipe_lines_client_id_recipe_version_id_fkey" FOREIGN KEY ("client_id", "recipe_version_id") REFERENCES "public"."pos_recipe_versions"("client_id", "id");



ALTER TABLE ONLY "public"."pos_recipe_versions"
    ADD CONSTRAINT "pos_recipe_versions_client_id_menu_item_id_fkey" FOREIGN KEY ("client_id", "menu_item_id") REFERENCES "public"."pos_menu_items"("client_id", "id");



ALTER TABLE ONLY "public"."pos_reconciliation_results"
    ADD CONSTRAINT "pos_reconciliation_results_client_id_menu_item_id_pinned_m_fkey" FOREIGN KEY ("client_id", "menu_item_id", "pinned_market_stock_id") REFERENCES "public"."pos_market_stock"("client_id", "menu_item_id", "id");



ALTER TABLE ONLY "public"."pos_reconciliation_results"
    ADD CONSTRAINT "pos_reconciliation_results_client_id_menu_item_id_pinned_r_fkey" FOREIGN KEY ("client_id", "menu_item_id", "pinned_recipe_version_id") REFERENCES "public"."pos_recipe_versions"("client_id", "menu_item_id", "id");



ALTER TABLE ONLY "public"."pos_sub_recipe_ingredients"
    ADD CONSTRAINT "pos_sub_recipe_ingredients_sub_recipe_id_fkey" FOREIGN KEY ("sub_recipe_id") REFERENCES "public"."pos_sub_recipes"("id") ON DELETE CASCADE;



CREATE POLICY "Allow read" ON "public"."wansoft_kpis" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."agent_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agent_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agent_insights" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "agent_insights_tenant_read" ON "public"."agent_insights" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



ALTER TABLE "public"."agent_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agent_results" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "agent_results_tenant_read" ON "public"."agent_results" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



ALTER TABLE "public"."agent_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "agent_runs_read" ON "public"."agent_runs" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."amalay_reservaciones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "anon_update_draft" ON "public"."reviews" FOR UPDATE TO "authenticated" USING (("status" = ANY (ARRAY['pending'::"text", 'draft'::"text"]))) WITH CHECK (("status" = ANY (ARRAY['pending'::"text", 'draft'::"text"])));



CREATE POLICY "authenticated_read" ON "public"."agent_events" FOR SELECT TO "authenticated" USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."id" = COALESCE(NULLIF((("current_setting"('request.headers'::"text", true))::json ->> 'x-client-id'::"text"), ''::"text"), ''::"text")))));



CREATE POLICY "authread_client_users" ON "public"."client_users" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_delivery_orders" ON "public"."delivery_orders" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_delivery_platform_payments" ON "public"."delivery_platform_payments" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_feature_flags" ON "public"."feature_flags" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "authread_ops_daily" ON "public"."ops_daily" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_platform_settings" ON "public"."platform_settings" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "authread_pos_attendance" ON "public"."pos_attendance" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_audit_log" ON "public"."pos_audit_log" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_billing_clients" ON "public"."pos_billing_clients" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_bridge_logs" ON "public"."pos_bridge_logs" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_cash_movements" ON "public"."pos_cash_movements" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_category_modifiers" ON "public"."pos_category_modifiers" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_cfdi_requests" ON "public"."pos_cfdi_requests" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_cierres" ON "public"."pos_cierres" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_clients" ON "public"."pos_clients" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_combos" ON "public"."pos_combos" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_customer_notes" ON "public"."pos_customer_notes" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_customer_visits" ON "public"."pos_customer_visits" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_customers" ON "public"."pos_customers" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_delivery_zones" ON "public"."pos_delivery_zones" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_facturas" ON "public"."pos_facturas" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_fingerprint_templates" ON "public"."pos_fingerprint_templates" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_gastos" ON "public"."pos_gastos" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_gift_cards" ON "public"."pos_gift_cards" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_ingredient_presentations" ON "public"."pos_ingredient_presentations" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_ingredients" ON "public"."pos_ingredients" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_insumos" ON "public"."pos_insumos" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_inventory" ON "public"."pos_inventory" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_inventory_alerts" ON "public"."pos_inventory_alerts" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_inventory_movements" ON "public"."pos_inventory_movements" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_inventory_products" ON "public"."pos_inventory_products" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_item_inventory_policy" ON "public"."pos_item_inventory_policy" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_item_modifier_groups" ON "public"."pos_item_modifier_groups" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_market_movements" ON "public"."pos_market_movements" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_market_stock" ON "public"."pos_market_stock" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_menu_categories" ON "public"."pos_menu_categories" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_menu_item_recipes" ON "public"."pos_menu_item_recipes" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_mesas" ON "public"."pos_mesas" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_modifier_groups" ON "public"."pos_modifier_groups" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_modifiers" ON "public"."pos_modifiers" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_mutation_authority" ON "public"."pos_mutation_authority" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_payment_methods" ON "public"."pos_payment_methods" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_presentations" ON "public"."pos_presentations" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_price_types" ON "public"."pos_price_types" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_print_jobs" ON "public"."pos_print_jobs" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_promos" ON "public"."pos_promos" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_promotions" ON "public"."pos_promotions" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_purchase_orders" ON "public"."pos_purchase_orders" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_recipe_details" ON "public"."pos_recipe_details" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_recipe_lines" ON "public"."pos_recipe_lines" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_recipe_versions" ON "public"."pos_recipe_versions" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_recipes" ON "public"."pos_recipes" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_recipes_old" ON "public"."pos_recipes_old" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_reconciliation_results" ON "public"."pos_reconciliation_results" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_retail_groups" ON "public"."pos_retail_groups" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_retail_items" ON "public"."pos_retail_items" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_retail_promotions" ON "public"."pos_retail_promotions" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_save_operations" ON "public"."pos_save_operations" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_schedules" ON "public"."pos_schedules" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_sessions" ON "public"."pos_sessions" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_sizes" ON "public"."pos_sizes" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_staff_audit" ON "public"."pos_staff_audit" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_staff_shifts" ON "public"."pos_staff_shifts" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_sub_recipes" ON "public"."pos_sub_recipes" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_suppliers" ON "public"."pos_suppliers" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_turnos" ON "public"."pos_turnos" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_pos_unit_conversions" ON "public"."pos_unit_conversions" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_reservaciones" ON "public"."reservaciones" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_reviews" ON "public"."reviews" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "authread_wansoft_data" ON "public"."wansoft_data" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "authread_wansoft_kpis" ON "public"."wansoft_kpis" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "b2_authdel_pos_attendance" ON "public"."pos_attendance" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_pos_audit_log" ON "public"."pos_audit_log" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_pos_cash_movements" ON "public"."pos_cash_movements" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_pos_category_modifiers" ON "public"."pos_category_modifiers" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_pos_cfdi_requests" ON "public"."pos_cfdi_requests" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_pos_cierres" ON "public"."pos_cierres" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_pos_combos" ON "public"."pos_combos" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_pos_customer_notes" ON "public"."pos_customer_notes" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_pos_gastos" ON "public"."pos_gastos" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_pos_ingredients" ON "public"."pos_ingredients" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_pos_inventory_movements" ON "public"."pos_inventory_movements" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_pos_menu_categories" ON "public"."pos_menu_categories" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_pos_modifier_groups" ON "public"."pos_modifier_groups" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_pos_modifiers" ON "public"."pos_modifiers" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_pos_payment_methods" ON "public"."pos_payment_methods" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_pos_print_jobs" ON "public"."pos_print_jobs" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_pos_promotions" ON "public"."pos_promotions" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_pos_recipes_old" ON "public"."pos_recipes_old" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_pos_staff_shifts" ON "public"."pos_staff_shifts" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_pos_suppliers" ON "public"."pos_suppliers" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_pos_turnos" ON "public"."pos_turnos" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_push_subscriptions" ON "public"."push_subscriptions" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_wansoft_data" ON "public"."wansoft_data" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_wansoft_food_cost" ON "public"."wansoft_food_cost" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_wansoft_hourly" ON "public"."wansoft_hourly" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_wansoft_inventory" ON "public"."wansoft_inventory" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_wansoft_labor" ON "public"."wansoft_labor" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_wansoft_menu_config" ON "public"."wansoft_menu_config" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_wansoft_persons_hourly" ON "public"."wansoft_persons_hourly" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_wansoft_pnl" ON "public"."wansoft_pnl" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_wansoft_recipes" ON "public"."wansoft_recipes" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_wansoft_shrinkage" ON "public"."wansoft_shrinkage" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_wansoft_suppliers" ON "public"."wansoft_suppliers" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authdel_wansoft_tips" ON "public"."wansoft_tips" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_pos_attendance" ON "public"."pos_attendance" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_pos_audit_log" ON "public"."pos_audit_log" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_pos_cash_movements" ON "public"."pos_cash_movements" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_pos_category_modifiers" ON "public"."pos_category_modifiers" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_pos_cfdi_requests" ON "public"."pos_cfdi_requests" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_pos_cierres" ON "public"."pos_cierres" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_pos_combos" ON "public"."pos_combos" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_pos_customer_notes" ON "public"."pos_customer_notes" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_pos_gastos" ON "public"."pos_gastos" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_pos_ingredients" ON "public"."pos_ingredients" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_pos_inventory_movements" ON "public"."pos_inventory_movements" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_pos_menu_categories" ON "public"."pos_menu_categories" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_pos_modifier_groups" ON "public"."pos_modifier_groups" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_pos_modifiers" ON "public"."pos_modifiers" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_pos_payment_methods" ON "public"."pos_payment_methods" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_pos_print_jobs" ON "public"."pos_print_jobs" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_pos_promotions" ON "public"."pos_promotions" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_pos_recipes_old" ON "public"."pos_recipes_old" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_pos_staff_shifts" ON "public"."pos_staff_shifts" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_pos_suppliers" ON "public"."pos_suppliers" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_pos_turnos" ON "public"."pos_turnos" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_push_subscriptions" ON "public"."push_subscriptions" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_wansoft_data" ON "public"."wansoft_data" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_wansoft_food_cost" ON "public"."wansoft_food_cost" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_wansoft_hourly" ON "public"."wansoft_hourly" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_wansoft_inventory" ON "public"."wansoft_inventory" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_wansoft_labor" ON "public"."wansoft_labor" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_wansoft_menu_config" ON "public"."wansoft_menu_config" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_wansoft_persons_hourly" ON "public"."wansoft_persons_hourly" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_wansoft_pnl" ON "public"."wansoft_pnl" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_wansoft_recipes" ON "public"."wansoft_recipes" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_wansoft_shrinkage" ON "public"."wansoft_shrinkage" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_wansoft_suppliers" ON "public"."wansoft_suppliers" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authins_wansoft_tips" ON "public"."wansoft_tips" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_pos_attendance" ON "public"."pos_attendance" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_pos_audit_log" ON "public"."pos_audit_log" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_pos_cash_movements" ON "public"."pos_cash_movements" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_pos_category_modifiers" ON "public"."pos_category_modifiers" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_pos_cfdi_requests" ON "public"."pos_cfdi_requests" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_pos_cierres" ON "public"."pos_cierres" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_pos_combos" ON "public"."pos_combos" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_pos_customer_notes" ON "public"."pos_customer_notes" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_pos_gastos" ON "public"."pos_gastos" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_pos_ingredients" ON "public"."pos_ingredients" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_pos_inventory_movements" ON "public"."pos_inventory_movements" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_pos_menu_categories" ON "public"."pos_menu_categories" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_pos_modifier_groups" ON "public"."pos_modifier_groups" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_pos_modifiers" ON "public"."pos_modifiers" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_pos_payment_methods" ON "public"."pos_payment_methods" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_pos_print_jobs" ON "public"."pos_print_jobs" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_pos_promotions" ON "public"."pos_promotions" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_pos_recipes_old" ON "public"."pos_recipes_old" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_pos_staff_shifts" ON "public"."pos_staff_shifts" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_pos_suppliers" ON "public"."pos_suppliers" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_pos_turnos" ON "public"."pos_turnos" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_push_subscriptions" ON "public"."push_subscriptions" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_wansoft_data" ON "public"."wansoft_data" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_wansoft_food_cost" ON "public"."wansoft_food_cost" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_wansoft_hourly" ON "public"."wansoft_hourly" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_wansoft_inventory" ON "public"."wansoft_inventory" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_wansoft_labor" ON "public"."wansoft_labor" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_wansoft_menu_config" ON "public"."wansoft_menu_config" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_wansoft_persons_hourly" ON "public"."wansoft_persons_hourly" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_wansoft_pnl" ON "public"."wansoft_pnl" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_wansoft_recipes" ON "public"."wansoft_recipes" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_wansoft_shrinkage" ON "public"."wansoft_shrinkage" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_wansoft_suppliers" ON "public"."wansoft_suppliers" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authsel_wansoft_tips" ON "public"."wansoft_tips" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_pos_attendance" ON "public"."pos_attendance" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_pos_audit_log" ON "public"."pos_audit_log" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_pos_cash_movements" ON "public"."pos_cash_movements" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_pos_category_modifiers" ON "public"."pos_category_modifiers" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_pos_cfdi_requests" ON "public"."pos_cfdi_requests" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_pos_cierres" ON "public"."pos_cierres" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_pos_combos" ON "public"."pos_combos" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_pos_customer_notes" ON "public"."pos_customer_notes" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_pos_gastos" ON "public"."pos_gastos" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_pos_ingredients" ON "public"."pos_ingredients" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_pos_inventory_movements" ON "public"."pos_inventory_movements" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_pos_menu_categories" ON "public"."pos_menu_categories" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_pos_modifier_groups" ON "public"."pos_modifier_groups" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_pos_modifiers" ON "public"."pos_modifiers" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_pos_payment_methods" ON "public"."pos_payment_methods" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_pos_print_jobs" ON "public"."pos_print_jobs" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_pos_promotions" ON "public"."pos_promotions" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_pos_recipes_old" ON "public"."pos_recipes_old" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_pos_staff_shifts" ON "public"."pos_staff_shifts" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_pos_suppliers" ON "public"."pos_suppliers" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_pos_turnos" ON "public"."pos_turnos" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_push_subscriptions" ON "public"."push_subscriptions" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_wansoft_data" ON "public"."wansoft_data" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_wansoft_food_cost" ON "public"."wansoft_food_cost" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_wansoft_hourly" ON "public"."wansoft_hourly" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_wansoft_inventory" ON "public"."wansoft_inventory" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_wansoft_labor" ON "public"."wansoft_labor" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_wansoft_menu_config" ON "public"."wansoft_menu_config" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_wansoft_persons_hourly" ON "public"."wansoft_persons_hourly" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_wansoft_pnl" ON "public"."wansoft_pnl" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_wansoft_recipes" ON "public"."wansoft_recipes" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_wansoft_shrinkage" ON "public"."wansoft_shrinkage" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_wansoft_suppliers" ON "public"."wansoft_suppliers" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "b2_authupd_wansoft_tips" ON "public"."wansoft_tips" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



ALTER TABLE "public"."calendar_sync_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chat_insert" ON "public"."chat_logs" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ("auth"."uid"())::"text") AND "private"."user_has_client_access"("client_id")));



ALTER TABLE "public"."chat_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chat_select" ON "public"."chat_logs" FOR SELECT TO "authenticated" USING ((("user_id" = ("auth"."uid"())::"text") AND "private"."user_has_client_access"("client_id")));



CREATE POLICY "chat_update" ON "public"."chat_logs" FOR UPDATE TO "authenticated" USING ((("user_id" = ("auth"."uid"())::"text") AND "private"."user_has_client_access"("client_id"))) WITH CHECK ((("user_id" = ("auth"."uid"())::"text") AND "private"."user_has_client_access"("client_id")));



ALTER TABLE "public"."client_locations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_locations_por_tenant" ON "public"."client_locations" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



ALTER TABLE "public"."client_users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clients_tenant_read" ON "public"."clients" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("id"));



ALTER TABLE "public"."content" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."credentials_vault" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."delivery_dlq" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."delivery_orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "delivery_orders_del" ON "public"."delivery_orders" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "delivery_orders_ins" ON "public"."delivery_orders" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "delivery_orders_sel" ON "public"."delivery_orders" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "delivery_orders_svc" ON "public"."delivery_orders" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "delivery_orders_upd" ON "public"."delivery_orders" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



ALTER TABLE "public"."delivery_platform_payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "events_insert_authenticated" ON "public"."events" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "events_select_authenticated" ON "public"."events" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."feature_flags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "hb_auth_ins" ON "public"."local_server_heartbeats" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("restaurant_id"));



CREATE POLICY "hb_auth_sel" ON "public"."local_server_heartbeats" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("restaurant_id"));



CREATE POLICY "hb_auth_upd" ON "public"."local_server_heartbeats" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("restaurant_id")) WITH CHECK ("private"."user_has_client_access"("restaurant_id"));



CREATE POLICY "hb_svc" ON "public"."local_server_heartbeats" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."integration_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."integration_providers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."integration_store_mappings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."integration_webhook_dlq" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."integration_webhook_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lab_issues" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."local_server_heartbeats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."memories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ops_daily" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."parity_reports" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pat_tenant_admin_read" ON "public"."pos_authority_transitions" FOR SELECT TO "authenticated" USING (("restaurant_id" IN ( SELECT "client_users"."client_id"
   FROM "public"."client_users"
  WHERE (("client_users"."user_id" = "auth"."uid"()) AND ("client_users"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text"]))))));



ALTER TABLE "public"."platform_2fa_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."platform_2fa_enrollment" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."platform_admins" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."platform_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."platform_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_attendance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_authority_transitions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_billing_clients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_bridge_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_cash_movements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_category_modifiers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_cfdi_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_cierres" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_clients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_combos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_customer_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_customer_visits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_customers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_delivery_zones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_facturas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_fingerprint_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_gastos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_gift_cards" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_ingredient_presentations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_ingredients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_insumos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_inventory" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_inventory_alerts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_inventory_movements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_inventory_products" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_item_inventory_policy" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_item_modifier_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_local_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pos_local_events_tenant_admin_read" ON "public"."pos_local_events" FOR SELECT TO "authenticated" USING (("restaurant_id" IN ( SELECT "client_users"."client_id"
   FROM "public"."client_users"
  WHERE (("client_users"."user_id" = "auth"."uid"()) AND ("client_users"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text"]))))));



ALTER TABLE "public"."pos_market_movements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_market_stock" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_menu_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_menu_item_recipes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_menu_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pos_menu_items_del" ON "public"."pos_menu_items" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "pos_menu_items_ins" ON "public"."pos_menu_items" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "pos_menu_items_sel" ON "public"."pos_menu_items" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "pos_menu_items_svc" ON "public"."pos_menu_items" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "pos_menu_items_upd" ON "public"."pos_menu_items" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



ALTER TABLE "public"."pos_mesas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_modifier_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_modifiers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_mutation_authority" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pos_orders_del" ON "public"."pos_orders" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "pos_orders_ins" ON "public"."pos_orders" FOR INSERT TO "authenticated" WITH CHECK (("private"."user_has_client_access"("client_id") AND ("turno_id" IS NOT NULL)));



CREATE POLICY "pos_orders_sel" ON "public"."pos_orders" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "pos_orders_svc" ON "public"."pos_orders" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "pos_orders_upd" ON "public"."pos_orders" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK (("private"."user_has_client_access"("client_id") AND ("turno_id" IS NOT NULL)));



ALTER TABLE "public"."pos_payment_methods" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_presentations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_price_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_print_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_promos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_promotions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_purchase_order_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pos_purchase_order_items_por_tenant" ON "public"."pos_purchase_order_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."pos_purchase_orders" "po"
  WHERE (("po"."id" = "pos_purchase_order_items"."order_id") AND "private"."user_has_client_access"("po"."client_id")))));



ALTER TABLE "public"."pos_purchase_orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_recipe_details" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_recipe_lines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_recipe_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_recipes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_recipes_old" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_reconciliation_results" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_retail_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_retail_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_retail_promotions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_save_operations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_schedules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_sizes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_staff" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_staff_audit" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pos_staff_del" ON "public"."pos_staff" FOR DELETE TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "pos_staff_ins" ON "public"."pos_staff" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "pos_staff_sel" ON "public"."pos_staff" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



ALTER TABLE "public"."pos_staff_shifts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pos_staff_svc" ON "public"."pos_staff" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "pos_staff_upd" ON "public"."pos_staff" FOR UPDATE TO "authenticated" USING ("private"."user_has_client_access"("client_id")) WITH CHECK ("private"."user_has_client_access"("client_id"));



ALTER TABLE "public"."pos_sub_recipe_ingredients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pos_sub_recipe_ingredients_por_tenant" ON "public"."pos_sub_recipe_ingredients" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."pos_sub_recipes" "sr"
  WHERE (("sr"."id" = "pos_sub_recipe_ingredients"."sub_recipe_id") AND "private"."user_has_client_access"("sr"."client_id")))));



ALTER TABLE "public"."pos_sub_recipes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_suppliers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_survey" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_time_clock" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pos_time_clock_ins" ON "public"."pos_time_clock" FOR INSERT TO "authenticated" WITH CHECK ("private"."user_has_client_access"("client_id"));



CREATE POLICY "pos_time_clock_sel" ON "public"."pos_time_clock" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_id"));



CREATE POLICY "pos_time_clock_svc" ON "public"."pos_time_clock" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."pos_turnos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_unit_conversions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."prospects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."provisioning_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."r1_observation_baseline" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."r1_observation_final" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."r1_observation_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reservaciones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rls_ip_service" ON "public"."pos_ingredient_presentations" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "rls_pres_service" ON "public"."pos_presentations" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "rls_sri_service" ON "public"."pos_sub_recipe_ingredients" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "rls_sub_recipes_service" ON "public"."pos_sub_recipes" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "rls_uc_service" ON "public"."pos_unit_conversions" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_all" ON "public"."integration_store_mappings" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_all_audit" ON "public"."pos_audit_log" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_all_cierres" ON "public"."pos_cierres" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_all_notes" ON "public"."pos_customer_notes" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_all_shifts" ON "public"."pos_staff_shifts" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_all_turnos" ON "public"."pos_turnos" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_write" ON "public"."agent_events" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "sro_only" ON "public"."integration_audit_log" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "sro_only" ON "public"."integration_providers" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "sro_only" ON "public"."integration_webhook_dlq" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "sro_only" ON "public"."integration_webhook_events" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_amalay_reservaciones" ON "public"."amalay_reservaciones" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_client_users" ON "public"."client_users" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_content" ON "public"."content" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_delivery_orders" ON "public"."delivery_orders" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_delivery_platform_payments" ON "public"."delivery_platform_payments" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_feature_flags" ON "public"."feature_flags" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_ops_daily" ON "public"."ops_daily" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_platform_settings" ON "public"."platform_settings" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_attendance" ON "public"."pos_attendance" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_audit_log" ON "public"."pos_audit_log" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_billing_clients" ON "public"."pos_billing_clients" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_bridge_logs" ON "public"."pos_bridge_logs" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_cash_movements" ON "public"."pos_cash_movements" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_category_modifiers" ON "public"."pos_category_modifiers" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_cfdi_requests" ON "public"."pos_cfdi_requests" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_cierres" ON "public"."pos_cierres" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_clients" ON "public"."pos_clients" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_combos" ON "public"."pos_combos" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_customer_notes" ON "public"."pos_customer_notes" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_customer_visits" ON "public"."pos_customer_visits" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_customers" ON "public"."pos_customers" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_delivery_zones" ON "public"."pos_delivery_zones" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_facturas" ON "public"."pos_facturas" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_fingerprint_templates" ON "public"."pos_fingerprint_templates" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_gastos" ON "public"."pos_gastos" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_gift_cards" ON "public"."pos_gift_cards" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_ingredient_presentations" ON "public"."pos_ingredient_presentations" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_ingredients" ON "public"."pos_ingredients" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_insumos" ON "public"."pos_insumos" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_inventory" ON "public"."pos_inventory" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_inventory_alerts" ON "public"."pos_inventory_alerts" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_inventory_movements" ON "public"."pos_inventory_movements" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_inventory_products" ON "public"."pos_inventory_products" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_item_inventory_policy" ON "public"."pos_item_inventory_policy" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_item_modifier_groups" ON "public"."pos_item_modifier_groups" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_market_movements" ON "public"."pos_market_movements" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_market_stock" ON "public"."pos_market_stock" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_menu_categories" ON "public"."pos_menu_categories" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_menu_item_recipes" ON "public"."pos_menu_item_recipes" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_mesas" ON "public"."pos_mesas" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_modifier_groups" ON "public"."pos_modifier_groups" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_modifiers" ON "public"."pos_modifiers" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_mutation_authority" ON "public"."pos_mutation_authority" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_payment_methods" ON "public"."pos_payment_methods" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_presentations" ON "public"."pos_presentations" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_price_types" ON "public"."pos_price_types" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_print_jobs" ON "public"."pos_print_jobs" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_promos" ON "public"."pos_promos" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_promotions" ON "public"."pos_promotions" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_purchase_order_items" ON "public"."pos_purchase_order_items" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_purchase_orders" ON "public"."pos_purchase_orders" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_recipe_details" ON "public"."pos_recipe_details" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_recipe_lines" ON "public"."pos_recipe_lines" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_recipe_versions" ON "public"."pos_recipe_versions" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_recipes" ON "public"."pos_recipes" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_recipes_old" ON "public"."pos_recipes_old" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_reconciliation_results" ON "public"."pos_reconciliation_results" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_retail_groups" ON "public"."pos_retail_groups" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_retail_items" ON "public"."pos_retail_items" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_retail_promotions" ON "public"."pos_retail_promotions" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_save_operations" ON "public"."pos_save_operations" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_schedules" ON "public"."pos_schedules" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_sessions" ON "public"."pos_sessions" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_sizes" ON "public"."pos_sizes" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_staff_audit" ON "public"."pos_staff_audit" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_staff_shifts" ON "public"."pos_staff_shifts" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_sub_recipe_ingredients" ON "public"."pos_sub_recipe_ingredients" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_sub_recipes" ON "public"."pos_sub_recipes" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_suppliers" ON "public"."pos_suppliers" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_turnos" ON "public"."pos_turnos" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_pos_unit_conversions" ON "public"."pos_unit_conversions" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_reservaciones" ON "public"."reservaciones" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_reviews" ON "public"."reviews" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_wansoft_data" ON "public"."wansoft_data" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_wansoft_kpis" ON "public"."wansoft_kpis" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wansoft_catalog" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wansoft_daily" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "wansoft_daily_sel" ON "public"."wansoft_daily" FOR SELECT TO "authenticated" USING ("private"."user_has_client_access"("client_slug"));



CREATE POLICY "wansoft_daily_svc" ON "public"."wansoft_daily" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."wansoft_data" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wansoft_food_cost" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wansoft_hourly" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wansoft_inventory" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wansoft_kpis" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wansoft_labor" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wansoft_menu_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wansoft_persons_hourly" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wansoft_pnl" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wansoft_recipes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wansoft_shrinkage" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wansoft_suppliers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wansoft_tips" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wansoft_waiter_categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "wansoft_waiter_categories_solo_lectura" ON "public"."wansoft_waiter_categories" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."whatsapp_conversations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."whatsapp_messages_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."whatsapp_whitelist" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT USAGE ON SCHEMA "public" TO "fullsite_readonly";
GRANT USAGE ON SCHEMA "public" TO "fullsite_agent";



REVOKE ALL ON FUNCTION "private"."can_write_client"("p_client_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_write_client"("p_client_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "private"."can_write_client"("p_client_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "private"."pos_terminal_client_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."pos_terminal_client_id"() TO "authenticated";



REVOKE ALL ON FUNCTION "private"."user_has_client_access"("target_client_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."user_has_client_access"("target_client_id" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."activate_recipe_version"("p_client_id" "text", "p_menu_item_id" "text", "p_new_version" integer, "p_actor" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."activate_recipe_version"("p_client_id" "text", "p_menu_item_id" "text", "p_new_version" integer, "p_actor" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."cancel_stale_pending_reservations"() TO "anon";
GRANT ALL ON FUNCTION "public"."cancel_stale_pending_reservations"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_stale_pending_reservations"() TO "service_role";



GRANT ALL ON FUNCTION "public"."convert_recipe_to_stock"("p_quantity" numeric, "p_recipe_unit" "text", "p_stock_unit" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."convert_recipe_to_stock"("p_quantity" numeric, "p_recipe_unit" "text", "p_stock_unit" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."convert_recipe_to_stock"("p_quantity" numeric, "p_recipe_unit" "text", "p_stock_unit" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_default_inventory_policy_on_menu_item"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_default_inventory_policy_on_menu_item"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_default_inventory_policy_on_menu_item"() TO "service_role";



GRANT ALL ON FUNCTION "public"."gen_codigo_reserva"() TO "anon";
GRANT ALL ON FUNCTION "public"."gen_codigo_reserva"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."gen_codigo_reserva"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_platform_admin"("p_email" "text", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_platform_admin"("p_email" "text", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."platform_audit_log_immutable"() TO "anon";
GRANT ALL ON FUNCTION "public"."platform_audit_log_immutable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."platform_audit_log_immutable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."r1_add_items"("p_client_id" "text", "p_order_id" "text", "p_items" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."r1_add_items"("p_client_id" "text", "p_order_id" "text", "p_items" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."r1_adjust_market_stock"("p_client_id" "text", "p_menu_item_id" "text", "p_adjustment_type" "text", "p_quantity" numeric, "p_actor" "text", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."r1_adjust_market_stock"("p_client_id" "text", "p_menu_item_id" "text", "p_adjustment_type" "text", "p_quantity" numeric, "p_actor" "text", "p_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."r1_legacy_sale_deduction"("p_client_id" "text", "p_order_id" "text", "p_actor" "text", "p_items" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."r1_legacy_sale_deduction"("p_client_id" "text", "p_order_id" "text", "p_actor" "text", "p_items" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."r1_merge_orders"("p_client_id" "text", "p_target_order_id" "text", "p_target_expected_revision" bigint, "p_source_order_id" "text", "p_source_expected_revision" bigint, "p_merged_items" "jsonb", "p_total" numeric, "p_subtotal" numeric, "p_iva" numeric, "p_personas" integer, "p_notas" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."r1_merge_orders"("p_client_id" "text", "p_target_order_id" "text", "p_target_expected_revision" bigint, "p_source_order_id" "text", "p_source_expected_revision" bigint, "p_merged_items" "jsonb", "p_total" numeric, "p_subtotal" numeric, "p_iva" numeric, "p_personas" integer, "p_notas" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."r1_observation_sample"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."r1_observation_sample"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."r1_observation_sample"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."r1_reconcile_item"("p_client_id" "text", "p_order_id" "text", "p_item_id" "text", "p_menu_item_id" "text", "p_desired" numeric, "p_sale_authority" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."r1_reconcile_item"("p_client_id" "text", "p_order_id" "text", "p_item_id" "text", "p_menu_item_id" "text", "p_desired" numeric, "p_sale_authority" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."r1_reconcile_order"("p_client_id" "text", "p_order_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."r1_reconcile_order"("p_client_id" "text", "p_order_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."r1_save_order"("p_client_id" "text", "p_order_id" "text", "p_expected_revision" bigint, "p_mesa" integer, "p_customer_name" "text", "p_mesero" "text", "p_personas" integer, "p_status" "text", "p_subtotal" numeric, "p_iva" numeric, "p_total" numeric, "p_descuento" numeric, "p_propina" numeric, "p_metodo_pago" "text", "p_pagos" "jsonb", "p_turno_id" "text", "p_notas" "text", "p_items" "jsonb", "p_closed_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."r1_save_order"("p_client_id" "text", "p_order_id" "text", "p_expected_revision" bigint, "p_mesa" integer, "p_customer_name" "text", "p_mesero" "text", "p_personas" integer, "p_status" "text", "p_subtotal" numeric, "p_iva" numeric, "p_total" numeric, "p_descuento" numeric, "p_propina" numeric, "p_metodo_pago" "text", "p_pagos" "jsonb", "p_turno_id" "text", "p_notas" "text", "p_items" "jsonb", "p_closed_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."r1_save_order"("p_client_id" "text", "p_order_id" "text", "p_expected_revision" bigint, "p_mesa" "text", "p_customer_name" "text", "p_mesero" "text", "p_personas" integer, "p_status" "text", "p_subtotal" numeric, "p_iva" numeric, "p_total" numeric, "p_descuento" numeric, "p_propina" numeric, "p_metodo_pago" "text", "p_pagos" "jsonb", "p_turno_id" "text", "p_notas" "text", "p_items" "jsonb", "p_closed_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."r1_save_order"("p_client_id" "text", "p_order_id" "text", "p_expected_revision" bigint, "p_mesa" "text", "p_customer_name" "text", "p_mesero" "text", "p_personas" integer, "p_status" "text", "p_subtotal" numeric, "p_iva" numeric, "p_total" numeric, "p_descuento" numeric, "p_propina" numeric, "p_metodo_pago" "text", "p_pagos" "jsonb", "p_turno_id" "text", "p_notas" "text", "p_items" "jsonb", "p_closed_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."r1_save_order"("p_client_id" "text", "p_order_id" "text", "p_expected_revision" bigint, "p_mesa" "text", "p_customer_name" "text", "p_mesero" "text", "p_personas" integer, "p_status" "text", "p_subtotal" numeric, "p_iva" numeric, "p_total" numeric, "p_descuento" numeric, "p_propina" numeric, "p_metodo_pago" "text", "p_pagos" "jsonb", "p_turno_id" "text", "p_notas" "text", "p_items" "jsonb", "p_closed_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."r1_save_order_idempotent"("p_client_id" "text", "p_order_id" "text", "p_save_operation_id" "text", "p_expected_revision" bigint, "p_mesa" integer, "p_customer_name" "text", "p_mesero" "text", "p_personas" integer, "p_status" "text", "p_subtotal" numeric, "p_iva" numeric, "p_total" numeric, "p_descuento" numeric, "p_propina" numeric, "p_metodo_pago" "text", "p_pagos" "jsonb", "p_turno_id" "text", "p_notas" "text", "p_items" "jsonb", "p_closed_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."r1_save_order_idempotent"("p_client_id" "text", "p_order_id" "text", "p_save_operation_id" "text", "p_expected_revision" bigint, "p_mesa" integer, "p_customer_name" "text", "p_mesero" "text", "p_personas" integer, "p_status" "text", "p_subtotal" numeric, "p_iva" numeric, "p_total" numeric, "p_descuento" numeric, "p_propina" numeric, "p_metodo_pago" "text", "p_pagos" "jsonb", "p_turno_id" "text", "p_notas" "text", "p_items" "jsonb", "p_closed_at" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."reconcile_order_inventory"("p_order_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reconcile_order_inventory"("p_order_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reconcile_order_inventory"("p_order_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."reject_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."reject_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reject_mutation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_pos_order_number"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_pos_order_number"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_pos_order_number"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON TABLE "public"."agent_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."agent_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_audit_log" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."agent_audit_log" TO "fullsite_readonly";
GRANT SELECT,INSERT ON TABLE "public"."agent_audit_log" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."agent_audit_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."agent_audit_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."agent_audit_log_id_seq" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."agent_audit_log_id_seq" TO "fullsite_readonly";
GRANT USAGE ON SEQUENCE "public"."agent_audit_log_id_seq" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."agent_events" TO "anon";
GRANT ALL ON TABLE "public"."agent_events" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_events" TO "service_role";
GRANT SELECT ON TABLE "public"."agent_events" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."agent_events" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."agent_insights" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."agent_insights" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_insights" TO "service_role";
GRANT SELECT ON TABLE "public"."agent_insights" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."agent_insights" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."agent_insights_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."agent_insights_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."agent_insights_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."agent_messages" TO "anon";
GRANT ALL ON TABLE "public"."agent_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_messages" TO "service_role";
GRANT SELECT ON TABLE "public"."agent_messages" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."agent_messages" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."agent_messages_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."agent_messages_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."agent_messages_id_seq" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."agent_messages_id_seq" TO "fullsite_readonly";
GRANT USAGE ON SEQUENCE "public"."agent_messages_id_seq" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."agent_results" TO "anon";
GRANT ALL ON TABLE "public"."agent_results" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_results" TO "service_role";
GRANT SELECT ON TABLE "public"."agent_results" TO "fullsite_readonly";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."agent_results" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."agent_results_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."agent_results_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."agent_results_id_seq" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."agent_results_id_seq" TO "fullsite_readonly";
GRANT USAGE ON SEQUENCE "public"."agent_results_id_seq" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."agent_runs" TO "service_role";
GRANT SELECT ON TABLE "public"."agent_runs" TO "fullsite_readonly";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."agent_runs" TO "fullsite_agent";
GRANT SELECT ON TABLE "public"."agent_runs" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."agent_runs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."agent_runs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."agent_runs_id_seq" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."agent_runs_id_seq" TO "fullsite_readonly";
GRANT USAGE ON SEQUENCE "public"."agent_runs_id_seq" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."amalay_reservaciones" TO "anon";
GRANT ALL ON TABLE "public"."amalay_reservaciones" TO "authenticated";
GRANT ALL ON TABLE "public"."amalay_reservaciones" TO "service_role";
GRANT SELECT ON TABLE "public"."amalay_reservaciones" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."amalay_reservaciones" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."calendar_sync_log" TO "anon";
GRANT ALL ON TABLE "public"."calendar_sync_log" TO "authenticated";
GRANT ALL ON TABLE "public"."calendar_sync_log" TO "service_role";
GRANT SELECT ON TABLE "public"."calendar_sync_log" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."calendar_sync_log" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."calendar_sync_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."calendar_sync_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."calendar_sync_log_id_seq" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."calendar_sync_log_id_seq" TO "fullsite_readonly";
GRANT USAGE ON SEQUENCE "public"."calendar_sync_log_id_seq" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."chat_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_logs" TO "service_role";
GRANT SELECT ON TABLE "public"."chat_logs" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."chat_logs" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."client_locations" TO "anon";
GRANT ALL ON TABLE "public"."client_locations" TO "authenticated";
GRANT ALL ON TABLE "public"."client_locations" TO "service_role";
GRANT SELECT ON TABLE "public"."client_locations" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."client_locations" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."client_users" TO "anon";
GRANT ALL ON TABLE "public"."client_users" TO "authenticated";
GRANT ALL ON TABLE "public"."client_users" TO "service_role";
GRANT SELECT ON TABLE "public"."client_users" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."client_users" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";
GRANT SELECT ON TABLE "public"."clients" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."clients" TO "fullsite_agent";



GRANT SELECT("id") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("display_name") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("city") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("timezone") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("wansoft_subsidiary_id") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("telegram_chat_ids") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("staff_exclude_meseros") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("staff_market") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("menu_categories") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("bebida_groups") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("reservaciones_table") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("kpis_row_id") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("business_context") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("report_recipients") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("active") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("default_theme") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("accent_color") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("mesas") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("meseros") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("features") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("iva_rate") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("logo_url") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("type") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("data_source") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("rfc") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("razon_social") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("regimen_fiscal") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("codigo_postal") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("domicilio_fiscal") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("staff_supervisors") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("address") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("phone") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("receipt_footer") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("business_day_start_local") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("pos_settings") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("support_email") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("plan") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("social_media") ON TABLE "public"."clients" TO "authenticated";



GRANT SELECT("pos_write_authority") ON TABLE "public"."clients" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."content" TO "anon";
GRANT ALL ON TABLE "public"."content" TO "authenticated";
GRANT ALL ON TABLE "public"."content" TO "service_role";
GRANT SELECT ON TABLE "public"."content" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."content" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."content_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."content_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."content_id_seq" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."content_id_seq" TO "fullsite_readonly";
GRANT USAGE ON SEQUENCE "public"."content_id_seq" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."credentials_vault" TO "service_role";
GRANT SELECT ON TABLE "public"."credentials_vault" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."credentials_vault" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."delivery_dlq" TO "service_role";
GRANT SELECT ON TABLE "public"."delivery_dlq" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."delivery_dlq" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."delivery_orders" TO "service_role";
GRANT SELECT ON TABLE "public"."delivery_orders" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."delivery_orders" TO "fullsite_agent";
GRANT SELECT ON TABLE "public"."delivery_orders" TO "authenticated";



GRANT ALL ON TABLE "public"."delivery_platform_payments" TO "service_role";
GRANT SELECT ON TABLE "public"."delivery_platform_payments" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."delivery_platform_payments" TO "fullsite_agent";
GRANT SELECT ON TABLE "public"."delivery_platform_payments" TO "authenticated";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."events" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";
GRANT SELECT ON TABLE "public"."events" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."events" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."events_sequence_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."events_sequence_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."events_sequence_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."feature_flags" TO "anon";
GRANT ALL ON TABLE "public"."feature_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."feature_flags" TO "service_role";
GRANT SELECT ON TABLE "public"."feature_flags" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."feature_flags" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."integration_audit_log" TO "service_role";
GRANT SELECT ON TABLE "public"."integration_audit_log" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."integration_audit_log" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."integration_providers" TO "service_role";
GRANT SELECT ON TABLE "public"."integration_providers" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."integration_providers" TO "fullsite_agent";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."integration_store_mappings" TO "anon";
GRANT ALL ON TABLE "public"."integration_store_mappings" TO "authenticated";
GRANT ALL ON TABLE "public"."integration_store_mappings" TO "service_role";
GRANT SELECT ON TABLE "public"."integration_store_mappings" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."integration_store_mappings" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."integration_webhook_dlq" TO "service_role";
GRANT SELECT ON TABLE "public"."integration_webhook_dlq" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."integration_webhook_dlq" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."integration_webhook_events" TO "service_role";
GRANT SELECT ON TABLE "public"."integration_webhook_events" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."integration_webhook_events" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."lab_issues" TO "anon";
GRANT ALL ON TABLE "public"."lab_issues" TO "authenticated";
GRANT ALL ON TABLE "public"."lab_issues" TO "service_role";
GRANT SELECT ON TABLE "public"."lab_issues" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."lab_issues" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."lab_issues_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."lab_issues_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."lab_issues_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."local_server_heartbeats" TO "anon";
GRANT ALL ON TABLE "public"."local_server_heartbeats" TO "authenticated";
GRANT ALL ON TABLE "public"."local_server_heartbeats" TO "service_role";
GRANT SELECT ON TABLE "public"."local_server_heartbeats" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."local_server_heartbeats" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."memories" TO "anon";
GRANT ALL ON TABLE "public"."memories" TO "authenticated";
GRANT ALL ON TABLE "public"."memories" TO "service_role";
GRANT SELECT ON TABLE "public"."memories" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."memories" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."ops_daily" TO "anon";
GRANT ALL ON TABLE "public"."ops_daily" TO "authenticated";
GRANT ALL ON TABLE "public"."ops_daily" TO "service_role";
GRANT SELECT ON TABLE "public"."ops_daily" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."ops_daily" TO "fullsite_agent";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_orders" TO "anon";
GRANT ALL ON TABLE "public"."pos_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_orders" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_orders" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_orders" TO "fullsite_agent";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."ocm_daily" TO "anon";
GRANT ALL ON TABLE "public"."ocm_daily" TO "authenticated";
GRANT ALL ON TABLE "public"."ocm_daily" TO "service_role";
GRANT SELECT ON TABLE "public"."ocm_daily" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."ocm_daily" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_menu_categories" TO "anon";
GRANT ALL ON TABLE "public"."pos_menu_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_menu_categories" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_menu_categories" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_menu_categories" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."pos_menu_items" TO "anon";
GRANT ALL ON TABLE "public"."pos_menu_items" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_menu_items" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_menu_items" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_menu_items" TO "fullsite_agent";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."ocm_menu_groups" TO "anon";
GRANT ALL ON TABLE "public"."ocm_menu_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."ocm_menu_groups" TO "service_role";
GRANT SELECT ON TABLE "public"."ocm_menu_groups" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."ocm_menu_groups" TO "fullsite_agent";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."ocm_menu_items" TO "anon";
GRANT ALL ON TABLE "public"."ocm_menu_items" TO "authenticated";
GRANT ALL ON TABLE "public"."ocm_menu_items" TO "service_role";
GRANT SELECT ON TABLE "public"."ocm_menu_items" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."ocm_menu_items" TO "fullsite_agent";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."ocm_waiter_rankings" TO "anon";
GRANT ALL ON TABLE "public"."ocm_waiter_rankings" TO "authenticated";
GRANT ALL ON TABLE "public"."ocm_waiter_rankings" TO "service_role";
GRANT SELECT ON TABLE "public"."ocm_waiter_rankings" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."ocm_waiter_rankings" TO "fullsite_agent";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."ops_daily_history" TO "anon";
GRANT ALL ON TABLE "public"."ops_daily_history" TO "authenticated";
GRANT ALL ON TABLE "public"."ops_daily_history" TO "service_role";
GRANT SELECT ON TABLE "public"."ops_daily_history" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."ops_daily_history" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."ops_daily_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ops_daily_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ops_daily_id_seq" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."ops_daily_live" TO "anon";
GRANT ALL ON TABLE "public"."ops_daily_live" TO "authenticated";
GRANT ALL ON TABLE "public"."ops_daily_live" TO "service_role";
GRANT SELECT ON TABLE "public"."ops_daily_live" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."ops_daily_live" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."parity_reports" TO "anon";
GRANT ALL ON TABLE "public"."parity_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."parity_reports" TO "service_role";
GRANT SELECT ON TABLE "public"."parity_reports" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."parity_reports" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."parity_reports_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."parity_reports_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."parity_reports_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."platform_2fa_codes" TO "service_role";
GRANT SELECT ON TABLE "public"."platform_2fa_codes" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."platform_2fa_codes" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."platform_2fa_enrollment" TO "service_role";
GRANT SELECT ON TABLE "public"."platform_2fa_enrollment" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."platform_2fa_enrollment" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."platform_admins" TO "anon";
GRANT ALL ON TABLE "public"."platform_admins" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_admins" TO "service_role";
GRANT SELECT ON TABLE "public"."platform_admins" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."platform_admins" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."platform_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."platform_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_audit_log" TO "service_role";
GRANT SELECT ON TABLE "public"."platform_audit_log" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."platform_audit_log" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."platform_audit_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."platform_audit_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."platform_audit_log_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."platform_settings" TO "anon";
GRANT ALL ON TABLE "public"."platform_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_settings" TO "service_role";
GRANT SELECT ON TABLE "public"."platform_settings" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."platform_settings" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_attendance" TO "anon";
GRANT ALL ON TABLE "public"."pos_attendance" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_attendance" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_attendance" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_attendance" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."pos_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_audit_log" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_audit_log" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_audit_log" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."pos_audit_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pos_audit_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pos_audit_log_id_seq" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."pos_audit_log_id_seq" TO "fullsite_readonly";
GRANT USAGE ON SEQUENCE "public"."pos_audit_log_id_seq" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."pos_authority_transitions" TO "anon";
GRANT ALL ON TABLE "public"."pos_authority_transitions" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_authority_transitions" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_authority_transitions" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_authority_transitions" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_billing_clients" TO "anon";
GRANT ALL ON TABLE "public"."pos_billing_clients" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_billing_clients" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_billing_clients" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_billing_clients" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."pos_bridge_logs" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_bridge_logs" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_bridge_logs" TO "fullsite_agent";
GRANT SELECT ON TABLE "public"."pos_bridge_logs" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_cash_movements" TO "anon";
GRANT ALL ON TABLE "public"."pos_cash_movements" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_cash_movements" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_cash_movements" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_cash_movements" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."pos_cash_movements_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pos_cash_movements_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pos_cash_movements_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_category_modifiers" TO "anon";
GRANT ALL ON TABLE "public"."pos_category_modifiers" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_category_modifiers" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_category_modifiers" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_category_modifiers" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."pos_category_modifiers_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pos_category_modifiers_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pos_category_modifiers_id_seq" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."pos_category_modifiers_id_seq" TO "fullsite_readonly";
GRANT USAGE ON SEQUENCE "public"."pos_category_modifiers_id_seq" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_cfdi_requests" TO "anon";
GRANT ALL ON TABLE "public"."pos_cfdi_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_cfdi_requests" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_cfdi_requests" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_cfdi_requests" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_cierres" TO "anon";
GRANT ALL ON TABLE "public"."pos_cierres" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_cierres" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_cierres" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_cierres" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_clients" TO "anon";
GRANT ALL ON TABLE "public"."pos_clients" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_clients" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_clients" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_clients" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_combos" TO "anon";
GRANT ALL ON TABLE "public"."pos_combos" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_combos" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_combos" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_combos" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_customer_notes" TO "anon";
GRANT ALL ON TABLE "public"."pos_customer_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_customer_notes" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_customer_notes" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_customer_notes" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_customer_visits" TO "anon";
GRANT ALL ON TABLE "public"."pos_customer_visits" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_customer_visits" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_customer_visits" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_customer_visits" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."pos_customer_visits_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pos_customer_visits_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pos_customer_visits_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_customers" TO "anon";
GRANT ALL ON TABLE "public"."pos_customers" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_customers" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_customers" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_customers" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."pos_customers_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pos_customers_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pos_customers_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."pos_delivery_zones" TO "anon";
GRANT ALL ON TABLE "public"."pos_delivery_zones" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_delivery_zones" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_delivery_zones" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_delivery_zones" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_facturas" TO "anon";
GRANT ALL ON TABLE "public"."pos_facturas" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_facturas" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_facturas" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_facturas" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_fingerprint_templates" TO "anon";
GRANT ALL ON TABLE "public"."pos_fingerprint_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_fingerprint_templates" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_fingerprint_templates" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_fingerprint_templates" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_gastos" TO "anon";
GRANT ALL ON TABLE "public"."pos_gastos" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_gastos" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_gastos" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_gastos" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."pos_gift_cards" TO "anon";
GRANT ALL ON TABLE "public"."pos_gift_cards" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_gift_cards" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_gift_cards" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_gift_cards" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_ingredient_presentations" TO "anon";
GRANT ALL ON TABLE "public"."pos_ingredient_presentations" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_ingredient_presentations" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_ingredient_presentations" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_ingredient_presentations" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."pos_ingredient_presentations_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pos_ingredient_presentations_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pos_ingredient_presentations_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_ingredients" TO "anon";
GRANT ALL ON TABLE "public"."pos_ingredients" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_ingredients" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_ingredients" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_ingredients" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_insumos" TO "anon";
GRANT ALL ON TABLE "public"."pos_insumos" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_insumos" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_insumos" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_insumos" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."pos_insumos_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pos_insumos_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pos_insumos_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_inventory" TO "anon";
GRANT ALL ON TABLE "public"."pos_inventory" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_inventory" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_inventory" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_inventory" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_inventory_alerts" TO "anon";
GRANT ALL ON TABLE "public"."pos_inventory_alerts" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_inventory_alerts" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_inventory_alerts" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_inventory_alerts" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."pos_inventory_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pos_inventory_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pos_inventory_id_seq" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."pos_inventory_id_seq" TO "fullsite_readonly";
GRANT USAGE ON SEQUENCE "public"."pos_inventory_id_seq" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_inventory_movements" TO "anon";
GRANT ALL ON TABLE "public"."pos_inventory_movements" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_inventory_movements" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_inventory_movements" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_inventory_movements" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."pos_inventory_movements_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pos_inventory_movements_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pos_inventory_movements_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_inventory_products" TO "anon";
GRANT ALL ON TABLE "public"."pos_inventory_products" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_inventory_products" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_inventory_products" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_inventory_products" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."pos_inventory_products_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pos_inventory_products_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pos_inventory_products_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_item_inventory_policy" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_item_inventory_policy" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_item_inventory_policy" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_item_inventory_policy" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_item_inventory_policy" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."pos_item_inventory_policy_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pos_item_inventory_policy_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pos_item_inventory_policy_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_item_modifier_groups" TO "anon";
GRANT ALL ON TABLE "public"."pos_item_modifier_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_item_modifier_groups" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_item_modifier_groups" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_item_modifier_groups" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."pos_local_events" TO "anon";
GRANT ALL ON TABLE "public"."pos_local_events" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_local_events" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_local_events" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_local_events" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_market_movements" TO "anon";
GRANT ALL ON TABLE "public"."pos_market_movements" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_market_movements" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_market_movements" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_market_movements" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."pos_market_movements_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pos_market_movements_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pos_market_movements_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_market_stock" TO "anon";
GRANT ALL ON TABLE "public"."pos_market_stock" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_market_stock" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_market_stock" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_market_stock" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."pos_market_stock_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pos_market_stock_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pos_market_stock_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_menu_item_recipes" TO "anon";
GRANT ALL ON TABLE "public"."pos_menu_item_recipes" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_menu_item_recipes" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_menu_item_recipes" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_menu_item_recipes" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_mesas" TO "anon";
GRANT ALL ON TABLE "public"."pos_mesas" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_mesas" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_mesas" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_mesas" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_modifier_groups" TO "anon";
GRANT ALL ON TABLE "public"."pos_modifier_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_modifier_groups" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_modifier_groups" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_modifier_groups" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_modifiers" TO "anon";
GRANT ALL ON TABLE "public"."pos_modifiers" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_modifiers" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_modifiers" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_modifiers" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_mutation_authority" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_mutation_authority" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_mutation_authority" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_mutation_authority" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_mutation_authority" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_payment_methods" TO "anon";
GRANT ALL ON TABLE "public"."pos_payment_methods" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_payment_methods" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_payment_methods" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_payment_methods" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_presentations" TO "anon";
GRANT ALL ON TABLE "public"."pos_presentations" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_presentations" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_presentations" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_presentations" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."pos_price_types" TO "anon";
GRANT ALL ON TABLE "public"."pos_price_types" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_price_types" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_price_types" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_price_types" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_print_jobs" TO "anon";
GRANT ALL ON TABLE "public"."pos_print_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_print_jobs" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_print_jobs" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_print_jobs" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_promos" TO "anon";
GRANT ALL ON TABLE "public"."pos_promos" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_promos" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_promos" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_promos" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_promotions" TO "anon";
GRANT ALL ON TABLE "public"."pos_promotions" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_promotions" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_promotions" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_promotions" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_purchase_order_items" TO "anon";
GRANT ALL ON TABLE "public"."pos_purchase_order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_purchase_order_items" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_purchase_order_items" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_purchase_order_items" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."pos_purchase_order_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pos_purchase_order_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pos_purchase_order_items_id_seq" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."pos_purchase_order_items_id_seq" TO "fullsite_readonly";
GRANT USAGE ON SEQUENCE "public"."pos_purchase_order_items_id_seq" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_purchase_orders" TO "anon";
GRANT ALL ON TABLE "public"."pos_purchase_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_purchase_orders" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_purchase_orders" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_purchase_orders" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_recipe_details" TO "anon";
GRANT ALL ON TABLE "public"."pos_recipe_details" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_recipe_details" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_recipe_details" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_recipe_details" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_recipe_lines" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_recipe_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_recipe_lines" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_recipe_lines" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_recipe_lines" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."pos_recipe_lines_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pos_recipe_lines_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pos_recipe_lines_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_recipe_versions" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_recipe_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_recipe_versions" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_recipe_versions" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_recipe_versions" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."pos_recipe_versions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pos_recipe_versions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pos_recipe_versions_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_recipes" TO "anon";
GRANT ALL ON TABLE "public"."pos_recipes" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_recipes" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_recipes" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_recipes" TO "fullsite_agent";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."pos_recipes_canonical" TO "anon";
GRANT ALL ON TABLE "public"."pos_recipes_canonical" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_recipes_canonical" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_recipes_canonical" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_recipes_canonical" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_recipes_old" TO "anon";
GRANT ALL ON TABLE "public"."pos_recipes_old" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_recipes_old" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_recipes_old" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_recipes_old" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."pos_recipes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pos_recipes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pos_recipes_id_seq" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."pos_recipes_id_seq" TO "fullsite_readonly";
GRANT USAGE ON SEQUENCE "public"."pos_recipes_id_seq" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."pos_recipes_id_seq1" TO "anon";
GRANT ALL ON SEQUENCE "public"."pos_recipes_id_seq1" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pos_recipes_id_seq1" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_reconciliation_results" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_reconciliation_results" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_reconciliation_results" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_reconciliation_results" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_reconciliation_results" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."pos_reconciliation_results_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pos_reconciliation_results_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pos_reconciliation_results_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."pos_retail_groups" TO "anon";
GRANT ALL ON TABLE "public"."pos_retail_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_retail_groups" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_retail_groups" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_retail_groups" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."pos_retail_items" TO "anon";
GRANT ALL ON TABLE "public"."pos_retail_items" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_retail_items" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_retail_items" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_retail_items" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."pos_retail_promotions" TO "anon";
GRANT ALL ON TABLE "public"."pos_retail_promotions" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_retail_promotions" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_retail_promotions" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_retail_promotions" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."pos_save_operations" TO "anon";
GRANT ALL ON TABLE "public"."pos_save_operations" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_save_operations" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_save_operations" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_save_operations" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."pos_schedules" TO "anon";
GRANT ALL ON TABLE "public"."pos_schedules" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_schedules" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_schedules" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_schedules" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_sessions" TO "anon";
GRANT ALL ON TABLE "public"."pos_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_sessions" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_sessions" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_sessions" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."pos_sizes" TO "anon";
GRANT ALL ON TABLE "public"."pos_sizes" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_sizes" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_sizes" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_sizes" TO "fullsite_agent";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_staff" TO "anon";
GRANT ALL ON TABLE "public"."pos_staff" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_staff" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_staff" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_staff" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_staff_audit" TO "anon";
GRANT ALL ON TABLE "public"."pos_staff_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_staff_audit" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_staff_audit" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_staff_audit" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."pos_staff_audit_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pos_staff_audit_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pos_staff_audit_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_staff_shifts" TO "anon";
GRANT ALL ON TABLE "public"."pos_staff_shifts" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_staff_shifts" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_staff_shifts" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_staff_shifts" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_sub_recipe_ingredients" TO "anon";
GRANT ALL ON TABLE "public"."pos_sub_recipe_ingredients" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_sub_recipe_ingredients" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_sub_recipe_ingredients" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_sub_recipe_ingredients" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."pos_sub_recipe_ingredients_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pos_sub_recipe_ingredients_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pos_sub_recipe_ingredients_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_sub_recipes" TO "anon";
GRANT ALL ON TABLE "public"."pos_sub_recipes" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_sub_recipes" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_sub_recipes" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_sub_recipes" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_suppliers" TO "anon";
GRANT ALL ON TABLE "public"."pos_suppliers" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_suppliers" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_suppliers" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_suppliers" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."pos_survey" TO "anon";
GRANT ALL ON TABLE "public"."pos_survey" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_survey" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_survey" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_survey" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."pos_survey_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pos_survey_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pos_survey_id_seq" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."pos_survey_id_seq" TO "fullsite_readonly";
GRANT USAGE ON SEQUENCE "public"."pos_survey_id_seq" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."pos_time_clock" TO "anon";
GRANT ALL ON TABLE "public"."pos_time_clock" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_time_clock" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_time_clock" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_time_clock" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_turnos" TO "anon";
GRANT ALL ON TABLE "public"."pos_turnos" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_turnos" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_turnos" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_turnos" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_unit_conversions" TO "anon";
GRANT ALL ON TABLE "public"."pos_unit_conversions" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_unit_conversions" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_unit_conversions" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."pos_unit_conversions" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."pos_unit_conversions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pos_unit_conversions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pos_unit_conversions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."prospects" TO "anon";
GRANT ALL ON TABLE "public"."prospects" TO "authenticated";
GRANT ALL ON TABLE "public"."prospects" TO "service_role";
GRANT SELECT ON TABLE "public"."prospects" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."prospects" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."provisioning_tokens" TO "anon";
GRANT ALL ON TABLE "public"."provisioning_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."provisioning_tokens" TO "service_role";
GRANT SELECT ON TABLE "public"."provisioning_tokens" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."provisioning_tokens" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."push_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";
GRANT SELECT ON TABLE "public"."push_subscriptions" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."push_subscriptions" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."push_subscriptions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."push_subscriptions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."push_subscriptions_id_seq" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."push_subscriptions_id_seq" TO "fullsite_readonly";
GRANT USAGE ON SEQUENCE "public"."push_subscriptions_id_seq" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."r1_observation_baseline" TO "anon";
GRANT ALL ON TABLE "public"."r1_observation_baseline" TO "authenticated";
GRANT ALL ON TABLE "public"."r1_observation_baseline" TO "service_role";
GRANT SELECT ON TABLE "public"."r1_observation_baseline" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."r1_observation_baseline" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."r1_observation_final" TO "anon";
GRANT ALL ON TABLE "public"."r1_observation_final" TO "authenticated";
GRANT ALL ON TABLE "public"."r1_observation_final" TO "service_role";
GRANT SELECT ON TABLE "public"."r1_observation_final" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."r1_observation_final" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."r1_observation_log" TO "anon";
GRANT ALL ON TABLE "public"."r1_observation_log" TO "authenticated";
GRANT ALL ON TABLE "public"."r1_observation_log" TO "service_role";
GRANT SELECT ON TABLE "public"."r1_observation_log" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."r1_observation_log" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."r1_observation_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."r1_observation_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."r1_observation_log_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."reservaciones" TO "anon";
GRANT ALL ON TABLE "public"."reservaciones" TO "authenticated";
GRANT ALL ON TABLE "public"."reservaciones" TO "service_role";
GRANT SELECT ON TABLE "public"."reservaciones" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."reservaciones" TO "fullsite_agent";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."reservaciones_activas" TO "anon";
GRANT ALL ON TABLE "public"."reservaciones_activas" TO "authenticated";
GRANT ALL ON TABLE "public"."reservaciones_activas" TO "service_role";
GRANT SELECT ON TABLE "public"."reservaciones_activas" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."reservaciones_activas" TO "fullsite_agent";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."reservaciones_hoy" TO "anon";
GRANT ALL ON TABLE "public"."reservaciones_hoy" TO "authenticated";
GRANT ALL ON TABLE "public"."reservaciones_hoy" TO "service_role";
GRANT SELECT ON TABLE "public"."reservaciones_hoy" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."reservaciones_hoy" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."reviews" TO "anon";
GRANT ALL ON TABLE "public"."reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."reviews" TO "service_role";
GRANT SELECT ON TABLE "public"."reviews" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."reviews" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."reviews_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."reviews_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."reviews_id_seq" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."reviews_id_seq" TO "fullsite_readonly";
GRANT USAGE ON SEQUENCE "public"."reviews_id_seq" TO "fullsite_agent";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."reviews_pending" TO "anon";
GRANT ALL ON TABLE "public"."reviews_pending" TO "authenticated";
GRANT ALL ON TABLE "public"."reviews_pending" TO "service_role";
GRANT SELECT ON TABLE "public"."reviews_pending" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."reviews_pending" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."tasks" TO "anon";
GRANT ALL ON TABLE "public"."tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."tasks" TO "service_role";
GRANT SELECT ON TABLE "public"."tasks" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."tasks" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."tasks_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."tasks_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."tasks_id_seq" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."tasks_id_seq" TO "fullsite_readonly";
GRANT USAGE ON SEQUENCE "public"."tasks_id_seq" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."wansoft_catalog" TO "anon";
GRANT ALL ON TABLE "public"."wansoft_catalog" TO "authenticated";
GRANT ALL ON TABLE "public"."wansoft_catalog" TO "service_role";
GRANT SELECT ON TABLE "public"."wansoft_catalog" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."wansoft_catalog" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."wansoft_catalog_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."wansoft_catalog_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."wansoft_catalog_id_seq" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."wansoft_catalog_id_seq" TO "fullsite_readonly";
GRANT USAGE ON SEQUENCE "public"."wansoft_catalog_id_seq" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."wansoft_daily" TO "anon";
GRANT ALL ON TABLE "public"."wansoft_daily" TO "authenticated";
GRANT ALL ON TABLE "public"."wansoft_daily" TO "service_role";
GRANT SELECT ON TABLE "public"."wansoft_daily" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."wansoft_daily" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."wansoft_data" TO "anon";
GRANT ALL ON TABLE "public"."wansoft_data" TO "authenticated";
GRANT ALL ON TABLE "public"."wansoft_data" TO "service_role";
GRANT SELECT ON TABLE "public"."wansoft_data" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."wansoft_data" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."wansoft_food_cost" TO "anon";
GRANT ALL ON TABLE "public"."wansoft_food_cost" TO "authenticated";
GRANT ALL ON TABLE "public"."wansoft_food_cost" TO "service_role";
GRANT SELECT ON TABLE "public"."wansoft_food_cost" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."wansoft_food_cost" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."wansoft_food_cost_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."wansoft_food_cost_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."wansoft_food_cost_id_seq" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."wansoft_food_cost_id_seq" TO "fullsite_readonly";
GRANT USAGE ON SEQUENCE "public"."wansoft_food_cost_id_seq" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."wansoft_hourly" TO "anon";
GRANT ALL ON TABLE "public"."wansoft_hourly" TO "authenticated";
GRANT ALL ON TABLE "public"."wansoft_hourly" TO "service_role";
GRANT SELECT ON TABLE "public"."wansoft_hourly" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."wansoft_hourly" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."wansoft_inventory" TO "anon";
GRANT ALL ON TABLE "public"."wansoft_inventory" TO "authenticated";
GRANT ALL ON TABLE "public"."wansoft_inventory" TO "service_role";
GRANT SELECT ON TABLE "public"."wansoft_inventory" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."wansoft_inventory" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."wansoft_inventory_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."wansoft_inventory_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."wansoft_inventory_id_seq" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."wansoft_inventory_id_seq" TO "fullsite_readonly";
GRANT USAGE ON SEQUENCE "public"."wansoft_inventory_id_seq" TO "fullsite_agent";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."wansoft_kpis" TO "anon";
GRANT ALL ON TABLE "public"."wansoft_kpis" TO "authenticated";
GRANT ALL ON TABLE "public"."wansoft_kpis" TO "service_role";
GRANT SELECT ON TABLE "public"."wansoft_kpis" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."wansoft_kpis" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."wansoft_labor" TO "anon";
GRANT ALL ON TABLE "public"."wansoft_labor" TO "authenticated";
GRANT ALL ON TABLE "public"."wansoft_labor" TO "service_role";
GRANT SELECT ON TABLE "public"."wansoft_labor" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."wansoft_labor" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."wansoft_labor_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."wansoft_labor_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."wansoft_labor_id_seq" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."wansoft_labor_id_seq" TO "fullsite_readonly";
GRANT USAGE ON SEQUENCE "public"."wansoft_labor_id_seq" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."wansoft_menu_config" TO "anon";
GRANT ALL ON TABLE "public"."wansoft_menu_config" TO "authenticated";
GRANT ALL ON TABLE "public"."wansoft_menu_config" TO "service_role";
GRANT SELECT ON TABLE "public"."wansoft_menu_config" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."wansoft_menu_config" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."wansoft_persons_hourly" TO "anon";
GRANT ALL ON TABLE "public"."wansoft_persons_hourly" TO "authenticated";
GRANT ALL ON TABLE "public"."wansoft_persons_hourly" TO "service_role";
GRANT SELECT ON TABLE "public"."wansoft_persons_hourly" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."wansoft_persons_hourly" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."wansoft_persons_hourly_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."wansoft_persons_hourly_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."wansoft_persons_hourly_id_seq" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."wansoft_persons_hourly_id_seq" TO "fullsite_readonly";
GRANT USAGE ON SEQUENCE "public"."wansoft_persons_hourly_id_seq" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."wansoft_pnl" TO "anon";
GRANT ALL ON TABLE "public"."wansoft_pnl" TO "authenticated";
GRANT ALL ON TABLE "public"."wansoft_pnl" TO "service_role";
GRANT SELECT ON TABLE "public"."wansoft_pnl" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."wansoft_pnl" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."wansoft_pnl_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."wansoft_pnl_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."wansoft_pnl_id_seq" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."wansoft_pnl_id_seq" TO "fullsite_readonly";
GRANT USAGE ON SEQUENCE "public"."wansoft_pnl_id_seq" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."wansoft_recipes" TO "anon";
GRANT ALL ON TABLE "public"."wansoft_recipes" TO "authenticated";
GRANT ALL ON TABLE "public"."wansoft_recipes" TO "service_role";
GRANT SELECT ON TABLE "public"."wansoft_recipes" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."wansoft_recipes" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."wansoft_recipes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."wansoft_recipes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."wansoft_recipes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."wansoft_shrinkage" TO "anon";
GRANT ALL ON TABLE "public"."wansoft_shrinkage" TO "authenticated";
GRANT ALL ON TABLE "public"."wansoft_shrinkage" TO "service_role";
GRANT SELECT ON TABLE "public"."wansoft_shrinkage" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."wansoft_shrinkage" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."wansoft_shrinkage_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."wansoft_shrinkage_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."wansoft_shrinkage_id_seq" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."wansoft_shrinkage_id_seq" TO "fullsite_readonly";
GRANT USAGE ON SEQUENCE "public"."wansoft_shrinkage_id_seq" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."wansoft_suppliers" TO "anon";
GRANT ALL ON TABLE "public"."wansoft_suppliers" TO "authenticated";
GRANT ALL ON TABLE "public"."wansoft_suppliers" TO "service_role";
GRANT SELECT ON TABLE "public"."wansoft_suppliers" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."wansoft_suppliers" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."wansoft_suppliers_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."wansoft_suppliers_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."wansoft_suppliers_id_seq" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."wansoft_suppliers_id_seq" TO "fullsite_readonly";
GRANT USAGE ON SEQUENCE "public"."wansoft_suppliers_id_seq" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."wansoft_tips" TO "anon";
GRANT ALL ON TABLE "public"."wansoft_tips" TO "authenticated";
GRANT ALL ON TABLE "public"."wansoft_tips" TO "service_role";
GRANT SELECT ON TABLE "public"."wansoft_tips" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."wansoft_tips" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."wansoft_tips_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."wansoft_tips_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."wansoft_tips_id_seq" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."wansoft_tips_id_seq" TO "fullsite_readonly";
GRANT USAGE ON SEQUENCE "public"."wansoft_tips_id_seq" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."wansoft_waiter_categories" TO "anon";
GRANT ALL ON TABLE "public"."wansoft_waiter_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."wansoft_waiter_categories" TO "service_role";
GRANT SELECT ON TABLE "public"."wansoft_waiter_categories" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."wansoft_waiter_categories" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."whatsapp_conversations" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_conversations" TO "service_role";
GRANT SELECT ON TABLE "public"."whatsapp_conversations" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."whatsapp_conversations" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."whatsapp_conversations_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."whatsapp_conversations_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."whatsapp_conversations_id_seq" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."whatsapp_conversations_id_seq" TO "fullsite_readonly";
GRANT USAGE ON SEQUENCE "public"."whatsapp_conversations_id_seq" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."whatsapp_messages_log" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_messages_log" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_messages_log" TO "service_role";
GRANT SELECT ON TABLE "public"."whatsapp_messages_log" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."whatsapp_messages_log" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."whatsapp_messages_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."whatsapp_messages_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."whatsapp_messages_log_id_seq" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."whatsapp_messages_log_id_seq" TO "fullsite_readonly";
GRANT USAGE ON SEQUENCE "public"."whatsapp_messages_log_id_seq" TO "fullsite_agent";



GRANT ALL ON TABLE "public"."whatsapp_whitelist" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_whitelist" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_whitelist" TO "service_role";
GRANT SELECT ON TABLE "public"."whatsapp_whitelist" TO "fullsite_readonly";
GRANT SELECT ON TABLE "public"."whatsapp_whitelist" TO "fullsite_agent";



GRANT ALL ON SEQUENCE "public"."whatsapp_whitelist_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."whatsapp_whitelist_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."whatsapp_whitelist_id_seq" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."whatsapp_whitelist_id_seq" TO "fullsite_readonly";
GRANT USAGE ON SEQUENCE "public"."whatsapp_whitelist_id_seq" TO "fullsite_agent";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT ON TABLES TO "fullsite_readonly";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT ON TABLES TO "fullsite_agent";







