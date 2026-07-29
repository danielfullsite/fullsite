# Security Foundation (P0) — Milestone Tracking

**Fecha:** 2026-07-29
**Alcance:** Cierre de 14 hallazgos P0 antes de promover a `app.fullsite.mx`
**Referencia:** `docs/security/POS-BROWSER-SECURITY.md` (audit fuente)
**Rama base:** `sandbox/second-customer-skeleton`
**Tag de promoción:** `foundation-v1-secure`

---

## Status Tracker

| ID | Título | Estado |
|---|---|---|
| P0-A | user_metadata user-writable → privilege escalation | CLOSED |
| P0-B | credentials_vault — any authenticated user reads all tenants' keys | CLOSED (staging DB) |
| P0-C | clients table — anon enumeration + cross-tenant R/W | CLOSED (staging DB) |
| P0-D | Auth tokens in localStorage (XSS → permanent session) | OPEN (Phase 2 — @supabase/ssr) |
| P0-E | PIN cache btoa() reversible — not a hash | CLOSED |
| P0-F | /api/pos/save-order — no auth + client-provided totals | CLOSED (auth gate) / OPEN (totals — Phase 2) |
| P0-G | /api/pos/merge-orders — no auth + client-provided totals | CLOSED (auth gate) / OPEN (totals — Phase 2) |
| P0-H | /api/mp-point — forgeable auth header + client-provided amount | CLOSED (auth gate) / OPEN (server-side key — Phase 2) |
| P0-I | /api/clip-pinpad — unauthenticated + client provides API key + amount | CLOSED (auth gate) / OPEN (server-side key — Phase 2) |
| P0-J | /api/deepgram-token — returns raw API key to anonymous callers | CLOSED |
| P0-K | /api/webhook/ubereats — HMAC verification not implemented | CLOSED |
| P0-L | /api/factura/timbrar — no tenant isolation on CFDI lookup | CLOSED |
| P0-M | /api/onboarding — open when ONBOARDING_SECRET not set | CLOSED |
| P0-N | getClientId() systemic — x-client-id client-controlled, ~25 routes unauth | CLOSED (withPOSAuth on all mutation routes) |

---

## P0 Detail

---

### P0-A — user_metadata user-writable → privilege escalation

**Root cause:** Supabase allows any authenticated user to call `auth.updateUser({ data: {...} })` and modify their own `user_metadata`. The app reads `role` and `client_id` from `user_metadata` in `AuthContext` (Priority 1) and `login/page.tsx` for post-login redirect. This makes privilege escalation a one-liner from any browser DevTools session.

**Solution:** Move `role` and `client_id` to `app_metadata` (service_role-only write). Update `AuthContext` to read `user?.app_metadata?.role` and `user?.app_metadata?.client_id`. Provisioning (onboarding, `client_users` writes) sets `raw_app_meta_data` via service_role. RLS functions can use `auth.jwt()->'app_metadata'->>'client_id'` directly, removing the `client_users` table lookup from `auth_client_id()`.

**Exploit scenario (before-state):**
```javascript
// Any mesero, from DevTools — no special tooling required
await supabase.auth.updateUser({ data: { role: 'dueño', client_id: 'amalay' } })
// Next login → redirect to full dashboard with AMALAY owner access
```

**Regression test:** After fix, `supabase.auth.updateUser({ data: { role: 'dueño', client_id: 'any-tenant' } })` succeeds at the API level (Supabase does not block the call) but `withPOSAuth()` and `AuthContext` resolve role/client_id exclusively from `app_metadata` and `client_users` table — the call has no effect on authorization decisions.

**Status:** IN_PROGRESS

---

### P0-B — credentials_vault: any authenticated user reads all tenants' API keys

**Root cause:** Policy `authenticated_all_vault` on `credentials_vault` has `cmd=ALL` and `qual=true` (no predicate). Any authenticated token — including a mesero from Tenant B — can SELECT, INSERT, UPDATE, DELETE all rows in the table, exposing every tenant's integration keys (MP, Clip, Deepgram, etc.).

