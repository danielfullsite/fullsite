#!/usr/bin/env python3
"""
Waste Detector — Multi-tenant
Compara compras vs consumo teorico basado en recetas.
Corre jueves a las 9am MX.

"Compraste 50 aguacates pero las recetas solo usaron 35. $X en desperdicio."
"Food cost esta 5% arriba del target esta semana."

NOTE: Precision mejora conforme se acumulan datos de compras y recetas.
"""

import os
import sys
import json
import time
import requests
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from client_config import get_client, get_tz, get_chat_ids
try:
    from audit_log import AuditLogger
    _audit = AuditLogger("waste_detector")
except ImportError:
    _audit = None
# -- Config --
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

# Food cost target for a cafe/restaurant
FOOD_COST_TARGET = 0.30  # 30%


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
def get_suppliers_data(days=30):
    """Fetch purchase data from wansoft_suppliers."""
    now_mx = datetime.now(MX_TZ)
    start_date = (now_mx - timedelta(days=days)).strftime("%Y-%m-%d")
    return sb_get("wansoft_suppliers", {
        "select": "fecha,periodo,data",
        "fecha": f"gte.{start_date}",
        "order": "fecha.desc",
        "limit": "10",
    })


def get_food_cost_data(days=30):
    """Fetch food cost data — prefer pos_recipes (Excel costeo), fallback to wansoft_food_cost."""
    try:
        recipes = sb_get("pos_recipes", {
            "select": "nombre,precio_venta,costo_total,pct_costo,ingredientes",
            "client_id": f"eq.{CLIENT['id']}",
            "costo_total": "gt.0",
            "limit": "200",
        })
        if recipes:
            return [{"fecha": datetime.now(MX_TZ).strftime("%Y-%m-%d"), "data": recipes, "source": "pos_recipes"}]
    except:
        pass
    now_mx = datetime.now(MX_TZ)
    start_date = (now_mx - timedelta(days=days)).strftime("%Y-%m-%d")
    return sb_get("wansoft_food_cost", {
        "select": "fecha,data",
        "fecha": f"gte.{start_date}",
        "order": "fecha.desc",
        "limit": "10",
    })


def get_shrinkage_data():
    """Fetch physical vs system inventory differences if available."""
    return sb_get("wansoft_shrinkage", {
        "select": "fecha,data",
        "order": "fecha.desc",
        "limit": "5",
    })


def get_weekly_daily(days=7):
    """Fetch sales data for the period."""
    now_mx = datetime.now(MX_TZ)
    start_date = (now_mx - timedelta(days=days)).strftime("%Y-%m-%d")
    return sb_get("wansoft_daily", {"client_slug": f"eq.{CLIENT['id']}",
        "select": "fecha,ventas_dia,ventas_por_grupo,platillos_top",
        "fecha": f"gte.{start_date}",
        "ventas_dia": "gt.0",
        "order": "fecha.desc",
        "limit": str(days),
    })


def get_recipes():
    """Fetch recipes if available."""
    return sb_get("pos_recipes", {
        "select": "*",
        "limit": "1000",
    })


# -- Analysis --
def analyze_food_cost(food_cost_data, daily_data):
    """Analyze food cost vs target."""
    insights = []

    if not food_cost_data:
        return insights

    latest = food_cost_data[0]
    data = latest.get("data")
    if isinstance(data, str):
        data = json.loads(data)
    if not data:
        return insights

    # Calculate total cost and identify high-cost items
    total_cost = 0
    total_ventas = 0
    high_cost_items = []

    for item in data:
        costo = item.get("costo", 0) or item.get("cost", 0) or 0
        venta = item.get("venta", 0) or item.get("sale", 0) or item.get("ventas", 0) or 0
        nombre = item.get("nombre") or item.get("name") or item.get("platillo") or ""

        total_cost += costo
        total_ventas += venta

        if venta > 0:
            ratio = costo / venta
            if ratio > 0.40:  # Over 40% food cost
                high_cost_items.append({
                    "nombre": nombre,
                    "costo": costo,
                    "venta": venta,
                    "ratio": round(ratio * 100, 1),
                })

    if total_ventas > 0:
        overall_ratio = total_cost / total_ventas
        if overall_ratio > FOOD_COST_TARGET:
            diff = round((overall_ratio - FOOD_COST_TARGET) * 100, 1)
            excess = round((overall_ratio - FOOD_COST_TARGET) * total_ventas)
            insights.append({
                "tipo": "food_cost_alto",
                "prioridad": "alta",
                "msg": f"Food cost: {overall_ratio*100:.1f}% vs target {FOOD_COST_TARGET*100:.0f}% (+{diff} pts). ${excess:,} en exceso.",
            })
        else:
            insights.append({
                "tipo": "food_cost_ok",
                "prioridad": "info",
                "msg": f"Food cost: {overall_ratio*100:.1f}% (target: {FOOD_COST_TARGET*100:.0f}%). Dentro del rango.",
            })

    # Top high-cost items
    high_cost_items.sort(key=lambda x: x["ratio"], reverse=True)
    for item in high_cost_items[:5]:
        insights.append({
            "tipo": "item_alto",
            "prioridad": "media",
            "msg": f"{item['nombre']}: food cost {item['ratio']}% (${item['costo']:,.0f} costo / ${item['venta']:,.0f} venta).",
        })

    return insights


