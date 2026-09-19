-- H09: backend proxy checks do not replace database invariants. Apply only after
-- the atomic inventory domain is available. Existing customer data is not changed.
begin;
create schema if not exists private;

create or replace function private.h09_member(p_client text, p_manager boolean default false)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, auth
as $$
  select exists(select 1 from public.client_users cu
    where cu.user_id=auth.uid() and cu.client_id=p_client
      and (not p_manager or cu.role in ('gerente','admin','dueño','platform_actas')));
$$;
revoke all on function private.h09_member(text,boolean) from public;
grant usage on schema private to authenticated;
grant execute on function private.h09_member(text,boolean) to authenticated;

create or replace function private.h09_parent_client(p_parent text,p_id text)
returns text language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare tenant text;
begin
  if p_parent not in ('pos_purchase_orders','pos_sub_recipes','pos_ingredients',
    'pos_menu_items','pos_menu_categories','pos_modifier_groups','pos_recipe_versions',
    'pos_suppliers','pos_staff','client_locations') then raise exception 'H09_INVALID_PARENT'; end if;
  execute format('select client_id from public.%I where id::text=$1',p_parent) into tenant using p_id;
  return tenant;
end;
$$;
revoke all on function private.h09_parent_client(text,text) from public;
grant execute on function private.h09_parent_client(text,text) to authenticated;

create or replace function private.h09_row_identity()
returns trigger language plpgsql
set search_path = pg_catalog, public
as $$
declare previous jsonb:=to_jsonb(old); updated jsonb:=to_jsonb(new); key text;
begin
  -- Applies to service_role / ON CONFLICT as well. A pre-read in an API has a
  -- race; this check executes on the locked row inside the write transaction.
  foreach key in array array['id','client_id','location_id','branch_id'] loop
    if previous ? key and previous->key is distinct from updated->key then
      raise exception 'H09_IMMUTABLE_IDENTITY: %',key using errcode='42501';
    end if;
  end loop;
  if tg_nargs>0 and previous->tg_argv[0] is distinct from updated->tg_argv[0] then
    raise exception 'H09_IMMUTABLE_PARENT' using errcode='42501';
  end if;
  return new;
end;
$$;

create or replace function private.h09_reference_scope()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare row_data jsonb:=to_jsonb(new); tenant text; parent_tenant text; parent_table text:=tg_argv[1];
begin
  if row_data->>tg_argv[0] is null then return new; end if;
  tenant:=row_data->>'client_id';
  if tg_table_name='pos_purchase_order_items' then tenant:=private.h09_parent_client('pos_purchase_orders',row_data->>'order_id'); end if;
  if tg_table_name='pos_sub_recipe_ingredients' then
    tenant:=private.h09_parent_client('pos_sub_recipes',row_data->>'sub_recipe_id');
    if tg_argv[0]='ingredient_id' and row_data->>'ingredient_type'='sub_recipe' then parent_table:='pos_sub_recipes'; end if;
  end if;
  parent_tenant:=private.h09_parent_client(parent_table,row_data->>tg_argv[0]);
  if tenant is null or parent_tenant is distinct from tenant then raise exception 'H09_FOREIGN_REFERENCE' using errcode='42501'; end if;
  return new;
end;
$$;
revoke all on function private.h09_reference_scope() from public;

create or replace function private.h09_ingredient_cost()
returns trigger language plpgsql
set search_path = pg_catalog, public
as $$
begin
  -- SECURITY DEFINER inventory functions run as their owner. A direct JWT write
  -- runs as authenticated; spoofing a request field cannot change current_user.
  if current_user in ('authenticated','anon') then
    if (tg_op='INSERT' and coalesce(new.cost_per_unit,0)<>0)
      or (tg_op='UPDATE' and old.cost_per_unit is distinct from new.cost_per_unit)
      then raise exception 'H09_COST_REQUIRES_INVENTORY_DOMAIN' using errcode='42501'; end if;
  end if;
  return new;
end;
$$;

do $$
declare t text; expression text; manager_expression text; parent_key text; parent_table text;
  catalog text[]:=array['client_locations','pos_menu_items','pos_menu_categories','pos_modifiers','pos_modifier_groups',
    'pos_item_modifier_groups','pos_category_modifiers','pos_payment_methods','pos_promotions',
    'pos_recipes','pos_recipe_lines','pos_recipe_versions','pos_ingredients','pos_suppliers','pos_purchase_orders',
    'pos_purchase_order_items','pos_sub_recipes','pos_sub_recipe_ingredients','pos_combos',
    'pos_sizes','pos_price_types','pos_staff','pos_terminals','pos_fingerprint_templates',
    'pos_cierres','pos_cash_movements'];