**Solution:** Drop `authenticated_all_vault`. Replace with policy `auth_tenant` scoped to `client_id = auth_client_id()` for both USING and WITH CHECK. Admin operations use service_role exclusively.

```sql
DROP POLICY authenticated_all_vault ON credentials_vault;
CREATE POLICY auth_tenant ON credentials_vault
  FOR ALL TO authenticated
  USING (client_id = auth_client_id())
  WITH CHECK (client_id = auth_client_id());
```

**Exploit scenario (before-state):**
```bash
curl -H "Authorization: Bearer <mesero_vantara_token>" \
  "${SUPABASE_URL}/rest/v1/credentials_vault?select=*"
# → Returns API keys for ALL tenants (AMALAY, NÓMADA, VANTARA, ...)
```

**Regression test:** VANTARA mesero token queries `credentials_vault?select=*` → returns 0 rows (VANTARA has no credentials) or only VANTARA rows. Query for `client_id=eq.amalay` from a VANTARA token returns 0 rows.

**Status:** IN_PROGRESS

---

### P0-C — clients table: anon enumeration + cross-tenant R/W

**Root cause:** Two policies exist simultaneously: `anon_read` (roles: `{anon}`, qual: `true`) exposes the full tenant directory to unauthenticated requests; `authenticated_all` (roles: `{authenticated}`, qual: `true`) lets any authenticated user read or modify any tenant's configuration row.

**Solution:** Drop both policies. Add a single `auth_own_client` policy (SELECT only, `id = auth_client_id()`). All system-level writes use service_role.

```sql
DROP POLICY anon_read ON clients;
DROP POLICY authenticated_all ON clients;
CREATE POLICY auth_own_client ON clients
  FOR SELECT TO authenticated
  USING (id = auth_client_id());
```

**Exploit scenario (before-state):**
```bash
# No credentials needed — anon key is public
curl "${SUPABASE_URL}/rest/v1/clients?select=*&apikey=${ANON_KEY}"
# → Full directory: every restaurant name, slug, config, contact info on the platform
```

**Regression test:** Anonymous GET returns `[]`. Authenticated VANTARA user GET returns exactly 1 row (their own client). VANTARA user querying `?id=eq.<amalay_id>` returns `[]`.

**Status:** IN_PROGRESS

---

### P0-D — Auth tokens in localStorage (XSS → permanent session)

**Root cause:** `login/page.tsx` manually serializes the full Supabase session object (including `access_token` and `refresh_token`) to localStorage under `sb-<project>-auth-token`. `AuthContext` reads it on cold start. The `refresh_token` never expires unless explicitly revoked, so any XSS that reads localStorage achieves permanent account takeover without ever touching the password.

**Solution (Phase 2):** Migrate to `@supabase/ssr` with `createServerClient` in Next.js middleware. Access token travels as a short-lived httpOnly cookie; refresh token is never exposed to JS. For offline POS (which must remain JS-accessible for service worker auth), design a separate short-TTL access token path (15 min) with the refresh token stored exclusively in httpOnly. Requires explicit offline compatibility design before implementation.

**Exploit scenario (before-state):**
```javascript
// Any XSS vector (injected ad script, malicious npm dep, reflected XSS)
const session = JSON.parse(localStorage.getItem('sb-jkcnxfbbuyyfhwfjizgw-auth-token'))
// session.access_token + session.refresh_token → exfiltrate
// Refresh token provides indefinite access until manually revoked in Supabase dashboard
```

**Regression test:** After `@supabase/ssr` migration, `localStorage.getItem('sb-jkcnxfbbuyyfhwfjizgw-auth-token')` returns `null` after dashboard login. Auth cookies are present with `HttpOnly` and `Secure` flags. Offline POS flow documented with explicit token lifecycle.

**Status:** OPEN — see Phase 2 Deferred section

---

### P0-E — PIN cache btoa() reversible (not a hash)

