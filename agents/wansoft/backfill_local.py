#!/usr/bin/env python3
"""
Backfill local: rellena días que solo tienen 'avance' con datos finales de Wansoft API.
NO necesita GitHub Actions — corre directo desde tu Mac.
NO envía Telegram — solo persiste en Supabase.

Uso:
    python3 agents/wansoft/backfill_local.py              # backfill todos los avance-only
    python3 agents/wansoft/backfill_local.py 2026-06-12    # un día específico
    python3 agents/wansoft/backfill_local.py --dry-run     # solo muestra qué haría
"""

import sys
import json
import time
import requests
from pathlib import Path
from datetime import datetime, timezone
from bs4 import BeautifulSoup

# ── Load env from local .env files ──────────────────────────────────────────
env = {}
for p in [Path.home() / "fullsite/agents/wansoft-explorer/.env",
          Path.home() / "fullsite/agents/wansoft/.env",
          Path.home() / "fullsite/.env"]:
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env.setdefault(k.strip(), v.strip().strip('"').strip("'"))

SUPABASE_URL = env.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = env.get("SUPABASE_SERVICE_KEY") or env.get("SUPABASE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: SUPABASE_URL / SUPABASE_SERVICE_KEY no encontrado en .env")
    sys.exit(1)

sb_h = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}

WANSOFT_URL = "https://www.wansoft.net/Wansoft.Web"

# ── Get client config from Supabase ─────────────────────────────────────────
def get_client():
    r = requests.get(f"{SUPABASE_URL}/rest/v1/clients",
                     headers=sb_h, params={"id": "eq.amalay", "select": "*", "limit": "1"}, timeout=10)
    r.raise_for_status()
    rows = r.json()
    if not rows:
        print("ERROR: Client 'amalay' no encontrado en tabla clients")
        sys.exit(1)
    client = rows[0]
    for field in ["staff_exclude_meseros", "staff_market"]:
        if isinstance(client.get(field), str):
            client[field] = json.loads(client[field])
    return client

CLIENT = get_client()
SUBSIDIARY_ID = CLIENT.get("wansoft_subsidiary_id", "")
WANSOFT_USER = CLIENT.get("wansoft_user", "")
WANSOFT_PASS = CLIENT.get("wansoft_pass", "")

if not WANSOFT_USER or not WANSOFT_PASS:
    print("ERROR: wansoft_user/wansoft_pass no están en la tabla clients")
    sys.exit(1)

STAFF_EXCLUDE = [e.lower() for e in (CLIENT.get("staff_exclude_meseros") or []) + (CLIENT.get("staff_market") or [])]

# ── Wansoft API (same as intraday_sales.py) ─────────────────────────────────
def wansoft_session():
    s = requests.Session()
    s.get(f"{WANSOFT_URL}/")
    resp = s.post(f"{WANSOFT_URL}/", data={"UserName": WANSOFT_USER, "Password": WANSOFT_PASS},
                  allow_redirects=True)
    if "Dashboard" not in resp.url and "MyDocumentsList" not in resp.url:
        raise Exception(f"Wansoft login failed. URL: {resp.url}")
    return s


def parse_html_report(html):
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for row in soup.select(".rowReport"):
        cols = [c.text.strip() for c in row.select("div")]
        if len(cols) >= 4:
            name = cols[0]
            try:
                total = float(cols[3].replace("$", "").replace(",", ""))
            except ValueError:
                total = 0
            qty = 0
            try:
                qty = int(cols[1])
            except (ValueError, IndexError):
                pass
            results.append({"name": name, "total": total, "qty": qty})
    return results


