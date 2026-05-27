#!/usr/bin/env python3
"""
Wansoft Browser Scraper — Playwright-based
Scrapes endpoints that require a full browser session (return 500 with requests):
- Inventory: stock levels, physical vs system, reorder point, products in recipes
- Menu: full saucer list, complements/modifiers
- Staff: complete user list
- eCommerce: order status

Runs daily after deep scraper.
"""

import asyncio
import json
import os
import sys
import time
import requests
from datetime import datetime, timezone
from client_config import get_client, get_tz, get_wansoft_creds

CLIENT = get_client()
WANSOFT_URL = "https://www.wansoft.net/Wansoft.Web"
MX_TZ = get_tz(CLIENT)
SUBSIDIARY_ID, WANSOFT_USER, WANSOFT_PASS = get_wansoft_creds(CLIENT)

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TG_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID_DANIEL", "")

sb_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates,return=minimal",
}


def sb_upsert(table, data):
    r = requests.post(f"{SUPABASE_URL}/rest/v1/{table}", headers=sb_headers, json=data, timeout=15)
    if not r.ok:
        print(f"    [!] Supabase {table}: {r.status_code} {r.text[:200]}")
    else:
        print(f"    [✓] Saved to {table}")
    return r.ok


def send_telegram(msg):
    if not TG_CHAT_ID:
        return
    for chunk in [msg[i:i + 4000] for i in range(0, len(msg), 4000)]:
        requests.post(f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                      json={"chat_id": TG_CHAT_ID, "text": chunk})


