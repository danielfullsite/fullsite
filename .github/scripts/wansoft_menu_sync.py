#!/usr/bin/env python3
"""
Wansoft Menu Sync — Multi-tenant
Fetches menu config from Wansoft (groups, saucers, complements, prices)
and saves structured data to Supabase for POS sync.
Run on-demand or weekly via GitHub Actions.
"""

import os
import sys
import json
import time
import requests
from datetime import datetime, timezone
from client_config import get_client, get_tz, get_wansoft_creds

# ── Config ──────────────────────────────────────────────────────────────────
CLIENT = get_client()
SUBSIDIARY_ID, WANSOFT_USER, WANSOFT_PASS = get_wansoft_creds(CLIENT)
WANSOFT_URL = "https://www.wansoft.net/Wansoft.Web"

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TG_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_IDS = [os.environ.get("TELEGRAM_CHAT_ID_DANIEL", "")]
TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "cron")
MX_TZ = get_tz(CLIENT)

sb_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates,return=minimal",
}


# ── Wansoft ────────────────────────────────────────────────────────────────
def wansoft_session():
    s = requests.Session()
    s.get(f"{WANSOFT_URL}/")
    resp = s.post(f"{WANSOFT_URL}/", data={
        "UserName": WANSOFT_USER,
        "Password": WANSOFT_PASS,
    }, allow_redirects=True)
    if "Dashboard" not in resp.url:
        raise Exception(f"Wansoft login failed. URL: {resp.url}")
    print("[✓] Wansoft login OK")
    return s


def wansoft_post(session, path, params):
    """POST to Wansoft endpoint, return parsed response."""
    r = session.post(f"{WANSOFT_URL}/{path}", data=params, timeout=30)
    content_type = r.headers.get("Content-Type", "")
    if "json" in content_type:
        return r.json()
    return r.text


def sb_upsert(table, data):
    """Upsert to Supabase."""
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=sb_headers,
        json=data,
        timeout=15,
    )
    if not r.ok:
        print(f"  [!] Supabase upsert failed: {r.status_code} {r.text[:200]}")
    return r.ok


def send_telegram(msg):
    for chat_id in TG_CHAT_IDS:
        if not chat_id:
            continue
        chunks = [msg[i:i + 4000] for i in range(0, len(msg), 4000)]
        for chunk in chunks:
            requests.post(
                f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                json={"chat_id": chat_id, "text": chunk},
                timeout=10,
            )


