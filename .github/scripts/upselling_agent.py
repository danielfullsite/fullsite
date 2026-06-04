#!/usr/bin/env python3
"""
Upselling Agent — Multi-tenant
Analiza ventas del dia actual y sugiere oportunidades de upselling.
Corre a la 1pm y 4pm MX.

"Hoy llevas 12% menos postres que tu promedio."
"Solo 2 de 8 mesas pidieron 2da bebida."
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
# Least privilege: agent key (SELECT + INSERT agent_runs/results)
SUPABASE_KEY = os.environ.get("SUPABASE_AGENT_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
TG_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_IDS = get_chat_ids(CLIENT, "intraday")
TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "cron")

sb_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}

# Grupos clave para upselling
UPSELL_GROUPS = {
    "postres": ["DESSERTS", "BAKERY", "ICE CREAM"],
    "bebidas_extra": ["FRAPPES", "SMOOTHIES", "FRESH DRINKS", "SIGNATURE"],
    "pan": ["TOAST & BAGELS", "CROISSANTS BREAKFAST"],
    "half_half": [],  # tracked via half_half_total in wansoft_daily
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
def get_today_kpis():
    """Fetch current day KPIs from wansoft_kpis."""
    rows = sb_get("wansoft_kpis", {"select": "*", "limit": "1"})
    return rows[0] if rows else None


def get_historical_avg(days=30):
    """Fetch last N days from wansoft_daily for historical averages."""
    return sb_get("wansoft_daily", {"client_slug": f"eq.{CLIENT['id']}",
        "select": "fecha,ventas_dia,ventas_por_grupo,meseros,half_half_total,tickets_count,personas_restaurant",
        "ventas_dia": "gt.0",
        "order": "fecha.desc",
        "limit": str(days),
    })


def get_waiter_categories(days=7):
    """Fetch recent waiter category data."""
    return sb_get("wansoft_waiter_categories", {
        "select": "fecha,data",
        "order": "fecha.desc",
        "limit": str(days),
    })


# -- Analysis --
def calc_group_total(ventas_por_grupo, group_names):
    """Sum sales for a list of group names within ventas_por_grupo."""
    if not ventas_por_grupo:
        return 0
    total = 0
    for item in ventas_por_grupo:
        nombre = (item.get("nombre") or "").upper()
        for g in group_names:
            if g.upper() in nombre:
                total += item.get("total", 0)
                break
    return total


def calc_group_pct(ventas_por_grupo, group_names, ventas_dia):
    """Calculate percentage of sales from specific groups."""
    if not ventas_dia or ventas_dia == 0:
        return 0
    group_total = calc_group_total(ventas_por_grupo, group_names)
    return round(group_total / ventas_dia * 100, 1)


def analyze_upselling(today_kpis, historical):
    """Compare today vs historical averages for upselling categories."""
    if not today_kpis or not historical:
        return []

    insights = []
    today_vpg = today_kpis.get("ventas_por_grupo") or []
    if isinstance(today_vpg, str):
        today_vpg = json.loads(today_vpg)
    today_ventas = today_kpis.get("ventas_dia", 0) or 0
    today_tickets = today_kpis.get("tickets_count", 0) or 0

    if today_ventas == 0:
        return []

    # Calculate historical averages per group
    for label, groups in UPSELL_GROUPS.items():
        if label == "half_half":
            continue  # handled separately

        today_pct = calc_group_pct(today_vpg, groups, today_ventas)
        hist_pcts = []
        for day in historical:
            vpg = day.get("ventas_por_grupo") or []
            if isinstance(vpg, str):
                vpg = json.loads(vpg)
            vd = day.get("ventas_dia", 0)
            if vd > 0:
                hist_pcts.append(calc_group_pct(vpg, groups, vd))

        if not hist_pcts:
            continue

        avg_pct = round(sum(hist_pcts) / len(hist_pcts), 1)
        diff = round(today_pct - avg_pct, 1)

        if diff < -2:  # Significantly below average
            today_total = calc_group_total(today_vpg, groups)
            label_display = label.replace("_", " ").capitalize()
            insights.append({
                "tipo": "bajo",
                "categoria": label_display,
                "hoy_pct": today_pct,
                "promedio_pct": avg_pct,
                "diff": diff,
                "hoy_mxn": today_total,
                "msg": f"{label_display}: {today_pct}% de ventas vs {avg_pct}% promedio ({diff:+.1f}%). Hoy ${today_total:,.0f}.",
            })

    # Half & Half analysis
    today_hh = today_kpis.get("half_half_total", 0) or 0
    hist_hh = [d.get("half_half_total", 0) or 0 for d in historical if (d.get("ventas_dia", 0) or 0) > 0]
    if hist_hh:
        avg_hh = sum(hist_hh) / len(hist_hh)
        if avg_hh > 0 and today_hh < avg_hh * 0.8:
            pct_diff = round((today_hh / avg_hh - 1) * 100)
            insights.append({
                "tipo": "bajo",
                "categoria": "Half & Half",
                "hoy_mxn": today_hh,
                "promedio_mxn": round(avg_hh),
                "diff": pct_diff,
                "msg": f"Half & Half: ${today_hh:,.0f} hoy vs ${avg_hh:,.0f} promedio ({pct_diff:+d}%).",
            })

    return insights


def analyze_mesero_upselling(today_kpis, waiter_cats):
    """Identify meseros not upselling based on waiter category data."""
    insights = []

    if not waiter_cats:
        return insights

    # Get latest waiter category data
    latest = waiter_cats[0]
    data = latest.get("data")
    if isinstance(data, str):
        data = json.loads(data)
    if not data:
        return insights

    # Build per-mesero category stats
    mesero_stats = defaultdict(lambda: {"postres": 0, "pan": 0, "hh": 0, "bebidas_2": 0, "total": 0})

    # data can be a dict {mesero_name: {KPIs: ..., H&H: {qty, total}, ...}} or a list
    items = []
    if isinstance(data, dict):
        for mesero_name, mesero_data in data.items():
            if mesero_name.startswith("__") or not isinstance(mesero_data, dict):
                continue
            if not is_mesero(mesero_name, CLIENT):
                continue
            for cat_name, cat_val in mesero_data.items():
                if cat_name == "KPIs" or not isinstance(cat_val, dict):
                    continue
                items.append({"mesero": mesero_name, "categoria": cat_name,
                              "cantidad": cat_val.get("qty", 0), "total": cat_val.get("total", 0)})
    elif isinstance(data, list):
        items = data

    for item in items:
        if isinstance(item, str):
            continue
        mesero = item.get("mesero") or item.get("nombre") or ""
        if not mesero or not is_mesero(mesero, CLIENT):
            continue

        cat = (item.get("categoria") or item.get("grupo") or "").upper()
        cantidad = item.get("cantidad", 0) or item.get("total", 0) or 0

        mesero_stats[mesero]["total"] += cantidad

        if any(g in cat for g in ["DESSERT", "BAKERY", "ICE CREAM"]):
            mesero_stats[mesero]["postres"] += cantidad
        elif any(g in cat for g in ["TOAST", "BAGEL", "CROISSANT"]):
            mesero_stats[mesero]["pan"] += cantidad
        elif any(g in cat for g in ["HALF"]):
            mesero_stats[mesero]["hh"] += cantidad

    if len(mesero_stats) < 2:
        return insights

    # Find meseros below average in each category
    for cat_key, cat_label in [("postres", "postres"), ("pan", "pan"), ("hh", "H&H")]:
        values = [s[cat_key] for s in mesero_stats.values() if s["total"] > 0]
        if not values:
            continue
        avg = sum(values) / len(values)
        if avg < 1:
            continue

        low_performers = []
        for mesero, stats in mesero_stats.items():
            if stats["total"] > 0 and stats[cat_key] < avg * 0.5:
                low_performers.append(mesero.split()[0])  # First name only

        if low_performers:
            nombres = ", ".join(low_performers[:3])
            insights.append({
                "tipo": "mesero",
                "msg": f"{nombres} {'esta' if len(low_performers) == 1 else 'estan'} vendiendo poco {cat_label} vs el equipo.",
            })

    return insights


def calc_bebidas_per_persona(today_kpis, historical):
    """Compare drinks per person today vs average."""
    insights = []
    today_vpg = today_kpis.get("ventas_por_grupo") or []
    if isinstance(today_vpg, str):
        today_vpg = json.loads(today_vpg)
    today_personas = today_kpis.get("personas_restaurant", 0) or 0
    if today_personas == 0:
        return insights

    bebida_groups = CLIENT.get("bebida_groups") or [
        "COFFEE HOT/ICE", "FRAPPES", "SMOOTHIES", "FRESH DRINKS",
        "SIGNATURE", "JUGOS", "TEA & TISANAS", "SODAS",
    ]

    today_bebidas = calc_group_total(today_vpg, bebida_groups)
    today_ratio = round(today_bebidas / today_personas, 1) if today_personas > 0 else 0

    hist_ratios = []
    for day in historical:
        vpg = day.get("ventas_por_grupo") or []
        if isinstance(vpg, str):
            vpg = json.loads(vpg)
        personas = day.get("personas_restaurant", 0) or 0
        if personas > 0:
            beb = calc_group_total(vpg, bebida_groups)
            hist_ratios.append(round(beb / personas, 1))

    if not hist_ratios:
        return insights

    avg_ratio = round(sum(hist_ratios) / len(hist_ratios), 1)
    if avg_ratio > 0 and today_ratio < avg_ratio * 0.85:
        diff = round((today_ratio / avg_ratio - 1) * 100)
        insights.append({
            "tipo": "bebidas",
            "msg": f"Bebidas/persona: ${today_ratio:.0f} hoy vs ${avg_ratio:.0f} promedio ({diff:+d}%). Meseros pueden sugerir 2da bebida.",
        })

    return insights


# -- Build message --
def build_message(upsell_insights, mesero_insights, bebida_insights, today_kpis):
    now_mx = datetime.now(MX_TZ)
    hora = now_mx.strftime("%H:%M")

    msg = f"UPSELLING — {now_mx.strftime('%d/%m')} {hora}\n\n"

    ventas = today_kpis.get("ventas_dia", 0) or 0
    tickets = today_kpis.get("tickets_count", 0) or 0
    msg += f"Ventas: ${ventas:,.0f} | Tickets: {tickets}\n\n"

    all_insights = upsell_insights + bebida_insights + mesero_insights

    if not all_insights:
        return None  # Nothing to report

    # Category upselling
    cat_insights = [i for i in all_insights if i.get("tipo") in ("bajo", "bebidas")]
    if cat_insights:
        msg += "OPORTUNIDADES:\n"
        for i in cat_insights:
            msg += f"  - {i['msg']}\n"
        msg += "\n"

    # Mesero-specific
    mes_insights = [i for i in all_insights if i.get("tipo") == "mesero"]
    if mes_insights:
        msg += "POR MESERO:\n"
        for i in mes_insights:
            msg += f"  - {i['msg']}\n"
        msg += "\n"

    # Action items
    actions = []
    if any("postre" in i.get("msg", "").lower() for i in all_insights):
        actions.append("Sugerir postre al final de cada mesa")
    if any("h&h" in i.get("msg", "").lower() or "half" in i.get("msg", "").lower() for i in all_insights):
        actions.append("Ofrecer H&H: chilaquiles mitad y mitad")
    if any("pan" in i.get("msg", "").lower() for i in all_insights):
        actions.append("Sugerir canasta de pan con el cafe")
    if any("bebida" in i.get("msg", "").lower() for i in all_insights):
        actions.append("Preguntar: 'Le traigo otra bebida?'")

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

    print(f"[upselling] Starting for {CLIENT['id']} on {today_str}")

    # 1. Fetch today's KPIs
    today_kpis = get_today_kpis()
    if not today_kpis:
        print("[upselling] No KPI data — skipping")
        return

    ventas = today_kpis.get("ventas_dia", 0) or 0
    if ventas == 0:
        print("[upselling] Ventas = $0 — skipping")
        return

    # 2. Fetch historical
    historical = get_historical_avg(30)
    print(f"[upselling] Historical: {len(historical)} days")

    # 3. Fetch waiter categories
    waiter_cats = get_waiter_categories(7)
    print(f"[upselling] Waiter categories: {len(waiter_cats)} entries")

    # 4. Analyze
    upsell_insights = analyze_upselling(today_kpis, historical)
    mesero_insights = analyze_mesero_upselling(today_kpis, waiter_cats)
    bebida_insights = calc_bebidas_per_persona(today_kpis, historical)

    total_insights = len(upsell_insights) + len(mesero_insights) + len(bebida_insights)
    print(f"[upselling] Found {total_insights} insights")

    # 5. Build structured data and save to DB
    all_insights = upsell_insights + bebida_insights + mesero_insights
    structured_data = {
        "opportunities": upsell_insights,
        "mesero_insights": mesero_insights,
        "bebida_insights": bebida_insights,
        "today_ventas": ventas,
        "today_tickets": today_kpis.get("tickets_count", 0) or 0,
        "total_insights": total_insights,
    }

    priority = "warning" if total_insights > 3 else "info" if total_insights > 0 else "info"
    summary = f"{total_insights} oportunidades de upselling" if total_insights > 0 else "Sin oportunidades"

    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_results",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"},
            json={
                "client_id": CLIENT["id"],
                "agent_id": "upselling",
                "fecha": today_str,
                "data": json.dumps(structured_data),
                "summary": summary,
                "priority": priority,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        print(f"[upselling] Saved to agent_results")
    except Exception as e:
        print(f"[upselling] Error saving to DB: {e}")

    elapsed = int((time.time() - start) * 1000)
    print(f"[upselling] Done in {elapsed}ms — {summary}")

    log_run("success", elapsed, f"{total_insights} insights")


def log_run(status, elapsed, summary):
    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_runs",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
            json={
                "agent_id": "upselling",
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