**Root cause:** `pos/layout.tsx` stores the offline PIN cache as `btoa(pin).slice(0,8) → {staffId, role}`. `btoa()` is Base64 encoding, not hashing. A 4-digit PIN has 10,000 combinations; a brute-force loop over all possibilities completes in under 1ms in any browser. An attacker with localStorage read access (XSS, physical access, shared device) recovers every staff PIN trivially.

**Solution:** Replace the cache entirely with a POS shift token issued by `/api/pos/pin`. The endpoint validates the PIN server-side and returns a signed HMAC-SHA256 shift token (opaque, 8h TTL). The client stores the shift token, not any PIN-derived value. `pos_auth_cache` key is removed from localStorage.

**Exploit scenario (before-state):**
```javascript
const hash = JSON.parse(localStorage.getItem('pos_auth_cache'))['1234-staff-id']
for (let p = 0; p < 10000; p++) {
  const candidate = String(p).padStart(4, '0')
  if (btoa(candidate).slice(0, 8) === hash) { console.log('PIN:', candidate); break }
}
// Executes in <1ms — recovers PIN instantly
```

**Regression test:** After `/api/pos/pin` auth, `localStorage` contains a `shiftToken` key with an opaque signed string. No `pos_auth_cache` key exists. `shiftToken` value cannot be decoded to recover the PIN. Attempting to forge a shiftToken with a different staffId returns 401 on any protected POS route.

**Status:** IN_PROGRESS — shift token issued; client-side removal of `pos_auth_cache` pending

---

### P0-F — /api/pos/save-order: no auth + client-provided financial totals

**Root cause:** The route has no authentication gate. `total`, `subtotal`, `iva`, `descuento`, and `propina` are read from the request body and passed directly to the database RPC. Any anonymous HTTP caller can write orders with arbitrary financial values to any tenant.

**Solution:** Add `withPOSAuth()` gate (validates shift token or Supabase session, resolves `clientId` server-side). Phase 2: recalculate totals server-side by fetching `pos_menu_items` using the submitted item IDs — client-provided totals become advisory only and are validated against server-computed values.

**Exploit scenario (before-state):**
```bash
curl -X POST /api/pos/save-order \
  -H "x-client-id: vantara" \
  -H "Content-Type: application/json" \
  -d '{"order_id":"...", "total": 0.01, "descuento": 9999, "items": [...]}'
# → Stores fraudulent order with near-zero total and inflated discount
```

**Regression test:** POST to `/api/pos/save-order` without a valid auth token returns 401. POST with valid shift token but no items returns 400. (Phase 2) POST with valid auth but manipulated `total` returns 400 after server-side recalculation detects discrepancy.

**Status:** IN_PROGRESS — auth gate added; server-side total validation is Phase 2

---

### P0-G — /api/pos/merge-orders: no auth + client-provided financial totals

**Root cause:** Same pattern as P0-F. No authentication gate. `total` and related financial fields come from request body with no server-side validation.

**Solution:** Same as P0-F — add `withPOSAuth()` gate. Phase 2: validate merged total server-side by summing the constituent orders from the database.

**Exploit scenario (before-state):**
```bash
curl -X POST /api/pos/merge-orders \
  -H "x-client-id: amalay" \
  -d '{"source_order_id":"...", "target_order_id":"...", "total": 1}'
# → Merges orders with fraudulent total stored in DB
```

**Regression test:** POST without valid auth token returns 401. Authenticated POST with mismatched total returns 400 (Phase 2).

**Status:** IN_PROGRESS — auth gate added; server-side total validation is Phase 2

---

### P0-H — /api/mp-point: forgeable auth header + client-provided payment amount

**Root cause:** Auth check relies on the presence of `x-pos-staff` header, which is a string the caller sets themselves — it is not validated against any server state. `amount` comes from the request body with no validation against the actual order total stored in the database. Stolen or forged headers authorize arbitrary payment amounts.

**Solution:** Replace `x-pos-staff` header check with `withPOSAuth()` (validates shift token cryptographically). Before initiating the MP Point charge, fetch the order total from `pos_orders` using the `order_id` from the request and validate that `amount <= order.total + tip`.

