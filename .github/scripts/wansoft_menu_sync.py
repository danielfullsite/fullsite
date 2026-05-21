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
    params = {"subsidiaryId": SUBSIDIARY_ID}
    results = {}

    endpoints = [
        ("groups", "Menu/GetGroupList", params),
        ("saucers", "Menu/GetSaucerList", params),
        ("saucers_with_cost", "Reports/GetSaucersWithCost", params),
        ("complements", "Menu/GetComplementaryList", params),
        ("promotions", "Menu/GetPromotionList", params),
    ]

    for i, (key, path, ep_params) in enumerate(endpoints, 1):
        print(f"\n[{i}] Fetching {key} → {path}...")
        try:
            dtype, raw = wansoft_fetch(session, path, ep_params)
            print(f"  Type: {dtype}, Raw items: {len(raw) if isinstance(raw, list) else 'dict'}")

            items = []
            if dtype == "json" and isinstance(raw, list):
                items = raw
            elif dtype == "html" and isinstance(raw, list):
                # Transform HTML rows into dicts
                for cols in raw:
                    if len(cols) >= 2:
                        item = {"name": cols[0]}
                        if len(cols) >= 3:
                            item["price"] = safe_float(cols[2])
                        if len(cols) >= 4:
                            item["cost"] = safe_float(cols[3])
                        if len(cols) >= 5:
                            item["margin_pct"] = safe_float(cols[4])
                        # Second col is usually group or category
                        item["group"] = cols[1]
                        items.append(item)

            results[key] = items
            with_price = sum(1 for s in items if isinstance(s, dict) and safe_float(s.get("price", s.get("Price", 0))) > 0)
            print(f"  Parsed: {len(items)} items ({with_price} with price)")
        except Exception as e:
            print(f"  ERROR: {e}")
            results[key] = []

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
