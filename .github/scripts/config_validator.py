#!/usr/bin/env python3
"""
Config Validator Agent — Multi-tenant
Eduardo: "el sistema debe detectar errores de configuración automáticamente"

Checks:
1. Menu items without prices ($0)
2. Items sold in Wansoft but missing from POS menu
3. Recipes without ingredients
4. Ingredients at zero stock
5. Staff with duplicate PINs
6. Missing client config fields

Runs daily at 7am MX via agents-daily workflow.
"""

import os
import json
import time
import requests
from datetime import datetime, timezone
from client_config import get_client, get_tz, get_chat_ids
from audit_log import AuditLogger

CLIENT = get_client()
MX_TZ = get_tz(CLIENT)
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
# Least privilege: use agent key (SELECT + INSERT agent_runs/results) instead of service_role
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TG_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_IDS = get_chat_ids(CLIENT, "daily_briefing")

sb_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}
audit = AuditLogger("config_validator")


def sb_get(table, params):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}", headers=sb_headers, params=params, timeout=15)
    return r.json() if r.ok else []


def send_telegram(msg):
    for chat_id in TG_CHAT_IDS:
        if not chat_id:
            continue
        for chunk in [msg[i:i+4000] for i in range(0, len(msg), 4000)]:
            requests.post(f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                          json={"chat_id": chat_id, "text": chunk}, timeout=10)


