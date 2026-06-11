#!/usr/bin/env python3
"""
Wansoft Inventory Scrape — navega las pantallas de inventario y extrae datos.

Páginas:
1. Inventory/InputOutput — Entradas y salidas
2. Inventory/InventoryAudit — Auditoría (físico vs sistema)
3. Inventory/InventoryControl — Control de inventarios (existencias)
4. Production/ProductionAndCosts — Producción y costos
5. Purchasing/PurchaseOrderBrowser — Órdenes de compra
6. Account/MyDocumentsList — Facturas Wansoft
"""

import os
import sys
import json
import re
import time
import requests
from datetime import datetime, timezone, timedelta
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(__file__))
from client_config import get_client, get_wansoft_creds

CLIENT = get_client()
SUBSIDIARY_ID, WANSOFT_USER, WANSOFT_PASS = get_wansoft_creds(CLIENT)
WANSOFT_URL = "https://www.wansoft.net/Wansoft.Web"

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
SB_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates,return=minimal",
}

TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")
MONTH_AGO = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")


def wansoft_session():
    s = requests.Session()
    s.get(f"{WANSOFT_URL}/")
    resp = s.post(f"{WANSOFT_URL}/", data={
        "UserName": WANSOFT_USER,
        "Password": WANSOFT_PASS,
    }, allow_redirects=True)
    if "Dashboard" not in resp.url and "MyDocumentsList" not in resp.url:
        raise Exception(f"Wansoft login failed. URL: {resp.url}")
    print(f"[OK] Login as {WANSOFT_USER}")
    return s


def save_data(key, data):
    row = {
        "client_id": CLIENT["id"],
        "data_key": key,
        "fecha": TODAY,
        "data": json.dumps(data, ensure_ascii=False) if not isinstance(data, str) else data,
    }
    r = requests.post(f"{SUPABASE_URL}/rest/v1/wansoft_data", headers=SB_HEADERS, json=row)
    if r.status_code >= 300:
        requests.patch(
            f"{SUPABASE_URL}/rest/v1/wansoft_data?client_id=eq.{CLIENT['id']}&data_key=eq.{key}&fecha=eq.{TODAY}",
            headers=SB_HEADERS, json={"data": row["data"]},
        )
    print(f"  [saved] {key}")


def extract_table(html):
    """Extract all tables from HTML as list of dicts."""
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for table in soup.select("table"):
        headers = []
        for th in table.select("thead th, tr:first-child th"):
            headers.append(th.get_text(strip=True))
        if not headers:
            first_row = table.select_one("tr")
            if first_row:
                headers = [td.get_text(strip=True) for td in first_row.select("td, th")]

        rows = []
        for tr in table.select("tbody tr, tr")[1:]:
            cells = [td.get_text(strip=True) for td in tr.select("td")]
            if cells and any(c for c in cells):
                if len(cells) >= len(headers) and headers:
                    rows.append(dict(zip(headers, cells)))
                else:
                    rows.append(cells)
        if rows:
            results.extend(rows)
    return results


def extract_jqgrid(html):
    """Extract data from jqGrid tables (Wansoft uses these extensively)."""
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for grid in soup.select(".ui-jqgrid-btable, table[id]"):
        headers = []
        header_row = grid.select_one("thead tr, tr.jqgfirstrow")
        if header_row:
            headers = [th.get_text(strip=True) for th in header_row.select("th, td")]

        for tr in grid.select("tr.jqgrow, tbody tr"):
            cells = [td.get_text(strip=True) for td in tr.select("td")]
            if cells and any(c for c in cells):
                if headers and len(cells) == len(headers):
                    results.append(dict(zip(headers, cells)))
                elif cells:
                    results.append(cells)
    return results


def get_form_and_submit(session, page, extra_data=None):
    """GET a page, fill its form with smart defaults, POST it, return response."""
    r = session.get(f"{WANSOFT_URL}/{page}", timeout=30)
    if r.status_code != 200:
        print(f"  [!] GET {page}: {r.status_code}")
        return None

    soup = BeautifulSoup(r.text, "html.parser")
    form = soup.select_one("form:not([action*='LogOff'])")
    if not form:
        return r  # No form, return the GET response

    data = {}
    for inp in form.select("input"):
        name = inp.get("name")
        if name:
            data[name] = inp.get("value", "")

    for sel in form.select("select"):
        name = sel.get("name")
        if not name:
            continue
        opts = [o.get("value") for o in sel.select("option") if o.get("value")]
        nl = name.lower()
        if "subsidiary" in nl:
            data[name] = str(SUBSIDIARY_ID)
        elif "warehouse" in nl:
            data[name] = opts[0] if opts else ""
        else:
            data[name] = opts[0] if opts else ""

    # Fill dates
    for k in list(data):
        kl = k.lower()
        if ("start" in kl or "initial" in kl or "from" in kl) and ("date" in kl or "fecha" in kl):
            data[k] = MONTH_AGO
        elif ("end" in kl or "final" in kl or "to" in kl) and ("date" in kl or "fecha" in kl):
            data[k] = TODAY
        elif kl in ("date", "fecha"):
            data[k] = TODAY

    if extra_data:
        data.update(extra_data)

    action = (form.get("action") or f"/{page}").lstrip("/").replace("Wansoft.Web/", "")
    print(f"  POST {action} fields={list(data.keys())[:8]}")

    pr = session.post(f"{WANSOFT_URL}/{action}", data=data, timeout=60)
    return pr


