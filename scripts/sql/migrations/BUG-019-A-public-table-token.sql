-- BUG-019-A: public table token + multi-location on pos_mesas
-- Secure server-side QR identity: token -> client_id + location_id + mesa.
-- Additive, idempotent DDL ONLY. NO token generation here (see the backfill file).
-- The browser never sends client_id/location; the server resolves them from the
-- opaque token. Fail-closed: a NULL/inactive token resolves to nothing.
--
-- Depends on: public.client_locations(id text PK) — verified present in prod+staging.
-- Interacts with: strict RLS migration (BUG-019-tenant-rls-fix.sql) treats pos_mesas
--   as a tenant table (has client_id) -> authenticated-only after gate I. These new
--   columns add NO anon grant and change nothing in that dynamic policy loop.
--
-- Preflight:  SELECT column_name FROM information_schema.columns
--               WHERE table_schema='public' AND table_name='pos_mesas'
--                 AND column_name IN ('location_id','public_token','token_active');
-- Postflight: SELECT count(*) FROM information_schema.columns
--               WHERE table_schema='public' AND table_name='pos_mesas'
--                 AND column_name IN ('location_id','public_token','token_active');  -- expect 3
-- Rollback:   scripts/sql/migrations/BUG-019-A-ROLLBACK.sql

-- location_id  : tenant location this mesa belongs to (FK below). NULL => fail closed.
-- public_token : opaque, non-guessable QR token (backfilled separately). NULL => no QR.
-- token_active : QR ordering toggle, independent of pos_mesas.active. Lets staff kill
--                public ordering for a mesa without deactivating the mesa itself, and
--                re-enable the SAME printed QR without reprinting.
alter table public.pos_mesas
  add column if not exists location_id  text,
  add column if not exists public_token text,
  add column if not exists token_active boolean not null default true;

-- Token uniqueness. Partial: many mesas may legitimately hold NULL (inactive / not yet
-- tokenized) and multiple NULLs must be allowed.
create unique index if not exists pos_mesas_public_token_key
  on public.pos_mesas (public_token)
  where public_token is not null;

-- location_id -> client_locations(id). Nullable (NULL is fail-closed at the resolver).
-- Default ON DELETE NO ACTION: a location that still has mesas cannot be silently
-- removed. Guarded so re-running the migration does not error on an existing FK.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pos_mesas_location_fk'
  ) then
    alter table public.pos_mesas
      add constraint pos_mesas_location_fk
      foreign key (location_id) references public.client_locations(id);
  end if;
end $$;