def analyze_purchases(suppliers_data, daily_data):
    """Analyze purchase patterns and identify anomalies."""
    insights = []

    if not suppliers_data:
        return insights

    # Aggregate purchases
    total_purchases = 0
    supplier_totals = defaultdict(float)

    for entry in suppliers_data:
        data = entry.get("data")
        if isinstance(data, str):
            data = json.loads(data)
        if not data:
            continue

        # data can be list of dicts or a dict
        items = data if isinstance(data, list) else [{"nombre": k, "total": v} for k, v in data.items()] if isinstance(data, dict) else []
        for supplier in items:
            if isinstance(supplier, str):
                continue
            nombre = supplier.get("nombre") or supplier.get("name") or supplier.get("proveedor") or ""
            monto = supplier.get("total") or supplier.get("monto") or supplier.get("amount") or 0
            if isinstance(monto, (list, dict)):
                continue
            if isinstance(monto, str):
                try:
                    monto = float(monto.replace(",", "").replace("$", ""))
                except:
                    monto = 0
            try:
                monto = float(monto)
                total_purchases += monto
                supplier_totals[nombre] += monto
            except (TypeError, ValueError):
                continue

    if total_purchases == 0:
        return insights

    # Compare purchases vs sales
    total_ventas = sum(d.get("ventas_dia", 0) or 0 for d in daily_data)
    if total_ventas > 0:
        purchase_ratio = total_purchases / total_ventas
        insights.append({
            "tipo": "compras_ratio",
            "prioridad": "info",
            "msg": f"Compras: ${total_purchases:,.0f} vs Ventas: ${total_ventas:,.0f} (ratio: {purchase_ratio*100:.1f}%).",
        })

        if purchase_ratio > 0.45:
            insights.append({
                "tipo": "compras_alto",
                "prioridad": "alta",
                "msg": f"Compras son {purchase_ratio*100:.0f}% de ventas — muy alto. Revisar desperdicios y porciones.",
            })

    # Top suppliers
    sorted_suppliers = sorted(supplier_totals.items(), key=lambda x: x[1], reverse=True)
    if sorted_suppliers:
        top3 = sorted_suppliers[:3]
        lines = [f"{s[0]}: ${s[1]:,.0f}" for s in top3]
        insights.append({
            "tipo": "top_proveedores",
            "prioridad": "info",
            "msg": "Top proveedores: " + " | ".join(lines),
        })

    return insights


