#!/usr/bin/env python3
"""
Supplier Monitor Agent — Multi-tenant
Analiza proveedores, cambios de precio, concentración de riesgo.
Corre los miércoles a las 9am MX.
"""

import os
import sys
import json
import time
import requests
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from client_config import get_client, get_tz, get_chat_ids

# ── Config ──────────────────────────────────────────────────────────────────
CLIENT = get_client()
MX_TZ = get_tz(CLIENT)
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TG_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_IDS = get_chat_ids(CLIENT, "intraday")
TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "cron")

sb_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}

# Thresholds
PRICE_CHANGE_THRESHOLD = 0.05   # 5% price change is notable
CONCENTRATION_THRESHOLD = 0.40  # 40%+ from one vendor = risk


# ── Supabase helpers ────────────────────────────────────────────────────────
def sb_get(table, params):
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=sb_headers,
        params=params,
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


# ── Data fetching ───────────────────────────────────────────────────────────
def get_supplier_data():
    """Fetch last 2 supplier entries (to compare periods)."""
    try:
        return sb_get("wansoft_suppliers", {
            "select": "*",
            "order": "created_at.desc",
            "limit": "2",
        })
    except Exception as e:
        print(f"[supplier] Error fetching wansoft_suppliers: {e}")
        return []


def get_food_cost_data():
    """Fetch food cost data for consumption analysis."""
    try:
        return sb_get("wansoft_food_cost", {
            "select": "*",
            "order": "created_at.desc",
            "limit": "2",
        })
    except:
        return []


def get_purchase_data():
    """Fetch purchase/compras data if available."""
    try:
        return sb_get("wansoft_purchases", {
            "select": "*",
            "order": "created_at.desc",
            "limit": "2",
        })
    except:
        return []


# ── Analysis ────────────────────────────────────────────────────────────────
def analyze_price_changes(current, previous):
    """Compare prices between two periods."""
    changes = []

    curr_items = current.get("items") or current.get("products") or []
    prev_items = previous.get("items") or previous.get("products") or []

    if isinstance(curr_items, str):
        curr_items = json.loads(curr_items)
    if isinstance(prev_items, str):
        prev_items = json.loads(prev_items)

    # Build lookup for previous prices
    prev_prices = {}
    for item in prev_items:
        name = item.get("nombre", item.get("product", item.get("name", ""))).strip()
        price = float(item.get("precio", item.get("price", item.get("costo", 0))) or 0)
        if name and price > 0:
            prev_prices[name.upper()] = price

    # Compare
    for item in curr_items:
        name = item.get("nombre", item.get("product", item.get("name", ""))).strip()
        price = float(item.get("precio", item.get("price", item.get("costo", 0))) or 0)
        if not name or price <= 0:
            continue

        name_upper = name.upper()
        if name_upper in prev_prices:
            old_price = prev_prices[name_upper]
            if old_price > 0:
                pct_change = (price - old_price) / old_price
                if abs(pct_change) >= PRICE_CHANGE_THRESHOLD:
                    changes.append({
                        "product": name,
                        "old_price": old_price,
                        "new_price": price,
                        "pct_change": pct_change,
                        "direction": "subió" if pct_change > 0 else "bajó",
                    })

    return sorted(changes, key=lambda x: abs(x["pct_change"]), reverse=True)


def analyze_vendor_concentration(data):
    """Analyze vendor concentration risk."""
    vendors = defaultdict(float)

    items = data.get("items") or data.get("products") or data.get("vendors") or []
    if isinstance(items, str):
        items = json.loads(items)

    # Try to extract vendor info
    for item in items:
        vendor = item.get("proveedor", item.get("vendor", item.get("supplier", "Desconocido"))).strip()
        amount = float(item.get("total", item.get("monto", item.get("amount", 0))) or 0)
        if vendor and amount > 0:
            vendors[vendor] += amount

    if not vendors:
        return []

    total = sum(vendors.values())
    concentration = []
    for vendor, amount in sorted(vendors.items(), key=lambda x: x[1], reverse=True):
        pct = amount / total if total > 0 else 0
        concentration.append({
            "vendor": vendor,
            "total": round(amount),
            "pct": pct,
            "is_risky": pct >= CONCENTRATION_THRESHOLD,
        })

    return concentration


def analyze_consumption_vs_purchases(food_cost, purchases):
    """Detect over-purchasing (buying more than consuming)."""
    alerts = []

    if not food_cost or not purchases:
        return alerts

    fc_items = food_cost.get("items") or food_cost.get("categories") or []
    pu_items = purchases.get("items") or purchases.get("products") or []

    if isinstance(fc_items, str):
        fc_items = json.loads(fc_items)
    if isinstance(pu_items, str):
        pu_items = json.loads(pu_items)

    # Build consumption lookup
    consumption = {}
    for item in fc_items:
        name = item.get("nombre", item.get("product", "")).strip().upper()
        consumed = float(item.get("consumo", item.get("consumed", item.get("used", 0))) or 0)
        if name and consumed > 0:
            consumption[name] = consumed

    # Compare with purchases
    for item in pu_items:
        name = item.get("nombre", item.get("product", "")).strip().upper()
        purchased = float(item.get("cantidad", item.get("quantity", item.get("purchased", 0))) or 0)
        if name and purchased > 0 and name in consumption:
            ratio = purchased / consumption[name] if consumption[name] > 0 else 0
            if ratio > 1.20:  # Buying 20% more than using
                alerts.append({
                    "product": name.title(),
                    "purchased": purchased,
                    "consumed": consumption[name],
                    "excess_pct": round((ratio - 1) * 100),
                })

    return sorted(alerts, key=lambda x: x["excess_pct"], reverse=True)[:5]


