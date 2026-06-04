#!/usr/bin/env python3
"""
Speed of Service Agent — Multi-tenant
Mide tiempos de preparacion por platillo y por mesero.
Detecta cuellos de botella en cocina.
Corre diario a las 4pm MX.

"Pancakes tardan 18 min promedio (benchmark: 12 min) — cuello de botella."
"Mesa 8 espero 25 min — 2x el promedio."
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
# Least privilege: agent key (SELECT + INSERT agent_runs/results)
SUPABASE_KEY = os.environ.get("SUPABASE_AGENT_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
TG_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_IDS = get_chat_ids(CLIENT, "intraday")
TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "cron")

sb_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}

def sb_get(table, params):
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers=sb_headers, params=params, timeout=10,
        )
        return r.json() if r.ok else []
    except:
        return []


def get_today_orders():
    """Fetch today's closed orders from POS."""
    now_mx = datetime.now(MX_TZ)
    today = now_mx.strftime("%Y-%m-%d")
    return sb_get("pos_orders", {
        "select": "id,mesa,mesero,items,created_at,closed_at,status,total",
        "client_id": f"eq.{CLIENT['id']}",
        "status": "eq.cerrada",
        "created_at": f"gte.{today}T00:00:00",
        "order": "created_at.desc",
        "limit": "200",
    })


def get_audit_log_today():
    """Fetch today's audit log for status change timestamps."""
    now_mx = datetime.now(MX_TZ)
    today = now_mx.strftime("%Y-%m-%d")
    return sb_get("pos_audit_log", {
        "select": "order_id,action,details,created_at",
        "action": "eq.status_changed",
        "created_at": f"gte.{today}T00:00:00",
        "order": "created_at.asc",
        "limit": "500",
    })


def analyze_speed(orders, audit_log):
    """Analyze speed of service from order lifecycle."""
    insights = []

    if not orders:
        return insights, {}

    # Build timeline per order from audit log
    order_timeline = defaultdict(list)
    for entry in audit_log:
        oid = entry.get("order_id", "")
        details = entry.get("details", {})
        if isinstance(details, str):
            try: details = json.loads(details)
            except: details = {}
        order_timeline[oid].append({
            "from": details.get("from", ""),
            "to": details.get("to", ""),
            "at": entry.get("created_at", ""),
        })

    # Calculate times per order
    order_times = []
    mesero_times = defaultdict(list)
    platillo_times = defaultdict(list)

    for order in orders:
        oid = order["id"]
        created = order.get("created_at", "")
        closed = order.get("closed_at", "")
        mesero = order.get("mesero", "Desconocido")
        mesa = order.get("mesa", 0)

        if not created or not closed:
            continue

        try:
            t_created = datetime.fromisoformat(created.replace("Z", "+00:00"))
            t_closed = datetime.fromisoformat(closed.replace("Z", "+00:00"))
            total_mins = (t_closed - t_created).total_seconds() / 60
        except:
            continue

        if total_mins <= 0 or total_mins > 240:  # skip invalid
            continue

        # Get kitchen time from audit log
        timeline = order_timeline.get(oid, [])
        t_sent = None
        t_ready = None
        for event in timeline:
            if event["to"] == "preparando" and event["from"] == "enviada":
                try: t_sent = datetime.fromisoformat(event["at"].replace("Z", "+00:00"))
                except: pass
            if event["to"] == "lista":
                try: t_ready = datetime.fromisoformat(event["at"].replace("Z", "+00:00"))
                except: pass

        kitchen_mins = None
        if t_sent and t_ready:
            kitchen_mins = (t_ready - t_sent).total_seconds() / 60
            if kitchen_mins < 0 or kitchen_mins > 120:
                kitchen_mins = None

        order_times.append({
            "id": oid,
            "mesa": mesa,
            "mesero": mesero,
            "total_mins": round(total_mins, 1),
            "kitchen_mins": round(kitchen_mins, 1) if kitchen_mins else None,
        })

        mesero_times[mesero].append(total_mins)

        # Track by platillo
        items = order.get("items", "[]")
        if isinstance(items, str):
            try: items = json.loads(items)
            except: items = []
        for item in items:
            name = item.get("nombre", item.get("name", ""))
            if name and kitchen_mins:
                platillo_times[name].append(kitchen_mins)

    # -- Insights --
    stats = {}

    if order_times:
        avg_total = sum(o["total_mins"] for o in order_times) / len(order_times)
        kitchen_orders = [o for o in order_times if o["kitchen_mins"] is not None]
        avg_kitchen = sum(o["kitchen_mins"] for o in kitchen_orders) / len(kitchen_orders) if kitchen_orders else 0

        stats["ordenes"] = len(order_times)
        stats["tiempo_promedio_total"] = round(avg_total, 1)
        stats["tiempo_promedio_cocina"] = round(avg_kitchen, 1)

        # Slow orders (>1.5x average)
        slow = [o for o in order_times if o["total_mins"] > avg_total * 1.5]
        if slow:
            worst = max(slow, key=lambda x: x["total_mins"])
            insights.append({
                "tipo": "ordenes_lentas",
                "prioridad": "alta" if len(slow) > 3 else "media",
                "msg": f"{len(slow)} ordenes lentas hoy (>{avg_total*1.5:.0f} min). Peor: Mesa {worst['mesa']} con {worst['total_mins']} min ({worst['mesero']}).",
            })

    # Slow platillos
    if platillo_times:
        platillo_avg = {}
        for name, times in platillo_times.items():
            if len(times) >= 2:
                platillo_avg[name] = round(sum(times) / len(times), 1)

        if platillo_avg:
            slowest = sorted(platillo_avg.items(), key=lambda x: x[1], reverse=True)[:3]
            stats["platillos_lentos"] = [{"nombre": n, "promedio_min": t} for n, t in slowest]
            if slowest[0][1] > 15:
                insights.append({
                    "tipo": "platillo_lento",
                    "prioridad": "media",
                    "msg": f"Platillo mas lento: {slowest[0][0]} ({slowest[0][1]} min promedio). Top 3: {', '.join(f'{n} ({t}m)' for n, t in slowest)}.",
                })

    # Mesero comparison
    if mesero_times:
        mesero_avg = {}
        for name, times in mesero_times.items():
            if len(times) >= 2:
                mesero_avg[name] = round(sum(times) / len(times), 1)

        if mesero_avg:
            fastest = min(mesero_avg.items(), key=lambda x: x[1])
            slowest_m = max(mesero_avg.items(), key=lambda x: x[1])
            stats["mesero_rapido"] = {"nombre": fastest[0], "promedio_min": fastest[1]}
            stats["mesero_lento"] = {"nombre": slowest_m[0], "promedio_min": slowest_m[1]}

            if slowest_m[1] > fastest[1] * 1.5 and len(mesero_avg) > 1:
                insights.append({
                    "tipo": "mesero_diferencia",
                    "prioridad": "baja",
                    "msg": f"Diferencia de velocidad: {fastest[0].split()[0]} ({fastest[1]} min) vs {slowest_m[0].split()[0]} ({slowest_m[1]} min).",
                })

    return insights, stats


