#!/usr/bin/env python3
"""
Wansoft Deep Scraper — Multi-tenant
Scrapes ALL available Wansoft endpoints for deep operational intelligence.
Handles both JSON and HTML responses. Logs everything for debugging.
Runs daily at 11pm MX via GitHub Actions.
"""

import os
import sys
import json
import time
import traceback
import requests
from datetime import date, timedelta, datetime, timezone
from bs4 import BeautifulSoup
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


# ── Wansoft Session ────────────────────────────────────────────────────────
def wansoft_session():
    s = requests.Session()
    s.get(f"{WANSOFT_URL}/")
    resp = s.post(f"{WANSOFT_URL}/", data={
        "UserName": WANSOFT_USER,
        "Password": WANSOFT_PASS,
    }, allow_redirects=True)
    if "Dashboard" not in resp.url:
        raise Exception(f"Wansoft login failed. URL: {resp.url}")
    return s


def safe_float(val):
    try:
        return float(str(val).replace("$", "").replace(",", "").replace("%", "").strip())
    except (ValueError, TypeError):
        return 0


def safe_int(val):
    try:
        return int(float(str(val).replace(",", "").strip()))
    except (ValueError, TypeError):
        return 0


# Navigation garbage markers — these appear when scraper captures sidebar/menu instead of data
NAV_GARBAGE_MARKERS = [
    "Reportes ->", "Inventario ->", "Punto de venta ->", "Administraci",
    "Ecommerce ->", "Egresos ->", "Facturaci", "Configuraci",
    "App Menu", "Calendar", "File Manager", "Taskboard", "Notifications",
    "Project Status", "Project Name", "Admin Template",
    "Conoce el escritorio", "Crear un platillo", "Crear un grupo",
]


def is_garbage_row(cols):
    """Detect if a row is actually sidebar/navigation content, not real data."""
    text = " ".join(str(c) for c in cols)
    return any(marker in text for marker in NAV_GARBAGE_MARKERS)


def parse_html_rows(html):
    """Parse .rowReport rows → list of column arrays. Filters out navigation garbage."""
    soup = BeautifulSoup(html, "html.parser")
    rows = soup.select(".rowReport")
    results = []
    for row in rows:
        cols = [c.text.strip() for c in row.select("div")]
        if cols and any(c for c in cols) and not is_garbage_row(cols):
            results.append(cols)
    return results


def parse_any_table(html):
    """Try to parse any table structure from HTML. Filters navigation garbage."""
    soup = BeautifulSoup(html, "html.parser")

    # Try .rowReport first
    rows = soup.select(".rowReport")
    if rows:
        results = []
        for row in rows:
            cols = [c.text.strip() for c in row.select("div")]
            if cols and any(c for c in cols) and not is_garbage_row(cols):
                results.append(cols)
        if results:
            return results

    # Try regular table
    tables = soup.select("table")
    if tables:
        results = []
        for tr in tables[0].select("tr"):
            cols = [td.text.strip() for td in tr.select("td")]
            if cols and any(c for c in cols) and not is_garbage_row(cols):
                results.append(cols)
        if results:
            return results

    # Try any divs with data pattern
    all_divs = soup.select("div[class*='row'], div[class*='item'], div[class*='record']")
    if all_divs:
        results = []
        for div in all_divs:
            text = div.get_text(separator="|").strip()
            if text and not any(m in text for m in NAV_GARBAGE_MARKERS):
                results.append(text.split("|"))
        if results:
            return results

    return []


def try_json_or_html(response):
    """Try to parse response as JSON first, then HTML."""
    try:
        data = response.json()
        if data:
            return {"type": "json", "data": data}
    except (ValueError, json.JSONDecodeError):
        pass

    rows = parse_any_table(response.text)
    if rows:
        return {"type": "html", "data": rows}

    # Return raw text snippet for debugging
    text = response.text[:500].strip()
    return {"type": "empty", "data": [], "raw_preview": text}


def sb_upsert(table, data):
    """Upsert to Supabase."""
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=sb_headers,
        json=data,
        timeout=15,
    )
    if not r.ok:
        print(f"    [!] Supabase {table}: {r.status_code} {r.text[:200]}")
    else:
        print(f"    [✓] Saved to {table}")
    return r.ok


def wansoft_post(session, path, data=None, timeout=30):
    """POST to Wansoft and return parsed result."""
    url = f"{WANSOFT_URL}/{path}"
    r = session.post(url, data=data or {}, timeout=timeout)
    return try_json_or_html(r), r.status_code


# ── Scrape Functions ─────────────────────────────────────────────────────

