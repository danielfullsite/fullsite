# BUG-019 — PROD strict-RLS activation package (PREPARED, NOT EXECUTED)

Production activation requires explicit founder approval. This is the package to execute the
gate; nothing here has been run against production.

## Migration / policy set
- `docs/release/BUG-019-tenant-rls-fix.sql` — dynamic, idempotent, transactional.
  - **§1** every base table with `client_id` (except client_users/clients): `revoke all from
    anon` + 4 authenticated policies scoped by `private.user_has_client_access(client_id)` +
    service_role bypass.
  - **Views:** anon revoked, security_invoker=true. **SECDEF functions:** anon EXECUTE revoked
    (no exceptions — `get_public_menu` dropped, menu is server-side). client_users/clients: anon
    revoked, tenant-scoped.
  - **§7a** legacy tables with NO `client_id` and no parent (`wansoft_daily`, `wansoft_kpis`,
    `amalay_reservaciones`): revoke anon; authenticated read-only + service_role. (`wansoft_*`
    additionally behind the voice/coach ownership gate.)
  - **§7b** CHILD tables with NO `client_id` — tenant-scoped via the real parent relation:
    `pos_purchase_order_items.order_id → pos_purchase_orders.id` and
    `pos_sub_recipe_ingredients.sub_recipe_id → pos_sub_recipes.id` (parents carry `client_id`;
    no formal FK in schema → link column verified). SELECT/INSERT/UPDATE/DELETE policies with
    `USING`+`WITH CHECK` = `exists(select 1 from parent p where p.id=child.<fk> and
    user_has_client_access(p.client_id))`. Prevents cross-tenant read, insert-under, update,
    delete AND move. Revoke anon; service_role bypass.
- **Rollback (SECURE): `docs/release/BUG-019-ROLLBACK.sql`** — emergency revert of strict tenant
  isolation to permissive-**authenticated** so the app recovers, but **anon stays revoked and NO
  insecure public/anon policy is restored** (wansoft/PII/child/pos_staff stay closed). Recover the
  secure state by re-applying the migration. Pre-deploy snapshot: `docs/release/rollback-snapshots/`.

## Deployment order (must be exact)
1. **Env:** set `WANSOFT_LEGACY_CLIENT_ID=amalay` and `SUPABASE_SERVICE_KEY` in the prod app
   env. (No fallback: without `WANSOFT_LEGACY_CLIENT_ID`, voice/coach deny ALL tenants — fail
   closed by design.)
2. Deploy the app build from this branch (JWT fetch-patch + service-key/authenticated server
   routes + server-mediated public surfaces A/B/C/F/G). App works while RLS is still permissive.
3. Smoke: POS / KDS / dashboard / printing / public menu+order+survey+reservation; voice/coach
   for AMALAY (allowed) and a non-AMALAY tenant (expect 403 feature_unavailable, no data).
4. Apply `BUG-019-tenant-rls-fix.sql` to prod.
5. Two-tenant isolation checks on prod incl. child tables (see evidence).
6. Post-RLS smoke (service_role + background agents keep working).
7. Rollback trigger: any 401/403 on a legitimate path or broken public flow →
   `BUG-019-ROLLBACK.sql` (secure: does NOT re-open anon) + revert app; snapshot available.

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
- **Private non-client_id tables (D, migration §7):** permissive `public`/`anon` read policies
  exposed private data to anonymous. §7a revokes anon on `wansoft_daily`/`wansoft_kpis` (AMALAY
  financials) + `amalay_reservaciones` (customer PII) → authenticated + service_role. §7b makes
  the CHILD tables (`pos_purchase_order_items`, `pos_sub_recipe_ingredients`) **tenant-scoped via
  the parent** (SELECT/INSERT/UPDATE/DELETE with USING+WITH CHECK) — cross-tenant read/insert/
  update/delete/move blocked (certified below). `content`/`reviews` left public (marketing site).
- **`lib/client-config.ts`:** `clients` read now prefers service key server-side (survives RLS),
  anon fallback client-side (JWT-patched); service key never ships to the client bundle.

## Two-tenant isolation evidence (SYNTHETIC POLICY ISOLATION)
Synthetic reproduction of Supabase's role model (anon/authenticated/service_role + `auth.uid()`)
applying the EXACT migration policy DDL. Not production-live certification.
- **Parent/`client_id` tables (7/7)** — pattern on `pos_orders`: A reads only A; A cannot
  INSERT/UPDATE/DELETE B; A full CRUD on own; B symmetric; anon SELECT & INSERT denied;
  service_role full. Harness `bug019_cert/iso_{prelude,cert}.sql`.
- **Child parent-join tables (9/9)** — EXACT §7b policies on
  `pos_purchase_orders`→`pos_purchase_order_items`: A reads/writes own child; **B cannot read A's
  child; B cannot INSERT a child under A's parent (WITH CHECK); B cannot UPDATE/DELETE A's child
  (0 rows); B cannot MOVE its child under A's parent**; A unaffected; anon denied; service_role
  full. Harness `bug019_cert/iso_child_{prelude,cert}.sql`.
Staging already runs the strict migration (read-only complementary evidence).

## Residual risks
1. **RESOLVED — ownership gate, FAIL-CLOSED (commits c602f29 → this closure):** voice/coach read
   `wansoft_daily`/`wansoft_waiter_categories` (AMALAY-legacy, NO `client_id`; multiple tenants live).
   Gate (`lib/wansoft-owner.ts`): requires valid `withPOSAuth` + server-resolved `auth.clientId` +
   **exact** match to `WANSOFT_LEGACY_CLIENT_ID` + **default deny with NO fallback** (missing/blank var →
   deny ALL, incl. AMALAY). Not `data_source`, not any browser value. Runs BEFORE the service-role
   key/query. Non-owner → `403 feature_unavailable`, no data, no owner/record disclosure; no-auth → 401.
   Migrating voice/coach to tenant-scoped `pos_orders` is deferred (separate product work). UI hiding for
   non-owner tenants is a UX task (defense-in-depth, not the control — the 403 is).
2. **RESOLVED — child tables tenant-scoped (§7b):** `pos_purchase_order_items`,
   `pos_sub_recipe_ingredients` now enforce tenant access via the parent (SELECT/INSERT/UPDATE/DELETE,
   USING+WITH CHECK). Cross-tenant read/insert/update/delete/move blocked (9/9 isolation cert).
3. Non-blocking: survey opaque token (F), Bridge E2 physical dedup, floor QR badge (C), voice/coach
   UI hiding for non-owner tenants.

## Expected user/restaurant impact
None for legitimate authenticated same-tenant use (POS/dashboard/public flows unchanged). Post-RLS,
anonymous callers lose all tenant DB access (intended). voice/coach now require login.

## State
PROD untouched. STRICT PROD RLS: NOT APPLIED. All security residuals closed; no product decision
blocks the gate. **READY for the founder-approved production activation.** Set
`WANSOFT_LEGACY_CLIENT_ID=amalay` in the prod app env before/at deploy.
