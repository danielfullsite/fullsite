#!/usr/bin/env python3
"""
Kitchen Quality Agent — Multi-tenant
Monitorea cancelaciones y patrones de problemas en cocina.
Corre diario a las 4pm MX.

"Pancakes se cancelaron 3 veces esta semana — posible problema de calidad."
"Cancelaciones 40% arriba del promedio hoy."

NOTE: Full functionality cuando AMALAY use Fullsite POS con kitchen display.
Por ahora analiza cancelaciones y devoluciones del scraper de Wansoft.
"""

import os
import sys
import json
import time
import requests
from datetime import datetime, timedelta, timezone
from collections import defaultdict
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
def get_recent_daily(days=7):
    """Fetch last N days from wansoft_daily."""
    now_mx = datetime.now(MX_TZ)
    start_date = (now_mx - timedelta(days=days)).strftime("%Y-%m-%d")
    return sb_get("wansoft_daily", {"client_slug": f"eq.{CLIENT['id']}",
        "select": "fecha,ventas_dia,descuentos,tickets_count,ventas_por_grupo",
        "fecha": f"gte.{start_date}",
        "ventas_dia": "gt.0",
        "order": "fecha.desc",
        "limit": str(days),
    })


def get_historical_avg(days=30):
    """Fetch longer history for baseline comparison."""
    return sb_get("wansoft_daily", {"client_slug": f"eq.{CLIENT['id']}",
        "select": "fecha,descuentos,tickets_count,ventas_dia",
        "ventas_dia": "gt.0",
        "order": "fecha.desc",
        "limit": str(days),
    })


def get_today_kpis():
    rows = sb_get("wansoft_kpis", {"select": "*", "limit": "1"})
    return rows[0] if rows else None


# -- Analysis --
def analyze_cancellations(recent, historical):
    """Analyze cancellation/return patterns."""
    insights = []

    if not recent:
        return insights

    # Today's data
    today = recent[0]
    today_devs = today.get("devoluciones", 0) or 0
    today_desc = today.get("descuentos", 0) or 0
    today_ventas = today.get("ventas_dia", 0) or 0
    today_tickets = today.get("tickets_count", 0) or 0

    if today_ventas == 0:
        return insights

    # Devolucion rate today
    today_dev_rate = round(today_devs / today_ventas * 100, 2) if today_ventas > 0 else 0

    # Historical average devolucion rate
    hist_dev_rates = []
    for d in historical:
        v = d.get("ventas_dia", 0) or 0
        dev = d.get("devoluciones", 0) or 0
        if v > 0:
            hist_dev_rates.append(dev / v * 100)

    if hist_dev_rates:
        avg_dev_rate = sum(hist_dev_rates) / len(hist_dev_rates)
        if today_dev_rate > avg_dev_rate * 1.5 and today_devs > 100:
            insights.append({
                "tipo": "devoluciones_alto",
                "prioridad": "alta",
                "msg": f"Devoluciones hoy: ${today_devs:,.0f} ({today_dev_rate:.1f}% de ventas) vs promedio {avg_dev_rate:.1f}%. Revisar que esta pasando.",
            })

    # Descuento rate
    today_desc_rate = round(today_desc / today_ventas * 100, 2) if today_ventas > 0 else 0
    hist_desc_rates = []
    for d in historical:
        v = d.get("ventas_dia", 0) or 0
        desc = d.get("descuentos", 0) or 0
        if v > 0:
            hist_desc_rates.append(desc / v * 100)

    if hist_desc_rates:
        avg_desc_rate = sum(hist_desc_rates) / len(hist_desc_rates)
        if today_desc_rate > avg_desc_rate * 1.5 and today_desc > 200:
            insights.append({
                "tipo": "descuentos_alto",
                "prioridad": "media",
                "msg": f"Descuentos hoy: ${today_desc:,.0f} ({today_desc_rate:.1f}%) vs promedio {avg_desc_rate:.1f}%. Verificar si son autorizados.",
            })

    return insights


