"""
SKEL-04 · Batch 0 — Tenant Isolation Test Suite
================================================
Verifies that RLS policies implemented in Batch 0 correctly isolate tenants.

DoD requirement: this suite must PASS before Batch 0 closes.

Usage
-----
  # Minimum: two separate tenant user credentials
  export SUPABASE_URL="https://qjiomlvudfmzuvqvhwpk.supabase.co"
  export SUPABASE_SERVICE_KEY="..."          # service_role key
  export TENANT_A_EMAIL="user@amalay.com"
  export TENANT_A_PASSWORD="..."
  export TENANT_A_CLIENT_ID="amalay"
  export TENANT_B_EMAIL="user@nomada.com"
  export TENANT_B_PASSWORD="..."
  export TENANT_B_CLIENT_ID="nomada"

  python scripts/sql/tests/isolation_test.py

  # Ephemeral mode: creates + deletes temporary test users automatically
  export EPHEMERAL=1
  python scripts/sql/tests/isolation_test.py

Exit codes
----------
  0  all tests PASS
  1  one or more tests FAIL
  2  setup/teardown error (environment issue, not a policy bug)
"""

import os
import sys
import json
import uuid
import time
import requests
from typing import Optional

# ── Config ────────────────────────────────────────────────────────────────────

SUPABASE_URL       = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY        = os.environ.get("SUPABASE_SERVICE_KEY", "")
TENANT_A_EMAIL     = os.environ.get("TENANT_A_EMAIL", "")
TENANT_A_PASSWORD  = os.environ.get("TENANT_A_PASSWORD", "")
TENANT_A_CLIENT_ID = os.environ.get("TENANT_A_CLIENT_ID", "amalay")
TENANT_B_EMAIL     = os.environ.get("TENANT_B_EMAIL", "")
TENANT_B_PASSWORD  = os.environ.get("TENANT_B_PASSWORD", "")
TENANT_B_CLIENT_ID = os.environ.get("TENANT_B_CLIENT_ID", "nomada")
EPHEMERAL          = os.environ.get("EPHEMERAL", "0") == "1"

REST   = f"{SUPABASE_URL}/rest/v1"
AUTH   = f"{SUPABASE_URL}/auth/v1"

SRO_HEADERS = {
    "apikey":         SERVICE_KEY,
    "Authorization":  f"Bearer {SERVICE_KEY}",
    "Content-Type":   "application/json",
}

# ── Helpers ───────────────────────────────────────────────────────────────────

PASS = 0
FAIL = 0
results: list[dict] = []

def record(name: str, passed: bool, detail: str = ""):
    global PASS, FAIL
    status = "PASS" if passed else "FAIL"
    if passed:
        PASS += 1
    else:
        FAIL += 1
    results.append({"test": name, "status": status, "detail": detail})
    sym = "✓" if passed else "✗"
    print(f"  {sym}  {name}")
    if not passed:
        print(f"       detail: {detail}")


def sro_get(table: str, params: dict = None) -> list:
    r = requests.get(f"{REST}/{table}", headers=SRO_HEADERS, params=params or {})
    r.raise_for_status()
    return r.json()


def sro_post(table: str, body: dict) -> dict:
    r = requests.post(
        f"{REST}/{table}",
        headers={**SRO_HEADERS, "Prefer": "return=representation"},
        json=body,
    )
    r.raise_for_status()
    return r.json()


def sro_delete(table: str, params: dict):
    r = requests.delete(f"{REST}/{table}", headers=SRO_HEADERS, params=params)
    r.raise_for_status()


def sign_in(email: str, password: str) -> Optional[str]:
    r = requests.post(
        f"{AUTH}/token?grant_type=password",
        headers={"apikey": SERVICE_KEY, "Content-Type": "application/json"},
        json={"email": email, "password": password},
    )
    if r.status_code != 200:
        return None
    return r.json().get("access_token")


def authed_get(token: str, table: str, params: dict = None) -> tuple[int, list]:
    headers = {
        "apikey":        SERVICE_KEY,   # anon key would be more realistic; service key as apikey is fine for REST
        "Authorization": f"Bearer {token}",
    }
    r = requests.get(f"{REST}/{table}", headers=headers, params=params or {})
    return r.status_code, (r.json() if r.status_code < 500 else [])


