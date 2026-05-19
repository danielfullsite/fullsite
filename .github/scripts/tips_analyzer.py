#!/usr/bin/env python3
"""
Tips Analyzer — Multi-tenant
Analisis semanal profundo de propinas.
Corre viernes a las 5pm MX.

"Mesas con postres dejan 18% mas propina."
"Julio recibe $45/ticket en propina vs $22 promedio."
"""

import os
import sys
import json
import time
import requests
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from client_config import get_client, get_tz, get_chat_ids, is_mesero

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
def get_weekly_daily(days=7):
    """Fetch last 7 days from wansoft_daily."""
    now_mx = datetime.now(MX_TZ)
    start_date = (now_mx - timedelta(days=days)).strftime("%Y-%m-%d")
    return sb_get("wansoft_daily", {
        "select": "fecha,ventas_dia,tickets_count,propinas_total,meseros,ventas_por_grupo,personas_restaurant,ticket_promedio_restaurant",
        "fecha": f"gte.{start_date}",
        "ventas_dia": "gt.0",
        "order": "fecha.desc",
        "limit": str(days),
    })


def get_tips_data(days=7):
    """Fetch from wansoft_tips table."""
    now_mx = datetime.now(MX_TZ)
    start_date = (now_mx - timedelta(days=days)).strftime("%Y-%m-%d")
    return sb_get("wansoft_tips", {
        "select": "fecha,data",
        "fecha": f"gte.{start_date}",
        "order": "fecha.desc",
        "limit": str(days),
    })


def get_waiter_categories(days=7):
    """Fetch waiter category data for correlation."""
    now_mx = datetime.now(MX_TZ)
    start_date = (now_mx - timedelta(days=days)).strftime("%Y-%m-%d")
    return sb_get("wansoft_waiter_categories", {
        "select": "fecha,data",
        "fecha": f"gte.{start_date}",
        "order": "fecha.desc",
        "limit": str(days),
    })


def get_historical_daily(days=30):
    """Longer history for baseline."""
    return sb_get("wansoft_daily", {
        "select": "fecha,propinas_total,ventas_dia,tickets_count",
        "ventas_dia": "gt.0",
        "order": "fecha.desc",
        "limit": str(days),
    })


# -- Analysis --
def analyze_mesero_tips(tips_data, daily_data):
    """Rank meseros by tip performance."""
    mesero_totals = defaultdict(lambda: {
        "propinas": 0, "ventas": 0, "tickets": 0, "dias": 0,
    })

    # From wansoft_tips (most detailed)
    for day in tips_data:
        data = day.get("data")
        if isinstance(data, str):
            data = json.loads(data)
        if not data:
            continue
        for entry in data:
            nombre = entry.get("nombre") or entry.get("mesero") or ""
            if not nombre or not is_mesero(nombre, CLIENT):
                continue
            mesero_totals[nombre]["propinas"] += entry.get("propinas", 0) or 0
            mesero_totals[nombre]["ventas"] += entry.get("ventas", 0) or entry.get("total", 0) or 0
            mesero_totals[nombre]["tickets"] += entry.get("tickets", 0) or 0
            mesero_totals[nombre]["dias"] += 1

    # Fallback: use daily meseros + propinas_total if no tips table
    if not mesero_totals and daily_data:
        for day in daily_data:
            meseros = day.get("meseros") or []
            if isinstance(meseros, str):
                meseros = json.loads(meseros)
            propinas_total = day.get("propinas_total", 0) or 0
            ventas_dia = day.get("ventas_dia", 0) or 0
            tickets = day.get("tickets_count", 0) or 0

            if not meseros or ventas_dia == 0:
                continue

            # Distribute tips proportionally to sales
            total_mesero_ventas = sum(m.get("total", 0) for m in meseros if is_mesero(m.get("nombre", ""), CLIENT))
            for m in meseros:
                nombre = m.get("nombre", "")
                if not nombre or not is_mesero(nombre, CLIENT):
                    continue
                m_ventas = m.get("total", 0)
                prop_share = 0
                if total_mesero_ventas > 0:
                    prop_share = propinas_total * (m_ventas / total_mesero_ventas)
                m_tickets = round(tickets * (m_ventas / ventas_dia)) if ventas_dia > 0 else 0

                mesero_totals[nombre]["propinas"] += prop_share
                mesero_totals[nombre]["ventas"] += m_ventas
                mesero_totals[nombre]["tickets"] += m_tickets
                mesero_totals[nombre]["dias"] += 1

    # Calculate per-ticket averages
    results = []
    for nombre, stats in mesero_totals.items():
        if stats["tickets"] == 0 or stats["dias"] == 0:
            continue
        propina_per_ticket = round(stats["propinas"] / stats["tickets"], 1)
        propina_pct = round(stats["propinas"] / stats["ventas"] * 100, 1) if stats["ventas"] > 0 else 0
        results.append({
            "nombre": nombre,
            "propinas": round(stats["propinas"]),
            "ventas": round(stats["ventas"]),
            "tickets": stats["tickets"],
            "dias": stats["dias"],
            "propina_per_ticket": propina_per_ticket,
            "propina_pct": propina_pct,
        })

    results.sort(key=lambda x: x["propina_per_ticket"], reverse=True)
    return results


