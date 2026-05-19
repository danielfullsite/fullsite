#!/usr/bin/env python3
"""
Wansoft Deep Scraper — Multi-tenant
Scrapes 8 additional Wansoft endpoints for deep operational intelligence:
1. PersonsByHour → traffic patterns
2. TipByUser → service quality
3. GetCostBySaucer → food cost / margins
4. GetInventoryBySubsidiary → stock levels
5. GetPhysicalInventoryVsSystem → shrinkage detection
6. ShopBySupplier → vendor spend
7. GetUserHoursWorkedReport → labor cost
8. GetIncomeStatemetByMonthInYear → P&L

Runs daily at 11pm MX via GitHub Actions.
"""

import os
import sys
import json
import time
import requests
from datetime import date, timedelta, datetime, timezone
from bs4 import BeautifulSoup
from client_config import get_client, get_tz, get_wansoft_creds

# ── Config ──────────────────────────────────────────────────────────────────
CLIENT = get_client()
SUBSIDIARY_ID, WANSOFT_USER, WANSOFT_PASS = get_wansoft_creds(CLIENT)
WANSOFT_URL = "https://www.wansoft.net/Wansoft.Web"

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TG_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_IDS = [os.environ.get("TELEGRAM_CHAT_ID_DANIEL", "")]

TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "cron")
MX_TZ = get_tz(CLIENT)

sb_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates,return=minimal",
}


# ── Wansoft Session ────────────────────────────────────────────────────────
def wansoft_session():
    s = requests.Session()
    s.get(f"{WANSOFT_URL}/")
    resp = s.post(f"{WANSOFT_URL}/", data={
        "UserName": WANSOFT_USER,
        "Password": WANSOFT_PASS,
    }, allow_redirects=True)
    if "Dashboard" not in resp.url:
        raise Exception(f"Wansoft login failed. URL: {resp.url}")
    return s


def parse_html_rows(html):
    """Parse Wansoft HTML report rows into list of column arrays."""
    soup = BeautifulSoup(html, "html.parser")
    rows = soup.select(".rowReport")
    results = []
    for row in rows:
        cols = [c.text.strip() for c in row.select("div")]
        if cols:
            results.append(cols)
    return results


def safe_float(val):
    try:
        return float(str(val).replace("$", "").replace(",", "").replace("%", "").strip())
    except (ValueError, TypeError):
        return 0


def safe_int(val):
    try:
        return int(str(val).replace(",", "").strip())
    except (ValueError, TypeError):
        return 0


def sb_upsert(table, data):
    """Upsert to Supabase."""
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=sb_headers,
        json=data,
        timeout=15,
    )
    if not r.ok:
        print(f"  [!] Supabase upsert {table} failed: {r.status_code} {r.text[:200]}")
    return r.ok


