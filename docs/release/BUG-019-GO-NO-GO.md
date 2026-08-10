# BUG-019 — Production GO / NO-GO package (NOT executed — awaiting Daniel)

Consolidated decision package for activating strict tenant-isolation RLS in production.
**Nothing here has been run against production. Production RLS is NOT applied and NOT authorized.**

## Certification chain (all PASS)

| Layer | Result | Evidence | Commit |
|---|---|---|---|
| Full-stack LOCAL (official Supabase stack, 2 tenants, real JWT/PostgREST) | 16/16 + sweep 74/74 + 6/6 provenance + app 86/86 | `docs/release/BUG-019-FULLSTACK-LOCAL-CERT.md` | `13193cc` |
| HOSTED STAGING (`jkcnxfbbuyyfhwfjizgw`, 2 synthetic tenants, real GoTrue JWT) | PASS — isolation A/B, anon, §7b child, Voice/Coach 11/11, fail-closed, refresh+revocation, rollback→reapply | `docs/release/BUG-019-HOSTED-STAGING-CERT.md` | `233f7f0` |
| Sub-case 8 (turno ambiguity fail-closed) | app 12/12 in `bug019-turno-adoption` | this doc + `dashboard-app/src/lib/turno.ts` | (this commit) |

Hosted staging identity was verified read-only: `jkcnxfbbuyyfhwfjizgw` — **explicitly NOT prod**
`qjiomlvudfmzuvqvhwpk` (AMALAY). All DDL/DML on staging went through the `supabase-fullsite-staging`
MCP; the prod MCP (`supabase-amalay`) was never touched.

## BUG-019-C contract — coverage map

| Sub-case | Where proven |
|---|---|
| Malicious/cross-tenant `body.turno_id` ignored | app `save-order` resolves server-side; local `bug019-turno-adoption` (passthrough only for non-qr) |
| Turno resolved from the authorized server-side `client_id` | `resolveOpenTurno` uses `auth.clientId` + `pos_turnos`; DB provenance on hosted (`233f7f0`) |
| No open turno → `409 NO_OPEN_TURNO` | app test; DB CHECK on hosted (send-without-turno rejected) |
| Draft that stays `abierta` keeps `turno_id=NULL` | local DB (`11_turno_provenance` P3) + hosted service_role draft |
| Leaving `abierta` adopts the turno atomically | RPC `turno_id=COALESCE(...)` in one UPDATE; hosted staff-accept |
| Concurrency/replay exactly-once | hosted comanda exactly-once; local idempotent-replay; `ON CONFLICT DO NOTHING` |
| A sent order is never overwritten | `resolution=ignore-duplicates` (public-order); local + hosted replay |
| **Multiple eligible open turnos → fail closed** | **`resolveOpenTurno` returns `ambiguous` → `409 AMBIGUOUS_TURNO`** (no DB single-open guarantee: `pos_turnos` PK is `id` only) |

service_role is never exposed to browser/bundle/response/logs: public + server routes read the
service key inside server functions only (`NEXT_PUBLIC_*` never carries it); the hosted harness used
the anon key only; §5 revokes SECDEF funcs from anon; `bug019-service-key-routes` asserts responses
never contain the key.

## Findings to carry into the prod preflight

- **H1 (hardening).** The migration creates `service_role` *policies* but does not GRANT table DML to
  `service_role`; it relies on Supabase's ambient default (`GRANT ALL … TO service_role`). On staging
  that default was stripped and every server-mediated path failed with `permission denied` until
  restored. **Gate add:** preflight-assert `service_role` retains DML on all in-scope + trigger-touched
  tables (e.g. `pos_cierres`); optionally make the migration self-sufficient by granting DML explicitly.
  Does not change the isolation result.
- **G1 (scope note, accepted).** The staging `service_role` key is not exposed via MCP (+ no-curl), so
  the app HTTP layer (`/api/public/qr-order`, `/api/voice`, `/api/coach`, 503-without-service-key) was
  not re-run over hosted staging. Per Daniel's decision, the **local HTTP cert (8/8)** is accepted as
  covering the unchanged app code; the sub-case-8 change is covered by local vitest (86/86). To fully
  close over hosted, provide the staging `service_role` key and re-run the app-route battery.

## Deployment (execute ONLY per `BUG-019-PROD-RLS-GATE.md`, with these additions)

1. Preflight canonical read: `clients.id='amalay'` + `client_users` rows for `amalay` (unchanged).
2. **Preflight H1:** assert `service_role` DML grants on in-scope + trigger-touched tables.
3. Env: `WANSOFT_LEGACY_CLIENT_ID=amalay` (no fallback) + `SUPABASE_SERVICE_KEY`.
4. Deploy app build (this branch) → smoke → apply `BUG-019-tenant-rls-fix.sql` → two-tenant + child
   isolation checks → post-RLS smoke.
5. Emergency: `BUG-019-ROLLBACK.sql` (fail-closed; never reopens anon). Snapshot in `rollback-snapshots/`.

## Decision

**GO/NO-GO is Daniel's.** Do NOT activate production RLS or deploy to production without explicit
authorization. AMALAY, Bridge, Offline, and `release/offline-field-2026-08-06` are out of scope and
untouched.