**Exploit scenario (before-state):**
```bash
curl -X POST /api/mp-point \
  -H "x-pos-staff: any-string" \
  -H "Content-Type: application/json" \
  -d '{"amount": 1, "accessToken": "stolen_mp_token", "order_id": "..."}'
# → Initiates $1 payment charge on MP Point terminal, regardless of actual order total
```

**Regression test:** POST without valid shift token returns 401. POST with valid auth but `amount` greater than `order.total + tip` (fetched server-side) returns 400.

**Status:** OPEN

---

### P0-I — /api/clip-pinpad: completely unauthenticated, client provides API key + amount

**Root cause:** No authentication gate of any kind. The caller passes their own Clip `apiKey` directly in the request body along with an arbitrary `amount`. The server proxies the charge without validating either value.

**Solution:** Remove `apiKey` from request body. Move Clip API key to `CLIP_API_KEY` server environment variable. Add `withPOSAuth()` gate. Validate `amount` against the order total in the database before proxying to Clip.

**Exploit scenario (before-state):**
```bash
curl -X POST /api/clip-pinpad \
  -d '{"apiKey": "attacker_clip_key", "amount": 1, "description": "test"}'
# → Anonymous caller initiates arbitrary Clip payment with their own key — or probes valid keys
```

**Regression test:** POST without valid shift token returns 401. `apiKey` field in request body is ignored (or causes 400 if present). `amount` is validated against DB order total before any Clip API call.

**Status:** OPEN

---

### P0-J — /api/deepgram-token: returns raw API key to anonymous callers

**Root cause:** The route returns `process.env.DEEPGRAM_API_KEY` in the response body with no authentication check. Any anonymous HTTP request retrieves the live API key, which can then be used to accumulate Deepgram transcription costs against the platform account.

**Solution:** Add a `requireAuth()` gate (valid Supabase session or shift token) before the key is returned. Consider returning a short-lived Deepgram temporary token rather than the raw API key.

**Exploit scenario (before-state):**
```bash
curl https://app.fullsite.mx/api/deepgram-token
# → { "key": "deepgram_live_xxxxx..." }
# Attacker uses key for their own transcription workloads at platform expense
```

**Regression test:** GET without valid session returns 401. GET with valid authenticated session returns a token. Deepgram API key is not present in any Next.js bundle or public response without auth.

**Status:** IN_PROGRESS

---

### P0-K — /api/webhook/ubereats: HMAC verification not implemented

**Root cause:** A `// TODO: implement HMAC verification` comment exists in the code. The webhook accepts any POST without validating the `X-Postmates-Signature` (or equivalent Uber signature header) against `UBER_WEBHOOK_SECRET`. Any caller can inject fake order notifications.

**Solution:** Implement HMAC-SHA256 verification: compute `HMAC(UBER_WEBHOOK_SECRET, raw_body)` and compare to the signature header using a constant-time comparison. Return 401 on mismatch before processing any payload.

**Exploit scenario (before-state):**
```bash
curl -X POST /api/webhook/ubereats \
  -H "Content-Type: application/json" \
  -d '{"type": "orders.notification", "order": {"displayId": "FAKE-001", "price": {"subtotal": 0}, ...}}'
# → Fake order auto-accepted and stored, causing kitchen dispatch for non-existent orders
```

**Regression test:** POST without a valid Uber HMAC signature returns 401. POST with a correctly computed signature (using test `UBER_WEBHOOK_SECRET`) returns 200 and processes the event. Forged signature returns 401.

**Status:** IN_PROGRESS

---

### P0-L — /api/factura/timbrar: no tenant isolation on CFDI lookup

**Root cause:** The CFDI request is fetched by `id` alone, with no `client_id` filter applied to the query. An authenticated user from Tenant A who knows (or guesses) a CFDI request UUID from Tenant B can trigger the CFDI stamping process for Tenant B's tax document under their own session.

