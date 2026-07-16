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
from ops_aggregate import get_current_business_date, get_business_day_config, get_business_day_bounds

# -- Config --
CLIENT = get_client()
MX_TZ = get_tz(CLIENT)
BIZ_TZ, BIZ_BOUNDARY = get_business_day_config(CLIENT)
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
# Least privilege: agent key (SELECT + INSERT agent_runs/results)
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TG_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
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
    """Fetch closed orders for the current business day using canonical UTC bounds."""
    biz_date = get_current_business_date(CLIENT)
    _, _, utc_start, utc_end = get_business_day_bounds(biz_date, BIZ_TZ, BIZ_BOUNDARY)
    return sb_get("pos_orders", {
        "select": "id,mesa,mesero,items,created_at,closed_at,status,total",
        "client_id": f"eq.{CLIENT['id']}",
        "status": "eq.cerrada",
        "created_at": f"gte.{utc_start.isoformat()}",
        "and": f"(created_at.lt.{utc_end.isoformat()})",
        "order": "created_at.desc",
        "limit": "500",
    })


AUDIT_CHUNK_SIZE = 50
AUDIT_PAGE_SIZE = 200


def fetch_audit_for_orders(order_ids):
    """Fetch ALL status_changed events for eligible orders.

    Batches IDs in chunks of 50. Pages each chunk with limit+offset
    until natural exhaustion. Returns (events, fetch_complete).
    """
    if not order_ids:
        return [], True

    all_events = []
    fetch_complete = True

    for i in range(0, len(order_ids), AUDIT_CHUNK_SIZE):
        chunk = order_ids[i:i + AUDIT_CHUNK_SIZE]
        ids_param = ",".join(chunk)
        offset = 0

        while True:
            try:
                page = sb_get("pos_audit_log", {
                    "select": "id,order_id,action,details,created_at",
                    "action": "eq.status_changed",
                    "order_id": f"in.({ids_param})",
                    "order": "id.asc",
                    "limit": str(AUDIT_PAGE_SIZE),
                    "offset": str(offset),
                })
            except Exception:
                fetch_complete = False
                break

            all_events.extend(page)

            if len(page) < AUDIT_PAGE_SIZE:
                break  # natural exhaustion
            offset += AUDIT_PAGE_SIZE

    # Deduplicate by audit id
    seen = set()
    deduped = []
    for e in all_events:
        eid = e.get("id")
        if eid not in seen:
            seen.add(eid)
            deduped.append(e)

    return deduped, fetch_complete


def classify_kitchen_eligible(orders):
    """Classify orders into kitchen-eligible and non-kitchen.

    Kitchen-eligible = has at least one item with station='cocina'.
    Uses the item-level station field set by POS routing.
    """
    kitchen_ids = set()
    for o in orders:
        items = o.get("items", "[]")
        if isinstance(items, str):
            try:
                items = json.loads(items)
            except Exception:
                items = []
        for item in items:
            if isinstance(item, dict) and item.get("station") == "cocina":
                kitchen_ids.add(o["id"])
                break
    return kitchen_ids


def extract_kitchen_cycle(timeline):
    """Extract a valid kitchen cycle from sorted audit events.

    Returns (kitchen_mins, cycle_status) where cycle_status is one of:
      'complete' — valid ordered start→ready pair
      'missing_start' — has ready but no start
      'missing_ready' — has start but no ready
      'no_events' — no kitchen-relevant events
      'ambiguous' — repeated restart after completed cycle
    """
    # Sort deterministically by audit id
    sorted_events = sorted(timeline, key=lambda e: e.get("id", 0))

    t_start = None
    t_ready = None
    cycle_complete = False

    for ev in sorted_events:
        if ev["from"] == "enviada" and ev["to"] == "preparando":
            if cycle_complete:
                # Restart after a completed cycle — ambiguous
                return None, "ambiguous"
            try:
                t_start = datetime.fromisoformat(ev["at"].replace("Z", "+00:00"))
            except Exception:
                pass
        elif ev["to"] == "lista" and t_start is not None:
            try:
                candidate = datetime.fromisoformat(ev["at"].replace("Z", "+00:00"))
                if candidate > t_start:
                    t_ready = candidate
                    cycle_complete = True
            except Exception:
                pass

    if t_start and t_ready:
        mins = (t_ready - t_start).total_seconds() / 60
        if 0 < mins < 120:
            return round(mins, 1), "complete"
        return None, "complete"  # valid pair but out of range
    elif t_start:
        return None, "missing_ready"
    elif any(ev["to"] == "lista" for ev in sorted_events):
        return None, "missing_start"
    else:
        return None, "no_events"


# INITIAL PRODUCT POLICY — kitchen section display threshold.
# Not statistically established. Chosen to require meaningful sample.
KITCHEN_MIN_ORDERS = 3
KITCHEN_MIN_COVERAGE = 0.30  # 30% of kitchen-eligible orders


