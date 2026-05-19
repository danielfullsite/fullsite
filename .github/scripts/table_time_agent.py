#!/usr/bin/env python3
"""
Table Time Agent — Multi-tenant
Analiza rotacion de mesas y tiempos de servicio.
Corre a las 3pm y 7pm MX.

"Hoy las mesas duran 15 min mas que el promedio."
"Estas atendiendo menos mesas/hora que lo normal."

NOTE: Sera mas preciso cuando AMALAY migre a Fullsite POS (opened_at/paid_at).
Por ahora estima desde tickets/hora y personas/mesa.
"""

import os
import sys
import json
import time
import requests
from datetime import datetime, timedelta, timezone
from client_config import get_client, get_tz, get_chat_ids

# -- Config --
CLIENT = get_client()
MX_TZ = get_tz(CLIENT)
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TG_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_IDS = get_chat_ids(CLIENT, "intraday")
TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "cron")

sb_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}

# Horario de operacion (para calcular tickets/hora)
OPEN_HOUR = 8   # 8am
CLOSE_HOUR = 22  # 10pm


# -- Supabase helpers --
def sb_get(table, params):
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers=sb_headers, params=params, timeout=10,
        )
        return r.json() if r.ok else []
    except:
        return []


# -- Data fetching --
def get_today_kpis():
    rows = sb_get("wansoft_kpis", {"select": "*", "limit": "1"})
    return rows[0] if rows else None


def get_historical(days=30):
    return sb_get("wansoft_daily", {
        "select": "fecha,ventas_dia,tickets_count,mesas_atendidas,personas_restaurant,ticket_promedio_restaurant,hora_pico",
        "ventas_dia": "gt.0",
        "order": "fecha.desc",
        "limit": str(days),
    })


def get_pos_orders_today(today_str):
    """Try to fetch Fullsite POS orders if available."""
    return sb_get("pos_orders", {
        "select": "id,opened_at,paid_at,table_number,total,status",
        "opened_at": f"gte.{today_str}T00:00:00",
        "status": "eq.paid",
        "order": "opened_at.asc",
        "limit": "500",
    })


# -- Analysis --
def calc_hours_open(now_mx):
    """How many hours has the restaurant been open today."""
    open_time = now_mx.replace(hour=OPEN_HOUR, minute=0, second=0, microsecond=0)
    if now_mx < open_time:
        return 0
    hours = (now_mx - open_time).total_seconds() / 3600
    return min(hours, CLOSE_HOUR - OPEN_HOUR)


def analyze_from_pos(orders):
    """Analyze table times from POS orders (opened_at to paid_at)."""
    times = []
    for o in orders:
        opened = o.get("opened_at")
        paid = o.get("paid_at")
        if not opened or not paid:
            continue
        try:
            t_open = datetime.fromisoformat(opened.replace("Z", "+00:00"))
            t_paid = datetime.fromisoformat(paid.replace("Z", "+00:00"))
            mins = (t_paid - t_open).total_seconds() / 60
            if 5 < mins < 300:  # Filter outliers
                times.append({"table": o.get("table_number"), "minutes": round(mins)})
        except:
            continue

    if not times:
        return None

    avg_mins = round(sum(t["minutes"] for t in times) / len(times))
    return {
        "source": "pos",
        "orders": len(times),
        "avg_minutes": avg_mins,
        "max_minutes": max(t["minutes"] for t in times),
        "min_minutes": min(t["minutes"] for t in times),
    }


