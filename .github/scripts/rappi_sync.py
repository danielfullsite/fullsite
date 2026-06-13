#!/usr/bin/env python3
"""
Rappi Sales Sync — login + navigate pages to trigger API calls, capture responses.

Usage:
  python rappi_sync.py              # últimos 30 días
  python rappi_sync.py --days 90
  python rappi_sync.py --headed     # visible browser
"""

import asyncio
import json
import os
import sys
import requests as req
from datetime import datetime, timedelta, date

RAPPI_USER = os.environ.get("RAPPI_USER", "")
RAPPI_PASSWORD = os.environ.get("RAPPI_PASSWORD", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
CLIENT_ID = os.environ.get("CLIENT_ID", "amalay")
DAYS = int(sys.argv[sys.argv.index("--days") + 1]) if "--days" in sys.argv else 30
HEADLESS = "--headed" not in sys.argv

STORE_ID = "MX1930030014"
BRAND_ID = "MX491066"


def sb_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }


async def run():
    from playwright.async_api import async_playwright

    if not RAPPI_USER or not RAPPI_PASSWORD:
        print("ERROR: RAPPI_USER / RAPPI_PASSWORD not set"); sys.exit(1)

    print(f"[rappi] Syncing last {DAYS} days")
    d_from = (date.today() - timedelta(days=DAYS)).isoformat()
    d_to = date.today().isoformat()

    # Collected data
    lots = []
    sales_kpi = {}
    ops_kpi = {}
    ads_data = {}

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=HEADLESS)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 900}, locale="es-MX")
        page = await ctx.new_page()

        # Capture API responses
        async def on_response(response):
            url = response.url
            if response.status >= 400:
                return
            try:
                ct = response.headers.get("content-type", "")
                if "json" not in ct:
                    return
                body = await response.json()

                if "paid-lot/by-stores" in url:
                    content = body.get("content", []) if isinstance(body, dict) else []
                    lots.extend(content)
                elif "indicator/sales/prime" in url and isinstance(body, dict) and "total_amount" in body:
                    sales_kpi.update(body)
                elif "summary/sales/indicators" in url and isinstance(body, dict):
                    ops_kpi.update(body)
                elif "summary-landing" in url and isinstance(body, dict):
                    ads_data.update(body)
            except Exception:
                pass

        page.on("response", on_response)

        # ── Login ──────────────────────────────────────────────────────────
        await page.goto("https://partners.rappi.com", wait_until="networkidle", timeout=30000)
        await page.fill('input[type="email"], input[placeholder*="orreo"]', RAPPI_USER)
        await page.fill('input[type="password"]', RAPPI_PASSWORD)
        await page.click('button:has-text("Ingresar")')
        try:
            await page.wait_for_url("**/home**", timeout=15000)
        except Exception:
            await page.wait_for_timeout(5000)
        if "home" not in page.url:
            print("[rappi] Login failed"); await browser.close(); sys.exit(1)
        print("[rappi] Logged in")

        # Close popovers
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(500)

        # ── Navigate to Ventas (triggers sales + KPI APIs) ─────────────────
        print("[rappi] → Ventas...")
        await page.goto(
            f"https://partners.rappi.com/home?from={d_from}&to={d_to}&brandId={BRAND_ID}&storeIds={STORE_ID}",
            wait_until="networkidle", timeout=20000,
        )
        await page.wait_for_timeout(3000)

        # ── Navigate to Financiero (triggers paid-lot API) ─────────────────
        print("[rappi] → Financiero...")
        await page.goto(
            f"https://partners.rappi.com/financial?from={d_from}&to={d_to}&brandIds={BRAND_ID}&storeIds={STORE_ID}",
            wait_until="networkidle", timeout=20000,
        )
        await page.wait_for_timeout(3000)

        await browser.close()

    # ── Print results ──────────────────────────────────────────────────────
    # Deduplicate lots by id
    seen = set()
    unique_lots = []
    for lot in lots:
        if lot["id"] not in seen:
            seen.add(lot["id"])
            unique_lots.append(lot)
    lots = unique_lots

    print(f"\n{'='*60}")
    print(f"  RAPPI — AMALAY ({d_from} → {d_to})")
    print(f"{'='*60}")

    if lots:
        print(f"\n  PAGOS ({len(lots)} lotes):")
        total_rappi = 0
        for lot in lots:
            total_rappi += lot["total"]
            print(f"    {lot['id']:>10} | {lot['start_date']} → {lot['end_date']} | ${lot['total']:>10.2f} | {lot['status']:6} | pago {lot.get('paid_date', '-')}")
        print(f"    {'TOTAL':>50} ${total_rappi:>10.2f}")
    else:
        print("\n  Sin lotes de pago en el período")

    if sales_kpi:
        print(f"\n  VENTAS:")
        print(f"    Total: ${sales_kpi.get('total_amount', 0):,.2f}")
        print(f"    Órdenes: {sales_kpi.get('total_orders', 0)}")
        print(f"    Ticket promedio: ${sales_kpi.get('orders_avg', 0):,.2f}")
        print(f"    Usuarios Prime: {sales_kpi.get('prime_users_count', 0)} | Nuevos: {sales_kpi.get('new_users_count', 0)}")
        lw = sales_kpi.get("last_week", [])
        if lw:
            print(f"    Diario ({len(lw)} días):")
            for d in lw:
                print(f"      ${d.get('amount', 0):>8.2f} | {d.get('orders', 0):>2} órdenes | avg ${d.get('average', 0):,.2f}")

    if ops_kpi:
        cancel = ops_kpi.get("cancellation", {})
        error = ops_kpi.get("error", {})
        avail = ops_kpi.get("availability", {})
        print(f"\n  OPERATIVO:")
        print(f"    Cancelaciones: {cancel.get('quantity', {}).get('value', 0)} ({cancel.get('percentage', {}).get('value', 0)}%)")
        print(f"    Errores: {error.get('quantity', {}).get('value', 0)} ({error.get('percentage', {}).get('value', 0)}%)")
        print(f"    Disponibilidad: {avail.get('percentage', {}).get('value', 0)}%")

    if ads_data.get("detail"):
        store_ads = ads_data["detail"].get("1930030014", {})
        if store_ads:
            print(f"\n  RAPPI ADS:")
            print(f"    Inversión: ${store_ads.get('burntOut', 0):,.2f}")
            print(f"    Impresiones: {store_ads.get('impressions', 0):,} | Clicks: {store_ads.get('clicks', 0)}")
            print(f"    Órdenes (ads): {store_ads.get('orders', 0)} | Nuevos: {store_ads.get('newUsers', 0)}")

    # ── Upsert to Supabase ─────────────────────────────────────────────────
    if SUPABASE_URL and SUPABASE_KEY and lots:
        print(f"\n[rappi] Upserting {len(lots)} payment lots...")
        rows = []
        for lot in lots:
            rows.append({
                "id": f"rappi-lot-{lot['id']}",
                "client_id": CLIENT_ID,
                "platform": "rappi",
                "lot_id": str(lot["id"]),
                "period_start": lot["start_date"],
                "period_end": lot["end_date"],
                "paid_date": lot.get("paid_date"),
                "total": round(lot["total"], 2),
                "status": lot["status"].lower(),
                "payment_ref": str(lot.get("payment_reference", "")),
                "raw_json": json.dumps(lot),
                "updated_at": datetime.utcnow().isoformat() + "Z",
            })
        r = req.post(f"{SUPABASE_URL}/rest/v1/delivery_platform_payments", headers=sb_headers(), json=rows)
        if r.status_code in (200, 201):
            print(f"  {len(rows)} lots upserted OK")
        else:
            print(f"  {r.status_code}: {r.text[:300]}")
            if r.status_code == 404:
                print("  → Run this SQL in Supabase:")
                print("    CREATE TABLE delivery_platform_payments (id TEXT PRIMARY KEY, client_id TEXT DEFAULT 'amalay', platform TEXT, lot_id TEXT, period_start DATE, period_end DATE, paid_date DATE, total NUMERIC(12,2), status TEXT, payment_ref TEXT, raw_json JSONB, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());")

    print(f"\n[rappi] Done.")


if __name__ == "__main__":
    asyncio.run(run())
