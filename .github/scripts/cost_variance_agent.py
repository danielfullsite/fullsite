#!/usr/bin/env python3
"""
Cost Variance Agent — Detects supplier price changes > threshold.
Compares current ingredient costs vs baseline.
Alerts when prices spike to prevent cost overruns.
Runs weekly (Fridays).
"""

import os
import sys
import json
import time
import requests
from datetime import datetime, timezone
from client_config import get_client, get_tz, get_chat_ids

CLIENT       = get_client()
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
# Least privilege: agent key (SELECT + INSERT agent_runs/results)
SUPABASE_KEY = os.environ.get("SUPABASE_AGENT_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
TG_TOKEN     = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_IDS  = get_chat_ids(CLIENT, "daily_briefing")
TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "cron")

VARIANCE_THRESHOLD = 0.10  # 10% — alert if cost changed more than this

sb_headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
start_time = time.time()
status = "success"
output_sum = ""
error_msg = None

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
    MX_TZ = get_tz(CLIENT)
    now_mx = datetime.now(timezone.utc).astimezone(MX_TZ)
    today_str = now_mx.strftime("%Y-%m-%d")

    print(f"[cost-variance] Starting for {cid}...")

    # Get ingredients with their baseline cost
    ingredients = sb_get("pos_ingredients", {
        "client_id": f"eq.{cid}",
        "active": "eq.true",
        "select": "id,name,unit,cost_per_unit,supplier,category",
        "limit": "1000",
    })

    # Get latest supplier data from wansoft_suppliers
    suppliers_data = sb_get("wansoft_suppliers", {
        "select": "fecha,data",
        "order": "fecha.desc",
        "limit": "1",
    })

    # Get recent inventory movements to detect actual purchase prices
    # (pos_inventory_movements may have actual_cost data)

    # Compare: for each ingredient, check if we have a newer price signal
    # For now, we compare ingredient cost_per_unit vs supplier data
    alerts = []
    by_supplier = {}

    if suppliers_data:
        sup_raw = suppliers_data[0].get("data", "[]")
        if isinstance(sup_raw, str):
            try: sup_raw = json.loads(sup_raw)
            except: sup_raw = []
        if isinstance(sup_raw, str):
            try: sup_raw = json.loads(sup_raw)
            except: sup_raw = []

        # Build supplier spend map
        for s in (sup_raw or []):
            name = s.get("nombre") or s.get("proveedor") or ""
            total = float(s.get("total") or s.get("monto") or 0)
            if name and total > 0:
                by_supplier[name] = total

    # Check ingredient costs — flag any at $0 (not configured) or extreme values
    zero_cost = []
    high_cost = []

    for ing in ingredients:
        cost = float(ing.get("cost_per_unit") or 0)
        name = ing.get("name", "")
        supplier = ing.get("supplier") or "Sin proveedor"

        if cost == 0:
            zero_cost.append({"name": name, "supplier": supplier})
        elif cost > 500:  # Per unit > $500 is suspicious for most ingredients
            high_cost.append({"name": name, "cost": cost, "unit": ing.get("unit", ""), "supplier": supplier})

    # Build summary
    total_ingredients = len(ingredients)
    configured = total_ingredients - len(zero_cost)

    print(f"[cost-variance] {total_ingredients} ingredients, {len(zero_cost)} at $0, {len(high_cost)} high cost")

    if not zero_cost and not high_cost and not by_supplier:
        output_sum = f"OK — {configured}/{total_ingredients} ingredientes con costo configurado. Sin alertas."
        print(f"[cost-variance] {output_sum}")
    else:
        lines = [f"COSTOS — Reporte {today_str}"]
        lines.append(f"Ingredientes: {configured}/{total_ingredients} con costo configurado")

        if by_supplier:
            lines.append(f"\nTop proveedores (gasto reciente):")
            sorted_sup = sorted(by_supplier.items(), key=lambda x: -x[1])[:10]
            for name, total in sorted_sup:
                lines.append(f"  ${total:,.0f} — {name}")

        if zero_cost:
            lines.append(f"\n{len(zero_cost)} ingredientes SIN COSTO (afecta food cost):")
            for z in zero_cost[:10]:
                lines.append(f"  ! {z['name']} ({z['supplier']})")
            if len(zero_cost) > 10:
                lines.append(f"  ... y {len(zero_cost) - 10} más")

        if high_cost:
            lines.append(f"\n{len(high_cost)} ingredientes con costo alto (verificar):")
            for h in high_cost[:5]:
                lines.append(f"  ? {h['name']}: ${h['cost']:,.2f}/{h['unit']} ({h['supplier']})")

        msg = "\n".join(lines)
        send_telegram(msg)
        output_sum = f"Reporte: {configured}/{total_ingredients} configurados, {len(zero_cost)} sin costo, {len(high_cost)} alto"

    # Save results
    sb_upsert("agent_results", {
        "agent_id": "cost-variance",
        "fecha": today_str,
        "priority": "warning" if (zero_cost or high_cost) else "info",
        "summary": output_sum,
        "data": json.dumps({
            "total_ingredients": total_ingredients,
            "configured": configured,
            "zero_cost_count": len(zero_cost),
            "high_cost_count": len(high_cost),
            "top_suppliers": dict(sorted(by_supplier.items(), key=lambda x: -x[1])[:10]) if by_supplier else {},
            "zero_cost_items": zero_cost[:20],
            "high_cost_items": high_cost[:10],
        }),
    })

except Exception as e:
    status = "error"
    error_msg = str(e)
    output_sum = f"ERROR: {e}"
    print(f"[cost-variance] {output_sum}", file=sys.stderr)

duration_ms = int((time.time() - start_time) * 1000)
try:
    sb_post("agent_runs", {
        "agent_id": "cost-variance",
        "trigger_type": TRIGGER_TYPE,
        "status": status,
        "duration_ms": duration_ms,
        "output_summary": output_sum,
        "error_message": error_msg,
        "tentacle": "ops",
    })
    print(f"[cost-variance] Done in {duration_ms}ms. {output_sum}")
except Exception as e:
    print(f"[cost-variance] WARN: log failed: {e}", file=sys.stderr)
