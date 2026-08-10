-- BUG-019-A backfill — run by service_role AFTER BUG-019-A-public-table-token.sql.
-- Idempotent: re-running never regenerates an existing token or overwrites a location
-- (every write is guarded by "... IS NULL"). Tokens are generated INSIDE the database
-- via pgcrypto and never transit the app/network.
--
-- (1) location_id: derived from the client's SINGLE active location — NO hardcoded
--     'amalay-spgg' default. Clients with >1 active location are intentionally left
--     NULL (ambiguous) for explicit manual assignment; the resolver fails closed on
--     NULL, so this never leaks or misroutes.
-- (2) public_token: 192 bits of entropy (24 random bytes) as 48 lowercase hex chars —
--     URL-safe by construction, no base64 translation. Only ACTIVE mesas are tokenized
--     (inactive mesas are not publicly reachable). The UNIQUE index guarantees real
--     uniqueness; a hex(gen_random_bytes(24)) collision is cryptographically negligible.
--     NOTE: gen_random_bytes lives in the `extensions` schema on Supabase (verified:
--     extensions.gen_random_bytes(integer)), so it is schema-qualified to avoid
--     depending on search_path — a restricted search_path would otherwise fail closed.
--
-- Preflight:  SELECT count(*) FILTER (WHERE public_token IS NULL AND active) AS need_token,
--                    count(*) FILTER (WHERE location_id  IS NULL)             AS need_loc
--             FROM public.pos_mesas;
-- Postflight: SELECT client_id,
--                    count(*) FILTER (WHERE location_id  IS NULL)             AS still_null_loc,
--                    count(*) FILTER (WHERE public_token IS NULL AND active)  AS still_null_tok
--             FROM public.pos_mesas GROUP BY client_id ORDER BY client_id;
--   (still_null_loc > 0 => that client has 0 or >1 active locations: assign manually.)

-- (1) location backfill — unambiguous clients only (exactly one active location)
update public.pos_mesas m
set location_id = cl.id
from (
  select client_id, min(id) as id, count(*) as n
  from public.client_locations
  where active
  group by client_id
) cl
where m.client_id = cl.client_id
  and cl.n = 1
  and m.location_id is null;

-- (2) token backfill — active mesas that do not yet have a token
update public.pos_mesas
set public_token = encode(extensions.gen_random_bytes(24), 'hex')
where public_token is null
  and active;
