#!/usr/bin/env python3
"""
Wansoft Form Probe — para cada página de reporte real, emula el form POST
con __RequestVerificationToken y los nombres de campo reales del form,
y verifica si regresan filas de datos.

También detecta endpoints Export* (TXT/CSV — el patrón más confiable).
"""

import os
import re
import json
import time
import requests
from datetime import datetime, timedelta, timezone
from bs4 import BeautifulSoup
from client_config import get_client, get_wansoft_creds

CLIENT = get_client()
SUBSIDIARY_ID, WANSOFT_USER, WANSOFT_PASS = get_wansoft_creds(CLIENT)
WANSOFT_URL = "https://www.wansoft.net/Wansoft.Web"

TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")
WEEK_AGO = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")

# Páginas confirmadas reales (title OK en discovery) + candidatas con nombres alternos
PAGES = [
    "Reports/ClosingCash",
    "Reports/CashWithdrawal",
    "Inventory/InventoryStatement",
    "Inventory/PhysicalInventoryVsSystem",
    "ECommerce/ECommerceMenuStatus",
    # Variantes para los que dieron 'Error' o 377 bytes
    "Reports/SaleByArea", "Reports/SalesArea", "Reports/AreaSales",
    "Reports/SaleByTerminal", "Reports/TerminalSales",
    "Reports/CancelSales", "Reports/SaleCancellation",
    "Reports/Courtesies", "Reports/Discounts",
    "Reports/CostBySaucers", "Reports/SaucerCost",
    "Staff/HoursWorked", "Staff/UserHours", "Staff/AccessControlReport",
    "Finance/CashFlowList", "Finance/BankDepositList",
    "Purchasing/PurchaseOrderList", "Purchasing/SupplierList",
    "Billing/DocumentList", "Billing/Documents",
    "Inventory/Movements", "Inventory/ProductMovements",
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


def count_data_rows(html):
    """Filas con datos reales (no headers, no nav)."""
    soup = BeautifulSoup(html, "html.parser")
    rows = []
    for sel in (".rowReport", "table tbody tr", ".jqgrow"):
        for el in soup.select(sel):
            txt = el.get_text(" ", strip=True)
            if txt and re.search(r"\d", txt) and "Reportes /" not in txt:
                rows.append(txt[:120])
        if rows:
            break
    return rows


def build_form_data(form):
    """Llena los campos del form con valores razonables."""
    data = {}
    for inp in form.select("input"):
        name = inp.get("name")
        if not name:
            continue
        data[name] = inp.get("value", "")
    for sel_el in form.select("select"):
        name = sel_el.get("name")
        if not name:
            continue
        opts = [o.get("value") for o in sel_el.select("option") if o.get("value")]
        if "subsidiary" in name.lower():
            data[name] = str(SUBSIDIARY_ID)
        else:
            data[name] = opts[0] if opts else ""
    for k in list(data):
        kl = k.lower()
        if "subsidiary" in kl and not data[k]:
            data[k] = str(SUBSIDIARY_ID)
        elif ("start" in kl or "initial" in kl) and "date" in kl:
            data[k] = WEEK_AGO
        elif ("end" in kl or "final" in kl) and "date" in kl:
            data[k] = TODAY
        elif kl == "date" or kl == "fecha":
            data[k] = TODAY
    return data


def probe_page(session, page):
    try:
        r = session.get(f"{WANSOFT_URL}/{page}", timeout=30)
    except Exception as e:
        print(f"[{page}] error {e}")
        return
    final_path = r.url.split("Wansoft.Web/")[-1].split("?")[0].rstrip("/")
    if r.status_code != 200 or final_path.lower() != page.lower():
        print(f"[{page}] skip (status={r.status_code} → {final_path})")
        return
    title_m = re.search(r"<title>(.*?)</title>", r.text, re.DOTALL)
    title = (title_m.group(1).strip() if title_m else "")[:50]
    if title == "Error" or len(r.text) < 1000:
        print(f"[{page}] skip (title={title!r} len={len(r.text)})")
        return

    soup = BeautifulSoup(r.text, "html.parser")
    print(f"\n[{page}] title={title!r}")

    for form in soup.select("form"):
        action = (form.get("action") or f"/{page}").lstrip("/").replace("Wansoft.Web/", "")
        if "Account" in action or "LogOff" in action:
            continue
        data = build_form_data(form)
        shown = {k: str(v)[:20] for k, v in data.items()}
        print(f"    FORM action={action} fields={json.dumps(shown, ensure_ascii=False)[:280]}")
        try:
            pr = session.post(f"{WANSOFT_URL}/{action}", data=data, timeout=40)
            ctype = pr.headers.get("Content-Type", "")
            if "text/html" not in ctype:
                print(f"    → status={pr.status_code} ctype={ctype} len={len(pr.content)} EXPORT!")
                print(f"    → preview: {pr.text[:300]!r}")
            else:
                rows = count_data_rows(pr.text)
                print(f"    → status={pr.status_code} len={len(pr.text)} data_rows={len(rows)}")
                for row in rows[:5]:
                    print(f"       | {row}")
        except Exception as e:
            print(f"    → ERROR {e}")
        time.sleep(0.3)

    # Botones/links de Export en la página
    exports = set(re.findall(r"""["'](/?(?:Wansoft\.Web/)?[A-Za-z]+/Export[A-Za-z0-9_]+)["']""", r.text))
    for ex in sorted(exports):
        print(f"    [export-link] {ex.lstrip('/').replace('Wansoft.Web/', '')}")


def main():
    print("=" * 60)
    print(f"WANSOFT FORM PROBE — client={CLIENT['id']} rango {WEEK_AGO} → {TODAY}")
    print("=" * 60)
    session = wansoft_session()
    for page in PAGES:
        probe_page(session, page)
        time.sleep(0.3)
    print("\n[DONE]")


if __name__ == "__main__":
    main()
