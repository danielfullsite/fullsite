#!/usr/bin/env python3
"""Quick check: what's in pago_metodos for recent days."""
import os, json, requests

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}

r = requests.get(f"{SUPABASE_URL}/rest/v1/wansoft_daily?select=fecha,pago_metodos,efectivo,tarjeta&order=fecha.desc&limit=10",
                  headers=headers, timeout=15)
rows = r.json() if r.ok else []
for row in rows:
    pm = row.get("pago_metodos")
    if isinstance(pm, str):
        pm = json.loads(pm) if pm else []
    print(f"{row['fecha']}: efectivo={row.get('efectivo')}, tarjeta={row.get('tarjeta')}, pago_metodos={json.dumps(pm)[:200] if pm else 'NULL'}")
