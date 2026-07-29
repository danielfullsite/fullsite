# Operational Runbook — Fullsite Sandbox

> **Scope:** sandbox environment only — `fullsite-warroom-staging` / `sandbox.app.fullsite.mx`  
> For AMALAY production, see `docs/operations/MANUAL-OPERATIVO.md`

---

## Tenant can't log in

1. Verify email exists in auth.users:
   ```sql
   SELECT id, email, email_confirmed_at FROM auth.users WHERE email = '<email>';
   ```
2. Verify client_users link:
   ```sql
   SELECT * FROM client_users WHERE user_id = '<uid>';
   ```
3. Verify client is active:
   ```sql
   SELECT id, active FROM clients WHERE id = '<client_id>';
   ```
4. If email_confirmed_at is NULL → update it:
   ```sql
   UPDATE auth.users SET email_confirmed_at = now() WHERE email = '<email>';
   ```

---

## Tenant sees data from another tenant

This is a critical isolation failure. Steps:

1. Confirm which table shows cross-tenant data and from which session
2. Check RLS policies are in place:
   ```sql
   SELECT policyname, roles, qual FROM pg_policies
   WHERE tablename = '<table>' AND schemaname = 'public';
   ```
3. Confirm no `{public}` SELECT policies exist on that table:
   ```sql
   SELECT * FROM pg_policies WHERE tablename = '<table>' AND roles @> '{public}';
   -- Must return 0 rows
   ```
4. Verify `auth_client_id()` function exists:
   ```sql
   SELECT proname FROM pg_proc WHERE proname = 'auth_client_id';
   ```
5. If function is missing, re-apply SKEL-04 migration from `docs/technical/ARCHITECTURE.md`.

---

## Add a new tenant

See `docs/technical/PROVISIONING.md`. Steps 1–7 are SQL-only. Estimated time: 5–15 min.

---

## Verify 3-tenant isolation snapshot

```sql
SELECT 'categories' AS t, client_id, count(*) FROM pos_menu_categories 
WHERE client_id IN ('vantara','nomada-mini','prueba-3') GROUP BY client_id
UNION ALL
SELECT 'items', client_id, count(*) FROM pos_menu_items
WHERE client_id IN ('vantara','nomada-mini','prueba-3') GROUP BY client_id
UNION ALL
SELECT 'staff', client_id, count(*) FROM pos_staff
WHERE client_id IN ('vantara','nomada-mini','prueba-3') GROUP BY client_id
ORDER BY t, client_id;
```

Expected: each client_id shows only its own rows. No row should appear in another tenant's bucket.

---

## Preview deployment failed (0ms build)

Cause: missing env vars for the preview branch.

Fix:
```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL preview sandbox/second-customer-skeleton
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY preview sandbox/second-customer-skeleton
vercel env add SUPABASE_SERVICE_KEY preview sandbox/second-customer-skeleton
vercel env add NEXT_PUBLIC_APP_ENV preview sandbox/second-customer-skeleton
```

Trigger redeploy:
```bash
vercel deploy --force
```

---

## DNS not resolving (sandbox.app.fullsite.mx)

1. Check CNAME exists in Cloudflare → zone `fullsite.mx`:
   ```
   Name: sandbox.app | Type: CNAME | Value: cname.vercel-dns.com | Proxy: OFF
   ```
2. Check propagation: `dig sandbox.app.fullsite.mx CNAME`
3. Check Vercel domain status: `vercel domains ls`
4. If domain not added to Vercel: `vercel alias set <deploy-url> sandbox.app.fullsite.mx`

---

## SSL certificate not active

After DNS propagates (1–5 min), Vercel auto-provisions TLS via Let's Encrypt. If after 10 min still no cert:
1. Vercel dashboard → project → Settings → Domains → click "Verify" next to the domain
2. Verify Cloudflare proxy is OFF (grey cloud, not orange)
3. Verify CNAME points to `cname.vercel-dns.com` (not `76.76.21.21` or IP)

---

## Sandbox smoke test (quick)

```bash
# From repo root with staging env vars set
python3 scripts/sql/sandbox/smoke_test.py
```

All checks must show PASS. The cross-tenant WARN is expected for anon-role reads (see G-006 in KNOWN_GOTCHAS.md).

---

## Emergency: accidentally modified production

If any action touched `qjiomlvudfmzuvqvhwpk` (AMALAY production):

1. STOP — do not make additional changes
2. Check Supabase dashboard → `fullsite-amalay` → Table Editor → verify data integrity
3. Check `agent_runs` log for last known good state
4. Contact Daniel immediately
5. If data was corrupted: Supabase → Settings → Backups → restore to last good snapshot

**This should never happen** — the FORBIDDEN_CLIENT_IDS guard and the project ref guards in tooling prevent it. If it happened anyway, document the failure mode in `docs/postmortems/`.

---

## Credentials (sandbox only — rotate before external demo)

| User | Password | Tenant | Role |
|---|---|---|---|
| owner@vantara.sandbox | Sandbox2026!vantara | vantara | dueño |
| owner@nomada.sandbox | Sandbox2026!nomada | nomada-mini | dueño |
| owner@prueba3.sandbox | Sandbox2026!prueba3 | prueba-3 | dueño |

VANTARA staff PINs: Carlos 9001, Sofia 1001, Diego 1002, Ana 1003
