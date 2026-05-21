#!/usr/bin/env python3
"""One-shot: add a POS staff user via Supabase REST API."""
import os
import sys
import requests

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

name = os.environ.get("STAFF_NAME", "Eduardo")
pin = os.environ.get("STAFF_PIN", "4567")
role = os.environ.get("STAFF_ROLE", "consultor")
client_id = os.environ.get("CLIENT_ID", "amalay")

headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates,return=representation",
}

import uuid
staff_id = os.environ.get("STAFF_ID", str(uuid.uuid4())[:8])

r = requests.post(
    f"{SUPABASE_URL}/rest/v1/pos_staff",
    headers=headers,
    json={"id": staff_id, "name": name, "pin": pin, "role": role, "active": True, "client_id": client_id},
    timeout=15,
)

if r.ok:
    data = r.json()
    print(f"[OK] User '{name}' added/updated. PIN: {pin}, Role: {role}")
    if data:
        print(f"  ID: {data[0].get('id', '?')}")
else:
    print(f"[ERROR] {r.status_code}: {r.text[:300]}")
    sys.exit(1)