def scrape_day(session, fecha):
    """Scrape ALL data for a single date from Wansoft API. Returns dict ready for upsert."""
    data = {"client_slug": "amalay", "fecha": fecha, "report_type": "cierre",
            "updated_at": datetime.now(timezone.utc).isoformat()}

    # 1. Consolidated sales
    r = session.post(f"{WANSOFT_URL}/Reports/GetConsolidatedSales",
                     data={"subsidiaryId": SUBSIDIARY_ID, "startDate": fecha, "endDate": fecha})
    consolidated = r.json()
    data["ventas_dia"] = consolidated.get("TotalSales", 0)
    data["ventas_brutas"] = consolidated.get("TotalGrossSales", 0)
    data["descuentos"] = consolidated.get("TotalDiscount", 0) or consolidated.get("TotalDiscounts", 0)

    # 2. Sales by user (meseros)
    r = session.post(f"{WANSOFT_URL}/Reports/SalesByUser",
                     data={"subsidiaryId": SUBSIDIARY_ID, "startDate": fecha, "endDate": fecha})
    users = parse_html_report(r.text)
    mesero_data = []
    for u in users:
        name = u.get("name", "")
        if any(ex in name.lower() for ex in STAFF_EXCLUDE):
            continue
        total = u.get("total", 0)
        if total > 0:
            mesero_data.append({"nombre": name, "total": total})
    if mesero_data:
        data["meseros"] = json.dumps(mesero_data)

    # 3. Sales by group (categorías)
    r = session.post(f"{WANSOFT_URL}/Reports/SalesByGroup",
                     data={"subsidiaryId": SUBSIDIARY_ID, "startDate": fecha, "endDate": fecha})
    groups = parse_html_report(r.text)
    if groups:
        data["ventas_por_grupo"] = json.dumps([{"nombre": g["name"], "total": g.get("total", 0)} for g in groups])

    # 4. Sales by saucer (platillos top 30)
    r = session.post(f"{WANSOFT_URL}/Reports/SalesBySaucer",
                     data={"subsidiaryId": SUBSIDIARY_ID, "startDate": fecha, "endDate": fecha})
    saucers = parse_html_report(r.text)
    if saucers:
        data["platillos_top"] = json.dumps([
            {"nombre": s["name"], "cantidad": s["qty"], "total": s["total"]}
            for s in sorted(saucers, key=lambda x: -x["total"])[:30]
        ])

    # 5. Sales by order type (tickets, personas)
    r = session.post(f"{WANSOFT_URL}/Reports/SalesByTypeOfOrder",
                     data={"subsidiaryId": SUBSIDIARY_ID, "startDate": fecha, "endDate": fecha})
    soup = BeautifulSoup(r.text, "html.parser")
    total_ordenes = 0
    total_personas = 0
    for row in soup.select(".rowReport"):
        cols = [c.text.strip() for c in row.select("div")]
        if len(cols) >= 6:
            try:
                total_personas += int(cols[2])
                total_ordenes += int(cols[3])
            except (ValueError, IndexError):
                pass
    data["tickets_count"] = total_ordenes
    data["personas_restaurant"] = total_personas
    if total_ordenes > 0:
        data["ticket_promedio_restaurant"] = round(data["ventas_dia"] / total_ordenes, 2)

    # 6. Payment methods
    r = session.post(f"{WANSOFT_URL}/Reports/SalesByPaymentType",
                     data={"subsidiaryId": SUBSIDIARY_ID, "startDate": fecha, "endDate": fecha})
    soup = BeautifulSoup(r.text, "html.parser")
    pago_data = []
    efectivo = 0
    tarjeta = 0
    for row in soup.select(".rowReport"):
        cols = [c.text.strip() for c in row.select("div")]
        if len(cols) >= 2:
            name = cols[0]
            try:
                mxn = float(cols[1].replace(",", "").replace("$", "").replace("%", ""))
            except ValueError:
                mxn = 0
            pct = 0
            if len(cols) >= 3:
                try:
                    pct = float(cols[2].replace(",", "").replace("$", "").replace("%", ""))
                except ValueError:
                    pass
            if name and mxn > 0:
                pago_data.append({"nombre": name, "total": round(mxn, 2), "pct": round(pct, 1)})
                if "efectivo" in name.lower():
                    efectivo += mxn
                elif "tarjeta" in name.lower() or "crédito" in name.lower() or "débito" in name.lower():
                    tarjeta += mxn
    if pago_data:
        data["pago_metodos"] = json.dumps(pago_data)
        data["efectivo"] = round(efectivo, 2)
        data["tarjeta"] = round(tarjeta, 2)

    return data


