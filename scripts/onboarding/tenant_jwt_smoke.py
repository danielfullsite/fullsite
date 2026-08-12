#!/usr/bin/env python3
"""
Tenant JWT smoke — read-only, RLS-real check for a cloned restaurant.

Unlike the legacy `scripts/smoke_test_nomada.py`, this script does NOT use
service_role. It signs in with Supabase Auth, then calls PostgREST with the
real user JWT so RLS is actually exercised.

Required env:
  SUPABASE_URL              https://<ref>.supabase.co
  SUPABASE_ANON_KEY         public anon key
  TENANT_CLIENT_ID          e.g. nomada
  TENANT_OWNER_EMAIL        e.g. owner@nomada.staging
  TENANT_OWNER_PASSWORD     test/demo password (never commit)

Optional env:
  EXPECTED_OTHER_CLIENT_ID  tenant that must NOT be visible (default: amalay)
  EXPECT_MENU_MIN           default 1
  EXPECT_STAFF_MIN          default 1

Safety:
  - Refuses AMALAY production project ref by default.
  - Does not mutate DB.
  - Does not print tokens or passwords.
"""
from __future__ import annotations

import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, asdict


PROD_REF = "qjiomlvudfmzuvqvhwpk"


_SSL = ssl.create_default_context()
_SSL.check_hostname = False
_SSL.verify_mode = ssl.CERT_NONE


@dataclass
class Result:
    id: str
    passed: bool
    detail: str


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def req(method: str, url: str, headers: dict[str, str], body: dict | None = None) -> tuple[int, object]:
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json", **headers}
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=15, context=_SSL) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(raw) if raw else None
        except json.JSONDecodeError:
            return e.code, raw
    except Exception as e:
        return 0, {"error": str(e)}


def get_rows(base: str, anon: str, jwt: str, table: str, params: dict[str, str]) -> tuple[int, object]:
    qs = urllib.parse.urlencode(params, doseq=False, safe="(),.*")
    return req(
        "GET",
        f"{base}/rest/v1/{table}?{qs}",
        {"apikey": anon, "Authorization": f"Bearer {jwt}"},
    )


def check(results: list[Result], id_: str, passed: bool, detail: str) -> None:
    results.append(Result(id_, passed, detail))
    print(f"[{'PASS' if passed else 'FAIL'}] {id_} — {detail}")


def main() -> int:
    base = env("SUPABASE_URL").rstrip("/")
    anon = env("SUPABASE_ANON_KEY")
    client_id = env("TENANT_CLIENT_ID")
    email = env("TENANT_OWNER_EMAIL")
    password = env("TENANT_OWNER_PASSWORD")
    other_client = env("EXPECTED_OTHER_CLIENT_ID", "amalay")
    menu_min = int(env("EXPECT_MENU_MIN", "1"))
    staff_min = int(env("EXPECT_STAFF_MIN", "1"))

    missing = [k for k, v in {
        "SUPABASE_URL": base,
        "SUPABASE_ANON_KEY": anon,
        "TENANT_CLIENT_ID": client_id,
        "TENANT_OWNER_EMAIL": email,
        "TENANT_OWNER_PASSWORD": password,
    }.items() if not v]
    if missing:
        print("ERROR: missing env: " + ", ".join(missing), file=sys.stderr)
        return 2
    if PROD_REF in base:
        print(f"ERROR: refusing production project ref {PROD_REF}", file=sys.stderr)
        return 2

    results: list[Result] = []

    status, login = req(
        "POST",
        f"{base}/auth/v1/token?grant_type=password",
        {"apikey": anon},
        {"email": email, "password": password},
    )
    jwt = login.get("access_token") if isinstance(login, dict) else None
    auth_reason = "ok"
    if not jwt:
        if isinstance(login, dict):
            auth_reason = str(login.get("error_code") or login.get("error") or login.get("msg") or "denied")
        else:
            auth_reason = "denied"
    check(results, "auth-login", status == 200 and bool(jwt), f"status={status}, jwt={'SET' if jwt else 'MISSING'}, reason={auth_reason}")
    if not jwt:
        print(json.dumps({"status": "FAIL", "results": [asdict(r) for r in results]}, ensure_ascii=False))
        return 1

    status, clients = get_rows(base, anon, jwt, "clients", {"id": f"eq.{client_id}", "select": "id,display_name,data_source,mesas"})
    check(results, "client-visible", status == 200 and isinstance(clients, list) and len(clients) == 1,
          f"status={status}, rows={len(clients) if isinstance(clients, list) else 'ERR'}")

    status, other = get_rows(base, anon, jwt, "clients", {"id": f"eq.{other_client}", "select": "id"})
    check(results, "other-client-hidden", status == 200 and isinstance(other, list) and len(other) == 0,
          f"status={status}, rows={len(other) if isinstance(other, list) else 'ERR'}")

    status, staff = get_rows(base, anon, jwt, "pos_staff", {"client_id": f"eq.{client_id}", "select": "id,name,role", "limit": "100"})
    check(results, "staff-visible", status == 200 and isinstance(staff, list) and len(staff) >= staff_min,
          f"status={status}, rows={len(staff) if isinstance(staff, list) else 'ERR'}")

    status, menu = get_rows(base, anon, jwt, "pos_menu_items", {"client_id": f"eq.{client_id}", "select": "id,name,price", "limit": "200"})
    check(results, "menu-visible", status == 200 and isinstance(menu, list) and len(menu) >= menu_min,
          f"status={status}, rows={len(menu) if isinstance(menu, list) else 'ERR'}")

    status, foreign_orders = get_rows(base, anon, jwt, "pos_orders", {"client_id": f"eq.{other_client}", "select": "id,client_id", "limit": "1"})
    check(results, "foreign-orders-hidden", status == 200 and isinstance(foreign_orders, list) and len(foreign_orders) == 0,
          f"status={status}, rows={len(foreign_orders) if isinstance(foreign_orders, list) else 'ERR'}")

    status, own_orders = get_rows(base, anon, jwt, "pos_orders", {"client_id": f"eq.{client_id}", "select": "id,status,total", "limit": "10"})
    check(results, "own-orders-query-ok", status == 200 and isinstance(own_orders, list),
          f"status={status}, rows={len(own_orders) if isinstance(own_orders, list) else 'ERR'}")

    passed = sum(1 for r in results if r.passed)
    payload = {
        "status": "PASS" if passed == len(results) else "FAIL",
        "passed": passed,
        "total": len(results),
        "project_ref": urllib.parse.urlparse(base).netloc.split(".")[0],
        "client_id": client_id,
        "results": [asdict(r) for r in results],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if payload["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