def analyze_speed(orders, audit_log, kitchen_order_ids, audit_fetch_complete):
    """Analyze speed of service from order lifecycle.

    Args:
        orders: eligible closed pos_orders for the business day
        audit_log: status_changed events fetched by order_id correlation
        kitchen_order_ids: set of order IDs with at least one cocina item
        audit_fetch_complete: bool — all audit pages retrieved successfully
    """
    insights = []

    if not orders:
        return insights, {}

    # Build timeline per order from audit log
    order_timeline = defaultdict(list)
    for entry in audit_log:
        oid = entry.get("order_id", "")
        details = entry.get("details", {})
        if isinstance(details, str):
            try:
                details = json.loads(details)
            except Exception:
                details = {}
        order_timeline[oid].append({
            "id": entry.get("id", 0),
            "from": details.get("from", ""),
            "to": details.get("to", ""),
            "at": entry.get("created_at", ""),
        })

    # Quality counters
    quality = {
        "eligible_orders_total": len(orders),
        "kitchen_eligible_orders": len(kitchen_order_ids),
        "non_kitchen_orders": len(orders) - len(kitchen_order_ids),
        "kitchen_orders_with_audit": 0,
        "kitchen_orders_with_no_audit": 0,
        "kitchen_orders_complete_cycle": 0,
        "kitchen_orders_missing_start": 0,
        "kitchen_orders_missing_ready": 0,
        "kitchen_orders_lifecycle_ambiguous": 0,
        "audit_fetch_complete": audit_fetch_complete,
    }

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
        except Exception:
            continue

        if total_mins <= 0 or total_mins > 240:
            continue

        # Kitchen cycle (only for kitchen-eligible orders)
        kitchen_mins = None
        if oid in kitchen_order_ids:
            timeline = order_timeline.get(oid, [])
            if timeline:
                quality["kitchen_orders_with_audit"] += 1
                km, status = extract_kitchen_cycle(timeline)
                kitchen_mins = km
                if status == "complete":
                    quality["kitchen_orders_complete_cycle"] += 1
                elif status == "missing_start":
                    quality["kitchen_orders_missing_start"] += 1
                elif status == "missing_ready":
                    quality["kitchen_orders_missing_ready"] += 1
                elif status == "ambiguous":
                    quality["kitchen_orders_lifecycle_ambiguous"] += 1
            else:
                quality["kitchen_orders_with_no_audit"] += 1

        order_times.append({
            "id": oid,
            "mesa": mesa,
            "mesero": mesero,
            "total_mins": round(total_mins, 1),
            "kitchen_mins": kitchen_mins,
        })

        mesero_times[mesero].append(total_mins)

        # Track platillo kitchen times (only from complete cycles)
        if kitchen_mins is not None:
            items = order.get("items", "[]")
            if isinstance(items, str):
                try:
                    items = json.loads(items)
                except Exception:
                    items = []
            for item in items:
                if isinstance(item, dict) and item.get("station") == "cocina":
                    name = item.get("nombre", item.get("name", ""))
                    if name:
                        platillo_times[name].append(kitchen_mins)

    # -- Stats --
    stats = {"quality": quality}

    if order_times:
        avg_total = sum(o["total_mins"] for o in order_times) / len(order_times)
        stats["ordenes"] = len(order_times)
        stats["tiempo_promedio_total"] = round(avg_total, 1)

        # Kitchen metrics — only if policy threshold met
        complete = quality["kitchen_orders_complete_cycle"]
        k_eligible = quality["kitchen_eligible_orders"]
        coverage_pct = complete / k_eligible if k_eligible > 0 else 0
        stats["kitchen_data_coverage"] = f"{complete}/{k_eligible}"

        if (complete >= KITCHEN_MIN_ORDERS
                and coverage_pct >= KITCHEN_MIN_COVERAGE
                and audit_fetch_complete):
            kitchen_orders = [o for o in order_times if o["kitchen_mins"] is not None]
            avg_kitchen = sum(o["kitchen_mins"] for o in kitchen_orders) / len(kitchen_orders)
            stats["tiempo_promedio_cocina"] = round(avg_kitchen, 1)
        else:
            stats["kitchen_degraded"] = True

        # Slow orders (>1.5x average total time)
        slow = [o for o in order_times if o["total_mins"] > avg_total * 1.5]
        if slow:
            worst = max(slow, key=lambda x: x["total_mins"])
            insights.append({
                "tipo": "ordenes_lentas",
                "prioridad": "alta" if len(slow) > 3 else "media",
                "msg": f"{len(slow)} ordenes lentas hoy (>{avg_total*1.5:.0f} min). Peor: Mesa {worst['mesa']} con {worst['total_mins']} min ({worst['mesero']}).",
            })

    # Slow platillos (only from complete kitchen cycles)
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

    # Mesero comparison (total time, not kitchen time)
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

    # Kitchen data coverage disclosure
    quality = stats.get("quality", {})
    coverage = stats.get("kitchen_data_coverage", "0/0")
    if stats.get("kitchen_degraded"):
        lines.append(f"\n_Kitchen timing: insufficient KDS lifecycle data ({coverage} orders)_")

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
        order_ids = [o["id"] for o in orders]
        kitchen_ids = classify_kitchen_eligible(orders)
        # Fetch audit events correlated to kitchen-eligible order IDs only
        kitchen_order_id_list = [oid for oid in order_ids if oid in kitchen_ids]
        audit_log, audit_complete = fetch_audit_for_orders(kitchen_order_id_list)
        insights, stats = analyze_speed(orders, audit_log, kitchen_ids, audit_complete)

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
