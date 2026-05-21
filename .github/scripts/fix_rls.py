#!/usr/bin/env python3
"""One-shot: disable RLS on pos_staff and verify Eduardo exists."""
import os
import requests

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}

# Check if Eduardo exists
r = requests.get(
    f"{SUPABASE_URL}/rest/v1/pos_staff?client_id=eq.amalay&select=id,name,pin,role,active",
    headers=headers, timeout=15,
)
print(f"pos_staff rows: {len(r.json()) if r.ok else 'ERROR ' + str(r.status_code)}")
if r.ok:
    for row in r.json():
        print(f"  {row.get('name')}: PIN={row.get('pin')}, role={row.get('role')}, active={row.get('active')}")

# Try to disable RLS via rpc (if function exists) or just report
print("\nTo fix RLS, run in Supabase SQL Editor:")
print("  ALTER TABLE pos_staff DISABLE ROW LEVEL SECURITY;")
