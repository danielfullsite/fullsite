#!/usr/bin/env python3
"""
isolation_test.py — SKEL-04 tenant isolation verification.

Verifica que:
  1. Un usuario VANTARA solo puede leer datos de VANTARA
  2. Un usuario NÓMADA-MINI solo puede leer datos de NÓMADA-MINI
  3. Ningún usuario puede leer datos del otro tenant
  4. Un usuario sin client_users queda bloqueado en tablas sensibles
  5. service_role puede leer todo (excepción explícita)

Estado esperado por fase:
  SKEL-01/03: Items 1-4 = FAIL (RLS = USING(true), aislamiento no implementado)
              Items 5    = PASS
  SKEL-04:    Todos = PASS

Uso:
    export NEXT_PUBLIC_SUPABASE_URL_SANDBOX="https://<ref>.supabase.co"
    export NEXT_PUBLIC_SUPABASE_ANON_KEY_SANDBOX="<anon-key>"
    export SANDBOX_SERVICE_KEY="<service-role-key>"

    # Credenciales de los dos tenants (deben existir en Auth):
    export VANTARA_OWNER_EMAIL="owner@vantara.sandbox"
    export VANTARA_OWNER_PASS="Vantara2026!"
    export NOMADA_OWNER_EMAIL="test@nomada.sandbox"
    export NOMADA_OWNER_PASS="Nomada2026!"

    python3 scripts/sql/sandbox/tests/isolation_test.py

Salida:
    PASS/FAIL/WARN/EXPECTED_FAIL por check. Exit 0 si todos los checks
    son PASS o EXPECTED_FAIL. Exit 1 si algún check es FAIL.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

AMALAY_PROJECT_REF = "qjiomlvudfmzuvqvhwpk"

# ── Env ───────────────────────────────────────────────────────────────────────
def env_or_die(name):
    v = os.environ.get(name, "").strip()
    if not v:
        print(f"ERROR: {name} no configurado", file=sys.stderr)
        sys.exit(1)
    return v

def env_opt(name, default=""):
    return os.environ.get(name, default).strip()

# ── HTTP ──────────────────────────────────────────────────────────────────────
def http_get(url, headers):
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")

def http_post(url, body, headers):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")

# ── Results ───────────────────────────────────────────────────────────────────
results = []

PASS = "PASS"
FAIL = "FAIL"
WARN = "WARN"
EXPECTED_FAIL = "EXPECTED_FAIL"
EXPECTED_PASS = "EXPECTED_PASS"

def check(name, passed, detail="", expected_to_fail=False):
    if expected_to_fail:
        status = EXPECTED_FAIL if not passed else EXPECTED_PASS
        mark = "~" if not passed else "!"
    else:
        status = PASS if passed else FAIL
        mark = "✓" if passed else "✗"
    msg = f"  {mark} [{status:13s}] {name}"
    if detail:
        msg += f"\n              {detail}"
    print(msg)
    results.append((name, status))

def section(title):
    print(f"\n── {title} " + "─" * (60 - len(title)))

def login(auth_url, anon_key, email, password):
    s, r = http_post(
        f"{auth_url}/token?grant_type=password",
        {"email": email, "password": password},
        {"apikey": anon_key, "Content-Type": "application/json"},
    )
    if s == 200 and isinstance(r, dict):
        return r.get("access_token")
    return None

def authed_get(rest, path, token, anon_key):
    return http_get(
        f"{rest}/{path}",
        {"apikey": anon_key, "Authorization": f"Bearer {token}"},
    )

def count_rows(rest, table, filter_str, token, anon_key):
    s, r = authed_get(rest, f"{table}?{filter_str}&select=id", token, anon_key)
    if s == 200 and isinstance(r, list):
        return len(r)
    return -1  # indicates error/denied

def main():
    url      = env_or_die("NEXT_PUBLIC_SUPABASE_URL_SANDBOX").rstrip("/")
    anon_key = env_or_die("NEXT_PUBLIC_SUPABASE_ANON_KEY_SANDBOX")
    svc_key  = env_or_die("SANDBOX_SERVICE_KEY")

    vantara_email = env_opt("VANTARA_OWNER_EMAIL", "owner@vantara.sandbox")
    vantara_pass  = env_opt("VANTARA_OWNER_PASS",  "Vantara2026!")
    nomada_email  = env_opt("NOMADA_OWNER_EMAIL",  "test@nomada.sandbox")
    nomada_pass   = env_opt("NOMADA_OWNER_PASS",   "Nomada2026!")

    if AMALAY_PROJECT_REF in url:
        print(f"ERROR: URL apunta a AMALAY producción. Abortando.", file=sys.stderr)
        sys.exit(1)

    rest  = f"{url}/rest/v1"
    auth  = f"{url}/auth/v1"
    svc_h = {"apikey": svc_key, "Authorization": f"Bearer {svc_key}"}

    print(f"\nfullsite-sandbox isolation test — {url}")

    # Detect current RLS phase
    # If anon user can read pos_menu_items without filter → USING(true) still active
    s_probe, _ = http_get(f"{rest}/pos_menu_items?limit=1", {"apikey": anon_key})
    using_true_rls = (s_probe == 200)
    if using_true_rls:
        print("  NOTE: RLS = USING(true) detected (SKEL-01/03 phase).")
        print("        Cross-tenant isolation checks will be EXPECTED_FAIL.")
        print("        Run again after SKEL-04 to see all PASS.")
    else:
        print("  RLS appears tightened. Running full isolation checks.")

    # ── 1. Login ──────────────────────────────────────────────────────────────
    section("1. Authentication")
    vantara_token = login(auth, anon_key, vantara_email, vantara_pass)
    check("VANTARA owner login succeeds", vantara_token is not None,
          f"email={vantara_email}")

    nomada_token = login(auth, anon_key, nomada_email, nomada_pass)
    check("NÓMADA-MINI owner login succeeds", nomada_token is not None,
          f"email={nomada_email}")

    if not vantara_token or not nomada_token:
        print("\n  Cannot proceed without both tokens. Run bootstrap_auth.py first.")
        sys.exit(1)

    # ── 2. VANTARA reads own data ─────────────────────────────────────────────
    section("2. VANTARA reads own data (must PASS)")
    for table in ["pos_menu_items", "pos_menu_categories", "pos_payment_methods", "pos_staff"]:
        n = count_rows(rest, table, "client_id=eq.vantara", vantara_token, anon_key)
        check(f"VANTARA → {table}: ≥ 1 own row", n >= 1, f"rows={n}")

    check("VANTARA → clients: own row",
          count_rows(rest, "clients", "id=eq.vantara", vantara_token, anon_key) == 1)

    # ── 3. NÓMADA-MINI reads own data ─────────────────────────────────────────
    section("3. NÓMADA-MINI reads own data (must PASS)")
    for table in ["pos_payment_methods", "pos_staff"]:
        n = count_rows(rest, table, "client_id=eq.nomada-mini", nomada_token, anon_key)
        check(f"NÓMADA → {table}: ≥ 1 own row", n >= 1, f"rows={n}")

    check("NÓMADA → clients: own row",
          count_rows(rest, "clients", "id=eq.nomada-mini", nomada_token, anon_key) == 1)

    # ── 4. Cross-tenant isolation ─────────────────────────────────────────────
    section("4. Cross-tenant isolation (EXPECTED_FAIL until SKEL-04)")
    tables_to_isolate = [
        "pos_menu_items", "pos_menu_categories", "pos_modifier_groups",
        "pos_payment_methods", "pos_staff", "pos_orders", "pos_cierres",
    ]

    for table in tables_to_isolate:
        # VANTARA should NOT see nomada-mini rows
        n = count_rows(rest, table, "client_id=eq.nomada-mini", vantara_token, anon_key)
        check(
            f"VANTARA cannot read {table}[nomada-mini]",
            n == 0,
            f"rows visible={n}",
            expected_to_fail=using_true_rls,
        )

        # NÓMADA-MINI should NOT see vantara rows
        n = count_rows(rest, table, "client_id=eq.vantara", nomada_token, anon_key)
        check(
            f"NÓMADA cannot read {table}[vantara]",
            n == 0,
            f"rows visible={n}",
            expected_to_fail=using_true_rls,
        )

    # ── 5. Arbitrary client_id injection prevention ───────────────────────────
    section("5. Arbitrary client_id injection (frontend cannot claim another tenant)")
    # A VANTARA user should not be able to INSERT with a different client_id.
    # Attempt to write a pos_orders row with client_id='nomada-mini' using VANTARA's token.
    # This tests the CHECK constraint / RLS write policy.
    h_vantara = {"apikey": anon_key, "Authorization": f"Bearer {vantara_token}",
                 "Content-Type": "application/json", "Prefer": "return=minimal"}
    fake_order = {
        "client_id": "nomada-mini",
        "mesa": 99,
        "status": "open",
        "items": "[]",
        "subtotal": 0,
        "total": 0,
    }
    s_inject, _ = http_post(f"{rest}/pos_orders", fake_order, h_vantara)
    check(
        "VANTARA cannot INSERT pos_orders with client_id='nomada-mini'",
        s_inject not in (200, 201),
        f"HTTP {s_inject} (201=breach, 4xx=blocked)",
        expected_to_fail=using_true_rls,
    )

    # ── 6. Unauthenticated access blocked ─────────────────────────────────────
    section("6. Unauthenticated access")
    anon_only_h = {"apikey": anon_key}
    s_anon, _ = http_get(f"{rest}/pos_orders?limit=1", anon_only_h)
    check(
        "Unauthenticated request to pos_orders is blocked (401/403) or returns 0 rows",
        s_anon in (401, 403) or (s_anon == 200),  # 200 with empty RLS is common
        f"HTTP {s_anon}",
        expected_to_fail=using_true_rls,
    )
    if s_anon == 200:
        # Check that the response is actually empty (RLS hiding all rows)
        s2, r2 = http_get(f"{rest}/pos_orders?select=id&limit=100", anon_only_h)
        check(
            "Unauthenticated pos_orders returns 0 rows (RLS hides all)",
            isinstance(r2, list) and len(r2) == 0,
            f"rows={len(r2) if isinstance(r2, list) else '?'}",
            expected_to_fail=using_true_rls,
        )

    # ── 7. service_role bypass (only explicit exception) ──────────────────────
    section("7. service_role bypass — must PASS")
    n_all_items = count_rows(rest, "pos_menu_items", "select=id", svc_key, svc_key)
    # Using service_key as both apikey and auth token (service_role bypass)
    s_svc, r_svc = http_get(f"{rest}/pos_menu_items?select=id", svc_h)
    total_via_svc = len(r_svc) if isinstance(r_svc, list) else 0
    check(
        "service_role reads ALL menu_items across tenants",
        s_svc == 200 and total_via_svc >= 2,
        f"rows={total_via_svc} (should include VANTARA + NÓMADA-MINI items)",
    )

    s_svc2, r_svc2 = http_get(f"{rest}/clients?select=id", svc_h)
    check(
        "service_role reads ALL clients",
        s_svc2 == 200 and isinstance(r_svc2, list) and len(r_svc2) >= 2,
        f"clients={[x['id'] for x in r_svc2] if isinstance(r_svc2, list) else r_svc2}",
    )

    # ── 8. User without client_users blocked ──────────────────────────────────
    section("8. Orphan user (no client_users row) is blocked")
    # Create a temporary user with no client_users row
    svc_create_h = {**svc_h, "Content-Type": "application/json"}
    orphan_email = "orphan-test@sandbox.invalid"
    s_create, r_create = http_post(
        f"{auth}/admin/users",
        {"email": orphan_email, "password": "Orphan2026!", "email_confirm": True},
        svc_create_h,
    )
    orphan_token = None
    if s_create in (200, 201) and isinstance(r_create, dict):
        orphan_id = r_create.get("id")
        # Login as orphan
        orphan_token = login(auth, anon_key, orphan_email, "Orphan2026!")
        check("Orphan user can login (auth layer)", orphan_token is not None)

        if orphan_token:
            # Orphan should not be able to read pos_menu_items (no RLS match)
            s_orphan, r_orphan = authed_get(rest, "pos_menu_items?select=id&limit=10",
                                            orphan_token, anon_key)
            orphan_count = len(r_orphan) if isinstance(r_orphan, list) else -1
            check(
                "Orphan user cannot read any pos_menu_items",
                orphan_count == 0,
                f"rows={orphan_count} (0=isolated, >0=breach)",
                expected_to_fail=using_true_rls,
            )

        # Cleanup: delete orphan user
        if orphan_id:
            http_post.__module__  # no-op to access scope
            req = urllib.request.Request(
                f"{auth}/admin/users/{orphan_id}",
                headers=svc_h, method="DELETE",
            )
            try:
                urllib.request.urlopen(req, timeout=10)
            except Exception:
                pass
    elif s_create == 422 and "already" in str(r_create).lower():
        # Orphan from a previous run — try to login
        orphan_token = login(auth, anon_key, orphan_email, "Orphan2026!")
        if orphan_token:
            s_orphan, r_orphan = authed_get(rest, "pos_menu_items?select=id&limit=10",
                                            orphan_token, anon_key)
            orphan_count = len(r_orphan) if isinstance(r_orphan, list) else -1
            check(
                "Orphan user cannot read any pos_menu_items",
                orphan_count == 0,
                f"rows={orphan_count}",
                expected_to_fail=using_true_rls,
            )
    else:
        check("Orphan user creation", False, f"HTTP {s_create}: {str(r_create)[:80]}")

    # ── Summary ───────────────────────────────────────────────────────────────
    passes   = sum(1 for _, s in results if s == PASS)
    exp_fail = sum(1 for _, s in results if s == EXPECTED_FAIL)
    exp_pass = sum(1 for _, s in results if s == EXPECTED_PASS)
    fails    = sum(1 for _, s in results if s == FAIL)
    total    = len(results)

    print()
    print("═" * 68)
    if using_true_rls:
        print(f"  Phase: SKEL-01/03 (USING(true) RLS — aislamiento pendiente)")
    else:
        print(f"  Phase: SKEL-04+ (RLS tightened)")
    print(f"  PASS: {passes}  EXPECTED_FAIL: {exp_fail}  FAIL: {fails}  TOTAL: {total}")
    if exp_pass > 0:
        print(f"  UNEXPECTED_PASS: {exp_pass} — un check aislado pasa antes de SKEL-04 (revisar)")
    print("═" * 68)

    if fails > 0:
        print("\n  Checks FAIL (no esperados):")
        for name, status in results:
            if status == FAIL:
                print(f"    ✗ {name}")
        sys.exit(1)
    elif exp_fail > 0 and not using_true_rls:
        print("\n  EXPECTED_FAIL detectados con RLS supuestamente tightened — revisar SKEL-04.")
        sys.exit(1)
    else:
        if using_true_rls:
            print(f"\n  OK para SKEL-01/03. Aplicar SKEL-04 y re-ejecutar para verificar aislamiento completo.")
        else:
            print(f"\n  Aislamiento completo verificado. Listo para demo.")


if __name__ == "__main__":
    main()
