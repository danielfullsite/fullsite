#!/usr/bin/env python3
"""
Stock Alert Agent — Checks inventory levels against reorder minimums.
Alerts on Telegram when products are critically low or out of stock.
Silent when everything is OK.

Data sources:
  - wansoft_data.inventory_parsed: current inventory levels
  - wansoft_data.reorder_config: min/max reorder points per product
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

# ── Config ──────────────────────────────────────────────────────────────────
CLIENT       = get_client()
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TG_TOKEN     = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TG_CHAT_IDS  = get_chat_ids(CLIENT, "daily_briefing")
TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "cron")

MX_TZ = get_tz(CLIENT)
sb_headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}

start_time = time.time()
status     = "success"
output_sum = ""
error_msg  = None

# ── Helpers ─────────────────────────────────────────────────────────────────

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
    headers_upsert = {**sb_headers, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"}
    r = requests.post(f"{SUPABASE_URL}/rest/v1/{table}", headers=headers_upsert, json=data, timeout=15)
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
                json={"chat_id": chat_id, "text": chunk, "parse_mode": "Markdown"}, timeout=15)

def deep_parse(val):
    """Parse potentially double-escaped JSON strings until we get the actual data."""
    if isinstance(val, str):
        try:
            return deep_parse(json.loads(val))
        except (json.JSONDecodeError, TypeError):
            return val
    return val

# ── Main ────────────────────────────────────────────────────────────────────

try:
    cid = CLIENT["id"]
    now_mx = datetime.now(timezone.utc).astimezone(MX_TZ)
    today_str = now_mx.strftime("%Y-%m-%d")

    print(f"[stock-alert] Checking inventory for {cid} on {today_str}...")

    # 1. Fetch inventory_parsed from wansoft_data
    inv_rows = sb_get("wansoft_data", {
        "client_id": f"eq.{cid}",
        "data_key": "eq.inventory_parsed",
        "select": "data",
        "order": "updated_at.desc",
        "limit": "1",
    })

    if not inv_rows or not inv_rows[0].get("data"):
        raise ValueError("No inventory_parsed data found in wansoft_data")

    inventory_raw = deep_parse(inv_rows[0]["data"])
    if not isinstance(inventory_raw, list):
        raise ValueError(f"inventory_parsed is not a list, got {type(inventory_raw).__name__}")

    print(f"[stock-alert] Loaded {len(inventory_raw)} inventory items")

    # 2. Fetch reorder_config from wansoft_data
    reorder_rows = sb_get("wansoft_data", {
        "client_id": f"eq.{cid}",
        "data_key": "eq.reorder_points",
        "select": "data",
        "order": "updated_at.desc",
        "limit": "1",
    })

    reorder_config = []
    if reorder_rows and reorder_rows[0].get("data"):
        reorder_config = deep_parse(reorder_rows[0]["data"])
        if not isinstance(reorder_config, list):
            reorder_config = []

    print(f"[stock-alert] Loaded {len(reorder_config)} reorder config entries")

    # Build reorder lookup: key = (codigo, almacen) or just codigo
    reorder_map = {}
    for rc in reorder_config:
        codigo = (rc.get("codigo") or "").strip()
        almacen = (rc.get("almacen") or "").strip().lower()
        minimo = float(rc.get("minimo") or 0)
        maximo = float(rc.get("maximo") or 0)
        if codigo and minimo > 0:
            reorder_map[(codigo, almacen)] = {"minimo": minimo, "maximo": maximo}
            # Also store by codigo alone as fallback
            if codigo not in reorder_map:
                reorder_map[codigo] = {"minimo": minimo, "maximo": maximo}

    # 3. Aggregate stock by product (same product across almacenes = 1 product)
    product_agg = {}  # codigo → {producto, total_qty, almacenes, es_critico, minimo}
    for item in inventory_raw:
        codigo = (item.get("codigo") or "").strip()
        producto = (item.get("producto") or "").strip()
        almacen = (item.get("almacen") or "").strip()
        almacen_lower = almacen.lower()
        qty = float(item.get("inv_final_qty") or 0)
        es_critico = bool(item.get("critico"))

        rc = reorder_map.get((codigo, almacen_lower)) or reorder_map.get(codigo)
        minimo = rc["minimo"] if rc else 0

        if codigo not in product_agg:
            product_agg[codigo] = {
                "producto": producto or codigo,
                "codigo": codigo,
                "total_qty": 0,
                "almacenes": [],
                "es_critico": es_critico,
                "minimo": minimo,
            }
        product_agg[codigo]["total_qty"] += qty
        if almacen:
            product_agg[codigo]["almacenes"].append(almacen)
        if minimo > product_agg[codigo]["minimo"]:
            product_agg[codigo]["minimo"] = minimo
        if es_critico:
            product_agg[codigo]["es_critico"] = True

    # 4. Check aggregated products against reorder points
    sin_stock = []   # qty == 0
    critico = []     # qty > 0 but < minimo/2
    bajo_minimo = [] # qty > 0, >= minimo/2 but < minimo

    for codigo, agg in product_agg.items():
        qty = agg["total_qty"]
        minimo = agg["minimo"]

        entry = {
            "producto": agg["producto"],
            "almacen": ", ".join(sorted(set(agg["almacenes"]))),
            "qty": round(qty, 2),
            "minimo": minimo,
            "codigo": codigo,
        }

        if qty == 0 and agg["es_critico"]:
            sin_stock.append(entry)
            continue

        if minimo > 0:
            if qty == 0:
                sin_stock.append(entry)
            elif qty < minimo / 2:
                critico.append(entry)
            elif qty < minimo:
                bajo_minimo.append(entry)

    # Sort each group by product name
    sin_stock.sort(key=lambda x: x["producto"])
    critico.sort(key=lambda x: x["producto"])
    bajo_minimo.sort(key=lambda x: x["producto"])

    total_alerts = len(sin_stock) + len(critico) + len(bajo_minimo)
    all_almacenes = set()
    for lst in [sin_stock, critico, bajo_minimo]:
        for item in lst:
            if item["almacen"]:
                all_almacenes.add(item["almacen"])

    print(f"[stock-alert] Alerts: {len(sin_stock)} sin stock, {len(critico)} critico, {len(bajo_minimo)} bajo minimo")

    # 4. If no alerts, stay silent
    if total_alerts == 0:
        output_sum = f"OK — inventario dentro de limites ({len(inventory_raw)} items revisados)"
        print(f"[stock-alert] {output_sum}")
    else:
        # 5. Build Telegram message
        lines = [f"\U0001F6A8 *Alerta de Inventario — {today_str}*\n"]

        if sin_stock:
            lines.append(f"*\U0001F534 SIN STOCK ({len(sin_stock)} items):*")
            for item in sin_stock[:20]:
                lines.append(f"\u2022 {item['producto']} ({item['almacen']}) \u2014 0 unidades")
            if len(sin_stock) > 20:
                lines.append(f"  _... y {len(sin_stock) - 20} mas_")
            lines.append("")

        if critico:
            lines.append(f"*\U0001F7E0 CRITICO ({len(critico)} items):*")
            for item in critico[:20]:
                lines.append(f"\u2022 {item['producto']} ({item['almacen']}) \u2014 {item['qty']:g} / min {item['minimo']:g}")
            if len(critico) > 20:
                lines.append(f"  _... y {len(critico) - 20} mas_")
            lines.append("")

        if bajo_minimo:
            lines.append(f"*\U0001F7E1 BAJO MINIMO ({len(bajo_minimo)} items):*")
            for item in bajo_minimo[:20]:
                lines.append(f"\u2022 {item['producto']} ({item['almacen']}) \u2014 {item['qty']:g} / min {item['minimo']:g}")
            if len(bajo_minimo) > 20:
                lines.append(f"  _... y {len(bajo_minimo) - 20} mas_")
            lines.append("")

        lines.append(f"\U0001F4CA Total alertas: {total_alerts} | Almacenes afectados: {len(all_almacenes)}")

        msg = "\n".join(lines)
        send_telegram(msg)
        output_sum = f"ALERTAS: {len(sin_stock)} sin stock, {len(critico)} critico, {len(bajo_minimo)} bajo minimo"

    # 6. Save to agent_results
    sb_upsert("agent_results", {
        "agent_id": "stock-alert",
        "fecha": today_str,
        "priority": "critical" if sin_stock else ("warning" if critico or bajo_minimo else "info"),
        "summary": output_sum,
        "data": json.dumps({
            "inventory_items_checked": len(inventory_raw),
            "reorder_configs": len(reorder_config),
            "sin_stock": len(sin_stock),
            "critico": len(critico),
            "bajo_minimo": len(bajo_minimo),
            "total_alerts": total_alerts,
            "almacenes_afectados": list(all_almacenes),
            "sin_stock_items": sin_stock[:10],
            "critico_items": critico[:10],
            "bajo_minimo_items": bajo_minimo[:10],
        }),
    })

    # 7. Create insights for critical/low stock
    if sin_stock:
        create_insight(
            agent_id="stock-alert",
            category="inventory",
            severity="critical",
            title=f"Sin stock: {len(sin_stock)} items",
            summary=f"{len(sin_stock)} productos sin existencias en {today_str}",
            evidence={"sin_stock_items": sin_stock[:10], "almacenes": list(all_almacenes)},
            recommended_action="Reabastecer o desactivar del menú de inmediato",
        )
    if critico:
        create_insight(
            agent_id="stock-alert",
            category="inventory",
            severity="high",
            title=f"Stock crítico: {len(critico)} items",
            summary=f"{len(critico)} productos por debajo de la mitad del mínimo",
            evidence={"critico_items": critico[:10]},
            recommended_action="Ordenar reabastecimiento urgente",
        )

except SystemExit:
    pass
except Exception as e:
    status = "error"
    error_msg = str(e)
    output_sum = f"ERROR: {e}"
    print(f"[stock-alert] {output_sum}", file=sys.stderr)

# Log to agent_runs
duration_ms = int((time.time() - start_time) * 1000)
_log_run(
    agent_id="stock-alert",
    status=status,
    duration_ms=duration_ms,
    output_summary=output_sum,
    error_message=error_msg or "",
    tentacle="ops",
    rows_processed=len(inv_rows) if "inv_rows" in locals() else 0,
    data_status="error" if status == "error" else "ok",
)
print(f"[stock-alert] Done in {duration_ms}ms. {output_sum}")
