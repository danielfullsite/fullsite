# Architecture — Fullsite Platform

> **Frozen ref:** Foundation v1 · 2026-07-29  
> Update this file only via ADR (see DECISIONS.md).

---

## Multi-Tenant Model

Fullsite is a shared-infrastructure, data-partitioned multi-tenant platform. All tenant data lives in a single Supabase project (single schema). Isolation is enforced at two layers:

| Layer | Mechanism | Coverage |
|---|---|---|
| Application | `_cid()` helper → `client_id = _cid()` on every query | All reads/writes from the Next.js app |
| Database (RLS) | `auth_client_id()` PostgreSQL function → row-level security | 13 core POS tables — authenticated role only |

**Invariant:** every table that contains tenant data has a `client_id TEXT` column that is a foreign key to `clients.id`. There are no exceptions.

---

## Auth Flow

```
User logs in (email + password)
  ↓
Supabase Auth → auth.users (email unique index)
  ↓
client_users JOIN → client_id resolved
  ↓
auth_client_id() PostgreSQL function returns client_id
  ↓
RLS USING (client_id = auth_client_id()) filters all rows
```

The `client_users` table is the single source of truth for which user belongs to which tenant. `raw_user_meta_data.client_id` is a convenience field only — never authoritative.

---

## RLS — auth_client_id() Pattern

```sql
CREATE OR REPLACE FUNCTION auth_client_id()
RETURNS TEXT LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT cu.client_id FROM client_users cu
  WHERE cu.user_id = auth.uid() LIMIT 1;
$$;
```

All 13 core tables follow this policy pattern:

```sql
-- anon: POS terminal compatibility (app filters by client_id at app layer)
CREATE POLICY "anon_read" ON <table> FOR SELECT TO anon USING (true);

-- authenticated: DB-level isolation
CREATE POLICY "auth_tenant" ON <table> FOR ALL TO authenticated
  USING (client_id = auth_client_id())
  WITH CHECK (client_id = auth_client_id());
```

**Critical:** `{public}` SELECT policies override authenticated RLS via OR-combination. All public policies must be demoted to `{anon}` on tenant tables. (Bug found and fixed in SKEL-04.)

Tables covered: `pos_menu_categories`, `pos_menu_items`, `pos_modifier_groups`, `pos_modifiers`, `pos_payment_methods`, `pos_staff`, `pos_orders`, `pos_inventory`, `pos_staff_shifts`, `pos_turnos`, `pos_cierres`, `pos_cash_movements`, `pos_customers`.

---

## Supabase Projects

| Project | Ref | Purpose | Touch Rule |
|---|---|---|---|
| `fullsite-amalay` | `qjiomlvudfmzuvqvhwpk` | Production — AMALAY restaurant | **NEVER touch** |
| `fullsite-warroom-staging` | `jkcnxfbbuyyfhwfjizgw` | Sandbox — VANTARA + NÓMADA-MINI + PRUEBA-3 | Safe to modify |

Both projects share the same schema (applied from `scripts/sql/sandbox/migrations/`). The sandbox project is the reference for new client deployments.

---

## Schema Migration Files

Applied in order to any new Supabase project:

| File | Creates |
|---|---|
| `000_extensions_sandbox.sql` | pg extensions (uuid-ossp, pgcrypto) |
| `010_consolidated_core_sandbox.sql` | 75 tables — full schema with client_id FKs |
| `003_rls_policies_sandbox.sql` | Initial RLS scaffold |
| `004_functions_sandbox.sql` | 13 POS functions (activate_recipe_version, r1_save_order, etc.) |
| `008_realtime_sandbox.sql` | Realtime on pos_inventory, pos_orders, pos_staff_shifts |
| `SKEL-04` (via apply_migration) | auth_client_id() + 13 auth_tenant policies |

---

## Vercel Deployment

| Variable | Scope | Value |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | preview branch | staging project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | preview branch | staging anon key |
| `SUPABASE_SERVICE_KEY` | preview branch | staging service key |
| `NEXT_PUBLIC_APP_ENV` | preview branch | `staging` |

**Root directory:** `dashboard-app` (not repo root).  
**Build guard:** if `SANDBOX_ENV=true` and Supabase URL points to AMALAY project ref, build fails immediately.

---

## DNS

```
sandbox.app.fullsite.mx → CNAME → cname.vercel-dns.com  (Cloudflare proxy: OFF)
```

SSL is auto-provisioned by Vercel after CNAME resolves.

---

## Sandbox Tenants (Foundation v1)

| client_id | Display Name | Owner email | Role | Seed |
|---|---|---|---|---|
| `vantara` | VANTARA | owner@vantara.sandbox | dueño | Full (3 cat, 11 items, 9 mods, 4 staff) |
| `nomada-mini` | NÓMADA-MINI | owner@nomada.sandbox | dueño | Mini (2 cat, 2 items, 2 staff) |
| `prueba-3` | Prueba Tres | owner@prueba3.sandbox | dueño | Minimal (1 cat, 1 item, 1 staff) |

PRUEBA-3 was provisioned via pure SQL with no code changes — proof of provisioning reproducibility.

---

## AMALAY Production Safeguards

- `FORBIDDEN_CLIENT_IDS = {"amalay"}` in `onboard_client.py` — script refuses to run for AMALAY
- `--confirm-ref` flag must match actual Supabase project ref before any schema operation
- `SANDBOX_ENV` must be exactly `'true'` for onboard script to execute
- Dry-run mode (`--dry-run`) never connects to psql even if DATABASE_URL is set
