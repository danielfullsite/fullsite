-- Candidate only. Apply in staging before deploying the route that calls it.
-- Order mutation, audit evidence and replay receipt commit together.
create table if not exists public.pos_cancel_item_operations (
  client_id text not null, operation_id text not null, intent jsonb not null,
  result jsonb not null, created_at timestamptz not null default now(),
  primary key(client_id,operation_id)
);
alter table public.pos_cancel_item_operations enable row level security;
revoke all on public.pos_cancel_item_operations from public,anon,authenticated;
grant all on public.pos_cancel_item_operations to service_role;

create or replace function public.r1_cancel_item_atomic(
  p_client_id text, p_order_id text, p_operation_id text,
  p_expected_updated_at timestamptz, p_expected_revision bigint,
  p_intent jsonb, p_patch jsonb, p_actor text, p_action text, p_details jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  prior public.pos_cancel_item_operations%rowtype;
  current_order public.pos_orders%rowtype;
  output jsonb; next_revision bigint;
begin
  if nullif(btrim(p_client_id),'') is null or nullif(btrim(p_order_id),'') is null or
     nullif(btrim(p_operation_id),'') is null or length(p_operation_id)>200 or
     nullif(btrim(p_actor),'') is null or p_action not in ('item_cancelled','item_voided') or
     jsonb_typeof(p_intent) is distinct from 'object' or jsonb_typeof(p_patch) is distinct from 'object' or
     jsonb_typeof(p_details) is distinct from 'object'
    then raise exception 'INVALID_CANCEL'; end if;

  perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(p_client_id,p_operation_id)::text,0));
  select * into prior from public.pos_cancel_item_operations
    where client_id=p_client_id and operation_id=p_operation_id;
  if found then
    if prior.intent is distinct from p_intent then raise exception 'OPERATION_ID_REUSED'; end if;
    return prior.result || jsonb_build_object('already_applied',true);
  end if;

  select * into current_order from public.pos_orders
    where id=p_order_id and client_id=p_client_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if current_order.updated_at is distinct from p_expected_updated_at or
     coalesce(current_order.order_revision,0) is distinct from p_expected_revision
    then raise exception 'ORDER_CONFLICT'; end if;
  next_revision := p_expected_revision+1;
  if (p_patch->>'order_revision')::bigint is distinct from next_revision or
     jsonb_typeof(p_patch->'items') is distinct from 'string'
    then raise exception 'INVALID_CANCEL'; end if;

  update public.pos_orders set
    items=(p_patch->>'items')::jsonb,
    subtotal=(p_patch->>'subtotal')::numeric,
    descuento=(p_patch->>'descuento')::numeric,
    iva=(p_patch->>'iva')::numeric,
    total=(p_patch->>'total')::numeric,
    saldo=(p_patch->>'saldo')::numeric,
    order_revision=next_revision,
    updated_at=clock_timestamp()
    where id=p_order_id and client_id=p_client_id
    returning * into current_order;

  insert into public.pos_audit_log(client_id,order_id,action,actor,details)
    values(p_client_id,p_order_id,p_action,p_actor,p_details);
  output := jsonb_build_object('ok',true,'item_name',p_details->>'item_name',
    'revision',current_order.order_revision,'order',to_jsonb(current_order),'already_applied',false);
  insert into public.pos_cancel_item_operations(client_id,operation_id,intent,result)
    values(p_client_id,p_operation_id,p_intent,output);
  return output;
end $$;
revoke all on function public.r1_cancel_item_atomic(text,text,text,timestamptz,bigint,jsonb,jsonb,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.r1_cancel_item_atomic(text,text,text,timestamptz,bigint,jsonb,jsonb,text,text,jsonb)
  to service_role;