async def run():
    from playwright.async_api import async_playwright

    start = time.time()
    now_mx = datetime.now(MX_TZ)
    today_str = now_mx.strftime("%Y-%m-%d")
    results = {}

    print(f"{'=' * 60}")
    print(f"WANSOFT BROWSER SCRAPER — {today_str}")
    print(f"{'=' * 60}")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 900})
        page = await ctx.new_page()

        # ── Login ────────────────────────────────────────────────
        print("\n[login] Navigating to Wansoft...")
        await page.goto(f"{WANSOFT_URL}/", wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(2)

        await page.fill('input[name="UserName"]', WANSOFT_USER)
        await page.fill('input[name="Password"]', WANSOFT_PASS)
        await page.click('input[type="submit"]')
        await asyncio.sleep(5)

        if "Dashboard" not in page.url:
            print(f"[!] Login failed. URL: {page.url}")
            await browser.close()
            return

        print("[✓] Login OK\n")

        # XHR interceptor — captures JSON responses from Wansoft AJAX calls
        captured_responses = []

        async def capture_response(response):
            url = response.url
            if "wansoft.net" not in url:
                return
            ct = response.headers.get("content-type", "")
            if "json" in ct or "javascript" in ct:
                try:
                    body = await response.json()
                    if body and (isinstance(body, list) or (isinstance(body, dict) and len(body) > 0)):
                        captured_responses.append({"url": url, "data": body, "status": response.status})
                except Exception:
                    pass

        page.on("response", capture_response)

        # Helper: navigate to page, wait, extract table data
        async def scrape_page(name, url, wait_selector=None, wait_time=5):
            print(f"  [{name}] → {url}")
            try:
                await page.goto(f"{WANSOFT_URL}/{url}", wait_until="load", timeout=30000)
                await asyncio.sleep(wait_time)

                # Close any modal overlays
                await page.evaluate("""() => {
                    document.querySelectorAll('.ui-widget-overlay, .modal-backdrop').forEach(el => el.remove());
                    document.querySelectorAll('.ui-dialog').forEach(el => el.remove());
                }""")

                # Select subsidiary if dropdown exists
                await page.evaluate(f"""() => {{
                    const selects = document.querySelectorAll('select');
                    for (const sel of selects) {{
                        for (const opt of sel.options) {{
                            if (opt.value === '{SUBSIDIARY_ID}' || opt.text.includes('AMALAY')) {{
                                opt.selected = true;
                                sel.dispatchEvent(new Event('change', {{bubbles: true}}));
                            }}
                        }}
                    }}
                    // Select all in multi-selects
                    const multiSel = document.querySelector('select[multiple]');
                    if (multiSel) {{
                        for (const o of multiSel.options) o.selected = true;
                        multiSel.dispatchEvent(new Event('change', {{bubbles: true}}));
                    }}
                }}""")
                await asyncio.sleep(2)

                # Click search/filter button if exists
                await page.evaluate("""() => {
                    const btns = document.querySelectorAll('button, input[type="button"], input[type="submit"]');
                    for (const b of btns) {
                        const txt = (b.textContent || b.value || '').toLowerCase();
                        if (txt.includes('buscar') || txt.includes('search') || txt.includes('consultar') || txt.includes('filtrar')) {
                            b.click();
                            break;
                        }
                    }
                }""")
                await asyncio.sleep(3)

                # Extract table data
                data = await page.evaluate("""() => {
                    const results = [];

                    // Try .rowReport first (Wansoft report style)
                    const rows = document.querySelectorAll('.rowReport');
                    if (rows.length > 0) {
                        for (const row of rows) {
                            const cols = Array.from(row.querySelectorAll('div')).map(d => d.textContent.trim());
                            if (cols.length > 0 && cols.some(c => c)) results.push(cols);
                        }
                        return {type: 'rowReport', count: results.length, data: results};
                    }

                    // Try regular tables
                    const tables = document.querySelectorAll('table');
                    for (const table of tables) {
                        const trs = table.querySelectorAll('tr');
                        if (trs.length > 2) {
                            for (const tr of trs) {
                                const cols = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
                                if (cols.length > 0 && cols.some(c => c)) results.push(cols);
                            }
                            return {type: 'table', count: results.length, data: results};
                        }
                    }

                    // Try grid/list views
                    const gridItems = document.querySelectorAll('[class*="grid"] [class*="row"], [class*="list"] [class*="item"]');
                    if (gridItems.length > 0) {
                        for (const item of gridItems) {
                            const text = item.textContent.trim();
                            if (text) results.push(text.split(/\\s{2,}|\\|/));
                        }
                        return {type: 'grid', count: results.length, data: results};
                    }

                    // Fallback: get all visible text content
                    const body = document.querySelector('.content-wrapper, .main-content, #content, main, .container');
                    if (body) {
                        return {type: 'raw', count: 1, data: body.textContent.substring(0, 5000)};
                    }

                    return {type: 'empty', count: 0, data: []};
                }""")

                print(f"    Type: {data.get('type')}, Items: {data.get('count', 0)}")
                return data
            except Exception as e:
                print(f"    ERROR: {e}")
                return {"type": "error", "count": 0, "data": [], "error": str(e)}

        # ── INVENTORY ────────────────────────────────────────────
        print("━━━ INVENTORY (Browser) ━━━")

        inv_data = await scrape_page("Inventory", "Inventory/Index")
        if inv_data.get("count", 0) > 0 and inv_data["type"] != "error":
            items = []
            raw = inv_data.get("data", [])
            if isinstance(raw, list):
                for row in raw:
                    if isinstance(row, list) and len(row) >= 2:
                        items.append({
                            "producto": row[0],
                            "existencia": float(str(row[1]).replace(",", "").replace("$", "")) if len(row) > 1 else 0,
                            "unidad": row[2] if len(row) > 2 else "",
                            "costo_unitario": float(str(row[3]).replace(",", "").replace("$", "")) if len(row) > 3 else 0,
                            "costo_total": float(str(row[4]).replace(",", "").replace("$", "")) if len(row) > 4 else 0,
                        })
            if items:
                sb_upsert("wansoft_inventory", {
                    "client_id": CLIENT["id"], "fecha": today_str,
                    "data": json.dumps(items),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
                results["inventario"] = len(items)

        # Physical vs System (shrinkage)
        shrink_data = await scrape_page("PhysicalVsSystem", "Inventory/PhysicalInventoryVsSystem")
        if shrink_data.get("count", 0) > 0 and shrink_data["type"] != "error":
            items = []
            raw = shrink_data.get("data", [])
            if isinstance(raw, list):
                for row in raw:
                    if isinstance(row, list) and len(row) >= 3:
                        sistema = float(str(row[1]).replace(",", "")) if len(row) > 1 else 0
                        fisico = float(str(row[2]).replace(",", "")) if len(row) > 2 else 0
                        diff = round(fisico - sistema, 2)
                        if abs(diff) > 0.01:
                            items.append({
                                "producto": row[0], "sistema": sistema, "fisico": fisico,
                                "diferencia": diff,
                                "costo_diferencia": float(str(row[3]).replace(",", "").replace("$", "")) if len(row) > 3 else 0,
                            })
            if items:
                sb_upsert("wansoft_shrinkage", {
                    "client_id": CLIENT["id"], "fecha": today_str,
                    "data": json.dumps(items),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
                results["merma"] = len(items)

        # Reorder point
        reorder_data = await scrape_page("ReorderPoint", "Inventory/ReorderPoint")
        if reorder_data.get("count", 0) > 0 and reorder_data["type"] not in ("error", "empty"):
            results["reorden"] = reorder_data.get("count", 0)

        # ── MENU (Full catalog extraction) ──────────────────────
        print("\n━━━ MENU CATALOG (Browser) ━━━")

        # Saucers — get ALL platillos with name, group, price
        print("  [Saucers] Navigating to Menu/Saucer...")
        try:
            captured_responses.clear()
            await page.goto(f"{WANSOFT_URL}/Menu/Saucer", wait_until="load", timeout=30000)
            await asyncio.sleep(5)

            # Close modals + select subsidiary
            await page.evaluate("""() => {
                document.querySelectorAll('.ui-widget-overlay, .modal-backdrop').forEach(el => el.remove());
                document.querySelectorAll('.ui-dialog').forEach(el => el.remove());
            }""")
            await page.evaluate(f"""() => {{
                const selects = document.querySelectorAll('select');
                for (const sel of selects) {{
                    for (const opt of sel.options) {{
                        if (opt.value === '{SUBSIDIARY_ID}' || opt.text.includes('AMALAY')) {{
                            opt.selected = true;
                            sel.dispatchEvent(new Event('change', {{bubbles: true}}));
                        }}
                    }}
                }}
            }}""")
            await asyncio.sleep(3)

            # Try to show ALL items (expand pagination)
            await page.evaluate("""() => {
                const pageSel = document.querySelector('select[name*="length"], select[class*="page-size"]');
                if (pageSel) {
                    for (const opt of pageSel.options) {
                        if (opt.value === '-1' || opt.text.includes('Todos') || opt.text.includes('All') || parseInt(opt.value) >= 500) {
                            opt.selected = true;
                            pageSel.dispatchEvent(new Event('change', {bubbles: true}));
                            break;
                        }
                    }
                }
                const btns = document.querySelectorAll('button, input[type="button"], input[type="submit"]');
                for (const b of btns) {
                    const txt = (b.textContent || b.value || '').toLowerCase();
                    if (txt.includes('buscar') || txt.includes('search') || txt.includes('filtrar') || txt.includes('consultar')) {
                        b.click(); break;
                    }
                }
            }""")
            await asyncio.sleep(5)

            # Check XHR captures first (most reliable)
            saucers_from_xhr = []
            for cap in captured_responses:
                data = cap["data"]
                if isinstance(data, list) and len(data) > 5:
                    # Likely the saucer list
                    print(f"    [XHR] Captured {len(data)} items from {cap['url'][-60:]}")
                    saucers_from_xhr = data
                    break
                elif isinstance(data, dict):
                    # jqGrid format: {"rows": [...], "total": N}
                    for key in ("rows", "data", "items", "Data", "Rows"):
                        if key in data and isinstance(data[key], list) and len(data[key]) > 5:
                            print(f"    [XHR] Captured {len(data[key])} items from {cap['url'][-60:]} (key={key})")
                            saucers_from_xhr = data[key]
                            break
                    if saucers_from_xhr:
                        break

            if saucers_from_xhr:
                saucers_catalog = saucers_from_xhr
                print(f"    Got {len(saucers_catalog)} saucers via XHR")
            else:
                print(f"    No XHR data. Captured {len(captured_responses)} responses. Falling back to DOM...")
                for cap in captured_responses:
                    print(f"      {cap['url'][-80:]} → type={type(cap['data']).__name__}, len={len(cap['data']) if isinstance(cap['data'], (list, dict)) else '?'}")

                # Fallback: extract from DOM
                saucers_catalog = await page.evaluate("""() => {
                const items = [];

                // Try .rowReport (Wansoft standard)
                const rows = document.querySelectorAll('.rowReport');
                if (rows.length > 0) {
                    for (const row of rows) {
                        const cols = Array.from(row.querySelectorAll('div')).map(d => d.textContent.trim());
                        if (cols.length >= 2 && cols[0]) {
                            items.push({
                                name: cols[0],
                                group: cols.length > 1 ? cols[1] : '',
                                price: cols.length > 2 ? parseFloat((cols[2] || '0').replace(/[$,]/g, '')) || 0 : 0,
                                active: cols.length > 3 ? cols[3] : '',
                            });
                        }
                    }
                    return items;
                }

                // Try tables
                const tables = document.querySelectorAll('table');
                for (const table of tables) {
                    const trs = table.querySelectorAll('tbody tr, tr');
                    if (trs.length > 2) {
                        // Get header to identify columns
                        const headerRow = table.querySelector('thead tr, tr:first-child');
                        const headers = headerRow ? Array.from(headerRow.querySelectorAll('th, td')).map(h => h.textContent.trim().toLowerCase()) : [];

                        const nameIdx = headers.findIndex(h => h.includes('nombre') || h.includes('platillo') || h.includes('saucer') || h.includes('name'));
                        const groupIdx = headers.findIndex(h => h.includes('grupo') || h.includes('group') || h.includes('categoria'));
                        const priceIdx = headers.findIndex(h => h.includes('precio') || h.includes('price') || h.includes('costo'));

                        for (const tr of trs) {
                            const cols = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
                            if (cols.length >= 2 && cols[0]) {
                                items.push({
                                    name: cols[nameIdx >= 0 ? nameIdx : 0],
                                    group: cols[groupIdx >= 0 ? groupIdx : 1] || '',
                                    price: parseFloat((cols[priceIdx >= 0 ? priceIdx : 2] || '0').replace(/[$,]/g, '')) || 0,
                                    active: '',
                                });
                            }
                        }
                        return items;
                    }
                }

                // Try jqGrid (Wansoft uses jqGrid in some views)
                const gridRows = document.querySelectorAll('#gridSaucer tr, .ui-jqgrid-bdiv tr, [id*="grid"] tr');
                for (const tr of gridRows) {
                    const cols = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
                    if (cols.length >= 2 && cols[0] && !cols[0].includes('No records')) {
                        items.push({
                            name: cols[0],
                            group: cols.length > 1 ? cols[1] : '',
                            price: cols.length > 2 ? parseFloat((cols[2] || '0').replace(/[$,]/g, '')) || 0 : 0,
                            active: cols.length > 3 ? cols[3] : '',
                        });
                    }
                }
                if (items.length > 0) return items;

                // Last resort: capture page structure for debugging
                const bodyText = document.querySelector('.content-wrapper, main, #content, body')?.textContent?.substring(0, 3000) || '';
                return [{_debug: true, text: bodyText}];
            }""")

            if saucers_catalog and len(saucers_catalog) > 0:
                debug = any(isinstance(s, dict) and s.get("_debug") for s in saucers_catalog)
                if debug:
                    print(f"    [debug] Page text: {str(saucers_catalog[0].get('text', ''))[:200]}")
                    results["platillos"] = 0
                else:
                    with_price = sum(1 for s in saucers_catalog if s.get("price", 0) > 0)
                    print(f"    Platillos: {len(saucers_catalog)} ({with_price} con precio)")
                    results["platillos"] = len(saucers_catalog)
                    results["platillos_con_precio"] = with_price
            else:
                print("    No saucers found")
        except Exception as e:
            print(f"    ERROR saucers: {e}")
            saucers_catalog = []

        # Complements/Modifiers
        print("  [Complements] Navigating to Menu/Complementary...")
        try:
            captured_responses.clear()
            await page.goto(f"{WANSOFT_URL}/Menu/Complementary", wait_until="load", timeout=30000)
            await asyncio.sleep(5)
            await page.evaluate("""() => {
                document.querySelectorAll('.ui-widget-overlay, .modal-backdrop').forEach(el => el.remove());
            }""")
            await page.evaluate(f"""() => {{
                const selects = document.querySelectorAll('select');
                for (const sel of selects) {{
                    for (const opt of sel.options) {{
                        if (opt.value === '{SUBSIDIARY_ID}' || opt.text.includes('AMALAY')) {{
                            opt.selected = true;
                            sel.dispatchEvent(new Event('change', {{bubbles: true}}));
                        }}
                    }}
                }}
            }}""")
            await asyncio.sleep(3)

            # Check XHR
            complements_catalog = []
            for cap in captured_responses:
                data = cap["data"]
                items = data if isinstance(data, list) else data.get("rows", data.get("data", data.get("Data", [])))
                if isinstance(items, list) and len(items) > 0:
                    complements_catalog = items
                    print(f"    [XHR] Captured {len(items)} complements from {cap['url'][-60:]}")
                    break

            if not complements_catalog:
                print(f"    No XHR. Captured {len(captured_responses)} responses. Trying DOM...")
                complements_catalog = await page.evaluate("""() => {
                    const items = [];
                    const allRows = document.querySelectorAll('.rowReport, table tbody tr, .ui-jqgrid-bdiv tr');
                    for (const tr of allRows) {
                        const cols = Array.from(tr.querySelectorAll('td, div')).map(el => el.textContent.trim());
                        if (cols.length >= 1 && cols[0] && !cols[0].includes('No records'))
                            items.push({ name: cols[0], price: cols.length > 1 ? parseFloat((cols[1]||'0').replace(/[$,]/g,''))||0 : 0 });
                    }
                    return items;
                }""")

            if complements_catalog:
                print(f"    Modificadores: {len(complements_catalog)}")
                results["modificadores"] = len(complements_catalog)
            else:
                print("    No complements found")
                complements_catalog = []
        except Exception as e:
            print(f"    ERROR complements: {e}")
            complements_catalog = []

        # Groups
        print("  [Groups] Navigating to Menu/Group...")
        try:
            captured_responses.clear()
            await page.goto(f"{WANSOFT_URL}/Menu/Group", wait_until="load", timeout=30000)
            await asyncio.sleep(5)
            await page.evaluate("""() => {
                document.querySelectorAll('.ui-widget-overlay, .modal-backdrop').forEach(el => el.remove());
            }""")

            groups_catalog = []
            for cap in captured_responses:
                data = cap["data"]
                items = data if isinstance(data, list) else data.get("rows", data.get("data", data.get("Data", [])))
                if isinstance(items, list) and len(items) > 0:
                    groups_catalog = items
                    print(f"    [XHR] Captured {len(items)} groups from {cap['url'][-60:]}")
                    break

            if not groups_catalog:
                print(f"    No XHR. Captured {len(captured_responses)} responses. Trying DOM...")
                groups_catalog = await page.evaluate("""() => {
                    const items = [];
                    const allRows = document.querySelectorAll('.rowReport, table tbody tr, .ui-jqgrid-bdiv tr');
                    for (const tr of allRows) {
                        const cols = Array.from(tr.querySelectorAll('td, div')).map(el => el.textContent.trim());
                        if (cols.length >= 1 && cols[0] && !cols[0].includes('No records'))
                            items.push({ name: cols[0], id: cols.length > 1 ? cols[1] : '' });
                    }
                    return items;
                }""")

            if groups_catalog:
                print(f"    Grupos: {len(groups_catalog)}")
                results["grupos"] = len(groups_catalog)
            else:
                print("    No groups found")
                groups_catalog = []
        except Exception as e:
            print(f"    ERROR groups: {e}")
            groups_catalog = []

        # Save full menu catalog to Supabase
        print("\n  [Save] Saving menu catalog to Supabase...")
        menu_data = {
            "client_id": CLIENT["id"],
            "fecha": today_str,
            "groups": json.dumps(groups_catalog),
            "saucers": json.dumps([s for s in saucers_catalog if not s.get("_debug")]),
            "saucers_with_cost": json.dumps([]),
            "complements": json.dumps(complements_catalog),
            "promotions": json.dumps([]),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        sb_upsert("wansoft_menu_config", menu_data)

        # ── STAFF ────────────────────────────────────────────────
        print("\n━━━ STAFF (Browser) ━━━")

        users_data = await scrape_page("PosUsers", "Staff/PosUser")
        if users_data.get("count", 0) > 0 and users_data["type"] != "error":
            results["usuarios_pos"] = users_data.get("count", 0)

        # ── ECOMMERCE ────────────────────────────────────────────
        print("\n━━━ ECOMMERCE (Browser) ━━━")

        ecom_data = await scrape_page("EcomOrders", "ECommerce/GeneralOrderStatus")
        if ecom_data.get("count", 0) > 0 and ecom_data["type"] != "error":
            results["ecommerce"] = ecom_data.get("count", 0)

        # ── CASH ─────────────────────────────────────────────────
        print("\n━━━ CASH (Browser) ━━━")

        withdrawal_data = await scrape_page("CashWithdrawals", "Reports/CashWithdrawal")
        if withdrawal_data.get("count", 0) > 0 and withdrawal_data["type"] != "error":
            results["retiros_caja"] = withdrawal_data.get("count", 0)

        # ── PROMOTIONS (Browser — REST endpoint returns navigation HTML) ───
        print("\n━━━ PROMOTIONS (Browser) ━━━")

        try:
            await page.goto(f"{WANSOFT_URL}/Menu/Promotion", wait_until="load", timeout=30000)
            await asyncio.sleep(3)

            # Select subsidiary
            await page.evaluate(f"""() => {{
                const selects = document.querySelectorAll('select');
                for (const sel of selects) {{
                    for (const opt of sel.options) {{
                        if (opt.value === '{SUBSIDIARY_ID}' || opt.text.includes('AMALAY')) {{
                            opt.selected = true;
                            sel.dispatchEvent(new Event('change', {{bubbles: true}}));
                        }}
                    }}
                }}
            }}""")
            await asyncio.sleep(3)

            # Extract promotion table
            promo_data = await page.evaluate("""() => {
                const promos = [];

                // Try table rows
                const rows = document.querySelectorAll('table tr, .rowReport, [class*="grid"] [class*="row"]');
                for (const row of rows) {
                    const cells = row.querySelectorAll('td, div');
                    const cols = Array.from(cells).map(c => c.textContent.trim()).filter(c => c);
                    if (cols.length >= 2) promos.push(cols);
                }

                // Try list items
                if (promos.length === 0) {
                    const items = document.querySelectorAll('[class*="item"], [class*="card"], [class*="promotion"]');
                    for (const item of items) {
                        const text = item.textContent.trim();
                        if (text && text.length > 3) promos.push(text.split(/\\s{2,}|\\|/));
                    }
                }

                // Fallback: raw content
                if (promos.length === 0) {
                    const main = document.querySelector('.content-wrapper, #content, main, .container');
                    if (main) return {type: 'raw', data: main.textContent.substring(0, 10000)};
                }

                return {type: 'table', count: promos.length, data: promos};
            }""")

            print(f"    Type: {promo_data.get('type')}, Items: {promo_data.get('count', 0)}")

            # Take screenshot for debugging
            await page.screenshot(path="/tmp/promotions.png", full_page=True)
            print("    [✓] Screenshot: promotions.png")

            # Parse promotions
            promos_parsed = []
            raw = promo_data.get("data", [])
            if isinstance(raw, list):
                for row in raw:
                    if isinstance(row, list) and len(row) >= 2:
                        promo = {
                            "nombre": row[0],
                            "tipo": row[1] if len(row) > 1 else "",
                            "platillo": row[2] if len(row) > 2 else "",
                            "descuento": row[3] if len(row) > 3 else "",
                            "activa": any(s in " ".join(row).lower() for s in ["activ", "si", "yes", "true"]),
                            "_cols": row,
                        }
                        promos_parsed.append(promo)
            elif isinstance(raw, str):
                promos_parsed = [{"raw_text": raw[:5000]}]

            if promos_parsed:
                sb_upsert("wansoft_data", {
                    "client_id": CLIENT["id"], "fecha": today_str,
                    "data_key": "promotions_browser",
                    "data": json.dumps(promos_parsed),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
                results["promociones"] = len(promos_parsed)
                activas = [p for p in promos_parsed if p.get("activa")]
                if activas:
                    results["promos_activas"] = len(activas)
        except Exception as e:
            print(f"    ERROR: {e}")

        # ── DISCOUNTS DETAIL (Browser — for proper HTML parsing) ─────────
        print("\n━━━ DISCOUNTS DETAIL (Browser) ━━━")

        for report_name, report_url, data_key in [
            ("Descuentos", "Reports/DiscountsDetail", "discounts_detail_browser"),
            ("Cortesias", "Reports/CourtesiesDetail", "courtesies_browser"),
        ]:
            try:
                await page.goto(f"{WANSOFT_URL}/{report_url}", wait_until="load", timeout=30000)
                await asyncio.sleep(3)

                # Set date range to today
                await page.evaluate(f"""() => {{
                    const inputs = document.querySelectorAll('input[type="text"], input[type="date"]');
                    for (const inp of inputs) {{
                        const id = (inp.id || inp.name || '').toLowerCase();
                        if (id.includes('start') || id.includes('inicio') || id.includes('fecha')) {{
                            inp.value = '{today_str}';
                            inp.dispatchEvent(new Event('change', {{bubbles: true}}));
                        }}
                        if (id.includes('end') || id.includes('fin')) {{
                            inp.value = '{today_str}';
                            inp.dispatchEvent(new Event('change', {{bubbles: true}}));
                        }}
                    }}
                    // Select subsidiary
                    const selects = document.querySelectorAll('select');
                    for (const sel of selects) {{
                        for (const opt of sel.options) {{
                            if (opt.value === '{SUBSIDIARY_ID}' || opt.text.includes('AMALAY')) {{
                                opt.selected = true;
                                sel.dispatchEvent(new Event('change', {{bubbles: true}}));
                            }}
                        }}
                    }}
                }}""")
                await asyncio.sleep(2)

                # Click search button
                await page.evaluate("""() => {
                    const btns = document.querySelectorAll('button, input[type="button"], input[type="submit"]');
                    for (const b of btns) {
                        const txt = (b.textContent || b.value || '').toLowerCase();
                        if (txt.includes('buscar') || txt.includes('search') || txt.includes('consultar')) {
                            b.click();
                            break;
                        }
                    }
                }""")
                await asyncio.sleep(5)

                # Extract the actual table content (not the header/section divs)
                detail_data = await page.evaluate("""() => {
                    const items = [];
                    // Wansoft discount detail pages have nested sections
                    // Look for actual data rows (not section headers)
                    const allRows = document.querySelectorAll('table tr');
                    for (const tr of allRows) {
                        const tds = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
                        // Skip header rows and empty rows
                        if (tds.length >= 3 && tds.some(t => t.includes('$') || /\\d/.test(t))) {
                            items.push(tds);
                        }
                    }

                    // Also try rowReport divs but filter out headers
                    if (items.length === 0) {
                        const rows = document.querySelectorAll('.rowReport');
                        for (const row of rows) {
                            const divs = Array.from(row.querySelectorAll(':scope > div')).map(d => d.textContent.trim());
                            if (divs.length >= 3 && divs.some(t => t.includes('$') || /\\d/.test(t))) {
                                items.push(divs);
                            }
                        }
                    }

                    // Grab section headers for context
                    const headers = [];
                    const headEls = document.querySelectorAll('h2, h3, h4, .titleReport, [class*="title"], [class*="header"]');
                    for (const h of headEls) {
                        const t = h.textContent.trim();
                        if (t && t.length < 100) headers.push(t);
                    }

                    return {type: 'detail', count: items.length, data: items, headers: headers};
                }""")

                print(f"    [{report_name}] Items: {detail_data.get('count', 0)}, Headers: {detail_data.get('headers', [])}")

                # Take screenshot
                await page.screenshot(path=f"/tmp/{data_key}.png", full_page=True)
                print(f"    [✓] Screenshot: {data_key}.png")

                # Parse and save
                parsed = []
                raw = detail_data.get("data", [])
                if isinstance(raw, list):
                    for row in raw:
                        if isinstance(row, list) and len(row) >= 2:
                            item = {"_cols": row}
                            # Try to identify columns by content
                            for i, val in enumerate(row):
                                v = val.strip()
                                if "$" in v:
                                    try:
                                        item.setdefault("monto", float(v.replace("$", "").replace(",", "")))
                                    except: pass
                                elif v.isdigit() and int(v) < 1000:
                                    item.setdefault("orden", v) if int(v) > 10 else item.setdefault("cantidad", int(v))
                                elif len(v) > 3 and not v.startswith("$"):
                                    if "nombre" not in item:
                                        item["nombre"] = v
                                    elif "mesero" not in item:
                                        item["mesero"] = v
                                    elif "autorizador" not in item:
                                        item["autorizador"] = v
                                    elif "platillo" not in item:
                                        item["platillo"] = v
                            parsed.append(item)

                if parsed:
                    sb_upsert("wansoft_data", {
                        "client_id": CLIENT["id"], "fecha": today_str,
                        "data_key": data_key,
                        "data": json.dumps(parsed),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    })
                    results[data_key] = len(parsed)
                else:
                    results[data_key] = f"0 (headers: {detail_data.get('headers', [])})"

            except Exception as e:
                print(f"    [{report_name}] ERROR: {e}")

        # ── Take screenshots of key pages for debugging ─────────
        print("\n━━━ SCREENSHOTS ━━━")
        for name, url in [
            ("dashboard", "Dashboard/Index"),
            ("inventory", "Inventory/Index"),
            ("menu", "Menu/Saucer"),
        ]:
            try:
                await page.goto(f"{WANSOFT_URL}/{url}", wait_until="load", timeout=20000)
                await asyncio.sleep(3)
                await page.screenshot(path=f"/tmp/{name}.png", full_page=False)
                print(f"  [✓] Screenshot: {name}")
            except Exception as e:
                print(f"  [!] Screenshot {name}: {e}")

        await browser.close()

    # ── Summary ──────────────────────────────────────────────
    elapsed = int((time.time() - start) * 1000)
    print(f"\n{'=' * 60}")
    print(f"RESULTS — {len(results)} sections with data")
    for k, v in sorted(results.items()):
        print(f"  {k}: {v}")
    print(f"Total time: {elapsed}ms")

    # Telegram
    msg = f"🌐 BROWSER SCRAPE — {today_str}\n{len(results)} secciones con datos:\n\n"
    for k, v in sorted(results.items()):
        msg += f"• {k}: {v}\n"
    msg += f"\n⏱ {elapsed / 1000:.1f}s"
    send_telegram(msg)

    # Log
    try:
        requests.post(f"{SUPABASE_URL}/rest/v1/agent_runs", headers=sb_headers,
                      json={"agent_id": "wansoft-browser-scraper", "trigger_type": os.environ.get("TRIGGER_TYPE", "cron"),
                            "status": "success", "duration_ms": elapsed,
                            "output_summary": json.dumps(results)[:500], "tentacle": "ops"})
    except:
        pass


if __name__ == "__main__":
    asyncio.run(run())
