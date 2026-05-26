#!/usr/bin/env python3
"""
Staffing Optimizer Agent — Multi-tenant
Analiza las últimas 4 semanas para detectar sobre/sub-staffing y sugerir horarios óptimos.
Corre los lunes a las 8am MX.
"""

import os
import sys
import json
import time
import requests
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from client_config import get_client, get_tz, get_chat_ids, is_mesero

# ── Config ──────────────────────────────────────────────────────────────────
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

DAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]

# Revenue per mesero targets (MXN)
# If a mesero sells less than MIN, they may be unnecessary; more than MAX = overloaded
REVENUE_PER_MESERO_MIN = 2000   # Below this → overstaffed
REVENUE_PER_MESERO_MAX = 6000   # Above this → understaffed


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
def get_last_n_days(days=28):
    """Fetch last N days of daily data."""
    cutoff = (datetime.now(MX_TZ) - timedelta(days=days)).strftime("%Y-%m-%d")
    return sb_get("wansoft_daily", {"client_slug": f"eq.{CLIENT['id']}",
        "select": "fecha,ventas_dia,tickets_count,personas_restaurant,ticket_promedio_restaurant,meseros,mesas_atendidas",
        "fecha": f"gte.{cutoff}",
        "ventas_dia": "gt.0",
        "order": "fecha.desc",
        "limit": str(days),
    })


# ── Analysis ────────────────────────────────────────────────────────────────
def analyze_staffing(data):
    """Analyze staffing patterns by DOW."""
    # Group by DOW
    by_dow = defaultdict(list)
    for day in data:
        dt = datetime.strptime(day["fecha"], "%Y-%m-%d")
        dow = dt.weekday()
        meseros_list = day.get("meseros") or []
        if isinstance(meseros_list, str):
            meseros_list = json.loads(meseros_list)

        # Count real meseros (exclude cajeros, market)
        active_meseros = [m for m in meseros_list if is_mesero(m.get("nombre", ""), CLIENT) and float(m.get("total") or 0) > 0]
        num_meseros = len(active_meseros)
        ventas = float(day.get("ventas_dia") or 0)
        personas = int(day.get("personas_restaurant") or 0)

        by_dow[dow].append({
            "fecha": day["fecha"],
            "ventas": ventas,
            "personas": personas,
            "num_meseros": num_meseros,
            "meseros": active_meseros,
            "revenue_per_mesero": ventas / num_meseros if num_meseros > 0 else 0,
        })

    return by_dow


def detect_staffing_issues(by_dow):
    """Detect over/understaffed days."""
    issues = []

    for dow in range(7):
        days = by_dow.get(dow, [])
        if not days:
            continue

        avg_ventas = sum(d["ventas"] for d in days) / len(days)
        avg_meseros = sum(d["num_meseros"] for d in days) / len(days)
        avg_rpm = sum(d["revenue_per_mesero"] for d in days) / len(days) if avg_meseros > 0 else 0
        avg_personas = sum(d["personas"] for d in days) / len(days)

        day_name = DAY_NAMES[dow]

        if avg_rpm < REVENUE_PER_MESERO_MIN and avg_meseros >= 2:
            optimal = max(1, round(avg_ventas / ((REVENUE_PER_MESERO_MIN + REVENUE_PER_MESERO_MAX) / 2)))
            excess = round(avg_meseros - optimal)
            if excess >= 1:
                issues.append({
                    "type": "overstaffed",
                    "dow": dow,
                    "day_name": day_name,
                    "avg_meseros": round(avg_meseros, 1),
                    "avg_ventas": round(avg_ventas),
                    "avg_rpm": round(avg_rpm),
                    "optimal": optimal,
                    "message": f"📉 {day_name.capitalize()}: {avg_meseros:.0f} meseros con ${avg_ventas:,.0f} en ventas (${avg_rpm:,.0f}/mesero). Sugerido: {optimal}.",
                })

        elif avg_rpm > REVENUE_PER_MESERO_MAX:
            optimal = round(avg_ventas / ((REVENUE_PER_MESERO_MIN + REVENUE_PER_MESERO_MAX) / 2))
            if optimal > avg_meseros:
                issues.append({
                    "type": "understaffed",
                    "dow": dow,
                    "day_name": day_name,
                    "avg_meseros": round(avg_meseros, 1),
                    "avg_ventas": round(avg_ventas),
                    "avg_rpm": round(avg_rpm),
                    "optimal": optimal,
                    "message": f"📈 {day_name.capitalize()}: {avg_meseros:.0f} meseros con ${avg_ventas:,.0f} (${avg_rpm:,.0f}/mesero). Necesitas {optimal}.",
                })

    return issues


def detect_mesero_patterns(data):
    """Detect which meseros work which days — find gaps."""
    mesero_days = defaultdict(set)  # mesero_name -> set of DOWs they've worked
    mesero_totals = defaultdict(list)  # mesero_name -> list of daily totals

    for day in data:
        dt = datetime.strptime(day["fecha"], "%Y-%m-%d")
        dow = dt.weekday()
        meseros_list = day.get("meseros") or []
        if isinstance(meseros_list, str):
            meseros_list = json.loads(meseros_list)

        for m in meseros_list:
            name = m.get("nombre", "")
            total = float(m.get("total") or 0)
            if name and total > 0 and is_mesero(name, CLIENT):
                short = name.split()[0]
                mesero_days[short].add(dow)
                mesero_totals[short].append(total)

    insights = []
    for name, days_set in mesero_days.items():
        if len(mesero_totals[name]) < 3:
            continue
        missing_days = set(range(7)) - days_set
        if missing_days and len(missing_days) <= 4:  # Has some days off but not too many
            missing_names = [DAY_NAMES[d] for d in sorted(missing_days)]
            avg_total = sum(mesero_totals[name]) / len(mesero_totals[name])
            insights.append({
                "name": name,
                "works_days": len(days_set),
                "missing": missing_names,
                "avg_daily": round(avg_total),
            })

    return insights