def scrape_page(session, page, label):
    """Scrape a page: try JSON endpoints first, then form POST, then HTML tables."""
    print(f"\n[{label}] {page}")

    # First try GET
    r = session.get(f"{WANSOFT_URL}/{page}", timeout=30)
    if r.status_code != 200:
        print(f"  GET failed: {r.status_code}")
        return []

    page_len = len(r.text)
    title = ""
    tm = re.search(r"<title>(.*?)</title>", r.text, re.DOTALL)
    if tm:
        title = tm.group(1).strip()[:60]
    print(f"  GET OK: len={page_len} title={title!r}")

    # Try extracting tables from the GET response
    tables = extract_table(r.text)
    grids = extract_jqgrid(r.text)
    all_data = tables + grids

    if all_data:
        print(f"  Found {len(all_data)} rows from GET")
        for row in all_data[:3]:
            print(f"    {row}")
        return all_data

    # No data from GET — try form POST
    print(f"  No data from GET, trying form POST...")
    pr = get_form_and_submit(session, page)
    if pr and pr.status_code == 200:
        ctype = pr.headers.get("Content-Type", "")
        if "text/html" not in ctype:
            # Export file
            print(f"  EXPORT! ctype={ctype} len={len(pr.content)}")
            return [{"_export": True, "_ctype": ctype, "_preview": pr.text[:5000]}]
        else:
            tables = extract_table(pr.text)
            grids = extract_jqgrid(pr.text)
            all_data = tables + grids
            if all_data:
                print(f"  Found {len(all_data)} rows from POST")
                for row in all_data[:3]:
                    print(f"    {row}")
                return all_data
            else:
                print(f"  POST returned HTML but no table data (len={len(pr.text)})")

    return []


def get_token(session, page):
    """GET a page and extract __RequestVerificationToken."""
    r = session.get(f"{WANSOFT_URL}/{page}", timeout=30)
    if r.status_code != 200:
        return None, None
    m = re.search(r'name="__RequestVerificationToken"\s+value="([^"]+)"', r.text)
    token = m.group(1) if m else None
    return token, r


def export_with_token(session, page, export_endpoint, extra_data=None):
    """GET page for token, then POST export with that token."""
    token, page_r = get_token(session, page)
    if not token:
        print(f"  [!] No token found on {page}")
        # Try without token
        token = ""

    data = {"__RequestVerificationToken": token}
    if extra_data:
        data.update(extra_data)

    r = session.post(f"{WANSOFT_URL}/{export_endpoint}", data=data, timeout=60)
    ctype = r.headers.get("Content-Type", "")
    print(f"  POST {export_endpoint}: status={r.status_code} ctype={ctype} len={len(r.content)}")

    if "text/html" not in ctype and len(r.content) > 50:
        # Got a file export
        print(f"  → EXPORT SUCCESS! Preview: {r.text[:300]!r}")
        return r.text
    elif r.status_code == 200 and len(r.text) > 1000:
        # HTML response — try to extract tables
        tables = extract_table(r.text)
        grids = extract_jqgrid(r.text)
        all_data = tables + grids
        if all_data:
            print(f"  → Found {len(all_data)} rows from POST")
            return all_data
        # Try JSON
        try:
            j = r.json()
            print(f"  → JSON response: {str(j)[:200]}")
            return j
        except:
            pass
        print(f"  → HTML but no extractable data")
    return None


