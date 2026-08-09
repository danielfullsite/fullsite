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
- **Server API routes (D, commit 8a71306):** deterministic sweep complete — **UNSAFE 0,
  UNKNOWN 0**. Fixed a real cross-tenant bypass: 16 routes resolved the tenant from a
  browser-supplied `client_id` (`getClientId` reads `x-client-id`/`?client_id=`) and queried
  with the service key — a forged header read/wrote any tenant's recipes/presentations/
  inventory/food-cost/accounting/invoices (no auth middleware exists). All now authenticate via
  `withPOSAuth` and use the server-resolved `auth.clientId`. `api/voice`/`api/coach` also went
  from anonymous → authenticated + service key. A regression test
  (`bug019-no-browser-tenant.test.ts`) blocks reintroduction of `getClientId` in any route.
- **Private non-client_id tables (D, migration section 7):** permissive `public`/`anon` read
  policies on `wansoft_daily`/`wansoft_kpis` (AMALAY financials), `amalay_reservaciones`
  (customer PII), `pos_purchase_order_items`, `pos_sub_recipe_ingredients` exposed private data
  to anonymous. Section 7 revokes anon (authenticated + service_role only). `content`/`reviews`
  left public (marketing site). Child tables lack `client_id` → authenticated-only (see residual).
- **`lib/client-config.ts`:** `clients` read now prefers service key server-side (survives RLS),
  anon fallback client-side (JWT-patched); service key never ships to the client bundle.

## Two-tenant isolation evidence
Synthetic reproduction of Supabase's role model (anon/authenticated/service_role + auth.uid())
applying the EXACT migration policy pattern to `pos_orders`. 7/7:
A reads only A; A cannot INSERT/UPDATE/DELETE B; A full CRUD on own; B symmetric; anon SELECT
& INSERT denied (revoked); service_role full (server-scoped by code). Harness:
scratchpad `bug019_cert/iso_{prelude,cert}.sql`. Staging already runs the strict migration
(read-only confirmation available).

## Residual risks
1. **RESOLVED (fail-closed, commit d78d4cf):** `api/voice` + `api/coach` read `wansoft_daily`/
   `wansoft_waiter_categories` — AMALAY-legacy tables with NO `client_id` (921 rows, AMALAY sales
   history; multiple tenants already live). Now only the configured legacy owner
   (`WANSOFT_LEGACY_CLIENT_ID`, default `amalay`) reads them; every other tenant fails closed (empty /
   no insights). voice still serves each tenant's own `pos_staff`. **Set `WANSOFT_LEGACY_CLIENT_ID`
   in prod env (defaults to `amalay`).** Non-blocking feature enhancement (not a security item):
   serve other tenants' voice/coach from `pos_orders` for parity — product decision, deferred.
2. Child tables without `client_id` (`pos_purchase_order_items`, `pos_sub_recipe_ingredients`):
   authenticated-only after section 7, but not tenant-scoped (cross-tenant among *authenticated*
   users). Full scoping needs a `client_id` column or a parent-join policy — deferred (low severity,
   authenticated-only, recipe/PO line items).
3. Non-blocking: survey opaque token (F), Bridge E2 physical dedup, floor QR badge (C).

## Expected user/restaurant impact
None for legitimate authenticated same-tenant use (POS/dashboard/public flows unchanged). Post-RLS,
anonymous callers lose all tenant DB access (intended). voice/coach now require login.

## State
PROD untouched. STRICT PROD RLS: NOT APPLIED. All security residuals closed; no product decision
blocks the gate. **READY for the founder-approved production activation.** Set
`WANSOFT_LEGACY_CLIENT_ID=amalay` in the prod app env before/at deploy.