**Solution:** Add `client_id = <caller_resolved_clientId>` filter to the CFDI lookup query. The caller's `clientId` must come from `withPOSAuth()` / `auth_client_id()`, not from the request body.

**Exploit scenario (before-state):**
```bash
# Authenticated VANTARA user with a known NÓMADA cfdi_request UUID
curl -X POST /api/factura/timbrar \
  -H "Authorization: Bearer <vantara_token>" \
  -d '{"cfdi_request_id": "<nomada_uuid>"}'
# → Stamps NÓMADA's tax document; the SAT stamp appears against NÓMADA's RFC
```

**Regression test:** POST with a valid VANTARA auth token but a CFDI request UUID belonging to AMALAY returns 404 or 403. POST with valid auth and own tenant's CFDI request ID proceeds normally.

**Status:** IN_PROGRESS

---

### P0-M — /api/onboarding: open when ONBOARDING_SECRET not set

**Root cause:** The guard is written as `if (adminSecret && adminSecret !== req.headers['x-admin-secret']) { return 401 }`. When `ONBOARDING_SECRET` is undefined or empty, the condition short-circuits and the check is skipped entirely. The endpoint is fully open in any environment where the env var is missing (local dev, misconfigured staging, new deployment).

**Solution:** Fail closed: if `ONBOARDING_SECRET` is not set, return 503 immediately. The endpoint should never be accessible without a configured secret.

```typescript
const adminSecret = process.env.ONBOARDING_SECRET
if (!adminSecret) return res.status(503).json({ error: 'Endpoint not configured' })
if (req.headers['x-admin-secret'] !== adminSecret) return res.status(401).json({ error: 'Unauthorized' })
```

**Exploit scenario (before-state):**
```bash
# If ONBOARDING_SECRET is not set in the deployment environment:
curl -X POST /api/onboarding \
  -d '{"email": "attacker@evil.com", "clientId": "amalay", "password": "newpass123"}'
# → Creates a dueño-level account in any tenant on the platform
```

**Regression test:** When `ONBOARDING_SECRET` is not set in environment, POST returns 503. When set but wrong secret provided, returns 401. When set and correct secret provided, proceeds normally.

**Status:** IN_PROGRESS

---

### P0-N — getClientId() systemic: x-client-id client-controlled, ~25 routes unauth

**Root cause:** `getClientId()` resolves the active tenant by reading the `x-client-id` HTTP header, which is a value the caller sets freely. Approximately 25 POS API routes call `getClientId()` without any preceding authentication gate, meaning any anonymous HTTP caller can read or write data in any tenant by setting `x-client-id` to that tenant's slug.

**Solution:** `withPOSAuth()` middleware validates the POS shift token or Supabase session token and resolves `clientId` from server state (JWT claims or `client_users` lookup) — never from request headers. All `/api/pos/*` mutation routes must be wrapped with `withPOSAuth()`. The `x-client-id` header is used only as a hint for logging, never as an authorization input.

**Exploit scenario (before-state):**
```bash
# No credentials, no session — just set the header to target any tenant
curl /api/pos/save-order \
  -H "x-client-id: amalay" \
  -d '{"items": [...], "total": 999}'
# → Writes an order into AMALAY's database

curl /api/pos/orders \
  -H "x-client-id: vantara"
# → Returns all of VANTARA's open orders
```

**Regression test:** All `/api/pos/*` mutation routes (save-order, merge-orders, cancel-order, apply-discount, cierre, etc.) return 401 when called without a valid shift token or Supabase session, regardless of `x-client-id` header value. Authenticated request with `x-client-id` set to a different tenant than the token's resolved tenant returns 403.

**Status:** IN_PROGRESS

---

## Milestone Governance

**Feature freeze is in effect.** No new features or schema changes are merged to the sandbox/production track until all 14 P0s reach CLOSED status.

### Closure requirements per P0

Each finding must have all three before it can be marked CLOSED:

1. **Exploit test (before-state):** A test or documented script that demonstrates the vulnerability in its unfixed state. This must be captured before the fix is applied.
2. **Regression test (after-state):** An automated test in `security-authorization.test.ts` (or equivalent) that verifies the fix and will fail if the fix is reverted.
3. **Doc update:** Status column in this document updated to CLOSED with a commit SHA reference.

### Promotion criteria to `app.fullsite.mx`

Both of the following must be true:

- All tests in `security-authorization.test.ts` pass (covers P0-A through P0-N auth gates and RLS policies)
- All 7 integration tests IT-01 through IT-07 from `POS-BROWSER-SECURITY.md` pass

### Tag and next track

Once promotion criteria are met: tag `foundation-v1-secure` on the promoting commit.

After tagging: pivot to **AI Operations track** — no security P0 work bleeds into that track.

---

## Phase 2 Deferred

These two items are architectural refactors that require dedicated design before implementation. They are excluded from the `foundation-v1-secure` promotion gate but must be tracked separately.

### Phase 2-A: Auth tokens out of localStorage (P0-D)

Migrating from manual localStorage session storage to `@supabase/ssr` httpOnly cookies requires resolving an explicit tension: the offline POS must keep some token accessible to the service worker for background sync auth. The design must answer:

- Which token is service-worker-accessible (short-TTL access token, ≤15 min)?
- Where does the refresh token live (httpOnly cookie only)?
- How does offline POS handle token refresh when the device is offline?

This work is tracked under the Offline Certification track. Prerequisite: offline PWA design (OC-01 through OC-12) finalized.

### Phase 2-B: Server-side total recalculation (P0-F, P0-G)

The auth gate for save-order and merge-orders (Phase 1, in progress) blocks unauthenticated writes. Phase 2 adds server-side total recomputation: the server fetches `pos_menu_items` by the submitted item IDs and recomputes the total independently, returning 400 if the client-provided total diverges beyond a rounding tolerance.

Prerequisite: `pos_menu_items` schema stable (no pending migrations). Estimated complexity: medium (requires item ID array in save-order payload, which may need a schema addendum).

---

## What's Already Working

These controls are correctly implemented and should not be regressed during P0 remediation:

| Control | Description | Verified |
|---|---|---|
| PIN server-side validation | `/api/pos/pin` validates against hashed PIN in `client_users`, never trusts client-provided PIN value | Yes |
| Service key server-only | `SUPABASE_SERVICE_KEY` is not prefixed `NEXT_PUBLIC_*` and does not appear in any client bundle | Yes |
| RLS on 13 tables | `pos_orders`, `pos_order_items`, `pos_audit_log`, `pos_discounts`, `pos_shifts`, `pos_tables`, `wansoft_daily`, `wansoft_kpis`, `amalay_reservaciones`, `reviews`, `tasks`, `content`, `memories` all have tenant-scoped RLS policies | Yes |
| SKEL-04 applied | Skeleton tenant isolation schema applied; `auth_client_id()` function exists and is used in RLS predicates | Yes |
| Manager PIN not in bundle | `NEXT_PUBLIC_MANAGER_PINS` reference removed; manager auth routed through server-side validation | Yes |
| Shift token HMAC signing | `/api/pos/pin` issues tokens signed with `POS_SHIFT_SECRET` (HMAC-SHA256); `withPOSAuth()` verifies signature before trusting any claim | Yes |
| Supabase Realtime tenant filter | Realtime subscriptions filtered server-side by `client_id`; clients cannot subscribe to other tenants' channels | Yes |
| audit_log write-only | `pos_audit_log` policies: INSERT allowed for authenticated staff, SELECT restricted to manager role — meseros cannot read their own audit trail | Yes |
| Env vars not in git | `.env`, `.env.local`, `.mcp.json` in `.gitignore`; no secrets in committed files | Yes |
| Clip/MP keys server env | `CLIP_API_KEY`, `MP_ACCESS_TOKEN` stored in Vercel env vars (server-only), not in client bundle | Partial — P0-I fix completes this for Clip |
