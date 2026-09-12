-- Candidate only. Apply in staging before deploying the route that calls it.
-- Employee lookup, alternating state, insertion and replay receipt are one transaction.
create table if not exists public.pos_time_clock_operations (
  client_id text not null, operation_id text not null, staff_id text not null,
  result jsonb not null, created_at timestamptz not null default now(),
  primary key(client_id,operation_id)
);
alter table public.pos_time_clock_operations enable row level security;
revoke all on public.pos_time_clock_operations from public,anon,authenticated;
grant all on public.pos_time_clock_operations to service_role;

create or replace function public.r1_time_clock_atomic(
  p_client_id text, p_pin text, p_operation_id text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  prior public.pos_time_clock_operations%rowtype;
  employee_id text; employee_name text; employee_count integer; last_type text; clock_type text;
  inserted_ts timestamptz; recent jsonb; output jsonb;
begin
  if nullif(btrim(p_client_id),'') is null or p_pin !~ '^[0-9]{3,10}$' or
     nullif(btrim(p_operation_id),'') is null or length(p_operation_id)>200
    then raise exception 'INVALID_TIME_CLOCK'; end if;

  perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(p_client_id,p_operation_id)::text,0));
  select * into prior from public.pos_time_clock_operations
    where client_id=p_client_id and operation_id=p_operation_id;
  if found then return prior.result || jsonb_build_object('already_applied',true); end if;

  select count(*), min(id), min(name) into employee_count, employee_id, employee_name
    from public.pos_staff where client_id=p_client_id and pin=p_pin and active=true;
  if employee_count=0 then raise exception 'PIN_NOT_FOUND'; end if;
  if employee_count<>1 then raise exception 'PIN_AMBIGUOUS'; end if;

  perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(p_client_id,employee_id)::text,0));
  select type into last_type from public.pos_time_clock
    where client_id=p_client_id and staff_id=employee_id order by ts desc,id desc limit 1;
  clock_type := case when last_type='entrada' then 'salida' else 'entrada' end;
  insert into public.pos_time_clock(client_id,staff_id,staff_name,type,method)
    values(p_client_id,employee_id,employee_name,clock_type,'pin') returning ts into inserted_ts;
  select coalesce(jsonb_agg(x order by x.ts desc),'[]'::jsonb) into recent from (
    select type,method,ts from public.pos_time_clock
    where client_id=p_client_id and staff_id=employee_id order by ts desc,id desc limit 8
  ) x;
  output := jsonb_build_object('ok',true,'staff_name',employee_name,'type',clock_type,
    'ts',inserted_ts,'recientes',recent,'already_applied',false);
  insert into public.pos_time_clock_operations(client_id,operation_id,staff_id,result)
    values(p_client_id,p_operation_id,employee_id,output);
  return output;
end $$;
revoke all on function public.r1_time_clock_atomic(text,text,text) from public,anon,authenticated;
grant execute on function public.r1_time_clock_atomic(text,text,text) to service_role;
