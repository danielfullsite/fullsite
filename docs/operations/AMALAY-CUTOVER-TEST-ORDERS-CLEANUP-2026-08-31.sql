-- AMALAY cutover rehearsal cleanup. REVIEW MODE BY DEFAULT: ends in ROLLBACK.
--
-- These are the 16 unpaid test orders created while AMALAY was not yet operating on
-- Fullsite. This script never DELETEs. It changes only status/closed_at/notas and writes
-- one audit event per order. Every measured invariant must still match or the transaction
-- aborts before changing anything.
--
-- Production procedure:
--   1. Run unchanged. Inspect the final result and confirm 16 rows / $6,172.36.
--   2. Re-run in a fresh transaction changing only the final ROLLBACK to COMMIT.
--   3. Verify the POS map reports zero active test tables.

begin;

create temporary table amalay_cutover_orders on commit drop as
select id, client_id, mesa, status, total, pagos, closed_at, notas, created_at
  from public.pos_orders
 where client_id = 'amalay'
   and status = 'enviada'
   and closed_at is null
   and created_at >= timestamptz '2026-08-30 19:50:00-06'
   and created_at <  timestamptz '2026-08-31 00:30:00-06'
 for update;

do $$
declare
  v_count integer;
  v_total numeric;
  v_tables integer;
  v_with_payments integer;
begin
  select count(*), round(coalesce(sum(total), 0), 2), count(distinct mesa),
         count(*) filter (where case
           when pagos is null or pagos = 'null'::jsonb then false
           when jsonb_typeof(pagos) = 'array' then jsonb_array_length(pagos) > 0
           else true
         end)
    into v_count, v_total, v_tables, v_with_payments
    from amalay_cutover_orders a;

  if v_count <> 16 or v_total <> 6172.36 or v_tables <> 15 or v_with_payments <> 0 then
    raise exception
      'CUTOVER_ABORTED expected count=16 total=6172.36 tables=15 payments=0; got count=% total=% tables=% payments=%',
      v_count, v_total, v_tables, v_with_payments;
  end if;
end;
$$;

insert into public.pos_audit_log (client_id, order_id, action, actor, mesa, details)
select client_id, id, 'cutover_test_order_cancelled', 'FULLSITE_CUTOVER_2026_08_31', mesa,
       jsonb_build_object(
         'reason', 'AMALAY no operaba todavía con Fullsite; orden de validación controlada',
         'previous_status', status,
         'previous_closed_at', closed_at,
         'total', total,
         'created_at', created_at
       )
  from amalay_cutover_orders;

update public.pos_orders p
   set status = 'cancelada',
       closed_at = now(),
       notas = concat_ws(E'\n', nullif(p.notas, ''), '[CUTOVER TEST] Cerrada durante saneamiento AMALAY 2026-08-31'),
       updated_at = now()
  from amalay_cutover_orders a
 where p.id = a.id
   and p.client_id = a.client_id
   and p.status = a.status
   and p.closed_at is not distinct from a.closed_at;

select count(*) as orders_reviewed,
       round(sum(total), 2) as total_reviewed,
       count(distinct mesa) as tables_released
  from amalay_cutover_orders;

-- SAFETY DEFAULT. Change only this line to COMMIT after reviewing the result above.
rollback;
