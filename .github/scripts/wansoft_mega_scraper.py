#!/usr/bin/env python3
"""
Wansoft MEGA Scraper — Custom Playwright interactions per page.
Every endpoint gets its own scrape function with specific form interactions.
Captures data via XHR JSON interception (most reliable) + DOM fallback.

This replaces the generic scrape_page() approach that fails because Wansoft
pages need specific form interactions (each page has different dropdowns,
date pickers, search buttons with unique IDs).

Strategy:
1. Login with Playwright
2. For EVERY page: navigate, interact with forms, wait for XHR, capture JSON
3. Save everything to wansoft_data in Supabase
4. Take screenshots for debugging
"""

import asyncio
import json
import os
import sys
import time
import requests
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(__file__))
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

now_mx = datetime.now(MX_TZ)
TODAY = now_mx.strftime("%Y-%m-%d")
YESTERDAY = (now_mx - timedelta(days=1)).strftime("%Y-%m-%d")
THIRTY_AGO = (now_mx - timedelta(days=30)).strftime("%Y-%m-%d")
MONTH_START = TODAY[:8] + "01"
YEAR = TODAY[:4]


def sb_upsert(table, data):
    r = requests.post(f"{SUPABASE_URL}/rest/v1/{table}", headers=sb_headers, json=data, timeout=15)
    if not r.ok:
        print(f"    [!] Supabase {table}: {r.status_code} {r.text[:200]}")
    return r.ok


def save_data(key, data):
    if data:
        sb_upsert("wansoft_data", {
            "client_id": CLIENT["id"], "fecha": TODAY, "data_key": key,
            "data": json.dumps(data) if not isinstance(data, str) else data,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })


def send_telegram(msg):
    if not TG_CHAT_ID:
        return
    for chunk in [msg[i:i + 4000] for i in range(0, len(msg), 4000)]:
        requests.post(f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                      json={"chat_id": TG_CHAT_ID, "text": chunk})


