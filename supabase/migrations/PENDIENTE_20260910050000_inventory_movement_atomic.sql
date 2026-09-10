-- Candidate only. Manual inventory contract: receipt, ledger, stock and cost
-- commit together. Deploy with /api/pos/inventory/movement; no automatic-sale cutover.
create table if not exists public.pos_inventory_movement_operations (
  client_id text not null, idempotency_key text not null, intent jsonb not null,
  result jsonb not null, created_at timestamptz not null default now(),
  primary key(client_id,idempotency_key)
);
alter table public.pos_inventory_movement_operations enable row level security;
revoke all on public.pos_inventory_movement_operations from public,anon,authenticated,service_role;
alter table public.pos_inventory_movements add column if not exists movement_operation_key text,
  add column if not exists movement_operation_line integer;
create unique index if not exists pos_inventory_movement_operation_line
  on public.pos_inventory_movements(client_id,movement_operation_key,movement_operation_line)
  where movement_operation_key is not null;

create or replace function public.pos_record_inventory_movement(
  p_client_id text, p_actor text, p_movement_type text, p_lines jsonb,
  p_idempotency_key text, p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  intent jsonb; previous public.pos_inventory_movement_operations%rowtype;
  line jsonb; ingredient public.pos_ingredients%rowtype; inventory public.pos_inventory%rowtype;
  qty numeric; purchase_cost numeric; before_cost numeric; after_cost numeric; after_stock numeric;
  entry boolean; count_lines integer; cost_updates integer := 0;
  details jsonb := '[]'::jsonb; result jsonb; ids text[]; line_number integer := 0;
begin
  if nullif(btrim(p_client_id),'') is null or nullif(btrim(p_actor),'') is null or
    nullif(btrim(p_idempotency_key),'') is null or length(p_idempotency_key)>1000 then raise exception 'INVALID_MOVEMENT_IDENTITY'; end if;
  if p_movement_type is null or p_movement_type not in ('entry','invoice_entry','waste','adjustment','deduction','restock','transfer_out','transfer_in','return','reversal')
    then raise exception 'INVALID_MOVEMENT_TYPE'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'INVALID_LINES'; end if;
  count_lines := jsonb_array_length(p_lines);
  if count_lines<1 or count_lines>1000 or jsonb_typeof(p_metadata) is distinct from 'object' then raise exception 'INVALID_LINES'; end if;
  entry := p_movement_type in ('entry','invoice_entry','restock','transfer_in');
  for line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(line) is distinct from 'object' or jsonb_typeof(line->'ingredient_id') is distinct from 'string' or
      nullif(btrim(line->>'ingredient_id'),'') is null or jsonb_typeof(line->'quantity') is distinct from 'number' or
      (line ? 'unit_cost' and jsonb_typeof(line->'unit_cost') is distinct from 'number') or
      (line ? 'notes' and jsonb_typeof(line->'notes') is distinct from 'string') or
      exists(select 1 from jsonb_object_keys(line) k where k not in ('ingredient_id','quantity','unit_cost','notes'))
      then raise exception 'INVALID_LINE'; end if;
    qty := (line->>'quantity')::numeric; purchase_cost := coalesce((line->>'unit_cost')::numeric,0);
    if qty=0 or abs(qty)>9007199254740991 or purchase_cost<0 or purchase_cost>9007199254740991 or
      (entry and qty<0) or (p_movement_type in ('waste','deduction','return','transfer_out') and qty>0)
      then raise exception 'INVALID_QUANTITY_OR_COST'; end if;
  end loop;
  select array_agg(distinct x->>'ingredient_id' order by x->>'ingredient_id') into ids from jsonb_array_elements(p_lines) x;
  -- Exact key identity, not LIKE against free-text notes. The lock also covers
  -- concurrent first use of the key before its receipt exists.
  perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(p_client_id,p_idempotency_key)::text,0));
  intent := jsonb_build_object('actor',p_actor,'type',p_movement_type,'metadata',p_metadata,
    'lines',p_lines);
  select * into previous from public.pos_inventory_movement_operations where client_id=p_client_id and idempotency_key=p_idempotency_key;
  if found then
    -- A different authorized manager may recover the original receipt. Its
    -- original actor remains immutable provenance, not part of business intent.
    if (previous.intent - 'actor') <> (intent - 'actor') then raise exception 'MOVEMENT_KEY_REUSED'; end if;
    return previous.result || jsonb_build_object('was_duplicate',true);
  end if;
  if exists(select 1 from public.pos_inventory_movements m where m.client_id=p_client_id
    and m.movement_operation_key is null and (
      strpos(coalesce(m.notes,''),'[key:'||p_idempotency_key||']')>0 or
      (left(p_idempotency_key,5)='cfdi:' and (
        strpos(lower(coalesce(m.notes,'')),'[key:cfdi_'||lower(substr(p_idempotency_key,6))||']')>0 or
        strpos(lower(coalesce(m.notes,'')),'[key:cfdi-'||lower(substr(p_idempotency_key,6))||']')>0))))
    then raise exception 'LEGACY_MOVEMENT_REQUIRES_RECONCILIATION'; end if;
  -- Every batch locks ingredients and then balances in the same identity order.
  perform id from public.pos_ingredients where client_id=p_client_id and id=any(ids) order by id for update;
  perform id from public.pos_inventory where client_id=p_client_id and ingredient_id=any(ids) order by ingredient_id,id for update;
  -- Repeated invoice lines read the balance/cost updated by the previous line.
  -- Preserve their original order, including zero-price entry cost policy.
  for line in select value from jsonb_array_elements(p_lines) with ordinality order by ordinality loop
    line_number := line_number+1;
    select * into ingredient from public.pos_ingredients where id=line->>'ingredient_id' and client_id=p_client_id;
    if not found then raise exception 'INGREDIENT_SCOPE_CONFLICT'; end if;
    select * into inventory from public.pos_inventory where ingredient_id=ingredient.id and client_id=p_client_id;
    if not found then raise exception 'INVENTORY_ROW_REQUIRED'; end if;
    if (select count(*) from public.pos_inventory where ingredient_id=ingredient.id and client_id=p_client_id)<>1 then raise exception 'AMBIGUOUS_INVENTORY'; end if;
    if p_movement_type='deduction' and (ingredient.product_type in ('subreceta','sub_recipe') or left(ingredient.id,4)='sub_') then raise exception 'SUBRECIPE_HAS_NO_STOCK'; end if;
    qty := (line->>'quantity')::numeric; purchase_cost := coalesce((line->>'unit_cost')::numeric,0);
    before_cost := ingredient.cost_per_unit;
    if inventory.stock<0 or before_cost is null or before_cost<0 or before_cost>9007199254740991 or
      inventory.stock>9007199254740991 then raise exception 'INVALID_CURRENT_STOCK_OR_COST'; end if;
    after_stock := inventory.stock+qty;
    if after_stock<0 then raise exception 'INSUFFICIENT_STOCK'; end if;
    if after_stock>9007199254740991 then raise exception 'INVALID_QUANTITY_OR_COST'; end if;
    after_cost := before_cost;
    if entry and purchase_cost>0 then
      after_cost := case when inventory.stock=0 then purchase_cost
        else (inventory.stock*before_cost+qty*purchase_cost)/after_stock end;
    end if;
    insert into public.pos_inventory_movements(client_id,ingredient_id,movement_type,quantity,actor,notes,movement_operation_key,movement_operation_line)
      values(p_client_id,ingredient.id,p_movement_type,qty,p_actor,
        concat_ws(' ',nullif(line->>'notes',''),format('stock:%s→%s cost:%s→%s',inventory.stock,after_stock,before_cost,after_cost)),p_idempotency_key,line_number);
    update public.pos_inventory set stock=after_stock,updated_at=clock_timestamp() where id=inventory.id and client_id=p_client_id;
    if after_cost<>before_cost then
      update public.pos_ingredients set cost_per_unit=after_cost where id=ingredient.id and client_id=p_client_id;
      cost_updates := cost_updates+1;
    end if;
    details := details || jsonb_build_array(jsonb_build_object('ingredient_id',ingredient.id,'stock_before',inventory.stock,
      'stock_after',after_stock,'cost_before',before_cost,'cost_after',after_cost));
  end loop;
  result := jsonb_build_object('success',true,'movements_created',count_lines,'stock_updates',count_lines,
    'cost_updates',cost_updates,'errors','[]'::jsonb,'was_duplicate',false,'details',details);
  insert into public.pos_inventory_movement_operations(client_id,idempotency_key,intent,result) values(p_client_id,p_idempotency_key,intent,result);
  return result;
end $$;
revoke all on function public.pos_record_inventory_movement(text,text,text,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.pos_record_inventory_movement(text,text,text,jsonb,text,jsonb) to service_role;
