# BUG-019 — PROD strict-RLS activation package (PREPARED, NOT EXECUTED)

Production activation requires explicit founder approval. This is the package to execute the
gate; nothing here has been run against production.

## Migration / policy set
- `docs/release/BUG-019-tenant-rls-fix.sql` — dynamic, idempotent, transactional. For every
  base table with `client_id` (except client_users/clients): `revoke all from anon` + 4
  authenticated policies scoped by `private.user_has_client_access(client_id)` + a
  service_role bypass policy. All views: anon revoked, security_invoker=true. All SECURITY
  DEFINER functions: anon EXECUTE revoked (no exceptions — `get_public_menu` dropped, menu is
  server-side now). client_users/clients: anon revoked, tenant-scoped.
- Rollback: `docs/release/BUG-019-ROLLBACK.sql` (restores permissive state; rehearsed
  fix→rollback→reapply on staging). Pre-deploy snapshot: `docs/release/rollback-snapshots/`.

## Deployment order (must be exact)
1. Deploy the app build from this branch (JWT fetch-patch + service-key server routes + the
   server-mediated public surfaces A/B/C/F/G). App works while RLS is still permissive.
2. Smoke: POS / KDS / dashboard / printing / public menu+order+survey+reservation.
3. Apply `BUG-019-tenant-rls-fix.sql` to prod.
4. Two-tenant isolation checks on prod (see evidence).
5. Post-RLS smoke (service_role + background agents keep working).
6. Rollback trigger: any 401/403 on a legitimate path or broken public flow →
   `BUG-019-ROLLBACK.sql` + revert app; snapshot available.

## Compatibility evidence
- **Public/anonymous surfaces:** fully server-mediated, zero anon DB, zero browser tenant
  identity (A token, B menu, C order, F survey, G reservation). Certified.
- **Client-side authenticated libs** (`pos-data.ts`, `inventory.ts`, …): use anon key but the
  `supabase-fetch-patch` injects the session JWT into `/rest/v1/` calls → RLS `authenticated`
  policies apply. Compatible with a session.
- **Server API routes:** 27 follow the ef989c3 pattern (service key for tenant tables, anon
  only for `/auth/v1/user` validation — verified in `lib/api-auth.ts`). Residual to fix
  before the gate: `api/voice` reads `pos_staff` (client_id table) with anon → returns 0
  post-RLS (mesero list). `api/coach` reads `wansoft_daily` (no client_id, public policy →
  survives) so it is unaffected. Non-client_id tables (`wansoft_daily`,
  `wansoft_waiter_categories`) are outside the migration and keep current behavior.

## Two-tenant isolation evidence
Synthetic reproduction of Supabase's role model (anon/authenticated/service_role + auth.uid())
applying the EXACT migration policy pattern to `pos_orders`. 7/7:
A reads only A; A cannot INSERT/UPDATE/DELETE B; A full CRUD on own; B symmetric; anon SELECT
& INSERT denied (revoked); service_role full (server-scoped by code). Harness:
scratchpad `bug019_cert/iso_{prelude,cert}.sql`. Staging already runs the strict migration
(read-only confirmation available).

## Residual risks / remaining before gate
1. `api/voice` `pos_staff` read → switch to service key (client_id-filtered) [confirmed break].
2. Full per-route sweep of the 27 service+anon routes to confirm no stray anon tenant read.
3. `lib/client-config.ts` reads `clients` with anon — confirm it only runs client-side (JWT) or
   switch to service key if server-invoked.
4. Non-blocking: survey opaque token (F), Bridge E2 physical dedup, floor QR badge (C).

## State
PROD untouched. STRICT PROD RLS: NOT APPLIED. Execution gated on founder approval.
