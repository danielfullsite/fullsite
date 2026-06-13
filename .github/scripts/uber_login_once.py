#!/usr/bin/env python3
"""
Uber Eats — login con OTP manual, guardar cookies para reuso.
Abre browser headed, espera que metas el código SMS, navega y captura datos.
"""

import asyncio
import json
import os
import sys

UBER_USER = os.environ.get("UBER_USER", "")
UBER_PASSWORD = os.environ.get("UBER_PASSWORD", "")
COOKIES_FILE = "/tmp/uber-cookies.json"


async def run():
    from playwright.async_api import async_playwright

    if not UBER_USER:
        print("ERROR: UBER_USER not set"); sys.exit(1)

    print("[uber] Opening browser — enter the SMS code when prompted")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)  # MUST be headed for OTP
        ctx = await browser.new_context(viewport={"width": 1280, "height": 900}, locale="es-MX")
        page = await ctx.new_page()

        # Capture API responses
        captured = []
        async def on_response(response):
            url = response.url
            if response.status >= 400:
                return
            try:
                ct = response.headers.get("content-type", "")
                if "json" in ct:
                    body = await response.json()
                    captured.append({"url": url, "body": body})
            except Exception:
                pass
        page.on("response", on_response)

        # Go to login
        await page.goto("https://merchants.ubereats.com/manager/", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(2000)

        # Fill email
        for sel in ['input[name="email"]', 'input[type="email"]', '#useridInput']:
            try:
                el = page.locator(sel).first
                if await el.is_visible(timeout=3000):
                    await el.fill(UBER_USER)
                    print(f"[uber] Email filled")
                    break
            except Exception:
                continue

        # Click Continue
        for btn in ['button:has-text("Continuar")', 'button:has-text("Next")', 'button[type="submit"]']:
            try:
                el = page.locator(btn).first
                if await el.is_visible(timeout=2000):
                    await el.click()
                    break
            except Exception:
                continue

        # Wait for user to enter OTP and get to dashboard
        print("[uber] ⏳ Esperando que ingreses el código SMS en el browser...")
        print("[uber]    (el teléfono termina en **44)")
        print("[uber]    El script continúa automáticamente cuando llegues al dashboard.")

        # Poll until we're past auth
        for _ in range(120):  # max 4 minutes
            await page.wait_for_timeout(2000)
            url = page.url
            if "manager" in url and "auth" not in url:
                break

        current = page.url
        if "auth" in current or "challenge" in current:
            print("[uber] Timeout esperando login — intenta de nuevo")
            await browser.close()
            sys.exit(1)

        print(f"[uber] Dashboard loaded: {current}")

        # Save cookies for reuse
        cookies = await ctx.cookies()
        with open(COOKIES_FILE, "w") as f:
            json.dump(cookies, f)
        print(f"[uber] Cookies saved: {COOKIES_FILE} ({len(cookies)} cookies)")

        # ── Navigate to key pages ──────────────────────────────────────────
        await page.wait_for_timeout(3000)
        await page.screenshot(path="/tmp/uber-home.png", full_page=True)
        print("[uber] Screenshot: /tmp/uber-home.png")

        # Dump nav elements
        links = await page.evaluate("""() => {
            const els = document.querySelectorAll('a, button, [role="menuitem"], [role="tab"], nav a, [data-testid]');
            return Array.from(els).slice(0, 60).map(e => ({
                tag: e.tagName,
                text: e.textContent?.trim()?.slice(0, 80),
                href: e.href || e.getAttribute('href') || '',
                testid: e.getAttribute('data-testid') || '',
            })).filter(e => e.text || e.href);
        }""")
        print(f"\n[uber] Nav elements ({len(links)}):")
        for l in links[:40]:
            print(f"  {l['tag']:8} | {l['text'][:40]:40} | {l['href'][:50]}")

        # Try to navigate to Orders
        for sel in ['a:has-text("Orders")', 'a:has-text("Pedidos")', 'a[href*="order"]', '[data-testid*="order"]']:
            try:
                el = page.locator(sel).first
                if await el.is_visible(timeout=2000):
                    await el.click()
                    await page.wait_for_timeout(4000)
                    print(f"[uber] → Orders: {page.url}")
                    await page.screenshot(path="/tmp/uber-orders.png", full_page=True)
                    break
            except Exception:
                continue

        # Try Payments
        for sel in ['a:has-text("Payments")', 'a:has-text("Pagos")', 'a[href*="payment"]']:
            try:
                el = page.locator(sel).first
                if await el.is_visible(timeout=2000):
                    await el.click()
                    await page.wait_for_timeout(4000)
                    print(f"[uber] → Payments: {page.url}")
                    await page.screenshot(path="/tmp/uber-payments.png", full_page=True)
                    break
            except Exception:
                continue

        # Try Analytics / Reports
        for sel in ['a:has-text("Analytics")', 'a:has-text("Reports")', 'a:has-text("Reportes")', 'a[href*="analytics"]', 'a[href*="report"]']:
            try:
                el = page.locator(sel).first
                if await el.is_visible(timeout=2000):
                    await el.click()
                    await page.wait_for_timeout(4000)
                    print(f"[uber] → Analytics: {page.url}")
                    await page.screenshot(path="/tmp/uber-analytics.png", full_page=True)
                    break
            except Exception:
                continue

        # Dump all captured API responses
        print(f"\n[uber] Captured {len(captured)} API responses:")
        # Filter to interesting ones
        interesting = [c for c in captured if any(kw in c["url"].lower() for kw in ["order", "payment", "payout", "analytics", "report", "sales", "revenue", "store", "merchant"])]
        for c in interesting[:20]:
            body_str = json.dumps(c["body"], ensure_ascii=False)[:400]
            print(f"\n  {c['url'][:100]}")
            print(f"  {body_str}")

        if not interesting:
            print("  (no order/payment APIs captured — dumping all)")
            for c in captured[:15]:
                body_str = json.dumps(c["body"], ensure_ascii=False)[:300]
                print(f"\n  {c['url'][:100]}")
                print(f"  {body_str}")

        await browser.close()

    print(f"\n[uber] Done. Cookies in {COOKIES_FILE}")


if __name__ == "__main__":
    asyncio.run(run())
