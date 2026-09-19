-- H08 candidate only. Apply first in an isolated database, never automatically.
-- Manual stock is tenant-wide in the baseline schema. A location is provenance,
-- not a second stock balance. No order/payment/Caja tables are written here.
begin;

create table public.pos_inventory_operation_receipts (
  operation_id uuid primary key,
  client_id text not null,
  idempotency_key text not null,
  source_document_key text,
  request jsonb not null,
  actor jsonb not null,
  receipt jsonb not null,
  committed_at timestamptz not null default now(),
  unique(client_id, idempotency_key),
  unique(client_id, source_document_key)
);
alter table public.pos_inventory_operation_receipts enable row level security;
alter table public.pos_inventory_operation_receipts force row level security;
revoke all on public.pos_inventory_operation_receipts from public, anon, authenticated, service_role;

alter table public.pos_inventory_movements
  add column inventory_operation_id uuid,
  add column inventory_operation_line integer,
  add constraint pos_inventory_operation_line_valid check (
    (inventory_operation_id is null and inventory_operation_line is null) or
    (inventory_operation_id is not null and inventory_operation_line is not null and inventory_operation_line > 0)),
  add constraint pos_inventory_operation_receipt_fk foreign key (inventory_operation_id)
    references public.pos_inventory_operation_receipts(operation_id) deferrable initially deferred;
create unique index pos_inventory_operation_line_unique on public.pos_inventory_movements(inventory_operation_id, inventory_operation_line)
  where inventory_operation_id is not null;

