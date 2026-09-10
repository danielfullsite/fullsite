-- Pending candidate: child resources have no client_id. Every access joins the
-- immutable owning parent inside PostgreSQL, never trusts a caller's parent ID.
CREATE OR REPLACE FUNCTION public.pos_scoped_child(
  p_table text, p_client_id text, p_method text,
  p_id text DEFAULT NULL, p_parent_id text DEFAULT NULL,
  p_rows jsonb DEFAULT NULL, p_limit integer DEFAULT 1000, p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  parent_table text; parent_column text; row_data jsonb; output jsonb := '[]'::jsonb;
  result_row jsonb; columns_sql text; values_sql text; changes_sql text; parent_id text;
  ingredient_table text; ingredient_id text; total_rows bigint;
BEGIN
  IF p_client_id IS NULL OR p_client_id = '' THEN RAISE EXCEPTION 'SCOPE_REQUIRED'; END IF;
  CASE p_table
    WHEN 'pos_purchase_order_items' THEN parent_table := 'pos_purchase_orders'; parent_column := 'order_id';
    WHEN 'pos_sub_recipe_ingredients' THEN parent_table := 'pos_sub_recipes'; parent_column := 'sub_recipe_id';
    ELSE RAISE EXCEPTION 'TABLE_NOT_ALLOWED';
  END CASE;
  IF p_method NOT IN ('GET','POST','PATCH','DELETE') OR p_limit NOT BETWEEN 1 AND 1000 OR p_offset < 0 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  IF p_method = 'GET' THEN
    EXECUTE format('SELECT count(*) FROM public.%I c JOIN public.%I p ON p.id=c.%I WHERE p.client_id=$1 AND ($2 IS NULL OR c.id::text=$2) AND ($3 IS NULL OR c.%I=$3)', p_table,parent_table,parent_column,parent_column)
      INTO total_rows USING p_client_id,p_id,p_parent_id;
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb) FROM (SELECT c.* FROM public.%I c JOIN public.%I p ON p.id=c.%I WHERE p.client_id=$1 AND ($2 IS NULL OR c.id::text=$2) AND ($3 IS NULL OR c.%I=$3) ORDER BY c.id LIMIT $4 OFFSET $5) q', p_table,parent_table,parent_column,parent_column)
      INTO output USING p_client_id,p_id,p_parent_id,p_limit,p_offset;
    RETURN jsonb_build_object('rows',output,'total',total_rows);
  END IF;
  IF p_method IN ('PATCH','DELETE') AND p_id IS NULL THEN RAISE EXCEPTION 'ROW_ID_REQUIRED'; END IF;
  IF p_method='DELETE' THEN
    EXECUTE format('DELETE FROM public.%I c USING public.%I p WHERE p.id=c.%I AND p.client_id=$1 AND c.id::text=$2 AND ($3 IS NULL OR c.%I=$3) RETURNING to_jsonb(c)',p_table,parent_table,parent_column,parent_column)
      INTO result_row USING p_client_id,p_id,p_parent_id;
    RETURN jsonb_build_object('rows',CASE WHEN result_row IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(result_row) END);
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) NOT IN ('object','array') THEN RAISE EXCEPTION 'INVALID_ROWS'; END IF;
  IF jsonb_typeof(p_rows)='object' THEN p_rows := jsonb_build_array(p_rows); END IF;
  IF jsonb_array_length(p_rows)=0 OR (p_method='PATCH' AND jsonb_array_length(p_rows)<>1) THEN RAISE EXCEPTION 'INVALID_ROWS'; END IF;
  FOR row_data IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(row_data)<>'object' OR row_data='{}'::jsonb OR row_data ? 'client_id' THEN RAISE EXCEPTION 'INVALID_ROW'; END IF;
    IF p_method='PATCH' AND (row_data ? 'id' OR row_data ? parent_column) THEN RAISE EXCEPTION 'IMMUTABLE_IDENTITY'; END IF;
    IF p_method='POST' THEN
      parent_id := row_data->>parent_column;
      EXECUTE format('SELECT id FROM public.%I WHERE id=$1 AND client_id=$2 FOR SHARE',parent_table) INTO parent_id USING parent_id,p_client_id;
      IF parent_id IS NULL THEN RAISE EXCEPTION 'SCOPE_CONFLICT'; END IF;
    ELSE
      EXECUTE format('SELECT p.id FROM public.%I c JOIN public.%I p ON p.id=c.%I WHERE c.id::text=$1 AND p.client_id=$2 AND ($3 IS NULL OR c.%I=$3) FOR UPDATE OF c FOR SHARE OF p',p_table,parent_table,parent_column,parent_column)
        INTO parent_id USING p_id,p_client_id,p_parent_id;
      IF parent_id IS NULL THEN RETURN jsonb_build_object('rows','[]'::jsonb); END IF;
    END IF;
    -- Referenced ingredient must also belong to this restaurant. Changing the
    -- discriminant alone could reinterpret an existing ID, so require its ID.
    IF row_data ? 'ingredient_type' AND NOT row_data ? 'ingredient_id' THEN RAISE EXCEPTION 'INGREDIENT_REQUIRED'; END IF;
    IF p_table='pos_sub_recipe_ingredients' AND p_method='PATCH' AND row_data ? 'ingredient_id' AND NOT row_data ? 'ingredient_type' THEN RAISE EXCEPTION 'INGREDIENT_TYPE_REQUIRED'; END IF;
    IF row_data ? 'ingredient_id' THEN
      ingredient_table := CASE WHEN p_table='pos_sub_recipe_ingredients' AND row_data->>'ingredient_type'='sub_recipe' THEN 'pos_sub_recipes' ELSE 'pos_ingredients' END;
      EXECUTE format('SELECT id FROM public.%I WHERE id=$1 AND client_id=$2 FOR SHARE',ingredient_table) INTO ingredient_id USING row_data->>'ingredient_id',p_client_id;
      IF ingredient_id IS NULL THEN RAISE EXCEPTION 'SCOPE_CONFLICT'; END IF;
    END IF;
    SELECT string_agg(format('%I',key),','),string_agg(format('r.%I',key),','),string_agg(format('%I=r.%I',key,key),',')
      INTO columns_sql,values_sql,changes_sql FROM jsonb_object_keys(row_data) key;
    IF p_method='POST' THEN
      EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I,$1) r RETURNING to_jsonb(%I)',p_table,columns_sql,values_sql,p_table,p_table) INTO result_row USING row_data;
    ELSE
      EXECUTE format('UPDATE public.%I c SET %s FROM jsonb_populate_record(NULL::public.%I,$1) r WHERE c.id::text=$2 RETURNING to_jsonb(c)',p_table,changes_sql,p_table) INTO result_row USING row_data,p_id;
    END IF;
    output := output || jsonb_build_array(result_row);
  END LOOP;
  RETURN jsonb_build_object('rows',output);
END $$;
REVOKE ALL ON FUNCTION public.pos_scoped_child(text,text,text,text,text,jsonb,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_scoped_child(text,text,text,text,text,jsonb,integer,integer) TO service_role;
