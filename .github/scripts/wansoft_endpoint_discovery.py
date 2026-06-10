#!/usr/bin/env python3
"""
Wansoft Endpoint Discovery — mapea los endpoints AJAX JSON reales de cada
página de reporte (misma técnica que funcionó con las recetas: bajar el JS
de ScriptsViews/ y extraer las llamadas $.ajax).

Output: mapa completo página → endpoints en logs + wansoft_data (endpoint_map).
"""

import os
import re
import json
import time
import requests
from datetime import datetime, timezone
from client_config import get_client, get_wansoft_creds

CLIENT = get_client()
SUBSIDIARY_ID, WANSOFT_USER, WANSOFT_PASS = get_wansoft_creds(CLIENT)
WANSOFT_URL = "https://www.wansoft.net/Wansoft.Web"

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

sb_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates,return=minimal",
}

# Páginas de Wansoft a mapear (las que hoy regresan basura en el deep scraper)
PAGES = [
    "Reports/SalesByHours",
    "Reports/SalesByArea",
    "Reports/SalesByTerminal",
    "Reports/SalesByUser",
    "Reports/DiscountsDetail",
    "Reports/CancelSalesDetail",
    "Reports/SaleNullificationDetail",
    "Reports/CourtesiesDetail",
    "Reports/SalesByModifiers",
    "Reports/GetCostBySaucer",
    "Reports/CostBySaucer",
    "Reports/GetCostByGroup",
    "Reports/CostByGroup",
    "Reports/SaucersWithCost",
    "Reports/ClosingCash",
    "Reports/ShopBySupplier",
    "Reports/ShopByProduct",
    "Reports/CashWithdrawal",
    "Reports/IncomeStatement",
    "Inventory/InventoryBySubsidiary",
    "Inventory/InventoryStatement",
    "Inventory/ReorderPoint",
    "Inventory/PhysicalInventoryVsSystem",
    "Inventory/InventoryMovements",
    "Purchasing/PurchaseOrder",
    "Purchasing/Supplier",
    "Staff/AccessControl",
    "Staff/UserHoursWorked",
    "Staff/PosUser",
    "Staff/Shift",
    "Finance/CashFlow",
    "Finance/BankDeposit",
    "ECommerce/GeneralOrderStatus",
    "ECommerce/ECommerceMenuStatus",
    "Billing/Document",
    "Menu/Promotion",
    "Menu/Saucer",
]


def wansoft_session():
    s = requests.Session()
    s.get(f"{WANSOFT_URL}/")
    resp = s.post(f"{WANSOFT_URL}/", data={
        "UserName": WANSOFT_USER,
        "Password": WANSOFT_PASS,
    }, allow_redirects=True)
    if "Dashboard" not in resp.url and "MyDocumentsList" not in resp.url:
        raise Exception(f"Wansoft login failed. URL: {resp.url}")
    print("[OK] Login")
    return s


AJAX_RE = re.compile(
    r"""url\s*:\s*GetRootUrl\(\)\s*\+\s*['"]([^'"]+)['"]\s*,\s*(?:type\s*:\s*['"](\w+)['"]\s*,\s*)?(?:data\s*:\s*(\{.*?\})\s*,)?""",
    re.DOTALL,
)


def discover_page(session, page):
    """GET la página, baja sus JS de ScriptsViews y extrae llamadas ajax."""
    try:
        r = session.get(f"{WANSOFT_URL}/{page}", timeout=30)
    except Exception as e:
        return {"status": "error", "error": str(e)}
    if r.status_code != 200:
        return {"status": f"http_{r.status_code}"}
    # Página inexistente redirige a login/dashboard o regresa 404 custom
    if "UserName" in r.text and "Password" in r.text and len(r.text) < 50000:
        return {"status": "redirect_login"}

    js_files = set(re.findall(r"""["']([^"']*ScriptsViews/[A-Za-z0-9_/\.]+\.js)["']""", r.text))
    endpoints = []
    for js in sorted(js_files):
        js_path = js.lstrip("/").replace("Wansoft.Web/", "")
        try:
            jr = session.get(f"{WANSOFT_URL}/{js_path}", timeout=30)
            if jr.status_code != 200:
                continue
            for m in AJAX_RE.finditer(jr.text):
                url, method, data = m.group(1), m.group(2) or "POST", m.group(3) or ""
                params = sorted(set(re.findall(r"(\w+)\s*:", data)))
                endpoints.append({"url": url, "method": method, "params": params, "js": js_path})
        except Exception as e:
            print(f"    [!] {js_path}: {e}")
    return {"status": "ok", "js_files": sorted(js_files), "endpoints": endpoints}


def main():
    start = time.time()
    print("=" * 60)
    print(f"WANSOFT ENDPOINT DISCOVERY — client={CLIENT['id']}")
    print("=" * 60)

    session = wansoft_session()
    full_map = {}
    for page in PAGES:
        result = discover_page(session, page)
        full_map[page] = result
        n = len(result.get("endpoints", []))
        print(f"\n[{page}] status={result['status']} endpoints={n}")
        for ep in result.get("endpoints", []):
            print(f"    {ep['method']} {ep['url']}  params={ep['params']}")
        time.sleep(0.3)

    # Guardar mapa completo en wansoft_data
    row = {
        "client_id": CLIENT["id"],
        "fecha": datetime.now(timezone.utc).date().isoformat(),
        "data_key": "endpoint_map",
        "data": json.dumps(full_map, ensure_ascii=False),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/wansoft_data?on_conflict=client_id,fecha,data_key",
        headers=sb_headers, json=row, timeout=15,
    )
    print(f"\n[Supabase] endpoint_map saved: {r.status_code}")

    total = sum(len(v.get("endpoints", [])) for v in full_map.values())
    ok_pages = sum(1 for v in full_map.values() if v["status"] == "ok")
    print(f"\n[DONE] {ok_pages}/{len(PAGES)} páginas OK, {total} endpoints descubiertos en {int(time.time()-start)}s")


if __name__ == "__main__":
    main()