async def run():
    from playwright.async_api import async_playwright

    start_time = time.time()
    results = {}
    errors = []

    print(f"{'='*60}")
    print(f"WANSOFT MEGA SCRAPER — {TODAY}")
    print(f"{'='*60}")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 900})
        page = await ctx.new_page()

        # ── UNIVERSAL XHR CAPTURE ──────────────────────────────────
        captured_xhr = []

        # URLs to SKIP in XHR capture (telemetry, analytics, not real data)
        SKIP_XHR_URLS = ["newrelic", "nr-data", "bam.", "google-analytics", "analytics",
                         "gtag", "facebook", "sentry", "hotjar", "clarity"]

        def is_telemetry(data):
            """Detect New Relic / analytics telemetry disguised as data."""
            if isinstance(data, dict):
                keys = set(data.keys())
                # New Relic signature: stn, err, ins, spa, nrServerTime, entityGuid
                if "nrServerTime" in keys or "entityGuid" in str(data):
                    return True
                if keys & {"stn", "err", "ins", "spa", "sr", "srs", "st", "sts"}:
                    return True
                if "app" in keys and "agents" in str(data.get("app", "")):
                    return True
            return False

        async def on_response(response):
            url = response.url
            if "wansoft.net" not in url:
                return
            # Skip known telemetry URLs
            if any(skip in url.lower() for skip in SKIP_XHR_URLS):
                return
            ct = response.headers.get("content-type", "")
            if "json" in ct or "javascript" in ct:
                try:
                    body = await response.json()
                    if body and not is_telemetry(body):
                        captured_xhr.append({"url": url, "data": body})
                except Exception:
                    pass

        page.on("response", on_response)

        def get_xhr_data(url_contains=None):
            """Get captured XHR data, optionally filtered by URL. Skips telemetry."""
            for resp in reversed(captured_xhr):
                if url_contains and url_contains not in resp["url"]:
                    continue
                d = resp["data"]
                # Double-check: skip if telemetry slipped through
                if is_telemetry(d):
                    continue
                if isinstance(d, list) and len(d) > 0:
                    return d
                if isinstance(d, dict):
                    if "rows" in d and isinstance(d["rows"], list):
                        # jqGrid format: extract cell arrays
                        rows = d["rows"]
                        if rows and isinstance(rows[0], dict) and "cell" in rows[0]:
                            return [r["cell"] for r in rows]
                        return rows
                    if "data" in d and isinstance(d["data"], list):
                        return d["data"]
                    if len(d) > 0:
                        return d
            return None

        # ── LOGIN ──────────────────────────────────────────────────
        print("\n[login] Logging in...")
        await page.goto(f"{WANSOFT_URL}/", wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(2)
        await page.fill('input[name="UserName"]', WANSOFT_USER)
        await page.fill('input[name="Password"]', WANSOFT_PASS)
        await page.click('input[type="submit"]')
        await asyncio.sleep(3)

        if "Dashboard" not in page.url and "MyDocumentsList" not in page.url:
            print(f"[!] Login failed: {page.url}")
            await browser.close()
            try:
                requests.post(f"{SUPABASE_URL}/rest/v1/agent_runs", headers=sb_headers,
                              json={"agent_id": "wansoft-mega-scraper", "trigger_type": os.environ.get("TRIGGER_TYPE", "cron"),
                                    "status": "error", "duration_ms": int((time.time() - start_time) * 1000),
                                    "output_summary": f"login_failed url={page.url}", "tentacle": "ops"})
            except:
                pass
            sys.exit(1)

        print("[✓] Login OK\n")

        # ── HELPER: Navigate, fill form, search, capture ──────────
        async def scrape_report(name, url, date_start=None, date_end=None, screenshot=None):
            """
            Navigate to a Wansoft report page, fill date range, click search,
            wait for data, capture via XHR or DOM.
            """
            print(f"\n  [{name}] → {url}")
            captured_xhr.clear()

            try:
                await page.goto(f"{WANSOFT_URL}/{url}", wait_until="load", timeout=30000)
                await asyncio.sleep(2)

                # Close modals
                await page.evaluate("""() => {
                    document.querySelectorAll('.ui-widget-overlay, .modal-backdrop').forEach(el => el.remove());
                    document.querySelectorAll('.ui-dialog').forEach(el => el.remove());
                }""")

                # Fill subsidiary dropdown
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
                    // Multi-selects: select all
                    document.querySelectorAll('select[multiple]').forEach(sel => {{
                        for (const o of sel.options) o.selected = true;
                        sel.dispatchEvent(new Event('change', {{bubbles: true}}));
                    }});
                }}""")
                await asyncio.sleep(1)

                # Fill date range using JavaScript (handles readonly inputs)
                if date_start or date_end:
                    await page.evaluate(f"""() => {{
                        const setDateInput = (input, value) => {{
                            // Force set value bypassing readonly
                            Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
                            input.dispatchEvent(new Event('input', {{bubbles: true}}));
                            input.dispatchEvent(new Event('change', {{bubbles: true}}));
                            // Also try jQuery trigger if available
                            if (window.jQuery) jQuery(input).val(value).trigger('change');
                        }};
                        const inputs = document.querySelectorAll('input');
                        for (const inp of inputs) {{
                            const id = (inp.id || inp.name || '').toLowerCase();
                            if ((id.includes('start') || id.includes('inicio') || id === 'startdate') && '{date_start}') {{
                                setDateInput(inp, '{date_start}');
                            }}
                            if ((id.includes('end') || id.includes('fin') || id === 'enddate') && '{date_end}') {{
                                setDateInput(inp, '{date_end}');
                            }}
                        }}
                        // Also try #startDate and #endDate directly
                        const sd = document.querySelector('#startDate, #StartDate, [name="startDate"]');
                        const ed = document.querySelector('#endDate, #EndDate, [name="endDate"]');
                        if (sd && '{date_start}') setDateInput(sd, '{date_start}');
                        if (ed && '{date_end}') setDateInput(ed, '{date_end}');
                    }}""")
                    await asyncio.sleep(1)

                # Click search/filter button
                clicked = await page.evaluate("""() => {
                    // Try specific IDs first (Wansoft common patterns)
                    for (const id of ['btnSearch', 'btnBuscar', 'btnConsultar', 'btnFilter', 'btnExport']) {
                        const btn = document.getElementById(id);
                        if (btn) { btn.click(); return id; }
                    }
                    // Try by text content
                    const btns = document.querySelectorAll('button, input[type="button"], input[type="submit"], a.btn');
                    for (const b of btns) {
                        const txt = (b.textContent || b.value || '').toLowerCase();
                        if (txt.includes('buscar') || txt.includes('search') || txt.includes('consultar') || txt.includes('filtrar')) {
                            b.click();
                            return 'text:' + txt.trim().substring(0, 20);
                        }
                    }
                    return null;
                }""")
                if clicked:
                    print(f"    Clicked: {clicked}")
                else:
                    print(f"    No search button found")

                # Wait for data to load — single aggressive wait
                try:
                    await page.wait_for_selector(
                        '.jqgrow, table tbody tr td, .rowReport, .ui-jqgrid-bdiv tr',
                        timeout=8000
                    )
                    print(f"    Data appeared")
                except Exception:
                    # Brief extra wait then continue
                    await asyncio.sleep(3)

                # Take screenshot
                if screenshot:
                    await page.screenshot(path=f"/tmp/{screenshot}.png", full_page=True)

                # 1. Try XHR capture first (JSON — most reliable)
                xhr_data = get_xhr_data()
                if xhr_data:
                    count = len(xhr_data) if isinstance(xhr_data, list) else 1
                    print(f"    [XHR] {count} items captured")
                    return {"type": "xhr", "data": xhr_data, "count": count}

                # 2. DOM extraction
                dom = await page.evaluate("""() => {
                    const results = [];
                    const GARBAGE = ['Reportes ->', 'Inventario ->', 'Punto de venta ->',
                        'App Menu', 'Calendar', 'File Manager', 'Admin Template'];
                    const isGarbage = (text) => GARBAGE.some(g => text.includes(g));

                    // jqGrid rows
                    for (const tr of document.querySelectorAll('.jqgrow, .ui-jqgrid-bdiv tr[role="row"]')) {
                        const cols = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
                        if (cols.length >= 2 && !isGarbage(cols.join(' '))) results.push(cols);
                    }
                    if (results.length > 0) return {t: 'jqgrid', d: results};

                    // .rowReport divs
                    for (const row of document.querySelectorAll('.rowReport')) {
                        const cols = Array.from(row.querySelectorAll(':scope > div')).map(d => d.textContent.trim());
                        if (cols.length >= 2 && !isGarbage(cols.join(' ')) && cols.some(c => /[$%\\d]/.test(c))) {
                            results.push(cols);
                        }
                    }
                    if (results.length > 0) return {t: 'rowReport', d: results};

                    // Regular tables (skip nav)
                    for (const table of document.querySelectorAll('table')) {
                        if (table.closest('nav, aside, [class*="sidebar"]')) continue;
                        for (const tr of table.querySelectorAll('tr')) {
                            const cols = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
                            if (cols.length >= 2 && !isGarbage(cols.join(' ')) && cols.some(c => /[$%\\d]/.test(c))) {
                                results.push(cols);
                            }
                        }
                        if (results.length > 0) return {t: 'table', d: results};
                    }

                    return {t: 'empty', d: []};
                }""")

                count = len(dom.get("d", []))
                if count > 0:
                    print(f"    [DOM] {count} rows ({dom['t']})")
                    return {"type": dom["t"], "data": dom["d"], "count": count}

                print(f"    [!] No data. XHR: {len(captured_xhr)}")
                return {"type": "empty", "data": [], "count": 0}

            except Exception as e:
                print(f"    ERROR: {e}")
                errors.append(f"{name}: {e}")
                return {"type": "error", "data": [], "count": 0}

        # ══════════════════════════════════════════════════════════════
        # SCRAPE EVERY SECTION
        # ══════════════════════════════════════════════════════════════

        # ── SALES ──────────────────────────────────────────────────
        print("━━━ SALES ━━━")

        for name, endpoint, key in [
            ("SalesByHours", "Reports/SalesByHours", "sales_hours"),
            ("SalesByArea", "Reports/SalesByArea", "sales_area"),
            ("SalesByTerminal", "Reports/SalesByTerminal", "sales_terminal"),
            ("SalesByUser", "Reports/SalesByUser", "sales_by_user"),
            ("SalesByGroup", "Reports/SalesByGroup", "sales_by_group"),
            ("SalesBySaucer", "Reports/SalesBySaucer", "sales_by_saucer"),
            ("SalesByPaymentType", "Reports/SalesByPaymentType", "sales_by_payment"),
            ("SalesByTypeOfOrder", "Reports/SalesByTypeOfOrder", "sales_by_order_type"),
            ("SalesByModifiers", "Reports/SalesByModifiers", "modifiers"),
        ]:
            r = await scrape_report(name, endpoint, TODAY, TODAY)
            if r["count"] > 0:
                save_data(f"{key}_mega", r["data"])
                results[key] = r["count"]

        # ── DISCOUNTS & COURTESIES ─────────────────────────────────
        print("\n━━━ DISCOUNTS & COURTESIES ━━━")

        for name, endpoint, key in [
            ("Discounts", "Reports/DiscountsDetail", "discounts_mega"),
            ("Cancellations", "Reports/CancelSalesDetail", "cancellations_mega"),
            ("Voids", "Reports/SaleNullificationDetail", "voids_mega"),
            ("Courtesies", "Reports/CourtesiesDetail", "courtesies_mega"),
        ]:
            r = await scrape_report(name, endpoint, TODAY, TODAY, screenshot=key)
            if r["count"] > 0:
                save_data(key, r["data"])
                results[key] = r["count"]

        # ── TIPS ───────────────────────────────────────────────────
        print("\n━━━ TIPS ━━━")

        r = await scrape_report("Tips-Today", "Reports/SalesByUser", TODAY, TODAY, screenshot="tips")
        if r["count"] > 0:
            save_data("tips_mega", r["data"])
            results["tips_today"] = r["count"]

        r = await scrape_report("Tips-Week", "Reports/SalesByUser", MONTH_START, TODAY)
        if r["count"] > 0:
            save_data("tips_month_mega", r["data"])
            results["tips_month"] = r["count"]

        # ── FOOD COST ──────────────────────────────────────────────
        print("\n━━━ FOOD COST ━━━")

        for name, endpoint, key, ds, de in [
            ("CostBySaucer-30d", "Reports/GetCostBySaucer", "food_cost_mega", THIRTY_AGO, TODAY),
            ("CostByGroup-30d", "Reports/GetCostByGroup", "cost_group_mega", THIRTY_AGO, TODAY),
            ("SaucersWithCost", "Reports/GetSaucersWithCost", "saucers_cost_mega", None, None),
        ]:
            r = await scrape_report(name, endpoint, ds, de, screenshot=key)
            if r["count"] > 0:
                save_data(key, r["data"])
                results[key] = r["count"]

                # Also write to wansoft_food_cost for the dashboard
                if key == "food_cost_mega":
                    sb_upsert("wansoft_food_cost", {
                        "client_id": CLIENT["id"], "fecha": TODAY,
                        "data": json.dumps(r["data"]),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    })

        # ── INVENTORY ──────────────────────────────────────────────
        print("\n━━━ INVENTORY ━━━")

        for name, endpoint, key in [
            ("Inventory", "Inventory/GetInventoryBySubsidiary", "inventory_mega"),
            ("InventoryStatement", "Inventory/GetInventoryStatementBySubsidiary", "inv_statement_mega"),
            ("ReorderPoint", "Inventory/GetReorderPointReport", "reorder_mega"),
            ("PhysicalVsSystem", "Inventory/GetPhysicalInventoryVsSystem", "shrinkage_mega"),
            ("ProductsInRecipes", "Inventory/GetProductsThatAreInRecipes", "products_recipes_mega"),
            ("ProductsNotInRecipes", "Inventory/GetProductsThatAreNotInRecipes", "products_no_recipes_mega"),
        ]:
            r = await scrape_report(name, endpoint, THIRTY_AGO, TODAY, screenshot=key if key in ["inventory_mega", "reorder_mega"] else None)
            if r["count"] > 0:
                save_data(key, r["data"])
                results[key] = r["count"]

        # ── PROCUREMENT ────────────────────────────────────────────
        print("\n━━━ PROCUREMENT ━━━")

        for name, endpoint, key in [
            ("ShopBySupplier", "Reports/ShopBySupplier", "shop_supplier_mega"),
            ("ShopByProduct", "Reports/ShopByProduct", "shop_product_mega"),
            ("PO_Issued", "Purchasing/GetPurchaseOrderIssued", "po_issued_mega"),
            ("SupplierList", "Purchasing/GetSupplierList", "suppliers_mega"),
        ]:
            r = await scrape_report(name, endpoint, THIRTY_AGO, TODAY)
            if r["count"] > 0:
                save_data(key, r["data"])
                results[key] = r["count"]

        # ── STAFF / LABOR ──────────────────────────────────────────
        print("\n━━━ STAFF / LABOR ━━━")

        for name, endpoint, key in [
            ("AccessControl", "Staff/GetAccessControlReport", "access_control_mega"),
            ("HoursWorked", "Staff/GetUserHoursWorkedReport", "hours_worked_mega"),
            ("PosUsers", "Staff/GetPosUsersList", "pos_users_mega"),
            ("Shifts", "Staff/GetShiftList", "shifts_mega"),
        ]:
            r = await scrape_report(name, endpoint, TODAY, TODAY)
            if r["count"] > 0:
                save_data(key, r["data"])
                results[key] = r["count"]

        # ── FINANCE ────────────────────────────────────────────────
        print("\n━━━ FINANCE ━━━")

        r = await scrape_report("IncomeStatement", "Reports/GetIncomeStatemetByMonthInYear",
                                screenshot="income_statement")
        if r["count"] > 0:
            save_data("income_statement_mega", r["data"])
            results["income_statement"] = r["count"]

        r = await scrape_report("ClosingCash", "Reports/ClosingCash", TODAY, TODAY, screenshot="closing_cash")
        if r["count"] > 0:
            save_data("closing_cash_mega", r["data"])
            results["closing_cash"] = r["count"]

        for name, endpoint, key in [
            ("CashFlow", "Finance/GetCashFlowList", "cash_flow_mega"),
            ("CashWithdrawals", "Reports/GetCashWithdrawalReport", "cash_withdrawals_mega"),
            ("BankDeposits", "Finance/GetBankDepositList", "bank_deposits_mega"),
        ]:
            r = await scrape_report(name, endpoint, MONTH_START, TODAY)
            if r["count"] > 0:
                save_data(key, r["data"])
                results[key] = r["count"]

        # ── ECOMMERCE ──────────────────────────────────────────────
        print("\n━━━ ECOMMERCE ━━━")

        for name, endpoint, key in [
            ("EcomOrders", "ECommerce/GetGeneralOrderStatusList", "ecom_orders_mega"),
            ("EcomMenu", "ECommerce/GetECommerceMenuStatusList", "ecom_menu_mega"),
        ]:
            r = await scrape_report(name, endpoint)
            if r["count"] > 0:
                save_data(key, r["data"])
                results[key] = r["count"]

        # ── BILLING ────────────────────────────────────────────────
        print("\n━━━ BILLING ━━━")

        r = await scrape_report("Invoices", "Billing/GetDocumentList", MONTH_START, TODAY)
        if r["count"] > 0:
            save_data("invoices_mega", r["data"])
            results["invoices"] = r["count"]

        # ── MENU CONFIG ────────────────────────────────────────────
        print("\n━━━ MENU CONFIG ━━━")

        for name, endpoint, key in [
            ("Groups", "Menu/GetGroupList", "menu_groups_mega"),
            ("Saucers", "Menu/GetSaucerList", "menu_saucers_mega"),
            ("Complements", "Menu/GetComplementaryList", "menu_complements_mega"),
            ("Promotions", "Menu/GetPromotionList", "menu_promotions_mega"),
        ]:
            r = await scrape_report(name, endpoint)
            if r["count"] > 0:
                save_data(key, r["data"])
                results[key] = r["count"]

        # ── PROMOTIONS (POS section) ───────────────────────────────
        print("\n━━━ PROMOTIONS (POS) ━━━")

        r = await scrape_report("POS-Promotions", "PointOfSale/Promotion", screenshot="promotions")
        if r["count"] > 0:
            save_data("pos_promotions_mega", r["data"])
            results["pos_promotions"] = r["count"]

        await browser.close()

    # ══════════════════════════════════════════════════════════════
    # SUMMARY
    # ══════════════════════════════════════════════════════════════
    elapsed = int((time.time() - start_time) * 1000)
    total_endpoints = 39
    working = len(results)

    print(f"\n{'='*60}")
    print(f"MEGA SCRAPER RESULTS — {working}/{total_endpoints} endpoints with data")
    print(f"{'='*60}")
    for k, v in sorted(results.items()):
        print(f"  ✓ {k}: {v}")
    if errors:
        print(f"\nErrors ({len(errors)}):")
        for e in errors:
            print(f"  ✗ {e}")
    print(f"\nTotal time: {elapsed/1000:.1f}s")

    # Telegram
    msg = f"🔥 MEGA SCRAPE — {TODAY}\n"
    msg += f"{working}/{total_endpoints} endpoints con datos\n\n"
    for k, v in sorted(results.items()):
        msg += f"✓ {k}: {v}\n"
    if errors:
        msg += f"\n❌ {len(errors)} errores:\n"
        for e in errors[:5]:
            msg += f"  {e}\n"
    msg += f"\n⏱ {elapsed/1000:.1f}s"
    send_telegram(msg)

    # Log
    try:
        requests.post(f"{SUPABASE_URL}/rest/v1/agent_runs", headers=sb_headers,
                      json={"agent_id": "wansoft-mega-scraper", "trigger_type": os.environ.get("TRIGGER_TYPE", "cron"),
                            "status": "success", "duration_ms": elapsed,
                            "output_summary": json.dumps({"working": working, "total": total_endpoints, "results": results})[:500],
                            "tentacle": "ops"})
    except Exception:
        pass


if __name__ == "__main__":
    asyncio.run(run())
