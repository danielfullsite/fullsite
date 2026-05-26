#!/usr/bin/env python3
"""
Purchase Predictor — Predicts ingredient needs for tomorrow based on:
1. Historical sales by day-of-week (869+ days)
2. Recipe ingredient quantities
3. Current inventory levels

Runs daily at 5pm MX. Sends Telegram with suggested purchase list.
"""

import os
import sys
import json
import time
import requests
from datetime import datetime, timedelta, timezone, date
from collections import defaultdict
from client_config import get_client, get_tz, get_chat_ids

CLIENT       = get_client()
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TG_TOKEN     = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_IDS  = get_chat_ids(CLIENT, "daily_briefing")
TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "cron")

MX_TZ = get_tz(CLIENT)
sb_headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}

start_time = time.time()
status     = "success"
output_sum = ""
error_msg  = None

DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]

def sb_get(table, params):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}", headers=sb_headers, params=params, timeout=15)
    r.raise_for_status()
    return r.json()

def sb_post(table, data):
    r = requests.post(f"{SUPABASE_URL}/rest/v1/{table}",
        headers={**sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
        json=data, timeout=15)
    r.raise_for_status()

def sb_upsert(table, data):
    r = requests.post(f"{SUPABASE_URL}/rest/v1/{table}",
        headers={**sb_headers, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"},
        json=data, timeout=15)
    r.raise_for_status()

def send_telegram(text):
    for chat_id in TG_CHAT_IDS:
        for chunk in [text[i:i+4000] for i in range(0, len(text), 4000)]:
            requests.post(f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                json={"chat_id": chat_id, "text": chunk}, timeout=15)

try:
    cid = CLIENT["id"]
    now_mx = datetime.now(timezone.utc).astimezone(MX_TZ)
    tomorrow = (now_mx + timedelta(days=1)).date()
    tomorrow_dow = tomorrow.weekday()  # 0=Monday
    tomorrow_name = DAY_NAMES[tomorrow_dow]

    print(f"[purchase] Predicting for {tomorrow} ({tomorrow_name})...")

    # 1. Get historical sales for same DOW (last 8 weeks)
    historical = sb_get("wansoft_daily", {
        "client_slug": f"eq.{cid}",
        "ventas_dia": "gt.0",
        "select": "fecha,ventas_dia,tickets_count,ventas_por_grupo",
        "order": "fecha.desc",
        "limit": "60",
    })

    # Filter to same day of week
    same_dow = []
    for row in historical:
        d = date.fromisoformat(row["fecha"])
        if d.weekday() == tomorrow_dow:
            same_dow.append(row)
        if len(same_dow) >= 8:
            break

    if not same_dow:
        output_sum = f"Sin historial para {tomorrow_name}. Saltando."
        print(f"[purchase] {output_sum}")
        raise SystemExit(0)

    # Average tickets for this DOW
    avg_tickets = sum(r.get("tickets_count", 0) or 0 for r in same_dow) / len(same_dow)
    print(f"[purchase] {tomorrow_name} avg: {avg_tickets:.0f} tickets ({len(same_dow)} semanas)")

    # 2. Get category sales distribution from recent same-DOW days
    category_totals = defaultdict(float)
    category_counts = defaultdict(int)
    for row in same_dow:
        vpg = row.get("ventas_por_grupo", [])
        if isinstance(vpg, str):
            try: vpg = json.loads(vpg)
            except: vpg = []
        for g in (vpg or []):
            name = g.get("nombre", "")
            total = g.get("total", 0) or 0
            if name and total > 0:
                category_totals[name] += total
                category_counts[name] += 1

    # 3. Get all recipes (ingredient per menu item)
    recipes = sb_get("pos_recipes", {
        "client_id": f"eq.{cid}",
        "select": "menu_item_id,menu_item_name,ingredient_id,quantity,unit",
        "limit": "2500",
    })

    # 4. Get ingredients
    ingredients = sb_get("pos_ingredients", {
        "client_id": f"eq.{cid}",
        "active": "eq.true",
        "select": "id,name,unit,cost_per_unit",
        "limit": "1000",
    })
    ing_map = {i["id"]: i for i in ingredients}

    # 5. Get current inventory
    inventory = sb_get("pos_inventory", {
        "client_id": f"eq.{cid}",
        "select": "ingredient_id,stock,reorder_point",
        "limit": "500",
    })
    inv_map = {i["ingredient_id"]: {
        "stock": float(i.get("stock") or 0),
        "reorder_point": float(i.get("reorder_point") or 0),
    } for i in inventory}

    # 6. Estimate ingredient usage for tomorrow
    # Strategy: use avg_tickets as multiplier for recipe quantities
    # Each ticket ≈ 1 menu item on average (simplification)
    # Scale by 1.2x safety margin

    SAFETY_MARGIN = 1.2
    estimated_items = avg_tickets * SAFETY_MARGIN

    # Calculate per-ingredient usage across all recipes (weighted equally for now)
    # More accurate: weight by category popularity
    ingredient_usage = defaultdict(float)
    menu_items_count = len(set(r["menu_item_id"] for r in recipes))

    for r in recipes:
        qty = float(r.get("quantity") or 0)
        if qty > 0:
            # Each menu item gets an equal share of estimated items
            # items_per_menu_item = estimated_items / menu_items_count
            # But this is too naive — use 1 portion per ingredient link
            ingredient_usage[r["ingredient_id"]] += qty

    # Normalize: ingredient_usage now has total qty if you sold 1 of every item
    # Scale by (estimated_items / menu_items_count) to get tomorrow's estimate
    scale = estimated_items / max(menu_items_count, 1)

    # 7. Build purchase list: ingredients where (current_stock - predicted_usage) < reorder_point
    purchase_list = []
    for ing_id, total_usage in ingredient_usage.items():
        predicted = total_usage * scale
        inv = inv_map.get(ing_id, {"stock": 0, "reorder_point": 0})
        ing_info = ing_map.get(ing_id, {})

        remaining = inv["stock"] - predicted
        reorder = inv["reorder_point"]

        if remaining < reorder and predicted > 0:
            need = max(reorder - remaining, predicted) * SAFETY_MARGIN
            cost = float(ing_info.get("cost_per_unit") or 0) * need

            purchase_list.append({
                "ingredient_id": ing_id,
                "name": ing_info.get("name", ing_id),
                "unit": ing_info.get("unit", "u"),
                "current_stock": inv["stock"],
                "predicted_usage": round(predicted, 2),
                "remaining_after": round(remaining, 2),
                "suggested_qty": round(need, 1),
                "estimated_cost": round(cost, 2),
            })

    # Sort by urgency (most negative remaining first)
    purchase_list.sort(key=lambda x: x["remaining_after"])

    print(f"[purchase] {len(purchase_list)} items to purchase for {tomorrow_name}")

    if not purchase_list:
        output_sum = f"OK — stock suficiente para {tomorrow_name} ({avg_tickets:.0f} tickets estimados). Sin compras."
        print(f"[purchase] {output_sum}")
    else:
        # Build message
        total_cost = sum(p["estimated_cost"] for p in purchase_list)
        lines = [
            f"COMPRAS SUGERIDAS — {tomorrow} ({tomorrow_name})",
            f"Tickets estimados: {avg_tickets:.0f} | Safety margin: {SAFETY_MARGIN}x",
            f"Costo estimado: ${total_cost:,.0f} MXN",
            "",
        ]

        # Critical (remaining < 0 = will run out)
        critical = [p for p in purchase_list if p["remaining_after"] < 0]
        low = [p for p in purchase_list if p["remaining_after"] >= 0]

        if critical:
            lines.append(f"URGENTE ({len(critical)} items — se acaban manana):")
            for p in critical[:15]:
                lines.append(f"  ! {p['name']}: comprar {p['suggested_qty']} {p['unit']} (stock: {p['current_stock']}, uso: {p['predicted_usage']})")

        if low:
            lines.append(f"\nReabastecer ({len(low)} items — stock bajo):")
            for p in low[:10]:
                lines.append(f"  > {p['name']}: comprar {p['suggested_qty']} {p['unit']} (stock: {p['current_stock']})")

        if len(purchase_list) > 25:
            lines.append(f"\n... y {len(purchase_list) - 25} items mas")

        msg = "\n".join(lines)
        send_telegram(msg)
        output_sum = f"COMPRAS: {len(purchase_list)} items, ${total_cost:,.0f} MXN para {tomorrow_name}"

    # Save to agent_results
    today_str = now_mx.strftime("%Y-%m-%d")
    sb_upsert("agent_results", {
        "agent_id": "purchase-predictor",
        "fecha": today_str,
        "priority": "warning" if purchase_list else "info",
        "summary": output_sum,
        "data": json.dumps({
            "target_date": tomorrow.isoformat(),
            "target_dow": tomorrow_name,
            "avg_tickets": round(avg_tickets),
            "items_to_purchase": len(purchase_list),
            "total_estimated_cost": round(sum(p["estimated_cost"] for p in purchase_list)),
            "critical_items": [p for p in purchase_list if p["remaining_after"] < 0][:10],
            "low_items": [p for p in purchase_list if p["remaining_after"] >= 0][:10],
        }),
    })

except SystemExit:
    pass
except Exception as e:
    status = "error"
    error_msg = str(e)
    output_sum = f"ERROR: {e}"
    print(f"[purchase] {output_sum}", file=sys.stderr)

# Log
duration_ms = int((time.time() - start_time) * 1000)
try:
    sb_post("agent_runs", {
        "agent_id": "purchase-predictor",
        "trigger_type": TRIGGER_TYPE,
        "status": status,
        "duration_ms": duration_ms,
        "output_summary": output_sum,
        "error_message": error_msg,
        "tentacle": "ops",
    })
    print(f"[purchase] Done in {duration_ms}ms. {output_sum}")
except Exception as e:
    print(f"[purchase] WARN: log failed: {e}", file=sys.stderr)
