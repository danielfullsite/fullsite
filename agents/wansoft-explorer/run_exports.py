"""Re-run only pending exports using existing crawl data."""

import asyncio
import json
import os
import sys

from dotenv import load_dotenv
from playwright.async_api import async_playwright

from src.auth import login
from src.crawler import MenuItem
from src.export_handler import download_exports


def load_items(path: str) -> list[MenuItem]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    items = []
    for d in data:
        fields = {k: v for k, v in d.items() if k in MenuItem.__dataclass_fields__}
        items.append(MenuItem(**fields))
    return items


async def run():
    load_dotenv(override=True)

    items = load_items("output/crawl_results.json")
    export_items = [i for i in items if i.has_export and i.href]
    print(f"Loaded {len(items)} items, {len(export_items)} with export")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 900},
            accept_downloads=True,
        )
        page = await context.new_page()
        page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))

        # Login
        success = await login(page, os.getenv("WANSOFT_PORTAL_URL"), os.getenv("WANSOFT_USER"), os.getenv("WANSOFT_PASS"))
        if not success:
            print("Login FAILED")
            await browser.close()
            return

        # Run exports (resume logic built in)
        schemas = await download_exports(page, items, "output")
        await browser.close()

    print(f"\nTotal schemas: {len(schemas)}")


if __name__ == "__main__":
    asyncio.run(run())
