#!/usr/bin/env python3
"""
Uber Eats Sales Sync — login via Playwright, navigate to orders/payments,
capture API responses.

Usage:
  python uber_sync.py              # explore
  python uber_sync.py --headed     # visible browser
"""

import asyncio
import json
import os
import sys
from datetime import datetime, timedelta, date

UBER_USER = os.environ.get("UBER_USER", "")
UBER_PASSWORD = os.environ.get("UBER_PASSWORD", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
CLIENT_ID = os.environ.get("CLIENT_ID", "amalay")
HEADLESS = "--headed" not in sys.argv


async def run():
    from playwright.async_api import async_playwright

    if not UBER_USER or not UBER_PASSWORD:
        print("ERROR: UBER_USER / UBER_PASSWORD not set"); sys.exit(1)

    print(f"[uber] Starting sync, headless={HEADLESS}")

    # Collected API data
    captured = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=HEADLESS)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 900}, locale="es-MX")
        page = await ctx.new_page()

        # Capture ALL JSON API responses
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

        # ── Login ──────────────────────────────────────────────────────────
        print("[uber] Navigating to login...")
        await page.goto("https://merchants.ubereats.com/manager/", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(2000)

        # Uber login flow — could be email+password on same page or multi-step
        current = page.url
        print(f"[uber] Login page: {current}")

        # Try to find email input
        email_selectors = [
            'input[name="email"]', 'input[type="email"]', '#useridInput',
            'input[id*="email"]', 'input[autocomplete="username"]',
        ]
        email_filled = False
        for sel in email_selectors:
            try:
                el = page.locator(sel).first
                if await el.is_visible(timeout=3000):
                    await el.fill(UBER_USER)
                    email_filled = True
                    print(f"[uber] Email filled via {sel}")
                    break
            except Exception:
                continue

        if not email_filled:
            # Maybe it's an SSO page or different layout
            await page.screenshot(path="/tmp/uber-login-1.png")
            print("[uber] Could not find email input — screenshot: /tmp/uber-login-1.png")
            # Dump all inputs
            inputs = await page.evaluate("""() => {
                return Array.from(document.querySelectorAll('input')).map(i => ({
                    name: i.name, type: i.type, id: i.id, placeholder: i.placeholder,
                    class: i.className?.slice(0, 40),
                }));
            }""")
            print(f"[uber] Inputs: {json.dumps(inputs, indent=1)}")

        # Click Next/Continue
        for btn_sel in ['button:has-text("Next")', 'button:has-text("Siguiente")', 'button:has-text("Continue")', 'button:has-text("Continuar")', 'button[type="submit"]']:
            try:
                el = page.locator(btn_sel).first
                if await el.is_visible(timeout=2000):
                    await el.click()
                    print(f"[uber] Clicked {btn_sel}")
                    break
            except Exception:
                continue

        await page.wait_for_timeout(3000)

        # Password step
        pw_selectors = ['input[type="password"]', 'input[name="password"]', '#password']
        pw_filled = False
        for sel in pw_selectors:
            try:
                el = page.locator(sel).first
                if await el.is_visible(timeout=5000):
                    await el.fill(UBER_PASSWORD)
                    pw_filled = True
                    print(f"[uber] Password filled via {sel}")
                    break
            except Exception:
                continue

        if not pw_filled:
            await page.screenshot(path="/tmp/uber-login-2.png")
            print("[uber] Could not find password input — screenshot: /tmp/uber-login-2.png")
            inputs = await page.evaluate("""() => {
                return Array.from(document.querySelectorAll('input')).map(i => ({
                    name: i.name, type: i.type, id: i.id, placeholder: i.placeholder,
                }));
            }""")
            print(f"[uber] Inputs: {json.dumps(inputs, indent=1)}")

        # Click Login/Submit
        for btn_sel in ['button:has-text("Log In")', 'button:has-text("Iniciar sesión")', 'button:has-text("Sign In")', 'button:has-text("Siguiente")', 'button[type="submit"]']:
            try:
                el = page.locator(btn_sel).first
                if await el.is_visible(timeout=2000):
                    await el.click()
                    print(f"[uber] Clicked {btn_sel}")
                    break
            except Exception:
                continue

        # Wait for redirect
        print("[uber] Waiting for dashboard...")
        try:
            await page.wait_for_url("**/manager/**", timeout=30000)
        except Exception:
            await page.wait_for_timeout(10000)

        current = page.url
        print(f"[uber] After login: {current}")
        await page.screenshot(path="/tmp/uber-dashboard.png", full_page=True)
        print("[uber] Screenshot: /tmp/uber-dashboard.png")

        # Check if 2FA/verification is needed
        if "challenge" in current or "verify" in current or "otp" in current:
            print("[uber] ⚠ 2FA/verification required — need manual intervention")
            await page.screenshot(path="/tmp/uber-2fa.png")
            await browser.close()
            sys.exit(1)

        # ── Navigate to key sections ───────────────────────────────────────
        # Try Orders
        print("[uber] Looking for Orders/Payments...")
        nav_clicked = []
        for sel in [
            'a:has-text("Orders")', 'a:has-text("Pedidos")',
            'a:has-text("Payments")', 'a:has-text("Pagos")',
            '[href*="order"]', '[href*="payment"]',
        ]:
            try:
                el = page.locator(sel).first
                if await el.is_visible(timeout=2000):
                    await el.click()
                    await page.wait_for_timeout(4000)
                    nav_clicked.append(sel)
                    print(f"[uber] Clicked: {sel} → {page.url}")
                    await page.screenshot(path=f"/tmp/uber-nav-{len(nav_clicked)}.png", full_page=True)
                    break
            except Exception:
                continue

        # Dump interactive elements
        links = await page.evaluate("""() => {
            const els = document.querySelectorAll('a, button, [role="menuitem"], [role="tab"], [role="link"]');
            return Array.from(els).slice(0, 50).map(e => ({
                tag: e.tagName,
                text: e.textContent?.trim()?.slice(0, 80),
                href: e.href || e.getAttribute('href') || '',
            })).filter(e => e.text || e.href);
        }""")

        print(f"\n[uber] Interactive elements ({len(links)}):")
        for l in links[:30]:
            print(f"  {l['tag']:8} | {l['text'][:40]:40} | {l['href'][:50]}")

        # Dump captured APIs
        print(f"\n[uber] Captured {len(captured)} API responses:")
        for c in captured[:20]:
            body_str = json.dumps(c["body"], ensure_ascii=False)[:300]
            print(f"\n  {c['url'][:100]}")
            print(f"  {body_str}")

        await browser.close()

    print(f"\n[uber] Done. Check /tmp/uber-*.png for screenshots.")


if __name__ == "__main__":
    asyncio.run(run())
