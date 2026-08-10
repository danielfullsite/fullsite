# BUG-019 — Full-stack LOCAL certification (evidence)

Tenant isolation + the narrowest QR-draft turno exception, verified end-to-end on the
**official local Supabase stack** (real Postgres + GoTrue JWT + PostgREST RLS) with **two
tenants**, applying the real migration `docs/release/BUG-019-tenant-rls-fix.sql` unmodified.

**Boundary:** LOCAL only. Hosted staging is still required before production. This does NOT
certify strict RLS live in prod (that is the founder-approved gate in `BUG-019-PROD-RLS-GATE.md`).

## Layers of evidence

1. **Ephemeral PG harness** (offline, no Docker) — `scripts/tenant-isolation/local/`
   - `run_local.sh`: behavioral isolation (A/B/anon/service_role, child-via-parent, audit
     immutable) + **6 turno-provenance cases** (`11_turno_provenance.sql`) → all PASS.
   - `run_sweep.sh`: structural sweep of **74/74** `client_id` tables from the real schema
     (`gen_schema_stub.py`, `pos_orders` special-cased for the §1b CHECK) → 74/74 isolated.
2. **Official local Supabase stack** — `scripts/tenant-isolation/local/official-stack/`
   - `run_official.sh` → `real_schema.sql` + real GoTrue users + real migration + `assert.mjs`.
   - Exercises the policies through **real JWTs and PostgREST** (not psql role simulation).
3. **App layer** — `dashboard-app` vitest, 82/82 across the `bug019-*` suite (real handlers,
   only the network boundary mocked): server-mediated public order (#8, no kitchen side
   effects, idempotent), Voice/Coach ownership gate (#7, 403 for non-owner), and
   **turno adoption** (`bug019-turno-adoption`, #10): a QR draft's turno is resolved
   server-side from the caller's session, never trusted from the client; send-without-turno
   → 409; idempotent replay does not re-fire effects.

## Official-stack suite result (16/16 PASS)

| # | Check | Result |
|---|---|---|
| 01 | A sees only its 2 orders | PASS |
| 02 | A cross-tenant read = 0 | PASS |
| 03 | A cross-tenant INSERT denied | PASS (403) |
| 04a | Child (§7b) A sees only own | PASS |
| 04b | A cannot insert child under B's parent | PASS (403) |
| 05 | anon has no tenant DB access | PASS (401) |
| 06 | service_role sees all 4 | PASS |
| 09a | Normal order, NULL turno → rejected (CHECK) | PASS (400) |
| 09b | Forged QR provenance by authenticated → rejected (RLS) | PASS (403) |
| 09c | Authentic QR draft (abierta, NULL turno) by service_role → allowed | PASS (201) |
| 10a | Send/charge without turno → rejected (CHECK) | PASS (400) |
| 10b | Acceptance assigns turno + transitions atomically | PASS (200) |
| 11 | Replay same submission → no duplicate, no overwrite | PASS |
| 12a | Legacy §7a `wansoft_daily` authenticated read-only | PASS |
| 12b | anon `wansoft_daily` denied | PASS (401) |
| 12c | authenticated INSERT `wansoft_daily` denied | PASS (403) |

Checks #7 (Voice/Coach gate) and #8 (QR server-mediated, no side effects) are app-layer and
certified by the vitest suite above (no Next server runs on the DB-only stack).

## The QR-draft turno exception (BUG-019-C)

- Migration §1b (`d155a35`): `pos_orders_turno_id_check = turno_id IS NOT NULL OR (status =
  'abierta' AND id LIKE 'qr-%')`. Normal orders still reject NULL; any transition out of
  `abierta` requires a valid turno. The authenticated INSERT/UPDATE policies additionally
  require `turno_id IS NOT NULL` → an authenticated client can never persist a turno-null row,
  even forging a `qr-` id. Only service_role (the server endpoint) writes the draft.
- App `save-order` (`c7ebb7d`): for a `qr-` order transitioning out of `abierta`, the server
  resolves the caller's OPEN turno (`pos_turnos`, preferring the one they opened) and assigns
  it atomically in the same save; refuses with `NO_OPEN_TURNO` if none. A still-`abierta` draft
  edit keeps turno NULL. Normal orders are unchanged.

## Reproduce

```bash
# 1) ephemeral (offline)
scripts/tenant-isolation/local/run_local.sh && scripts/tenant-isolation/local/run_sweep.sh
# 2) official stack (needs a running supabase on free ports)
SUPABASE_DIR=<supabase project dir> bash scripts/tenant-isolation/local/official-stack/run_official.sh
# 3) app layer
cd dashboard-app && npx vitest run src/__tests__/bug019-*.test.ts
```

**State:** BUG-019 FULL-STACK LOCAL CERTIFICATION COMPLETE — HOSTED STAGING STILL REQUIRED BEFORE PRODUCTION.