# ── 1. Personas por hora ──────────────────────────────────────────────────
def scrape_persons_by_hour(session, fecha):
    print("[deep] 1/8 PersonsByHour...")
    try:
        r = session.post(f"{WANSOFT_URL}/Reports/SalesByHours", data={
            "subsidiaryId": SUBSIDIARY_ID, "startDate": fecha, "endDate": fecha,
        }, timeout=30)
        rows = parse_html_rows(r.text)
        data = []
        for cols in rows:
            if len(cols) >= 5:
                data.append({
                    "hora": cols[0],
                    "ventas": safe_float(cols[3]),
                    "pct": cols[4] if len(cols) > 4 else "",
                })

        # Also fetch persons by hour if available
        try:
            r2 = session.post(f"{WANSOFT_URL}/Reports/PersonsByHour", data={
                "subsidiaryId": SUBSIDIARY_ID, "startDate": fecha, "endDate": fecha,
            }, timeout=30)
            persons_rows = parse_html_rows(r2.text)
            for i, cols in enumerate(persons_rows):
                if len(cols) >= 2 and i < len(data):
                    data[i]["personas"] = safe_int(cols[1])
        except Exception as e:
            print(f"  [!] PersonsByHour failed: {e}")

        if data:
            sb_upsert("wansoft_persons_hourly", {
                "client_id": CLIENT["id"], "fecha": fecha,
                "data": json.dumps(data),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            print(f"  OK: {len(data)} hours")
        return data
    except Exception as e:
        print(f"  [!] Error: {e}")
        return []


# ── 2. Propinas por mesero ────────────────────────────────────────────────
def scrape_tips_by_user(session, fecha):
    print("[deep] 2/8 TipByUser...")
    try:
        r = session.post(f"{WANSOFT_URL}/Reports/SalesByUser", data={
            "subsidiaryId": SUBSIDIARY_ID, "startDate": fecha, "endDate": fecha,
        }, timeout=30)
        rows = parse_html_rows(r.text)
        data = []
        for cols in rows:
            if len(cols) >= 6:
                propinas = safe_float(cols[5]) if len(cols) > 5 else 0
                tickets = safe_int(cols[2]) if len(cols) > 2 else 0
                data.append({
                    "mesero": cols[0],
                    "ventas": safe_float(cols[3]),
                    "tickets": tickets,
                    "propinas": propinas,
                    "propina_promedio": round(propinas / tickets, 2) if tickets > 0 else 0,
                })

        if data:
            sb_upsert("wansoft_tips", {
                "client_id": CLIENT["id"], "fecha": fecha,
                "data": json.dumps(data),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            print(f"  OK: {len(data)} meseros with tips")
        return data
    except Exception as e:
        print(f"  [!] Error: {e}")
        return []


# ── 3. Costo por platillo ────────────────────────────────────────────────
def scrape_food_cost(session, fecha):
    print("[deep] 3/8 GetCostBySaucer...")
    try:
        r = session.post(f"{WANSOFT_URL}/Reports/GetCostBySaucer", data={
            "subsidiaryId": SUBSIDIARY_ID, "startDate": fecha, "endDate": fecha,
        }, timeout=30)
        rows = parse_html_rows(r.text)
        data = []
        for cols in rows:
            if len(cols) >= 4:
                precio = safe_float(cols[2]) if len(cols) > 2 else 0
                costo = safe_float(cols[3]) if len(cols) > 3 else 0
                margen_pct = round((1 - costo / precio) * 100, 1) if precio > 0 else 0
                data.append({
                    "platillo": cols[0],
                    "qty": safe_int(cols[1]) if len(cols) > 1 else 0,
                    "precio": precio,
                    "costo": costo,
                    "margen_pct": margen_pct,
                })

        if data:
            sb_upsert("wansoft_food_cost", {
                "client_id": CLIENT["id"], "fecha": fecha,
                "data": json.dumps(data),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            print(f"  OK: {len(data)} items with cost")
        return data
    except Exception as e:
        print(f"  [!] Error: {e}")
        return []


# ── 4. Inventario actual ─────────────────────────────────────────────────
def scrape_inventory(session, fecha):
    print("[deep] 4/8 GetInventoryBySubsidiary...")
    try:
        r = session.post(f"{WANSOFT_URL}/Inventory/GetInventoryBySubsidiary", data={
            "subsidiaryId": SUBSIDIARY_ID,
        }, timeout=30)
        rows = parse_html_rows(r.text)
        data = []
        for cols in rows:
            if len(cols) >= 4:
                data.append({
                    "producto": cols[0],
                    "existencia": safe_float(cols[1]),
                    "unidad": cols[2] if len(cols) > 2 else "",
                    "costo_unitario": safe_float(cols[3]) if len(cols) > 3 else 0,
                    "costo_total": safe_float(cols[4]) if len(cols) > 4 else 0,
                })

        if data:
            sb_upsert("wansoft_inventory", {
                "client_id": CLIENT["id"], "fecha": fecha,
                "data": json.dumps(data),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            print(f"  OK: {len(data)} products")
        return data
    except Exception as e:
        print(f"  [!] Error: {e}")
        return []


# ── 5. Físico vs Sistema ─────────────────────────────────────────────────
def scrape_shrinkage(session, fecha):
    print("[deep] 5/8 PhysicalInventoryVsSystem...")
    try:
        r = session.post(f"{WANSOFT_URL}/Inventory/GetPhysicalInventoryVsSystem", data={
            "subsidiaryId": SUBSIDIARY_ID,
        }, timeout=30)
        rows = parse_html_rows(r.text)
        data = []
        for cols in rows:
            if len(cols) >= 4:
                sistema = safe_float(cols[1])
                fisico = safe_float(cols[2])
                diff = fisico - sistema
                data.append({
                    "producto": cols[0],
                    "sistema": sistema,
                    "fisico": fisico,
                    "diferencia": round(diff, 2),
                    "costo_diferencia": safe_float(cols[3]) if len(cols) > 3 else 0,
                })

        # Only save items with differences
        data_with_diff = [d for d in data if abs(d["diferencia"]) > 0.01]
        if data_with_diff:
            sb_upsert("wansoft_shrinkage", {
                "client_id": CLIENT["id"], "fecha": fecha,
                "data": json.dumps(data_with_diff),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            print(f"  OK: {len(data_with_diff)} items with differences (of {len(data)} total)")
        else:
            print(f"  OK: {len(data)} items, no differences")
        return data
    except Exception as e:
        print(f"  [!] Error: {e}")
        return []


# ── 6. Compras por proveedor ─────────────────────────────────────────────
def scrape_suppliers(session, fecha):
    print("[deep] 6/8 ShopBySupplier...")
    try:
        # Last 30 days
        start = (datetime.strptime(fecha, "%Y-%m-%d") - timedelta(days=30)).strftime("%Y-%m-%d")
        r = session.post(f"{WANSOFT_URL}/Reports/ShopBySupplier", data={
            "subsidiaryId": SUBSIDIARY_ID, "startDate": start, "endDate": fecha,
        }, timeout=30)
        rows = parse_html_rows(r.text)
        data = []
        for cols in rows:
            if len(cols) >= 3:
                data.append({
                    "proveedor": cols[0],
                    "num_compras": safe_int(cols[1]) if len(cols) > 1 else 0,
                    "total": safe_float(cols[2]) if len(cols) > 2 else safe_float(cols[-1]),
                })

        if data:
            sb_upsert("wansoft_suppliers", {
                "client_id": CLIENT["id"], "fecha": fecha, "periodo": "month",
                "data": json.dumps(data),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            print(f"  OK: {len(data)} suppliers")
        return data
    except Exception as e:
        print(f"  [!] Error: {e}")
        return []


# ── 7. Horas trabajadas ──────────────────────────────────────────────────
def scrape_labor(session, fecha):
    print("[deep] 7/8 GetUserHoursWorkedReport...")
    try:
        r = session.post(f"{WANSOFT_URL}/Staff/GetAccessControlReport", data={
            "subsidiaryId": SUBSIDIARY_ID, "startDate": fecha, "endDate": fecha,
        }, timeout=30)
        rows = parse_html_rows(r.text)
        data = []
        for cols in rows:
            if len(cols) >= 3:
                data.append({
                    "empleado": cols[0],
                    "entrada": cols[1] if len(cols) > 1 else "",
                    "salida": cols[2] if len(cols) > 2 else "",
                    "horas": safe_float(cols[3]) if len(cols) > 3 else 0,
                })

        if data:
            sb_upsert("wansoft_labor", {
                "client_id": CLIENT["id"], "fecha": fecha,
                "data": json.dumps(data),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            print(f"  OK: {len(data)} employees")
        return data
    except Exception as e:
        print(f"  [!] Error: {e}")
        return []


# ── 8. Estado de resultados ──────────────────────────────────────────────
def scrape_pnl(session, fecha):
    print("[deep] 8/8 IncomeStatement...")
    try:
        year = fecha[:4]
        r = session.post(f"{WANSOFT_URL}/Reports/GetIncomeStatemetByMonthInYear", data={
            "subsidiaryId": SUBSIDIARY_ID, "year": year,
        }, timeout=30)
        rows = parse_html_rows(r.text)

        # Parse the P&L structure
        data = {"year": year, "months": {}}
        current_section = ""
        for cols in rows:
            if len(cols) >= 2:
                label = cols[0].strip()
                if label:
                    values = [safe_float(c) for c in cols[1:]]
                    data["months"][label] = values

        periodo = fecha[:7]  # YYYY-MM
        if data["months"]:
            sb_upsert("wansoft_pnl", {
                "client_id": CLIENT["id"], "periodo": periodo,
                "data": json.dumps(data),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            print(f"  OK: {len(data['months'])} P&L line items")
        return data
    except Exception as e:
        print(f"  [!] Error: {e}")
        return {}


# ── Telegram ──────────────────────────────────────────────────────────────
def send_telegram(msg):
    for chat_id in TG_CHAT_IDS:
        if not chat_id:
            continue
        chunks = [msg[i:i+4000] for i in range(0, len(msg), 4000)]
        for chunk in chunks:
            requests.post(
                f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                json={"chat_id": chat_id, "text": chunk},
            )


# ── Log ───────────────────────────────────────────────────────────────────
def log_run(status, duration_ms, summary="", error=""):
    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_runs",
            headers=sb_headers,
            json={
                "agent_id": "wansoft-deep-scraper",
                "trigger_type": TRIGGER_TYPE,
                "status": status,
                "duration_ms": duration_ms,
                "output_summary": summary[:500],
                "error_message": error[:500] if error else None,
                "tentacle": "ops",
            },
        )
    except Exception:
        pass


# ── Main ──────────────────────────────────────────────────────────────────
def main():
    start = time.time()
    now_mx = datetime.now(MX_TZ)
    today_str = now_mx.strftime("%Y-%m-%d")

    print(f"[deep] Starting deep scraper for {CLIENT['id']} on {today_str}")

    try:
        session = wansoft_session()
        print("[deep] Login OK")

        results = {}
        results["persons"] = scrape_persons_by_hour(session, today_str)
        results["tips"] = scrape_tips_by_user(session, today_str)
        results["food_cost"] = scrape_food_cost(session, today_str)
        results["inventory"] = scrape_inventory(session, today_str)
        results["shrinkage"] = scrape_shrinkage(session, today_str)
        results["suppliers"] = scrape_suppliers(session, today_str)
        results["labor"] = scrape_labor(session, today_str)
        results["pnl"] = scrape_pnl(session, today_str)

        # Build summary
        summary_parts = []
        for key, data in results.items():
            count = len(data) if isinstance(data, list) else (len(data.get("months", {})) if isinstance(data, dict) else 0)
            if count > 0:
                summary_parts.append(f"{key}: {count}")

        summary = f"Deep scrape {today_str}: {', '.join(summary_parts)}"
        print(f"\n[deep] {summary}")

        # Send Telegram summary
        msg = f"🔍 DEEP SCRAPE — {today_str}\n\n"
        if results["persons"]:
            msg += f"⏰ Personas/hora: {len(results['persons'])} franjas\n"
        if results["tips"]:
            total_tips = sum(d.get("propinas", 0) for d in results["tips"])
            msg += f"💰 Propinas: ${total_tips:,.0f} ({len(results['tips'])} meseros)\n"
        if results["food_cost"]:
            avg_margin = sum(d.get("margen_pct", 0) for d in results["food_cost"]) / len(results["food_cost"]) if results["food_cost"] else 0
            msg += f"📊 Food cost: {len(results['food_cost'])} platillos, margen prom. {avg_margin:.0f}%\n"
        if results["inventory"]:
            msg += f"📦 Inventario: {len(results['inventory'])} productos\n"
        if results["shrinkage"]:
            shrink_items = [d for d in results["shrinkage"] if abs(d.get("diferencia", 0)) > 0.01]
            if shrink_items:
                msg += f"⚠️ Merma: {len(shrink_items)} productos con diferencia\n"
        if results["suppliers"]:
            total_spend = sum(d.get("total", 0) for d in results["suppliers"])
            msg += f"🛒 Proveedores: {len(results['suppliers'])}, gasto ${total_spend:,.0f}\n"
        if results["labor"]:
            msg += f"👥 Labor: {len(results['labor'])} empleados\n"
        if results["pnl"] and results["pnl"].get("months"):
            msg += f"📈 P&L: {len(results['pnl']['months'])} líneas\n"

        send_telegram(msg)

        elapsed = int((time.time() - start) * 1000)
        log_run("success", elapsed, summary)
        print(f"[deep] Done in {elapsed}ms")

    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        error_msg = str(e)
        print(f"[deep] ERROR: {error_msg}")
        log_run("error", elapsed, error=error_msg)
        send_telegram(f"❌ Deep scraper error: {error_msg[:200]}")
        sys.exit(1)


if __name__ == "__main__":
    main()
