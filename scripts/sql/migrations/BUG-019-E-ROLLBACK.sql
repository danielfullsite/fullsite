-- BUG-019-E ROLLBACK — reverse the additive print-intent identity. Safe/idempotent.
-- Legacy and historical rows are untouched (no data was backfilled or rewritten).
drop index if exists public.pos_print_jobs_comanda_intent;
alter table public.pos_print_jobs
  drop column if exists reprint_seq,
  drop column if exists comanda_batch_id;
