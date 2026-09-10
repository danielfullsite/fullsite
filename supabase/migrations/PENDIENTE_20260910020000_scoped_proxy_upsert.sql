-- Candidate only. Deploy with the scoped generic-proxy callers; does not activate Caja.
-- The caller authenticates employee permissions. This RPC enforces tenant ownership
-- at the conflicting row lock, including races and all-or-nothing batches.
create or replace function public.pos_scoped_upsert(
  p_table text, p_client_id text, p_rows jsonb, p_conflict text[] default array['id']
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  rows jsonb; row_data jsonb; result_row jsonb; results jsonb := '[]'::jsonb;
  relation regclass; columns_sql text; updates_sql text; conflict_sql text; noop_column text;
  field text;
begin
  if p_table is null or p_table <> all(array[
    'pos_orders','pos_menu_items','pos_menu_categories','pos_modifiers','pos_modifier_groups',
    'pos_item_modifier_groups','pos_category_modifiers','pos_mesas','pos_staff','pos_staff_shifts',
    'pos_turnos','pos_cierres','pos_cash_movements','pos_payment_methods','pos_promotions',
    'pos_print_jobs','pos_save_operations','pos_audit_log','pos_customers','pos_attendance',
    'pos_sessions','pos_terminals','pos_inventory','pos_inventory_movements','pos_recipes',
    'pos_recipe_lines','pos_ingredients','pos_suppliers','pos_purchase_orders','pos_sub_recipes',
    'pos_fingerprint_templates','pos_combos','pos_sizes','pos_price_types'
  ]) then raise exception 'UNSUPPORTED_TABLE'; end if;
  if p_client_id is null or btrim(p_client_id) = '' then raise exception 'INVALID_CLIENT'; end if;
  relation := to_regclass(format('public.%I',p_table));
  if relation is null or not exists(select 1 from pg_attribute where attrelid=relation and attname='client_id' and attnum>0 and not attisdropped)
    then raise exception 'UNSUPPORTED_TABLE'; end if;
  if p_conflict is null or cardinality(p_conflict)=0 or array_ndims(p_conflict)<>1 or
    exists(select 1 from unnest(p_conflict) k where k is null or k !~ '^[a-z_][a-z0-9_]*$') or
    (select count(*) <> count(distinct k) from unnest(p_conflict) k) or
    not (p_conflict = array['id'] or 'client_id'=any(p_conflict))
    then raise exception 'INVALID_CONFLICT_KEYS'; end if;
  foreach field in array p_conflict loop
    if not exists(select 1 from pg_attribute where attrelid=relation and attname=field and attnum>0 and not attisdropped)
      then raise exception 'INVALID_CONFLICT_KEYS'; end if;
  end loop;
  -- PostgreSQL itself verifies that the requested columns infer a unique index.
  select string_agg(format('%I',k),',') into conflict_sql from unnest(p_conflict) k;
  if jsonb_typeof(p_rows)='object' then rows := jsonb_build_array(p_rows);
  elsif jsonb_typeof(p_rows)='array' and jsonb_array_length(p_rows)>0 then rows := p_rows;
  else raise exception 'INVALID_ROWS'; end if;
  for row_data in select value from jsonb_array_elements(rows) loop
    if jsonb_typeof(row_data) is distinct from 'object' then raise exception 'INVALID_ROWS'; end if;
    row_data := row_data || jsonb_build_object('client_id',p_client_id);
    for field in select jsonb_object_keys(row_data) loop
      if field !~ '^[a-z_][a-z0-9_]*$' or not exists(select 1 from pg_attribute where attrelid=relation
        and attname=field and attnum>0 and not attisdropped and attgenerated='' and attidentity<>'a')
        then raise exception 'INVALID_COLUMN'; end if;
    end loop;
    select string_agg(format('%I',k),',' order by k),
      string_agg(format('%I=excluded.%I',k,k),',' order by k) filter(where k not in ('id','client_id'))
      into columns_sql,updates_sql from jsonb_object_keys(row_data) k;
    if updates_sql is null then
      -- Identity-only replay still obtains the conflicting row lock and returns
      -- the owned row. Neither global identity nor tenant can be assigned.
      select attname into noop_column from pg_attribute where attrelid=relation and attnum>0
        and not attisdropped and attgenerated='' and attidentity='' and attname not in ('id','client_id') order by attnum limit 1;
      if noop_column is null then raise exception 'UNSUPPORTED_TABLE'; end if;
      updates_sql := format('%I=target.%I',noop_column,noop_column);
    end if;
    execute format('insert into public.%I as target (%s) select %s from jsonb_populate_record(null::public.%I,$1)
      on conflict (%s) do update set %s where target.client_id=$2 returning to_jsonb(target)',
      p_table,columns_sql,columns_sql,p_table,conflict_sql,updates_sql)
      into result_row using row_data,p_client_id;
    if result_row is null then raise exception 'SCOPE_CONFLICT'; end if;
    results := results || jsonb_build_array(result_row);
  end loop;
  return results;
end $$;
revoke all on function public.pos_scoped_upsert(text,text,jsonb,text[]) from public, anon, authenticated;
grant execute on function public.pos_scoped_upsert(text,text,jsonb,text[]) to service_role;
