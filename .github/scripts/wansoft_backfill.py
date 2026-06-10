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
    if "Dashboard" not in resp.url and "MyDocumentsList" not in resp.url:
        raise Exception(f"Login failed: {resp.url}")
    return s


def parse_num(s):
    """Parse '$1,234.56' or '1234.56' to float."""
    try:
        return float(str(s).replace("$", "").replace(",", "").replace("%", "").strip())
    except (ValueError, TypeError):
        return 0


def scrape_day(session, date_str):
    """Scrape SalesByBranch (single endpoint with ALL data) for one day.
    This is the same report as Wansoft app's 'Ventas por Sucursal'."""
    row = {"fecha": date_str, "client_slug": CLIENT_ID, "updated_at": datetime.now(timezone.utc).isoformat()}

    # 1. Consolidated (for ventas, brutas, descuentos — JSON, most reliable)
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

    # 2. Individual endpoints (reliable, well-tested)
    # Order Types: cols[2]=PERSONAS, cols[3]=ORDENES (verified by audit)
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
                    total_personas += int(cols[2])
                    total_ordenes += int(cols[3])
                except (ValueError, IndexError):
                    pass
        row["tickets_count"] = total_ordenes
        row["personas_restaurant"] = total_personas
        if total_personas > 0 and row.get("ventas_dia"):
            row["ticket_promedio_restaurant"] = round(row["ventas_dia"] / total_personas, 2)
    except Exception as e:
        print(f"  [!] OrderTypes failed: {e}")

    # 3. Meseros
    _excl = [e.lower() for e in (CLIENT.get("staff_exclude_meseros") or []) + (CLIENT.get("staff_market") or [])]
    try:
        r = session.post(f"{WANSOFT_URL}/Reports/SalesByUser", data={
            "subsidiaryId": SUBSIDIARY_ID, "startDate": date_str, "endDate": date_str,
        }, timeout=15)
        meseros = []
        for tr in BeautifulSoup(r.text, "html.parser").select(".rowReport"):
            cols = [c.text.strip() for c in tr.select("div")]
            if len(cols) >= 4:
                name = cols[0]
                if any(ex in name.lower() for ex in _excl):
                    continue
                total = parse_num(cols[3])
                if total > 0:
                    meseros.append({"nombre": name, "total": total})
        if meseros:
            row["meseros"] = json.dumps(meseros)
    except Exception as e:
        print(f"  [!] Meseros failed: {e}")

    # 4. Groups
    try:
        r = session.post(f"{WANSOFT_URL}/Reports/SalesByGroup", data={
            "subsidiaryId": SUBSIDIARY_ID, "startDate": date_str, "endDate": date_str,
        }, timeout=15)
        grupos = []
        for tr in BeautifulSoup(r.text, "html.parser").select(".rowReport"):
            cols = [c.text.strip() for c in tr.select("div")]
            if len(cols) >= 4:
                total = parse_num(cols[3])
                if cols[0] and total > 0:
                    grupos.append({"nombre": cols[0], "total": total})
        if grupos:
            row["ventas_por_grupo"] = json.dumps(grupos)
    except Exception as e:
        print(f"  [!] Groups failed: {e}")

    # 5. Payments: cols[1]=$MXN, cols[2]=pct
    try:
        r = session.post(f"{WANSOFT_URL}/Reports/SalesByPaymentType", data={
            "subsidiaryId": SUBSIDIARY_ID, "startDate": date_str, "endDate": date_str,
        }, timeout=15)
        pagos = []
        for tr in BeautifulSoup(r.text, "html.parser").select(".rowReport"):
            cols = [c.text.strip() for c in tr.select("div")]
            if len(cols) >= 2:
                mxn = parse_num(cols[1])
                pct = parse_num(cols[2]) if len(cols) >= 3 else 0
                if cols[0] and mxn > 0:
                    pagos.append({"nombre": cols[0], "total": round(mxn, 2), "pct": round(pct, 1)})
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
        platillos = []
        for tr in BeautifulSoup(r.text, "html.parser").select(".rowReport"):
            cols = [c.text.strip() for c in tr.select("div")]
            if len(cols) >= 4:
                try:
                    qty = int(cols[1])
                    total = parse_num(cols[3])
                    if cols[0] and total > 0:
                        platillos.append({"nombre": cols[0], "cantidad": qty, "total": total})
                except (ValueError, IndexError):
                    pass
        if platillos:
            row["platillos_top"] = json.dumps(sorted(platillos, key=lambda x: -x["total"])[:30])
    except Exception as e:
        print(f"  [!] Platillos failed: {e}")

    # 7. Ventas por hora
    try:
        r = session.post(f"{WANSOFT_URL}/Reports/SalesByHours", data={
            "subsidiaryId": SUBSIDIARY_ID, "startDate": date_str, "endDate": date_str,
        }, timeout=15)
        hours_data = []
        for tr in BeautifulSoup(r.text, "html.parser").select(".rowReport"):
            cols = [c.text.strip() for c in tr.select("div")]
            if len(cols) >= 5:
                hours_data.append({"hora": cols[0], "subtotal": cols[1], "iva": cols[2], "total": cols[3], "pct": cols[4]})
        if hours_data:
            row["_hourly"] = hours_data  # saved separately
    except Exception as e:
        print(f"  [!] Hours failed: {e}")

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

            # Extract hourly data before upsert (not part of wansoft_daily)
            hourly = row.pop("_hourly", None)

            ventas = row.get("ventas_dia", 0)
            if ventas and ventas > 0:
                ok = upsert_row(row)
                # Save hourly data separately
                if hourly and ok:
                    try:
                        _h = {**sb_headers, "Prefer": "return=minimal"}
                        dr = requests.delete(f"{SUPABASE_URL}/rest/v1/wansoft_hourly?fecha=eq.{date_str}&client_id=eq.{CLIENT_ID}", headers=_h, timeout=10)
                        ir = requests.post(f"{SUPABASE_URL}/rest/v1/wansoft_hourly", headers=_h,
                            json={"fecha": date_str, "client_id": CLIENT_ID, "data": json.dumps(hourly),
                                  "updated_at": datetime.now(timezone.utc).isoformat()}, timeout=10)
                        if ir.status_code >= 400:
                            print(f"  [!] Hourly save failed: {ir.status_code} {ir.text[:200]}")
                        else:
                            print(f"  [h] Hourly saved ({len(hourly)} hours)")
                    except Exception as e:
                        print(f"  [!] Hourly error: {e}")
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
