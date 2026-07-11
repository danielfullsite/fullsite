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

        if "Dashboard" not in page.url and "MyDocumentsList" not in page.url:
            print(f"[!] Login failed. URL: {page.url}")
            await browser.close()
            try:
                requests.post(f"{SUPABASE_URL}/rest/v1/agent_runs", headers=sb_headers,
                              json={"agent_id": "wansoft-browser-scraper", "trigger_type": os.environ.get("TRIGGER_TYPE", "cron"),
                                    "status": "error", "duration_ms": int((time.time() - start) * 1000),
                                    "output_summary": f"login_failed url={page.url}", "tentacle": "ops"})
            except:
                pass
            sys.exit(1)

        print("[✓] Login OK\n")

        # ── XHR interceptor — captures JSON responses from ALL Wansoft AJAX calls ──
        # This is the KEY mechanism: Wansoft uses jqGrid which loads data via AJAX.
        # Capturing the JSON response directly is more reliable than parsing rendered HTML.
        captured_responses = []

        def _is_telemetry(data):
            """Detect New Relic / analytics JSON — NOT real data."""
            if isinstance(data, dict):
                if "nrServerTime" in data or "entityGuid" in str(data)[:200]:
                    return True
                if set(data.keys()) & {"stn", "err", "ins", "spa", "sr", "srs"}:
                    return True
            return False

        async def capture_response(response):
            url = response.url
            if "wansoft.net" not in url:
                return
            if any(s in url.lower() for s in ["newrelic", "nr-data", "bam.", "analytics"]):
                return
            ct = response.headers.get("content-type", "")
            if "json" in ct or "javascript" in ct:
                try:
                    body = await response.json()
                    if body and not _is_telemetry(body) and (isinstance(body, list) or (isinstance(body, dict) and len(body) > 0)):
                        captured_responses.append({"url": url, "data": body, "status": response.status})
                except Exception:
                    pass

        page.on("response", capture_response)

        # ── GARBAGE DETECTION ────────────────────────────────────────
        NAV_GARBAGE_MARKERS = [
            "Reportes ->", "Inventario ->", "Punto de venta ->", "Administraci",
            "Ecommerce ->", "Egresos ->", "Facturaci", "Configuraci",
            "App Menu", "Calendar", "File Manager", "Taskboard", "Notifications",
            "Project Status", "Project Name", "Admin Template",
        ]

        def is_garbage_data(rows):
            """Detect if scraped data is actually sidebar/navigation content."""
            if not rows or not isinstance(rows, list):
                return False
            sample = str(rows[0]) if rows else ""
            return any(marker in sample for marker in NAV_GARBAGE_MARKERS)

        # ── SMART WAIT — wait for jqGrid/table data, not arbitrary sleep ──
        async def wait_for_data(timeout_ms=15000):
            """Wait for actual data to appear in DOM (jqGrid rows, table rows, or report rows)."""
            selectors = [
                '.jqgrow',                    # jqGrid data rows
                'table.table tbody tr td',    # Bootstrap tables
                '.rowReport',                 # Wansoft report rows
                'table tbody tr:nth-child(2)', # Any table with >1 row
                '.ui-jqgrid-bdiv tr',         # jqGrid body div
            ]
            for sel in selectors:
                try:
                    await page.wait_for_selector(sel, timeout=timeout_ms // len(selectors))
                    print(f"    [wait] Found data via: {sel}")
                    return True
                except Exception:
                    continue
            print(f"    [wait] No data selectors found after {timeout_ms}ms")
            return False

        # ── EXTRACT DATA — prefers XHR JSON, falls back to DOM ──
        def extract_xhr_data(url_fragment=None):
            """Get data from captured XHR responses. Returns list of rows or None."""
            for resp in reversed(captured_responses):  # newest first
                if url_fragment and url_fragment not in resp["url"]:
                    continue
                data = resp["data"]
                # jqGrid returns {rows: [...], total: N, page: N}
                if isinstance(data, dict) and "rows" in data:
                    rows = data["rows"]
                    if isinstance(rows, list) and len(rows) > 0:
                        # jqGrid rows have {id, cell: [...]}
                        if isinstance(rows[0], dict) and "cell" in rows[0]:
                            return [r["cell"] for r in rows]
                        return rows
                # Direct array response
                if isinstance(data, list) and len(data) > 0:
                    return data
                # Dict with data key
                if isinstance(data, dict) and "data" in data:
                    return data["data"] if isinstance(data["data"], list) else [data["data"]]
            return None

        async def extract_dom_data():
            """Extract table data from DOM, filtering out sidebar/nav garbage."""
            return await page.evaluate("""() => {
                const results = [];
                const GARBAGE = ['Reportes ->', 'Inventario ->', 'Punto de venta ->',
                    'App Menu', 'Calendar', 'File Manager', 'Taskboard',
                    'Project Status', 'Admin Template', 'Notifications'];

                // Helper: check if text looks like navigation
                const isNavText = (text) => GARBAGE.some(g => text.includes(g));

                // Try jqGrid first (most Wansoft reports use this)
                const jqRows = document.querySelectorAll('.jqgrow, .ui-jqgrid-bdiv tr[role="row"]');
                if (jqRows.length > 0) {
                    for (const row of jqRows) {
                        const cols = Array.from(row.querySelectorAll('td')).map(td => td.textContent.trim());
                        if (cols.length >= 2 && !isNavText(cols.join(' '))) {
                            results.push(cols);
                        }
                    }
                    if (results.length > 0) return {type: 'jqgrid', count: results.length, data: results};
                }

                // Try .rowReport divs
                const reportRows = document.querySelectorAll('.rowReport');
                if (reportRows.length > 0) {
                    for (const row of reportRows) {
                        const cols = Array.from(row.querySelectorAll(':scope > div')).map(d => d.textContent.trim());
                        const text = cols.join(' ');
                        if (cols.length >= 2 && !isNavText(text) && cols.some(c => c && c.length < 100)) {
                            results.push(cols);
                        }
                    }
                    if (results.length > 0) return {type: 'rowReport', count: results.length, data: results};
                }

                // Try regular tables (skip sidebar tables)
                const tables = document.querySelectorAll('table');
                for (const table of tables) {
                    // Skip tables inside sidebar/nav
                    const parent = table.closest('nav, aside, [class*="sidebar"], [class*="menu"]');
                    if (parent) continue;
                    const trs = table.querySelectorAll('tbody tr, tr');
                    if (trs.length >= 2) {
                        let headers = [];
                        for (const tr of trs) {
                            const ths = Array.from(tr.querySelectorAll('th')).map(th => th.textContent.trim());
                            if (ths.length >= 2) { headers = ths; continue; }
                            const cols = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
                            if (cols.length >= 2 && !isNavText(cols.join(' '))) {
                                results.push(cols);
                            }
                        }
                        if (results.length > 0) return {type: 'table', count: results.length, data: results, headers: headers};
                    }
                }

                return {type: 'empty', count: 0, data: []};
            }""")

        # ── MASTER SCRAPE FUNCTION ────────────────────────────────────
        async def scrape_page(name, url, wait_selector=None, wait_time=3, date_range=None):
            """Navigate to page, wait for data, extract via XHR or DOM."""
            print(f"  [{name}] → {url}")
            try:
                # Clear XHR captures for this page
                captured_responses.clear()

                await page.goto(f"{WANSOFT_URL}/{url}", wait_until="load", timeout=30000)
                await asyncio.sleep(2)  # Minimal wait for DOM

                # Close modals
                await page.evaluate("""() => {
                    document.querySelectorAll('.ui-widget-overlay, .modal-backdrop').forEach(el => el.remove());
                    document.querySelectorAll('.ui-dialog').forEach(el => el.remove());
                }""")

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
                    const multiSel = document.querySelector('select[multiple]');
                    if (multiSel) {{
                        for (const o of multiSel.options) o.selected = true;
                        multiSel.dispatchEvent(new Event('change', {{bubbles: true}}));
                    }}
                }}""")
                await asyncio.sleep(1)

                # Set date range if provided
                if date_range:
                    start_d, end_d = date_range
                    await page.evaluate(f"""() => {{
                        const inputs = document.querySelectorAll('input');
                        for (const inp of inputs) {{
                            const id = (inp.id || inp.name || '').toLowerCase();
                            if (id.includes('start') || id.includes('inicio')) {{
                                inp.value = '{start_d}';
                                inp.dispatchEvent(new Event('change', {{bubbles: true}}));
                            }}
                            if (id.includes('end') || id.includes('fin')) {{
                                inp.value = '{end_d}';
                                inp.dispatchEvent(new Event('change', {{bubbles: true}}));
                            }}
                        }}
                    }}""")
                    await asyncio.sleep(1)

                # Click search button
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

                # SMART WAIT — wait for actual data rows instead of arbitrary sleep
                await wait_for_data(timeout_ms=15000)

                # Additional wait for slow jqGrid renders
                await asyncio.sleep(wait_time)

                # 1. Try XHR data first (most reliable — JSON from AJAX)
                xhr_data = extract_xhr_data()
                if xhr_data and not is_garbage_data(xhr_data):
                    print(f"    [XHR] Captured {len(xhr_data)} rows from AJAX")
                    return {"type": "xhr", "count": len(xhr_data), "data": xhr_data}

                # 2. Fall back to DOM extraction
                dom_data = await extract_dom_data()
                if dom_data.get("count", 0) > 0 and not is_garbage_data(dom_data.get("data", [])):
                    print(f"    [DOM] Extracted {dom_data['count']} rows ({dom_data['type']})")
                    return dom_data

                # 3. Nothing found — log debug info
                print(f"    [!] No data found. XHR captured: {len(captured_responses)}, taking screenshot...")
                await page.screenshot(path=f"/tmp/debug_{name}.png", full_page=True)
                raw_text = await page.evaluate("() => document.body?.textContent?.substring(0, 2000) || ''")
                print(f"    [debug] Page text preview: {raw_text[:300]}")
                return {"type": "empty", "count": 0, "data": []}

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

        # ── FOOD COST (Browser — critical for "cuanto cuesta X" queries) ───
        print("\n━━━ FOOD COST (Browser) ━━━")

        from datetime import timedelta as td
        thirty_ago = (now_mx - td(days=30)).strftime("%Y-%m-%d")

        # Food cost by dish (30 days)
        fc_data = await scrape_page("FoodCost", "Reports/GetCostBySaucer",
                                     wait_time=5, date_range=(thirty_ago, today_str))
        await page.screenshot(path="/tmp/food_cost.png", full_page=True)

        if fc_data.get("count", 0) > 0:
            raw = fc_data.get("data", [])
            cost_items = [{"_cols": r} if isinstance(r, list) else r for r in raw]
            sb_upsert("wansoft_data", {
                "client_id": CLIENT["id"], "fecha": today_str,
                "data_key": "food_cost_browser",
                "data": json.dumps(cost_items),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            results["food_cost"] = len(cost_items)
        else:
            results["food_cost"] = "0 items"

        # Saucers with cost (master list)
        sc_data = await scrape_page("SaucersWithCost", "Reports/GetSaucersWithCost", wait_time=5)
        await page.screenshot(path="/tmp/saucers_with_cost.png", full_page=True)

        if sc_data.get("count", 0) > 0:
            raw = sc_data.get("data", [])
            saucer_items = [{"_cols": r} if isinstance(r, list) else r for r in raw]
            sb_upsert("wansoft_data", {
                "client_id": CLIENT["id"], "fecha": today_str,
                "data_key": "saucers_cost_browser",
                "data": json.dumps(saucer_items),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            results["saucers_cost"] = len(saucer_items)

        # Tips by mesero (SalesByUser report)
        print("\n━━━ TIPS (Browser) ━━━")
        tips_data = await scrape_page("Tips", "Reports/SalesByUser",
                                       wait_time=5, date_range=(today_str, today_str))
        await page.screenshot(path="/tmp/tips.png", full_page=True)

        if tips_data.get("count", 0) > 0:
            raw = tips_data.get("data", [])
            tips_items = [{"_cols": r} if isinstance(r, list) else r for r in raw]
            sb_upsert("wansoft_data", {
                "client_id": CLIENT["id"], "fecha": today_str,
                "data_key": "tips_browser",
                "data": json.dumps(tips_items),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            results["tips"] = len(tips_items)
        else:
            results["tips"] = "0 items"

        # ══════════════════════════════════════════════════════════════
        # ALL ENDPOINTS THAT FAIL VIA HTTP (empty HTML or 500)
        # These need Playwright's JS rendering to work.
        # ══════════════════════════════════════════════════════════════

        # Helper: scrape and save to wansoft_data
        async def scrape_and_save(name, url, data_key, date_range=None, wait_time=5):
            data = await scrape_page(name, url, wait_time=wait_time, date_range=date_range)
            count = data.get("count", 0)
            if count > 0:
                raw = data.get("data", [])
                items = [{"_cols": r} if isinstance(r, list) else r for r in raw]
                sb_upsert("wansoft_data", {
                    "client_id": CLIENT["id"], "fecha": today_str,
                    "data_key": data_key,
                    "data": json.dumps(items),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
                results[data_key] = count
            else:
                results[data_key] = "0"
            return count

        # ── FOOD COST (4 endpoints — all need JS) ───────────────
        print("\n━━━ FOOD COST (all 4 endpoints) ━━━")

        thirty_ago = (now_mx - __import__('datetime').timedelta(days=30)).strftime("%Y-%m-%d")
        month_start = today_str[:8] + "01"

        await scrape_and_save("CostBySaucer", "Reports/GetCostBySaucer",
                              "food_cost_browser", date_range=(thirty_ago, today_str))
        await page.screenshot(path="/tmp/food_cost.png", full_page=True)

        await scrape_and_save("CostBySaucer-Month", "Reports/GetCostBySaucer",
                              "food_cost_month", date_range=(month_start, today_str))

        await scrape_and_save("CostByGroup", "Reports/GetCostByGroup",
                              "cost_by_group_browser", date_range=(thirty_ago, today_str))

        await scrape_and_save("SaucersWithCost", "Reports/GetSaucersWithCost",
                              "saucers_cost_browser")
        await page.screenshot(path="/tmp/saucers_with_cost.png", full_page=True)

        # ── INVENTORY (6 endpoints — all return 500 via HTTP) ───
        print("\n━━━ INVENTORY (all 6 endpoints) ━━━")

        await scrape_and_save("Inventory", "Inventory/GetInventoryBySubsidiary",
                              "inventory_browser", wait_time=8)
        await page.screenshot(path="/tmp/inventory_detail.png", full_page=True)

        await scrape_and_save("InventoryStatement", "Inventory/GetInventoryStatementBySubsidiary",
                              "inventory_movements_browser", date_range=(thirty_ago, today_str))

        await scrape_and_save("ReorderPoint", "Inventory/GetReorderPointReport",
                              "reorder_point_browser")

        await scrape_and_save("PhysicalVsSystem", "Inventory/GetPhysicalInventoryVsSystem",
                              "physical_vs_system_browser")

        await scrape_and_save("ProductsInRecipes", "Inventory/GetProductsThatAreInRecipes",
                              "products_in_recipes_browser")

        await scrape_and_save("ProductsNotInRecipes", "Inventory/GetProductsThatAreNotInRecipes",
                              "products_not_in_recipes_browser")

        # ── PROCUREMENT (2 empty endpoints) ─────────────────────
        print("\n━━━ PROCUREMENT (empty endpoints) ━━━")

        await scrape_and_save("PO_Issued", "Purchasing/GetPurchaseOrderIssued",
                              "purchase_orders_browser")

        await scrape_and_save("SupplierList", "Purchasing/GetSupplierList",
                              "supplier_list_browser")

        # ── STAFF/LABOR (4 endpoints — all empty via HTTP) ──────
        print("\n━━━ STAFF/LABOR (all 4 endpoints) ━━━")

        await scrape_and_save("AccessControl", "Staff/GetAccessControlReport",
                              "access_control_browser", date_range=(today_str, today_str))

        await scrape_and_save("HoursWorked", "Staff/GetUserHoursWorkedReport",
                              "hours_worked_browser", date_range=(today_str, today_str))

        await scrape_and_save("PosUsers", "Staff/GetPosUsersList",
                              "pos_users_browser")

        await scrape_and_save("Shifts", "Staff/GetShiftList",
                              "shifts_browser")

        # ── FINANCE (3 empty endpoints) ─────────────────────────
        print("\n━━━ FINANCE (empty endpoints) ━━━")

        await scrape_and_save("ClosingCash", "Reports/ClosingCash",
                              "closing_cash_browser", date_range=(today_str, today_str))
        await page.screenshot(path="/tmp/closing_cash.png", full_page=True)

        await scrape_and_save("CashFlow", "Finance/GetCashFlowList",
                              "cash_flow_browser")

        await scrape_and_save("BankDeposits", "Finance/GetBankDepositList",
                              "bank_deposits_browser")

        # ── TIPS (already done above, but also add weekly range) ─
        print("\n━━━ TIPS WEEKLY ━━━")

        week_start = (now_mx - __import__('datetime').timedelta(days=now_mx.weekday())).strftime("%Y-%m-%d")
        await scrape_and_save("TipsWeekly", "Reports/SalesByUser",
                              "tips_weekly_browser", date_range=(week_start, today_str))

        # ── BILLING (empty via HTTP) ────────────────────────────
        print("\n━━━ BILLING ━━━")

        await scrape_and_save("Invoices", "Billing/GetDocumentList",
                              "invoices_browser", date_range=(month_start, today_str))

        # ── MENU CONFIG (empty via HTTP) ────────────────────────
        print("\n━━━ MENU CONFIG (empty endpoints) ━━━")

        await scrape_and_save("MenuGroups", "Menu/GetGroupList",
                              "menu_groups_browser")

        await scrape_and_save("MenuSaucers", "Menu/GetSaucerList",
                              "menu_saucers_browser")

        await scrape_and_save("MenuComplements", "Menu/GetComplementaryList",
                              "menu_complements_browser")

        await scrape_and_save("MenuPromotions", "Menu/GetPromotionList",
                              "menu_promotions_browser")

        # ══════════════════════════════════════════════════════════════
        # EXISTING SECTIONS (kept for backward compatibility)
        # ══════════════════════════════════════════════════════════════

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

        # ── PROMOTIONS (Browser — uses scrape_page with XHR capture) ───
        print("\n━━━ PROMOTIONS (Browser) ━━━")

        # Try multiple known paths for promotions
        promo_data = None
        for promo_url in ["PointOfSale/Promotion", "Restaurant/Promotion", "Menu/PromotionList"]:
            promo_data = await scrape_page("Promotions", promo_url, wait_time=5)
            if promo_data.get("count", 0) > 0 and not is_garbage_data(promo_data.get("data", [])):
                print(f"    [✓] Found promotions at: {promo_url}")
                break
            promo_data = None

        # Fallback: sidebar navigation
        if not promo_data or promo_data.get("count", 0) == 0:
            print("    [!] Trying sidebar navigation...")
            try:
                await page.goto(f"{WANSOFT_URL}/Dashboard/Index", wait_until="load", timeout=15000)
                await asyncio.sleep(2)
                for menu_text in ["Punto de venta", "Restaurante", "Promociones"]:
                    try:
                        link = page.locator(f"text={menu_text}").first
                        await link.click(timeout=5000)
                        await asyncio.sleep(2)
                    except Exception:
                        pass
                await wait_for_data(timeout_ms=10000)
                xhr_data = extract_xhr_data()
                if xhr_data and not is_garbage_data(xhr_data):
                    promo_data = {"type": "xhr", "count": len(xhr_data), "data": xhr_data}
                else:
                    dom_data = await extract_dom_data()
                    if dom_data.get("count", 0) > 0:
                        promo_data = dom_data
            except Exception as e:
                print(f"    Sidebar nav error: {e}")

        await page.screenshot(path="/tmp/promotions.png", full_page=True)

        if promo_data and promo_data.get("count", 0) > 0:
            raw = promo_data.get("data", [])
            promos_parsed = [{"_cols": r} if isinstance(r, list) else r for r in raw]
            sb_upsert("wansoft_data", {
                "client_id": CLIENT["id"], "fecha": today_str,
                "data_key": "promotions_browser",
                "data": json.dumps(promos_parsed),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            results["promociones"] = len(promos_parsed)
        else:
            results["promociones"] = "0 items"

        # ── DISCOUNTS & COURTESIES DETAIL (Browser) ─────────────────
        print("\n━━━ DISCOUNTS DETAIL (Browser) ━━━")

        for report_name, report_url, data_key in [
            ("Descuentos", "Reports/DiscountsDetail", "discounts_detail_browser"),
            ("Cortesias", "Reports/CourtesiesDetail", "courtesies_browser"),
        ]:
            detail_data = await scrape_page(report_name, report_url,
                                             wait_time=5, date_range=(today_str, today_str))
            await page.screenshot(path=f"/tmp/{data_key}.png", full_page=True)

            if detail_data.get("count", 0) > 0:
                raw = detail_data.get("data", [])
                parsed = [{"_cols": r} if isinstance(r, list) else r for r in raw]
                sb_upsert("wansoft_data", {
                    "client_id": CLIENT["id"], "fecha": today_str,
                    "data_key": data_key,
                    "data": json.dumps(parsed),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
                results[data_key] = len(parsed)
            else:
                results[data_key] = "0 items"

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
