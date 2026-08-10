# BUG-019 — HOSTED STAGING CERTIFICATION (evidence + go/no-go)

**Result: PASS.** Full BUG-019 tenant-isolation migration certified on a **real hosted Supabase
project** (Postgres + GoTrue + PostgREST + real network), with two synthetic tenants and real JWT
sign-in. **Production RLS is NOT applied and NOT authorized.** This closes the hosted-staging gate
that followed the full-stack **local** cert (`d155a35`).

## Environment (identified, no secrets)
- **Staging project:** `jkcnxfbbuyyfhwfjizgw` — `https://jkcnxfbbuyyfhwfjizgw.supabase.co`
  (verified `current_database()=postgres`; **explicitly NOT prod** `qjiomlvudfmzuvqvhwpk`).
- All DDL/DML via the `supabase-fullsite-staging` MCP only; prod MCP (`supabase-amalay`) never touched.
- Two synthetic tenants `stg_a` / `stg_b`; two synthetic GoTrue users `user_a@stg.local` /
  `user_b@stg.local` (bcrypt via pgcrypto) mapped in `client_users`. **No AMALAY data/PII/secrets.**
- Migrations applied (see `list_migrations`): `bug019_stg_phaseA_inscope_schema`,
  `bug019_stg_phaseA2_batchE_and_comanda_batches`, **`bug019_tenant_rls_fix_exact`**,
  `bug019_rollback_failclosed_lockdown`, `bug019_tenant_rls_fix_reapply`.
- Real-JWT harness: `@supabase/supabase-js` 2.112.2 on Node 24 (Node `fetch`, no curl).

## In-scope equivalence vs prod
Compared staging in-scope columns against the prod-authoritative catalog snapshot
(`scratchpad/bug019_fullstack/schema.sql`, already `diffs=0` vs prod). **Isolation-critical structure
matches**: `client_id` present + `text` on every tenant table; child→parent link columns
(`pos_purchase_order_items.order_id→pos_purchase_orders`, `pos_sub_recipe_ingredients.sub_recipe_id→pos_sub_recipes`);
`pos_orders.id`/`turno_id`/`status` types; `comanda_batches` present after fix.

### Drift registered (and how handled)
| Object | Staging drift | Handling |
|---|---|---|
| `pos_mesas`, `wansoft_data` | absent | created to exact prod shape (+ BATCH A token cols) |
| `pos_orders.comanda_batches` | missing | added (prod has it) |
| `pos_print_jobs` BATCH E cols + `pos_print_jobs_comanda_intent` idx | missing | applied exact BATCH E migration |
| `pos_orders` turno constraint | none + 6 synthetic null-turno rows | backfilled synthetic rows, set prod baseline `turno_id NOT NULL`, then migration §1b transitioned to C2 |
| child tables | stale permissive `{anon,authenticated}` policies (`poi_*`, `rls_sri_*`) | migration `_drop_all_policies` removed them; verified 0 survive |
| `service_role` DML grants | **missing on ~7/9 in-scope tables** (had only REFERENCES/TRIGGER/TRUNCATE) | restored to mirror prod Supabase default (`GRANT ALL … TO service_role`) — see **Finding H1** |
| `clients` | extra `pos_write_authority`; missing `plan/pos_settings/support_email` | out-of-scope (migration special-cases `clients`) — noted only |
| `pos_menu_items.recipe_ref` | missing | out-of-scope (scoped by `client_id`) — noted only |

## Test results (all PASS)

**DB-level on hosted Postgres** (RLS enforced via `SET ROLE` + `request.jwt.claims`):
- **AUTH-A (13/13):** reads only `stg_a`; insert own ok; cross-tenant insert **denied** (RLS
  violation), cross-tenant update/delete **0 rows**; **authenticated cannot forge a QR turno-null
  order even with a `qr-` id** (WITH CHECK `turno_id NOT NULL`); child read isolated; child insert
  under B's parent **denied**; child **MOVE** to B's parent **denied**; `wansoft_data` isolated.
