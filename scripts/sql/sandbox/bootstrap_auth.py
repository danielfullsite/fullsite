#!/usr/bin/env python3
"""
SKEL-01 sandbox auth bootstrap.

Creates auth users and client_users rows in the fullsite-sandbox Supabase project.
Run AFTER applying all *_sandbox.sql migrations and SKEL-01_seed_vantara.sql.

Usage:
    export NEXT_PUBLIC_SUPABASE_URL_SANDBOX="https://<ref>.supabase.co"
    export SANDBOX_SERVICE_KEY="<service-role-key>"
    python3 scripts/sql/sandbox/bootstrap_auth.py

Idempotent: if the email already exists the script reports it and skips creation.
Never commits secrets to git. Never touches the AMALAY project.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

AMALAY_PROJECT_REF = "qjiomlvudfmzuvqvhwpk"

USERS = [
    {
        "email": "owner@vantara.sandbox",
        "password": "Vantara2026!",          # change before real demo
        "client_id": "vantara",
        "role": "dueño",
        "display": "VANTARA owner",
    },
    {
        "email": "test@nomada.sandbox",
        "password": "Nomada2026!",
        "client_id": "nomada-mini",
        "role": "dueño",
        "display": "NÓMADA-MINI owner (isolation test)",
    },
]


def env_or_die(name):
    v = os.environ.get(name, "")
    if not v:
        print(f"ERROR: {name} is not set or empty", file=sys.stderr)
        sys.exit(1)
    return v


def http_json(method, url, body, headers):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode(errors="replace")
        return e.code, body_text


def main():
    url = env_or_die("NEXT_PUBLIC_SUPABASE_URL_SANDBOX").rstrip("/")
    service_key = env_or_die("SANDBOX_SERVICE_KEY")

    # Guard: refuse to touch AMALAY production
    if AMALAY_PROJECT_REF in url:
        print(f"ERROR: URL apunta al proyecto de producción AMALAY ({AMALAY_PROJECT_REF}).", file=sys.stderr)
        print("Este script solo debe ejecutarse contra fullsite-sandbox.", file=sys.stderr)
        sys.exit(1)

    # Guard: service key must differ from anon key (if anon key also in env)
    anon_key = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY_SANDBOX", "")
    if anon_key and service_key == anon_key:
        print("ERROR: SANDBOX_SERVICE_KEY y NEXT_PUBLIC_SUPABASE_ANON_KEY_SANDBOX son idénticos.", file=sys.stderr)
        print("Usar la service_role key desde Supabase Dashboard → Settings → API.", file=sys.stderr)
        sys.exit(1)

    auth_headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    rest_headers = {
        **auth_headers,
        "Prefer": "return=representation",
    }

    print(f"\nfullsite-sandbox bootstrap — {url}")
    print(f"Creating {len(USERS)} users...\n")

    created = []
    for u in USERS:
        # Create auth user via admin API
        status, resp = http_json(
            "POST",
            f"{url}/auth/v1/admin/users",
            {
                "email": u["email"],
                "password": u["password"],
                "email_confirm": True,
            },
            auth_headers,
        )

        if status == 200 or status == 201:
            user_id = resp["id"]
            print(f"  CREATED  {u['email']}  id={user_id}")
            created.append({**u, "user_id": user_id})
        elif status == 422 and "already" in str(resp).lower():
            # User exists — look it up
            print(f"  EXISTS   {u['email']} — fetching existing id")
            s2, r2 = http_json(
                "GET",
                f"{url}/auth/v1/admin/users?email={urllib.parse.quote(u['email'])}",
                None,
                auth_headers,
            )
            if s2 == 200 and isinstance(r2, list) and r2:
                user_id = r2[0]["id"]
                print(f"           id={user_id}")
                created.append({**u, "user_id": user_id})
            else:
                print(f"  WARNING  Could not fetch existing user {u['email']}: {r2}", file=sys.stderr)
        else:
            print(f"  ERROR    {u['email']}: HTTP {status} — {resp}", file=sys.stderr)
            sys.exit(1)

    print()

    # Insert client_users rows (idempotent via ON CONFLICT DO NOTHING equivalent)
    # Use PostgREST upsert with Prefer: resolution=ignore-duplicates
    rest_headers_upsert = {
        **rest_headers,
        "Prefer": "resolution=ignore-duplicates,return=representation",
    }

    for u in created:
        status, resp = http_json(
            "POST",
            f"{url}/rest/v1/client_users",
            {
                "user_id": u["user_id"],
                "client_id": u["client_id"],
                "role": u["role"],
            },
            rest_headers_upsert,
        )
        if status in (200, 201):
            rows = resp if isinstance(resp, list) else [resp]
            if rows:
                print(f"  LINKED   {u['email']} → client_users(client_id={u['client_id']}, role={u['role']})")
            else:
                print(f"  SKIPPED  {u['email']} → client_users row already exists")
        else:
            print(f"  ERROR    client_users for {u['email']}: HTTP {status} — {resp}", file=sys.stderr)
            sys.exit(1)

    print()
    print("Bootstrap complete.")
    print()
    print("Verify with:")
    print(f"  curl -H 'apikey: $SANDBOX_SERVICE_KEY' -H 'Authorization: Bearer $SANDBOX_SERVICE_KEY' \\")
    print(f"    '{url}/rest/v1/client_users?select=user_id,client_id,role'")


if __name__ == "__main__":
    main()
