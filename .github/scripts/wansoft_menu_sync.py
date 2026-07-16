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
from datetime import datetime, timedelta, timezone
from client_config import get_client, get_tz, get_wansoft_creds

# ── Config ──────────────────────────────────────────────────────────────────
CLIENT = get_client()
SUBSIDIARY_ID, WANSOFT_USER, WANSOFT_PASS = get_wansoft_creds(CLIENT)
WANSOFT_URL = "https://www.wansoft.net/Wansoft.Web"

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TG_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
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
    if "Dashboard" not in resp.url and "MyDocumentsList" not in resp.url:
        raise Exception(f"Wansoft login failed. URL: {resp.url}")
    print("[✓] Wansoft login OK")
    return s


def safe_float(val):
    try:
        return float(str(val).replace("$", "").replace(",", "").replace("%", "").strip())
    except (ValueError, TypeError):
        return 0


def parse_any_table(html):
    """Parse any table/row structure from HTML."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    # Try .rowReport first (Wansoft standard)
    rows = soup.select(".rowReport")
    if rows:
        results = []
        for row in rows:
            cols = [c.text.strip() for c in row.select("div")]
            if cols and any(c for c in cols):
                results.append(cols)
        return results
    # Try standard table
    tables = soup.select("table")
    for table in tables:
        trs = table.select("tr")
        if len(trs) > 1:
            results = []
            for tr in trs:
                cols = [td.text.strip() for td in tr.select("td")]
                if cols and any(c for c in cols):
                    results.append(cols)
            return results
    # Try div patterns
    all_divs = soup.select("div[class*='row'], div[class*='item'], div[class*='record']")
    if all_divs:
        results = []
        for div in all_divs:
            text = div.get_text(separator="|").strip()
            if text:
                results.append(text.split("|"))
        return results
    return []


def wansoft_fetch(session, path, params):
    """POST to Wansoft, return (type, data)."""
    r = session.post(f"{WANSOFT_URL}/{path}", data=params, timeout=30)
    # Try JSON first
    try:
        data = r.json()
        if data:
            return "json", data
    except (ValueError, Exception):
        pass
    # Try HTML parsing
    rows = parse_any_table(r.text)
    if rows:
        return "html", rows
    # Debug: show preview
    preview = r.text[:300].strip()
    print(f"    Empty response preview: {preview[:150]}")
    return "empty", []


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

    # Use PROVEN report endpoints (not admin Menu/* which need browser)
    # Wide date range to capture ALL dishes ever sold
    thirty_ago = (now_mx - timedelta(days=30)).strftime("%Y-%m-%d")
    ninety_ago = (now_mx - timedelta(days=90)).strftime("%Y-%m-%d")
    base = {"subsidiaryId": SUBSIDIARY_ID, "startDate": thirty_ago, "endDate": today_str}
    wide = {"subsidiaryId": SUBSIDIARY_ID, "startDate": ninety_ago, "endDate": today_str}

    results = {}

    # 1. SalesBySaucer (90 days) — ALL platillos with qty + total
    print("\n[1] SalesBySaucer (90 days)...")
    try:
        dtype, raw = wansoft_fetch(session, "Reports/SalesBySaucer", wide)
        saucers = []
        if dtype == "html":
            for cols in raw:
                if len(cols) >= 4:
                    saucers.append({
                        "name": cols[0],
                        "qty": safe_float(cols[1]),
                        "price": safe_float(cols[2]),
                        "total": safe_float(cols[3]),
                    })
        elif dtype == "json" and isinstance(raw, list):
            saucers = raw
        print(f"  Platillos: {len(saucers)}")
        results["saucers"] = saucers
    except Exception as e:
        print(f"  ERROR: {e}")
        results["saucers"] = []

    # 2. SalesByGroup (90 days) — ALL groups
    print("\n[2] SalesByGroup (90 days)...")
    try:
        dtype, raw = wansoft_fetch(session, "Reports/SalesByGroup", wide)
        groups = []
        if dtype == "html":
            for cols in raw:
                if len(cols) >= 2:
                    groups.append({"name": cols[0], "total": safe_float(cols[-1])})
        elif dtype == "json" and isinstance(raw, list):
            groups = raw
        print(f"  Grupos: {len(groups)}")
        results["groups"] = groups
    except Exception as e:
        print(f"  ERROR: {e}")
        results["groups"] = []

    # 3. GetSaucersWithCost — platillos + food cost + margin
    print("\n[3] GetSaucersWithCost...")
    try:
        dtype, raw = wansoft_fetch(session, "Reports/GetSaucersWithCost",
                                    {"subsidiaryId": SUBSIDIARY_ID})
        costs = []
        if dtype == "html":
            for cols in raw:
                if len(cols) >= 3:
                    costs.append({
                        "name": cols[0],
                        "price": safe_float(cols[1]) if len(cols) > 1 else 0,
                        "cost": safe_float(cols[2]) if len(cols) > 2 else 0,
                        "margin_pct": safe_float(cols[3]) if len(cols) > 3 else 0,
                    })
        elif dtype == "json" and isinstance(raw, list):
            costs = raw
        print(f"  Con costo: {len(costs)}")
        results["saucers_with_cost"] = costs
    except Exception as e:
        print(f"  ERROR: {e}")
        results["saucers_with_cost"] = []

    # 4. GetCostBySaucer (month) — dish-level cost
    print("\n[4] GetCostBySaucer (30 days)...")
    try:
        dtype, raw = wansoft_fetch(session, "Reports/GetCostBySaucer", base)
        cost_detail = []
        if dtype == "html":
            for cols in raw:
                if len(cols) >= 3:
                    cost_detail.append({
                        "name": cols[0],
                        "cost": safe_float(cols[1]) if len(cols) > 1 else 0,
                        "price": safe_float(cols[2]) if len(cols) > 2 else 0,
                        "margin_pct": safe_float(cols[3]) if len(cols) > 3 else 0,
                    })
        elif dtype == "json" and isinstance(raw, list):
            cost_detail = raw
        print(f"  Food cost detail: {len(cost_detail)}")
        if cost_detail:
            results["saucers_with_cost"] = cost_detail  # Override with richer data
    except Exception as e:
        print(f"  ERROR: {e}")

    # 5. SalesByModifiers — extras/add-ons
    print("\n[5] SalesByModifiers (30 days)...")
    try:
        dtype, raw = wansoft_fetch(session, "Reports/SalesByModifiers", base)
        modifiers = []
        if dtype == "html":
            for cols in raw:
                if len(cols) >= 2:
                    modifiers.append({
                        "name": cols[0],
                        "qty": safe_float(cols[1]) if len(cols) > 1 else 0,
                        "total": safe_float(cols[-1]),
                    })
        elif dtype == "json" and isinstance(raw, list):
            modifiers = raw
        print(f"  Modificadores: {len(modifiers)}")
        results["complements"] = modifiers
    except Exception as e:
        print(f"  ERROR: {e}")
        results["complements"] = []

    # ── Save to Supabase ────────────────────────────────────────────────
    print("\n[6] Saving to Supabase...")
    sb_upsert("wansoft_menu_config", {
        "client_id": CLIENT["id"],
        "fecha": today_str,
        "groups": json.dumps(results.get("groups", [])),
        "saucers": json.dumps(results.get("saucers", [])),
        "saucers_with_cost": json.dumps(results.get("saucers_with_cost", [])),
        "complements": json.dumps(results.get("complements", [])),
        "promotions": json.dumps([]),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })

    elapsed = int((time.time() - start) * 1000)

    # ── Summary ─────────────────────────────────────────────────────────
    n_saucers = len(results.get("saucers", []))
    n_groups = len(results.get("groups", []))
    n_costs = len(results.get("saucers_with_cost", []))
    n_mods = len(results.get("complements", []))

    summary = f"platillos:{n_saucers}, grupos:{n_groups}, food_cost:{n_costs}, modificadores:{n_mods}"
    print(f"\n{'='*60}")
    print(f"DONE — {summary}")
    print(f"Time: {elapsed}ms")

    # Telegram
    msg = f"📋 MENU SYNC — {today_str}\n\n"
    msg += f"Platillos vendidos (90d): {n_saucers}\n"
    msg += f"Grupos: {n_groups}\n"
    msg += f"Food cost: {n_costs}\n"
    msg += f"Modificadores: {n_mods}\n"
    if results.get("saucers"):
        top5 = sorted(results["saucers"], key=lambda x: x.get("total", 0) if isinstance(x, dict) else 0, reverse=True)[:5]
        msg += "\nTop 5 platillos:\n"
        for s in top5:
            if isinstance(s, dict):
                msg += f"  {s.get('name', '?')}: {int(s.get('qty', 0))} pzas, ${int(s.get('total', 0)):,}\n"
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
