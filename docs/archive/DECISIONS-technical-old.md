# Architecture Decision Records — Fullsite Foundation v1

> **Rule:** append only. Never edit a past decision — add a new one that supersedes it.  
> Format: ID · Date · Status · Decision · Rationale · Consequences

---

## ADR-001 — Shared schema, data-partitioned multi-tenancy

**Date:** 2026-07-24  
**Status:** ACTIVE

**Decision:** All tenants share one Supabase project and one PostgreSQL schema. Isolation is enforced via `client_id` column on every tenant table + RLS.

**Rationale:** Separate Supabase projects per tenant would cost $25/mo each at minimum. At 10 restaurants that's $250/mo in infrastructure before writing a line of code. Shared schema costs ~$0 incremental per tenant at current scale. We can migrate to schema-per-tenant or DB-per-tenant later if RLS performance becomes an issue.

**Consequences:**
- Every table that holds tenant data MUST have `client_id TEXT NOT NULL REFERENCES clients(id)`.
- A misconfigured RLS policy exposes all tenant data simultaneously. Mitigation: SKEL-04 + app-layer filter.
- Supabase backup/restore affects all tenants at once.

---

## ADR-002 — auth_client_id() function for RLS

**Date:** 2026-07-29  
**Status:** ACTIVE

**Decision:** Use a `SECURITY DEFINER` helper function `auth_client_id()` in all RLS policies instead of inlining the subquery.

**Rationale:** Inlining `(SELECT cu.client_id FROM client_users cu WHERE cu.user_id = auth.uid() LIMIT 1)` in every policy is error-prone and hard to change atomically. A single function call is auditable, easier to update, and the planner can cache the result per statement.

**Consequences:**
- Function must remain SECURITY DEFINER or policies break for authenticated users.
- Any change to the `client_users` schema requires reviewing this function.
- `SET search_path = public` is required to prevent search_path injection.

---

## ADR-003 — anon policies preserved for POS terminal compatibility

**Date:** 2026-07-29  
**Status:** ACTIVE

**Decision:** anon role policies keep `USING(true)` on all POS tables. Only `authenticated` role gets client_id filtering.

**Rationale:** The POS tablet/terminal accesses Supabase via the anon key in some flows. Requiring auth token for every POS operation would break the current architecture. Accepted risk: anon key + direct REST access could read cross-tenant data. Mitigation: anon key is not distributed to end users; all POS queries include `?client_id=eq.<id>` at the application layer.

**Consequences:**
- Before Client #10, consider service-role-per-tenant or per-tenant anon key via Supabase branching.
- Document in KNOWN_GOTCHAS.md.

---

## ADR-004 — {public} SELECT policies must be demoted to {anon}

**Date:** 2026-07-29  
**Status:** ACTIVE

**Decision:** PostgreSQL `{public}` role SELECT policies on tenant tables must never exist. They override `authenticated` RLS because policies are OR'd per role, and `{public}` includes `authenticated`.

**Rationale:** Bug found during SKEL-04: 5 tables had `CREATE POLICY ... TO public USING (true)`. An authenticated VANTARA user querying those tables via PostgREST would receive all rows (including NÓMADA data) because the public policy matched first and returned `true`. Fixed by dropping public policies and recreating them as `TO anon`.

**Consequences:**
- CI gate needed: `SELECT * FROM pg_policies WHERE schemaname='public' AND roles @> '{public}' AND tablename IN (<tenant_tables>)` must return 0 rows.
- Review every new migration before applying.

---

## ADR-005 — Sandbox uses a separate Supabase project, never a branch

**Date:** 2026-07-24  
**Status:** ACTIVE

**Decision:** Sandbox environment runs on `fullsite-warroom-staging` (ref `jkcnxfbbuyyfhwfjizgw`), a completely separate Supabase project. Not a Supabase branch of production.

**Rationale:** Supabase branches share the same project and billing tier. A schema error in a branch can pause the parent project. A separate project provides hard isolation — a migration failure in staging cannot affect AMALAY production in any way.

**Consequences:**
- Schema changes must be applied to staging first, validated, then applied to production separately.
- Credentials are different per project — no credential reuse.
- AMALAY production ref `qjiomlvudfmzuvqvhwpk` is in `FORBIDDEN_CLIENT_IDS` and in all tooling guards.

---

## ADR-006 — Provisioning is pure SQL, no code changes required

**Date:** 2026-07-29  
**Status:** ACTIVE

**Decision:** Adding a new restaurant client requires only SQL DML (`INSERT` into `clients`, `auth.users`, `client_users`, and seed tables). Zero code changes. Zero new migrations.

**Rationale:** If adding a client requires a code change, the system is not a platform — it's a bespoke installation. PRUEBA-3 was provisioned in ~5 min with 20 SQL statements, confirming the invariant holds.

**Consequences:**
- Any feature that breaks provisioning-by-SQL is a regression.
- Configuration that differs per client must live in `clients` columns, not in code.
- The `onboard_client.py` script is the reference implementation for SQL-only provisioning.

---

## ADR-007 — Build-time guard rejects AMALAY URL when SANDBOX_ENV=true

**Date:** 2026-07-24  
**Status:** ACTIVE

**Decision:** `dashboard-app/src/lib/sandbox-guard.ts` runs at Next.js build time. If `SANDBOX_ENV=true` and `NEXT_PUBLIC_SUPABASE_URL` contains the AMALAY project ref, the build fails with a descriptive error.

**Rationale:** The most dangerous failure mode is deploying sandbox code against AMALAY production. A build-time guard is zero-cost and catches the error before deployment, not after.

**Consequences:**
- Sandbox deployments must explicitly set `SANDBOX_ENV=true`.
- The guard is the last line of defense — RLS and FORBIDDEN_CLIENT_IDS are defense-in-depth.
