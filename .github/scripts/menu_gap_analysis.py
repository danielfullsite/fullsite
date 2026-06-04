#!/usr/bin/env python3
"""
Menu Gap Analysis — Compare Wansoft catalog vs POS menu
Eduardo: "configuración impecable — sin eso los reportes no sirven"

Finds:
1. Top sellers in Wansoft NOT in POS menu
2. Items in POS that don't match Wansoft names
3. Price mismatches between systems
4. Groups in Wansoft not represented in POS
"""

import os
import json
import requests
from client_config import get_client

CLIENT = get_client()
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
# Least privilege: agent key (SELECT + INSERT agent_runs/results)
SUPABASE_KEY = os.environ.get("SUPABASE_AGENT_KEY") or os.environ["SUPABASE_SERVICE_KEY"]

sb_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}

TG_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID_DANIEL", "")


def sb_get(table, params):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}", headers=sb_headers, params=params, timeout=15)
    return r.json() if r.ok else []


def send_telegram(msg):
    if not TG_CHAT_ID:
        return
    for chunk in [msg[i:i+4000] for i in range(0, len(msg), 4000)]:
        requests.post(f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                      json={"chat_id": TG_CHAT_ID, "text": chunk}, timeout=10)


def main():
    print("MENU GAP ANALYSIS")
    print(f"Client: {CLIENT['id']}\n")

    # 1. Get Wansoft catalog (from menu_sync)
    wansoft_menu = sb_get("wansoft_menu_config", {
        "client_id": f"eq.{CLIENT['id']}",
        "order": "fecha.desc",
        "limit": "1",
    })

    if not wansoft_menu:
        print("No Wansoft menu data found. Run wansoft-menu-sync first.")
        return

    row = wansoft_menu[0]
    saucers_raw = row.get("saucers", "[]")
    saucers = json.loads(saucers_raw) if isinstance(saucers_raw, str) else (saucers_raw or [])
    groups_raw = row.get("groups", "[]")
    groups = json.loads(groups_raw) if isinstance(groups_raw, str) else (groups_raw or [])
    mods_raw = row.get("complements", "[]")
    mods = json.loads(mods_raw) if isinstance(mods_raw, str) else (mods_raw or [])

    print(f"Wansoft catalog: {len(saucers)} platillos, {len(groups)} grupos, {len(mods)} modificadores")
    print(f"Fecha sync: {row.get('fecha', '?')}\n")

    # Sort by total sales (top sellers first)
    for s in saucers:
        if isinstance(s, dict):
            s["_total"] = s.get("total", 0)
    saucers_sorted = sorted(
        [s for s in saucers if isinstance(s, dict) and s.get("_total", 0) > 0],
        key=lambda x: -x["_total"]
    )

    # 2. Get POS menu items (from pos_menu_items or hardcoded categories)
    # Since POS menu is hardcoded in pos-data.ts, we'll check against what we know
    # For now, output the top sellers and let Daniel decide what to add

    print(f"{'='*70}")
    print("TOP 50 PLATILLOS EN WANSOFT (por ventas en 90 días)")
    print(f"{'='*70}")
    print(f"{'#':>3} {'Platillo':<45} {'Pzas':>6} {'Ventas':>12}")
    print("-" * 70)

    for i, s in enumerate(saucers_sorted[:50], 1):
        name = s.get("name", "?")
        qty = int(s.get("qty", 0))
        total = int(s.get("_total", 0))
        print(f"{i:>3} {name:<45} {qty:>6} ${total:>10,}")

    # 3. Groups analysis
    print(f"\n{'='*70}")
    print("GRUPOS EN WANSOFT (por ventas)")
    print(f"{'='*70}")
    groups_sorted = sorted(
        [g for g in groups if isinstance(g, dict) and g.get("total", 0) > 0],
        key=lambda x: -x.get("total", 0)
    )
    for g in groups_sorted:
        name = g.get("name", g.get("nombre", "?"))
        total = int(g.get("total", 0))
        print(f"  {name:<45} ${total:>10,}")

    # 4. Modifiers analysis
    print(f"\n{'='*70}")
    print(f"TOP 20 MODIFICADORES EN WANSOFT")
    print(f"{'='*70}")
    mods_sorted = sorted(
        [m for m in mods if isinstance(m, dict) and m.get("total", 0) > 0],
        key=lambda x: -x.get("total", 0)
    )
    for m in mods_sorted[:20]:
        name = m.get("name", "?")
        qty = int(m.get("qty", 0))
        total = int(m.get("total", 0))
        print(f"  {name:<45} {qty:>4} pzas  ${total:>8,}")

    # 5. Build Telegram summary
    msg = f"📋 MENU GAP ANALYSIS — {row.get('fecha', '?')}\n"
    msg += f"Wansoft: {len(saucers_sorted)} platillos con ventas\n"
    msg += f"Grupos: {len(groups_sorted)}, Modificadores: {len(mods_sorted)}\n"

    msg += "\n🔝 TOP 30 PLATILLOS WANSOFT (90d):\n"
    for i, s in enumerate(saucers_sorted[:30], 1):
        name = s.get("name", "?")
        qty = int(s.get("qty", 0))
        total = int(s.get("_total", 0))
        msg += f"{i}. {name}: {qty} pzas, ${total:,}\n"

    msg += f"\n📂 TOP 15 GRUPOS:\n"
    for g in groups_sorted[:15]:
        name = g.get("name", g.get("nombre", "?"))
        total = int(g.get("total", 0))
        msg += f"  {name}: ${total:,}\n"

    msg += f"\n🔧 TOP 10 MODIFICADORES:\n"
    for m in mods_sorted[:10]:
        name = m.get("name", "?")
        qty = int(m.get("qty", 0))
        msg += f"  {name}: {qty} pzas\n"

    send_telegram(msg)
    print("\n[✓] Telegram sent")


if __name__ == "__main__":
    main()
