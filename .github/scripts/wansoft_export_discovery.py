#!/usr/bin/env python3
"""
Wansoft Export Endpoint Discovery
Tries every possible Export URL pattern to find which reports have downloadable data.
Outputs a map of working export endpoints for use in the main scraper.

Usage: python wansoft_export_discovery.py
"""

import os
import sys
import json
import requests
import time
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(__file__))
from client_config import get_client, get_tz, get_wansoft_creds

CLIENT = get_client()
MX_TZ = get_tz(CLIENT)
WANSOFT_URL = "https://www.wansoft.net/Wansoft.Web"
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
today = now_mx.strftime("%Y-%m-%d")
yesterday = (now_mx - timedelta(days=1)).strftime("%Y-%m-%d")
thirty_ago = (now_mx - timedelta(days=30)).strftime("%Y-%m-%d")
month_start = today[:8] + "01"
year = today[:4]

# All report base names from Wansoft
REPORT_BASES = [
    # Sales
    "SalesByHours", "SalesByArea", "SalesByTerminal", "SalesByUser",
    "SalesByGroup", "SalesBySaucer", "SalesByTypeOfOrder", "SalesByPaymentType",
    "SalesByModifiers", "SalesByWaiterByGroupReport",
    "DiscountsDetail", "CancelSalesDetail", "SaleNullificationDetail",
    "CourtesiesDetail", "SaleDetail",
    # Food cost
    "GetCostBySaucer", "GetCostByGroup", "GetSaucersWithCost",
    # Inventory
    "GetInventoryBySubsidiary", "GetInventoryStatementBySubsidiary",
    "GetReorderPointReport", "GetPhysicalInventoryVsSystem",
    "GetProductsThatAreInRecipes", "GetProductsThatAreNotInRecipes",
    # Procurement
    "ShopBySupplier", "ShopByProduct",
    # Staff
    "GetAccessControlReport", "GetUserHoursWorkedReport",
    # Finance
    "GetIncomeStatemetByMonthInYear", "ClosingCash",
    "GetCashFlowList", "GetCashWithdrawalReport", "GetBankDepositList",
    # Billing
    "GetDocumentList",
]

# URL prefixes to try for each report
PREFIXES = ["Reports", "Inventory", "Finance", "Billing", "Staff", "Purchasing"]

# Export URL patterns to try
EXPORT_PATTERNS = [
    "Export{base}",           # ExportSalesByHours
    "Export{base}ToTxt",      # ExportSalesByHoursToTxt
    "Export{base}ToExcel",    # ExportSalesByHoursToExcel
    "Export{base}ToCsv",      # ExportSalesByHoursToCsv
    "{base}Export",           # SalesByHoursExport
    "{base}ToExcel",          # SalesByHoursToExcel
    "Get{base}Export",        # GetSalesByHoursExport
    "Download{base}",         # DownloadSalesByHours
    "{base}Download",         # SalesByHoursDownload
]


def login():
    s = requests.Session()
    s.get(f"{WANSOFT_URL}/")
    r = s.post(f"{WANSOFT_URL}/", data={"UserName": WANSOFT_USER, "Password": WANSOFT_PASS},
               allow_redirects=True)
    if "Dashboard" not in r.url and "MyDocumentsList" not in r.url:
        raise Exception(f"Login failed: {r.url}")
    return s


def is_data_response(r):
    """Check if response contains actual exportable data."""
    if r.status_code != 200:
        return False, f"HTTP {r.status_code}"

    ct = r.headers.get("content-type", "").lower()
    text = r.text[:500] if hasattr(r, 'text') else ""

    # Excel/CSV/TXT file
    if "octet-stream" in ct or "excel" in ct or "csv" in ct or "spreadsheet" in ct:
        return True, f"BINARY ({ct}, {len(r.content)} bytes)"

    # Pipe-delimited TXT
    if "|" in text[:200] and text.count("|") > 5:
        return True, f"PIPE-DELIMITED ({len(text)} chars, {text.count(chr(10))} lines)"

    # CSV (comma-separated with headers)
    if "," in text[:200] and text.count(",") > 5 and "\n" in text[:500]:
        lines = text.split("\n")
        if len(lines) > 2:
            return True, f"CSV ({len(lines)} lines)"

    # Tab-delimited
    if "\t" in text[:200] and text.count("\t") > 3:
        return True, f"TAB-DELIMITED ({len(text)} chars)"

    # JSON array
    if text.startswith("[") or text.startswith("{"):
        try:
            data = r.json()
            if isinstance(data, list) and len(data) > 0:
                return True, f"JSON ({len(data)} items)"
            if isinstance(data, dict) and data.get("rows"):
                return True, f"JSON-GRID ({len(data['rows'])} rows)"
        except Exception:
            pass

    # HTML with actual data tables (not empty page)
    if "<table" in text and "<td>" in text:
        import re
        td_count = len(re.findall(r"<td[^>]*>", text))
        if td_count > 10:
            return True, f"HTML-TABLE ({td_count} cells)"

    return False, f"EMPTY (ct={ct}, {len(text)} chars)"


