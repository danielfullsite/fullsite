#!/usr/bin/env python3
"""
Intraday Sales Report — Multi-tenant
Scrapes Wansoft API directly for real-time sales data.
Sends to Telegram at 1pm, 3pm, 10pm.
"""

import os
import sys
import json
import time
import requests
from datetime import date, timedelta, datetime, timezone
from bs4 import BeautifulSoup
from client_config import get_client, get_tz, get_chat_ids, is_mesero, is_market, get_wansoft_creds

# ── Config ──────────────────────────────────────────────────────────────────
CLIENT = get_client()
SUBSIDIARY_ID, WANSOFT_USER, WANSOFT_PASS = get_wansoft_creds(CLIENT)
WANSOFT_URL = "https://www.wansoft.net/Wansoft.Web"

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TG_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_IDS = get_chat_ids(CLIENT, "intraday")

TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "cron")
MX_TZ = get_tz(CLIENT)

sb_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}

# ── Categories from client config ───────────────────────────────────────────
_cats = CLIENT.get("menu_categories") or {}
HH_KEYWORDS = _cats.get("hh", ["HALF", "H&H"])
PAN_KEYWORDS = _cats.get("pan", ["TOAST", "BAGEL", "CROISSANT"])
POSTRES_KEYWORDS = _cats.get("postres", ["BROWNIE", "CHEESECAKE", "CAKE", "PANCAKE"])
BEBIDA_GROUPS = CLIENT.get("bebida_groups") or ["COFFEE HOT/ICE", "FRESH DRINKS", "JUGOS"]


def sb_get(table, params):
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=sb_headers,
        params=params,
    )
    r.raise_for_status()
    return r.json()


# ── Wansoft API ─────────────────────────────────────────────────────────────
def wansoft_session():
    """Login to Wansoft and return authenticated session."""
    s = requests.Session()
    s.get(f"{WANSOFT_URL}/")
    resp = s.post(f"{WANSOFT_URL}/", data={
        "UserName": WANSOFT_USER,
        "Password": WANSOFT_PASS,
    }, allow_redirects=True)
    if "Dashboard" not in resp.url:
        raise Exception(f"Wansoft login failed. URL: {resp.url}")
    return s


def get_consolidated(session, start, end):
    """Get consolidated sales (JSON)."""
    r = session.post(f"{WANSOFT_URL}/Reports/GetConsolidatedSales", data={
        "subsidiaryId": SUBSIDIARY_ID,
        "startDate": start,
        "endDate": end,
    })
    return r.json()


def parse_html_report(html):
    """Parse Wansoft HTML report rows into list of dicts."""
    soup = BeautifulSoup(html, "html.parser")
    rows = soup.select(".rowReport")
    results = []
    for row in rows:
        cols = [c.text.strip() for c in row.select("div")]
        if len(cols) >= 4:
            name = cols[0]
            try:
                total = float(cols[3].replace("$", "").replace(",", ""))
            except ValueError:
                total = 0
            # cols[1] could be quantity for SalesBySaucer
            qty = 0
            try:
                qty = int(cols[1])
            except (ValueError, IndexError):
                pass
            results.append({"name": name, "total": total, "qty": qty})
    return results


def get_sales_by_user(session, start, end):
    r = session.post(f"{WANSOFT_URL}/Reports/SalesByUser", data={
        "subsidiaryId": SUBSIDIARY_ID, "startDate": start, "endDate": end,
    })
    return parse_html_report(r.text)


def get_sales_by_group(session, start, end):
    r = session.post(f"{WANSOFT_URL}/Reports/SalesByGroup", data={
        "subsidiaryId": SUBSIDIARY_ID, "startDate": start, "endDate": end,
    })
    return parse_html_report(r.text)


def get_sales_by_saucer(session, start, end):
    r = session.post(f"{WANSOFT_URL}/Reports/SalesBySaucer", data={
        "subsidiaryId": SUBSIDIARY_ID, "startDate": start, "endDate": end,
    })
    return parse_html_report(r.text)


def get_sales_by_order_type(session, start, end):
    """Get sales by order type — includes ticket counts and personas."""
    r = session.post(f"{WANSOFT_URL}/Reports/SalesByTypeOfOrder", data={
        "subsidiaryId": SUBSIDIARY_ID, "startDate": start, "endDate": end,
    })
    soup = BeautifulSoup(r.text, "html.parser")
    rows = soup.select(".rowReport")
    results = []
    total_tickets = 0
    total_personas = 0
    for row in rows:
        cols = [c.text.strip() for c in row.select("div")]
        if len(cols) >= 6:
            try:
                tickets = int(cols[2])
                personas = int(cols[3])
                total_tickets += tickets
                total_personas += personas
                results.append({"type": cols[0], "tickets": tickets, "personas": personas})
            except (ValueError, IndexError):
                pass
    return {"types": results, "total_tickets": total_tickets, "total_personas": total_personas}


