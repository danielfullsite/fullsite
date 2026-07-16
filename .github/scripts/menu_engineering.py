#!/usr/bin/env python3
"""
Menu Engineering Agent — Multi-tenant
BCG matrix analysis de platillos: Estrella, Caballo, Rompecabezas, Perro.
Corre los lunes a las 9:30am MX.
"""

import os
import sys
import json
import time
import requests
from datetime import datetime, timedelta, timezone
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import sb_get as _sb_get, log_run as _log_run, create_insight
from client_config import get_client, get_tz, get_chat_ids
try:
    from audit_log import AuditLogger
    _audit = AuditLogger("menu_engineering")
except ImportError:
    _audit = None
# ── Config ──────────────────────────────────────────────────────────────────
CLIENT = get_client()
MX_TZ = get_tz(CLIENT)
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


# ── Supabase helpers ────────────────────────────────────────────────────────
def sb_get(table, params):
    """Wrapper: convert dict params to query string for agent_common.sb_get."""
    if isinstance(params, dict):
        qs = "&".join(f"{k}={v}" for k, v in params.items())
    else:
        qs = params
    return _sb_get(table, qs)


# ── Data fetching ───────────────────────────────────────────────────────────
def get_sales_data(days=30):
    """Fetch ventas_por_grupo from wansoft_daily for the last N days."""
    cutoff = (datetime.now(MX_TZ) - timedelta(days=days)).strftime("%Y-%m-%d")
    return sb_get("ops_daily_history", {"client_id": f"eq.{CLIENT['id']}",
        "select": "fecha,ventas_dia,ventas_por_grupo",
        "fecha": f"gte.{cutoff}",
        "ventas_dia": "gt.0",
        "order": "fecha.desc",
        "limit": str(days),
    })


def get_food_cost_data():
    """Fetch food cost data — prefer pos_recipes (Excel costeo), fallback to wansoft_food_cost."""
    try:
        recipes = sb_get("pos_recipes", {
            "select": "nombre,precio_venta,costo_total,pct_costo",
            "client_id": f"eq.{CLIENT['id']}",
            "costo_total": "gt.0",
            "limit": "200",
        })
        if recipes:
            return [{"source": "pos_recipes", "data": recipes}]
    except:
        pass
    try:
        return sb_get("wansoft_food_cost", {
            "select": "*",
            "order": "created_at.desc",
            "limit": "1",
        })
    except:
        return []


# ── Analysis ────────────────────────────────────────────────────────────────
def aggregate_categories(data):
    """Aggregate ventas_por_grupo across all days."""
    cat_totals = defaultdict(float)
    cat_days = defaultdict(int)  # Number of days each category appeared

    for day in data:
        groups = day.get("ventas_por_grupo") or []
        if isinstance(groups, str):
            groups = json.loads(groups)
        for g in groups:
            name = g.get("nombre", "").strip()
            total = float(g.get("total") or 0)
            if name and total > 0:
                cat_totals[name] += total
                cat_days[name] += 1

    # Calculate daily average for each category
    categories = []
    for name, total in cat_totals.items():
        categories.append({
            "nombre": name,
            "total_30d": round(total),
            "daily_avg": round(total / max(cat_days[name], 1)),
            "days_present": cat_days[name],
            "frequency": cat_days[name] / len(data) if data else 0,
        })

    return sorted(categories, key=lambda x: x["total_30d"], reverse=True)