def upsert_day(data):
    """UPSERT a day's data to wansoft_daily."""
    fecha = data["fecha"]
    sb_upsert_h = {**sb_h, "Content-Type": "application/json",
                   "Prefer": "resolution=merge-duplicates,return=minimal"}

    # Check if row exists
    r = requests.get(f"{SUPABASE_URL}/rest/v1/wansoft_daily?fecha=eq.{fecha}&client_slug=eq.amalay&select=fecha,report_type",
                     headers=sb_h, timeout=10)
    existing = r.json() if r.ok else []

    if existing:
        # PATCH existing row
        r = requests.patch(
            f"{SUPABASE_URL}/rest/v1/wansoft_daily?fecha=eq.{fecha}&client_slug=eq.amalay",
            headers=sb_upsert_h, json=data, timeout=10)
        old_type = existing[0].get("report_type", "?")
        return f"PATCHED ({old_type} → cierre)" if r.status_code in (200, 204) else f"PATCH FAILED ({r.status_code})"
    else:
        # INSERT new row
        r = requests.post(f"{SUPABASE_URL}/rest/v1/wansoft_daily",
                         headers=sb_upsert_h, json=data, timeout=10)
        return f"INSERTED" if r.status_code in (200, 201, 204) else f"INSERT FAILED ({r.status_code}: {r.text[:100]})"


def get_avance_only_dates():
    """Get all dates that only have 'avance' report_type."""
    r = requests.get(f"{SUPABASE_URL}/rest/v1/wansoft_daily?report_type=eq.avance&client_slug=eq.amalay&select=fecha&order=fecha.asc",
                     headers=sb_h, timeout=15)
    avance_dates = [row["fecha"] for row in r.json()] if r.ok else []

    # Exclude dates that also have a cierre
    r2 = requests.get(f"{SUPABASE_URL}/rest/v1/wansoft_daily?report_type=eq.cierre&client_slug=eq.amalay&select=fecha",
                      headers=sb_h, timeout=15)
    cierre_dates = set(row["fecha"] for row in r2.json()) if r2.ok else set()

    return [d for d in avance_dates if d not in cierre_dates]


# ── Main ────────────────────────────────────────────────────────────────────
def main():
    args = sys.argv[1:]
    dry_run = "--dry-run" in args
    args = [a for a in args if a != "--dry-run"]

    if args:
        dates = args
        print(f"Backfill manual: {dates}")
    else:
        dates = get_avance_only_dates()
        print(f"Encontrados {len(dates)} días con solo avance (sin cierre)")

    if not dates:
        print("Nada que hacer.")
        return

    for d in dates:
        print(f"  {d}")

    if dry_run:
        print("\n--dry-run: no se modifica nada.")
        return

    print(f"\nLogueando en Wansoft...")
    session = wansoft_session()
    print("Login OK\n")

    ok = 0
    fail = 0
    for i, fecha in enumerate(dates):
        try:
            print(f"[{i+1}/{len(dates)}] {fecha} ... ", end="", flush=True)
            data = scrape_day(session, fecha)
            ventas = data.get("ventas_dia", 0)
            tickets = data.get("tickets_count", 0)
            personas = data.get("personas_restaurant", 0)

            if ventas == 0:
                print(f"SKIP (ventas=0, restaurante cerrado?)")
                continue

            result = upsert_day(data)
            print(f"${ventas:,.0f} | {tickets} órdenes | {personas} personas | {result}")
            ok += 1
            time.sleep(1)  # Rate limit Wansoft
        except Exception as e:
            print(f"ERROR: {e}")
            fail += 1

    print(f"\nDone: {ok} OK, {fail} errores")


if __name__ == "__main__":
    main()
