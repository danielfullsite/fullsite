#!/usr/bin/env python3
"""
Inventory Auto-Order Agent — Multi-tenant
Detecta ingredientes bajo el reorder point y genera OC sugeridas.
Corre diario a las 9am MX.

"Leche almendra: 2.5 lt quedan (reorder: 5 lt). Sugiero OC a Proveedor X."
"4 ingredientes bajo minimo — OC generada automaticamente."
"""

import os
import sys
import json
import time
import requests
from datetime import datetime, timezone
from collections import defaultdict
from client_config import get_client, get_tz, get_chat_ids

# -- Config --
CLIENT = get_client()
MX_TZ = get_tz(CLIENT)
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TG_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TG_CHAT_IDS = get_chat_ids(CLIENT, "ops")
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


def sb_post(table, data):
    try:
        r = requests.post(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
            json=data, timeout=10,
        )
        return r.ok
    except:
        return False


def get_low_stock():
    """Find ingredients below reorder point."""
    inventory = sb_get("pos_inventory", {
        "select": "ingredient_id,stock,reorder_point,reorder_quantity",
        "client_id": f"eq.{CLIENT['id']}",
    })

    ingredients = sb_get("pos_ingredients", {
        "select": "id,name,unit,cost_per_unit,category",
        "client_id": f"eq.{CLIENT['id']}",
        "active": "eq.true",
    })

    # Build ingredient lookup
    ing_map = {i["id"]: i for i in ingredients}

    low_items = []
    for inv in inventory:
        stock = float(inv.get("stock", 0) or 0)
        reorder_pt = float(inv.get("reorder_point", 0) or 0)
        reorder_qty = float(inv.get("reorder_quantity", 0) or 0)

        if reorder_pt <= 0:
            continue  # no reorder point set

        if stock <= reorder_pt:
            ing = ing_map.get(inv["ingredient_id"], {})
            low_items.append({
                "ingredient_id": inv["ingredient_id"],
                "name": ing.get("name", inv["ingredient_id"]),
                "unit": ing.get("unit", "pz"),
                "category": ing.get("category", "otro"),
                "cost_per_unit": float(ing.get("cost_per_unit", 0) or 0),
                "stock": stock,
                "reorder_point": reorder_pt,
                "reorder_quantity": reorder_qty if reorder_qty > 0 else reorder_pt * 2,
                "urgency": "critico" if stock <= reorder_pt * 0.25 else "bajo",
            })

    return sorted(low_items, key=lambda x: x["stock"] / max(x["reorder_point"], 0.01))


def get_suppliers():
    """Get supplier list for matching."""
    return sb_get("pos_suppliers", {
        "select": "id,name,category,phone,email",
        "client_id": f"eq.{CLIENT['id']}",
    })


def match_supplier(item, suppliers):
    """Match ingredient to best supplier by category."""
    category = item.get("category", "").lower()
    for s in suppliers:
        s_cat = (s.get("category", "") or "").lower()
        if s_cat and category and s_cat in category or category in s_cat:
            return s
    return None


def create_suggested_oc(low_items, suppliers):
    """Group low items by supplier and create suggested OCs."""
    # Group by matched supplier
    by_supplier = defaultdict(list)
    unmatched = []

    for item in low_items:
        supplier = match_supplier(item, suppliers)
        if supplier:
            by_supplier[supplier["name"]].append(item)
        else:
            unmatched.append(item)

    if unmatched:
        by_supplier["Sin proveedor asignado"] = unmatched

    return dict(by_supplier)


def format_telegram(low_items, oc_groups):
    """Format results for Telegram."""
    now_mx = datetime.now(MX_TZ)
    lines = [f"📦 *Inventario — Auto-Order* — {now_mx.strftime('%d/%m %H:%M')}"]
    lines.append("")

    if not low_items:
        lines.append("✅ Todo el inventario esta sobre el punto de reorden.")
        return "\n".join(lines)

    criticos = [i for i in low_items if i["urgency"] == "critico"]
    bajos = [i for i in low_items if i["urgency"] == "bajo"]

    lines.append(f"⚠️ *{len(low_items)} ingredientes bajo minimo*")
    if criticos:
        lines.append(f"🔴 {len(criticos)} criticos (stock <25% del minimo)")
    if bajos:
        lines.append(f"🟡 {len(bajos)} bajos")
    lines.append("")

    # Critical items first
    if criticos:
        lines.append("*🔴 CRITICOS:*")
        for item in criticos[:10]:
            lines.append(f"  • {item['name']}: {item['stock']:.1f} {item['unit']} (min: {item['reorder_point']:.1f})")
        lines.append("")

    # Suggested OCs
    lines.append("*📋 OC sugeridas:*")
    total_cost = 0
    for supplier, items in oc_groups.items():
        subtotal = sum(i["reorder_quantity"] * i["cost_per_unit"] for i in items)
        total_cost += subtotal
        lines.append(f"\n*{supplier}* — ${subtotal:,.0f} MXN")
        for item in items[:8]:
            qty = item["reorder_quantity"]
            cost = qty * item["cost_per_unit"]
            lines.append(f"  • {item['name']}: {qty:.0f} {item['unit']} (${cost:,.0f})")
        if len(items) > 8:
            lines.append(f"  ... +{len(items) - 8} mas")

    lines.append(f"\n💰 *Total estimado: ${total_cost:,.0f} MXN*")
    lines.append("")
    lines.append("_Responde 'crear OC [proveedor]' para generar la orden._")

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


def log_run(status, duration_ms, low_count, tokens=0):
    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_runs",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
            json={
                "agent_id": "inventory_auto_order",
                "client_id": CLIENT["id"],
                "status": status,
                "duration_ms": duration_ms,
                "tokens_used": tokens,
                "trigger_type": TRIGGER_TYPE,
                "tentacle": "ops",
                "output_summary": f"{low_count} items bajo minimo",
            },
            timeout=10,
        )
    except:
        pass


if __name__ == "__main__":
    start = time.time()
    try:
        low_items = get_low_stock()
        suppliers = get_suppliers()
        oc_groups = create_suggested_oc(low_items, suppliers)

        msg = format_telegram(low_items, oc_groups)

        # Always send — either "todo OK" or the alert
        send_telegram(msg)

        duration = int((time.time() - start) * 1000)
        log_run("success", duration, len(low_items))
        print(f"OK — {len(low_items)} items bajo minimo")
    except Exception as e:
        duration = int((time.time() - start) * 1000)
        log_run("error", duration, 0)
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