def analyze_tip_correlations(daily_data):
    """Correlate tips with desserts, day of week, personas."""
    insights = []

    if len(daily_data) < 5:
        return insights

    # Day of week analysis
    dow_tips = defaultdict(list)
    dow_names = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado", "Domingo"]
    for day in daily_data:
        dt = datetime.strptime(day["fecha"], "%Y-%m-%d")
        dow = dt.weekday()
        prop = day.get("propinas_total", 0) or 0
        tickets = day.get("tickets_count", 0) or 0
        if tickets > 0:
            dow_tips[dow].append(prop / tickets)

    if dow_tips:
        best_dow = max(dow_tips.keys(), key=lambda d: sum(dow_tips[d]) / len(dow_tips[d]) if dow_tips[d] else 0)
        worst_dow = min(dow_tips.keys(), key=lambda d: sum(dow_tips[d]) / len(dow_tips[d]) if dow_tips[d] else 999)
        best_avg = round(sum(dow_tips[best_dow]) / len(dow_tips[best_dow]), 1) if dow_tips[best_dow] else 0
        worst_avg = round(sum(dow_tips[worst_dow]) / len(dow_tips[worst_dow]), 1) if dow_tips[worst_dow] else 0
        if best_avg > worst_avg * 1.3:
            insights.append(
                f"Mejor dia para propinas: {dow_names[best_dow]} (${best_avg}/ticket) vs {dow_names[worst_dow]} (${worst_avg}/ticket)."
            )

    # Dessert correlation
    days_with_desserts = []
    days_without_desserts = []
    for day in daily_data:
        vpg = day.get("ventas_por_grupo") or []
        if isinstance(vpg, str):
            vpg = json.loads(vpg)
        ventas = day.get("ventas_dia", 0) or 0
        prop = day.get("propinas_total", 0) or 0
        tickets = day.get("tickets_count", 0) or 0
        if tickets == 0 or ventas == 0:
            continue

        dessert_total = 0
        for g in vpg:
            nombre = (g.get("nombre") or "").upper()
            if any(d in nombre for d in ["DESSERT", "BAKERY", "ICE CREAM"]):
                dessert_total += g.get("total", 0)

        dessert_pct = dessert_total / ventas * 100
        tip_per_ticket = prop / tickets

        if dessert_pct > 8:  # Days with above-average dessert sales
            days_with_desserts.append(tip_per_ticket)
        else:
            days_without_desserts.append(tip_per_ticket)

    if days_with_desserts and days_without_desserts:
        avg_with = sum(days_with_desserts) / len(days_with_desserts)
        avg_without = sum(days_without_desserts) / len(days_without_desserts)
        if avg_without > 0 and avg_with > avg_without * 1.1:
            pct = round((avg_with / avg_without - 1) * 100)
            insights.append(
                f"Dias con mas postres tienen {pct}% mas propina/ticket (${avg_with:.0f} vs ${avg_without:.0f}). Entrenar meseros a sugerir postre."
            )

    # Personas per mesa correlation
    for day in daily_data:
        personas = day.get("personas_restaurant", 0) or 0
        mesas = day.get("tickets_count", 0) or 0  # Approximate
        if personas > 0 and mesas > 0:
            ppm = personas / mesas
            # Stored for later use

    # Tip rate trend (this week vs month)
    if len(daily_data) >= 7:
        week_rates = []
        month_rates = []
        for i, day in enumerate(daily_data):
            v = day.get("ventas_dia", 0) or 0
            p = day.get("propinas_total", 0) or 0
            if v > 0:
                rate = p / v * 100
                if i < 7:
                    week_rates.append(rate)
                month_rates.append(rate)

        if week_rates and month_rates:
            week_avg = sum(week_rates) / len(week_rates)
            month_avg = sum(month_rates) / len(month_rates)
            if month_avg > 0:
                diff = round(week_avg - month_avg, 1)
                if abs(diff) > 1:
                    direction = "subio" if diff > 0 else "bajo"
                    insights.append(
                        f"Tasa de propina esta semana: {week_avg:.1f}% vs {month_avg:.1f}% mes ({direction} {abs(diff):.1f} pts)."
                    )

    return insights


