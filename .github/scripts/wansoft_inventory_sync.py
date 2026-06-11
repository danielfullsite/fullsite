#!/usr/bin/env python3
"""
Wansoft Inventory Sync — pulls inventory data from Wansoft JSON endpoints.

Endpoints discovered by wansoft_endpoint_discovery.py:
- Inventory/GetWarehousesBySubsidiarySortedByName → list warehouses
- Inventory/GetInventoryStatementBySubsidiary → full inventory state
- Inventory/GetProductsBySubsidiary → product catalog
- Inventory/GetReOrderListByWareHouse → reorder points (min/max)

Saves to: wansoft_data (inventory_state, warehouses, reorder_points, products_catalog)
"""

import os
import sys
import json
import requests
from datetime import datetime, timezone

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


def post_json(session, endpoint, data=None):
    """POST to Wansoft endpoint and return JSON response."""
    url = f"{WANSOFT_URL}/{endpoint}"
    try:
        r = session.post(url, json=data or {}, timeout=30)
        if r.status_code == 200:
            try:
                return r.json()
            except:
                print(f"  [!] {endpoint}: not JSON (len={len(r.text)})")
                return None
        else:
            print(f"  [!] {endpoint}: HTTP {r.status_code}")
            return None
    except Exception as e:
        print(f"  [!] {endpoint}: {e}")
        return None


def save_wansoft_data(data_key, data):
    """Save to wansoft_data table."""
    row = {
        "client_id": CLIENT["id"],
        "data_key": data_key,
        "fecha": TODAY,
        "data": json.dumps(data, ensure_ascii=False) if not isinstance(data, str) else data,
    }
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/wansoft_data",
        headers=SB_HEADERS,
        json=row,
    )
    if r.status_code < 300:
        print(f"  [saved] {data_key} ({len(json.dumps(data))} chars)")
    else:
        # Try PATCH
        r2 = requests.patch(
            f"{SUPABASE_URL}/rest/v1/wansoft_data?client_id=eq.{CLIENT['id']}&data_key=eq.{data_key}&fecha=eq.{TODAY}",
            headers=SB_HEADERS,
            json={"data": row["data"]},
        )
        print(f"  [updated] {data_key}" if r2.status_code < 300 else f"  [!] {data_key}: {r2.status_code}")


def main():
    print("=" * 60)
    print(f"WANSOFT INVENTORY SYNC — {CLIENT['id']} — {TODAY}")
    print("=" * 60)

    session = wansoft_session()

    # 1. Get warehouses
    print("\n[1] Warehouses...")
    warehouses = post_json(session, "Inventory/GetWarehousesBySubsidiarySortedByName", {"subsidiaryId": SUBSIDIARY_ID})
    if warehouses:
        if isinstance(warehouses, list):
            print(f"  Found {len(warehouses)} warehouses")
            for w in warehouses[:5]:
                print(f"    - {w}")
            save_wansoft_data("warehouses", warehouses)
        elif isinstance(warehouses, dict) and "Result" in warehouses:
            wlist = warehouses["Result"]
            print(f"  Found {len(wlist)} warehouses")
            save_wansoft_data("warehouses", wlist)
        else:
            print(f"  Unexpected format: {type(warehouses)}")
            save_wansoft_data("warehouses", warehouses)

    # 2. Get products catalog
    print("\n[2] Products catalog...")
    products = post_json(session, "Inventory/GetProductsBySubsidiary", {"subsidiaryId": SUBSIDIARY_ID})
    if products:
        plist = products if isinstance(products, list) else products.get("Result", products)
        if isinstance(plist, list):
            print(f"  Found {len(plist)} products")
            for p in plist[:3]:
                print(f"    - {p}")
            save_wansoft_data("products_catalog", plist)
        else:
            save_wansoft_data("products_catalog", products)

    # 3. Get inventory statement per warehouse
    print("\n[3] Inventory statement per warehouse...")
    wh_list = warehouses if isinstance(warehouses, list) else (warehouses.get("warehouses", warehouses.get("Result", [])) if isinstance(warehouses, dict) else [])
    all_inventory = []
    for wh in wh_list:
        wh_id = wh.get("Value", "") if isinstance(wh, dict) else ""
        wh_name = wh.get("Text", "") if isinstance(wh, dict) else ""
        if not wh_id or "ELIMINADO" in wh_name.upper():
            continue
        print(f"  Warehouse: {wh_name} (ID: {wh_id})")
        # Try ExportInventoryStatement — more data
        inv = post_json(session, "Inventory/GetInventoryStatementBySubsidiary", {
            "subsidiaryId": SUBSIDIARY_ID,
            "warehouseId": wh_id,
        })
        if inv:
            ilist = inv if isinstance(inv, list) else inv.get("Result", inv.get("Data", []))
            if isinstance(ilist, list):
                for item in ilist:
                    if isinstance(item, dict):
                        item["_warehouse"] = wh_name
                        item["_warehouseId"] = wh_id
                all_inventory.extend(ilist if isinstance(ilist, list) else [])
                print(f"    → {len(ilist) if isinstance(ilist, list) else '?'} items")
            else:
                print(f"    → unexpected: {type(ilist)}")
        else:
            print(f"    → null response")

    if all_inventory:
        print(f"  Total inventory: {len(all_inventory)} items across {len(wh_list)} warehouses")
        save_wansoft_data("inventory_state", all_inventory)

    # 4. Get reorder points per warehouse
    print("\n[4] Reorder points per warehouse...")
    all_reorder = []
    for wh in wh_list:
        wh_id = wh.get("Value", "") if isinstance(wh, dict) else ""
        wh_name = wh.get("Text", "") if isinstance(wh, dict) else ""
        if not wh_id or "ELIMINADO" in wh_name.upper():
            continue
        reorder = post_json(session, "Inventory/GetReOrderListByWareHouse", {"warehouseId": wh_id})
        if reorder:
            rlist = reorder if isinstance(reorder, list) else reorder.get("Result", reorder.get("Data", []))
            if isinstance(rlist, list):
                for item in rlist:
                    if isinstance(item, dict):
                        item["_warehouse"] = wh_name
                all_reorder.extend(rlist if isinstance(rlist, list) else [])
                print(f"  {wh_name}: {len(rlist) if isinstance(rlist, list) else '?'} rules")

    if all_reorder:
        print(f"  Total reorder rules: {len(all_reorder)}")
        save_wansoft_data("reorder_points", all_reorder)

    # 5. E-commerce menu status
    print("\n[5] E-commerce menu status...")
    ecom = post_json(session, "ECommerce/GetECommerceMenuStatusList", {})
    if ecom:
        elist = ecom if isinstance(ecom, list) else ecom.get("Result", ecom)
        if isinstance(elist, list):
            print(f"  Found {len(elist)} e-commerce items")
            save_wansoft_data("ecommerce_menu_status", elist)
        else:
            save_wansoft_data("ecommerce_menu_status", ecom)

    print("\n[DONE]")


if __name__ == "__main__":
    main()