create or replace function public.record_inventory_movement_atomic(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
set statement_timeout = '12s'
set lock_timeout = '8s'
as $$
declare
  tenant text; request_key text; kind text; location text; document_key text; is_entry boolean;
  operation uuid := gen_random_uuid(); saved public.pos_inventory_operation_receipts%rowtype;
  line jsonb; ingredient text; qty numeric; purchase numeric; old_stock numeric; new_stock numeric;
  old_cost numeric; new_cost numeric; movement bigint; line_index integer := 0;
  detail jsonb := '[]'; cost_changed jsonb := '{}'; receipt jsonb; distinct_count integer;
begin
  if jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_actor) is distinct from 'object'
    then raise exception 'INVENTORY_INVALID_REQUEST'; end if;
  tenant := p_request->>'client_id'; request_key := p_request->>'idempotency_key'; kind := p_request->>'movement_type';
  if jsonb_typeof(p_request->'client_id') is distinct from 'string' or length(btrim(tenant)) not between 1 and 200
    or jsonb_typeof(p_request->'idempotency_key') is distinct from 'string' or length(btrim(request_key)) not between 1 and 240
    or jsonb_typeof(p_request->'actor') is distinct from 'string' or length(btrim(p_request->>'actor')) not between 1 and 200
    or octet_length(p_request::text) > 256000
    or exists(select 1 from jsonb_object_keys(p_request) k where k not in ('client_id','idempotency_key','movement_type','actor','lines','metadata','location_id'))
    then raise exception 'INVENTORY_INVALID_REQUEST'; end if;
  if p_actor->>'client_id' is distinct from tenant or jsonb_typeof(p_actor->'id') is distinct from 'string'
    or length(btrim(p_actor->>'id')) not between 1 and 200
    or coalesce(p_actor->>'role','') not in ('gerente','admin','dueño')
    or coalesce(p_actor->>'auth_type','') not in ('shift_token','supabase_session')
    then raise exception 'INVENTORY_ACTOR_REQUIRED'; end if;
  if kind is null or kind not in ('entry','invoice_entry','restock','waste','adjustment','return')
    then raise exception 'INVENTORY_SOURCE_RECEIPT_REQUIRED'; end if;
  if p_request ? 'metadata' and jsonb_typeof(p_request->'metadata') is distinct from 'object'
    then raise exception 'INVENTORY_INVALID_METADATA'; end if;
  if p_request ? 'location_id' then
    location := p_request->>'location_id';
    if jsonb_typeof(p_request->'location_id') is distinct from 'string' or length(btrim(location)) not between 1 and 200
      then raise exception 'INVENTORY_INVALID_LOCATION'; end if;
  end if;
  if jsonb_typeof(p_request->'lines') is distinct from 'array' then raise exception 'INVENTORY_INVALID_LINES'; end if;
  if jsonb_array_length(p_request->'lines') not between 1 and 500 then raise exception 'INVENTORY_INVALID_LINES'; end if;
  is_entry := kind in ('entry','invoice_entry','restock');
  if is_entry and (p_request->'metadata') ? 'cfdi_uuid' then
    if jsonb_typeof(p_request->'metadata'->'cfdi_uuid') is distinct from 'string' or
      (p_request->'metadata'->>'cfdi_uuid') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then raise exception 'INVENTORY_INVALID_INVOICE_ID'; end if;
    document_key := 'cfdi:' || lower(p_request->'metadata'->>'cfdi_uuid');
  end if;
  for line in select value from jsonb_array_elements(p_request->'lines') loop
    if jsonb_typeof(line) is distinct from 'object' then raise exception 'INVENTORY_INVALID_LINE'; end if;
    if exists(select 1 from jsonb_object_keys(line) k where k not in ('ingredient_id','quantity','unit_cost','notes'))
      or jsonb_typeof(line->'ingredient_id') is distinct from 'string' or length(btrim(line->>'ingredient_id')) not between 1 and 200
      or jsonb_typeof(line->'quantity') is distinct from 'number' then raise exception 'INVENTORY_INVALID_LINE'; end if;
    qty := (line->>'quantity')::numeric;
    if qty = 0 or abs(qty) > 1000000000 then raise exception 'INVENTORY_INVALID_LINE'; end if;
    if (is_entry and qty < 0) or (kind in ('waste','return') and qty > 0) then raise exception 'INVENTORY_INVALID_DIRECTION'; end if;
    if line ? 'unit_cost' then
      if jsonb_typeof(line->'unit_cost') is distinct from 'number' then raise exception 'INVENTORY_INVALID_COST'; end if;
      purchase := (line->>'unit_cost')::numeric;
      if purchase < 0 or purchase > 1000000000 or (not is_entry and purchase <> 0) then raise exception 'INVENTORY_INVALID_COST'; end if;
    end if;
    if line ? 'notes' and (jsonb_typeof(line->'notes') is distinct from 'string' or length(line->>'notes') > 2000)
      then raise exception 'INVENTORY_INVALID_NOTES'; end if;
  end loop;

  -- Exact key equality, serial across concurrent retries. A hash collision only
  -- adds lock contention; UNIQUE(client_id,key) and JSONB equality decide identity.
  perform pg_advisory_xact_lock(hashtextextended('fullsite-inventory:' || tenant || ':' || request_key, 0));
  select * into saved from public.pos_inventory_operation_receipts where client_id=tenant and idempotency_key=request_key;
  if found then
    if saved.request is distinct from p_request or saved.actor->>'id' is distinct from p_actor->>'id'
      or saved.actor->>'auth_type' is distinct from p_actor->>'auth_type' then raise exception 'INVENTORY_IDEMPOTENCY_CONFLICT'; end if;
    return saved.receipt || jsonb_build_object('was_duplicate',true);
  end if;
  if location is not null then
    perform 1 from public.client_locations where id=location and client_id=tenant and active is true for share;
    if not found then raise exception 'INVENTORY_LOCATION_SCOPE_MISMATCH'; end if;
  end if;
  if document_key is not null then
    perform pg_advisory_xact_lock(hashtextextended('fullsite-inventory-document:' || tenant || ':' || document_key, 0));
    if exists(select 1 from public.pos_inventory_operation_receipts where client_id=tenant and source_document_key=document_key)
      then raise exception 'INVENTORY_SOURCE_ALREADY_RECORDED'; end if;
  end if;

  -- Lock all ingredients in a stable order BEFORE creating or updating stock.
  -- Duplicate lines are applied sequentially against the updated locked balance.
  select count(distinct value->>'ingredient_id') into distinct_count from jsonb_array_elements(p_request->'lines');
  perform 1 from public.pos_ingredients i where i.client_id=tenant and i.id in
    (select value->>'ingredient_id' from jsonb_array_elements(p_request->'lines')) order by i.id for update;
  if (select count(*) from public.pos_ingredients i where i.client_id=tenant and i.id in
    (select value->>'ingredient_id' from jsonb_array_elements(p_request->'lines'))) <> distinct_count
    then raise exception 'INVENTORY_INGREDIENT_SCOPE_MISMATCH'; end if;

  for line in select value from jsonb_array_elements(p_request->'lines') loop
    line_index := line_index + 1; ingredient := line->>'ingredient_id'; qty := (line->>'quantity')::numeric;
    purchase := coalesce((line->>'unit_cost')::numeric, 0);
    select cost_per_unit into old_cost from public.pos_ingredients where id=ingredient and client_id=tenant;
    if old_cost is null or old_cost::text in ('NaN','Infinity','-Infinity') or old_cost < 0
      then raise exception 'INVENTORY_INVALID_EXISTING_COST'; end if;
    insert into public.pos_inventory(client_id,ingredient_id,stock) values(tenant,ingredient,0) on conflict(client_id,ingredient_id) do nothing;
    select stock into old_stock from public.pos_inventory where client_id=tenant and ingredient_id=ingredient for update;
    if old_stock < 0 or old_stock::text in ('NaN','Infinity','-Infinity') then raise exception 'INVENTORY_INVALID_EXISTING_STOCK'; end if;
    new_stock := old_stock + qty;
    if new_stock < 0 then raise exception 'INVENTORY_INSUFFICIENT_STOCK'; end if;
    new_cost := old_cost;
    if is_entry and purchase > 0 then new_cost := round((old_stock * old_cost + qty * purchase) / new_stock, 12); end if;
    insert into public.pos_inventory_movements(client_id,ingredient_id,movement_type,quantity,actor,notes,inventory_operation_id,inventory_operation_line)
      values(tenant,ingredient,kind,qty,coalesce(nullif(p_actor->>'name',''),p_actor->>'id'),line->>'notes',operation,line_index) returning id into movement;
    update public.pos_inventory set stock=new_stock, updated_at=now(),
      last_restock=case when is_entry then now() else last_restock end where client_id=tenant and ingredient_id=ingredient;
    if new_cost is distinct from old_cost then
      update public.pos_ingredients set cost_per_unit=new_cost where id=ingredient and client_id=tenant;
      cost_changed := cost_changed || jsonb_build_object(ingredient,true);
    end if;
    detail := detail || jsonb_build_array(jsonb_build_object('ingredient_id',ingredient,'quantity',qty,'movement_id',movement::text,
      'stock_before',old_stock,'stock_after',new_stock,'cost_before',old_cost,'cost_after',new_cost));
  end loop;
  receipt := jsonb_build_object('version',1,'committed',true,'operation_id',operation,'client_id',tenant,'idempotency_key',request_key,
    'stock_scope','tenant','source_document_key',document_key,'request_echo',p_request,'actor',p_actor,'movements_created',line_index,'stock_updates',distinct_count,
    'cost_updates',(select count(*) from jsonb_object_keys(cost_changed)), 'was_duplicate',false,'details',detail);
  insert into public.pos_inventory_operation_receipts(operation_id,client_id,idempotency_key,source_document_key,request,actor,receipt)
    values(operation,tenant,request_key,document_key,p_request,p_actor,receipt);
  return receipt;