# -- Build message --
def build_message(mesero_ranking, correlations, daily_data):
    now_mx = datetime.now(MX_TZ)

    # Calculate totals
    total_propinas = sum(d.get("propinas_total", 0) or 0 for d in daily_data)
    total_ventas = sum(d.get("ventas_dia", 0) or 0 for d in daily_data)
    total_tickets = sum(d.get("tickets_count", 0) or 0 for d in daily_data)

    if total_propinas == 0 and not mesero_ranking:
        return None

    msg = f"PROPINAS SEMANAL — {now_mx.strftime('%d/%m/%Y')}\n\n"

    # Summary
    prop_rate = round(total_propinas / total_ventas * 100, 1) if total_ventas > 0 else 0
    prop_per_ticket = round(total_propinas / total_tickets) if total_tickets > 0 else 0
    msg += f"Total propinas: ${total_propinas:,.0f}\n"
    msg += f"Tasa: {prop_rate}% | ${prop_per_ticket}/ticket\n"
    msg += f"Periodo: {len(daily_data)} dias\n\n"

    # Mesero ranking
    if mesero_ranking:
        msg += "RANKING MESEROS:\n"
        avg_ppt = sum(m["propina_per_ticket"] for m in mesero_ranking) / len(mesero_ranking) if mesero_ranking else 0

        for i, m in enumerate(mesero_ranking):
            first_name = m["nombre"].split()[0]
            indicator = ""
            if m["propina_per_ticket"] > avg_ppt * 1.3:
                indicator = " +++"
            elif m["propina_per_ticket"] < avg_ppt * 0.7:
                indicator = " ---"

            msg += f"  {i+1}. {first_name}: ${m['propina_per_ticket']}/ticket ({m['propina_pct']}% de venta){indicator}\n"
            msg += f"     ${m['propinas']:,} en {m['tickets']} tickets ({m['dias']}d)\n"

        # Highlight gap between best and worst
        if len(mesero_ranking) >= 2:
            best = mesero_ranking[0]
            worst = mesero_ranking[-1]
            gap = round(best["propina_per_ticket"] - worst["propina_per_ticket"])
            if gap > 10:
                msg += f"\n  Diferencia: {best['nombre'].split()[0]} gana ${gap}/ticket mas que {worst['nombre'].split()[0]}.\n"

        msg += "\n"

    # Correlations
    if correlations:
        msg += "PATRONES:\n"
        for c in correlations:
            msg += f"  - {c}\n"
        msg += "\n"

    # Recommendations
    recs = []
    if mesero_ranking and len(mesero_ranking) >= 2:
        best = mesero_ranking[0]
        recs.append(f"Que {best['nombre'].split()[0]} comparta su tecnica con el equipo")
    if any("postre" in c.lower() for c in correlations):
        recs.append("Sugerir postre = mas propina. Incentivar upselling de postres")
    if prop_rate < 10:
        recs.append(f"Tasa de propina ({prop_rate}%) esta baja. Revisar servicio y presentacion")

    if recs:
        msg += "ACCION:\n"
        for r in recs:
            msg += f"  - {r}\n"

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

    print(f"[tips] Starting for {CLIENT['id']} on {today_str}")

    # 1. Fetch data
    daily_data = get_weekly_daily(7)
    tips_data = get_tips_data(7)
    waiter_cats = get_waiter_categories(7)
    historical = get_historical_daily(30)
    print(f"[tips] Daily: {len(daily_data)}, Tips: {len(tips_data)}, WaiterCats: {len(waiter_cats)}, Historical: {len(historical)}")

    if not daily_data:
        print("[tips] No daily data — skipping")
        return

    total_propinas = sum(d.get("propinas_total", 0) or 0 for d in daily_data)
    if total_propinas == 0:
        print("[tips] Total propinas = $0 — skipping")
        return

    # 2. Analyze
    mesero_ranking = analyze_mesero_tips(tips_data, daily_data)
    correlations = analyze_tip_correlations(historical if len(historical) > len(daily_data) else daily_data)

    print(f"[tips] Meseros ranked: {len(mesero_ranking)}, Correlations: {len(correlations)}")

    # 3. Build structured data and save to DB
    total_ventas = sum(d.get("ventas_dia", 0) or 0 for d in daily_data)
    total_tickets = sum(d.get("tickets_count", 0) or 0 for d in daily_data)

    structured_data = {
        "mesero_ranking": mesero_ranking,
        "correlations": correlations,
        "totals": {
            "propinas": total_propinas,
            "ventas": total_ventas,
            "tickets": total_tickets,
            "propina_rate": round(total_propinas / total_ventas * 100, 1) if total_ventas > 0 else 0,
            "propina_per_ticket": round(total_propinas / total_tickets) if total_tickets > 0 else 0,
        },
        "analysis_days": len(daily_data),
    }

    priority = "info"
    if total_ventas > 0 and total_propinas / total_ventas < 0.08:
        priority = "warning"

    summary = f"${total_propinas:,.0f} propinas, {len(mesero_ranking)} meseros analizados"

    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_results",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"},
            json={
                "client_id": CLIENT["id"],
                "agent_id": "tips",
                "fecha": today_str,
                "data": json.dumps(structured_data),
                "summary": summary,
                "priority": priority,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        print(f"[tips] Saved to agent_results")
    except Exception as e:
        print(f"[tips] Error saving to DB: {e}")

    elapsed = int((time.time() - start) * 1000)
    print(f"[tips] Done in {elapsed}ms — {summary}")

    log_run("success", elapsed, f"{len(mesero_ranking)} meseros, {len(correlations)} patterns")


def log_run(status, elapsed, summary):
    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_runs",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
            json={
                "agent_id": "tips-analyzer",
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
