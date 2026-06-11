#!/usr/bin/env python3
"""
Probe one-off: Wansoft eliminó Reports/SalesByBranch (2026-06-11).
Busca el reporte que lo reemplaza:
1. Confirma estado de SalesByBranch
2. Inspecciona candidatos (ConsolidatedSalesMasterReport, ClosingCash, SaleDetail, etc.)
3. Baja ScriptsViews/Reports/<Pagina>.js y extrae endpoints AJAX (técnica probada)
4. Guarda HTML de cada página en downloads/ para artifact
"""

import os
import re
import sys
import time
import requests

sys.path.insert(0, os.path.dirname(__file__))
from client_config import get_client, get_wansoft_creds

CLIENT = get_client()
WANSOFT_URL = "https://www.wansoft.net/Wansoft.Web"
SUBSIDIARY_ID, WANSOFT_USER, WANSOFT_PASS = get_wansoft_creds(CLIENT)

OUT_DIR = "probe_out"
os.makedirs(OUT_DIR, exist_ok=True)

CANDIDATES = [
    "Reports/SalesByBranch",            # el muerto — confirmar
    "Reports/ConsolidatedSalesMasterReport",
    "Reports/ClosingCash",
    "Reports/HistoricalClosingCash",
    "Reports/SaleDetail",
    "Reports/Dashboard",
]


def wansoft_session():
    s = requests.Session()
    s.get(f"{WANSOFT_URL}/")
    resp = s.post(f"{WANSOFT_URL}/", data={
        "UserName": WANSOFT_USER,
        "Password": WANSOFT_PASS,
    }, allow_redirects=True)
    if "Dashboard" not in resp.url and "MyDocumentsList" not in resp.url:
        raise Exception(f"Login failed. URL: {resp.url}")
    print("[OK] Login")
    return s


def probe(session, page):
    name = page.replace("/", "_")
    print(f"\n{'=' * 60}\n[{page}]")
    try:
        r = session.get(f"{WANSOFT_URL}/{page}", timeout=30)
    except Exception as e:
        print(f"  GET error: {e}")
        return

    with open(f"{OUT_DIR}/{name}.html", "w") as f:
        f.write(r.text)

    title_m = re.search(r"<title>(.*?)</title>", r.text, re.DOTALL)
    title = (title_m.group(1).strip() if title_m else "")[:60]
    has_error = "Ocurrió un error en la aplicación" in r.text
    has_dates = bool(re.search(r'id="(startDate|endDate)"', r.text))
    has_export = "btnExport" in r.text or "Exportar" in r.text
    print(f"  status={r.status_code} len={len(r.text)} title={title!r}")
    print(f"  error_page={has_error} date_inputs={has_dates} export_btn={has_export}")

    # ScriptsViews JS — revela endpoints AJAX reales
    js_refs = sorted(set(re.findall(r"""ScriptsViews/([A-Za-z]+/[A-Za-z0-9_]+)\.js""", r.text)))
    for ref in js_refs:
        try:
            jr = session.get(f"{WANSOFT_URL}/ScriptsViews/{ref}.js", timeout=20)
            if jr.status_code == 200 and len(jr.text) > 50:
                with open(f"{OUT_DIR}/{name}__{ref.replace('/', '_')}.js", "w") as f:
                    f.write(jr.text)
                endpoints = sorted(set(re.findall(
                    r"""GetRootUrl\(\)\s*\+\s*['"]([^'"]+)['"]""", jr.text)))
                print(f"  JS {ref}.js ({len(jr.text)}b) endpoints:")
                for ep in endpoints:
                    print(f"    -> {ep}")
        except Exception as e:
            print(f"  JS {ref} error: {e}")

    # Links de export embebidos
    exports = sorted(set(re.findall(
        r"""["'](/?(?:Wansoft\.Web/)?[A-Za-z]+/Export[A-Za-z0-9_]+)["']""", r.text)))
    for ex in exports:
        print(f"  [export-link] {ex}")

    time.sleep(0.4)


def main():
    print(f"WANSOFT SALES REPORT PROBE — client={CLIENT['id']}")
    session = wansoft_session()
    for page in CANDIDATES:
        probe(session, page)
    print("\n[DONE]")


if __name__ == "__main__":
    main()
