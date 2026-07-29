#!/usr/bin/env python3
"""
SKEL smoke test — verifica el estado del proyecto fullsite-sandbox.

Corre DESPUÉS de aplicar todas las migraciones y bootstrap_auth.py.

Uso:
    export NEXT_PUBLIC_SUPABASE_URL_SANDBOX="https://<ref>.supabase.co"
    export NEXT_PUBLIC_SUPABASE_ANON_KEY_SANDBOX="<anon-key>"
    export SANDBOX_SERVICE_KEY="<service-role-key>"
    python3 scripts/sql/sandbox/smoke_test.py

Salida:
    PASS / FAIL por cada check. Falla con exit 1 si algún check no pasa.

Limitaciones conocidas (documentadas en Cloneability Report v1):
    - Aislamiento cross-tenant via RLS NO verificado aquí (ver SKEL-04).
      Actualmente las políticas son USING(true) — cualquier usuario autenticado
      puede leer cualquier tabla. SKEL-04 tightenará las demo tables.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

AMALAY_PROJECT_REF = "qjiomlvudfmzuvqvhwpk"

PASS = "PASS"
FAIL = "FAIL"
WARN = "WARN"


def env_or_die(name):
    v = os.environ.get(name, "").strip()
    if not v:
        print(f"ERROR: {name} no configurado", file=sys.stderr)
        sys.exit(1)
    return v


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


results = []


def check(name, passed, detail=""):
    status = PASS if passed else FAIL
    mark = "✓" if passed else "✗"
    msg = f"  {mark} [{status}] {name}"
    if detail:
        msg += f"\n         {detail}"
    print(msg)
    results.append((name, passed))


def warn(name, detail=""):
    msg = f"  ~ [WARN] {name}"
    if detail:
        msg += f"\n         {detail}"
    print(msg)


def main():
    url = env_or_die("NEXT_PUBLIC_SUPABASE_URL_SANDBOX").rstrip("/")
    anon_key = env_or_die("NEXT_PUBLIC_SUPABASE_ANON_KEY_SANDBOX")
    service_key = env_or_die("SANDBOX_SERVICE_KEY")

    if AMALAY_PROJECT_REF in url:
        print(f"ERROR: URL apunta a AMALAY producción. Abortando.", file=sys.stderr)
        sys.exit(1)

    svc_h = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}
    anon_h = {"apikey": anon_key, "Authorization": f"Bearer {anon_key}"}
    rest = f"{url}/rest/v1"
    auth = f"{url}/auth/v1"

    print(f"\nfullsite-sandbox smoke test — {url}\n")

    # ── 1. Conectividad ──────────────────────────────────────────────────────
    print("── 1. Conectividad ─────────────────────────────────────────────────")
    s, r = http_get(f"{rest}/clients?select=id&limit=1", svc_h)
    check("Supabase REST responde", s == 200, f"HTTP {s}" if s != 200 else "")

    # ── 2. Tenants ───────────────────────────────────────────────────────────
    print("── 2. Tenants ──────────────────────────────────────────────────────")
    s, r = http_get(f"{rest}/clients?id=in.(vantara,nomada-mini)&select=id,display_name,data_source,mesas", svc_h)
    check("clients: 2 tenants creados", s == 200 and isinstance(r, list) and len(r) == 2,
          f"encontrados: {[x['id'] for x in r] if isinstance(r, list) else r}")

    if isinstance(r, list):
        for tenant in r:
            check(f"  {tenant['id']}: data_source=fullsite",
                  tenant.get("data_source") == "fullsite",
                  f"actual: {tenant.get('data_source')}")
            check(f"  {tenant['id']}: mesas > 0",
                  (tenant.get("mesas") or 0) > 0,
                  f"mesas={tenant.get('mesas')}")

    # ── 3. Menú ──────────────────────────────────────────────────────────────
    print("── 3. Menú ─────────────────────────────────────────────────────────")
    s, r = http_get(f"{rest}/pos_menu_categories?client_id=eq.vantara&select=id", svc_h)
    check("menu_categories: VANTARA ≥ 3", s == 200 and isinstance(r, list) and len(r) >= 3,
          f"encontradas: {len(r) if isinstance(r, list) else r}")

    s, r = http_get(f"{rest}/pos_menu_items?client_id=eq.vantara&select=id", svc_h)
    check("menu_items: VANTARA ≥ 10", s == 200 and isinstance(r, list) and len(r) >= 10,
          f"encontrados: {len(r) if isinstance(r, list) else r}")

    s, r = http_get(f"{rest}/pos_menu_items?client_id=eq.nomada-mini&select=id", svc_h)
    check("menu_items: NÓMADA-MINI ≥ 1", s == 200 and isinstance(r, list) and len(r) >= 1,
          f"encontrados: {len(r) if isinstance(r, list) else r}")

    # ── 4. Modificadores ────────────────────────────────────────────────────
    print("── 4. Modificadores ────────────────────────────────────────────────")
    s, r = http_get(f"{rest}/pos_modifier_groups?client_id=eq.vantara&select=id,name,required", svc_h)
    check("modifier_groups: VANTARA ≥ 3", s == 200 and isinstance(r, list) and len(r) >= 3)

    s, r = http_get(f"{rest}/pos_modifiers?client_id=eq.vantara&select=id", svc_h)
    check("modifiers: VANTARA ≥ 9", s == 200 and isinstance(r, list) and len(r) >= 9,
          f"encontrados: {len(r) if isinstance(r, list) else r}")

    s, r = http_get(f"{rest}/pos_item_modifier_groups?client_id=eq.vantara&select=item_id,group_id", svc_h)
    check("item_modifier_groups: VANTARA ≥ 5 vínculos", s == 200 and isinstance(r, list) and len(r) >= 5)

    # ── 5. Métodos de pago ──────────────────────────────────────────────────
    print("── 5. Métodos de pago ──────────────────────────────────────────────")
    s, r = http_get(f"{rest}/pos_payment_methods?client_id=eq.vantara&active=eq.true&select=id,name,type", svc_h)
    check("payment_methods: VANTARA ≥ 3", s == 200 and isinstance(r, list) and len(r) >= 3,
          f"encontrados: {len(r) if isinstance(r, list) else r}")

    if isinstance(r, list):
        types = {x.get("type") for x in r}
        check("  incluye efectivo", "cash" in types)

    # ── 6. Staff ─────────────────────────────────────────────────────────────
    print("── 6. Staff ────────────────────────────────────────────────────────")
    s, r = http_get(f"{rest}/pos_staff?client_id=eq.vantara&active=eq.true&select=id,name,role", svc_h)
    check("staff: VANTARA ≥ 3", s == 200 and isinstance(r, list) and len(r) >= 3,
          f"encontrados: {len(r) if isinstance(r, list) else r}")

    if isinstance(r, list):
        roles = {x.get("role") for x in r}
        check("  incluye admin", "admin" in roles)
        check("  incluye mesero", "mesero" in roles)

    # ── 7. Auth ──────────────────────────────────────────────────────────────
    print("── 7. Auth ─────────────────────────────────────────────────────────")
    # List users via admin API
    s, r = http_get(f"{auth}/admin/users", svc_h)
    if s == 200 and isinstance(r, dict):
        users = r.get("users", [])
        emails = {u["email"] for u in users}
        check("owner@vantara.sandbox existe", "owner@vantara.sandbox" in emails)
        check("test@nomada.sandbox existe", "test@nomada.sandbox" in emails)
    else:
        check("admin users API accesible", False, f"HTTP {s}")

    # Test login as VANTARA owner
    s, r = http_post(
        f"{auth}/token?grant_type=password",
        {"email": "owner@vantara.sandbox", "password": "Vantara2026!"},
        {"apikey": anon_key, "Content-Type": "application/json"},
    )
    check("login owner@vantara.sandbox", s == 200 and isinstance(r, dict) and "access_token" in r,
          f"HTTP {s}" if s != 200 else "access_token recibido")

    vantara_token = r.get("access_token", "") if isinstance(r, dict) else ""

    # ── 8. Auth → lectura de datos propios ──────────────────────────────────
    if vantara_token:
        print("── 8. Lectura autenticada (VANTARA) ────────────────────────────────")
        user_h = {"apikey": anon_key, "Authorization": f"Bearer {vantara_token}"}

        s, r = http_get(f"{rest}/pos_menu_items?client_id=eq.vantara&select=id&limit=1", user_h)
        check("usuario VANTARA lee sus menu_items", s == 200 and isinstance(r, list) and len(r) > 0)

        s, r = http_get(f"{rest}/pos_payment_methods?client_id=eq.vantara&select=id&limit=1", user_h)
        check("usuario VANTARA lee sus payment_methods", s == 200 and isinstance(r, list) and len(r) > 0)

        # client_users check
        s, r = http_get(f"{rest}/client_users?select=client_id,role&limit=5", user_h)
        check("usuario VANTARA tiene client_users row", s == 200 and isinstance(r, list) and len(r) > 0)

        # Cross-tenant isolation NOTE (no RLS isolation yet in SKEL-01/03)
        warn("Aislamiento cross-tenant",
             "RLS actual = USING(true). Un usuario VANTARA puede leer datos de NÓMADA-MINI. "
             "Esto se corrige en SKEL-04. No es un bug — es bootstrap aceptado.")
    else:
        warn("Checks de lectura autenticada saltados (login falló)")

    # ── Resumen ──────────────────────────────────────────────────────────────
    passed = sum(1 for _, ok in results if ok)
    total = len(results)
    failed = total - passed

    print()
    print(f"══ Resultado: {passed}/{total} PASS", end="")
    if failed:
        print(f"  — {failed} FAIL ══")
    else:
        print(" ══")
    print()

    if failed:
        print("Checks fallidos:")
        for name, ok in results:
            if not ok:
                print(f"  ✗ {name}")
        sys.exit(1)
    else:
        print("Todos los checks pasaron. sandbox listo para SKEL-04.")


if __name__ == "__main__":
    main()
