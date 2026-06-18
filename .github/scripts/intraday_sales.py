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
# ── Categories from client config (client-specific override > universal defaults) ──
_cats = CLIENT.get("menu_categories") or {}
# Signature items: the "hero" dish(es) each restaurant tracks (e.g. chilaquiles, paella, croquetas)
SIGNATURE_KEYWORDS = _cats.get("signature", CLIENT.get("signature_items") or ["CHILAQUIL"])
HH_KEYWORDS = _cats.get("hh", ["HALF", "H&H"])
PAN_KEYWORDS = _cats.get("pan", ["TOAST", "BAGEL", "CROISSANT", "CONCHA", "MUFFIN", "BRIOCHE"])
POSTRES_KEYWORDS = _cats.get("postres", [
    "BROWNIE", "CHEESECAKE", "FLAN", "PASTEL", "CAKE", "CHURRO", "TIRAMISU",
    "CREPAS", "CREPE", "GELATO", "HELADO", "NIEVE", "POSTRE", "MOUSSE",
    "TARTA", "PIE", "FONDUE", "COULANT", "CREMA CATALANA", "NATILLA",
])
POSTRES_EXCLUDE = _cats.get("postres_exclude", ["PANCAKE", "EGG AND PANCAKE", "PARADISE BUTTERMILK"])
PANADERIA_KEYWORDS = _cats.get("panaderia", [
    "CONCHA", "CRUNCHY MIX", "MUFFIN", "CUERNO", "DONA", "ROL DE CANELA",
    "GALLETA", "COOKIE", "POLVORON", "OREJA", "MANTECADA", "PAN DE",
    "CROISSANT MANTEQUILLA", "BRIOCHE",
])
BEBIDA_GROUPS = CLIENT.get("bebida_groups") or [
    "COFFEE HOT/ICE", "FRESH DRINKS", "JUGOS", "SMOOTHIES", "FRAPPES",
    "SIGNATURE", "TEA & TISANAS", "SODAS", "BEBIDAS OH",
    "VINOS", "CERVEZAS", "COCKTAILS", "CAVA", "SANGRIA",
]
POSTRES_GROUPS = _cats.get("postres_groups", ["DESSERTS", "ICE CREAM", "POSTRES"])
PANADERIA_GROUPS = _cats.get("panaderia_groups", ["BAKERY", "PANADERIA"])


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
    if "Dashboard" not in resp.url and "MyDocumentsList" not in resp.url:
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
    """Get sales by order type — includes ticket counts and personas.
    CRITICAL: Wansoft cols = [Type, AvgTicket, PERSONAS, ORDENES, Subtotal, Total]
    cols[2] = personas (NOT tickets), cols[3] = ordenes/tickets (NOT personas)
    Verified via audit 2026-06-06: Restaurant 122 personas, 58 ordenes = 2.1 pers/orden."""
    r = session.post(f"{WANSOFT_URL}/Reports/SalesByTypeOfOrder", data={
        "subsidiaryId": SUBSIDIARY_ID, "startDate": start, "endDate": end,
    })
    soup = BeautifulSoup(r.text, "html.parser")
    rows = soup.select(".rowReport")
    results = []
    total_ordenes = 0
    total_personas = 0
    for row in rows:
        cols = [c.text.strip() for c in row.select("div")]
        if len(cols) >= 6:
            try:
                order_type = cols[0]
                personas = int(cols[2])   # PERSONAS (was incorrectly read as tickets)
                ordenes = int(cols[3])    # ORDENES (was incorrectly read as personas)
                total_personas += personas
                total_ordenes += ordenes
                results.append({"type": order_type, "ordenes": ordenes, "personas": personas})
            except (ValueError, IndexError):
                pass
    # Log each type for debugging
    for r_item in results:
        ppo = round(r_item['personas'] / r_item['ordenes'], 2) if r_item['ordenes'] > 0 else 0
        print(f"[intraday] OrderType: {r_item['type']} → {r_item['ordenes']} ordenes, {r_item['personas']} personas ({ppo} pers/orden)")
    print(f"[intraday] OrderTypes total: {total_ordenes} ordenes, {total_personas} personas")
    return {
        "types": results,
        "total_ordenes": total_ordenes, "total_personas": total_personas,
    }


