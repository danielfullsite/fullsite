#!/usr/bin/env python3
"""
Ticket Detail Scraper — downloads sale detail TXT from Wansoft via Playwright.
Parses mesero × platillo × grupo cross and saves to Supabase.
This enables questions like "H&H por mesero" in the Telegram bot.
"""

import asyncio
import json
import os
import sys
import time
import requests
from datetime import date, timedelta, datetime, timezone
from collections import defaultdict

# ── Config ──────────────────────────────────────────────────────────────────
WANSOFT_URL = "https://www.wansoft.net/Wansoft.Web"
MX_TZ = timezone(timedelta(hours=-6))

# Categories to track per waiter
CATEGORIES = {
    "H&H": ["HALF", "HALF HALF"],
    "Pan": ["TOAST", "BAGEL", "CROISSANT", "CROQUE", "FRENCH TOAST", "PANINI"],
    "Postres": ["BROWNIE", "CHEESECAKE", "FLAN", "PASTEL", "CAKE", "CHURRO",
                "TIRAMISU", "TIRAMISÚ", "CREPAS", "CREPE", "PANCAKE"],
    "2da Bebida": [],  # Calculated differently — count beverage items per ticket
}

BEBIDA_GROUPS = {"COFFEE HOT/ICE", "FRESH DRINKS", "JUGOS", "SMOOTHIES",
                 "FRAPPES", "SIGNATURE", "TEA & TISANAS", "SODAS", "BEBIDAS OH"}


def download_sale_detail(target_date: str) -> str | None:
    """Download sale detail TXT from Wansoft via HTTP (no Playwright needed!)."""
    s = requests.Session()
    s.get(f"{WANSOFT_URL}/")
    r = s.post(f"{WANSOFT_URL}/", data={
        "UserName": os.environ["WANSOFT_USER"],
        "Password": os.environ["WANSOFT_PASS"],
    }, allow_redirects=True)
    if "Dashboard" not in r.url:
        raise Exception("Login failed")

    # The SaleDetail page exports a pipe-delimited TXT
    r = s.get(f"{WANSOFT_URL}/Reports/SaleDetail", params={
        "subsidiaryId": "6043",
        "startDate": target_date,
        "endDate": target_date,
    })

    # Try to find the export URL — check if there's a direct download link
    # The export worked via Playwright clicking btnExport. Let's try POST with export params
    from bs4 import BeautifulSoup

    # First load the page to get any tokens
    page_r = s.get(f"{WANSOFT_URL}/Reports/SaleDetail")

    # Try the export endpoint directly
    export_r = s.post(f"{WANSOFT_URL}/Reports/ExportSaleDetail", data={
        "subsidiaryId": "6043",
        "startDate": target_date,
        "endDate": target_date,
    }, allow_redirects=True)

    if export_r.status_code == 200 and "|" in export_r.text[:200]:
        return export_r.text

    # Try alternate export URLs
    for endpoint in ["Reports/ExportSaleDetailToTxt", "Reports/SaleDetailExport",
                     "Reports/ExportSaleDetail"]:
        try:
            r2 = s.get(f"{WANSOFT_URL}/{endpoint}", params={
                "subsidiaryId": "6043", "startDate": target_date, "endDate": target_date,
            })
            if r2.status_code == 200 and "|" in r2.text[:200]:
                return r2.text
        except Exception:
            continue

    return None


def download_via_playwright(target_date: str) -> str | None:
    """Fallback: use Playwright to download the TXT."""
    try:
        import subprocess
        result = subprocess.run([
            sys.executable, "-c", f"""
import asyncio
from playwright.async_api import async_playwright

async def dl():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={{'width':1280,'height':900}}, accept_downloads=True)
        page = await ctx.new_page()
        await page.goto('{WANSOFT_URL}/', wait_until='domcontentloaded', timeout=30000)
        await asyncio.sleep(2)
        await page.fill('input[name="UserName"]', '{os.environ["WANSOFT_USER"]}')
        await page.fill('input[name="Password"]', '{os.environ["WANSOFT_PASS"]}')
        await page.click('input[type="submit"]')
        await asyncio.sleep(5)
        await page.goto('{WANSOFT_URL}/Reports/SaleDetail', wait_until='load', timeout=30000)
        await asyncio.sleep(5)
        await page.evaluate('''() => {{
            const sel = document.querySelector('select[multiple]');
            if (sel) {{ for (const o of sel.options) o.selected = true; sel.dispatchEvent(new Event('change')); }}
            const s = document.getElementById('startDate'); if (s) s.value = '{target_date}';
            const e = document.getElementById('endDate'); if (e) e.value = '{target_date}';
            document.querySelectorAll('.ui-widget-overlay').forEach(el => el.remove());
        }}''')
        await asyncio.sleep(1)
        try:
            async with page.expect_download(timeout=20000) as dl_info:
                await page.evaluate("() => {{ const b = document.getElementById('btnExport'); if (b) b.click(); }}")
            download = await dl_info.value
            path = '/tmp/wansoft_sale_detail.txt'
            await download.save_as(path)
            with open(path) as f:
                print(f.read())
        except Exception as ex:
            print(f'DOWNLOAD_ERROR:{{ex}}')
        await browser.close()

asyncio.run(dl())
"""], capture_output=True, text=True, timeout=120)
        if "DOWNLOAD_ERROR" in result.stdout:
            return None
        return result.stdout if "|" in result.stdout[:200] else None
    except Exception as e:
        print(f"[scraper] Playwright error: {e}")
        return None


