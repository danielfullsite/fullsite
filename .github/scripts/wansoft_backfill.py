#!/usr/bin/env python3
"""
Wansoft Backfill — Re-scrapes historical dates from Wansoft and updates wansoft_daily.
Ensures ALL data matches Wansoft exactly. No manual SQL needed.

Usage:
  gh workflow run wansoft-backfill.yml -f start_date=2026-06-01 -f end_date=2026-06-05
  gh workflow run wansoft-backfill.yml  # defaults to last 7 days
"""

import os
import sys
import json
import requests
from datetime import datetime, timedelta, timezone
from bs4 import BeautifulSoup
from client_config import get_client, get_tz, get_wansoft_creds

CLIENT = get_client()
MX_TZ = get_tz(CLIENT)
SUBSIDIARY_ID, WANSOFT_USER, WANSOFT_PASS = get_wansoft_creds(CLIENT)
WANSOFT_URL = "https://www.wansoft.net/Wansoft.Web"
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
sb_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates,return=minimal",
}
CLIENT_ID = CLIENT.get("id", "amalay")


def wansoft_login():
    s = requests.Session()
    s.get(f"{WANSOFT_URL}/", timeout=15)
    resp = s.post(f"{WANSOFT_URL}/", data={
        "UserName": WANSOFT_USER, "Password": WANSOFT_PASS,
    }, allow_redirects=True, timeout=15)
    if "Dashboard" not in resp.url:
        raise Exception(f"Login failed: {resp.url}")
    return s


def scrape_day(session, date_str):
    """Scrape ALL Wansoft endpoints for a single day. Returns dict matching wansoft_daily schema."""
    row = {"fecha": date_str, "client_slug": CLIENT_ID, "updated_at": datetime.now(timezone.utc).isoformat()}

    # 1. Consolidated Sales (ventas, brutas, descuentos)
    try:
        r = session.post(f"{WANSOFT_URL}/Reports/GetConsolidatedSales", data={
            "subsidiaryId": SUBSIDIARY_ID, "startDate": date_str, "endDate": date_str,
        }, timeout=15)
        c = r.json()
        row["ventas_dia"] = c.get("TotalSales", 0)
        row["ventas_brutas"] = c.get("TotalGrossSales", 0)
        row["descuentos"] = c.get("TotalDiscount", 0)
    except Exception as e:
        print(f"  [!] Consolidated failed: {e}")

    # 2. Order Types (ordenes, personas)
    # CRITICAL: cols[2]=PERSONAS, cols[3]=ORDENES (verified by audit)
    try:
        r = session.post(f"{WANSOFT_URL}/Reports/SalesByTypeOfOrder", data={
            "subsidiaryId": SUBSIDIARY_ID, "startDate": date_str, "endDate": date_str,
        }, timeout=15)
        soup = BeautifulSoup(r.text, "html.parser")
        total_ordenes = 0
        total_personas = 0
        for tr in soup.select(".rowReport"):
            cols = [c.text.strip() for c in tr.select("div")]
            if len(cols) >= 4:
                try:
                    personas = int(cols[2])
                    ordenes = int(cols[3])
                    total_personas += personas
                    total_ordenes += ordenes
                except (ValueError, IndexError):
                    pass
        row["tickets_count"] = total_ordenes
        row["personas_restaurant"] = total_personas
        if total_personas > 0 and row.get("ventas_dia"):
            row["ticket_promedio_restaurant"] = round(row["ventas_dia"] / total_personas, 2)
    except Exception as e:
        print(f"  [!] OrderTypes failed: {e}")

    # 3. Meseros
    try:
        r = session.post(f"{WANSOFT_URL}/Reports/SalesByUser", data={
            "subsidiaryId": SUBSIDIARY_ID, "startDate": date_str, "endDate": date_str,
        }, timeout=15)
        soup = BeautifulSoup(r.text, "html.parser")
        _excl = [e.lower() for e in (CLIENT.get("staff_exclude_meseros") or []) + (CLIENT.get("staff_market") or [])]
        meseros = []
        for tr in soup.select(".rowReport"):
            cols = [c.text.strip() for c in tr.select("div")]
            if len(cols) >= 4:
                name = cols[0]
                if any(ex in name.lower() for ex in _excl):
                    continue
                try:
                    total = float(cols[3].replace("$", "").replace(",", ""))
                    if total > 0:
                        meseros.append({"nombre": name, "total": total})
                except (ValueError, IndexError):
                    pass
        if meseros:
            row["meseros"] = json.dumps(meseros)
    except Exception as e:
        print(f"  [!] Meseros failed: {e}")

    # 4. Groups
    try:
        r = session.post(f"{WANSOFT_URL}/Reports/SalesByGroup", data={
            "subsidiaryId": SUBSIDIARY_ID, "startDate": date_str, "endDate": date_str,
        }, timeout=15)
        soup = BeautifulSoup(r.text, "html.parser")
        grupos = []
        for tr in soup.select(".rowReport"):
            cols = [c.text.strip() for c in tr.select("div")]
            if len(cols) >= 4:
                try:
                    name = cols[0]
                    total = float(cols[3].replace("$", "").replace(",", ""))
                    if name and total > 0:
                        grupos.append({"nombre": name, "total": total})
                except (ValueError, IndexError):
                    pass
        if grupos:
            row["ventas_por_grupo"] = json.dumps(grupos)
    except Exception as e:
        print(f"  [!] Groups failed: {e}")

    # 5. Payment methods
    try:
        r = session.post(f"{WANSOFT_URL}/Reports/SalesByPaymentType", data={
            "subsidiaryId": SUBSIDIARY_ID, "startDate": date_str, "endDate": date_str,
        }, timeout=15)
        soup = BeautifulSoup(r.text, "html.parser")
        pagos = []
        for tr in soup.select(".rowReport"):
            cols = [c.text.strip() for c in tr.select("div")]
            if len(cols) >= 2:
                name = cols[0]
                try:
                    mxn = float(cols[1].replace("$", "").replace(",", ""))
                    pct = float(cols[2].replace("%", "")) if len(cols) >= 3 else 0
                    if name and mxn > 0:
                        pagos.append({"nombre": name, "total": round(mxn, 2), "pct": round(pct, 1)})
                except (ValueError, IndexError):
                    pass
        if pagos:
            row["pago_metodos"] = json.dumps(pagos)
            for p in pagos:
                nm = p["nombre"].lower()
                if "efectivo" in nm:
                    row["efectivo"] = p["total"]
                elif "tarjeta" in nm or "crédito" in nm or "débito" in nm:
                    row["tarjeta"] = row.get("tarjeta", 0) + p["total"]
    except Exception as e:
        print(f"  [!] Payments failed: {e}")

    # 6. Top platillos
    try:
        r = session.post(f"{WANSOFT_URL}/Reports/SalesBySaucer", data={
            "subsidiaryId": SUBSIDIARY_ID, "startDate": date_str, "endDate": date_str,
        }, timeout=15)
        soup = BeautifulSoup(r.text, "html.parser")
        platillos = []
        for tr in soup.select(".rowReport"):
            cols = [c.text.strip() for c in tr.select("div")]
            if len(cols) >= 4:
                try:
                    name = cols[0]
                    qty = int(cols[1])
                    total = float(cols[3].replace("$", "").replace(",", ""))
                    if name and total > 0:
                        platillos.append({"nombre": name, "cantidad": qty, "total": total})
                except (ValueError, IndexError):
                    pass
        if platillos:
            row["platillos_top"] = json.dumps(sorted(platillos, key=lambda x: -x["total"])[:30])
    except Exception as e:
        print(f"  [!] Platillos failed: {e}")

    return row