- **AUTH-B:** symmetric — sees only `stg_b`, not `stg_a` nor its child.
- **ANON (4/4):** select / insert / `wansoft_data` / child all **denied** (revoked grants + no policy).
- **SERVICE_ROLE (7/7):** sees all tenants; creates the QR **turno-null `abierta` `qr-` draft**
  (server-owned provenance); **no print-job side effect** on the draft; staff-accept assigns turno;
  **exactly-once** comanda print (identical `(order_id,station,comanda_batch_id,reprint_seq)`
  rejected; `reprint_seq=1` audited reprint allowed).
- **Rollback (fail-closed):** after `BUG-019-ROLLBACK.sql` — 0 authenticated + 0 anon policies
  in-scope; authenticated A denied read/insert/child/wansoft; anon denied; **service_role retained**.
- **Reapply (reproducible):** re-running the exact migration restores identical isolation
  (A sees own, B denied, cross-insert denied, turno = C2, 0 anon).

**Real-JWT over the network** (`supabase-js`, real GoTrue login, anon key only):
- Login A/B issue real `authenticated` JWTs; over PostgREST **A sees only `stg_a`, B only `stg_b`**.
- **anon** (no session) → `permission denied for table pos_orders`.
- **Refresh (still a member):** fresh token issued, role still `authenticated` (**no silent anon
  fallback**), still tenant-scoped.
- **Membership revocation:** after deleting A's `client_users` row, a **freshly refreshed** valid
  `authenticated` token returns **0 rows immediately** (no stale access, no anon downgrade).

**Ownership gate (voice/coach):** `bug019-wansoft-owner.test.ts` **11/11** with
`WANSOFT_LEGACY_CLIENT_ID=amalay` — exact-owner allowed, non-owner denied, **fail-closed with no env
(deny all)**, not `data_source`, not any browser value. `wansoft_data` tenant-isolation additionally
proven at DB level above. **`WANSOFT_LEGACY_CLIENT_ID=amalay` validated with synthetic data only;
NOT configured in production.**

## Findings for the production go/no-go

**H1 (hardening, from hosted staging) — verify `service_role` grants in prod preflight.**
The migration creates `service_role` *policies* but does **not GRANT** table DML to `service_role`;
it relies on the Supabase ambient default (`GRANT ALL ON ALL TABLES … TO service_role`). On staging
that default had been stripped, so **every server-mediated path failed with `permission denied`**
until grants were restored. Prod created normally has the default, but this is a silent
single-point-of-failure. **Add to the gate:** preflight-assert `service_role` retains DML on all
in-scope tables (and trigger-touched tables e.g. `pos_cierres`); optionally make the migration
self-sufficient by granting DML to `service_role` explicitly. Does not change the isolation result.

**G1 (gap) — service-key-gated HTTP routes not re-run over hosted staging.** The staging
`service_role` key is not exposed by MCP and was not extracted (no-curl policy). So the app HTTP
layer for `/api/voice`, `/api/coach`, `/api/public/qr-order`, `/api/public/menu` and the
**fail-closed 503 without service key** were **not** re-exercised over hosted staging. Their DB
behaviors are proven here on hosted infra, and the HTTP layer passed **8/8 in the full-stack local
cert**. To fully close over hosted staging, provide the staging `service_role` key and re-run the
app-route battery; otherwise accept the local HTTP cert as covering the unchanged app code.

## Production decision package (NOT executed — awaiting Daniel)
Deploy strictly per `docs/release/BUG-019-PROD-RLS-GATE.md`, with these additions:
1. Preflight canonical read: `clients.id='amalay'` + `client_users` rows for `amalay` (unchanged).
2. **Preflight H1:** assert `service_role` DML grants on in-scope + trigger-touched tables.
3. Env: `WANSOFT_LEGACY_CLIENT_ID=amalay` (no fallback) + `SUPABASE_SERVICE_KEY`.
4. Deploy app build (this branch) → smoke → apply `BUG-019-tenant-rls-fix.sql` → two-tenant + child
   isolation checks → post-RLS smoke. Emergency: `BUG-019-ROLLBACK.sql` (fail-closed, never reopens anon).
5. **Do NOT execute any of this without explicit Daniel authorization.**
