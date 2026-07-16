#!/usr/bin/env python3
"""
Purchase Predictor Agent — Multi-tenant
Predicts weekly ingredient purchases based on:
  1. Last 30 days of sales (platillos_top from wansoft_daily)
  2. Recipe explosion (wansoft_recipes -> ingredient-level demand)
  3. Current ingredient costs (pos_ingredients + recipe budgeted costs)
  4. Historical purchases (purchases_by_product from wansoft_data)
Runs every Monday at 7am MX.
"""

import os
import sys
import json
import time
import requests
from datetime import datetime, timedelta, timezone
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from client_config import get_client, get_tz, get_chat_ids

try:
    from audit_log import AuditLogger
    _audit = AuditLogger("purchase_predictor")
except ImportError:
    _audit = None

# -- Config -------------------------------------------------------------------
CLIENT       = get_client()
MX_TZ        = get_tz(CLIENT)
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TG_TOKEN     = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TG_CHAT_IDS  = get_chat_ids(CLIENT, "daily_briefing")
# Fallback: use TELEGRAM_CHAT_ID_DANIEL if no chat IDs configured
if not TG_CHAT_IDS:
    fallback = os.environ.get("TELEGRAM_CHAT_ID_DANIEL", "")
    if fallback:
        TG_CHAT_IDS = [fallback]
TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "cron")

sb_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}

start_time = time.time()
if _audit:
    _audit.log_start()
status     = "success"
output_sum = ""
error_msg  = None


# -- Helpers ------------------------------------------------------------------
def sb_get(table, params):
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=sb_headers, params=params, timeout=30,
    )
    r.raise_for_status()
    return r.json()


def sb_post(table, data):
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers={**sb_headers, "Content-Type": "application/json",
                 "Prefer": "return=minimal"},
        json=data, timeout=15,
    )
    r.raise_for_status()


def sb_upsert(table, data):
    headers_u = {**sb_headers, "Content-Type": "application/json",
                 "Prefer": "resolution=merge-duplicates,return=minimal"}
    r = requests.post(f"{SUPABASE_URL}/rest/v1/{table}",
                      headers=headers_u, json=data, timeout=15)
    if r.status_code == 409:
        aid = data.get("agent_id", "")
        fecha = data.get("fecha", "")
        r = requests.patch(
            f"{SUPABASE_URL}/rest/v1/{table}?agent_id=eq.{aid}&fecha=eq.{fecha}",
            headers={**sb_headers, "Content-Type": "application/json",
                     "Prefer": "return=minimal"},
            json={k: v for k, v in data.items() if k not in ("agent_id", "fecha")},
            timeout=15)
    r.raise_for_status()


def send_telegram(text):
    for chat_id in TG_CHAT_IDS:
        for chunk in [text[i:i + 4000] for i in range(0, len(text), 4000)]:
            r = requests.post(
                f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                json={"chat_id": chat_id, "text": chunk, "parse_mode": "Markdown"},
                timeout=15,
            )
            if not r.ok:
                print(f"[purchase] WARN: Telegram {r.status_code}: {r.text[:200]}",
                      file=sys.stderr)


def safe_float(val, default=0.0):
    try:
        return float(val) if val is not None else default
    except (ValueError, TypeError):
        return default


def fmt_money(n):
    return f"${n:,.0f}"


# Normalize department names for cleaner grouping
DEPT_NORMALIZE = {
    "ABARROTE": "ABARROTES",
    "ABARRROTE": "ABARROTES",
    "VEGETAL": "FRUTAS Y VERDURAS",
    "FRUTERIA": "FRUTAS Y VERDURAS",
    "PROTEINA": "PROTEINA ANIMAL",
    "CARNES": "PROTEINA ANIMAL",
    "QUESOS": "LACTEOS",
    "SUBRECETA": "COCINA",
}

