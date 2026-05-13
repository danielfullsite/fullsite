"""Wansoft Explorer Agent — entry point."""

import asyncio
import os
import sys
import time

from dotenv import load_dotenv
from playwright.async_api import async_playwright

from src.auth import login
from src.http_interceptor import HTTPInterceptor
from src.crawler import crawl_menu, save_items
from src.export_handler import download_exports
from src.catalog import build_catalog
from src.supabase_client import upsert_catalog
from src.telegram_reporter import send_summary


async def run_full():
    """Run the complete Wansoft Explorer pipeline."""
    print("=" * 60)
    print("wansoft-explorer v0.1 — Full Run (Pasos 2-7)")
    print("=" * 60)

    load_dotenv(override=True)
    portal_url = os.getenv("WANSOFT_PORTAL_URL")
    user = os.getenv("WANSOFT_USER")
    password = os.getenv("WANSOFT_PASS")

    if not all([portal_url, user, password]):
        print("ERROR: Missing WANSOFT credentials in .env")
        sys.exit(1)

    # Ensure output directories
    os.makedirs("output/screenshots", exist_ok=True)
    os.makedirs("output/xlsx_samples", exist_ok=True)

    interceptor = HTTPInterceptor()
    start_time = time.time()

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 900},
            accept_downloads=True,
        )
        page = await context.new_page()

        # Auto-dismiss Wansoft HTML modals and native dialogs
        page.on("dialog", lambda dialog: asyncio.ensure_future(dialog.accept()))

        interceptor.setup(page)

        # === Paso 2: Login ===
        print("\n[run] === PASO 2: Login ===")
        success = await login(page, portal_url, user, password)
        if not success:
            print("[run] Login FAILED — aborting")
            interceptor.dump_json("output/captured.json")
            await browser.close()
            return False

        interceptor.dump_json("output/captured_login.json")
        print("[run] Login OK")

        # === Paso 3+4: Crawler (nivel 1 + recursivo) ===
        print("\n[run] === PASO 3+4: Crawling menu ===")
        interceptor.clear()
        items = await crawl_menu(page, interceptor, "output")
        save_items(items, "output")

        # Safety log (Wansoft has ~200 items including categories — this is expected)
        if len(items) > 100:
            print(f"\n[run] NOTE: {len(items)} items found (expected for Wansoft full menu)")
            navigable = [i for i in items if i.href]
            print(f"[run] Navigable pages: {len(navigable)}")

        # === Paso 5: Export handler ===
        print("\n[run] === PASO 5: Export handler ===")
        xlsx_schemas = await download_exports(page, items, "output")

        await browser.close()

    # === Paso 6: Catalog + Supabase ===
    print("\n[run] === PASO 6: Catalog + Supabase ===")
    portal_map = build_catalog(items, xlsx_schemas, "output")
    upsert_catalog(portal_map)

    # === Paso 7: Telegram ===
    duration = time.time() - start_time
    print("\n[run] === PASO 7: Telegram reporter ===")
    send_summary(portal_map, xlsx_schemas, duration)

    # Final summary
    elapsed_min = int(duration // 60)
    elapsed_sec = int(duration % 60)
    print("\n" + "=" * 60)
    print(f"wansoft-explorer COMPLETE — {elapsed_min}m {elapsed_sec}s")
    print(f"  Items: {len(items)}")
    print(f"  Exports: {len(xlsx_schemas)}")
    print(f"  Artifacts: output/portal_map.json, output/endpoints.json")
    print("=" * 60)

    return True


def main():
    success = asyncio.run(run_full())
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
