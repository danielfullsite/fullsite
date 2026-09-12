-- Candidate only. Apply in staging before deploying the route that calls it.
-- Reopening, revision, approval audit and replay receipt commit together.
create table if not exists public.pos_reopen_operations (
  client_id text not null, operation_id text not null, intent jsonb not null,
  result jsonb not null, created_at timestamptz not null default now(),
  primary key (client_id, operation_id)
);
alter table public.pos_reopen_operations enable row level security;
revoke all on public.pos_reopen_operations from public, anon, authenticated;
grant all on public.pos_reopen_operations to service_role;

create or replace function public.r1_reopen_order_atomic(
  p_client_id text, p_order_id text, p_operation_id text,
  p_actor text, p_approval_mode text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  current_order public.pos_orders%rowtype;
  previous public.pos_reopen_operations%rowtype;
  intent jsonb := jsonb_build_object('order_id', p_order_id);
  output jsonb;
begin
  if nullif(btrim(p_client_id),'') is null or nullif(btrim(p_order_id),'') is null or
     nullif(btrim(p_operation_id),'') is null or length(p_operation_id)>200 or
     nullif(btrim(p_actor),'') is null or nullif(btrim(p_approval_mode),'') is null
    then raise exception 'INVALID_REOPEN'; end if;

  perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(p_client_id,p_order_id)::text,0));
  select * into previous from public.pos_reopen_operations
    where client_id=p_client_id and operation_id=p_operation_id;
  if found then
    if previous.intent is distinct from intent then raise exception 'OPERATION_ID_REUSED'; end if;
    return previous.result || jsonb_build_object('already_applied',true);
  end if;

  select * into current_order from public.pos_orders
    where id=p_order_id and client_id=p_client_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if current_order.status is distinct from 'cerrada' or current_order.closed_at is null
    then raise exception 'ORDER_NOT_CLOSED'; end if;
  if exists (
    select 1 from public.pos_orders other
    where other.client_id=p_client_id and other.id<>p_order_id
      and other.location_id is not distinct from current_order.location_id
      and other.mesa=current_order.mesa
      and other.status in ('abierta','enviada','preparando','lista')
  ) then raise exception 'ACTIVE_TABLE_CONFLICT'; end if;

  update public.pos_orders set status='enviada', closed_at=null, metodo_pago=null,
    order_revision=coalesce(order_revision,0)+1, updated_at=clock_timestamp()
    where id=p_order_id and client_id=p_client_id returning * into current_order;
  insert into public.pos_audit_log(client_id,order_id,action,actor,details)
    values(p_client_id,p_order_id,'order_reopened',p_actor,
      jsonb_build_object('approval_mode',p_approval_mode,'revision',current_order.order_revision));
  output := jsonb_build_object('ok',true,'revision',current_order.order_revision,
    'order_id',p_order_id,'already_applied',false);
  insert into public.pos_reopen_operations(client_id,operation_id,intent,result)
    values(p_client_id,p_operation_id,intent,output);
  return output;
end $$;
revoke all on function public.r1_reopen_order_atomic(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.r1_reopen_order_atomic(text,text,text,text,text) to service_role;