try:
    cid = CLIENT["id"]
    now_mx = datetime.now(timezone.utc).astimezone(MX_TZ)
    next_monday = (now_mx + timedelta(days=(7 - now_mx.weekday()) % 7 or 7))
    week_label = next_monday.strftime("%Y-%m-%d")

    # ── 1. Fetch last 30 days of sales (platillos_top) ──────────────────────
    print("[purchase] 1/5 Fetching sales data (30 days)...")
    cutoff = (now_mx - timedelta(days=30)).strftime("%Y-%m-%d")

    sales_rows = sb_get("wansoft_daily", {
        "client_slug": f"eq.{cid}",
        "select": "fecha,platillos_top,ventas_por_grupo",
        "fecha": f"gte.{cutoff}",
        "ventas_dia": "gt.0",
        "order": "fecha.desc",
        "limit": "30",
    })
    days_with_data = len(sales_rows)
    print(f"[purchase] Got {days_with_data} days of sales")

    # Build dish frequency: total sold per dish across 30 days
    dish_total_sold = defaultdict(float)
    for row in sales_rows:
        platillos = row.get("platillos_top") or []
        if isinstance(platillos, str):
            try:
                platillos = json.loads(platillos)
            except json.JSONDecodeError:
                platillos = []
        for p in platillos:
            name = (p.get("nombre") or "").strip().upper()
            total = safe_float(p.get("total"))
            if name and total > 0:
                dish_total_sold[name] += total

    # Daily average, then project 7 days
    dish_weekly = {}
    if days_with_data > 0:
        for name, total in dish_total_sold.items():
            dish_weekly[name] = (total / days_with_data) * 7

    print(f"[purchase] {len(dish_weekly)} unique dishes tracked")

    # ── 2. Fetch recipes (wansoft_recipes) ───────────────────────────────────
    print("[purchase] 2/5 Fetching recipes...")
    recipes_raw = sb_get("wansoft_recipes", {
        "client_id": f"eq.{cid}",
        "select": "saucer_name,ingredients",
        "limit": "1000",
    })
    print(f"[purchase] Got {len(recipes_raw)} recipes")

    # recipe_map: SAUCER_NAME -> [{ProductName, Quantity, UnitOfMeasureDescription, ProductBudgetedCost}]
    recipe_map = {}
    for rec in recipes_raw:
        name = (rec.get("saucer_name") or "").strip().upper()
        ingredients = rec.get("ingredients") or []
        if isinstance(ingredients, str):
            try:
                ingredients = json.loads(ingredients)
            except json.JSONDecodeError:
                ingredients = []
        if name and ingredients:
            recipe_map[name] = ingredients

    # ── 3. Fetch ingredient master (pos_ingredients) ─────────────────────────
    print("[purchase] 3/5 Fetching ingredient info...")
    ingredients_raw = sb_get("pos_ingredients", {
        "client_id": f"eq.{cid}",
        "active": "eq.true",
        "select": "name,unit,cost_per_unit,category,supplier",
        "limit": "2000",
    })
    print(f"[purchase] Got {len(ingredients_raw)} ingredients")

    ingredient_info = {}
    for ing in ingredients_raw:
        name = (ing.get("name") or "").strip().upper()
        if name:
            ingredient_info[name] = {
                "unit": (ing.get("unit") or "").upper(),
                "cost": safe_float(ing.get("cost_per_unit")),
                "category": (ing.get("category") or "OTROS").strip().upper(),
                "supplier": (ing.get("supplier") or "").strip(),
            }

    # ── 4. Fetch historical purchases (purchases_by_product) ─────────────────
    print("[purchase] 4/5 Fetching purchase history...")
    purchases_rows = sb_get("wansoft_data", {
        "client_id": f"eq.{cid}",
        "data_key": "eq.purchases_by_product",
        "select": "fecha,data",
        "order": "fecha.desc",
        "limit": "30",
    })
    print(f"[purchase] Got {len(purchases_rows)} purchase records")

    # Aggregate: {PRODUCT_NAME: {qty, cost, dept, unit}}
    purchase_30d = defaultdict(lambda: {"qty": 0.0, "cost": 0.0, "dept": "", "unit": ""})
    purchase_days = set()
    for row in purchases_rows:
        purchase_days.add(row.get("fecha", ""))
        data = row.get("data", "[]")
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except json.JSONDecodeError:
                continue
        if isinstance(data, dict):
            data = data.get("Result", [])
        if not isinstance(data, list):
            continue
        for item in data:
            pname = (item.get("ProductName") or "").strip().upper()
            qty   = safe_float(item.get("Quantity"))
            cost  = safe_float(item.get("Cost"))
            dept  = (item.get("Department") or "").strip().upper()
            unit  = (item.get("UnitOfMeasure") or "").strip().upper()
            if pname and (qty > 0 or cost > 0):
                purchase_30d[pname]["qty"]  += qty
                purchase_30d[pname]["cost"] += cost
                if dept:
                    purchase_30d[pname]["dept"] = dept
                if unit:
                    purchase_30d[pname]["unit"] = unit

    n_purchase_days = len(purchase_days)
    print(f"[purchase] {len(purchase_30d)} products across {n_purchase_days} purchase days")

    # ── 5. Explode recipes into ingredient demand ────────────────────────────
    print("[purchase] 5/5 Calculating ingredient demand...")

    ingredient_demand_7d = defaultdict(float)
    matched_dishes = 0
    unmatched_dishes = []

    for dish_name, weekly_count in dish_weekly.items():
        recipe = recipe_map.get(dish_name)
        if recipe:
            matched_dishes += 1
            for ing in recipe:
                ing_name = (ing.get("ProductName") or "").strip().upper()
                qty_per_dish = safe_float(ing.get("Quantity"))
                if ing_name and qty_per_dish > 0:
                    ingredient_demand_7d[ing_name] += weekly_count * qty_per_dish
        else:
            unmatched_dishes.append(dish_name)

    print(f"[purchase] Matched {matched_dishes}/{len(dish_weekly)} dishes to recipes")
    print(f"[purchase] {len(ingredient_demand_7d)} ingredients in demand projection")

    # ── 6. Build purchase recommendations ────────────────────────────────────
    SAFETY_MARGIN = 1.15  # 15% buffer
    recommendations = []

    # A) Recipe-based: ingredients with projected demand
    for ing_name, demand_qty in ingredient_demand_7d.items():
        if demand_qty <= 0:
            continue

        info = ingredient_info.get(ing_name, {})
        dept = info.get("category", "")
        unit = info.get("unit", "")
        cost_per = info.get("cost", 0)

        # Fallback to purchase history for dept/unit/cost
        ph = purchase_30d.get(ing_name, {})
        if not dept and ph.get("dept"):
            dept = ph["dept"]
        if not unit and ph.get("unit"):
            unit = ph["unit"]
        if cost_per <= 0 and ph.get("qty", 0) > 0 and ph.get("cost", 0) > 0:
            cost_per = ph["cost"] / ph["qty"]

        # Fallback to recipe budgeted cost / unit from recipe data
        if not unit or cost_per <= 0:
            for rec_list in recipe_map.values():
                for ing in rec_list:
                    if (ing.get("ProductName") or "").strip().upper() == ing_name:
                        if not unit:
                            unit = (ing.get("UnitOfMeasureDescription") or "").upper()
                        if cost_per <= 0:
                            cost_per = safe_float(ing.get("ProductBudgetedCost"))
                        break
                if unit and cost_per > 0:
                    break

        buy_qty = demand_qty * SAFETY_MARGIN
        dept = DEPT_NORMALIZE.get(dept, dept) or "OTROS"
        estimated_cost = buy_qty * cost_per if cost_per > 0 else 0

        if buy_qty >= 0.1:
            recommendations.append({
                "name": ing_name,
                "dept": dept,
                "unit": unit or "UN",
                "buy_qty": round(buy_qty, 1),
                "demand_7d": round(demand_qty, 1),
                "cost_per": round(cost_per, 2),
                "estimated_cost": round(estimated_cost, 2),
                "source": "recipe",
            })

    # B) Purchase-history items not covered by recipes (high-volume only)
    recipe_ingredients = set(ingredient_demand_7d.keys())
    for pname, ph in purchase_30d.items():
        if pname in recipe_ingredients or n_purchase_days <= 0:
            continue
        daily_rate = ph["qty"] / max(n_purchase_days, 1)
        weekly_proj = daily_rate * 7 * SAFETY_MARGIN
        if weekly_proj < 0.5:
            continue
        avg_cost = ph["cost"] / ph["qty"] if ph["qty"] > 0 else 0
        est_cost = weekly_proj * avg_cost
        if est_cost < 50:  # Skip items under $50 MXN/week
            continue
        dept = DEPT_NORMALIZE.get(ph["dept"], ph["dept"]) or "OTROS"
        recommendations.append({
            "name": pname,
            "dept": dept,
            "unit": ph["unit"] or "UN",
            "buy_qty": round(weekly_proj, 1),
            "demand_7d": round(daily_rate * 7, 1),
            "cost_per": round(avg_cost, 2),
            "estimated_cost": round(est_cost, 2),
            "source": "history",
        })

    recommendations.sort(key=lambda r: r["estimated_cost"], reverse=True)
    print(f"[purchase] {len(recommendations)} purchase recommendations")

    # ── 7. Format Telegram message ───────────────────────────────────────────
    by_dept = defaultdict(list)
    for rec in recommendations:
        by_dept[rec["dept"]].append(rec)

    dept_order = sorted(
        by_dept.keys(),
        key=lambda d: sum(r["estimated_cost"] for r in by_dept[d]),
        reverse=True,
    )
    total_cost = sum(r["estimated_cost"] for r in recommendations)

    lines = [
        f"\U0001F6D2 *Prediccion de Compras -- Semana del {week_label}*",
        f"_Basado en {days_with_data} dias de ventas, "
        f"{matched_dishes}/{len(dish_weekly)} platillos con receta_",
        "",
    ]

    for dept in dept_order:
        items = sorted(by_dept[dept], key=lambda r: r["estimated_cost"], reverse=True)
        dept_total = sum(r["estimated_cost"] for r in items)
        lines.append(f"*{dept} ({len(items)} items — {fmt_money(dept_total)}):*")

        shown = items[:15]
        hidden = items[15:]
        for r in shown:
            ul = r["unit"].lower()
            cost_s = fmt_money(r["estimated_cost"]) if r["estimated_cost"] > 0 else "sin costo"
            lines.append(
                f"  - {r['name']}: comprar {r['buy_qty']} {ul} ({cost_s})"
                f" | uso 7d: {r['demand_7d']} {ul}"
            )
        if hidden:
            hc = sum(r["estimated_cost"] for r in hidden)
            lines.append(f"  _... y {len(hidden)} items mas ({fmt_money(hc)})_")
        lines.append("")

    lines.append(f"\U0001F4B0 *Total estimado: {fmt_money(total_cost)}*")
    lines.append("")
    if unmatched_dishes:
        sample = unmatched_dishes[:8]
        lines.append(
            f"_Sin receta ({len(unmatched_dishes)}): "
            f"{', '.join(sample)}"
            f"{'...' if len(unmatched_dishes) > 8 else ''}_"
        )

    msg = "\n".join(lines)

    # ── 8. Send ──────────────────────────────────────────────────────────────
    if recommendations:
        print("[purchase] Sending to Telegram...")
        send_telegram(msg)
        print("[purchase] Telegram OK")
    else:
        print("[purchase] No recommendations — skipping Telegram")

    output_sum = (
        f"Prediccion semana {week_label}: {len(recommendations)} items, "
        f"{len(by_dept)} dptos, total {fmt_money(total_cost)}. "
        f"Recetas: {matched_dishes}/{len(dish_weekly)}"
    )

    # ── 9. Save to agent_results ─────────────────────────────────────────────
    today_str = now_mx.strftime("%Y-%m-%d")
    sb_upsert("agent_results", {
        "agent_id": "purchase-predictor",
        "fecha": today_str,
        "priority": "info",
        "summary": output_sum,
        "data": json.dumps({
            "week_of": week_label,
            "days_analyzed": days_with_data,
            "purchase_days": n_purchase_days,
            "dishes_matched": matched_dishes,
            "dishes_total": len(dish_weekly),
            "items_to_buy": len(recommendations),
            "total_estimated_cost": round(total_cost),
            "by_department": {
                d: {"items": len(by_dept[d]),
                    "cost": round(sum(r["estimated_cost"] for r in by_dept[d]))}
                for d in dept_order
            },
            "top_items": [
                {"name": r["name"], "qty": r["buy_qty"], "unit": r["unit"],
                 "cost": r["estimated_cost"]}
                for r in recommendations[:20]
            ],
        }),
    })

except SystemExit:
    pass
except Exception as e:
    status = "error"
    error_msg = str(e)
    output_sum = f"ERROR: {e}"
    print(f"[purchase] {output_sum}", file=sys.stderr)
    import traceback
    traceback.print_exc()

# -- Log agent_runs -----------------------------------------------------------
duration_ms = int((time.time() - start_time) * 1000)
try:
    sb_post("agent_runs", {
        "agent_id":       "purchase-predictor",
        "client_id":      CLIENT["id"],
        "trigger_type":   TRIGGER_TYPE,
        "status":         status,
        "duration_ms":    duration_ms,
        "output_summary": output_sum,
        "error_message":  error_msg,
        "tentacle":       "ops",
    })
    print(f"[purchase] agent_runs logged OK")
except Exception as e:
    print(f"[purchase] WARN: log failed: {e}", file=sys.stderr)

print(f"[purchase] Done in {duration_ms}ms. {output_sum}")