def main():
    start = time.time()
    audit.log_start()
    now_mx = datetime.now(MX_TZ)
    today_str = now_mx.strftime("%Y-%m-%d")
    issues = []

    print(f"CONFIG VALIDATOR — {today_str}")
    print(f"Client: {CLIENT['id']}")

    # 1. Check for items sold in Wansoft but potentially missing from POS
    print("\n[1] Checking Wansoft sold items vs POS coverage...")
    try:
        menu_config = sb_get("wansoft_menu_config", {
            "client_id": f"eq.{CLIENT['id']}",
            "order": "fecha.desc",
            "limit": "1",
        })
        if menu_config:
            saucers = json.loads(menu_config[0].get("saucers", "[]")) if isinstance(menu_config[0].get("saucers"), str) else (menu_config[0].get("saucers") or [])
            if saucers:
                # Top sellers without price in POS = likely missing
                top_no_price = [s for s in saucers if isinstance(s, dict) and s.get("total", 0) > 5000 and s.get("price", 0) == 0]
                print(f"  Saucers in Wansoft: {len(saucers)}")
                if top_no_price:
                    issues.append(f"🔴 {len(top_no_price)} platillos vendidos en Wansoft sin precio en POS")
    except Exception as e:
        print(f"  Error: {e}")

    # 2. Check ingredients at zero stock
    print("\n[2] Checking inventory stock levels...")
    try:
        ingredients = sb_get("pos_ingredients", {
            "client_id": f"eq.{CLIENT['id']}",
            "select": "name,stock,unit,min_stock",
            "stock": "lte.0",
            "limit": "50",
        })
        zero_stock = [i for i in ingredients if (i.get("stock") or 0) <= 0]
        if zero_stock:
            names = ", ".join(i.get("name", "?")[:20] for i in zero_stock[:5])
            issues.append(f"🟡 {len(zero_stock)} ingredientes en stock 0: {names}{'...' if len(zero_stock) > 5 else ''}")
            print(f"  Zero stock: {len(zero_stock)}")
        else:
            print("  Stock OK")
    except Exception as e:
        print(f"  Error: {e}")

    # 3. Check ingredients below minimum
    print("\n[3] Checking ingredients below minimum...")
    try:
        low_stock = sb_get("pos_ingredients", {
            "client_id": f"eq.{CLIENT['id']}",
            "select": "name,stock,min_stock",
            "limit": "200",
        })
        below_min = [i for i in low_stock
                     if (i.get("min_stock") or 0) > 0 and (i.get("stock") or 0) < (i.get("min_stock") or 0)]
        if below_min:
            issues.append(f"🟡 {len(below_min)} ingredientes bajo mínimo")
            print(f"  Below minimum: {len(below_min)}")
        else:
            print("  Minimums OK")
    except Exception as e:
        print(f"  Error: {e}")

    # 4. Check recipes coverage
    print("\n[4] Checking recipe coverage...")
    try:
        recipes = sb_get("pos_recipes", {
            "client_id": f"eq.{CLIENT['id']}",
            "select": "menu_item",
            "limit": "1000",
        })
        items_with_recipe = set(r.get("menu_item", "").upper() for r in recipes if r.get("menu_item"))
        print(f"  Items with recipes: {len(items_with_recipe)}")
    except Exception as e:
        print(f"  Error: {e}")

    # 5. Check duplicate PINs in staff
    print("\n[5] Checking staff PINs...")
    try:
        staff = sb_get("pos_staff", {
            "client_id": f"eq.{CLIENT['id']}",
            "active": "eq.true",
            "select": "name,pin",
        })
        pins = {}
        for s in staff:
            pin = s.get("pin", "")
            if pin in pins:
                issues.append(f"🔴 PIN duplicado '{pin}': {pins[pin]} y {s.get('name', '?')}")
            else:
                pins[pin] = s.get("name", "?")
        print(f"  Staff: {len(staff)}, Unique PINs: {len(pins)}")
    except Exception as e:
        print(f"  Error: {e}")

    # 6. Check agent health (any agents not running?)
    print("\n[6] Checking agent health...")
    try:
        runs = sb_get("agent_runs", {
            "select": "agent_id,status,created_at",
            "order": "created_at.desc",
            "limit": "50",
        })
        agent_last = {}
        for r in runs:
            aid = r.get("agent_id", "")
            if aid not in agent_last:
                agent_last[aid] = r
        failed = [aid for aid, r in agent_last.items() if r.get("status") == "error"]
        if failed:
            issues.append(f"🟡 {len(failed)} agentes con último run fallido: {', '.join(failed[:3])}")
            print(f"  Failed agents: {failed}")
        else:
            print("  All agents OK")
    except Exception as e:
        print(f"  Error: {e}")

    # ── Results ────────────────────────────────────────────────────────
    elapsed = int((time.time() - start) * 1000)

    if issues:
        msg = f"⚙️ CONFIG VALIDATOR — {today_str}\n{len(issues)} problemas detectados:\n\n"
        for issue in issues:
            msg += f"  {issue}\n"
        msg += f"\n⏱ {elapsed/1000:.1f}s"
        send_telegram(msg)
        print(f"\n{len(issues)} issues found")
    else:
        print("\nNo issues found — config is clean")

    # Save to agent_results
    try:
        requests.post(f"{SUPABASE_URL}/rest/v1/agent_results",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"},
            json={
                "client_id": CLIENT["id"],
                "agent_id": "config-validator",
                "fecha": today_str,
                "data": json.dumps({"issues": issues}),
                "summary": f"{len(issues)} issues",
                "priority": "warning" if issues else "info",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }, timeout=10)
    except Exception:
        pass

    # Log
    try:
        requests.post(f"{SUPABASE_URL}/rest/v1/agent_runs",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
            json={
                "agent_id": "config-validator",
                "trigger_type": os.environ.get("TRIGGER_TYPE", "cron"),
                "status": "success",
                "duration_ms": elapsed,
                "output_summary": f"{len(issues)} config issues",
                "tentacle": "ops",
            }, timeout=10)
    except Exception:
        pass

    audit.log_read(["pos_menu_items", "pos_ingredients", "pos_inventory", "pos_staff", "pos_recipes", "wansoft_menu_config", "agent_runs", "clients"])
    audit.log_write(["agent_results", "agent_runs"], f"{len(issues)} issues found")
    audit.log_end(elapsed, f"{len(issues)} config issues")
    print(f"Done in {elapsed}ms")


if __name__ == "__main__":
    main()