# ── Main ────────────────────────────────────────────────────────────────────
def main():
    start = time.time()
    now_mx = datetime.now(MX_TZ)
    today_str = now_mx.strftime("%Y-%m-%d")

    print(f"{'='*60}")
    print(f"WANSOFT MENU SYNC — {today_str}")
    print(f"Client: {CLIENT['id']}, Subsidiary: {SUBSIDIARY_ID}")
    print(f"{'='*60}")

    session = wansoft_session()
    params = {"subsidiaryId": SUBSIDIARY_ID}
    results = {}

    # ── 1. Groups (categorías del menú) ─────────────────────────────────
    print("\n[1] Fetching menu groups...")
    try:
        groups_raw = wansoft_post(session, "Menu/GetGroupList", params)
        groups = []
        if isinstance(groups_raw, list):
            groups = groups_raw
        elif isinstance(groups_raw, str):
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(groups_raw, "html.parser")
            for row in soup.select(".rowReport, tr"):
                cols = [c.text.strip() for c in row.select("div, td")]
                if len(cols) >= 2:
                    groups.append({"name": cols[0], "id": cols[1] if len(cols) > 1 else ""})
        print(f"  Groups: {len(groups)}")
        results["groups"] = groups
    except Exception as e:
        print(f"  ERROR: {e}")
        results["groups"] = []

    # ── 2. Saucers (platillos con precios) ──────────────────────────────
    print("\n[2] Fetching saucers (platillos)...")
    try:
        saucers_raw = wansoft_post(session, "Menu/GetSaucerList", params)
        saucers = []
        if isinstance(saucers_raw, list):
            saucers = saucers_raw
        elif isinstance(saucers_raw, str):
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(saucers_raw, "html.parser")
            for row in soup.select(".rowReport, tr"):
                cols = [c.text.strip() for c in row.select("div, td")]
                if len(cols) >= 3:
                    try:
                        price = float(cols[2].replace("$", "").replace(",", "")) if cols[2] else 0
                    except (ValueError, IndexError):
                        price = 0
                    saucers.append({"name": cols[0], "group": cols[1] if len(cols) > 1 else "", "price": price})
        print(f"  Saucers: {len(saucers)}")
        results["saucers"] = saucers

        # Count items with price vs without
        with_price = sum(1 for s in saucers if isinstance(s, dict) and (s.get("price") or s.get("Price") or 0) > 0)
        print(f"  With price: {with_price}, Without price: {len(saucers) - with_price}")
    except Exception as e:
        print(f"  ERROR: {e}")
        results["saucers"] = []

    # ── 3. Saucers with cost (food cost data) ──────────────────────────
    print("\n[3] Fetching saucers with cost...")
    try:
        cost_raw = wansoft_post(session, "Reports/GetSaucersWithCost", params)
        costs = []
        if isinstance(cost_raw, list):
            costs = cost_raw
        elif isinstance(cost_raw, str):
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(cost_raw, "html.parser")
            for row in soup.select(".rowReport, tr"):
                cols = [c.text.strip() for c in row.select("div, td")]
                if len(cols) >= 4:
                    try:
                        price = float(cols[1].replace("$", "").replace(",", "")) if cols[1] else 0
                        cost = float(cols[2].replace("$", "").replace(",", "")) if cols[2] else 0
                        margin = float(cols[3].replace("%", "").replace(",", "")) if cols[3] else 0
                    except ValueError:
                        price, cost, margin = 0, 0, 0
                    costs.append({"name": cols[0], "price": price, "cost": cost, "margin_pct": margin})
        print(f"  Saucers with cost: {len(costs)}")
        results["saucers_with_cost"] = costs
    except Exception as e:
        print(f"  ERROR: {e}")
        results["saucers_with_cost"] = []

    # ── 4. Complements (modificadores) ──────────────────────────────────
    print("\n[4] Fetching complements (modificadores)...")
    try:
        comp_raw = wansoft_post(session, "Menu/GetComplementaryList", params)
        complements = []
        if isinstance(comp_raw, list):
            complements = comp_raw
        elif isinstance(comp_raw, str):
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(comp_raw, "html.parser")
            for row in soup.select(".rowReport, tr"):
                cols = [c.text.strip() for c in row.select("div, td")]
                if len(cols) >= 2:
                    try:
                        price = float(cols[1].replace("$", "").replace(",", "")) if cols[1] else 0
                    except ValueError:
                        price = 0
                    complements.append({"name": cols[0], "price": price})
        print(f"  Complements: {len(complements)}")
        results["complements"] = complements
    except Exception as e:
        print(f"  ERROR: {e}")
        results["complements"] = []

    # ── 5. Promotions ───────────────────────────────────────────────────
    print("\n[5] Fetching promotions...")
    try:
        promo_raw = wansoft_post(session, "Menu/GetPromotionList", params)
        promos = []
        if isinstance(promo_raw, list):
            promos = promo_raw
        elif isinstance(promo_raw, str):
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(promo_raw, "html.parser")
            for row in soup.select(".rowReport, tr"):
                cols = [c.text.strip() for c in row.select("div, td")]
                if len(cols) >= 2:
                    promos.append({"name": cols[0], "details": cols[1] if len(cols) > 1 else ""})
        print(f"  Promotions: {len(promos)}")
        results["promotions"] = promos
    except Exception as e:
        print(f"  ERROR: {e}")
        results["promotions"] = []

    # ── Save to Supabase ────────────────────────────────────────────────
    print("\n[6] Saving to Supabase...")
    sb_upsert("wansoft_menu_config", {
        "client_id": CLIENT["id"],
        "fecha": today_str,
        "groups": json.dumps(results.get("groups", [])),
        "saucers": json.dumps(results.get("saucers", [])),
        "saucers_with_cost": json.dumps(results.get("saucers_with_cost", [])),
        "complements": json.dumps(results.get("complements", [])),
        "promotions": json.dumps(results.get("promotions", [])),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })

    elapsed = int((time.time() - start) * 1000)

    # ── Summary ─────────────────────────────────────────────────────────
    summary_parts = []
    for key in ["groups", "saucers", "saucers_with_cost", "complements", "promotions"]:
        data = results.get(key, [])
        summary_parts.append(f"{key}: {len(data)}")

    summary = ", ".join(summary_parts)
    print(f"\n{'='*60}")
    print(f"DONE — {summary}")
    print(f"Time: {elapsed}ms")

    # Telegram
    msg = f"📋 MENU SYNC — {today_str}\n\n"
    msg += f"Grupos: {len(results.get('groups', []))}\n"
    msg += f"Platillos: {len(results.get('saucers', []))}\n"
    msg += f"Con costo: {len(results.get('saucers_with_cost', []))}\n"
    msg += f"Modificadores: {len(results.get('complements', []))}\n"
    msg += f"Promociones: {len(results.get('promotions', []))}\n"
    msg += f"\n⏱ {elapsed/1000:.1f}s"
    send_telegram(msg)

    # Log
    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_runs",
            headers={**sb_headers, "Prefer": "return=minimal"},
            json={
                "agent_id": "menu-sync",
                "trigger_type": TRIGGER_TYPE,
                "status": "success",
                "duration_ms": elapsed,
                "output_summary": summary,
                "tentacle": "ops",
            },
            timeout=10,
        )
    except Exception:
        pass

    print("[✓] Done")


if __name__ == "__main__":
    main()