def parse_sale_detail(txt: str) -> list[dict]:
    """Parse pipe-delimited TXT into list of sale line items."""
    lines = txt.strip().split("\n")
    if not lines:
        return []

    # First line is header
    headers = lines[0].split("|")
    items = []
    for line in lines[1:]:
        cols = line.split("|")
        if len(cols) < 25:
            continue

        # Skip modifiers (ESMODIFICADOR = Si)
        if len(cols) > 26 and cols[26].strip() == "Si":
            continue

        items.append({
            "orden": cols[3].strip(),
            "mesero": cols[7].strip(),
            "grupo": cols[20].strip(),
            "platillo": cols[22].strip(),
            "clave": cols[24].strip() if len(cols) > 24 else "",
            "cantidad": int(cols[15]) if cols[15].strip().isdigit() else 1,
            "total": float(cols[13]) if cols[13].strip().replace(".", "").replace("-", "").isdigit() else 0,
            "tipo_orden": cols[4].strip(),
        })

    return items


def compute_waiter_categories(items: list[dict]) -> dict:
    """Compute category breakdown per waiter."""
    # H&H, Pan, Postres per waiter
    waiter_cats = defaultdict(lambda: defaultdict(lambda: {"qty": 0, "total": 0.0, "items": []}))

    for item in items:
        mesero = item["mesero"]
        platillo_upper = item["platillo"].upper()
        grupo = item["grupo"]

        # H&H
        if any(kw in platillo_upper for kw in CATEGORIES["H&H"]):
            waiter_cats[mesero]["H&H"]["qty"] += item["cantidad"]
            waiter_cats[mesero]["H&H"]["total"] += item["total"]

        # Pan
        if any(kw in platillo_upper for kw in CATEGORIES["Pan"]):
            waiter_cats[mesero]["Pan"]["qty"] += item["cantidad"]
            waiter_cats[mesero]["Pan"]["total"] += item["total"]

        # Postres
        if any(kw in platillo_upper for kw in CATEGORIES["Postres"]):
            waiter_cats[mesero]["Postres"]["qty"] += item["cantidad"]
            waiter_cats[mesero]["Postres"]["total"] += item["total"]

    # 2da Bebida: count tickets with 2+ beverage items per waiter
    tickets_by_waiter = defaultdict(lambda: defaultdict(int))  # {mesero: {orden: bev_count}}
    for item in items:
        if item["grupo"] in BEBIDA_GROUPS:
            tickets_by_waiter[item["mesero"]][item["orden"]] += item["cantidad"]

    for mesero, tickets in tickets_by_waiter.items():
        total_tickets = len(tickets)
        tickets_with_2plus = sum(1 for count in tickets.values() if count >= 2)
        extra_bevs = sum(max(0, count - 1) for count in tickets.values())
        waiter_cats[mesero]["2da Bebida"] = {
            "qty": extra_bevs,
            "total": 0,  # Can't easily attribute $ to 2nd beverage
            "tickets_total": total_tickets,
            "tickets_with_2plus": tickets_with_2plus,
            "pct": round(tickets_with_2plus / total_tickets * 100, 1) if total_tickets else 0,
        }

    # Full mesero × grupo breakdown (for any query like "pizzas de Brayan")
    mesero_grupos = defaultdict(lambda: defaultdict(lambda: {"qty": 0, "total": 0.0}))
    mesero_platillos = defaultdict(lambda: defaultdict(lambda: {"qty": 0, "total": 0.0}))
    for item in items:
        mesero = item["mesero"]
        mesero_grupos[mesero][item["grupo"]]["qty"] += item["cantidad"]
        mesero_grupos[mesero][item["grupo"]]["total"] += item["total"]
        mesero_platillos[mesero][item["platillo"]]["qty"] += item["cantidad"]
        mesero_platillos[mesero][item["platillo"]]["total"] += item["total"]

    result = dict(waiter_cats)
    # Add full breakdown per mesero
    result["__por_mesero_grupo"] = {m: dict(g) for m, g in mesero_grupos.items()}
    result["__por_mesero_platillo"] = {m: dict(p) for m, p in mesero_platillos.items()}

    # Restaurant-only stats (excluding Market + cajeros)
    market_cajero = ["fany elizabeth", "ericka tamara", "frida vianney", "jorge antonio",
                     "oscar ricardo", "rodrigo chávez", "rodrigo chavez", "aplicaciones", "mesero evento"]

    all_tickets = defaultdict(set)  # {mesero: set of orden numbers}
    for item in items:
        all_tickets[item["mesero"]].add(item["orden"])

    rest_tickets = 0
    rest_ventas = 0.0
    for mesero, ordenes in all_tickets.items():
        is_excluded = any(ex in mesero.lower() for ex in market_cajero)
        if not is_excluded:
            rest_tickets += len(ordenes)
            rest_ventas += sum(i["total"] for i in items if i["mesero"] == mesero)

    result["__restaurant_stats"] = {
        "tickets": rest_tickets,
        "ventas": round(rest_ventas, 2),
        "ticket_promedio": round(rest_ventas / rest_tickets, 2) if rest_tickets else 0,
    }

    return result