def analyze_from_wansoft(today_kpis, historical, now_mx):
    """Estimate table turnover from Wansoft ticket/mesa data."""
    hours_open = calc_hours_open(now_mx)
    if hours_open < 1:
        return None

    today_tickets = today_kpis.get("tickets_count", 0) or 0
    today_mesas = today_kpis.get("mesas_atendidas", 0) or 0
    today_personas = today_kpis.get("personas_restaurant", 0) or 0

    if today_tickets == 0:
        return None

    # Today's rates
    tickets_per_hour = round(today_tickets / hours_open, 1)
    mesas_per_hour = round(today_mesas / hours_open, 1) if today_mesas > 0 else 0
    personas_per_mesa = round(today_personas / today_mesas, 1) if today_mesas > 0 else 0

    # Estimate average time per table
    # If we served X mesas in Y hours with Z total capacity, avg time ~ Y*60/turnover_rate
    # Simplified: minutes_per_mesa ~ hours_open * 60 / (mesas / assumed_capacity)
    # Better: use tickets_per_hour as throughput proxy
    est_minutes_per_mesa = round(60 / tickets_per_hour) if tickets_per_hour > 0 else 0

    # Historical comparison (same day of week)
    today_dow = now_mx.weekday()
    hist_same_dow = []
    for d in historical:
        dt = datetime.strptime(d["fecha"], "%Y-%m-%d")
        if dt.weekday() == today_dow:
            t = d.get("tickets_count", 0) or 0
            m = d.get("mesas_atendidas", 0) or 0
            if t > 0:
                # Assume full-day operation for historical
                full_hours = CLOSE_HOUR - OPEN_HOUR
                hist_same_dow.append({
                    "tickets_per_hour": round(t / full_hours, 1),
                    "mesas_per_hour": round(m / full_hours, 1) if m > 0 else 0,
                    "tickets": t,
                    "mesas": m,
                })

    hist_avg_tph = 0
    hist_avg_mph = 0
    if hist_same_dow:
        hist_avg_tph = round(sum(h["tickets_per_hour"] for h in hist_same_dow) / len(hist_same_dow), 1)
        hist_avg_mph = round(sum(h["mesas_per_hour"] for h in hist_same_dow) / len(hist_same_dow), 1)

    return {
        "source": "wansoft_estimate",
        "hours_open": round(hours_open, 1),
        "today_tickets": today_tickets,
        "today_mesas": today_mesas,
        "today_personas": today_personas,
        "tickets_per_hour": tickets_per_hour,
        "mesas_per_hour": mesas_per_hour,
        "personas_per_mesa": personas_per_mesa,
        "est_minutes_per_mesa": est_minutes_per_mesa,
        "hist_avg_tph": hist_avg_tph,
        "hist_avg_mph": hist_avg_mph,
        "hist_sample": len(hist_same_dow),
    }


# -- Build message --
def build_message(analysis, today_kpis):
    if not analysis:
        return None

    now_mx = datetime.now(MX_TZ)
    msg = f"ROTACION MESAS — {now_mx.strftime('%d/%m %H:%M')}\n\n"

    if analysis["source"] == "pos":
        msg += f"Ordenes cerradas: {analysis['orders']}\n"
        msg += f"Tiempo promedio: {analysis['avg_minutes']} min\n"
        msg += f"Min: {analysis['min_minutes']} min | Max: {analysis['max_minutes']} min\n"
        return msg

    # Wansoft estimate
    a = analysis
    msg += f"Horas abiertas: {a['hours_open']}h\n"
    msg += f"Tickets: {a['today_tickets']} ({a['tickets_per_hour']}/hora)\n"
    if a["today_mesas"] > 0:
        msg += f"Mesas: {a['today_mesas']} ({a['mesas_per_hour']}/hora)\n"
        msg += f"Personas/mesa: {a['personas_per_mesa']}\n"

    insights = []

    # Compare vs historical
    if a["hist_avg_tph"] > 0 and a["tickets_per_hour"] > 0:
        diff_pct = round((a["tickets_per_hour"] / a["hist_avg_tph"] - 1) * 100)
        if diff_pct < -15:
            insights.append(
                f"Tickets/hora ({a['tickets_per_hour']}) esta {abs(diff_pct)}% abajo del promedio ({a['hist_avg_tph']}). "
                f"Posible cuello de botella en cocina o servicio."
            )
        elif diff_pct > 15:
            insights.append(
                f"Tickets/hora ({a['tickets_per_hour']}) esta {diff_pct}% arriba del promedio ({a['hist_avg_tph']}). Buen ritmo."
            )

    if a["hist_avg_mph"] > 0 and a["mesas_per_hour"] > 0:
        diff_pct = round((a["mesas_per_hour"] / a["hist_avg_mph"] - 1) * 100)
        if diff_pct < -15:
            insights.append(
                f"Mesas/hora ({a['mesas_per_hour']}) esta {abs(diff_pct)}% abajo. Las mesas se estan tardando mas."
            )

    if a["est_minutes_per_mesa"] > 0:
        msg += f"Tiempo estimado/mesa: ~{a['est_minutes_per_mesa']} min\n"

    if a["personas_per_mesa"] > 3:
        insights.append(
            f"Mesas promedio de {a['personas_per_mesa']} personas — mesas grandes tardan mas. Normal."
        )

    # Ordenes abiertas
    ordenes_abiertas = today_kpis.get("ordenes_abiertas", 0) or 0
    if ordenes_abiertas > 0:
        msg += f"Ordenes abiertas ahora: {ordenes_abiertas}\n"
        total_abiertas = today_kpis.get("total_ordenes_mxn", 0) or 0
        if total_abiertas > 0:
            msg += f"Valor en mesas abiertas: ${total_abiertas:,.0f}\n"

    if not insights:
        return None  # Nothing interesting to report

    msg += "\n"
    for i in insights:
        msg += f"  - {i}\n"

    if any("cocina" in i.lower() or "tardan" in i.lower() for i in insights):
        msg += "\nACCION:\n"
        msg += "  - Revisar tiempos de cocina\n"
        msg += "  - Verificar si hay platillos atrasados\n"

    return msg


