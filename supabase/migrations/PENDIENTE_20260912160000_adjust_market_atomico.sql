-- Candidate only. Apply in staging before deploying the route that calls it.
-- A stock delta and its replay receipt commit in the same transaction.
create table if not exists public.pos_market_adjustment_operations (
  client_id text not null, operation_id text not null, intent jsonb not null,
  result jsonb not null, actor text not null, created_at timestamptz not null default now(),
  primary key(client_id,operation_id)
);
alter table public.pos_market_adjustment_operations enable row level security;
revoke all on public.pos_market_adjustment_operations from public,anon,authenticated;
grant all on public.pos_market_adjustment_operations to service_role;

create or replace function public.r1_adjust_market_stock_atomic(
  p_client_id text, p_menu_item_id text, p_adjustment_type text, p_quantity numeric,
  p_actor text, p_notes text, p_operation_id text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  prior public.pos_market_adjustment_operations%rowtype;
  intent jsonb := jsonb_build_object('menu_item_id',p_menu_item_id,'adjustment_type',p_adjustment_type,
    'quantity',p_quantity,'notes',p_notes);
  output jsonb;
begin
  if nullif(btrim(p_client_id),'') is null or nullif(btrim(p_menu_item_id),'') is null or
     nullif(btrim(p_actor),'') is null or nullif(btrim(p_operation_id),'') is null or
     length(p_operation_id)>200 or length(p_menu_item_id)>200 or length(coalesce(p_notes,''))>1000 or
     p_adjustment_type not in ('entrada','merma','ajuste_absoluto') or p_quantity<0 or
     (p_adjustment_type<>'ajuste_absoluto' and p_quantity=0)
    then raise exception 'INVALID_MARKET_ADJUSTMENT'; end if;

  perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(p_client_id,p_operation_id)::text,0));
  select * into prior from public.pos_market_adjustment_operations
    where client_id=p_client_id and operation_id=p_operation_id;
  if found then
    if prior.intent is distinct from intent then raise exception 'OPERATION_ID_REUSED'; end if;
    return prior.result || jsonb_build_object('was_duplicate',true);
  end if;
  if not exists(select 1 from public.pos_menu_items where client_id=p_client_id and id=p_menu_item_id)
    then raise exception 'MARKET_ITEM_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(p_client_id,p_menu_item_id)::text,0));
  select public.r1_adjust_market_stock(p_client_id,p_menu_item_id,p_adjustment_type,p_quantity,p_actor,p_notes)
    into output;
  output := output || jsonb_build_object('was_duplicate',false);
  insert into public.pos_market_adjustment_operations(client_id,operation_id,intent,result,actor)
    values(p_client_id,p_operation_id,intent,output,p_actor);
  return output;
end $$;
revoke all on function public.r1_adjust_market_stock_atomic(text,text,text,numeric,text,text,text) from public,anon,authenticated;
grant execute on function public.r1_adjust_market_stock_atomic(text,text,text,numeric,text,text,text) to service_role;
