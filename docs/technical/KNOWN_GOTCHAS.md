# Known Gotchas — Fullsite Foundation v1

> Source of truth for known issues with workarounds.  
> Rule: if you hit an unexpected behavior, check here first.  
> Discovered issues go here; fixed issues stay here with status = FIXED.

---

## G-001 — SSR fallback hardcodes 'amalay'

**File:** `src/lib/pos-config.ts:28`  
**Status:** KNOWN · NOT FIXED  
**Impact:** Low — visual flicker on initial POS load for non-AMALAY tenants. No data corruption.

```typescript
// During SSR, window is undefined → falls back to 'amalay' before client hydrates
typeof window === 'undefined' ? 'amalay' : _cid()
```

**Workaround:** The client-side hydration overwrites the fallback immediately. VANTARA sees the correct config after hydration. No incorrect data is served.  
**Fix:** Initialize `client_id` from the server-side session instead of checking `window`.

---

## G-002 — {public} RLS policies override authenticated isolation

**File:** Supabase RLS  
**Status:** FIXED · SKEL-04 · 2026-07-29  
**Impact:** Was CRITICAL — authenticated users could read all tenants' data on 5 tables.

PostgreSQL OR-combines policies per role. `{public}` includes `{authenticated}`. A `CREATE POLICY ... TO public USING (true)` on a tenant table defeats all `{authenticated}` USING clauses.

**Fix applied:** All public SELECT policies on tenant tables were dropped and recreated as `TO anon`. Verified via `pg_policies` query.

**Prevention:** Never use `TO public` (or omit the role, which defaults to public) on a table that has `client_id`.

---

## G-003 — AI Coach and Inventory Predictor read wansoft_daily only

**Files:** `src/app/api/coach/route.ts`, `src/app/api/inventory/predict/route.ts`  
**Status:** KNOWN · NOT FIXED  
**Impact:** Medium — these API routes return empty or error for clients with `data_source='fullsite'`.

**Workaround:** Not usable for VANTARA or NÓMADA. Dashboard falls back to `pos_orders` for basic KPIs, but AI features do not.  
**Fix:** Add fallback path: if `wansoft_daily` is empty for the client, aggregate from `pos_orders`.

---

## G-004 — tarjetas-regalo defaults client_id to 'amalay'

**File:** `src/app/admin/tarjetas-regalo/page.tsx:23`  
**Status:** KNOWN · NOT FIXED  
**Impact:** Low — bug only activates if gift card is created from the UI without changing the initial state.

```typescript
const empty = { ..., client_id: 'amalay' }  // initial form state
```

**Workaround:** Gift card feature should not be used in sandbox without fixing the initial state.  
**Fix:** Replace hardcoded initial client_id with `_cid()`.

---

## G-005 — Health API fails for fullsite data_source clients

**File:** `src/app/api/health/route.ts:16,32`  
**Status:** KNOWN · NOT FIXED  
**Impact:** Low — `/api/health` returns error for non-AMALAY clients. Does not affect app functionality.

The health check queries `wansoft_daily` which is empty for clients with `data_source='fullsite'`. Returns a false negative.

**Workaround:** Ignore health check failures for sandbox clients. The actual app works correctly.  
**Fix:** Health check should branch on `data_source`.

---

## G-006 — anon key allows cross-tenant reads at DB level

**Status:** KNOWN · ACCEPTED · ADR-003  
**Impact:** Medium — mitigated by app-layer filtering.

The anon role has `USING(true)` on all tenant tables for POS terminal compatibility. A raw PostgREST call with the anon key and no `client_id` filter returns all rows.

**Mitigation:** The anon key is not distributed to end users. All app queries include `?client_id=eq.<id>`. The authenticated role has real client_id filtering via SKEL-04.  
**Pre-Client-#10 fix:** Per-tenant anon key, service-role-per-tenant, or Supabase branching.

---

## G-007 — Python 3.11 macOS urlopen SSL verification fails

**File:** `scripts/sql/sandbox/onboard_client.py`  
**Status:** FIXED · 2026-07-29  

macOS Python 3.11 does not use the system CA bundle for `urllib.request.urlopen`. SSL verification fails for any HTTPS call including Supabase.

**Fix applied:**
```python
import ssl
_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE
# pass context=_SSL_CTX to every urlopen call
```

---

## G-008 — auth.users has no named unique constraint on email

**File:** Supabase auth schema  
**Status:** KNOWN · DESIGN  

`auth.users.email` is unique via an unnamed index, not a named constraint. `INSERT ... ON CONFLICT (email)` raises `42P10`. Must use a `DO` block with `SELECT INTO` guard.

```sql
-- WRONG:
INSERT INTO auth.users (...) ON CONFLICT (email) DO NOTHING;

-- CORRECT:
DO $$ DECLARE v_uid UUID;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE email = 'x@y.com';
  IF v_uid IS NULL THEN INSERT INTO auth.users (...); END IF;
END $$;
```

---

## G-009 — client_users has no compound unique constraint on (user_id, client_id)

**File:** Supabase public schema  
**Status:** KNOWN · DESIGN  

Same pattern as G-008. `INSERT ... ON CONFLICT (user_id, client_id)` raises `42P10`. Use `IF NOT EXISTS` guard.

---

## G-010 — Vercel preview deployments behind SSO wall

**Status:** KNOWN · EXPECTED  
**Impact:** Preview URLs require Vercel team login. Cannot share raw preview URL with external stakeholders.

**Workaround:** Use the custom domain (`sandbox.app.fullsite.mx`) once DNS is active. Custom domains bypass Vercel SSO.

---

## G-011 — mesas (table layout) falls back to numeric grid for non-AMALAY

**File:** `src/lib/pos-data.ts:1258`  
**Status:** KNOWN · ACCEPTABLE  

```typescript
if (clientId === 'amalay') return MESAS_CONFIG  // physical floor plan
// falls through to generic numeric grid
```

**Impact:** VANTARA gets a numeric 12-table grid. Works fine for demo. Physical floor plan requires data-driven config.  
**Fix path:** Move `mesas` config to `clients.mesas` integer (already exists) + a JSON floor plan column.