def format_telegram(insights, stats):
    """Format results for Telegram."""
    now_mx = datetime.now(MX_TZ)
    lines = [f"⏱ *Speed of Service* — {now_mx.strftime('%d/%m %H:%M')}"]
    lines.append("")

    if stats:
        lines.append(f"📊 *{stats.get('ordenes', 0)} ordenes* analizadas")
        lines.append(f"• Tiempo total promedio: *{stats.get('tiempo_promedio_total', 0)} min*")
        if stats.get("tiempo_promedio_cocina"):
            lines.append(f"• Tiempo cocina promedio: *{stats.get('tiempo_promedio_cocina', 0)} min*")
        if stats.get("mesero_rapido"):
            lines.append(f"• Mas rapido: {stats['mesero_rapido']['nombre'].split()[0]} ({stats['mesero_rapido']['promedio_min']}m)")
        if stats.get("mesero_lento"):
            lines.append(f"• Mas lento: {stats['mesero_lento']['nombre'].split()[0]} ({stats['mesero_lento']['promedio_min']}m)")
        if stats.get("platillos_lentos"):
            lines.append("")
            lines.append("🐢 *Platillos mas lentos:*")
            for p in stats["platillos_lentos"]:
                lines.append(f"  • {p['nombre']}: {p['promedio_min']} min")

    if insights:
        lines.append("")
        for i in insights:
            icon = "🔴" if i["prioridad"] == "alta" else "🟡" if i["prioridad"] == "media" else "🟢"
            lines.append(f"{icon} {i['msg']}")
    elif stats and stats.get("ordenes", 0) > 0:
        lines.append("")
        lines.append("✅ Velocidad de servicio dentro de parametros normales.")

    if not stats or stats.get("ordenes", 0) == 0:
        lines.append("Sin ordenes cerradas todavia — esperando datos del POS.")

    return "\n".join(lines)


def send_telegram(text):
    for chat_id in TG_CHAT_IDS:
        try:
            requests.post(
                f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"},
                timeout=10,
            )
        except:
            pass


def log_run(status, duration_ms, insights_count, tokens=0):
    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_runs",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
            json={
                "agent_id": "speed_of_service",
                "client_id": CLIENT["id"],
                "status": status,
                "duration_ms": duration_ms,
                "tokens_used": tokens,
                "trigger_type": TRIGGER_TYPE,
                "tentacle": "ops",
                "output_summary": f"{insights_count} insights",
            },
            timeout=10,
        )
    except:
        pass


if __name__ == "__main__":
    start = time.time()
    try:
        orders = get_today_orders()
        audit_log = get_audit_log_today()
        insights, stats = analyze_speed(orders, audit_log)

        msg = format_telegram(insights, stats)

        # Only send if there are insights or meaningful data
        if insights or (stats and stats.get("ordenes", 0) > 0):
            send_telegram(msg)

        duration = int((time.time() - start) * 1000)
        log_run("success", duration, len(insights))
        print(f"OK — {len(insights)} insights, {stats.get('ordenes', 0)} ordenes")
    except Exception as e:
        duration = int((time.time() - start) * 1000)
        log_run("error", duration, 0)
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