def analyze_weekly_patterns(recent):
    """Look for platillo patterns across the week (repeated issues)."""
    insights = []

    if len(recent) < 3:
        return insights

    # Track devoluciones trend
    devs = [(d.get("fecha", ""), d.get("devoluciones", 0) or 0) for d in recent]
    if all(d[1] > 0 for d in devs[:3]):
        # Check if trend is increasing
        if len(devs) >= 3 and devs[0][1] > devs[1][1] > devs[2][1]:
            insights.append({
                "tipo": "tendencia",
                "prioridad": "media",
                "msg": f"Devoluciones en aumento: ${devs[2][1]:,.0f} -> ${devs[1][1]:,.0f} -> ${devs[0][1]:,.0f} (ultimos 3 dias).",
            })

    # Analyze platillo patterns — which groups are seeing drops
    group_trends = defaultdict(list)
    for day in recent:
        vpg = day.get("ventas_por_grupo") or []
        if isinstance(vpg, str):
            vpg = json.loads(vpg)
        ventas = day.get("ventas_dia", 0) or 0
        if ventas == 0:
            continue
        for g in vpg:
            name = g.get("nombre", "")
            total = g.get("total", 0)
            group_trends[name].append(total)

    # Find groups with consistent drops (possible quality issue causing lower sales)
    for group, totals in group_trends.items():
        if len(totals) < 4:
            continue
        recent_avg = sum(totals[:3]) / 3
        older_avg = sum(totals[3:]) / len(totals[3:])
        if older_avg > 0 and recent_avg < older_avg * 0.7:
            drop_pct = round((1 - recent_avg / older_avg) * 100)
            insights.append({
                "tipo": "grupo_baja",
                "prioridad": "baja",
                "msg": f"{group}: ventas bajaron {drop_pct}% esta semana vs anterior. Posible problema de calidad o disponibilidad.",
            })

    return insights


def analyze_descuentos_per_ticket(recent, historical):
    """Track if descuentos per ticket is abnormal (possible comps for complaints)."""
    insights = []

    today = recent[0] if recent else None
    if not today:
        return insights

    today_desc = today.get("descuentos", 0) or 0
    today_tickets = today.get("tickets_count", 0) or 0
    if today_tickets == 0:
        return insights

    today_dpt = today_desc / today_tickets

    hist_dpt = []
    for d in historical:
        desc = d.get("descuentos", 0) or 0
        tickets = d.get("tickets_count", 0) or 0
        if tickets > 0:
            hist_dpt.append(desc / tickets)

    if not hist_dpt:
        return insights

    avg_dpt = sum(hist_dpt) / len(hist_dpt)
    if avg_dpt > 0 and today_dpt > avg_dpt * 2 and today_desc > 100:
        insights.append({
            "tipo": "descuento_ticket",
            "prioridad": "media",
            "msg": f"Descuento/ticket: ${today_dpt:,.0f} hoy vs ${avg_dpt:,.0f} promedio. Muchas cortesias = posibles quejas.",
        })

    return insights


