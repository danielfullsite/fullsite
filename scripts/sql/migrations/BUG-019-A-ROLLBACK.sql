-- BUG-019-A ROLLBACK — reverse the additive token/location change on pos_mesas.
-- Safe and idempotent. Destroys generated tokens (fully regenerable via the backfill).
-- location_id is derivable again from client_locations, so no unrecoverable data loss.
-- Order: drop FK, then unique index, then columns.
alter table public.pos_mesas drop constraint if exists pos_mesas_location_fk;

drop index if exists public.pos_mesas_public_token_key;

alter table public.pos_mesas
  drop column if exists public_token,
  drop column if exists token_active,
  drop column if exists location_id;
