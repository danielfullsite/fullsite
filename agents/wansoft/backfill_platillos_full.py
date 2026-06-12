#!/usr/bin/env python3
"""One-off: backfill wansoft_data.platillos_full (full SalesBySaucer list incl. Market)
for June 1 → today. Credentials read from .env files, never printed."""
import json
import sys
from datetime import date, timedelta
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# Load env from known .env files without printing values
env = {}
for p in [Path.home() / "fullsite/agents/wansoft-explorer/.env",
          Path.home() / "fullsite/agents/wansoft/.env"]:
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env.setdefault(k.strip(), v.strip().strip('"').strip("'"))

WANSOFT_URL = "https://www.wansoft.net/Wansoft.Web"
USER = env.get("WANSOFT_USER") or env.get("WANSOFT_USERNAME")
PWD = env.get("WANSOFT_PASSWORD") or env.get("WANSOFT_PASS")
SUBSIDIARY_ID = env.get("WANSOFT_SUBSIDIARY_ID") or env.get("SUBSIDIARY_ID")
SB_URL = (env.get("SUPABASE_URL") or "https://qjiomlvudfmzuvqvhwpk.supabase.co").rstrip("/")
SB_KEY = env.get("SUPABASE_SERVICE_KEY") or env.get("SUPABASE_KEY")

if not SUBSIDIARY_ID and SB_KEY:
    cr = requests.get(f"{SB_URL}/rest/v1/clients?id=eq.amalay&select=wansoft_subsidiary_id",
                      headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"}, timeout=15)
    if cr.ok and cr.json():
        SUBSIDIARY_ID = cr.json()[0].get("wansoft_subsidiary_id")
print(f"Subsidiary ID: {SUBSIDIARY_ID}")

missing = [n for n, v in [("WANSOFT_USER", USER), ("WANSOFT_PASSWORD", PWD), ("SUPABASE_SERVICE_KEY", SB_KEY)] if not v]
if missing:
    print(f"Missing env vars: {missing}")
    sys.exit(1)

s = requests.Session()
s.get(f"{WANSOFT_URL}/", timeout=30)
r = s.post(f"{WANSOFT_URL}/", data={"UserName": USER, "Password": PWD},
           allow_redirects=True, timeout=30)
print(f"Login: {r.status_code} → {r.url}")
if "Dashboard" not in r.url and "MyDocumentsList" not in r.url:
    print("Login FAILED (no redirect to Dashboard)")
    sys.exit(1)

sb_h = {"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}",
        "Content-Type": "application/json", "Prefer": "return=minimal"}
wd_base = f"{SB_URL}/rest/v1/wansoft_data"

d = date(2026, 6, 1)
today = date.today()
while d <= today:
    ds = d.isoformat()
    rr = s.post(f"{WANSOFT_URL}/Reports/SalesBySaucer",
                data={"subsidiaryId": SUBSIDIARY_ID, "startDate": ds, "endDate": ds}, timeout=60)
    soup = BeautifulSoup(rr.text, "html.parser")
    items = []
    for row in soup.select(".rowReport"):
        cols = [c.text.strip() for c in row.select("div")]
        if len(cols) >= 4 and cols[0]:
            try:
                total = float(cols[3].replace("$", "").replace(",", ""))
            except ValueError:
                total = 0
            try:
                qty = int(cols[1])
            except (ValueError, IndexError):
                qty = 0
            items.append({"nombre": cols[0], "cantidad": qty, "total": total})
    items.sort(key=lambda x: -x["total"])
    if not items:
        print(f"{ds}: 0 items — skip")
        d += timedelta(days=1)
        continue
    flt = f"client_id=eq.amalay&fecha=eq.{ds}&data_key=eq.platillos_full"
    payload = {"data": items}
    s2 = requests.patch(f"{wd_base}?{flt}", headers=sb_h, json=payload, timeout=15)
    chk = requests.get(f"{wd_base}?{flt}&select=data_key",
                       headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"}, timeout=15)
    if chk.ok and not chk.json():
        ins = requests.post(wd_base, headers=sb_h,
                            json={"client_id": "amalay", "fecha": ds, "data_key": "platillos_full", **payload},
                            timeout=15)
        print(f"{ds}: INSERT {ins.status_code} ({len(items)} items)")
    else:
        print(f"{ds}: PATCH {s2.status_code} ({len(items)} items)")
    # Quick sanity: does Smarty appear?
    smarty = [i for i in items if "smarty" in i["nombre"].lower()]
    if smarty:
        print(f"  → Smarty: {smarty}")
    d += timedelta(days=1)
print("Done")
