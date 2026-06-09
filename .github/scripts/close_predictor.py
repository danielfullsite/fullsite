#!/usr/bin/env python3
"""
Close Predictor Agent — Multi-tenant
Proyecta ventas al cierre basándose en datos intraday + patrón histórico por DOW.
Corre a las 2pm y 4pm MX.
"""

import os
import sys
import json
import time
import requests
from datetime import datetime, timedelta, timezone
from client_config import get_client, get_tz, get_chat_ids
try:
    from audit_log import AuditLogger
    _audit = AuditLogger("close_predictor")
except ImportError:
    _audit = None
# ── Config ──────────────────────────────────────────────────────────────────
CLIENT = get_client()
MX_TZ = get_tz(CLIENT)
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
# Least privilege: agent key (SELECT + INSERT agent_runs/results)
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TG_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_IDS = get_chat_ids(CLIENT, "intraday")
TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "cron")

sb_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}

# Typical hourly distribution for a brunch/café (% of daily total by hour)
# Based on restaurant industry patterns — adjusted for AMALAY brunch café
HOURLY_DISTRIBUTION = {
    8:  0.02,   # 8am - opening
    9:  0.06,   # 9am
    10: 0.12,   # 10am - brunch picks up
    11: 0.15,   # 11am - peak brunch
    12: 0.16,   # 12pm - peak
    13: 0.14,   # 1pm - still strong
    14: 0.10,   # 2pm - slowing
    15: 0.07,   # 3pm
    16: 0.06,   # 4pm
    17: 0.05,   # 5pm
    18: 0.04,   # 6pm
    19: 0.02,   # 7pm
    20: 0.01,   # 8pm - closing
}


# ── Supabase helpers ────────────────────────────────────────────────────────
def sb_get(table, params):
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=sb_headers,
        params=params,
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


# ── Data fetching ───────────────────────────────────────────────────────────
def get_today_kpis():
    """Fetch today's data from wansoft_daily (preferred) or wansoft_kpis fallback."""
    now_mx = datetime.now(MX_TZ)
    today_str = now_mx.strftime("%Y-%m-%d")
    rows = sb_get("wansoft_daily", {
        "select": "fecha,ventas_dia,ventas_brutas,descuentos,tickets_count,personas_restaurant,ticket_promedio_restaurant,ventas_por_grupo,meseros,platillos_top",
        "fecha": f"eq.{today_str}",
        "limit": "1",
    })
    if rows:
        return rows[0]
    # Fallback to wansoft_kpis if today's daily not yet synced
    rows = sb_get("wansoft_kpis", {"select": "*", "limit": "1"})
    return rows[0] if rows else None


def get_comparison_days(today):
    """Fetch yesterday and same DOW last week."""
    yesterday = (today - timedelta(days=1)).strftime("%Y-%m-%d")
    last_week = (today - timedelta(weeks=1)).strftime("%Y-%m-%d")

    results = {}
    for label, fecha in [("ayer", yesterday), ("semana_pasada", last_week)]:
        rows = sb_get("wansoft_daily", {"client_slug": f"eq.{CLIENT['id']}",
            "select": "fecha,ventas_dia,ticket_promedio_restaurant,tickets_count,personas_restaurant,ventas_por_grupo",
            "fecha": f"eq.{fecha}",
            "limit": "1",
        })
        if rows:
            results[label] = rows[0]

    return results


def get_historical_same_dow(today, weeks=4):
    """Fetch same DOW over the last N weeks for average."""
    results = []
    for w in range(1, weeks + 1):
        d = today - timedelta(weeks=w)
        rows = sb_get("wansoft_daily", {"client_slug": f"eq.{CLIENT['id']}",
            "select": "fecha,ventas_dia,ticket_promedio_restaurant,ventas_por_grupo",
            "fecha": f"eq.{d.strftime('%Y-%m-%d')}",
            "limit": "1",
        })
        results.extend(rows)
    return results


# ── Projection ──────────────────────────────────────────────────────────────
def project_close(current_ventas, current_hour):
    """Project total close based on current ventas and hourly distribution."""
    if current_hour < 8 or current_ventas <= 0:
        return 0

    # Calculate what % of the day has been captured so far
    pct_captured = sum(
        pct for hour, pct in HOURLY_DISTRIBUTION.items()
        if hour < current_hour
    )

    # Add partial current hour (assume halfway through)
    current_hour_pct = HOURLY_DISTRIBUTION.get(current_hour, 0.03)
    pct_captured += current_hour_pct * 0.5

    if pct_captured <= 0.05:  # Too early to project
        return 0

    projected = current_ventas / pct_captured
    return round(projected)