def main():
    print("=" * 60)
    print(f"WANSOFT INVENTORY SCRAPE — {CLIENT['id']} — {TODAY}")
    print("=" * 60)

    session = wansoft_session()

    # === TARGETED EXPORTS with tokens ===

    # 1. Export Inventory Statement (per warehouse)
    print("\n[1] Export Inventory Statement...")
    warehouses_r = session.post(f"{WANSOFT_URL}/Inventory/GetWarehousesBySubsidiarySortedByName",
                                 json={"subsidiaryId": SUBSIDIARY_ID}, timeout=30)
    wh_list = []
    try:
        wh_data = warehouses_r.json()
        wh_list = wh_data if isinstance(wh_data, list) else wh_data.get("warehouses", wh_data.get("Result", []))
    except:
        pass

    for wh in wh_list:
        wh_id = wh.get("Value", "")
        wh_name = wh.get("Text", "")
        if not wh_id or "ELIMINADO" in wh_name.upper():
            continue
        print(f"\n  Warehouse: {wh_name}")
        result = export_with_token(session, "Inventory/InventoryStatement",
                                    "Inventory/ExportInventoryStatement", {
                                        "subsidiaryId": SUBSIDIARY_ID,
                                        "warehouseId": wh_id,
                                        "startDate": MONTH_AGO,
                                        "endDate": TODAY,
                                        "InternalCode": "",
                                        "ProductName": "",
                                    })
        if result:
            save_data(f"inv_statement_{wh_name.split('.')[0].strip()}", result)

    # 2. Export Physical Inventory vs System
    print("\n[2] Export Physical Inventory vs System...")
    result = export_with_token(session, "Inventory/PhysicalInventoryVsSystem",
                                "Inventory/ExportPhysicalInventoryVsSystemReport", {
                                    "subsidiaryId": SUBSIDIARY_ID,
                                })
    if result:
        save_data("inv_physical_vs_system", result)

    # 3. Transferencias
    print("\n[3] Transferencias...")
    data = scrape_page(session, "Inventory/Transfer", "Transferencias")
    if data:
        save_data("inv_transfers", data)

    # 4. Ajustes por lote
    print("\n[4] Ajustes por lote...")
    data = scrape_page(session, "Inventory/BatchAdjustment", "Ajustes por Lote")
    if data:
        save_data("inv_batch_adjustments", data)

    # 5. Facturas Wansoft
    print("\n[5] Facturas Wansoft...")
    data = scrape_page(session, "Account/MyDocumentsList", "Facturas")
    if data:
        save_data("inv_facturas_wansoft", data)

    print(f"\n[DONE]")


def main_old():
    """OLD main — kept for reference."""
    session = wansoft_session()

    # First: discover real URLs from sidebar
    print("\n[0] Discovering sidebar links...")
    r = session.get(f"{WANSOFT_URL}/Inventory/InventoryStatement", timeout=30)
    sidebar_links = set()
    for m in re.finditer(r'href\s*=\s*["\']/?(?:Wansoft\.Web/)?([A-Za-z][A-Za-z0-9_]*/[A-Za-z0-9_]+)["\']', r.text):
        u = m.group(1)
        if not any(x in u for x in ('Content/', 'Scripts/', 'Account/LogOff', '.js', '.css')):
            sidebar_links.add(u)
    print(f"  Found {len(sidebar_links)} sidebar links")
    for u in sorted(sidebar_links):
        print(f"    - {u}")

    # Known pages + anything from sidebar with Inventory/Production/Purchasing
    pages = [
        # Entradas y salidas
        ("Inventory/InputOutput", "Entradas y Salidas"),
        ("Inventory/InputOutputWithInvoice", "Con Facturas"),
        ("Inventory/Transfer", "Transferencias"),
        ("Inventory/Transfers", "Transferencias2"),
        ("Inventory/Returns", "Devoluciones"),
        ("Inventory/Return", "Devoluciones2"),
        ("Inventory/InputOutputBarcode", "Con Codigo de Barras"),
        ("Inventory/BatchAdjustment", "Ajustes por Lote"),
        ("Inventory/BatchAdjustments", "Ajustes por Lote2"),
        ("Inventory/SubproductsInProcess", "Subproductos en Proceso"),
        ("Inventory/BulkInventoryLoad", "Carga Masiva"),
        ("Inventory/MassiveInventoryLoad", "Carga Masiva2"),
        ("Inventory/BulkInventoryOutput", "Salida Masiva"),
        ("Inventory/MassiveInventoryOutput", "Salida Masiva2"),
        # Auditoría
        ("Inventory/InventoryAudit", "Auditoría"),
        ("Inventory/Audit", "Auditoría2"),
        # Control
        ("Inventory/InventoryControl", "Control de Inventarios"),
        ("Inventory/Control", "Control2"),
        ("Inventory/StockControl", "Stock Control"),
        # Producción
        ("Production/ProductionAndCosts", "Producción y Costos"),
        ("Production/Costs", "Costos"),
        ("Production/SaucerRecipe", "Recetas"),
        # Compras
        ("Purchasing/PurchaseOrderBrowser", "Órdenes de Compra"),
        ("Purchasing/PurchaseOrder", "Orden de Compra"),
        ("Purchasing/Suppliers", "Proveedores"),
        # Estado de cuenta + físico
        ("Inventory/InventoryStatement", "Estado de Cuenta"),
        ("Inventory/PhysicalInventoryVsSystem", "Físico vs Sistema"),
        ("Inventory/ReorderPoint", "Punto de Reorden"),
        # Facturas
        ("Account/MyDocumentsList", "Facturas Wansoft"),
    ]

    # Add sidebar links we haven't tried
    tried = {p[0].lower() for p in pages}
    for link in sorted(sidebar_links):
        if link.lower() not in tried and any(k in link for k in ('Inventory', 'Production', 'Purchasing')):
            pages.append((link, f"Sidebar: {link}"))


    for page, label in pages:
        data = scrape_page(session, page, label)
        if data:
            key = f"inv_{page.split('/')[-1].lower()}"
            save_data(key, data)
        else:
            print(f"  → No data")
        time.sleep(1)

    print(f"\n[DONE]")


if __name__ == "__main__":
    main()
