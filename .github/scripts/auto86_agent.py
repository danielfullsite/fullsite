#!/usr/bin/env python3
"""
Auto-86 Agent — Detects menu items that can't be served due to missing ingredients.
Runs every 2 hours during service. Alerts via Telegram when items go 86'd.
Flow: pos_inventory + pos_recipes + pos_ingredients → analysis → Telegram alert → log
"""

import os
import sys
import json
import time
import requests
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import sb_get as _sb_get, log_run as _log_run, check_freshness, create_insight
from client_config import get_client, get_tz, get_chat_ids

CLIENT       = get_client()
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TG_TOKEN     = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_IDS  = get_chat_ids(CLIENT, "daily_briefing")  # same recipients as briefing
TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "cron")

sb_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}

start_time = time.time()
status     = "success"
output_sum = ""
error_msg  = None

def sb_get(table, params):
    """Wrapper: convert dict params to query string for agent_common.sb_get."""
    if isinstance(params, dict):
        qs = "&".join(f"{k}={v}" for k, v in params.items())
    else:
        qs = params
    return _sb_get(table, qs)

def sb_post(table, data):
    r = requests.post(f"{SUPABASE_URL}/rest/v1/{table}",
        headers={**sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
        json=data, timeout=15)
    r.raise_for_status()

def sb_upsert(table, data):
    headers_u = {**sb_headers, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"}
    r = requests.post(f"{SUPABASE_URL}/rest/v1/{table}", headers=headers_u, json=data, timeout=15)
    if r.status_code == 409:
        agent_id = data.get("agent_id", "")
        fecha = data.get("fecha", "")
        r = requests.patch(
            f"{SUPABASE_URL}/rest/v1/{table}?agent_id=eq.{agent_id}&fecha=eq.{fecha}",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
            json={k: v for k, v in data.items() if k not in ("agent_id", "fecha")},
            timeout=15)
    r.raise_for_status()

def send_telegram(text):
    for chat_id in TG_CHAT_IDS:
        for chunk in [text[i:i+4000] for i in range(0, len(text), 4000)]:
            requests.post(f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                json={"chat_id": chat_id, "text": chunk}, timeout=15)

try:
    cid = CLIENT["id"]
    print(f"[auto86] Starting for {cid}...")

    # 1. Fetch inventory with stock levels
    inventory = sb_get("pos_inventory", {
        "client_id": f"eq.{cid}",
        "select": "ingredient_id,stock,reorder_point",
        "limit": "500",
    })

    # 2. Fetch ingredient names
    ingredients = sb_get("pos_ingredients", {
        "client_id": f"eq.{cid}",
        "active": "eq.true",
        "select": "id,name,unit",
        "limit": "1000",
    })
    ing_map = {i["id"]: i for i in ingredients}

    # 3. Find critical ingredients (stock below reorder point)
    critical = []
    for item in inventory:
        stock = float(item.get("stock") or 0)
        reorder = float(item.get("reorder_point") or 0)
        if reorder > 0 and stock < reorder:
            ing = ing_map.get(item["ingredient_id"], {})
            critical.append({
                "ingredient_id": item["ingredient_id"],
                "name": ing.get("name", item["ingredient_id"]),
                "unit": ing.get("unit", "u"),
                "stock": stock,
                "reorder_point": reorder,
                "is_zero": stock == 0,
            })

    critical.sort(key=lambda x: x["stock"] / max(x["reorder_point"], 0.01))
    zero_stock = [c for c in critical if c["is_zero"]]

    print(f"[auto86] {len(critical)} critical ingredients, {len(zero_stock)} at zero")

    if not zero_stock:
        # No zero-stock items — silent success
        output_sum = f"OK — {len(critical)} ingredientes bajos, 0 en cero. Sin alerta."
        print(f"[auto86] {output_sum}")
    else:
        # 4. Fetch recipes to find affected menu items
        # pos_recipes_old = relational recipes (menu_item_id → ingredient_id); pos_recipes = Excel costeo
        recipes = sb_get("pos_recipes_old", {
            "client_id": f"eq.{cid}",
            "select": "menu_item_id,menu_item_name,ingredient_id,quantity",
            "limit": "2500",
        })

        zero_ids = set(c["ingredient_id"] for c in zero_stock)

        # Group affected items
        affected = {}  # menu_item_name → [ingredient_names]
        for r in recipes:
            if r.get("ingredient_id") in zero_ids:
                name = r.get("menu_item_name", "?")
                if name not in affected:
                    affected[name] = set()
                ing_name = ing_map.get(r["ingredient_id"], {}).get("name", r["ingredient_id"])
                affected[name].add(ing_name)

        # Build alert message
        MX_TZ = get_tz(CLIENT)
        now_mx = datetime.now(timezone.utc).astimezone(MX_TZ)

        lines = [f"86'd ALERT — {now_mx.strftime('%H:%M')}"]
        lines.append(f"{len(zero_stock)} ingredientes en CERO:")
        for c in zero_stock:
            lines.append(f"  x {c['name']} (0/{c['reorder_point']} {c['unit']})")

        lines.append(f"\n{len(affected)} platillos afectados:")
        for item_name in sorted(affected.keys())[:20]:
            ings = ", ".join(sorted(affected[item_name]))
            lines.append(f"  - {item_name} ({ings})")

        if len(affected) > 20:
            lines.append(f"  ... y {len(affected) - 20} mas")

        lines.append(f"\nAccion: reabastecer o desactivar del menu.")

        msg = "\n".join(lines)
        send_telegram(msg)

        output_sum = f"ALERT: {len(zero_stock)} ingredientes en cero, {len(affected)} platillos 86'd"
        print(f"[auto86] {output_sum}")

        # 5. Save to agent_results for dashboard
        today_str = now_mx.strftime("%Y-%m-%d")
        sb_upsert("agent_results", {
            "agent_id": "auto86",
            "fecha": today_str,
            "priority": "critical" if len(zero_stock) >= 3 else "warning",
            "summary": output_sum,
            "data": json.dumps({
                "zero_stock": zero_stock,
                "affected_items": {k: list(v) for k, v in affected.items()},
                "total_critical": len(critical),
                "total_zero": len(zero_stock),
                "total_affected": len(affected),
            }),
        })

        # 6. Create insight for 86'd items
        create_insight(
            agent_id="auto86",
            category="inventory",
            severity="critical" if len(zero_stock) >= 3 else "high",
            title=f"86'd Alert: {len(zero_stock)} ingredientes en cero",
            summary=f"{len(zero_stock)} ingredientes sin stock — {len(affected)} platillos afectados",
            evidence={
                "zero_stock_items": [c["name"] for c in zero_stock[:10]],
                "affected_items": list(affected.keys())[:10],
                "total_critical": len(critical),
            },
            recommended_action="Reabastecer urgente o desactivar platillos del menú",
            data_freshness=today_str,
        )

except Exception as e:
    status = "error"
    error_msg = str(e)
    output_sum = f"ERROR: {e}"
    print(f"[auto86] {output_sum}", file=sys.stderr)

# Log to agent_runs
duration_ms = int((time.time() - start_time) * 1000)
_log_run(
    agent_id="auto86",
    status=status,
    duration_ms=duration_ms,
    output_summary=output_sum,
    error_message=error_msg or "",
    tentacle="ops",
    rows_processed=len(inventory) if "inventory" in locals() else 0,
    data_status="error" if status == "error" else "ok",
)
print(f"[auto86] Logged. Done in {duration_ms}ms.")