# ── Category helpers ────────────────────────────────────────────────────────
def filter_category(saucers, keywords):
    """Filter saucers by keyword match."""
    result = []
    for s in saucers:
        name_upper = s["name"].upper()
        if any(kw in name_upper for kw in keywords):
            result.append(s)
    return result


def sum_total(items):
    return sum(i["total"] for i in items)


def sum_qty(items):
    return sum(i["qty"] for i in items)


# ── Historical ticket promedio ──────────────────────────────────────────────
def get_monthly_ticket_avg():
    """Get ticket promedio by month from wansoft_daily."""
    try:
        now_mx = datetime.now(MX_TZ)
        six_months_ago = (now_mx - timedelta(days=180)).strftime("%Y-%m-%d")
        rows = sb_get("wansoft_daily", {
            "select": "fecha,ventas_dia,ticket_promedio_restaurant",
            "fecha": f"gte.{six_months_ago}",
            "order": "fecha.asc",
        })
        # Group by month — use ticket_promedio_restaurant average
        monthly = {}
        for row in rows:
            month = row["fecha"][:7]  # YYYY-MM
            if month not in monthly:
                monthly[month] = {"ventas": 0, "avg_sum": 0, "days": 0}
            ventas = row.get("ventas_dia") or 0
            avg = row.get("ticket_promedio_restaurant") or 0
            monthly[month]["ventas"] += ventas
            if avg > 0:
                monthly[month]["avg_sum"] += avg
                monthly[month]["days"] += 1

        result = []
        for month, data in sorted(monthly.items()):
            avg = data["avg_sum"] / data["days"] if data["days"] else 0
            result.append({
                "month": month,
                "avg": avg,
                "ventas": data["ventas"],
                "days": data["days"],
            })
        return result
    except Exception as e:
        print(f"Error getting monthly avg: {e}")
        return []


# ── Build message ───────────────────────────────────────────────────────────
def build_message(consolidated, users, groups, saucers, order_types, monthly_avg):
    now_mx = datetime.now(MX_TZ)
    hora = now_mx.strftime("%H:%M")
    fecha = now_mx.strftime("%d/%m/%Y")

    ventas_netas = consolidated.get("TotalSales", 0)
    ventas_brutas = consolidated.get("TotalGrossSales", 0)
    descuentos = consolidated.get("TotalDiscount", 0)

    tickets = order_types.get("total_tickets", 0)
    personas = order_types.get("total_personas", 0)

    # Exclude Market staff from ticket promedio
    market_ventas = sum(u["total"] for u in users if is_market(u["name"], CLIENT))
    ventas_restaurante = ventas_netas - market_ventas
    # Estimate Market tickets (Market avg ~$50-80 per ticket)
    market_tickets = round(market_ventas / 65) if market_ventas > 0 else 0
    tickets_restaurante = max(tickets - market_tickets, 1)
    ticket_avg = ventas_restaurante / tickets_restaurante if tickets_restaurante else 0

    # Category totals from saucers
    hh_items = filter_category(saucers, HH_KEYWORDS)
    pan_items = filter_category(saucers, PAN_KEYWORDS)
    postre_items = filter_category(saucers, POSTRES_KEYWORDS)

    # Bebidas from groups
    bebida_total = sum(g["total"] for g in groups if g["name"].upper() in BEBIDA_GROUPS)
    bebida_groups_found = [g for g in groups if g["name"].upper() in BEBIDA_GROUPS]

    msg = f"""📊 REPORTE INTRADAY — {fecha} {hora}

💰 VENTAS DEL DÍA
• Ventas netas: ${ventas_netas:,.0f}
• Ventas restaurante (sin Market): ${ventas_restaurante:,.0f}
• Market: ${market_ventas:,.0f}
• Descuentos: ${descuentos:,.0f}
• Tickets: {tickets} (rest: ~{tickets_restaurante})
• Personas: {personas}
• Ticket promedio restaurante: ${ticket_avg:,.0f}

📈 TICKET PROMEDIO POR MES"""

    for m in monthly_avg[-6:]:
        msg += f"\n• {m['month']}: ${m['avg']:,.0f} (${m['ventas']:,.0f} en {m['days']} días)"

    msg += f"""

🥘 HALF & HALF
• Total: ${sum_total(hh_items):,.0f} ({sum_qty(hh_items)} piezas)"""
    for item in sorted(hh_items, key=lambda x: -x["total"])[:5]:
        msg += f"\n  - {item['name']}: ${item['total']:,.0f} ({item['qty']})"

    msg += f"""

🍞 PAN / TOAST / BAGELS
• Total: ${sum_total(pan_items):,.0f} ({sum_qty(pan_items)} piezas)"""
    for item in sorted(pan_items, key=lambda x: -x["total"])[:5]:
        msg += f"\n  - {item['name']}: ${item['total']:,.0f} ({item['qty']})"

    msg += f"""

🍰 POSTRES
• Total: ${sum_total(postre_items):,.0f} ({sum_qty(postre_items)} piezas)"""
    for item in sorted(postre_items, key=lambda x: -x["total"])[:5]:
        msg += f"\n  - {item['name']}: ${item['total']:,.0f} ({item['qty']})"

    msg += f"""

☕ BEBIDAS
• Total: ${bebida_total:,.0f}"""
    for g in sorted(bebida_groups_found, key=lambda x: -x["total"])[:5]:
        msg += f"\n  - {g['name']}: ${g['total']:,.0f}"

    # Separate meseros from market staff
    meseros = [u for u in users if u["total"] > 0 and is_mesero(u["name"], CLIENT)]
    market = [u for u in users if u["total"] > 0 and is_market(u["name"], CLIENT)]

    msg += "\n\n👤 VENTAS POR MESERO"
    for u in sorted(meseros, key=lambda x: -x["total"]):
        msg += f"\n• {u['name']}: ${u['total']:,.0f}"

    if market:
        msg += "\n\n🏪 MARKET"
        for u in sorted(market, key=lambda x: -x["total"]):
            msg += f"\n• {u['name']}: ${u['total']:,.0f}"

    msg += f"""

🏆 TOP 10 PLATILLOS"""
    for item in sorted(saucers, key=lambda x: -x["total"])[:10]:
        msg += f"\n• {item['name']}: ${item['total']:,.0f} ({item['qty']})"

    return msg