def anon_get(table: str, params: dict = None) -> tuple[int, list]:
    # anon: no Authorization header, just apikey
    headers = {"apikey": SERVICE_KEY}  # in Supabase, apikey alone = anon role
    r = requests.get(f"{REST}/{table}", headers=headers, params=params or {})
    return r.status_code, (r.json() if r.status_code < 500 else [])


def denied(code: int, data) -> bool:
    """True when access is correctly denied.

    Accepts either:
    - 401/403 (table-level REVOKE, no SELECT grant)
    - 200 + empty result set (RLS silently filters all rows)
    Both are valid outcomes depending on whether REVOKE or RLS-only was applied.
    """
    if code in (401, 403):
        return True
    return code == 200 and isinstance(data, list) and len(data) == 0


def create_admin_user(email: str, password: str, client_id: str) -> str:
    """Create user via service_role + insert into client_users. Returns user_id."""
    r = requests.post(
        f"{AUTH}/admin/users",
        headers=SRO_HEADERS,
        json={
            "email": email,
            "password": password,
            "email_confirm": True,
        },
    )
    r.raise_for_status()
    user_id = r.json()["id"]
    # add to client_users
    sro_post("client_users", {
        "id":        str(uuid.uuid4()),
        "user_id":   user_id,
        "client_id": client_id,
        "role":      "member",
    })
    return user_id


def delete_admin_user(user_id: str) -> bool:
    # Remove client_users rows first (FK: client_users.client_id → clients, not user_id,
    # but belt-and-suspenders to avoid leftover rows)
    try:
        sro_delete("client_users", {"user_id": f"eq.{user_id}"})
    except Exception:
        pass
    r = requests.delete(
        f"{AUTH}/admin/users/{user_id}",
        headers=SRO_HEADERS,
    )
    # 404 is fine (already deleted)
    if r.status_code not in (200, 204, 404):
        print(f"  WARNING: auth delete returned {r.status_code} for {user_id}")
        return False
    return True


# ── Setup ─────────────────────────────────────────────────────────────────────

def setup() -> tuple[str, str, list[str]]:
    """
    Returns (token_a, token_b, ephemeral_user_ids).
    ephemeral_user_ids is populated only when EPHEMERAL=1.
    """
    ephemeral_ids = []

    if not SUPABASE_URL or not SERVICE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY are required.")
        sys.exit(2)

    if EPHEMERAL:
        print("\n[setup] Creating ephemeral test users...")
        suffix = str(uuid.uuid4())[:8]
        email_a = f"test-isolation-a-{suffix}@fullsite-test.invalid"
        email_b = f"test-isolation-b-{suffix}@fullsite-test.invalid"
        pwd     = str(uuid.uuid4())

        # Ensure clients exist (they should; if not, create minimal rows)
        clients = sro_get("clients", {"id": f"in.({TENANT_A_CLIENT_ID},{TENANT_B_CLIENT_ID})"})
        existing = {c["id"] for c in clients}
        for cid in [TENANT_A_CLIENT_ID, TENANT_B_CLIENT_ID]:
            if cid not in existing:
                requests.post(
                    f"{REST}/clients",
                    headers={**SRO_HEADERS, "Prefer": "return=minimal"},
                    json={"id": cid, "display_name": f"Test {cid}"},
                ).raise_for_status()

        uid_a = create_admin_user(email_a, pwd, TENANT_A_CLIENT_ID)
        uid_b = create_admin_user(email_b, pwd, TENANT_B_CLIENT_ID)
        ephemeral_ids = [uid_a, uid_b]

        time.sleep(1)   # wait for auth propagation
        token_a = sign_in(email_a, pwd)
        token_b = sign_in(email_b, pwd)
    else:
        if not all([TENANT_A_EMAIL, TENANT_A_PASSWORD, TENANT_B_EMAIL, TENANT_B_PASSWORD]):
            print(
                "ERROR: set TENANT_A_EMAIL, TENANT_A_PASSWORD, TENANT_B_EMAIL, "
                "TENANT_B_PASSWORD or use EPHEMERAL=1."
            )
            sys.exit(2)
        token_a = sign_in(TENANT_A_EMAIL, TENANT_A_PASSWORD)
        token_b = sign_in(TENANT_B_EMAIL, TENANT_B_PASSWORD)

    if not token_a:
        print(f"ERROR: could not sign in as tenant A ({TENANT_A_CLIENT_ID})")
        sys.exit(2)
    if not token_b:
        print(f"ERROR: could not sign in as tenant B ({TENANT_B_CLIENT_ID})")
        sys.exit(2)

    return token_a, token_b, ephemeral_ids