end;
$$;
revoke all on function public.record_inventory_movement_atomic(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.record_inventory_movement_atomic(jsonb,jsonb) to service_role;

-- Recovery may inspect a DIFFERENT pending form without executing its payload.
-- Absence is observation, never cancellation: an old network request can still
-- arrive later. The client retains that intent until an exact result settles it.
create function public.get_inventory_movement_receipt(p_request jsonb, p_actor jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
set statement_timeout = '12s'
set lock_timeout = '8s'
as $$
declare saved public.pos_inventory_operation_receipts%rowtype; tenant text := p_request->>'client_id'; key text := p_request->>'idempotency_key';
begin
  if coalesce(length(tenant),0) not between 1 and 200 or coalesce(length(key),0) not between 1 and 240
    or p_actor->>'client_id' is distinct from tenant or coalesce(length(p_actor->>'id'),0) not between 1 and 200
    or coalesce(p_actor->>'role','') not in ('gerente','admin','dueño')
    or coalesce(p_actor->>'auth_type','') not in ('shift_token','supabase_session') then raise exception 'INVENTORY_ACTOR_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fullsite-inventory:' || tenant || ':' || key, 0));
  select * into saved from public.pos_inventory_operation_receipts where client_id=tenant and idempotency_key=key;
  if not found then return jsonb_build_object('version',1,'found',false,'client_id',tenant,'idempotency_key',key,'request_echo',p_request,'actor',p_actor); end if;
  if saved.request is distinct from p_request or saved.actor->>'id' is distinct from p_actor->>'id'
    or saved.actor->>'auth_type' is distinct from p_actor->>'auth_type' then raise exception 'INVENTORY_IDEMPOTENCY_CONFLICT'; end if;
  return saved.receipt || jsonb_build_object('was_duplicate',true);
end;
$$;
revoke all on function public.get_inventory_movement_receipt(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.get_inventory_movement_receipt(jsonb,jsonb) to service_role;

-- Existing authenticated REST policies permit legacy movement edits. Those
-- policies must never permit altering or forging a canonical H08 ledger row.
-- Invoker rights preserve the outer RPC's owner while ordinary REST callers
-- retain authenticated/service_role. No client-settable transaction marker.
create function public.guard_inventory_operation_ledger() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op in ('UPDATE','DELETE') and old.inventory_operation_id is not null then
    raise exception 'INVENTORY_LEDGER_IMMUTABLE';
  end if;
  if tg_op <> 'DELETE' and new.inventory_operation_id is not null and current_user <>
    pg_get_userbyid((select proowner from pg_proc where oid='public.record_inventory_movement_atomic(jsonb,jsonb)'::regprocedure)) then
    raise exception 'INVENTORY_CANONICAL_RPC_REQUIRED';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.guard_inventory_operation_ledger() from public, anon, authenticated, service_role;
create trigger guard_inventory_operation_ledger before insert or update or delete on public.pos_inventory_movements
  for each row execute function public.guard_inventory_operation_ledger();

comment on function public.record_inventory_movement_atomic(jsonb,jsonb) is
  'H08 manual inventory. Service-role gateway stamps authenticated actor/tenant. Atomic ledger, stock, cost, exact receipt. Tenant stock; no order/payment writes or sale depletion authority.';
commit;
