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
    r"""url\s*:\s*GetRootUrl\(\)\s*\+\s*['"]([^'"]+)['"]\s*,?\s*(?:type\s*:\s*['"](\w+)['"]\s*,\s*)?(?:data\s*:\s*(\{.*?\})\s*,)?""",
    re.DOTALL,
)
# urls sin GetRootUrl: url: '/Wansoft.Web/Reports/GetX' o url: 'Reports/GetX'
AJAX_RE2 = re.compile(
    r"""url\s*:\s*['"](/?(?:Wansoft\.Web/)?[A-Za-z][A-Za-z0-9_]*/[A-Za-z0-9_]+)['"]""",
)


def extract_endpoints(text, source):
    endpoints = []
    for m in AJAX_RE.finditer(text):
        url, method, data = m.group(1), m.group(2) or "POST", m.group(3) or ""
        params = sorted(set(re.findall(r"(\w+)\s*:", data)))
        endpoints.append({"url": url, "method": method, "params": params, "js": source})
    for m in AJAX_RE2.finditer(text):
        url = m.group(1).lstrip("/").replace("Wansoft.Web/", "")
        if not any(e["url"].lstrip("/") == url for e in endpoints):
            endpoints.append({"url": url, "method": "?", "params": [], "js": source})
    # Forms con action (los Export usan form post)
    for m in re.finditer(r"""action\s*=\s*["'](/?(?:Wansoft\.Web/)?[A-Za-z][A-Za-z0-9_]*/[A-Za-z0-9_]+)["']""", text):
        url = m.group(1).lstrip("/").replace("Wansoft.Web/", "")
        if not any(e["url"].lstrip("/") == url for e in endpoints):
            endpoints.append({"url": url, "method": "FORM", "params": [], "js": source})
    return endpoints


def discover_page(session, page):
    """GET la página, baja sus JS de ScriptsViews y extrae llamadas ajax."""
    try:
        r = session.get(f"{WANSOFT_URL}/{page}", timeout=30, allow_redirects=True)
    except Exception as e:
        return {"status": "error", "error": str(e)}
    if r.status_code != 200:
        return {"status": f"http_{r.status_code}"}
    final_path = r.url.split("Wansoft.Web/")[-1].split("?")[0].rstrip("/")
    if final_path.lower() != page.lower():
        return {"status": f"redirect→{final_path}"}

    title_m = re.search(r"<title>(.*?)</title>", r.text, re.DOTALL)
    title = (title_m.group(1).strip() if title_m else "")[:60]

    js_files = set(re.findall(r"""["']([^"']*ScriptsViews/[A-Za-z0-9_/\.]+\.js)["']""", r.text))
    # Inline scripts de la página también
    endpoints = extract_endpoints(r.text, "(inline)")
    for js in sorted(js_files):
        js_path = js.lstrip("/").replace("Wansoft.Web/", "")
        if "Shared/" in js_path:  # Layout.js solo trae ActivateSession
            continue
        try:
            jr = session.get(f"{WANSOFT_URL}/{js_path}", timeout=30)
            if jr.status_code == 200:
                endpoints.extend(extract_endpoints(jr.text, js_path))
        except Exception as e:
            print(f"    [!] {js_path}: {e}")
    # Dedupe + filtrar ruido
    seen, clean = set(), []
    for e in endpoints:
        u = e["url"].lstrip("/")
        if u in seen or u.endswith((".js", ".css")) or "ActivateSession" in u or "ScriptsViews" in u:
            continue
        seen.add(u)
        clean.append(e)
    return {"status": "ok", "title": title, "len": len(r.text),
            "js_files": sorted(js_files), "endpoints": clean}


def get_sidebar_links(session):
    """Extrae TODOS los links del menú lateral desde una página conocida."""
    r = session.get(f"{WANSOFT_URL}/Production/SaucerRecipe", timeout=30)
    links = set()
    for m in re.finditer(r"""href\s*=\s*["'](/?(?:Wansoft\.Web/)?[A-Za-z][A-Za-z0-9_]*/[A-Za-z0-9_]+)["']""", r.text):
        u = m.group(1).lstrip("/").replace("Wansoft.Web/", "")
        if u.endswith((".js", ".css", ".png", ".ico")) or any(
            k in u for k in ("Content/", "Scripts/", "ScriptsViews", "Account/", "javascript")
        ):
            continue
        links.add(u)
    print(f"[Sidebar] {len(links)} links encontrados:")
    for u in sorted(links):
        print(f"    - {u}")
    return sorted(links)


def main():
    start = time.time()
    print("=" * 60)
    print(f"WANSOFT ENDPOINT DISCOVERY — client={CLIENT['id']}")
    print("=" * 60)

    session = wansoft_session()

    # Páginas reales desde el sidebar + las hardcodeadas
    sidebar = get_sidebar_links(session)
    pages = sidebar + [p for p in PAGES if p not in sidebar]

    full_map = {}
    for page in pages:
        result = discover_page(session, page)
        full_map[page] = result
        n = len(result.get("endpoints", []))
        if result["status"] != "ok" or (n == 0 and result.get("title") == "Error"):
            continue  # no ensuciar el log con páginas muertas
        print(f"\n[{page}] status={result['status']} title={result.get('title','')!r} len={result.get('len',0)} endpoints={n}")
        for ep in result.get("endpoints", []):
            print(f"    {ep['method']} {ep['url']}  params={ep['params']}")
        time.sleep(0.2)

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
    print(f"\n[DONE] {ok_pages}/{len(pages)} páginas OK, {total} endpoints descubiertos en {int(time.time()-start)}s")


if __name__ == "__main__":
    main()