def get_monitoring_info(session):
    """Get OPEN (pending) orders from the Wansoft dashboard monitor.
    The Wansoft app's '# Órdenes' = closed orders (SalesByTypeOfOrder) + OPEN orders.
    Without this, our counts undercount vs the app (verified 2026-06-12:
    app showed 80 órdenes / 125 personas while closed-only was 57/113)."""
    try:
        r = session.post(f"{WANSOFT_URL}/Reports/GetMonitoringInfo",
                         params={"subsidiaryId": SUBSIDIARY_ID}, timeout=15)
        result = (r.json() or {}).get("Result") or {}
        abiertas = int(result.get("PendingOrdersCounter") or 0)
        monto = float(result.get("PendingOrdersAmount") or 0)
        # PendingOrders is an XML string: <Orden ... personas="2" ... />
        import re as _re
        personas = sum(int(p) for p in _re.findall(r'personas="(\d+)"', result.get("PendingOrders") or ""))
        print(f"[intraday] Open orders: {abiertas} ordenes, {personas} personas, ${monto:,.2f}")
        return {"abiertas": abiertas, "personas_abiertas": personas, "monto_abierto": monto}
    except Exception as e:
        print(f"[intraday] GetMonitoringInfo failed (non-blocking): {e}")
        return {"abiertas": 0, "personas_abiertas": 0, "monto_abierto": 0}


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
        rows = sb_get("wansoft_daily", {"client_slug": f"eq.{CLIENT['id']}",
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


def get_tp_weekday_weekend():
    """Get ticket promedio split by weekday vs weekend from last 30 days."""
    try:
        now_mx = datetime.now(MX_TZ)
        thirty_ago = (now_mx - timedelta(days=30)).strftime("%Y-%m-%d")
        rows = sb_get("wansoft_daily", {"client_slug": f"eq.{CLIENT['id']}",
            "select": "fecha,ventas_dia,tickets_count",
            "fecha": f"gte.{thirty_ago}",
            "ventas_dia": "gt.0",
            "order": "fecha.asc",
        })
        weekday = {"ventas": 0, "tickets": 0, "dias": 0}
        weekend = {"ventas": 0, "tickets": 0, "dias": 0}
        for row in rows:
            from datetime import date as dt_date
            y, m, d = row["fecha"].split("-")
            dow = dt_date(int(y), int(m), int(d)).weekday()  # 0=Mon, 6=Sun
            bucket = weekend if dow >= 5 else weekday
            bucket["ventas"] += row.get("ventas_dia") or 0
            bucket["tickets"] += row.get("tickets_count") or 0
            bucket["dias"] += 1
        wd_tp = int(weekday["ventas"] / weekday["tickets"]) if weekday["tickets"] else 0
        we_tp = int(weekend["ventas"] / weekend["tickets"]) if weekend["tickets"] else 0
        return {"weekday_tp": wd_tp, "weekend_tp": we_tp,
                "weekday_dias": weekday["dias"], "weekend_dias": weekend["dias"]}
    except Exception as e:
        print(f"Error getting TP weekday/weekend: {e}")
        return None


# ── Category filter with exclusions ────────────────────────────────────────
def filter_category_ex(saucers, keywords, exclude=None):
    """Filter saucers by keyword match, with optional exclusion list."""
    result = []
    for s in saucers:
        name_upper = s["name"].upper()
        if any(kw in name_upper for kw in keywords):
            if exclude and any(ex in name_upper for ex in exclude):
                continue
            result.append(s)
    return result


# ── Build message ───────────────────────────────────────────────────────────
def build_message(consolidated, users, groups, saucers, order_types, monthly_avg):
    now_mx = datetime.now(MX_TZ)
    hora = now_mx.strftime("%H:%M")
    fecha = now_mx.strftime("%d/%m/%Y")

    ventas_netas = consolidated.get("TotalSales", 0)

    tickets = order_types.get("total_ordenes", 0)
    personas = order_types.get("total_personas", 0)

    # Exclude Market staff from restaurant metrics
    market_ventas = sum(u["total"] for u in users if is_market(u["name"], CLIENT))
    ventas_restaurante = ventas_netas - market_ventas
    market_tickets = round(market_ventas / 65) if market_ventas > 0 else 0
    tickets_restaurante = max(tickets - market_tickets, 1)
    ticket_avg = ventas_restaurante / tickets_restaurante if tickets_restaurante else 0
    personas_por_orden = round(personas / tickets_restaurante, 2) if tickets_restaurante and personas else 0

    # Category totals from saucers (keyword match + group-level enrichment)
    hh_items = filter_category(saucers, HH_KEYWORDS)
    signature_items = filter_category(saucers, SIGNATURE_KEYWORDS)
    panaderia_items = filter_category(saucers, PANADERIA_KEYWORDS)
    postre_items = filter_category_ex(saucers, POSTRES_KEYWORDS, POSTRES_EXCLUDE)

    # Enrich from group totals if keyword matching missed items
    # This catches items that don't have obvious keywords (e.g., "TRES LECHES")
    # IMPORTANT: groups have {name, total} where total is PESOS, not qty.
    # Only use g["qty"] if it exists — NEVER use g["total"] as quantity.
    for g in groups:
        gname = g["name"].upper()
        if gname in [pg.upper() for pg in POSTRES_GROUPS]:
            group_qty = g.get("qty", 0)  # Only use actual qty, not monetary total
            saucer_total = sum_qty(postre_items)
            if group_qty and group_qty > saucer_total and saucer_total == 0:
                postre_items.append({"name": f"({gname})", "qty": group_qty, "total": g.get("total", 0)})
        if gname in [pg.upper() for pg in PANADERIA_GROUPS]:
            group_qty = g.get("qty", 0)
            saucer_total = sum_qty(panaderia_items)
            if group_qty and group_qty > saucer_total and saucer_total == 0:
                panaderia_items.append({"name": f"({gname})", "qty": group_qty, "total": g.get("total", 0)})

    # Bebidas total and per-person
    bebida_total_qty = 0
    bebida_total_mxn = 0
    for g in groups:
        if g["name"].upper() in [b.upper() for b in BEBIDA_GROUPS]:
            bebida_total_mxn += g["total"]
            bebida_total_qty += g.get("qty", 0)
    # Fallback: count bebida items from saucers if groups don't have qty
    if bebida_total_qty == 0:
        bebida_keywords = ["CAFE", "LATTE", "CAPUCHINO", "AMERICANO", "ESPRESSO",
                           "JUGO", "SMOOTHIE", "FRAPPE", "TE ", "TISANA", "MATCHA",
                           "LIMONADA", "NARANJADA", "AGUA", "SODA", "REFRESCO",
                           "CHOCOLATE", "MOCHA"]
        for s in saucers:
            name_upper = s["name"].upper()
            if any(kw in name_upper for kw in bebida_keywords):
                bebida_total_qty += s["qty"]
    bebidas_por_persona = round(bebida_total_qty / personas, 2) if personas else 0

    msg = f"""📊 REPORTE INTRADAY — {fecha} {hora}

💰 VENTAS DEL DÍA
• Ventas netas: ${ventas_netas:,.0f}
• Ventas restaurante (sin Market): ${ventas_restaurante:,.0f}
• Market: ${market_ventas:,.0f}
• Tickets restaurante: {tickets_restaurante}
• Personas: {personas}
• Ticket promedio restaurante: ${ticket_avg:,.0f}
• Personas por orden: {personas_por_orden}

🥘 H&H Combo
{sum_qty(hh_items)} piezas

🌮 {SIGNATURE_KEYWORDS[0] if SIGNATURE_KEYWORDS else 'Signature'}
{sum_qty(signature_items)} piezas

🍞 PAN DULCE
{sum_qty(panaderia_items)} piezas"""
    if panaderia_items:
        for item in sorted(panaderia_items, key=lambda x: -x["qty"]):
            if item["qty"] > 0:
                msg += f"\n  - {item['name']}: {item['qty']}"

    msg += f"""

🍰 POSTRES
{sum_qty(postre_items)} piezas"""
    if postre_items:
        for item in sorted(postre_items, key=lambda x: -x["qty"]):
            if item["qty"] > 0:
                msg += f"\n  - {item['name']}: {item['qty']}"

    msg += f"""

☕ BEBIDAS POR PERSONA
{bebidas_por_persona} bebidas/persona ({bebida_total_qty} bebidas / {personas} personas)"""

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

    # Guard: skip if outside operating hours (before 9am MX)
    # BUT allow manual triggers (workflow_dispatch) to run anytime.
    # Hasta medianoche permitido: el cron de cierre (8pm) suele dispararse tarde
    # (9-10pm) y el guard de 21h lo saltaba — así se congeló 2026-06-10 en $58,090.
    mx_hour = now_mx.hour
    if TRIGGER_TYPE != "workflow_dispatch" and mx_hour < 9:
        print(f"[intraday] Outside operating hours ({mx_hour}:00 MX) — skipping")
        return

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
        monitoring = get_monitoring_info(session)
        # Match the Wansoft app's counting: closed orders + OPEN orders.
        # At cierre (10pm+) open ≈ 0, so daily history stays consistent.
        order_types["total_ordenes"] += monitoring["abiertas"]
        order_types["total_personas"] += monitoring["personas_abiertas"]
        print(f"[intraday] Totals incl. open: {order_types['total_ordenes']} ordenes, {order_types['total_personas']} personas")
        monthly_avg = get_monthly_ticket_avg()

        # Log ALL consolidated keys for debugging data accuracy
        print(f"[intraday] Consolidated keys: {list(consolidated.keys()) if isinstance(consolidated, dict) else type(consolidated)}")
        print(f"[intraday] Consolidated: TotalSales={consolidated.get('TotalSales')}, GrossSales={consolidated.get('TotalGrossSales')}, Discounts={consolidated.get('TotalDiscounts')}, Tickets={consolidated.get('TotalTickets', 'N/A')}, Personas={consolidated.get('TotalPersons', 'N/A')}")
        print(f"[intraday] OrderTypes breakdown: {order_types}")
        user_sum = sum(float(str(u.get("total", "0")).replace(",", "").replace("$", "")) for u in users) if users else 0
        print(f"[intraday] Data: {len(users)} users (sum=${user_sum:,.0f}), {len(groups)} groups, {len(saucers)} saucers, {order_types['total_ordenes']} ordenes, {order_types['total_personas']} personas")
        print(f"[intraday] API TotalSales=${consolidated.get('TotalSales', 0):,.0f} vs UserSum=${user_sum:,.0f} (diff=${user_sum - (consolidated.get('TotalSales', 0) or 0):,.0f} = Market)")

        # Hora pico via snapshots acumulativos: Wansoft NO tiene endpoint de
        # ventas por hora (SalesByHours/SalesByHour/etc = 200 pero 0 filas,
        # verificado 2026-06-10). Cada run guarda {hora, ventas, tickets}
        # acumulados; la curva del día se arma por diferencias entre snapshots.
        try:
            snap = {
                "hora": now_mx.strftime("%H:%M"),
                "ventas": consolidated.get("TotalSales", 0) or 0,
                "tickets": order_types.get("total_ordenes", 0) if order_types else 0,
                "personas": order_types.get("total_personas", 0) if order_types else 0,
            }
            _h = {"apikey": os.environ["SUPABASE_SERVICE_KEY"],
                  "Authorization": f"Bearer {os.environ['SUPABASE_SERVICE_KEY']}",
                  "Content-Type": "application/json", "Prefer": "return=minimal"}
            _base = f"{os.environ['SUPABASE_URL'].rstrip('/')}/rest/v1/wansoft_hourly"
            existing = requests.get(f"{_base}?fecha=eq.{today_str}&client_id=eq.{CLIENT['id']}&select=data",
                                    headers=_h, timeout=10)
            snaps = []
            if existing.ok and existing.json():
                prev = existing.json()[0].get("data")
                if isinstance(prev, str):
                    prev = json.loads(prev)
                snaps = prev if isinstance(prev, list) else []
                snaps = [s for s in snaps if s.get("hora") != snap["hora"]]
            snaps.append(snap)
            snaps.sort(key=lambda s: s.get("hora", ""))
            if existing.ok and existing.json():
                requests.patch(f"{_base}?fecha=eq.{today_str}&client_id=eq.{CLIENT['id']}",
                    headers=_h, json={"data": json.dumps(snaps),
                                      "updated_at": datetime.now(timezone.utc).isoformat()}, timeout=10)
            else:
                requests.post(_base, headers=_h,
                    json={"fecha": today_str, "client_id": CLIENT["id"], "data": json.dumps(snaps),
                          "updated_at": datetime.now(timezone.utc).isoformat()}, timeout=10)
            print(f"[intraday] Snapshot guardado: {snap} ({len(snaps)} snapshots hoy)")
        except Exception as e:
            print(f"[intraday] Hourly snapshot failed (non-blocking): {e}")

        # Save ALL fields to wansoft_daily so dashboard pages work
        try:
            sb_h = {"apikey": os.environ["SUPABASE_SERVICE_KEY"],
                    "Authorization": f"Bearer {os.environ['SUPABASE_SERVICE_KEY']}",
                    "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"}

            update_data = {"updated_at": datetime.now(timezone.utc).isoformat()}

            # Ventas brutas, netas, y descuentos
            # CRITICAL: GetConsolidatedSales EXCLUDES Market sales.
            # SalesByUser includes ALL staff (incl Market). Sum all users
            # to get the real total that matches the Wansoft app display.
            if consolidated:
                api_total = consolidated.get("TotalSales", 0) or 0
                user_total = sum(float(str(u.get("total", "0")).replace(",", "").replace("$", "")) for u in users) if users else 0
                # Use whichever is higher — user_total includes Market
                real_total = max(api_total, user_total)
                update_data["ventas_dia"] = real_total
                # Gross sales: same logic — add Market if missing
                api_gross = consolidated.get("TotalGrossSales", 0) or 0
                update_data["ventas_brutas"] = max(api_gross, real_total)
                update_data["descuentos"] = consolidated.get("TotalDiscount", 0) or consolidated.get("TotalDiscounts", 0)

            # Tickets y personas — closed + open orders + Market estimate
            # SalesByTypeOfOrder excludes Market orders. Estimate Market tickets
            # from Market sales / avg Market ticket (~$65 per data rules).
            if order_types:
                market_staff = CLIENT.get("staff_market") or []
                market_sales = sum(float(str(u.get("total", "0")).replace(",", "").replace("$", ""))
                                   for u in users if any(m.lower() in u.get("name", "").lower() for m in market_staff)) if users and market_staff else 0
                market_tickets = round(market_sales / 65) if market_sales > 0 else 0
                update_data["tickets_count"] = order_types.get("total_ordenes", 0) + market_tickets
                update_data["personas_restaurant"] = order_types.get("total_personas", 0) + market_tickets

            # Ventas por grupo
            if groups:
                grupo_data = [{"nombre": g["name"], "total": g.get("total", 0)}
                              for g in groups if g.get("name")]
                update_data["ventas_por_grupo"] = json.dumps(grupo_data)

            # Meseros
            if users:
                _excl = [e.lower() for e in (CLIENT.get("staff_exclude_meseros") or []) + (CLIENT.get("staff_market") or [])]
                mesero_data = []
                for u in users:
                    name = u.get("name", "")
                    if any(ex in name.lower() for ex in _excl):
                        continue
                    total = float(str(u.get("total", "0")).replace(",","").replace("$",""))
                    if total > 0:
                        mesero_data.append({"nombre": name, "total": total})
                if mesero_data:
                    update_data["meseros"] = json.dumps(mesero_data)

            # Platillos vendidos (top 30 for chat to answer "qué platillo se vendió más")
            if saucers:
                platillo_data = [{"nombre": s["name"], "cantidad": s["qty"], "total": s["total"]}
                                 for s in sorted(saucers, key=lambda x: -x["total"])[:30]]
                if platillo_data:
                    update_data["platillos_top"] = json.dumps(platillo_data)

            # Full platillos list (ALL items incl. Market) → wansoft_data.platillos_full
            # so dashboard chat can answer about low-volume products (e.g. Smarty chips)
            if saucers:
                try:
                    full_data = [{"nombre": s["name"], "cantidad": s["qty"], "total": s["total"]}
                                 for s in sorted(saucers, key=lambda x: -x["total"]) if s.get("name")]
                    wd_h = {"apikey": os.environ["SUPABASE_SERVICE_KEY"],
                            "Authorization": f"Bearer {os.environ['SUPABASE_SERVICE_KEY']}",
                            "Content-Type": "application/json", "Prefer": "return=minimal"}
                    wd_base = f"{os.environ['SUPABASE_URL'].rstrip('/')}/rest/v1/wansoft_data"
                    wd_filter = f"client_id=eq.{CLIENT['id']}&fecha=eq.{today_str}&data_key=eq.platillos_full"
                    wd_payload = {"data": full_data,
                                  "updated_at": datetime.now(timezone.utc).isoformat()}
                    wpr = requests.patch(f"{wd_base}?{wd_filter}", headers=wd_h, json=wd_payload, timeout=10)
                    # Check row exists (PATCH 204 even if 0 rows matched)
                    wcr = requests.get(f"{wd_base}?{wd_filter}&select=data_key",
                                       headers={"apikey": os.environ["SUPABASE_SERVICE_KEY"],
                                                "Authorization": f"Bearer {os.environ['SUPABASE_SERVICE_KEY']}"},
                                       timeout=10)
                    if wcr.ok and not wcr.json():
                        requests.post(wd_base, headers=wd_h,
                                      json={"client_id": CLIENT["id"], "fecha": today_str,
                                            "data_key": "platillos_full", **wd_payload}, timeout=10)
                        print(f"[intraday] INSERTED platillos_full ({len(full_data)} items) en wansoft_data")
                    else:
                        print(f"[intraday] Updated platillos_full ({len(full_data)} items) en wansoft_data")
                except Exception as e:
                    print(f"[intraday] platillos_full save failed (non-blocking): {e}")

            # Pago metodos - fetch from Wansoft
            try:
                pay_resp = session.post(f"{WANSOFT_URL}/Reports/SalesByPaymentType",
                    data={"subsidiaryId": SUBSIDIARY_ID, "startDate": today_str, "endDate": today_str}, timeout=15)
                pay_html = pay_resp.text
                pay_soup = BeautifulSoup(pay_html, "html.parser")
                pago_data = []
                for row in pay_soup.select(".rowReport"):
                    cols = [c.text.strip() for c in row.select("div")]
                    # Wansoft cols: [Name, $MXN_amount, Percentage]
                    # e.g. ['Tarjeta de crédito', '$35,089.75', '55.2']
                    if len(cols) >= 2:
                        name = cols[0]
                        # cols[1] = MXN amount (the REAL value)
                        mxn = 0
                        pct = 0
                        try:
                            mxn = float(cols[1].replace(",","").replace("$","").replace("%",""))
                        except ValueError:
                            pass
                        if len(cols) >= 3:
                            try:
                                pct = float(cols[2].replace(",","").replace("$","").replace("%",""))
                            except ValueError:
                                pass
                        if name and mxn > 0:
                            pago_data.append({"nombre": name, "total": round(mxn, 2), "pct": round(pct, 1)})
                if pago_data:
                    print(f"[intraday] Pagos: {[p['nombre'] + ':$' + str(int(p['total'])) + '(' + str(p['pct']) + '%)' for p in pago_data]}")
                if pago_data:
                    update_data["pago_metodos"] = json.dumps(pago_data)
                    # Extract efectivo/tarjeta in MXN
                    for p in pago_data:
                        nm = p["nombre"].lower()
                        if "efectivo" in nm:
                            update_data["efectivo"] = p["total"]
                        elif "tarjeta" in nm or "crédito" in nm or "débito" in nm:
                            update_data.setdefault("tarjeta", 0)
                            update_data["tarjeta"] = update_data.get("tarjeta", 0) + p["total"]
                    print(f"[intraday] Payment methods: {len(pago_data)} → {[p['nombre'] + ':$' + str(int(p['total'])) for p in pago_data]}")
                else:
                    print(f"[intraday] No payment rows found. HTML preview: {pay_html[:200]}")
            except Exception as e:
                print(f"[intraday] Payment methods error: {e}")

            # Propinas — DISABLED: wansoft_kpis has stale value $8587.99 that gets
            # copied infinitely. Only wansoft_deep_scraper should write propinas_total
            # when it gets REAL data from the SalesByUser endpoint.
            # DO NOT copy from wansoft_kpis — it's a stale accumulator, not daily.

            # Ticket promedio — ventas / tickets (matches Wansoft app definition)
            ventas_total = consolidated.get("TotalSales", 0) or 0
            tickets = update_data.get("tickets_count", 0)
            personas = update_data.get("personas_restaurant", 0)
            if tickets and tickets > 0:
                update_data["ticket_promedio_restaurant"] = round(ventas_total / tickets, 2)

            # UPSERT: try PATCH first, if no rows affected try INSERT
            update_data["client_slug"] = CLIENT["id"]
            update_data["fecha"] = today_str
            pr = requests.patch(
                f"{os.environ['SUPABASE_URL'].rstrip('/')}/rest/v1/wansoft_daily?fecha=eq.{today_str}&client_slug=eq.{CLIENT['id']}",
                headers=sb_h, json=update_data, timeout=10)
            # PostgREST returns 204 (No Content) on successful PATCH with
            # return=minimal — 204 is SUCCESS, not failure.
            # Check if PATCH found a row — if not, INSERT
            if pr.status_code in (200, 204):
                # Verify row exists
                cr = requests.get(
                    f"{os.environ['SUPABASE_URL'].rstrip('/')}/rest/v1/wansoft_daily?fecha=eq.{today_str}&client_slug=eq.{CLIENT['id']}&select=fecha",
                    headers={"apikey": os.environ["SUPABASE_SERVICE_KEY"], "Authorization": f"Bearer {os.environ['SUPABASE_SERVICE_KEY']}"},
                    timeout=10)
                if cr.ok and not cr.json():
                    # Row doesn't exist — INSERT
                    requests.post(
                        f"{os.environ['SUPABASE_URL'].rstrip('/')}/rest/v1/wansoft_daily",
                        headers=sb_h, json=update_data, timeout=10)
                    print(f"[intraday] INSERTED new wansoft_daily row for {today_str} ({len(update_data)} fields)")
                else:
                    print(f"[intraday] Updated wansoft_daily with {len(update_data)} fields")
            else:
                print(f"[intraday] PATCH failed ({pr.status_code}), trying INSERT...")
                requests.post(
                    f"{os.environ['SUPABASE_URL'].rstrip('/')}/rest/v1/wansoft_daily",
                    headers=sb_h, json=update_data, timeout=10)
                print(f"[intraday] INSERTED wansoft_daily for {today_str}")

            # ── VALIDATION: read back and compare ──
            try:
                vr = requests.get(
                    f"{os.environ['SUPABASE_URL'].rstrip('/')}/rest/v1/wansoft_daily?fecha=eq.{today_str}&select=ventas_dia,tickets_count,personas_restaurant,ticket_promedio_restaurant,efectivo,tarjeta",
                    headers={"apikey": os.environ["SUPABASE_SERVICE_KEY"], "Authorization": f"Bearer {os.environ['SUPABASE_SERVICE_KEY']}"},
                    timeout=10)
                if vr.ok and vr.json():
                    db = vr.json()[0]
                    mismatches = []
                    checks = [
                        ("ventas_dia", update_data.get("ventas_dia"), float(db.get("ventas_dia") or 0)),
                        ("tickets_count", update_data.get("tickets_count"), int(db.get("tickets_count") or 0)),
                        ("personas_restaurant", update_data.get("personas_restaurant"), int(db.get("personas_restaurant") or 0)),
                    ]
                    for field, expected, actual in checks:
                        if expected is not None and abs(float(expected) - float(actual)) > 1:
                            mismatches.append(f"{field}: wrote={expected} read={actual}")
                    if mismatches:
                        print(f"[intraday] VALIDATION FAILED: {mismatches}")
                    else:
                        print(f"[intraday] VALIDATION OK: ventas=${db.get('ventas_dia')}, tickets={db.get('tickets_count')}, personas={db.get('personas_restaurant')}")
            except Exception as ve:
                print(f"[intraday] Validation check failed: {ve}")
        except Exception as e:
            print(f"[intraday] wansoft_daily update failed (non-blocking): {e}")

        # Don't send report if no sales (restaurant closed or data not yet available)
        ventas = consolidated.get("TotalSales", 0)
        if ventas == 0 and order_types["total_ordenes"] == 0:
            print("[intraday] No sales data — skipping report")
            return

        # Telegram disabled (2026-06-13) — data goes to Supabase only
        # msg = build_message(consolidated, users, groups, saucers, order_types, monthly_avg)
        # sent = send_telegram(msg)

        duration = int((time.time() - start) * 1000)
        ventas = consolidated.get("TotalSales", 0)
        log_run("success", duration, f"Ventas: ${ventas:,.0f}, {len(users)} meseros, DB only")
        print("[intraday] Done")

    except Exception as e:
        duration = int((time.time() - start) * 1000)
        log_run("error", duration, error=str(e))
        print(f"[intraday] ERROR: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