def estimate_category_boost(today_groups, historical, category_keywords, label):
    """Estimate how much more $ could come from pushing a category."""
    today_cat = 0
    if today_groups:
        if isinstance(today_groups, str):
            today_groups = json.loads(today_groups)
        today_cat = sum(
            float(g.get("total") or 0)
            for g in today_groups
            if any(kw in g.get("nombre", "").upper() for kw in category_keywords)
        )

    # Historical average for this category
    hist_totals = []
    for day in historical:
        g_list = day.get("ventas_por_grupo") or []
        if isinstance(g_list, str):
            g_list = json.loads(g_list)
        day_total = sum(
            float(g.get("total") or 0)
            for g in g_list
            if any(kw in g.get("nombre", "").upper() for kw in category_keywords)
        )
        if day_total > 0:
            hist_totals.append(day_total)

    if not hist_totals:
        return None

    avg_cat = sum(hist_totals) / len(hist_totals)
    gap = avg_cat - today_cat
    return {
        "label": label,
        "today": today_cat,
        "avg": avg_cat,
        "gap": gap,
    }


# ── Build Message ───────────────────────────────────────────────────────────
def build_message(today_data, projected, comparisons, historical, current_hour):
    now_mx = datetime.now(MX_TZ)
    day_names = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
    today_name = day_names[now_mx.weekday()]

    current_ventas = float(today_data.get("ventas_dia") or 0)
    current_tickets = int(today_data.get("tickets_count") or 0)
    current_tp = float(today_data.get("ticket_promedio_restaurant") or 0)

    msg = f"🔮 PROYECCIÓN DE CIERRE — {today_name} {now_mx.strftime('%d/%m %H:%M')}\n\n"

    # Current status
    msg += f"📊 AHORA:\n"
    msg += f"  Ventas: ${current_ventas:,.0f}\n"
    msg += f"  Tickets: {current_tickets} · TP: ${current_tp:,.0f}\n\n"

    # Projection
    msg += f"🎯 PROYECCIÓN AL CIERRE: ${projected:,.0f}\n"

    # Calculate remaining
    remaining = projected - current_ventas
    if remaining > 0:
        pct_done = (current_ventas / projected * 100) if projected > 0 else 0
        msg += f"  Avance: {pct_done:.0f}% — faltan ${remaining:,.0f}\n"

    # Comparison vs yesterday
    if "ayer" in comparisons:
        ayer_ventas = float(comparisons["ayer"].get("ventas_dia") or 0)
        if ayer_ventas > 0:
            vs_ayer = projected - ayer_ventas
            emoji = "✅" if vs_ayer >= 0 else "⚠️"
            msg += f"\n  {emoji} vs ayer (${ayer_ventas:,.0f}): {'+' if vs_ayer >= 0 else ''}{vs_ayer:,.0f}\n"

    # Comparison vs last week same DOW
    if "semana_pasada" in comparisons:
        lw_ventas = float(comparisons["semana_pasada"].get("ventas_dia") or 0)
        if lw_ventas > 0:
            vs_lw = projected - lw_ventas
            emoji = "✅" if vs_lw >= 0 else "⚠️"
            msg += f"  {emoji} vs {today_name} pasado (${lw_ventas:,.0f}): {'+' if vs_lw >= 0 else ''}{vs_lw:,.0f}\n"

    # DOW average
    if historical:
        avg_dow = sum(float(d.get("ventas_dia") or 0) for d in historical) / len(historical)
        vs_avg = projected - avg_dow
        emoji = "✅" if vs_avg >= 0 else "⚠️"
        msg += f"  {emoji} vs promedio {today_name}: {'+' if vs_avg >= 0 else ''}{vs_avg:,.0f}\n"

    # Category boost suggestions
    today_groups = today_data.get("ventas_por_grupo") or []
    boosts = []
    _cats = CLIENT.get("menu_categories") or {}
    for label, keywords in [
        ("Postres", _cats.get("postres", ["DESSERT", "BROWNIE", "CHEESECAKE", "CAKE", "PANCAKE"])),
        ("Especialidad", _cats.get("hh", ["HALF", "H&H"])),
        ("Pan", _cats.get("pan", ["TOAST", "BAGEL", "CROISSANT"])),
    ]:
        boost = estimate_category_boost(today_groups, historical, keywords, label)
        if boost and boost["gap"] > 100:
            boosts.append(boost)

    if boosts or remaining > 0:
        msg += f"\n💡 PARA LLEGAR A LA META:\n"
        msg += f"  Necesitas ${remaining:,.0f} más.\n"
        for b in boosts:
            if b["gap"] > 0:
                msg += f"  • Promueve {b['label']}: llevas ${b['today']:,.0f} vs promedio ${b['avg']:,.0f} (+${b['gap']:,.0f} posibles)\n"

    return msg