# -- Telegram --
def send_telegram(msg):
    sent = 0
    for chat_id in TG_CHAT_IDS:
        if not chat_id:
            continue
        chunks = [msg[i:i + 4000] for i in range(0, len(msg), 4000)]
        for chunk in chunks:
            r = requests.post(
                f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                json={"chat_id": chat_id, "text": chunk},
            )
            if r.ok:
                sent += 1
    return sent


# -- Main --
def main():
    start = time.time()
    now_mx = datetime.now(MX_TZ)
    today_str = now_mx.strftime("%Y-%m-%d")

    print(f"[table_time] Starting for {CLIENT['id']} on {today_str}")

    # 1. Fetch today's KPIs
    today_kpis = get_today_kpis()
    if not today_kpis:
        print("[table_time] No KPI data — skipping")
        return

    ventas = today_kpis.get("ventas_dia", 0) or 0
    if ventas == 0:
        print("[table_time] Ventas = $0 — skipping")
        return

    # 2. Try POS orders first
    pos_orders = get_pos_orders_today(today_str)
    analysis = None

    if pos_orders and len(pos_orders) > 3:
        print(f"[table_time] Using POS data: {len(pos_orders)} orders")
        analysis = analyze_from_pos(pos_orders)

    # 3. Fallback to Wansoft estimate
    if not analysis:
        print("[table_time] Using Wansoft estimate")
        historical = get_historical(30)
        print(f"[table_time] Historical: {len(historical)} days")
        analysis = analyze_from_wansoft(today_kpis, historical, now_mx)

    if not analysis:
        print("[table_time] No analysis possible — skipping")
        return

    # 4. Build and send
    msg = build_message(analysis, today_kpis)
    elapsed = int((time.time() - start) * 1000)

    if not msg:
        print("[table_time] No insights to report — silent")
        log_run("success", elapsed, "no_insights")
        return

    print(f"\n{msg}")
    sent = send_telegram(msg)
    print(f"[table_time] Sent to {sent} chats in {elapsed}ms")

    log_run("success", elapsed, f"source={analysis['source']}, sent to {sent}")


def log_run(status, elapsed, summary):
    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_runs",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
            json={
                "agent_id": "table-time",
                "trigger_type": TRIGGER_TYPE,
                "status": status,
                "duration_ms": elapsed,
                "output_summary": summary,
                "tentacle": "ops",
            },
        )
    except:
        pass


if __name__ == "__main__":
    main()
