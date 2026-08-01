# Provisioning — New Restaurant Client

> **Invariant:** Adding a new client requires zero code changes.  
> Estimated time: 5–30 min depending on whether Supabase project already exists.

---

## Pre-flight

| Check | Command / Action |
|---|---|
| Schema already applied to target Supabase project | `SELECT COUNT(*) FROM pos_menu_categories` → table exists |
| SKEL-04 RLS applied | `SELECT COUNT(*) FROM pg_policies WHERE policyname = 'auth_tenant'` → ≥13 |
| New client_id is not 'amalay' | Manual check |
| Owner email does not exist in auth.users | `SELECT id FROM auth.users WHERE email = '<email>'` → 0 rows |

---

## Step 1 — Insert client row

```sql
INSERT INTO clients (id, display_name, active)
VALUES ('<client-id>', '<Display Name>', true)
ON CONFLICT (id) DO NOTHING;
```

Optional columns (all nullable, set when available):
`city`, `timezone`, `iva_rate`, `mesas`, `receipt_footer`, `logo_url`, `accent_color`

---

## Step 2 — Create auth user (idempotent)

```sql
DO $$
DECLARE v_uid UUID;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE email = '<owner@client.domain>';
  IF v_uid IS NULL THEN
    INSERT INTO auth.users (
      id, email, encrypted_password, email_confirmed_at,
      raw_user_meta_data, role, aud, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      '<owner@client.domain>',
      crypt('<InitialPassword>', gen_salt('bf')),
      now(),
      '{"client_id":"<client-id>","role":"dueño"}'::jsonb,
      'authenticated', 'authenticated', now(), now()
    )
    RETURNING id INTO v_uid;
  END IF;

  -- Step 3: Link to client
  IF NOT EXISTS (SELECT 1 FROM client_users WHERE user_id = v_uid AND client_id = '<client-id>') THEN
    INSERT INTO client_users (id, user_id, client_id, role)
    VALUES (gen_random_uuid(), v_uid, '<client-id>', 'dueño');
  END IF;
END $$;
```

---

## Step 4 — Seed menu categories

```sql
INSERT INTO pos_menu_categories (id, client_id, name, sort_order, active)
VALUES
  (gen_random_uuid(), '<client-id>', 'Categoria 1', 1, true),
  (gen_random_uuid(), '<client-id>', 'Categoria 2', 2, true);
```

---

## Step 5 — Seed menu items

```sql
INSERT INTO pos_menu_items (id, client_id, category_id, name, price, sort_order, active)
SELECT gen_random_uuid(), '<client-id>', id, 'Platillo Ejemplo', 100.00, 1, true
FROM pos_menu_categories
WHERE client_id = '<client-id>' AND name = 'Categoria 1'
LIMIT 1;
```

---

## Step 6 — Seed payment methods

```sql
INSERT INTO pos_payment_methods (id, client_id, name, active)
VALUES
  (gen_random_uuid(), '<client-id>', 'Efectivo', true),
  (gen_random_uuid(), '<client-id>', 'Tarjeta', true);
```

---

## Step 7 — Seed staff

```sql
INSERT INTO pos_staff (id, client_id, name, role, pin, active)
VALUES
  (gen_random_uuid(), '<client-id>', 'Gerente', 'admin',   '1000', true),
  (gen_random_uuid(), '<client-id>', 'Mesero 1', 'mesero', '2001', true);
```

**Note:** PINs must be unique within a client_id (enforced by UNIQUE(pin, client_id) if present). Use 4-digit PINs.

---

## Step 8 — Isolation smoke test

Run these 4 queries. All must return expected counts for the new client and 0 for other tenants:

```sql
-- New client data visible
SELECT COUNT(*) FROM pos_menu_categories WHERE client_id = '<client-id>';   -- ≥1
SELECT COUNT(*) FROM pos_staff           WHERE client_id = '<client-id>';   -- ≥1

-- Cross-tenant leakage check (substitute existing client_ids)
SELECT COUNT(*) FROM pos_menu_categories WHERE client_id = 'vantara'      AND '<client-id>' <> 'vantara';   -- should equal VANTARA's count, not 0 — confirms query works
SELECT COUNT(*) FROM pos_menu_items      WHERE client_id = '<client-id>'  AND client_id <> 'vantara';       -- 0 rows of VANTARA in new client scope
```

---

## Step 9 — Vercel env vars (if new Vercel project)

```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL preview <branch-name>
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY preview <branch-name>
vercel env add SUPABASE_SERVICE_KEY preview <branch-name>
vercel env add NEXT_PUBLIC_APP_ENV preview <branch-name>
```

---

## Step 10 — DNS (if new subdomain)

In Cloudflare → zone `fullsite.mx`:

| Name | Type | Value | Proxy |
|---|---|---|---|
| `<client>.app` | CNAME | `cname.vercel-dns.com` | OFF |

Then alias:
```bash
vercel alias set <deploy-url> <client>.app.fullsite.mx
```

---

## Estimated times

| Scenario | Time |
|---|---|
| Schema already applied, seed-only | ~5 min |
| Schema + seed + Vercel env | ~15 min |
| Schema + seed + Vercel project + DNS | ~30 min |
| Full new Supabase project + everything | ~45 min |

---

## G-012 — auth.users requiere token fields vacíos, no NULL

Al insertar usuarios vía SQL directo en `auth.users`, los campos `confirmation_token`, `recovery_token`, `email_change_token_new` y `email_change` deben ser `''` (string vacío), **no NULL**.

Supabase Auth (Go) hace `Scan` de estos campos a `string` y falla con `converting NULL to string is unsupported` → el usuario no puede hacer login ("Database error querying schema").

El DO block en Step 2 ya incluye estos campos correctamente. Si alguna vez insertas usuarios por otro medio, aplica este fix:

```sql
UPDATE auth.users
SET
  confirmation_token     = COALESCE(confirmation_token, ''),
  recovery_token         = COALESCE(recovery_token, ''),
  email_change_token_new = COALESCE(email_change_token_new, ''),
  email_change           = COALESCE(email_change, '')
WHERE email IN ('<email1>', '<email2>');
```

---

## Reference: PRUEBA-3

PRUEBA-3 was provisioned on 2026-07-29 using Steps 1–7 above with zero code changes, confirming the invariant. client_id=`prueba-3`, staging project `jkcnxfbbuyyfhwfjizgw`.