def analyze_waste_estimate(food_cost_data, suppliers_data, daily_data):
    """Estimate waste: purchases - theoretical consumption."""
    insights = []

    total_ventas = sum(d.get("ventas_dia", 0) or 0 for d in daily_data)
    if total_ventas == 0:
        return insights

    # Get total purchases
    total_purchases = 0
    for entry in suppliers_data:
        data = entry.get("data")
        if isinstance(data, str):
            data = json.loads(data)
        if not data:
            continue
        # data can be list of dicts or a dict — normalize
        items = data if isinstance(data, list) else [{"nombre": k, "total": v} for k, v in data.items()] if isinstance(data, dict) else []
        for supplier in items:
            if isinstance(supplier, str):
                continue
            monto = supplier.get("total") or supplier.get("monto") or 0
            if isinstance(monto, (list, dict)):
                continue
            if isinstance(monto, str):
                try:
                    monto = float(monto.replace(",", "").replace("$", ""))
                except:
                    monto = 0
            try:
                total_purchases += float(monto)
            except (TypeError, ValueError):
                continue

    # Get theoretical cost from food_cost
    theoretical_cost = 0
    if food_cost_data:
        latest = food_cost_data[0]
        data = latest.get("data")
        if isinstance(data, str):
            data = json.loads(data)
        if data:
            for item in data:
                theoretical_cost += item.get("costo", 0) or item.get("cost", 0) or 0

    # Waste = purchases - theoretical consumption
    if total_purchases > 0 and theoretical_cost > 0:
        waste_estimate = total_purchases - theoretical_cost
        if waste_estimate > 0:
            waste_pct = round(waste_estimate / total_purchases * 100, 1)
            insights.append({
                "tipo": "desperdicio",
                "prioridad": "alta" if waste_pct > 15 else "media",
                "msg": f"Desperdicio estimado: ${waste_estimate:,.0f} ({waste_pct}% de compras). Compras ${total_purchases:,.0f} - Consumo teorico ${theoretical_cost:,.0f}.",
            })

    return insights


def analyze_shrinkage(shrinkage_data):
    """Analyze physical vs system inventory differences."""
    insights = []

    if not shrinkage_data:
        return insights

    latest = shrinkage_data[0]
    data = latest.get("data")
    if isinstance(data, str):
        data = json.loads(data)
    if not data:
        return insights

    total_diff = 0
    problem_items = []

    for item in data:
        nombre = item.get("nombre") or item.get("name") or ""
        fisico = item.get("fisico") or item.get("physical") or 0
        sistema = item.get("sistema") or item.get("system") or 0
        diff = sistema - fisico
        valor = item.get("valor_diff") or item.get("value") or 0

        if abs(diff) > 0:
            total_diff += abs(valor) if valor else 0
            if abs(diff) > 2:  # Significant difference
                problem_items.append({
                    "nombre": nombre,
                    "fisico": fisico,
                    "sistema": sistema,
                    "diff": diff,
                    "valor": valor,
                })

    if total_diff > 0:
        insights.append({
            "tipo": "merma",
            "prioridad": "alta" if total_diff > 5000 else "media",
            "msg": f"Merma total: ${total_diff:,.0f} (diferencia fisico vs sistema).",
        })

    for item in sorted(problem_items, key=lambda x: abs(x.get("valor", 0)), reverse=True)[:5]:
        insights.append({
            "tipo": "merma_item",
            "prioridad": "media",
            "msg": f"{item['nombre']}: sistema {item['sistema']} vs fisico {item['fisico']} (dif: {item['diff']:+}). ${abs(item.get('valor', 0)):,.0f}",
        })

    return insights


