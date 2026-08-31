-- Preserve order capture time and make order folios continuous inside a cash shift.
--
-- API-side shift validation prevents new offline replays from entering a closed turno.
-- This migration fixes the two database facts needed by that boundary:
--   1. captured_at records when the operator created the order, independently of sync time.
--   2. order_number increments per turno, not per calendar date, with an advisory lock so
--      simultaneous terminals cannot select the same MAX()+1 value.

begin;

alter table public.pos_orders
  add column if not exists captured_at timestamptz;

comment on column public.pos_orders.captured_at is
  'Hora de captura en la terminal. NULL para histórico previo; created_at sigue siendo hora de persistencia.';

create or replace function public.set_pos_order_number()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.order_number is null then
    -- Serialize allocation for one tenant+turno. hashtextextended is stable inside
    -- PostgreSQL and the transaction lock is released automatically at commit.
    perform pg_advisory_xact_lock(
      hashtextextended(coalesce(new.client_id, '') || ':' || coalesce(new.turno_id, ''), 0)
    );

    if new.turno_id is not null then
      select coalesce(max(order_number), 0) + 1
        into new.order_number
        from public.pos_orders
       where client_id = new.client_id
         and turno_id = new.turno_id;
    else
      -- Legacy fallback only. Current schema requires turno_id for every new order.
      select coalesce(max(order_number), 0) + 1
        into new.order_number
        from public.pos_orders
       where client_id = new.client_id
         and (created_at at time zone 'America/Monterrey')::date
             = (now() at time zone 'America/Monterrey')::date;
    end if;
  end if;
  return new;
end;
$$;

commit;
