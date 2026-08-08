-- BUG-019-E: exactly-once print-intent identity on pos_print_jobs.
-- Additive, idempotent DDL. No Bridge change. No destructive backfill.
--
-- Canonical print intent = (order_id, station, comanda_batch_id, reprint_seq) for
-- type='comanda'. client_id is intentionally NOT part of the key: pos_orders.id is
-- the global PK (verified prod: 1974 ids / 1974 rows, 0 shared across client_id), so
-- order_id already identifies exactly one tenant's order — the tuple cannot collide
-- cross-tenant. comanda_batch_id is itself a UUID minted per send.
--   reprint_seq = 0  -> automatic comanda (and technical retries reuse this row)
--   reprint_seq > 0  -> explicit, audited operator reprint (new row, allowed)
--
-- Legacy rows (comanda_batch_id NULL, from before this batch) stay valid and OUTSIDE
-- the constraint: the unique index is partial. No historical backfill is performed.
--
-- Preflight:  SELECT column_name FROM information_schema.columns
--               WHERE table_schema='public' AND table_name='pos_print_jobs'
--                 AND column_name IN ('comanda_batch_id','reprint_seq');
-- Postflight: SELECT indexname FROM pg_indexes WHERE indexname='pos_print_jobs_comanda_intent';
-- Rollback:   scripts/sql/migrations/BUG-019-E-ROLLBACK.sql

alter table public.pos_print_jobs
  add column if not exists comanda_batch_id text,
  add column if not exists reprint_seq integer not null default 0;

-- Final enforcement boundary for print-intent exactly-once. Partial: only canonical
-- comanda jobs that carry a batch id; NULL-batch (legacy / non-comanda) rows are exempt
-- and may repeat freely.
create unique index if not exists pos_print_jobs_comanda_intent
  on public.pos_print_jobs (order_id, station, comanda_batch_id, reprint_seq)
  where type = 'comanda' and comanda_batch_id is not null;