# ── Telegram ────────────────────────────────────────────────────────────────
def send_telegram(msg):
    sent = 0
    for chat_id in TG_CHAT_IDS:
        chunks = [msg[i:i+4000] for i in range(0, len(msg), 4000)] if len(msg) > 4000 else [msg]
        for chunk in chunks:
            r = requests.post(
                f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                json={"chat_id": chat_id, "text": chunk},
            )
            if r.ok:
                sent += 1
            else:
                print(f"Telegram error {chat_id}: {r.text[:200]}")
    return sent


# ── Log to Supabase ─────────────────────────────────────────────────────────
def log_run(status, duration_ms, summary="", error=""):
    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_runs",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
            json={
                "agent_id": "intraday-sales",
                "trigger_type": TRIGGER_TYPE,
                "status": status,
                "duration_ms": duration_ms,
                "output_summary": summary[:500],
                "error_message": error[:500] if error else None,
                "tentacle": "reportes",
            },
        )
    except Exception:
        pass


# ── Main ────────────────────────────────────────────────────────────────────
def main():
    start = time.time()
    # Use MX timezone for date (GitHub Actions runs in UTC)
    now_mx = datetime.now(MX_TZ)
    today_str = now_mx.strftime("%Y-%m-%d")

    try:
        print("[intraday] Logging into Wansoft...")
        session = wansoft_session()
        print("[intraday] Login OK")

        print("[intraday] Fetching data...")
        consolidated = get_consolidated(session, today_str, today_str)
        users = get_sales_by_user(session, today_str, today_str)
        groups = get_sales_by_group(session, today_str, today_str)
        saucers = get_sales_by_saucer(session, today_str, today_str)
        order_types = get_sales_by_order_type(session, today_str, today_str)
        monthly_avg = get_monthly_ticket_avg()

        print(f"[intraday] Data: consolidated OK, {len(users)} users, {len(groups)} groups, {len(saucers)} saucers, {order_types['total_tickets']} tickets")

        # Don't send report if no sales (restaurant closed or data not yet available)
        ventas = consolidated.get("TotalSales", 0)
        if ventas == 0 and order_types["total_tickets"] == 0:
            print("[intraday] No sales data — skipping report")
            return

        msg = build_message(consolidated, users, groups, saucers, order_types, monthly_avg)
        print(f"[intraday] Message built ({len(msg)} chars)")

        sent = send_telegram(msg)
        print(f"[intraday] Sent to {sent} chats")

        duration = int((time.time() - start) * 1000)
        ventas = consolidated.get("TotalSales", 0)
        log_run("success", duration, f"Ventas: ${ventas:,.0f}, {len(users)} meseros, sent to {sent} chats")
        print("[intraday] Done")

    except Exception as e:
        duration = int((time.time() - start) * 1000)
        log_run("error", duration, error=str(e))
        print(f"[intraday] ERROR: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