def scrape_endpoint(session, name, path, params, table, transform_fn):
    """Generic scraper: hit endpoint, transform data, save to Supabase."""
    print(f"\n  [{name}] → {path}")
    try:
        result, status = wansoft_post(session, path, params)
        print(f"    Status: {status}, Type: {result['type']}, Items: {len(result['data']) if isinstance(result['data'], list) else 'dict'}")

        if result["type"] == "empty":
            preview = result.get("raw_preview", "")[:150]
            print(f"    Empty response. Preview: {preview}")
            return None

        transformed = transform_fn(result)
        if transformed and (isinstance(transformed, list) and len(transformed) > 0 or isinstance(transformed, dict) and len(transformed) > 0):
            return transformed
        else:
            print(f"    No data after transform")
            return None
    except Exception as e:
        print(f"    ERROR: {e}")
        return None


def main():
    start = time.time()
    now_mx = datetime.now(MX_TZ)
    today_str = now_mx.strftime("%Y-%m-%d")
    month_start = today_str[:8] + "01"
    thirty_ago = (now_mx - timedelta(days=30)).strftime("%Y-%m-%d")
    year = today_str[:4]

    print(f"{'='*60}")
    print(f"WANSOFT DEEP SCRAPER — {today_str}")
    print(f"Client: {CLIENT['id']}, Subsidiary: {SUBSIDIARY_ID}")
    print(f"{'='*60}")

    try:
        session = wansoft_session()
        print("[✓] Login OK\n")
    except Exception as e:
        print(f"[✗] Login FAILED: {e}")
        sys.exit(1)

    results = {}
    # Use yesterday for endpoints that return empty at midnight (SalesByUser, etc.)
    yesterday_str = (now_mx - timedelta(days=1)).strftime("%Y-%m-%d")
    base_params = {"subsidiaryId": SUBSIDIARY_ID, "startDate": today_str, "endDate": today_str}
    yesterday_params = {"subsidiaryId": SUBSIDIARY_ID, "startDate": yesterday_str, "endDate": yesterday_str}
    range_params = {"subsidiaryId": SUBSIDIARY_ID, "startDate": thirty_ago, "endDate": today_str}
    month_params = {"subsidiaryId": SUBSIDIARY_ID, "startDate": month_start, "endDate": today_str}

    # ══════════════════════════════════════════════════════════════
    # SALES ENDPOINTS
    # ══════════════════════════════════════════════════════════════
    print("━━━ SALES ━━━")

    # 1. Sales by hour (already in intraday but we want personas too)
    def transform_hours(r):
        if r["type"] == "html":
            return [{"hora": c[0], "ventas": safe_float(c[3]) if len(c) > 3 else safe_float(c[-1]),
                      "pct": c[4] if len(c) > 4 else ""} for c in r["data"] if len(c) >= 2]
        return r["data"] if isinstance(r["data"], list) else []

    hours = scrape_endpoint(session, "SalesByHours", "Reports/SalesByHours", base_params,
                            "wansoft_persons_hourly", transform_hours)
    if hours:
        sb_upsert("wansoft_persons_hourly", {"client_id": CLIENT["id"], "fecha": today_str,
                   "data": json.dumps(hours), "updated_at": datetime.now(timezone.utc).isoformat()})
        results["ventas_hora"] = len(hours)

    # 2. Sales by area
    def transform_generic(r):
        """Parse generic endpoints — preserve nombre+total AND all raw columns."""
        if r["type"] == "json": return r["data"]
        if r["type"] == "html":
            items = []
            for c in r["data"]:
                if len(c) >= 2:
                    item = {"nombre": c[0], "total": safe_float(c[-1])}
                    # Preserve ALL columns for discovery/debugging
                    if len(c) > 2:
                        item["_cols"] = c
                    items.append(item)
            return items
        return []

    # Helper: save any endpoint data to wansoft_data table
    def save_data(key, data):
        if data:
            sb_upsert("wansoft_data", {
                "client_id": CLIENT["id"], "fecha": today_str, "data_key": key,
                "data": json.dumps(data), "updated_at": datetime.now(timezone.utc).isoformat(),
            })

    areas = scrape_endpoint(session, "SalesByArea", "Reports/SalesByArea", base_params,
                            None, transform_generic)
    if areas:
        save_data("sales_area", areas)
        results["areas"] = len(areas)

    # 3. Sales by terminal
    terminals = scrape_endpoint(session, "SalesByTerminal", "Reports/SalesByTerminal", base_params,
                                None, transform_generic)
    if terminals:
        save_data("sales_terminal", terminals)
        results["terminales"] = len(terminals)

    # 4. Discounts detail — capture ALL columns for fraud detection
    def transform_discounts(r):
        if r["type"] == "json": return r["data"]
        if r["type"] == "html":
            items = []
            for c in r["data"]:
                if len(c) >= 2:
                    item = {"nombre": c[0], "total": safe_float(c[-1])}
                    # Wansoft DiscountsDetail columns vary but typically:
                    # [0]=tipo/nombre, [1]=orden/folio, [2]=mesa, [3]=mesero, [4]=autorizador,
                    # [5]=platillo, [6]=cantidad, [7]=monto
                    if len(c) >= 4:
                        item["orden"] = c[1]
                        item["mesa"] = c[2]
                        item["mesero"] = c[3]
                    if len(c) >= 5:
                        item["autorizador"] = c[4]
                    if len(c) >= 6:
                        item["platillo"] = c[5]
                    if len(c) >= 7:
                        item["cantidad"] = safe_int(c[6])
                    # Keep all raw columns for discovery
                    item["_cols"] = c
                    items.append(item)
            return items
        return []

    discounts = scrape_endpoint(session, "DiscountsDetail", "Reports/DiscountsDetail", base_params,
                                None, transform_discounts)
    if discounts:
        save_data("discounts_detail", discounts)
        results["descuentos_detalle"] = len(discounts)
        total_descuentos = sum(safe_float(d.get("total", 0)) for d in discounts)
        save_data("discounts_total", {"total": total_descuentos, "count": len(discounts)})

        # ── UPDATE wansoft_daily with descuentos ──
        # This is CRITICAL — the dashboard reads descuentos from wansoft_daily
        if total_descuentos > 0:
            print(f"    [discounts] Updating wansoft_daily with descuentos=${total_descuentos:,.2f}")
            try:
                requests.patch(
                    f"{SUPABASE_URL}/rest/v1/wansoft_daily?client_slug=eq.{CLIENT['id']}&fecha=eq.{today_str}",
                    headers={**sb_headers, "Prefer": "return=minimal"},
                    json={
                        "descuentos": round(total_descuentos, 2),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }, timeout=10
                )
                print(f"    [✓] wansoft_daily.descuentos updated")
            except Exception as e:
                print(f"    [!] Failed to update wansoft_daily descuentos: {e}")

    # 5. Cancellations detail — capture all columns
    def transform_cancels(r):
        if r["type"] == "json": return r["data"]
        if r["type"] == "html":
            items = []
            for c in r["data"]:
                if len(c) >= 2:
                    item = {"nombre": c[0], "total": safe_float(c[-1])}
                    if len(c) >= 4:
                        item["orden"] = c[1]
                        item["mesa"] = c[2]
                        item["mesero"] = c[3]
                    if len(c) >= 5:
                        item["platillo"] = c[4] if len(c) >= 6 else ""
                    item["_cols"] = c
                    items.append(item)
            return items
        return []

    cancels = scrape_endpoint(session, "CancelSalesDetail", "Reports/CancelSalesDetail", base_params,
                              None, transform_cancels)
    if cancels:
        save_data("cancel_sales", cancels)
        results["cancelaciones"] = len(cancels)

    # 6. Voids detail
    voids = scrape_endpoint(session, "SaleNullificationDetail", "Reports/SaleNullificationDetail", base_params,
                            None, transform_cancels)
    if voids:
        save_data("voids", voids)
        results["anulaciones"] = len(voids)

    # ── UPDATE wansoft_daily with devoluciones (cancels + voids) ──
    total_devoluciones = (sum(safe_float(d.get("total", 0)) for d in (cancels or []))
                         + sum(safe_float(d.get("total", 0)) for d in (voids or [])))
    if total_devoluciones > 0:
        print(f"    [devol] Updating wansoft_daily with devoluciones=${total_devoluciones:,.2f}")
        try:
            requests.patch(
                f"{SUPABASE_URL}/rest/v1/wansoft_daily?client_slug=eq.{CLIENT['id']}&fecha=eq.{today_str}",
                headers={**sb_headers, "Prefer": "return=minimal"},
                json={
                    "devoluciones": round(total_devoluciones, 2),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }, timeout=10
            )
            print(f"    [✓] wansoft_daily.devoluciones updated")
        except Exception as e:
            print(f"    [!] Failed to update devoluciones: {e}")

    # 7. Courtesies — capture ALL columns (same structure as discounts)
    def transform_courtesies(r):
        if r["type"] == "json": return r["data"]
        if r["type"] == "html":
            items = []
            for c in r["data"]:
                if len(c) >= 2:
                    item = {"nombre": c[0], "total": safe_float(c[-1])}
                    if len(c) >= 4:
                        item["orden"] = c[1]
                        item["mesa"] = c[2]
                        item["mesero"] = c[3]
                    if len(c) >= 5:
                        item["autorizador"] = c[4]
                    if len(c) >= 6:
                        item["platillo"] = c[5]
                    if len(c) >= 7:
                        item["cantidad"] = safe_int(c[6])
                    item["_cols"] = c
                    items.append(item)
            return items
        return []

    courtesies = scrape_endpoint(session, "CourtesiesDetail", "Reports/CourtesiesDetail", base_params,
                                 None, transform_courtesies)
    if courtesies:
        save_data("courtesies", courtesies)
        results["cortesias"] = len(courtesies)
        total_cortesias = sum(safe_float(d.get("total", 0)) for d in courtesies)
        save_data("courtesies_total", {"total": total_cortesias, "count": len(courtesies)})

    # 8. Sales by modifiers (extras)
    modifiers = scrape_endpoint(session, "SalesByModifiers", "Reports/SalesByModifiers", base_params,
                                None, transform_generic)
    if modifiers:
        save_data("modifiers_sold", modifiers)
        results["modificadores"] = len(modifiers)

    # ══════════════════════════════════════════════════════════════
    # TIPS
    # ══════════════════════════════════════════════════════════════
    print("\n━━━ TIPS ━━━")

    def transform_tips(r):
        if r["type"] == "html":
            data = []
            SKIP_NAMES = {"", "\n", "usuario", "mesero", "subtotal", "total", "iva", "%"}
            if r["data"]:
                print(f"    [tips] {len(r['data'])} rows, first: {r['data'][0][:5] if r['data'][0] else '?'}")
            for c in r["data"]:
                if len(c) < 3:
                    continue
                mesero_name = str(c[0]).strip()
                # Simple skip: empty name, header keywords, or all-whitespace
                if not mesero_name or mesero_name.lower() in SKIP_NAMES:
                    continue
                # Skip if name looks like a header (contains only non-name chars)
                if all(ch in ' \n\t\r' for ch in mesero_name):
                    continue
                nums = [safe_float(val) for val in c[1:]]
                # Skip if ALL numeric columns are zero (header row parsed as data)
                if all(n == 0 for n in nums):
                    print(f"    [tips] Skipping all-zero row: {mesero_name[:30]}")
                    continue
                item = {"mesero": mesero_name}
                if len(nums) >= 4:
                    item["ventas"] = nums[0]
                    item["propinas"] = nums[1]
                    item["total"] = nums[2]
                    item["propina_pct"] = nums[3]
                elif len(nums) >= 2:
                    item["ventas"] = nums[0]
                    item["propinas"] = nums[-1]
                else:
                    item["ventas"] = nums[0] if nums else 0
                    item["propinas"] = 0
                item["tickets"] = safe_int(c[1]) if len(c) > 1 and safe_int(c[1]) < 1000 else 0
                data.append(item)
            print(f"    [tips] Parsed {len(data)} meseros with data")
            return data
        if r["type"] == "json": return r["data"]
        return []

    # Use yesterday for tips — deep scraper runs at 11pm/5am when today's data may be empty
    tips_params = yesterday_params if now_mx.hour >= 22 or now_mx.hour < 9 else base_params
    print(f"    [tips] Using {'yesterday' if tips_params == yesterday_params else 'today'} ({tips_params['startDate']})")
    tips = scrape_endpoint(session, "SalesByUser+Tips", "Reports/SalesByUser", tips_params,
                           "wansoft_tips", transform_tips)
    # Filter out empty/header-only results
    real_tips = [t for t in (tips or []) if t.get("mesero") and t.get("ventas", 0) > 0]
    tips_fecha = tips_params["startDate"]  # Use the actual date we queried
    if real_tips:
        for t in real_tips:
            t["propina_promedio"] = round(t.get("propinas", 0) / t["tickets"], 2) if t.get("tickets", 0) > 0 else 0
        sb_upsert("wansoft_tips", {"client_id": CLIENT["id"], "fecha": tips_fecha,
                   "data": json.dumps(real_tips), "updated_at": datetime.now(timezone.utc).isoformat()})
        results["propinas"] = len(real_tips)
        save_data("tips_raw", real_tips)
    else:
        print("    [tips] No real tip data found (headers only or empty) — skipping wansoft_daily update")
        real_tips = None  # Prevent updating wansoft_daily with stale data

    if real_tips:
        # ── UPDATE wansoft_daily with propinas_total ──
        # This is CRITICAL — the dashboard reads from wansoft_daily
        total_propinas = sum(t.get("propinas", 0) for t in real_tips)
        propinas_meseros = [{"nombre": t["mesero"], "total": round(t.get("propinas", 0), 2)} for t in real_tips if t.get("propinas", 0) > 0]
        if total_propinas > 0:
            print(f"    [tips] Updating wansoft_daily with propinas_total=${total_propinas:,.2f} ({len(propinas_meseros)} meseros)")
            try:
                # Update propinas_total (numeric field — simple value)
                r = requests.patch(
                    f"{SUPABASE_URL}/rest/v1/wansoft_daily?client_slug=eq.{CLIENT['id']}&fecha=eq.{tips_fecha}",
                    headers={**sb_headers, "Prefer": "return=minimal"},
                    json={"propinas_total": round(total_propinas, 2)},
                    timeout=10
                )
                if r.ok:
                    print(f"    [✓] wansoft_daily.propinas_total updated")
                else:
                    print(f"    [!] PATCH failed ({r.status_code}): {r.text[:200]}")
                # Update propinas_meseros separately (JSONB field)
                if propinas_meseros:
                    requests.patch(
                        f"{SUPABASE_URL}/rest/v1/wansoft_daily?client_slug=eq.{CLIENT['id']}&fecha=eq.{tips_fecha}",
                        headers={**sb_headers, "Prefer": "return=minimal"},
                        json={"propinas_meseros": propinas_meseros},
                        timeout=10
                    )
            except Exception as e:
                print(f"    [!] Failed to update wansoft_daily propinas: {e}")

    # ══════════════════════════════════════════════════════════════
    # FOOD COST & MENU
    # ══════════════════════════════════════════════════════════════
    print("\n━━━ FOOD COST ━━━")

    # Cost by saucer (dish-level margins)
    def transform_cost(r):
        if r["type"] == "html":
            data = []
            for c in r["data"]:
                if len(c) >= 3:
                    precio = safe_float(c[2]) if len(c) > 2 else 0
                    costo = safe_float(c[3]) if len(c) > 3 else 0
                    margen = round((1 - costo/precio) * 100, 1) if precio > 0 else 0
                    data.append({"platillo": c[0], "qty": safe_int(c[1]),
                                 "precio": precio, "costo": costo, "margen_pct": margen})
            return data
        if r["type"] == "json": return r["data"]
        return []

    food_cost = scrape_endpoint(session, "GetCostBySaucer", "Reports/GetCostBySaucer",
                                {**base_params}, "wansoft_food_cost", transform_cost)
    if not food_cost:
        # Try monthly range
        food_cost = scrape_endpoint(session, "GetCostBySaucer(month)", "Reports/GetCostBySaucer",
                                    {**month_params}, "wansoft_food_cost", transform_cost)
    if food_cost:
        sb_upsert("wansoft_food_cost", {"client_id": CLIENT["id"], "fecha": today_str,
                   "data": json.dumps(food_cost), "updated_at": datetime.now(timezone.utc).isoformat()})
        results["food_cost"] = len(food_cost)

    # Cost by group (category-level)
    cost_group = scrape_endpoint(session, "GetCostByGroup", "Reports/GetCostByGroup",
                                 {**month_params}, None, transform_generic)
    if cost_group:
        save_data("cost_by_group", cost_group)
        results["costo_grupo"] = len(cost_group)

    # Saucers with cost (master list)
    saucers_cost = scrape_endpoint(session, "GetSaucersWithCost", "Reports/GetSaucersWithCost",
                                   {"subsidiaryId": SUBSIDIARY_ID}, None, transform_generic)
    if saucers_cost:
        save_data("saucers_with_cost", saucers_cost)
        results["platillos_con_costo"] = len(saucers_cost)

    # ══════════════════════════════════════════════════════════════
    # INVENTORY
    # ══════════════════════════════════════════════════════════════
    print("\n━━━ INVENTORY ━━━")

    def transform_inventory(r):
        if r["type"] == "html":
            return [{"producto": c[0], "existencia": safe_float(c[1]),
                     "unidad": c[2] if len(c) > 2 else "",
                     "costo_unitario": safe_float(c[3]) if len(c) > 3 else 0,
                     "costo_total": safe_float(c[4]) if len(c) > 4 else 0}
                    for c in r["data"] if len(c) >= 2]
        if r["type"] == "json": return r["data"]
        return []

    inventory = scrape_endpoint(session, "GetInventoryBySubsidiary", "Inventory/GetInventoryBySubsidiary",
                                {"subsidiaryId": SUBSIDIARY_ID}, "wansoft_inventory", transform_inventory)
    if inventory:
        sb_upsert("wansoft_inventory", {"client_id": CLIENT["id"], "fecha": today_str,
                   "data": json.dumps(inventory), "updated_at": datetime.now(timezone.utc).isoformat()})
        results["inventario"] = len(inventory)

    # Inventory statement (movements)
    inv_statement = scrape_endpoint(session, "GetInventoryStatement", "Inventory/GetInventoryStatementBySubsidiary",
                                    {"subsidiaryId": SUBSIDIARY_ID, **month_params}, None, transform_generic)
    if inv_statement:
        save_data("inventory_movements", inv_statement)
        results["mov_inventario"] = len(inv_statement)

    # Reorder point
    reorder = scrape_endpoint(session, "ReorderPoint", "Inventory/GetReorderPointReport",
                              {"subsidiaryId": SUBSIDIARY_ID}, None, transform_generic)
    if reorder:
        save_data("reorder_points", reorder)
        results["reorden"] = len(reorder)

    # Physical vs system
    def transform_shrinkage(r):
        if r["type"] == "html":
            data = []
            for c in r["data"]:
                if len(c) >= 3:
                    sistema = safe_float(c[1])
                    fisico = safe_float(c[2])
                    data.append({"producto": c[0], "sistema": sistema, "fisico": fisico,
                                 "diferencia": round(fisico - sistema, 2),
                                 "costo_diferencia": safe_float(c[3]) if len(c) > 3 else 0})
            return [d for d in data if abs(d["diferencia"]) > 0.01]
        if r["type"] == "json": return r["data"]
        return []

    shrinkage = scrape_endpoint(session, "PhysicalVsSystem", "Inventory/GetPhysicalInventoryVsSystem",
                                {"subsidiaryId": SUBSIDIARY_ID}, "wansoft_shrinkage", transform_shrinkage)
    if shrinkage:
        sb_upsert("wansoft_shrinkage", {"client_id": CLIENT["id"], "fecha": today_str,
                   "data": json.dumps(shrinkage), "updated_at": datetime.now(timezone.utc).isoformat()})
        results["merma"] = len(shrinkage)

    # Products in recipes vs not
    in_recipes = scrape_endpoint(session, "ProductsInRecipes", "Inventory/GetProductsThatAreInRecipes",
                                 {"subsidiaryId": SUBSIDIARY_ID}, None, transform_generic)
    if in_recipes:
        save_data("products_in_recipes", in_recipes)
        results["prod_en_recetas"] = len(in_recipes)

    not_in_recipes = scrape_endpoint(session, "ProductsNotInRecipes", "Inventory/GetProductsThatAreNotInRecipes",
                                     {"subsidiaryId": SUBSIDIARY_ID}, None, transform_generic)
    if not_in_recipes:
        save_data("products_not_in_recipes", not_in_recipes)
        results["prod_sin_receta"] = len(not_in_recipes)

    # ══════════════════════════════════════════════════════════════
    # PROCUREMENT / SUPPLIERS
    # ══════════════════════════════════════════════════════════════
    print("\n━━━ PROCUREMENT ━━━")

    suppliers = scrape_endpoint(session, "ShopBySupplier", "Reports/ShopBySupplier",
                                range_params, "wansoft_suppliers", transform_generic)
    if suppliers:
        sb_upsert("wansoft_suppliers", {"client_id": CLIENT["id"], "fecha": today_str, "periodo": "month",
                   "data": json.dumps(suppliers), "updated_at": datetime.now(timezone.utc).isoformat()})
        results["proveedores"] = len(suppliers)

    # Shop by product
    shop_product = scrape_endpoint(session, "ShopByProduct", "Reports/ShopByProduct",
                                   range_params, None, transform_generic)
    if shop_product:
        save_data("purchases_by_product", shop_product)
        results["compras_producto"] = len(shop_product)

    # Purchase orders issued
    po_issued = scrape_endpoint(session, "PO_Issued", "Purchasing/GetPurchaseOrderIssued",
                                {"subsidiaryId": SUBSIDIARY_ID}, None, transform_generic)
    if po_issued:
        save_data("purchase_orders", po_issued)
        results["ordenes_compra"] = len(po_issued)

    # Supplier list
    supplier_list = scrape_endpoint(session, "SupplierList", "Purchasing/GetSupplierList",
                                    {"subsidiaryId": SUBSIDIARY_ID}, None, transform_generic)
    if supplier_list:
        save_data("supplier_list", supplier_list)
        results["lista_proveedores"] = len(supplier_list)

    # ══════════════════════════════════════════════════════════════
    # LABOR / STAFF
    # ══════════════════════════════════════════════════════════════
    print("\n━━━ LABOR ━━━")

    def transform_labor(r):
        if r["type"] == "html":
            return [{"empleado": c[0], "entrada": c[1] if len(c) > 1 else "",
                     "salida": c[2] if len(c) > 2 else "",
                     "horas": safe_float(c[3]) if len(c) > 3 else 0}
                    for c in r["data"] if len(c) >= 1]
        if r["type"] == "json": return r["data"]
        return []

    # Use yesterday for labor/hours (same timing issue as tips)
    labor_params = yesterday_params if now_mx.hour >= 22 or now_mx.hour < 9 else base_params
    labor_fecha = labor_params["startDate"]
    print(f"    [labor] Using {labor_fecha}")

    labor = scrape_endpoint(session, "AccessControl", "Staff/GetAccessControlReport",
                            labor_params, "wansoft_labor", transform_labor)
    if labor:
        sb_upsert("wansoft_labor", {"client_id": CLIENT["id"], "fecha": labor_fecha,
                   "data": json.dumps(labor), "updated_at": datetime.now(timezone.utc).isoformat()})
        results["labor"] = len(labor)

    # Hours worked
    hours_worked = scrape_endpoint(session, "HoursWorked", "Staff/GetUserHoursWorkedReport",
                                   labor_params, None, transform_labor)
    if hours_worked:
        save_data("hours_worked", hours_worked)
        results["horas_trabajadas"] = len(hours_worked)

    # POS users list
    pos_users = scrape_endpoint(session, "PosUsers", "Staff/GetPosUsersList",
                                {"subsidiaryId": SUBSIDIARY_ID}, None, transform_generic)
    if pos_users:
        save_data("pos_users", pos_users)
        results["usuarios_pos"] = len(pos_users)

    # Shift list
    shifts = scrape_endpoint(session, "Shifts", "Staff/GetShiftList",
                             {"subsidiaryId": SUBSIDIARY_ID}, None, transform_generic)
    if shifts:
        save_data("shifts", shifts)
        results["turnos"] = len(shifts)

    # ══════════════════════════════════════════════════════════════
    # FINANCE / CASH
    # ══════════════════════════════════════════════════════════════
    print("\n━━━ FINANCE ━━━")

    # Income statement
    def transform_pnl(r):
        if r["type"] == "html":
            return {c[0]: [safe_float(v) for v in c[1:]] for c in r["data"] if len(c) >= 2}
        if r["type"] == "json": return r["data"]
        return {}

    pnl = scrape_endpoint(session, "IncomeStatement", "Reports/GetIncomeStatemetByMonthInYear",
                           {"subsidiaryId": SUBSIDIARY_ID, "year": year}, "wansoft_pnl", transform_pnl)
    if pnl:
        sb_upsert("wansoft_pnl", {"client_id": CLIENT["id"], "periodo": today_str[:7],
                   "data": json.dumps({"year": year, "months": pnl}),
                   "updated_at": datetime.now(timezone.utc).isoformat()})
        results["pnl"] = len(pnl)

    # Cash closing
    cash_closing = scrape_endpoint(session, "ClosingCash", "Reports/ClosingCash",
                                   base_params, None, transform_generic)
    if cash_closing:
        save_data("cash_closing", cash_closing)
        results["corte_caja"] = len(cash_closing)

    # Cash flow
    cash_flow = scrape_endpoint(session, "CashFlow", "Finance/GetCashFlowList",
                                {"subsidiaryId": SUBSIDIARY_ID}, None, transform_generic)
    if cash_flow:
        save_data("cash_flow", cash_flow)
        results["flujo_caja"] = len(cash_flow)

    # Cash withdrawals
    withdrawals = scrape_endpoint(session, "CashWithdrawals", "Reports/GetCashWithdrawalReport",
                                  base_params, None, transform_generic)
    if withdrawals:
        save_data("cash_withdrawals", withdrawals)
        results["retiros"] = len(withdrawals)

    # Bank deposits
    deposits = scrape_endpoint(session, "BankDeposits", "Finance/GetBankDepositList",
                               {"subsidiaryId": SUBSIDIARY_ID}, None, transform_generic)
    if deposits:
        save_data("bank_deposits", deposits)
        results["depositos"] = len(deposits)

    # ══════════════════════════════════════════════════════════════
    # ECOMMERCE
    # ══════════════════════════════════════════════════════════════
    print("\n━━━ ECOMMERCE ━━━")

    orders_status = scrape_endpoint(session, "EcomOrders", "ECommerce/GetGeneralOrderStatusList",
                                    {"subsidiaryId": SUBSIDIARY_ID}, None, transform_generic)
    if orders_status:
        save_data("ecommerce_orders", orders_status)
        results["ecommerce_orders"] = len(orders_status)

    ecom_menu = scrape_endpoint(session, "EcomMenu", "ECommerce/GetECommerceMenuStatusList",
                                {"subsidiaryId": SUBSIDIARY_ID}, None, transform_generic)
    if ecom_menu:
        save_data("ecommerce_menu", ecom_menu)
        results["ecommerce_menu"] = len(ecom_menu)

    # ══════════════════════════════════════════════════════════════
    # BILLING / TAX
    # ══════════════════════════════════════════════════════════════
    print("\n━━━ BILLING ━━━")

    invoices = scrape_endpoint(session, "Invoices", "Billing/GetDocumentList",
                               {**month_params, "subsidiaryId": SUBSIDIARY_ID}, None, transform_generic)
    if invoices:
        save_data("invoices", invoices)
        results["facturas"] = len(invoices)

    # ══════════════════════════════════════════════════════════════
    # MENU / CONFIG (static, but useful)
    # ══════════════════════════════════════════════════════════════
    print("\n━━━ MENU CONFIG ━━━")

    groups = scrape_endpoint(session, "Groups", "Menu/GetGroupList",
                             {"subsidiaryId": SUBSIDIARY_ID}, None, transform_generic)
    if groups:
        results["grupos_menu"] = len(groups)

    saucers = scrape_endpoint(session, "Saucers", "Menu/GetSaucerList",
                              {"subsidiaryId": SUBSIDIARY_ID}, None, transform_generic)
    if saucers:
        results["platillos_menu"] = len(saucers)

    complements = scrape_endpoint(session, "Complements", "Menu/GetComplementaryList",
                                  {"subsidiaryId": SUBSIDIARY_ID}, None, transform_generic)
    if complements:
        results["modificadores_menu"] = len(complements)

    def transform_promotions(r):
        """Parse promotions with all detail columns."""
        if r["type"] == "json": return r["data"]
        if r["type"] == "html":
            items = []
            for c in r["data"]:
                if len(c) >= 2:
                    item = {"nombre": c[0], "_cols": c}
                    # Typical promo columns: nombre, tipo, platillo, descuento%, monto, activa
                    if len(c) >= 3: item["tipo"] = c[1]
                    if len(c) >= 4: item["platillo"] = c[2]
                    if len(c) >= 5: item["descuento_pct"] = safe_float(c[3])
                    if len(c) >= 6: item["monto"] = safe_float(c[4])
                    if len(c) >= 7: item["activa"] = c[5].strip().lower() in ("si", "yes", "activa", "1", "true", "activo")
                    else: item["activa"] = True  # assume active if no column
                    items.append(item)
            return items
        return []

    promotions = scrape_endpoint(session, "Promotions", "Menu/GetPromotionList",
                                 {"subsidiaryId": SUBSIDIARY_ID}, None, transform_promotions)
    if promotions:
        save_data("promotions", promotions)
        results["promociones"] = len(promotions)
        # Flag how many are active
        activas = [p for p in promotions if p.get("activa", True)]
        results["promos_activas"] = len(activas)

    # ══════════════════════════════════════════════════════════════
    # SUMMARY
    # ══════════════════════════════════════════════════════════════
    elapsed = int((time.time() - start) * 1000)

    print(f"\n{'='*60}")
    print(f"RESULTS — {len(results)} endpoints with data")
    print(f"{'='*60}")
    for k, v in sorted(results.items()):
        print(f"  {k}: {v}")
    print(f"\nTotal time: {elapsed}ms")

    # Telegram summary
    msg = f"🔍 DEEP SCRAPE — {today_str}\n{len(results)} endpoints con datos:\n\n"
    for k, v in sorted(results.items()):
        msg += f"• {k}: {v}\n"
    msg += f"\n⏱ {elapsed/1000:.1f}s"

    send_telegram(msg)

    # Log
    try:
        requests.post(f"{SUPABASE_URL}/rest/v1/agent_runs", headers=sb_headers,
                      json={"agent_id": "wansoft-deep-scraper", "trigger_type": TRIGGER_TYPE,
                            "status": "success", "duration_ms": elapsed,
                            "output_summary": json.dumps(results)[:500], "tentacle": "ops"})
    except: pass


def send_telegram(msg):
    for chat_id in TG_CHAT_IDS:
        if not chat_id: continue
        chunks = [msg[i:i+4000] for i in range(0, len(msg), 4000)]
        for chunk in chunks:
            requests.post(f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                          json={"chat_id": chat_id, "text": chunk})


if __name__ == "__main__":
    main()