def teardown(ephemeral_ids: list[str]):
    if not ephemeral_ids:
        return
    print("\n[teardown] Removing ephemeral test users...")
    for uid in ephemeral_ids:
        ok = delete_admin_user(uid)
        print(f"  {'deleted' if ok else 'partial cleanup'} {uid}")


# ── Test Cases ────────────────────────────────────────────────────────────────

def run_tests(token_a: str, token_b: str):
    print(f"\n── Group 1: anon access (expect empty / denied) ──")

    # anon: clients
    code, data = anon_get("clients")
    record(
        "anon cannot read clients",
        denied(code, data),
        f"status={code} rows={len(data) if isinstance(data, list) else data}",
    )

    # anon: credentials_vault (FORCE RLS + no policy)
    code, data = anon_get("credentials_vault")
    record(
        "anon cannot read credentials_vault",
        denied(code, data),
        f"status={code} rows={len(data) if isinstance(data, list) else data}",
    )

    # anon: chat_logs
    code, data = anon_get("chat_logs")
    record(
        "anon cannot read chat_logs",
        denied(code, data),
        f"status={code} rows={len(data) if isinstance(data, list) else data}",
    )

    # anon: agent_runs
    code, data = anon_get("agent_runs")
    record(
        "anon cannot read agent_runs",
        denied(code, data),
        f"status={code} rows={len(data) if isinstance(data, list) else data}",
    )

    # anon: delivery_orders
    code, data = anon_get("delivery_orders")
    record(
        "anon cannot read delivery_orders",
        denied(code, data),
        f"status={code} rows={len(data) if isinstance(data, list) else data}",
    )

    # anon: pos_bridge_logs
    code, data = anon_get("pos_bridge_logs")
    record(
        "anon cannot read pos_bridge_logs",
        denied(code, data),
        f"status={code} rows={len(data) if isinstance(data, list) else data}",
    )

    print(f"\n── Group 2: tenant A reads own data ──")

    # tenant A can read own client record
    code, data = authed_get(token_a, "clients")
    own_clients = [r for r in data if isinstance(r, dict) and r.get("id") == TENANT_A_CLIENT_ID]
    record(
        f"tenant A can read own client ({TENANT_A_CLIENT_ID})",
        code == 200 and len(own_clients) >= 1,
        f"status={code} own_rows={len(own_clients)} total_returned={len(data) if isinstance(data, list) else data}",
    )

    # tenant A cannot see tenant B in clients
    other_clients = [r for r in data if isinstance(r, dict) and r.get("id") == TENANT_B_CLIENT_ID]
    record(
        f"tenant A cannot see tenant B client ({TENANT_B_CLIENT_ID})",
        len(other_clients) == 0,
        f"rows_with_B_id={len(other_clients)}",
    )

    print(f"\n── Group 3: tenant B reads own data ──")

    # tenant B can read own client record
    code, data = authed_get(token_b, "clients")
    own_clients_b = [r for r in data if isinstance(r, dict) and r.get("id") == TENANT_B_CLIENT_ID]
    record(
        f"tenant B can read own client ({TENANT_B_CLIENT_ID})",
        code == 200 and len(own_clients_b) >= 1,
        f"status={code} own_rows={len(own_clients_b)} total_returned={len(data) if isinstance(data, list) else data}",
    )

    # tenant B cannot see tenant A in clients
    other_clients_a = [r for r in data if isinstance(r, dict) and r.get("id") == TENANT_A_CLIENT_ID]
    record(
        f"tenant B cannot see tenant A client ({TENANT_A_CLIENT_ID})",
        len(other_clients_a) == 0,
        f"rows_with_A_id={len(other_clients_a)}",
    )

    print(f"\n── Group 4: P-SRO tables — authenticated gets empty ──")

    # authenticated (tenant A): credentials_vault must be empty (FORCE RLS + no policy)
    code, data = authed_get(token_a, "credentials_vault")
    record(
        "authenticated (A) cannot read credentials_vault",
        denied(code, data),
        f"status={code} rows={len(data) if isinstance(data, list) else data}",
    )

    # authenticated (tenant A): agent_runs must be empty (P-SRO)
    code, data = authed_get(token_a, "agent_runs")
    record(
        "authenticated (A) cannot read agent_runs",
        denied(code, data),
        f"status={code} rows={len(data) if isinstance(data, list) else data}",
    )

    # authenticated (tenant A): delivery_orders must be empty (P-SRO)
    code, data = authed_get(token_a, "delivery_orders")
    record(
        "authenticated (A) cannot read delivery_orders",
        denied(code, data),
        f"status={code} rows={len(data) if isinstance(data, list) else data}",
    )

    # authenticated (tenant B): credentials_vault must be empty
    code, data = authed_get(token_b, "credentials_vault")
    record(
        "authenticated (B) cannot read credentials_vault",
        denied(code, data),
        f"status={code} rows={len(data) if isinstance(data, list) else data}",
    )

    print(f"\n── Group 5: service_role still operational ──")

    # service_role: can read credentials_vault (bypassrls)
    rows = sro_get("credentials_vault")
    record(
        "service_role can read credentials_vault (bypassrls)",
        isinstance(rows, list),
        f"rows={len(rows)}",
    )

    # service_role: can read clients
    rows = sro_get("clients")
    record(
        "service_role can read all clients",
        isinstance(rows, list) and len(rows) >= 1,
        f"rows={len(rows)}",
    )

    # service_role: can read agent_runs
    rows = sro_get("agent_runs", {"limit": "1"})
    record(
        "service_role can read agent_runs",
        isinstance(rows, list),
        f"rows_sample={len(rows)}",
    )

    print(f"\n── Group 6: chat_logs isolation ──")

    # Insert a chat_log row as tenant A (via service_role, then verify A sees it, B doesn't)
    test_row_id = str(uuid.uuid4())
    try:
        requests.post(
            f"{REST}/chat_logs",
            headers={**SRO_HEADERS, "Prefer": "return=minimal"},
            json={
                "id":           test_row_id,
                "client_id":    TENANT_A_CLIENT_ID,
                "user_id":      _get_user_id_from_token(token_a),
                "user_message": "isolation-test-sentinel",
                "ai_response":  "isolation-test-response",
            },
        ).raise_for_status()

        # tenant A should see the row
        code_a, data_a = authed_get(token_a, "chat_logs", {"id": f"eq.{test_row_id}"})
        record(
            "tenant A can read own chat_log row",
            code_a == 200 and len(data_a) == 1,
            f"status={code_a} rows={len(data_a) if isinstance(data_a, list) else data_a}",
        )

        # tenant B should NOT see the row
        code_b, data_b = authed_get(token_b, "chat_logs", {"id": f"eq.{test_row_id}"})
        record(
            "tenant B cannot read tenant A chat_log row",
            code_b == 200 and len(data_b) == 0,
            f"status={code_b} rows={len(data_b) if isinstance(data_b, list) else data_b}",
        )
    finally:
        # cleanup sentinel row
        try:
            sro_delete("chat_logs", {"id": f"eq.{test_row_id}"})
        except Exception:
            pass