# -- Build message --
def build_message(fc_insights, purchase_insights, waste_insights, shrinkage_insights, daily_data):
    all_insights = fc_insights + purchase_insights + waste_insights + shrinkage_insights

    # Filter out info-only if nothing actionable
    actionable = [i for i in all_insights if i.get("prioridad") != "info"]
    if not actionable and not all_insights:
        return None

    now_mx = datetime.now(MX_TZ)
    total_ventas = sum(d.get("ventas_dia", 0) or 0 for d in daily_data)

    msg = f"COSTOS Y DESPERDICIOS — {now_mx.strftime('%d/%m/%Y')}\n\n"
    msg += f"Ventas periodo: ${total_ventas:,.0f} ({len(daily_data)} dias)\n\n"

    # Food cost
    fc = [i for i in all_insights if i["tipo"].startswith("food_cost")]
    if fc:
        for i in fc:
            msg += f"{i['msg']}\n"
        msg += "\n"

    # High-cost items
    items_altos = [i for i in all_insights if i["tipo"] == "item_alto"]
    if items_altos:
        msg += "PLATILLOS CON FOOD COST ALTO:\n"
        for i in items_altos:
            msg += f"  - {i['msg']}\n"
        msg += "\n"

    # Purchases
    compras = [i for i in all_insights if i["tipo"].startswith("compras") or i["tipo"] == "top_proveedores"]
    if compras:
        msg += "COMPRAS:\n"
        for i in compras:
            msg += f"  - {i['msg']}\n"
        msg += "\n"

    # Waste estimate
    desp = [i for i in all_insights if i["tipo"] == "desperdicio"]
    if desp:
        msg += "DESPERDICIO:\n"
        for i in desp:
            msg += f"  - {i['msg']}\n"
        msg += "\n"

    # Shrinkage
    merma = [i for i in all_insights if i["tipo"].startswith("merma")]
    if merma:
        msg += "MERMA (fisico vs sistema):\n"
        for i in merma:
            msg += f"  - {i['msg']}\n"
        msg += "\n"

    # Action items
    actions = []
    if any(i["tipo"] == "food_cost_alto" for i in all_insights):
        actions.append("Revisar porciones y recetas con cocina")
        actions.append("Comparar precios de proveedores principales")
    if any(i["tipo"] == "compras_alto" for i in all_insights):
        actions.append("Reducir compras o ajustar menu a ingredientes mas rentables")
    if any(i["tipo"] == "desperdicio" for i in all_insights):
        actions.append("Inventario fisico vs sistema — detectar fugas")
        actions.append("Revisar manejo de perecederos y almacenamiento")
    if any(i["tipo"].startswith("merma") for i in all_insights):
        actions.append("Investigar items con mayor merma")

    if actions:
        msg += "ACCION:\n"
        for a in actions:
            msg += f"  - {a}\n"

    # Only send if there's something actionable
    if not actionable:
        return None

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
    if _audit: _audit.log_start()
    now_mx = datetime.now(MX_TZ)
    today_str = now_mx.strftime("%Y-%m-%d")

    print(f"[waste] Starting for {CLIENT['id']} on {today_str}")

    # 1. Fetch data
    daily_data = get_weekly_daily(7)
    suppliers_data = get_suppliers_data(30)
    food_cost_data = get_food_cost_data(30)
    shrinkage_data = get_shrinkage_data()

    print(f"[waste] Daily: {len(daily_data)}, Suppliers: {len(suppliers_data)}, FoodCost: {len(food_cost_data)}, Shrinkage: {len(shrinkage_data)}")

    if not daily_data:
        print("[waste] No daily data — skipping")
        return

    total_ventas = sum(d.get("ventas_dia", 0) or 0 for d in daily_data)
    if total_ventas == 0:
        print("[waste] Total ventas = $0 — skipping")
        return

    # 2. Analyze
    fc_insights = analyze_food_cost(food_cost_data, daily_data)
    purchase_insights = analyze_purchases(suppliers_data, daily_data)
    waste_insights = analyze_waste_estimate(food_cost_data, suppliers_data, daily_data)
    shrinkage_insights = analyze_shrinkage(shrinkage_data)

    total = len(fc_insights) + len(purchase_insights) + len(waste_insights) + len(shrinkage_insights)
    print(f"[waste] Found {total} insights")

    # 3. Build structured data and save to DB
    all_insights = fc_insights + purchase_insights + waste_insights + shrinkage_insights
    structured_data = {
        "food_cost_insights": fc_insights,
        "purchase_insights": purchase_insights,
        "waste_insights": waste_insights,
        "shrinkage_insights": shrinkage_insights,
        "total_ventas": total_ventas,
        "total_insights": total,
        "analysis_days": len(daily_data),
    }

    has_high = any(i.get("prioridad") == "alta" for i in all_insights)
    priority = "warning" if has_high else "info"
    summary = f"{total} hallazgos de costos/desperdicios" if total > 0 else "Sin hallazgos"

    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_results",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"},
            json={
                "client_id": CLIENT["id"],
                "agent_id": "waste",
                "fecha": today_str,
                "data": json.dumps(structured_data),
                "summary": summary,
                "priority": priority,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        print(f"[waste] Saved to agent_results")
    except Exception as e:
        print(f"[waste] Error saving to DB: {e}")

    elapsed = int((time.time() - start) * 1000)
    print(f"[waste] Done in {elapsed}ms — {summary}")

    log_run("success", elapsed, f"{total} insights")
    if _audit: _audit.log_end(elapsed if "elapsed" in dir() else int((time.time() - start) * 1000), "success")

def log_run(status, elapsed, summary):
    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_runs",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
            json={
                "agent_id": "waste-detector",
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