def upsert_row(row):
    """Upsert a row to wansoft_daily."""
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/wansoft_daily",
        headers=sb_headers,
        json=row,
        timeout=15,
    )
    if r.status_code >= 400:
        # Try PATCH instead
        fecha = row.pop("fecha", None)
        r = requests.patch(
            f"{SUPABASE_URL}/rest/v1/wansoft_daily?fecha=eq.{fecha}&client_slug=eq.{CLIENT_ID}",
            headers=sb_headers,
            json=row,
            timeout=15,
        )
    return r.status_code < 400


def main():
    now_mx = datetime.now(MX_TZ)
    start = os.environ.get("START_DATE", (now_mx - timedelta(days=7)).strftime("%Y-%m-%d"))
    end = os.environ.get("END_DATE", (now_mx - timedelta(days=1)).strftime("%Y-%m-%d"))

    print(f"{'=' * 60}")
    print(f"WANSOFT BACKFILL: {start} → {end}")
    print(f"{'=' * 60}")

    session = wansoft_login()
    print("Login OK\n")

    current = datetime.strptime(start, "%Y-%m-%d")
    end_dt = datetime.strptime(end, "%Y-%m-%d")
    success = 0
    errors = 0

    while current <= end_dt:
        date_str = current.strftime("%Y-%m-%d")
        print(f"[{date_str}] Scraping...")

        try:
            row = scrape_day(session, date_str)

            ventas = row.get("ventas_dia", 0)
            if ventas and ventas > 0:
                ok = upsert_row(row)
                ordenes = row.get("tickets_count", "?")
                personas = row.get("personas_restaurant", "?")
                tp = row.get("ticket_promedio_restaurant", "?")
                print(f"  ✓ Ventas=${ventas:,.0f}, {ordenes} ordenes, {personas} personas, TP=${tp} {'— SAVED' if ok else '— SAVE FAILED'}")
                if ok:
                    success += 1
                else:
                    errors += 1
            else:
                print(f"  — No sales data (restaurant closed?)")
        except Exception as e:
            print(f"  ✗ ERROR: {e}")
            errors += 1

        current += timedelta(days=1)

    print(f"\n{'=' * 60}")
    print(f"BACKFILL COMPLETE: {success} days updated, {errors} errors")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