def _get_user_id_from_token(token: str) -> str:
    """Decode user_id from JWT without verification (public claim)."""
    try:
        import base64
        payload = token.split(".")[1]
        # add padding
        payload += "=" * (4 - len(payload) % 4)
        decoded = json.loads(base64.b64decode(payload))
        return decoded.get("sub", "")
    except Exception:
        return ""


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("═══════════════════════════════════════════════════════")
    print("  SKEL-04 Batch 0 — Tenant Isolation Test Suite")
    print(f"  Tenant A: {TENANT_A_CLIENT_ID}")
    print(f"  Tenant B: {TENANT_B_CLIENT_ID}")
    print(f"  Supabase: {SUPABASE_URL}")
    print("═══════════════════════════════════════════════════════")

    token_a, token_b, ephemeral_ids = setup()

    try:
        run_tests(token_a, token_b)
    finally:
        teardown(ephemeral_ids)

    print("\n═══════════════════════════════════════════════════════")
    total = PASS + FAIL
    print(f"  Results: {PASS}/{total} PASS  |  {FAIL}/{total} FAIL")
    if FAIL == 0:
        print("  ISOLATION TEST SUITE: ✓ PASS")
    else:
        print("  ISOLATION TEST SUITE: ✗ FAIL")
        print("\n  Failed tests:")
        for r in results:
            if r["status"] == "FAIL":
                print(f"    - {r['test']}: {r['detail']}")
    print("═══════════════════════════════════════════════════════\n")

    sys.exit(0 if FAIL == 0 else 1)


if __name__ == "__main__":
    main()