# ── Build Message ───────────────────────────────────────────────────────────
def build_message(price_changes, concentration, consumption_alerts, has_data):
    now_mx = datetime.now(MX_TZ)

    msg = f"🏭 MONITOR DE PROVEEDORES — {now_mx.strftime('%d/%m/%Y')}\n\n"

    if not has_data:
        msg += "⚠️ No se encontraron datos de proveedores en Supabase.\n"
        msg += "Verifica que las tablas wansoft_suppliers / wansoft_food_cost existan.\n"
        return msg

    # Price changes
    if price_changes:
        msg += "💲 CAMBIOS DE PRECIO:\n"
        for pc in price_changes[:8]:
            emoji = "🔴" if pc["pct_change"] > 0.10 else "🟡" if pc["pct_change"] > 0 else "🟢"
            msg += f"  {emoji} {pc['product']}: ${pc['old_price']:,.2f} → ${pc['new_price']:,.2f} ({pc['direction']} {abs(pc['pct_change'])*100:.0f}%)\n"
        msg += "\n"
    else:
        msg += "💲 Sin cambios significativos de precio.\n\n"

    # Vendor concentration
    if concentration:
        risky = [v for v in concentration if v["is_risky"]]
        msg += "🏢 CONCENTRACIÓN DE PROVEEDORES:\n"
        for v in concentration[:5]:
            bar = "🔴" if v["is_risky"] else "🟢"
            msg += f"  {bar} {v['vendor']}: ${v['total']:,} ({v['pct']*100:.0f}%)\n"

        if risky:
            msg += f"\n  ⚠️ RIESGO: {len(risky)} proveedor(es) con más del {CONCENTRATION_THRESHOLD*100:.0f}% de las compras.\n"
            msg += "  Si te falla, no tienes alternativa.\n"
        msg += "\n"

    # Consumption alerts
    if consumption_alerts:
        msg += "📦 SOBRE-COMPRA DETECTADA:\n"
        for ca in consumption_alerts:
            msg += f"  ⚠️ {ca['product']}: comprando {ca['excess_pct']}% más de lo que se consume\n"
        msg += "\n"

    # Recommendations
    recs = []
    if price_changes:
        increases = [pc for pc in price_changes if pc["pct_change"] > 0.10]
        if increases:
            products = ", ".join(pc["product"] for pc in increases[:3])
            recs.append(f"Cotizar con otros proveedores: {products}")

    risky_vendors = [v for v in concentration if v["is_risky"]]
    if risky_vendors:
        recs.append("Diversificar proveedores — buscar alternativas para reducir dependencia")

    if consumption_alerts:
        recs.append("Ajustar cantidades de compra para reducir merma")

    if recs:
        msg += "💡 ACCIONES:\n"
        for rec in recs:
            msg += f"  • {rec}\n"

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
    now_mx = datetime.now(MX_TZ)

    print(f"[supplier] Starting for {CLIENT['id']}")

    # 1. Fetch data
    print("[supplier] Fetching supplier data...")
    supplier_data = get_supplier_data()
    food_cost_data = get_food_cost_data()
    purchase_data = get_purchase_data()

    has_data = bool(supplier_data) or bool(food_cost_data) or bool(purchase_data)
    print(f"[supplier] Data: suppliers={len(supplier_data)}, food_cost={len(food_cost_data)}, purchases={len(purchase_data)}")

    # 2. Analyze
    price_changes = []
    concentration = []
    consumption_alerts = []

    if len(supplier_data) >= 2:
        price_changes = analyze_price_changes(supplier_data[0], supplier_data[1])
        print(f"[supplier] Price changes: {len(price_changes)}")

    if supplier_data:
        concentration = analyze_vendor_concentration(supplier_data[0])
        print(f"[supplier] Vendors: {len(concentration)}")

    if food_cost_data and purchase_data:
        consumption_alerts = analyze_consumption_vs_purchases(
            food_cost_data[0] if food_cost_data else {},
            purchase_data[0] if purchase_data else {},
        )
        print(f"[supplier] Consumption alerts: {len(consumption_alerts)}")

    # 3. Build and send
    # Only send if there's something to report
    if not has_data and not price_changes and not concentration and not consumption_alerts:
        print("[supplier] No data available, skipping message")
        elapsed = int((time.time() - start) * 1000)
    else:
        msg = build_message(price_changes, concentration, consumption_alerts, has_data)
        print(f"\n{msg}")
        sent = send_telegram(msg)
        elapsed = int((time.time() - start) * 1000)
        print(f"[supplier] Sent to {sent} chats in {elapsed}ms")

    # 4. Log
    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_runs",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
            json={
                "agent_id": "supplier-monitor",
                "trigger_type": TRIGGER_TYPE,
                "status": "success",
                "duration_ms": elapsed,
                "output_summary": f"price_changes: {len(price_changes)}, vendors: {len(concentration)}, over_purchase: {len(consumption_alerts)}",
                "tentacle": "ops",
            },
        )
    except:
        pass


if __name__ == "__main__":
    main()