def classify_bcg(categories, food_cost_data):
    """
    BCG matrix classification:
    - Estrella: high popularity + high margin (best items)
    - Caballo: high popularity + low margin (volume drivers)
    - Rompecabezas: low popularity + high margin (hidden gems)
    - Perro: low popularity + low margin (candidates for removal)
    """
    if not categories:
        return []

    # Get food cost % by category if available
    food_costs = {}
    if food_cost_data:
        fc = food_cost_data[0]
        # food_cost table may have category-level costs
        fc_items = fc.get("items") or fc.get("categories") or fc.get("data") or []
        if isinstance(fc_items, str):
            fc_items = json.loads(fc_items)
        for item in fc_items:
            name = item.get("nombre", item.get("category", "")).strip()
            # pos_recipes uses pct_costo; only platillos with precio real
            cost_pct = float(item.get("pct_costo") or item.get("cost_pct") or item.get("food_cost_pct") or 0)
            precio = float(item.get("precio_venta", 1) or 0)
            if name and 0 < cost_pct < 100 and precio > 0:
                food_costs[name.upper()] = cost_pct

    # Calculate median popularity (total_30d) as threshold
    totals = [c["total_30d"] for c in categories]
    totals_sorted = sorted(totals)
    median_sales = totals_sorted[len(totals_sorted) // 2] if totals_sorted else 0

    # Default food cost assumptions by category type (industry benchmarks for café)
    DEFAULT_COSTS = {
        "COFFEE": 15, "CAFÉ": 15, "HOT": 15,
        "FRESH DRINKS": 20, "JUGOS": 25, "SMOOTHIES": 28,
        "FRAPPES": 18,
        "TOAST": 30, "BAGEL": 30, "CROISSANT": 35,
        "PANCAKE": 25, "WAFFLE": 25,
        "CHILAQUIL": 28, "ENCHILADA": 28,
        "EGG": 22, "KETO": 25,
        "BOWL": 30,
        "PANINI": 32,
        "DESSERT": 22, "BAKERY": 25,
        "PIZZA": 30, "PASTA": 28,
        "CEVICHE": 35,
        "ICE CREAM": 20,
        "SODA": 10, "TEA": 12,
        # Spanish cuisine
        "PAELLA": 35, "CROQUETA": 20, "TAPA": 25, "PULPO": 40,
        "TORTILLA ESPAÑOLA": 22, "GAZPACHO": 18, "JAMON": 35,
        "VINO": 30, "SANGRIA": 20, "CALAMARES": 28,
    }

    # Estimate margin (100% - food_cost%)
    # Lower food cost = higher margin
    MARGIN_THRESHOLD = 70  # 70% margin = 30% food cost

    classified = []
    for cat in categories:
        name_upper = cat["nombre"].upper()

        # Try to find food cost from data
        cost_pct = food_costs.get(name_upper, 0)

        # Fallback to defaults
        if cost_pct == 0:
            for keyword, default_cost in DEFAULT_COSTS.items():
                if keyword in name_upper:
                    cost_pct = default_cost
                    break
            if cost_pct == 0:
                cost_pct = 28  # Default assumption

        margin_pct = 100 - cost_pct
        is_popular = cat["total_30d"] >= median_sales
        is_high_margin = margin_pct >= MARGIN_THRESHOLD

        if is_popular and is_high_margin:
            quadrant = "Estrella"
            emoji = "⭐"
        elif is_popular and not is_high_margin:
            quadrant = "Caballo"
            emoji = "🐴"
        elif not is_popular and is_high_margin:
            quadrant = "Rompecabezas"
            emoji = "🧩"
        else:
            quadrant = "Perro"
            emoji = "🐕"

        classified.append({
            **cat,
            "food_cost_pct": cost_pct,
            "margin_pct": margin_pct,
            "quadrant": quadrant,
            "emoji": emoji,
        })

    return classified


def generate_recommendations(classified):
    """Generate top 5 actionable recommendations."""
    recs = []

    # 1. Promote Rompecabezas (hidden gems - high margin, low volume)
    rompecabezas = [c for c in classified if c["quadrant"] == "Rompecabezas"]
    for item in rompecabezas[:2]:
        potential = item["daily_avg"] * 2  # If we double sales
        extra_monthly = potential * 30
        recs.append({
            "action": f"Promueve '{item['nombre']}' — margen alto ({item['margin_pct']:.0f}%), pocas ventas.",
            "impact": f"+${extra_monthly:,.0f}/mes si duplicas ventas",
            "priority": "alta",
        })

    # 2. Optimize Caballos (popular but low margin)
    caballos = [c for c in classified if c["quadrant"] == "Caballo"]
    for item in caballos[:2]:
        # If we reduce food cost by 5pp
        savings = item["total_30d"] * 0.05
        recs.append({
            "action": f"Optimiza costo de '{item['nombre']}' — vende mucho pero margen bajo ({item['margin_pct']:.0f}%).",
            "impact": f"+${savings:,.0f}/mes con 5pp menos de food cost",
            "priority": "media",
        })

    # 3. Consider removing Perros (low everything)
    perros = [c for c in classified if c["quadrant"] == "Perro" and c["total_30d"] < classified[0]["total_30d"] * 0.05]
    if perros:
        names = ", ".join(p["nombre"] for p in perros[:3])
        recs.append({
            "action": f"Evalúa eliminar del menú: {names}",
            "impact": "Simplifica menú, reduce desperdicio, mejora eficiencia",
            "priority": "baja",
        })

    # 4. Protect Estrellas
    estrellas = [c for c in classified if c["quadrant"] == "Estrella"]
    if estrellas:
        top_star = estrellas[0]
        recs.append({
            "action": f"Protege '{top_star['nombre']}' — tu mejor producto. Asegura stock y calidad consistente.",
            "impact": f"${top_star['total_30d']:,}/mes en juego",
            "priority": "alta",
        })

    # 5. Beverage upsell opportunity
    beverages = [c for c in classified if any(kw in c["nombre"].upper() for kw in ["COFFEE", "FRESH", "FRAPPE", "SMOOTHIE", "JUGO"])]
    beverage_margin = sum(c["margin_pct"] for c in beverages) / len(beverages) if beverages else 0
    if beverage_margin > 70:
        recs.append({
            "action": "Entrena meseros para sugerir 2da bebida siempre — margen promedio de bebidas es muy alto.",
            "impact": "Cada bebida extra suma ~$50-80 con 75%+ margen",
            "priority": "alta",
        })

    return recs[:5]


# ── Build Message ───────────────────────────────────────────────────────────
def build_message(classified, recommendations, total_days):
    now_mx = datetime.now(MX_TZ)

    msg = f"📊 INGENIERÍA DE MENÚ — {now_mx.strftime('%d/%m/%Y')}\n"
    msg += f"Análisis últimos {total_days} días\n\n"

    # BCG Matrix summary
    by_quad = defaultdict(list)
    for c in classified:
        by_quad[c["quadrant"]].append(c)

    for quad, emoji, desc in [
        ("Estrella", "⭐", "Popular + Alto margen"),
        ("Caballo", "🐴", "Popular + Bajo margen"),
        ("Rompecabezas", "🧩", "Poco popular + Alto margen"),
        ("Perro", "🐕", "Poco popular + Bajo margen"),
    ]:
        items = by_quad.get(quad, [])
        if not items:
            continue
        total_revenue = sum(i["total_30d"] for i in items)
        msg += f"{emoji} {quad.upper()} ({desc}):\n"
        for item in items[:4]:  # Top 4 per quadrant
            msg += f"  • {item['nombre']}: ${item['total_30d']:,} ({item['margin_pct']:.0f}% margen)\n"
        if len(items) > 4:
            msg += f"  ... y {len(items) - 4} más\n"
        msg += f"  Total: ${total_revenue:,}\n\n"

    # Revenue distribution
    total_rev = sum(c["total_30d"] for c in classified)
    if total_rev > 0:
        msg += "💰 DISTRIBUCIÓN DE INGRESOS:\n"
        for quad in ["Estrella", "Caballo", "Rompecabezas", "Perro"]:
            items = by_quad.get(quad, [])
            rev = sum(i["total_30d"] for i in items)
            pct = rev / total_rev * 100
            msg += f"  {quad}: {pct:.0f}% (${rev:,})\n"
        msg += "\n"

    # Recommendations
    if recommendations:
        msg += "💡 TOP 5 ACCIONES:\n"
        for i, rec in enumerate(recommendations, 1):
            priority_emoji = "🔴" if rec["priority"] == "alta" else "🟡" if rec["priority"] == "media" else "🟢"
            msg += f"\n{i}. {priority_emoji} {rec['action']}\n"
            msg += f"   Impacto: {rec['impact']}\n"

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

    print(f"[menu_eng] Starting for {CLIENT['id']}")

    # 1. Fetch data
    print("[menu_eng] Fetching 30 days of sales...")
    sales_data = get_sales_data(30)
    print(f"[menu_eng] Got {len(sales_data)} days")

    if len(sales_data) < 7:
        print("[menu_eng] Not enough data, skipping")
        elapsed = int((time.time() - start) * 1000)
        _log_run("menu-engineering", "no_data", elapsed, skip_reason=f"only {len(sales_data)} days available, need 7+", data_status="no_data", tentacle="reportes")
        return

    print("[menu_eng] Fetching food cost data...")
    food_cost_data = get_food_cost_data()

    # 2. Analyze
    categories = aggregate_categories(sales_data)
    print(f"[menu_eng] Found {len(categories)} categories")

    if not categories:
        print("[menu_eng] No categories found, skipping")
        elapsed = int((time.time() - start) * 1000)
        _log_run("menu-engineering", "no_data", elapsed, skip_reason="ventas_por_grupo empty in all rows", data_status="no_data", tentacle="reportes")
        return

    classified = classify_bcg(categories, food_cost_data)
    recommendations = generate_recommendations(classified)

    # 3. Build structured data
    estrellas = sum(1 for c in classified if c["quadrant"] == "Estrella")
    perros = sum(1 for c in classified if c["quadrant"] == "Perro")

    by_quadrant = {}
    for c in classified:
        q = c["quadrant"]
        if q not in by_quadrant:
            by_quadrant[q] = []
        by_quadrant[q].append({
            "nombre": c["nombre"],
            "total_30d": c["total_30d"],
            "daily_avg": c["daily_avg"],
            "margin_pct": c["margin_pct"],
            "food_cost_pct": c["food_cost_pct"],
            "frequency": round(c["frequency"], 2),
        })

    total_rev = sum(c["total_30d"] for c in classified)
    revenue_distribution = {}
    for quad in ["Estrella", "Caballo", "Rompecabezas", "Perro"]:
        items = [c for c in classified if c["quadrant"] == quad]
        rev = sum(i["total_30d"] for i in items)
        revenue_distribution[quad] = {"total": rev, "pct": round(rev / total_rev * 100, 1) if total_rev > 0 else 0}

    structured_data = {
        "categories": by_quadrant,
        "revenue_distribution": revenue_distribution,
        "recommendations": recommendations,
        "total_categories": len(classified),
        "total_revenue_30d": total_rev,
        "analysis_days": len(sales_data),
    }

    summary = f"{estrellas} estrellas, {perros} perros, {len(recommendations)} recomendaciones"

    # 4. Save to DB
    now_mx = datetime.now(MX_TZ)
    today_str = now_mx.strftime("%Y-%m-%d")
    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_results",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"},
            json={
                "client_id": CLIENT["id"],
                "agent_id": "menu-engineering",
                "fecha": today_str,
                "data": json.dumps(structured_data),
                "summary": summary,
                "priority": "info",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        print(f"[menu_eng] Saved to agent_results")
    except Exception as e:
        print(f"[menu_eng] Error saving to DB: {e}")

    elapsed = int((time.time() - start) * 1000)
    print(f"[menu_eng] Done in {elapsed}ms — {summary}")

    # 5. Log
    _log_run(
        "menu-engineering", "success", elapsed,
        output_summary=f"categories: {len(classified)}, estrellas: {estrellas}, perros: {perros}, recs: {len(recommendations)}",
        rows_processed=len(sales_data),
        data_status="ok",
        tentacle="reportes",
    )

    # 6. Insight
    estrellas_list = [c for c in classified if c["quadrant"] == "Estrella"]
    perros_list = [c for c in classified if c["quadrant"] == "Perro"]
    rompecabezas_list = [c for c in classified if c["quadrant"] == "Rompecabezas"]
    create_insight(
        agent_id="menu-engineering",
        category="sales",
        severity="info",
        title=f"Menú: {estrellas} estrellas, {perros} perros identificados",
        summary=summary,
        evidence={
            "estrellas": [{"nombre": c["nombre"], "total_30d": c["total_30d"]} for c in estrellas_list[:5]],
            "perros": [{"nombre": c["nombre"], "total_30d": c["total_30d"]} for c in perros_list[:5]],
            "rompecabezas": [{"nombre": c["nombre"], "margin_pct": c["margin_pct"]} for c in rompecabezas_list[:3]],
            "total_revenue_30d": total_rev,
            "analysis_days": len(sales_data),
        },
        recommended_action=recommendations[0]["action"] if recommendations else None,
        client_id=CLIENT["id"],
    )
    if _audit: _audit.log_end(elapsed, "success")


if __name__ == "__main__":
    main()