def build_telegram_message(waiter_cats: dict, target_date: str) -> str:
    """Build Telegram message with waiter × category breakdown."""
    msg = f"📊 VENTAS POR CATEGORÍA × MESERO\n{target_date}\n"

    for cat in ["H&H", "Pan", "Postres", "2da Bebida"]:
        msg += f"\n{'🥚' if cat == 'H&H' else '🍞' if cat == 'Pan' else '🍰' if cat == 'Postres' else '☕'} {cat}\n"

        # Sort waiters by qty for this category
        waiters = []
        for mesero, cats in waiter_cats.items():
            if cat in cats and cats[cat].get("qty", 0) > 0:
                waiters.append((mesero, cats[cat]))
            elif cat == "2da Bebida" and cat in cats and cats[cat].get("tickets_with_2plus", 0) > 0:
                waiters.append((mesero, cats[cat]))

        waiters.sort(key=lambda x: -(x[1].get("qty", 0) or x[1].get("tickets_with_2plus", 0)))

        if not waiters:
            msg += "  Sin datos\n"
            continue

        for mesero, data in waiters:
            if cat == "2da Bebida":
                msg += f"  {mesero}: {data['tickets_with_2plus']}/{data['tickets_total']} tickets ({data['pct']}%)\n"
            else:
                msg += f"  {mesero}: {data['qty']} pzas (${data['total']:,.0f})\n"

    return msg


def save_to_supabase(waiter_cats: dict, items: list[dict], target_date: str):
    """Save the waiter × category data to Supabase for the query agent."""
    sb_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    sb_key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not sb_url or not sb_key:
        return

    headers = {"apikey": sb_key, "Authorization": f"Bearer {sb_key}",
               "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"}

    # Save to wansoft_waiter_categories table (upsert by fecha)
    try:
        row = {
            "fecha": target_date,
            "data": json.dumps(waiter_cats),
            "items_count": len(items),
            "updated_at": datetime.now(MX_TZ).isoformat(),
        }
        r = requests.post(f"{sb_url}/rest/v1/wansoft_waiter_categories",
                          headers=headers, json=row, timeout=10)
        if r.status_code in (200, 201, 204):
            print(f"[scraper] Saved to Supabase wansoft_waiter_categories")
        else:
            print(f"[scraper] Supabase save: {r.status_code} {r.text[:200]}")
    except Exception as e:
        print(f"[scraper] Supabase error: {e}")


def send_telegram(msg: str):
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID_DANIEL")
    if not token or not chat_id:
        return
    chunks = [msg[i:i + 4000] for i in range(0, len(msg), 4000)]
    for chunk in chunks:
        requests.post(f"https://api.telegram.org/bot{token}/sendMessage",
                      json={"chat_id": chat_id, "text": chunk}, timeout=15)


def main():
    now_mx = datetime.now(MX_TZ)
    target_date = now_mx.strftime("%Y-%m-%d")

    print(f"[scraper] Downloading sale detail for {target_date}...")

    # Try HTTP first, then Playwright
    txt = download_sale_detail(target_date)
    if not txt:
        print("[scraper] HTTP download failed, trying Playwright...")
        txt = download_via_playwright(target_date)

    if not txt:
        print("[scraper] Could not download sale detail")
        sys.exit(1)

    lines = txt.strip().split("\n")
    print(f"[scraper] Got {len(lines)} lines")

    items = parse_sale_detail(txt)
    print(f"[scraper] Parsed {len(items)} items (excluding modifiers)")

    waiter_cats = compute_waiter_categories(items)
    print(f"[scraper] Computed categories for {len(waiter_cats)} waiters")

    msg = build_telegram_message(waiter_cats, target_date)
    print(msg)

    send_telegram(msg)
    save_to_supabase(waiter_cats, items, target_date)
    print("[scraper] Done")


if __name__ == "__main__":
    main()
