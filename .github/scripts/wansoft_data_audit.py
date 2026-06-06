#!/usr/bin/env python3
"""
Wansoft Data Audit — Compares ALL Wansoft endpoints vs our wansoft_daily DB.
Run manually to find every data discrepancy.

Usage: gh workflow run wansoft-data-audit.yml
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
sb_headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}


def wansoft_login():
    """Login to Wansoft, return session."""
    s = requests.Session()
    s.get(f"{WANSOFT_URL}/", timeout=15)
    resp = s.post(f"{WANSOFT_URL}/", data={
        "UserName": WANSOFT_USER, "Password": WANSOFT_PASS,
    }, allow_redirects=True, timeout=15)
    if "Dashboard" not in resp.url:
        raise Exception(f"Wansoft login failed. URL: {resp.url}")
    print(f"    Login OK → {resp.url}")
    return s


def parse_html_rows(html):
    """Parse Wansoft HTML report into list of dicts with all columns."""
    soup = BeautifulSoup(html, "html.parser")

    # Get headers
    header_row = soup.select_one(".headerReport")
    headers = []
    if header_row:
        headers = [h.text.strip() for h in header_row.select("div")]

    # Get data rows
    rows = []
    for row in soup.select(".rowReport"):
        cols = [c.text.strip() for c in row.select("div")]
        if headers and len(cols) == len(headers):
            rows.append(dict(zip(headers, cols)))
        else:
            rows.append({"cols": cols})

    # Get total row
    total_row = soup.select_one(".totalReport")
    total = None
    if total_row:
        cols = [c.text.strip() for c in total_row.select("div")]
        if headers and len(cols) == len(headers):
            total = dict(zip(headers, cols))
        else:
            total = {"cols": cols}

    return {"headers": headers, "rows": rows, "total": total}


def main():
    now_mx = datetime.now(MX_TZ)
    # Audit yesterday (complete day) or today if specified
    target = os.environ.get("AUDIT_DATE", (now_mx - timedelta(days=1)).strftime("%Y-%m-%d"))

    print(f"=" * 80)
    print(f"WANSOFT DATA AUDIT — {target}")
    print(f"Time: {now_mx.strftime('%Y-%m-%d %H:%M')} MX")
    print(f"=" * 80)

    # 1. Login
    print("\n[1] Logging into Wansoft...")
    session = wansoft_login()
    print("    OK")

    # 2. GetConsolidatedSales
    print("\n[2] GetConsolidatedSales:")
    r = session.post(f"{WANSOFT_URL}/Reports/GetConsolidatedSales", data={
        "subsidiaryId": SUBSIDIARY_ID, "startDate": target, "endDate": target,
    })
    try:
        consolidated = r.json()
        print(f"    Keys: {list(consolidated.keys())}")
        for k, v in consolidated.items():
            print(f"    {k}: {v}")
    except Exception as e:
        print(f"    ERROR parsing JSON: {e}")
        print(f"    Response: {r.text[:300]}")
        consolidated = {}

    # 2b. SalesByBranch (REPORTES → INGRESOS → VENTAS POR SUCURSAL)
    print("\n[2b] SalesByBranch (Ventas por Sucursal):")
    for endpoint in ["Reports/SalesByBranch", "Reports/SalesBySubsidiary", "Reports/IncomeByBranch", "Reports/GetIncomeReport"]:
        try:
            r = session.post(f"{WANSOFT_URL}/{endpoint}", data={
                "subsidiaryId": SUBSIDIARY_ID, "startDate": target, "endDate": target,
            }, timeout=10)
            if r.status_code == 200 and len(r.text) > 100:
                print(f"    FOUND: {endpoint}")
                # Try JSON first
                try:
                    data = r.json()
                    print(f"    JSON keys: {list(data.keys()) if isinstance(data, dict) else type(data)}")
                    if isinstance(data, dict):
                        for k, v in data.items():
                            print(f"    {k}: {v}")
                    elif isinstance(data, list):
                        for item in data[:5]:
                            print(f"    {item}")
                except:
                    # HTML report
                    parsed = parse_html_rows(r.text)
                    print(f"    Headers: {parsed['headers']}")
                    for row in parsed["rows"][:10]:
                        print(f"    {row}")
                    if parsed["total"]:
                        print(f"    Total: {parsed['total']}")
                break
            else:
                print(f"    {endpoint}: {r.status_code} ({len(r.text)} bytes) — not this one")
        except Exception as e:
            print(f"    {endpoint}: error {e}")

    # 2c. SalesByBranch MONTHLY query (to compare monthly totals)
    print("\n[2c] SalesByBranch — FULL MONTH query:")
    month_start = target[:8] + "01"
    import calendar
    y, m = int(target[:4]), int(target[5:7])
    month_end = f"{y}-{m:02d}-{calendar.monthrange(y, m)[1]:02d}"
    try:
        r = session.post(f"{WANSOFT_URL}/Reports/GetConsolidatedSales", data={
            "subsidiaryId": SUBSIDIARY_ID, "startDate": month_start, "endDate": month_end,
        }, timeout=15)
        mc = r.json()
        print(f"    Month range: {month_start} → {month_end}")
        print(f"    TotalSales (month): {mc.get('TotalSales')}")
        print(f"    TotalGrossSales (month): {mc.get('TotalGrossSales')}")
        print(f"    TotalDiscount (month): {mc.get('TotalDiscount')}")
        # Also get order types for the whole month
        r2 = session.post(f"{WANSOFT_URL}/Reports/SalesByTypeOfOrder", data={
            "subsidiaryId": SUBSIDIARY_ID, "startDate": month_start, "endDate": month_end,
        }, timeout=15)
        mt_ordenes = 0
        mt_personas = 0
        for tr in BeautifulSoup(r2.text, "html.parser").select(".rowReport"):
            cols = [c.text.strip() for c in tr.select("div")]
            if len(cols) >= 4:
                try:
                    mt_personas += int(cols[2])
                    mt_ordenes += int(cols[3])
                except: pass
        print(f"    Ordenes (month): {mt_ordenes}")
        print(f"    Personas (month): {mt_personas}")
    except Exception as e:
        print(f"    Monthly query failed: {e}")

    # 3. SalesByTypeOfOrder
    print("\n[3] SalesByTypeOfOrder:")
    r = session.post(f"{WANSOFT_URL}/Reports/SalesByTypeOfOrder", data={
        "subsidiaryId": SUBSIDIARY_ID, "startDate": target, "endDate": target,
    })
    order_types = parse_html_rows(r.text)
    print(f"    Headers: {order_types['headers']}")
    total_ordenes = 0
    total_personas = 0
    for row in order_types["rows"]:
        print(f"    Row: {row}")
        cols = row.get("cols", list(row.values()))
        if len(cols) >= 4:
            try:
                # cols[2]=PERSONAS, cols[3]=ORDENES (verified by audit 2026-06-06)
                personas = int(cols[2] if isinstance(cols, list) else list(row.values())[2])
                ordenes = int(cols[3] if isinstance(cols, list) else list(row.values())[3])
                total_ordenes += ordenes
                total_personas += personas
            except (ValueError, IndexError):
                pass
    if order_types["total"]:
        print(f"    Total row: {order_types['total']}")
    print(f"    Calculated: {total_ordenes} ordenes, {total_personas} personas")

    # 4. SalesByUser (meseros)
    print("\n[4] SalesByUser (meseros):")
    r = session.post(f"{WANSOFT_URL}/Reports/SalesByUser", data={
        "subsidiaryId": SUBSIDIARY_ID, "startDate": target, "endDate": target,
    })
    meseros = parse_html_rows(r.text)
    print(f"    Headers: {meseros['headers']}")
    for row in meseros["rows"][:15]:
        print(f"    {row}")
    if meseros["total"]:
        print(f"    Total: {meseros['total']}")

    # 5. SalesByGroup
    print("\n[5] SalesByGroup:")
    r = session.post(f"{WANSOFT_URL}/Reports/SalesByGroup", data={
        "subsidiaryId": SUBSIDIARY_ID, "startDate": target, "endDate": target,
    })
    groups = parse_html_rows(r.text)
    print(f"    Headers: {groups['headers']}")
    for row in groups["rows"][:10]:
        print(f"    {row}")
    if groups["total"]:
        print(f"    Total: {groups['total']}")

    # 6. SalesByPaymentType
    print("\n[6] SalesByPaymentType:")
    r = session.post(f"{WANSOFT_URL}/Reports/SalesByPaymentType", data={
        "subsidiaryId": SUBSIDIARY_ID, "startDate": target, "endDate": target,
    })
    payments = parse_html_rows(r.text)
    print(f"    Headers: {payments['headers']}")
    for row in payments["rows"]:
        print(f"    {row}")
    if payments["total"]:
        print(f"    Total: {payments['total']}")

    # 7. SalesBySaucer (top 10 platillos)
    print("\n[7] SalesBySaucer (top 10):")
    r = session.post(f"{WANSOFT_URL}/Reports/SalesBySaucer", data={
        "subsidiaryId": SUBSIDIARY_ID, "startDate": target, "endDate": target,
    })
    saucers = parse_html_rows(r.text)
    print(f"    Headers: {saucers['headers']}")
    for row in saucers["rows"][:10]:
        print(f"    {row}")
    if saucers["total"]:
        print(f"    Total: {saucers['total']}")
    print(f"    Total saucers: {len(saucers['rows'])}")

    # 8. Our DB data
    print("\n[8] OUR wansoft_daily DB:")
    db_rows = requests.get(
        f"{SUPABASE_URL}/rest/v1/wansoft_daily",
        headers=sb_headers,
        params={"fecha": f"eq.{target}", "client_slug": f"eq.{CLIENT['id']}", "select": "*"},
    ).json()
    if db_rows:
        db = db_rows[0]
        print(f"    ventas_dia:          ${db.get('ventas_dia', 'NULL')}")
        print(f"    ventas_brutas:       ${db.get('ventas_brutas', 'NULL')}")
        print(f"    descuentos:          ${db.get('descuentos', 'NULL')}")
        print(f"    tickets_count:       {db.get('tickets_count', 'NULL')}")
        print(f"    personas_restaurant: {db.get('personas_restaurant', 'NULL')}")
        print(f"    ticket_promedio:     ${db.get('ticket_promedio_restaurant', 'NULL')}")
        print(f"    efectivo:            ${db.get('efectivo', 'NULL')}")
        print(f"    tarjeta:             ${db.get('tarjeta', 'NULL')}")
        print(f"    propinas_total:      ${db.get('propinas_total', 'NULL')}")
        print(f"    mesas_atendidas:     {db.get('mesas_atendidas', 'NULL')}")
        meseros_db = db.get('meseros')
        if meseros_db:
            if isinstance(meseros_db, str):
                meseros_db = json.loads(meseros_db)
            print(f"    meseros count:       {len(meseros_db)}")
            meseros_total = sum(m.get('total', 0) for m in meseros_db)
            print(f"    meseros sum:         ${meseros_total:,.2f}")
        grupos_db = db.get('ventas_por_grupo')
        if grupos_db:
            if isinstance(grupos_db, str):
                grupos_db = json.loads(grupos_db)
            print(f"    grupos count:        {len(grupos_db)}")
        platillos_db = db.get('platillos_top')
        if platillos_db:
            if isinstance(platillos_db, str):
                platillos_db = json.loads(platillos_db)
            print(f"    platillos count:     {len(platillos_db)}")
    else:
        print("    NO DATA IN DB for this date!")

    # 9. COMPARISON
    print("\n" + "=" * 80)
    print("COMPARISON: Wansoft API vs Our DB")
    print("=" * 80)

    ws_total_sales = consolidated.get("TotalSales", 0)
    ws_gross_sales = consolidated.get("TotalGrossSales", 0)
    ws_discount = consolidated.get("TotalDiscount", 0)

    if db_rows:
        db = db_rows[0]
        db_ventas = float(db.get("ventas_dia", 0) or 0)
        db_brutas = float(db.get("ventas_brutas", 0) or 0)
        db_desc = float(db.get("descuentos", 0) or 0)
        db_tickets = int(db.get("tickets_count", 0) or 0)
        db_personas = int(db.get("personas_restaurant", 0) or 0)

        checks = [
            ("TotalSales vs ventas_dia", ws_total_sales, db_ventas),
            ("TotalGrossSales vs ventas_brutas", ws_gross_sales, db_brutas),
            ("TotalDiscount vs descuentos", ws_discount, db_desc),
            ("OrderType ordenes vs tickets_count", total_ordenes, db_tickets),
            ("OrderType personas vs personas_restaurant", total_personas, db_personas),
        ]

        for label, wansoft_val, db_val in checks:
            match = "OK" if abs(float(wansoft_val or 0) - float(db_val or 0)) < 1 else "MISMATCH"
            emoji = "✓" if match == "OK" else "✗"
            print(f"  {emoji} {label}: Wansoft={wansoft_val} | DB={db_val} | {match}")

    print("\n" + "=" * 80)
    print("AUDIT COMPLETE")
    print("=" * 80)


if __name__ == "__main__":
    main()
