-- ═══════════════════════════════════════════════════════════
-- FULLSITE CUSTOM FUNCTIONS
-- Generated: 2026-07-21 from production
-- Functions: 16
-- ═══════════════════════════════════════════════════════════

-- ── activate_recipe_version ──
CREATE OR REPLACE FUNCTION public.activate_recipe_version(p_client_id text, p_menu_item_id text, p_new_version integer, p_actor text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$ DECLARE v_target_row pos_recipe_versions%ROWTYPE; v_rows_activated int; v_active_count int; BEGIN PERFORM 1 FROM pos_menu_items WHERE client_id = p_client_id AND id = p_menu_item_id FOR UPDATE; SELECT * INTO v_target_row FROM pos_recipe_versions WHERE client_id = p_client_id AND menu_item_id = p_menu_item_id AND version = p_new_version; IF v_target_row.id IS NULL THEN RAISE EXCEPTION 'Version % does not exist for item % in client %', p_new_version, p_menu_item_id, p_client_id; END IF; UPDATE pos_recipe_versions SET active = false, deactivated_at = now(), deactivated_by = p_actor WHERE client_id = p_client_id AND menu_item_id = p_menu_item_id AND active = true; UPDATE pos_recipe_versions SET active = true, activated_at = now(), activated_by = p_actor WHERE id = v_target_row.id; GET DIAGNOSTICS v_rows_activated = ROW_COUNT; IF v_rows_activated != 1 THEN RAISE EXCEPTION 'Expected 1 row activated, got %', v_rows_activated; END IF; SELECT count(*) INTO v_active_count FROM pos_recipe_versions WHERE client_id = p_client_id AND menu_item_id = p_menu_item_id AND active = true; IF v_active_count != 1 THEN RAISE EXCEPTION 'Expected exactly 1 active version, found %', v_active_count; END IF; END; $function$
;

-- ── cancel_stale_pending_reservations ──
CREATE OR REPLACE FUNCTION public.cancel_stale_pending_reservations()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE public.amalay_reservaciones
  SET status = 'cancelled',
      notas = COALESCE(notas, '') || ' [auto-cancelada: pending >2h sin anticipo]'
  WHERE status = 'pending'
    AND created_at < NOW() - INTERVAL '2 hours';
END;
$function$
;

-- ── convert_recipe_to_stock ──
CREATE OR REPLACE FUNCTION public.convert_recipe_to_stock(p_quantity numeric, p_recipe_unit text, p_stock_unit text)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
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
$function$
;

-- ── gen_codigo_reserva ──
CREATE OR REPLACE FUNCTION public.gen_codigo_reserva()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$
;

-- ── r1_adjust_market_stock ──
CREATE OR REPLACE FUNCTION public.r1_adjust_market_stock(p_client_id text, p_menu_item_id text, p_adjustment_type text, p_quantity numeric, p_actor text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

-- ── r1_legacy_sale_deduction ──
CREATE OR REPLACE FUNCTION public.r1_legacy_sale_deduction(p_client_id text, p_order_id text, p_actor text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

-- ── r1_merge_orders ──
CREATE OR REPLACE FUNCTION public.r1_merge_orders(p_client_id text, p_target_order_id text, p_target_expected_revision bigint, p_source_order_id text, p_source_expected_revision bigint, p_merged_items jsonb, p_total numeric, p_subtotal numeric, p_iva numeric, p_personas integer, p_notas text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

-- ── r1_observation_sample ──
CREATE OR REPLACE FUNCTION public.r1_observation_sample()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$                                                                                                                                                                                                      
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
  $function$
;

-- ── r1_reconcile_item ──
CREATE OR REPLACE FUNCTION public.r1_reconcile_item(p_client_id text, p_order_id text, p_item_id text, p_menu_item_id text, p_desired numeric, p_sale_authority text)
 RETURNS TABLE(r_item_id text, r_result text, r_applied numeric, r_delta numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

-- ── r1_reconcile_order ──
CREATE OR REPLACE FUNCTION public.r1_reconcile_order(p_client_id text, p_order_id text)
 RETURNS TABLE(r_item_id text, r_result text, r_applied numeric, r_delta numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

-- ── r1_save_order ──
CREATE OR REPLACE FUNCTION public.r1_save_order(p_client_id text, p_order_id text, p_expected_revision bigint, p_mesa integer DEFAULT NULL::integer, p_customer_name text DEFAULT NULL::text, p_mesero text DEFAULT NULL::text, p_personas integer DEFAULT NULL::integer, p_status text DEFAULT NULL::text, p_subtotal numeric DEFAULT NULL::numeric, p_iva numeric DEFAULT NULL::numeric, p_total numeric DEFAULT NULL::numeric, p_descuento numeric DEFAULT NULL::numeric, p_propina numeric DEFAULT NULL::numeric, p_metodo_pago text DEFAULT NULL::text, p_pagos jsonb DEFAULT NULL::jsonb, p_turno_id text DEFAULT NULL::text, p_notas text DEFAULT NULL::text, p_items jsonb DEFAULT NULL::jsonb, p_closed_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new_revision bigint;
  v_current_revision bigint;
  v_exists boolean;
BEGIN
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
$function$
;

-- ── r1_save_order_idempotent ──
CREATE OR REPLACE FUNCTION public.r1_save_order_idempotent(p_client_id text, p_order_id text, p_save_operation_id text, p_expected_revision bigint, p_mesa integer DEFAULT NULL::integer, p_customer_name text DEFAULT NULL::text, p_mesero text DEFAULT NULL::text, p_personas integer DEFAULT NULL::integer, p_status text DEFAULT NULL::text, p_subtotal numeric DEFAULT NULL::numeric, p_iva numeric DEFAULT NULL::numeric, p_total numeric DEFAULT NULL::numeric, p_descuento numeric DEFAULT NULL::numeric, p_propina numeric DEFAULT NULL::numeric, p_metodo_pago text DEFAULT NULL::text, p_pagos jsonb DEFAULT NULL::jsonb, p_turno_id text DEFAULT NULL::text, p_notas text DEFAULT NULL::text, p_items jsonb DEFAULT NULL::jsonb, p_closed_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$                                                                                                                                                                                                      
  DECLARE                                                                       
    v_row_count integer;                                                                                                                                                                                       
    v_hash text;                                                                                                                                                                                             
    v_canonical jsonb;                                                                                                                                                                                         
    v_items_sorted jsonb;               
    v_existing record;                                                                                                                                                                                         
    v_save_result jsonb;                                                                                                                                                                                       
  BEGIN                                                                         
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
  $function$
;

-- ── reconcile_order_inventory ──
CREATE OR REPLACE FUNCTION public.reconcile_order_inventory(p_order_id text)
 RETURNS TABLE(r_ingredient_id text, r_expected numeric, r_net_applied numeric, r_delta numeric, r_action text)
 LANGUAGE plpgsql
AS $function$
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
$function$
;

-- ── reject_mutation ──
CREATE OR REPLACE FUNCTION public.reject_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
  begin raise exception 'events is append-only'; end $function$
;

-- ── set_pos_order_number ──
CREATE OR REPLACE FUNCTION public.set_pos_order_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$
;

-- ── set_updated_at ──
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