begin
  foreach t in array array['client_locations','pos_orders','pos_menu_items','pos_menu_categories',
    'pos_modifiers','pos_modifier_groups','pos_item_modifier_groups','pos_category_modifiers',
    'pos_mesas','pos_staff','pos_staff_shifts','pos_turnos','pos_cierres','pos_cash_movements',
    'pos_payment_methods','pos_promotions','pos_print_jobs','pos_save_operations','pos_audit_log',
    'pos_customers','pos_attendance','pos_sessions','pos_terminals','pos_inventory',
    'pos_inventory_movements','pos_recipes','pos_recipe_lines','pos_recipe_versions','pos_ingredients',
    'pos_suppliers','pos_purchase_orders','pos_purchase_order_items','pos_sub_recipes',
    'pos_sub_recipe_ingredients','pos_fingerprint_templates','pos_combos','pos_sizes','pos_price_types'] loop
    if to_regclass('public.'||t) is null then continue; end if;
    parent_key:=null; parent_table:=null;
    if t='pos_purchase_order_items' then parent_key:='order_id'; parent_table:='pos_purchase_orders'; end if;
    if t='pos_sub_recipe_ingredients' then parent_key:='sub_recipe_id'; parent_table:='pos_sub_recipes'; end if;
    execute format('drop trigger if exists h09_identity on public.%I',t);
    execute format('create trigger h09_identity before update on public.%I for each row execute function private.h09_row_identity(%s)',t,case when parent_key is null then '' else quote_literal(parent_key) end);
    if parent_key is null then expression:='private.h09_member(client_id,false)'; manager_expression:='private.h09_member(client_id,true)';
    else
      expression:=format('private.h09_member(private.h09_parent_client(%L,%I::text),false)',parent_table,parent_key);
      manager_expression:=format('private.h09_member(private.h09_parent_client(%L,%I::text),true)',parent_table,parent_key);
    end if;
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists h09_tenant_scope on public.%I',t);
    execute format('create policy h09_tenant_scope on public.%I as restrictive for all to authenticated using (%s) with check (%s)',t,expression,expression);
    if t=any(catalog) then
      execute format('drop policy if exists h09_manager_insert on public.%I',t);
      execute format('drop policy if exists h09_manager_update on public.%I',t);
      execute format('drop policy if exists h09_manager_delete on public.%I',t);
      execute format('create policy h09_manager_insert on public.%I as restrictive for insert to authenticated with check (%s)',t,manager_expression);
      execute format('create policy h09_manager_update on public.%I as restrictive for update to authenticated using (%s) with check (%s)',t,manager_expression,manager_expression);
      execute format('create policy h09_manager_delete on public.%I as restrictive for delete to authenticated using (%s)',t,manager_expression);
    end if;
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='location_id') then
      execute format('drop trigger if exists h09_location_scope on public.%I',t);
      execute format('create trigger h09_location_scope before insert or update on public.%I for each row execute function private.h09_reference_scope(''location_id'',''client_locations'')',t);
    end if;
  end loop;
end;
$$;

-- No caller with a browser JWT can promote their membership to satisfy the new
-- policies. Membership creation remains a platform/server responsibility.
revoke insert,update,delete on public.client_users from public,anon,authenticated;
-- Direct stock/ledger writes are disallowed even for service-role REST. The
-- atomic domain and existing SECURITY DEFINER stock functions retain access.
revoke insert,update,delete on public.pos_inventory,public.pos_inventory_movements from public,anon,authenticated,service_role;
drop trigger if exists h09_cost_scope on public.pos_ingredients;
create trigger h09_cost_scope before insert or update on public.pos_ingredients for each row execute function private.h09_ingredient_cost();

do $$
declare spec text[]; specs text[][]:=array[
  ['pos_menu_items','category_id','pos_menu_categories'],
  ['pos_item_modifier_groups','item_id','pos_menu_items'],
  ['pos_item_modifier_groups','group_id','pos_modifier_groups'],
  ['pos_category_modifiers','category_id','pos_menu_categories'],
  ['pos_category_modifiers','modifier_group_id','pos_modifier_groups'],
  ['pos_recipe_lines','recipe_version_id','pos_recipe_versions'],
  ['pos_recipe_lines','ingredient_id','pos_ingredients'],
  ['pos_purchase_order_items','ingredient_id','pos_ingredients'],
  ['pos_sub_recipe_ingredients','ingredient_id','pos_ingredients']];
begin
  foreach spec slice 1 in array specs loop
    if to_regclass('public.'||spec[1]) is null or to_regclass('public.'||spec[3]) is null then continue; end if;
    execute format('drop trigger if exists %I on public.%I','h09_ref_'||spec[2],spec[1]);
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.h09_reference_scope(%L,%L)','h09_ref_'||spec[2],spec[1],spec[2],spec[3]);
  end loop;
end;
$$;
commit;
