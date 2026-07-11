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
sys.path.insert(0, os.path.dirname(__file__))
from client_config import get_client, get_tz, get_chat_ids
from agent_common import log_run as _log_run, create_insight
try:
    from audit_log import AuditLogger
    _audit = AuditLogger("cost_variance_agent")
except ImportError:
    _audit = None
CLIENT       = get_client()
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
# Least privilege: agent key (SELECT + INSERT agent_runs/results)
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TG_TOKEN     = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_IDS  = get_chat_ids(CLIENT, "daily_briefing")
TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "cron")

VARIANCE_THRESHOLD = 0.10  # 10% — alert if cost changed more than this

sb_headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
start_time = time.time()
if _audit: _audit.log_start()
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
        # Handle triple-encoded JSON (string → string → list/dict)
        for _ in range(3):
            if isinstance(sup_raw, str):
                try: sup_raw = json.loads(sup_raw)
                except: break
        # Could be {"Result": [...]} or [...]
        if isinstance(sup_raw, dict):
            sup_raw = sup_raw.get("Result", [])
        if not isinstance(sup_raw, list):
            sup_raw = []

        # Build supplier spend map
        for s in sup_raw:
            if not isinstance(s, dict):
                continue
            name = s.get("SupplierName") or s.get("nombre") or s.get("proveedor") or ""
            total = float(s.get("Amount") or s.get("total") or s.get("monto") or 0)
            if name and total > 0:
                by_supplier[name] = by_supplier.get(name, 0) + total

    # Get last week's cost snapshot from agent_results for comparison
    prev_results = sb_get("agent_results", {
        "agent_id": "eq.cost-variance",
        "order": "fecha.desc",
        "limit": "1",
        "select": "data",
    })
    prev_costs = {}
    if prev_results and prev_results[0].get("data"):
        prev_data = prev_results[0]["data"]
        if isinstance(prev_data, str):
            try: prev_data = json.loads(prev_data)
            except: prev_data = {}
        if isinstance(prev_data, str):
            try: prev_data = json.loads(prev_data)
            except: prev_data = {}
        if not isinstance(prev_data, dict):
            prev_data = {}
        # Build map from previous ingredient snapshot
        for item in prev_data.get("ingredient_snapshot", []):
            prev_costs[item["id"]] = float(item.get("cost", 0))

    # Check ingredient costs — flag $0, high cost, and COST CHANGES vs last run
    zero_cost = []
    high_cost = []
    cost_changes = []

    for ing in ingredients:
        cost = float(ing.get("cost_per_unit") or 0)
        name = ing.get("name", "")
        supplier = ing.get("supplier") or "Sin proveedor"
        ing_id = ing.get("id", "")

        if cost == 0:
            zero_cost.append({"name": name, "supplier": supplier})
        elif cost > 500:  # Per unit > $500 is suspicious
            high_cost.append({"name": name, "cost": cost, "unit": ing.get("unit", ""), "supplier": supplier})

        # Compare vs previous snapshot
        if ing_id in prev_costs and prev_costs[ing_id] > 0 and cost > 0:
            prev = prev_costs[ing_id]
            pct = ((cost - prev) / prev) * 100
            if abs(pct) >= VARIANCE_THRESHOLD * 100:
                cost_changes.append({
                    "name": name,
                    "prev": prev,
                    "current": cost,
                    "unit": ing.get("unit", ""),
                    "pct": round(pct, 1),
                    "supplier": supplier,
                })

    # Build summary
    total_ingredients = len(ingredients)
    configured = total_ingredients - len(zero_cost)

    # Sort cost changes by absolute % change
    cost_changes.sort(key=lambda x: abs(x["pct"]), reverse=True)

    print(f"[cost-variance] {total_ingredients} ingredients, {len(zero_cost)} at $0, {len(high_cost)} high cost, {len(cost_changes)} price changes")

    if not zero_cost and not high_cost and not by_supplier and not cost_changes:
        output_sum = f"OK — {configured}/{total_ingredients} ingredientes con costo configurado. Sin alertas."
        print(f"[cost-variance] {output_sum}")
    else:
        lines = [f"COSTOS — Reporte {today_str}"]
        lines.append(f"Ingredientes: {configured}/{total_ingredients} con costo configurado")

        # COST CHANGES — Eduardo's #1 request
        if cost_changes:
            increases = [c for c in cost_changes if c["pct"] > 0]
            decreases = [c for c in cost_changes if c["pct"] < 0]
            if increases:
                lines.append(f"\nSUBIERON DE PRECIO ({len(increases)}):")
                for c in increases[:8]:
                    lines.append(f"  {c['name']}: ${c['prev']:.0f} -> ${c['current']:.0f}/{c['unit']} (+{c['pct']}%) [{c['supplier']}]")
            if decreases:
                lines.append(f"\nBAJARON DE PRECIO ({len(decreases)}):")
                for c in decreases[:5]:
                    lines.append(f"  {c['name']}: ${c['prev']:.0f} -> ${c['current']:.0f}/{c['unit']} ({c['pct']}%)")

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
                lines.append(f"  ... y {len(zero_cost) - 10} mas")

        if high_cost:
            lines.append(f"\n{len(high_cost)} ingredientes con costo alto (verificar):")
            for h in high_cost[:5]:
                lines.append(f"  ? {h['name']}: ${h['cost']:,.2f}/{h['unit']} ({h['supplier']})")

        msg = "\n".join(lines)
        send_telegram(msg)
        output_sum = f"Reporte: {configured}/{total_ingredients} configurados, {len(cost_changes)} cambios, {len(zero_cost)} sin costo"

    # Save results + ingredient snapshot for next comparison
    ingredient_snapshot = [
        {"id": ing["id"], "name": ing["name"], "cost": float(ing.get("cost_per_unit") or 0)}
        for ing in ingredients if float(ing.get("cost_per_unit") or 0) > 0
    ]
    sb_upsert("agent_results", {
        "agent_id": "cost-variance",
        "fecha": today_str,
        "priority": "critical" if cost_changes else ("warning" if (zero_cost or high_cost) else "info"),
        "summary": output_sum,
        "data": json.dumps({
            "total_ingredients": total_ingredients,
            "configured": configured,
            "zero_cost_count": len(zero_cost),
            "high_cost_count": len(high_cost),
            "cost_changes": cost_changes[:20],
            "top_suppliers": dict(sorted(by_supplier.items(), key=lambda x: -x[1])[:10]) if by_supplier else {},
            "zero_cost_items": zero_cost[:20],
            "high_cost_items": high_cost[:10],
            "ingredient_snapshot": ingredient_snapshot,
        }),
    })

except Exception as e:
    status = "error"
    error_msg = str(e)
    output_sum = f"ERROR: {e}"
    print(f"[cost-variance] {output_sum}", file=sys.stderr)

duration_ms = int((time.time() - start_time) * 1000)
_log_run(
    agent_id="cost-variance",
    status=status,
    duration_ms=duration_ms,
    output_summary=output_sum,
    error_message=error_msg or "",
    tentacle="ops",
    rows_processed=len(ingredients) if 'ingredients' in dir() else 0,
    data_status="error" if status == "error" else "ok",
)
print(f"[cost-variance] Done in {duration_ms}ms. {output_sum}")