# ── Telegram ────────────────────────────────────────────────────────────────
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


# ── Main ────────────────────────────────────────────────────────────────────
def main():
    start = time.time()
    if _audit: _audit.log_start()
    now_mx = datetime.now(MX_TZ)
    today_str = now_mx.strftime("%Y-%m-%d")
    current_hour = now_mx.hour

    print(f"[close_predictor] Starting for {CLIENT['id']} on {today_str} at {current_hour}h")

    # 1. Fetch today's real-time data
    today_data = get_today_kpis()
    if not today_data:
        print("[close_predictor] No KPI data available, skipping")
        return

    current_ventas = float(today_data.get("ventas_dia") or 0)
    if current_ventas <= 0:
        print("[close_predictor] Ventas = 0, skipping")
        return

    # 2. Project close
    projected = project_close(current_ventas, current_hour)
    if projected <= 0:
        print("[close_predictor] Too early to project, skipping")
        return

    # 3. Fetch comparison data
    print("[close_predictor] Fetching comparisons...")
    comparisons = get_comparison_days(now_mx)
    historical = get_historical_same_dow(now_mx, weeks=4)

    # 4. Build structured data
    today_groups = today_data.get("ventas_por_grupo") or []
    boosts = []
    _cats = CLIENT.get("menu_categories") or {}
    for label, keywords in [
        ("Postres", _cats.get("postres", ["DESSERT", "BROWNIE", "CHEESECAKE", "CAKE", "PANCAKE"])),
        ("Especialidad", _cats.get("hh", ["HALF", "H&H"])),
        ("Pan", _cats.get("pan", ["TOAST", "BAGEL", "CROISSANT"])),
    ]:
        boost = estimate_category_boost(today_groups, historical, keywords, label)
        if boost and boost["gap"] > 100:
            boosts.append(boost)

    remaining = projected - current_ventas
    pct_done = (current_ventas / projected * 100) if projected > 0 else 0
    avg_dow = sum(float(d.get("ventas_dia") or 0) for d in historical) / len(historical) if historical else 0

    structured_data = {
        "current_ventas": current_ventas,
        "current_tickets": int(today_data.get("tickets_count") or 0),
        "current_tp": float(today_data.get("ticket_promedio_restaurant") or 0),
        "projected": projected,
        "remaining": remaining,
        "pct_done": round(pct_done, 1),
        "current_hour": current_hour,
        "comparisons": {
            k: {"ventas_dia": float(v.get("ventas_dia") or 0)}
            for k, v in comparisons.items()
        },
        "avg_dow": round(avg_dow),
        "boosts": boosts,
    }

    priority = "warning" if projected < avg_dow * 0.85 else "info"
    summary = f"Proyección: ${projected:,.0f} (avance {pct_done:.0f}%)"

    # 5. Save to DB
    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_results",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"},
            json={
                "client_id": CLIENT["id"],
                "agent_id": "predictor",
                "fecha": today_str,
                "data": json.dumps(structured_data),
                "summary": summary,
                "priority": priority,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        print(f"[close_predictor] Saved to agent_results")
    except Exception as e:
        print(f"[close_predictor] Error saving to DB: {e}")

    elapsed = int((time.time() - start) * 1000)
    print(f"[close_predictor] Done in {elapsed}ms — {summary}")

    # 6. Log
    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_runs",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
            json={
                "agent_id": "close-predictor",
                "trigger_type": TRIGGER_TYPE,
                "status": "success",
                "duration_ms": elapsed,
                "output_summary": f"current: ${current_ventas:,.0f}, projected: ${projected:,.0f}",
                "tentacle": "reportes",
            },
        )
    except:
        pass


if __name__ == "__main__":
    main()