def build_schedule_summary(by_dow):
    """Build a summary table of DOW performance."""
    summary = []
    for dow in range(7):
        days = by_dow.get(dow, [])
        if not days:
            summary.append(None)
            continue
        summary.append({
            "day_name": DAY_NAMES[dow],
            "avg_ventas": round(sum(d["ventas"] for d in days) / len(days)),
            "avg_meseros": round(sum(d["num_meseros"] for d in days) / len(days), 1),
            "avg_personas": round(sum(d["personas"] for d in days) / len(days)),
            "avg_rpm": round(sum(d["revenue_per_mesero"] for d in days) / len(days)) if days else 0,
            "sample": len(days),
        })
    return summary


# ── Build Message ───────────────────────────────────────────────────────────
def build_message(schedule, issues, mesero_patterns):
    now_mx = datetime.now(MX_TZ)

    msg = f"📋 STAFFING SEMANAL — Semana del {now_mx.strftime('%d/%m/%Y')}\n"
    msg += "Análisis últimas 4 semanas\n\n"

    # Schedule overview
    msg += "📊 RESUMEN POR DÍA:\n"
    for s in schedule:
        if not s:
            continue
        msg += f"  {s['day_name'][:3].capitalize()}: ${s['avg_ventas']:,} · {s['avg_meseros']:.0f} meseros · ${s['avg_rpm']:,}/mesero · {s['avg_personas']} pers.\n"

    # Issues
    if issues:
        msg += "\n⚠️ AJUSTES SUGERIDOS:\n"
        for issue in issues:
            msg += f"  {issue['message']}\n"
    else:
        msg += "\n✅ Staffing se ve balanceado esta semana.\n"

    # Mesero patterns
    if mesero_patterns:
        msg += "\n👥 COBERTURA DE MESEROS:\n"
        for mp in sorted(mesero_patterns, key=lambda x: x["avg_daily"], reverse=True):
            missing_str = ", ".join(mp["missing"][:3])
            if mp["missing"]:
                msg += f"  {mp['name']}: nunca trabaja {missing_str} (prom. ${mp['avg_daily']:,}/día)\n"

    # Recommendations
    overstaffed = [i for i in issues if i["type"] == "overstaffed"]
    understaffed = [i for i in issues if i["type"] == "understaffed"]

    if overstaffed or understaffed:
        msg += "\n💡 RECOMENDACIONES:\n"
        if overstaffed:
            days_str = ", ".join(i["day_name"] for i in overstaffed)
            msg += f"  • Reducir meseros en: {days_str}\n"
        if understaffed:
            days_str = ", ".join(i["day_name"] for i in understaffed)
            msg += f"  • Agregar meseros en: {days_str}\n"
        if overstaffed and understaffed:
            msg += "  • Mover personal de días flojos a días fuertes\n"

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
    now_mx = datetime.now(MX_TZ)

    print(f"[staffing] Starting for {CLIENT['id']}")

    # 1. Fetch data
    print("[staffing] Fetching last 28 days...")
    data = get_last_n_days(28)
    print(f"[staffing] Got {len(data)} days")

    if len(data) < 7:
        print("[staffing] Not enough data, skipping")
        return

    # 2. Analyze
    by_dow = analyze_staffing(data)
    schedule = build_schedule_summary(by_dow)
    issues = detect_staffing_issues(by_dow)
    mesero_patterns = detect_mesero_patterns(data)

    # 3. Build structured data
    structured_data = {
        "schedule": [s for s in schedule if s],
        "issues": issues,
        "mesero_patterns": mesero_patterns,
        "analysis_days": len(data),
    }

    has_issues = len(issues) > 0
    priority = "warning" if has_issues else "info"
    summary = f"{len(issues)} ajustes sugeridos, {len(mesero_patterns)} patrones de meseros"

    # 4. Save to DB
    today_str = now_mx.strftime("%Y-%m-%d")
    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_results",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"},
            json={
                "client_id": CLIENT["id"],
                "agent_id": "staffing",
                "fecha": today_str,
                "data": json.dumps(structured_data),
                "summary": summary,
                "priority": priority,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        print(f"[staffing] Saved to agent_results")
    except Exception as e:
        print(f"[staffing] Error saving to DB: {e}")

    elapsed = int((time.time() - start) * 1000)
    print(f"[staffing] Done in {elapsed}ms — {summary}")

    # 5. Log
    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_runs",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
            json={
                "agent_id": "staffing-optimizer",
                "trigger_type": TRIGGER_TYPE,
                "status": "success",
                "duration_ms": elapsed,
                "output_summary": f"issues: {len(issues)}, mesero_patterns: {len(mesero_patterns)}",
                "tentacle": "ops",
            },
        )
    except:
        pass


if __name__ == "__main__":
    main()
