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

    tickets = order_types.get("total_tickets", 0)
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

    # Guard: skip if outside operating hours (before 9am or after 9pm MX)
    # BUT allow manual triggers (workflow_dispatch) to run anytime
    mx_hour = now_mx.hour
    if TRIGGER_TYPE != "workflow_dispatch" and (mx_hour < 9 or mx_hour >= 21):
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
        monthly_avg = get_monthly_ticket_avg()

        # Log ALL consolidated keys for debugging data accuracy
        print(f"[intraday] Consolidated keys: {list(consolidated.keys()) if isinstance(consolidated, dict) else type(consolidated)}")
        print(f"[intraday] Consolidated: TotalSales={consolidated.get('TotalSales')}, GrossSales={consolidated.get('TotalGrossSales')}, Discounts={consolidated.get('TotalDiscounts')}, Tickets={consolidated.get('TotalTickets', 'N/A')}, Personas={consolidated.get('TotalPersons', 'N/A')}")
        print(f"[intraday] OrderTypes breakdown: {order_types}")
        print(f"[intraday] Data: {len(users)} users, {len(groups)} groups, {len(saucers)} saucers, {order_types['total_tickets']} tickets, {order_types['total_personas']} personas")

        # Save hourly sales to Supabase for historical analysis
        try:
            hours_html = session.post(f"{WANSOFT_URL}/Reports/SalesByHours",
                data={"subsidiaryId": SUBSIDIARY_ID, "startDate": today_str, "endDate": today_str}, timeout=15).text
            hours_soup = BeautifulSoup(hours_html, "html.parser")
            hours_data = []
            for row in hours_soup.select(".rowReport"):
                cols = [c.text.strip() for c in row.select("div")]
                if len(cols) >= 5:
                    hours_data.append({"hora": cols[0], "subtotal": cols[1], "iva": cols[2], "total": cols[3], "pct": cols[4]})
            if hours_data:
                sb_headers = {"apikey": os.environ["SUPABASE_SERVICE_KEY"],
                              "Authorization": f"Bearer {os.environ['SUPABASE_SERVICE_KEY']}",
                              "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"}
                requests.post(f"{os.environ['SUPABASE_URL'].rstrip('/')}/rest/v1/wansoft_hourly",
                    headers=sb_headers,
                    json={"fecha": today_str, "client_id": CLIENT["id"], "data": json.dumps(hours_data),
                          "updated_at": datetime.now(timezone.utc).isoformat()},
                    timeout=10)
                print(f"[intraday] Saved {len(hours_data)} hourly entries to Supabase")
        except Exception as e:
            print(f"[intraday] Hourly save failed (non-blocking): {e}")

        # Save ALL fields to wansoft_daily so dashboard pages work
        try:
            sb_h = {"apikey": os.environ["SUPABASE_SERVICE_KEY"],
                    "Authorization": f"Bearer {os.environ['SUPABASE_SERVICE_KEY']}",
                    "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"}

            update_data = {"updated_at": datetime.now(timezone.utc).isoformat()}

            # Ventas brutas, netas, y descuentos
            if consolidated:
                update_data["ventas_brutas"] = consolidated.get("TotalGrossSales", 0)
                update_data["descuentos"] = consolidated.get("TotalDiscounts", 0)
                update_data["ventas_dia"] = consolidated.get("TotalSales", 0)

            # Tickets y personas — prefer consolidated (matches Wansoft app), fallback to order_types
            if consolidated and consolidated.get("TotalTickets"):
                update_data["tickets_count"] = int(consolidated["TotalTickets"])
                update_data["personas_restaurant"] = int(consolidated.get("TotalPersons", 0))
            elif consolidated and consolidated.get("Tickets"):
                update_data["tickets_count"] = int(consolidated["Tickets"])
                update_data["personas_restaurant"] = int(consolidated.get("Persons", consolidated.get("Personas", 0)))
            elif order_types:
                update_data["tickets_count"] = order_types.get("total_tickets", 0)
                update_data["personas_restaurant"] = order_types.get("total_personas", 0)

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

            # Pago metodos - fetch from Wansoft
            try:
                pay_resp = session.post(f"{WANSOFT_URL}/Reports/SalesByPaymentType",
                    data={"subsidiaryId": SUBSIDIARY_ID, "startDate": today_str, "endDate": today_str}, timeout=15)
                pay_html = pay_resp.text
                pay_soup = BeautifulSoup(pay_html, "html.parser")
                pago_data = []
                ventas_for_pago = update_data.get("ventas_dia") or (consolidated.get("TotalSales", 0) if consolidated else 0)
                for row in pay_soup.select(".rowReport"):
                    cols = [c.text.strip() for c in row.select("div")]
                    if len(cols) >= 2:
                        name = cols[0]
                        # Try last column for total (Wansoft returns percentages, not MXN)
                        pct = 0
                        for c in reversed(cols[1:]):
                            try:
                                pct = float(c.replace(",","").replace("$","").replace("%",""))
                                if pct > 0: break
                            except ValueError:
                                continue
                        if name and pct > 0:
                            # Convert % to MXN: if value < 100, it's a percentage
                            mxn = round(ventas_for_pago * pct / 100, 2) if pct < 100 else pct
                            pago_data.append({"nombre": name, "total": mxn, "pct": round(pct, 1)})
                # Log raw for debugging
                if pago_data:
                    print(f"[intraday] Pagos (MXN): {[p['nombre'] + ':$' + str(int(p['total'])) + '(' + str(p['pct']) + '%)' for p in pago_data]}")
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

            requests.patch(
                f"{os.environ['SUPABASE_URL'].rstrip('/')}/rest/v1/wansoft_daily?fecha=eq.{today_str}",
                headers=sb_h, json=update_data, timeout=10)
            print(f"[intraday] Updated wansoft_daily with {len(update_data)} fields")
        except Exception as e:
            print(f"[intraday] wansoft_daily update failed (non-blocking): {e}")

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