def main():
    print(f"{'='*70}")
    print(f"WANSOFT EXPORT ENDPOINT DISCOVERY — {today}")
    print(f"{'='*70}\n")

    session = login()
    print("[✓] Login OK\n")

    params_today = {"subsidiaryId": SUBSIDIARY_ID, "startDate": today, "endDate": today}
    params_range = {"subsidiaryId": SUBSIDIARY_ID, "startDate": thirty_ago, "endDate": today}
    params_month = {"subsidiaryId": SUBSIDIARY_ID, "startDate": month_start, "endDate": today}

    working = []
    failed = []
    total_tried = 0

    for base in REPORT_BASES:
        print(f"\n━━━ {base} ━━━")

        for prefix in PREFIXES:
            for pattern in EXPORT_PATTERNS:
                export_name = pattern.format(base=base)
                url = f"{prefix}/{export_name}"
                total_tried += 1

                # Try with different date params
                for params, label in [
                    (params_today, "today"),
                    (params_range, "30d"),
                ]:
                    try:
                        # Try GET first
                        r = session.get(f"{WANSOFT_URL}/{url}", params=params, timeout=15,
                                        allow_redirects=False)
                        has_data, detail = is_data_response(r)
                        if has_data:
                            print(f"  [✓] GET {url} ({label}): {detail}")
                            working.append({"method": "GET", "url": url, "params": label, "detail": detail, "base": base})
                            break

                        # Try POST
                        r = session.post(f"{WANSOFT_URL}/{url}", data=params, timeout=15,
                                         allow_redirects=False)
                        has_data, detail = is_data_response(r)
                        if has_data:
                            print(f"  [✓] POST {url} ({label}): {detail}")
                            working.append({"method": "POST", "url": url, "params": label, "detail": detail, "base": base})
                            break

                    except Exception:
                        continue
                else:
                    continue
                break  # Found one that works, stop trying patterns for this prefix

    # Also try the direct report page URLs (some return data directly)
    print(f"\n\n━━━ DIRECT REPORT PAGES ━━━")
    for base in REPORT_BASES:
        for prefix in PREFIXES:
            url = f"{prefix}/{base}"
            total_tried += 1
            try:
                r = session.post(f"{WANSOFT_URL}/{url}", data=params_today, timeout=15)
                has_data, detail = is_data_response(r)
                if has_data and "HTML-TABLE" in detail:
                    print(f"  [✓] POST {url}: {detail}")
                    working.append({"method": "POST", "url": url, "params": "today", "detail": detail, "base": base})
            except Exception:
                continue

    # Summary
    print(f"\n\n{'='*70}")
    print(f"DISCOVERY COMPLETE")
    print(f"{'='*70}")
    print(f"Total URLs tried: {total_tried}")
    print(f"Working exports: {len(working)}")
    print(f"\nWORKING ENDPOINTS:")
    for w in working:
        print(f"  {w['method']} {w['url']} ({w['params']}): {w['detail']}")

    # Save to Supabase
    try:
        requests.post(f"{SUPABASE_URL}/rest/v1/wansoft_data",
            headers=sb_headers,
            json={
                "client_id": CLIENT["id"],
                "fecha": today,
                "data_key": "export_discovery",
                "data": json.dumps(working),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
        print("\n[✓] Saved discovery results to Supabase")
    except Exception as e:
        print(f"\n[!] Save failed: {e}")

    # Send to Telegram
    msg = f"🔍 EXPORT DISCOVERY — {today}\n\n"
    msg += f"URLs probadas: {total_tried}\n"
    msg += f"Exports funcionales: {len(working)}\n\n"
    for w in working:
        msg += f"✓ {w['method']} {w['url']}\n  → {w['detail']}\n\n"

    if not working:
        msg += "❌ Ningun export endpoint funcional encontrado.\nWansoft no tiene export HTTP para estos reportes."

    if TG_CHAT_ID:
        for chunk in [msg[i:i+4000] for i in range(0, len(msg), 4000)]:
            requests.post(f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                          json={"chat_id": TG_CHAT_ID, "text": chunk})

    # Log
    try:
        requests.post(f"{SUPABASE_URL}/rest/v1/agent_runs", headers=sb_headers,
                      json={"agent_id": "wansoft-export-discovery", "trigger_type": "manual",
                            "status": "success", "duration_ms": 0,
                            "output_summary": f"tried: {total_tried}, working: {len(working)}", "tentacle": "ops"})
    except Exception:
        pass


if __name__ == "__main__":
    main()