# -- Build message --
def build_message(cancel_insights, pattern_insights, dpt_insights, today_data):
    all_insights = cancel_insights + pattern_insights + dpt_insights

    if not all_insights:
        return None

    now_mx = datetime.now(MX_TZ)
    msg = f"COCINA — {now_mx.strftime('%d/%m %H:%M')}\n\n"

    if today_data:
        devs = today_data.get("devoluciones", 0) or 0
        desc = today_data.get("descuentos", 0) or 0
        ventas = today_data.get("ventas_dia", 0) or 0
        msg += f"Ventas: ${ventas:,.0f}\n"
        msg += f"Devoluciones: ${devs:,.0f} | Descuentos: ${desc:,.0f}\n\n"

    # High priority first
    high = [i for i in all_insights if i.get("prioridad") == "alta"]
    medium = [i for i in all_insights if i.get("prioridad") == "media"]
    low = [i for i in all_insights if i.get("prioridad") == "baja"]

    if high:
        msg += "ALERTA:\n"
        for i in high:
            msg += f"  - {i['msg']}\n"
        msg += "\n"

    if medium:
        msg += "ATENCION:\n"
        for i in medium:
            msg += f"  - {i['msg']}\n"
        msg += "\n"

    if low:
        msg += "NOTA:\n"
        for i in low:
            msg += f"  - {i['msg']}\n"
        msg += "\n"

    # Action items
    actions = []
    if high:
        actions.append("Hablar con cocina sobre las devoluciones de hoy")
        actions.append("Revisar que platillos se estan devolviendo")
    if any("cortesia" in i.get("msg", "").lower() or "quejas" in i.get("msg", "").lower() for i in all_insights):
        actions.append("Verificar log de descuentos — que fueron cortesias legítimas")
    if any("disponibilidad" in i.get("msg", "").lower() for i in all_insights):
        actions.append("Revisar inventario de ingredientes con cocina")

    if actions:
        msg += "ACCION:\n"
        for a in actions:
            msg += f"  - {a}\n"

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

    print(f"[kitchen] Starting for {CLIENT['id']} on {today_str}")

    # 1. Fetch data
    recent = get_recent_daily(7)
    historical = get_historical_avg(30)
    today_kpis = get_today_kpis()
    print(f"[kitchen] Recent: {len(recent)} days, Historical: {len(historical)} days")

    if not recent and not today_kpis:
        print("[kitchen] No data — skipping")
        return

    # Use KPIs as today's data if available, prepend to recent
    today_data = today_kpis if today_kpis else (recent[0] if recent else None)

    if today_data:
        ventas = today_data.get("ventas_dia", 0) or 0
        if ventas == 0:
            print("[kitchen] Ventas = $0 — skipping")
            return

    # 2. Analyze
    # Merge today KPIs into recent for analysis
    effective_recent = recent
    if today_kpis and (not recent or recent[0].get("fecha") != today_str):
        effective_recent = [today_kpis] + recent

    cancel_insights = analyze_cancellations(effective_recent, historical)
    pattern_insights = analyze_weekly_patterns(effective_recent)
    dpt_insights = analyze_descuentos_per_ticket(effective_recent, historical)

    total = len(cancel_insights) + len(pattern_insights) + len(dpt_insights)
    print(f"[kitchen] Found {total} insights")

    # 3. Build structured data and save to DB
    all_insights = cancel_insights + pattern_insights + dpt_insights
    structured_data = {
        "cancel_insights": cancel_insights,
        "pattern_insights": pattern_insights,
        "descuento_per_ticket_insights": dpt_insights,
        "today_stats": {
            "ventas": today_data.get("ventas_dia", 0) or 0,
            "devoluciones": today_data.get("devoluciones", 0) or 0,
            "descuentos": today_data.get("descuentos", 0) or 0,
        } if today_data else {},
        "total_insights": total,
    }

    has_high = any(i.get("prioridad") == "alta" for i in all_insights)
    priority = "warning" if has_high else "info"
    summary = f"{total} problemas de calidad detectados" if total > 0 else "Sin problemas de calidad"

    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_results",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"},
            json={
                "client_id": CLIENT["id"],
                "agent_id": "kitchen",
                "fecha": today_str,
                "data": json.dumps(structured_data),
                "summary": summary,
                "priority": priority,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        print(f"[kitchen] Saved to agent_results")
    except Exception as e:
        print(f"[kitchen] Error saving to DB: {e}")

    elapsed = int((time.time() - start) * 1000)
    print(f"[kitchen] Done in {elapsed}ms — {summary}")

    log_run("success", elapsed, f"{total} insights")


def log_run(status, elapsed, summary):
    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_runs",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
            json={
                "agent_id": "kitchen-quality",
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
