"""Auth module — login to Wansoft portal via Playwright."""

import asyncio

# Wansoft app lives at wansoft.net, not the marketing site wansoftpos.com
APP_URL = "https://www.wansoft.net/Wansoft.Web/"


async def login(page, portal_url: str, user: str, password: str) -> bool:
    """
    Navigate to Wansoft app and authenticate.

    Returns True if login succeeded, False otherwise.
    """
    # Go directly to the app login page
    target = APP_URL
    print(f"[auth] Navigating to {target}")
    await page.goto(target, wait_until="domcontentloaded", timeout=30000)
    await asyncio.sleep(2)

    await page.screenshot(path="output/screenshots/00-login-form.png")
    print(f"[auth] Current URL: {page.url}")

    # Fill the known login form
    print("[auth] Filling credentials...")
    await page.fill('input[name="UserName"]', user)
    await asyncio.sleep(0.5)
    await page.fill('input[name="Password"]', password)
    await asyncio.sleep(0.5)

    # Submit
    print("[auth] Clicking Ingresar...")
    await page.click('input[type="submit"]')

    # Wait for post-login navigation
    print("[auth] Waiting for post-login navigation...")
    try:
        await page.wait_for_load_state("networkidle", timeout=20000)
    except Exception:
        print("[auth] Warning: networkidle timeout, continuing...")

    await asyncio.sleep(3)

    post_url = page.url
    print(f"[auth] Post-login URL: {post_url}")

    await page.screenshot(path="output/screenshots/01-post-login.png")
    print("[auth] Post-login screenshot saved")

    # Check for error messages on the login page
    error_el = page.locator('.validation-summary-errors, .field-validation-error, .error').first
    try:
        if await error_el.is_visible(timeout=1000):
            error_text = await error_el.text_content()
            print(f"[auth] ERROR: Login failed — {error_text.strip()}")
            return False
    except Exception:
        pass

    # If URL changed from login page, login succeeded
    if post_url != target and "/Wansoft.Web/" in post_url:
        print("[auth] Login successful (URL changed)")
        return True

    # Check if we're now on a dashboard / main page
    # ASP.NET apps often stay on same base URL but render different content
    # Look for navigation elements that only appear when logged in
    logged_in_selectors = [
        '.navbar', '#sidebar', '.menu-lateral', 'a:has-text("Cerrar")',
        'a:has-text("Salir")', '.sidebar', '#MainContent', '.main-content',
        'a[href*="Logout"]', 'a[href*="LogOff"]',
    ]
    for sel in logged_in_selectors:
        try:
            el = page.locator(sel).first
            if await el.is_visible(timeout=1000):
                print(f"[auth] Dashboard element found: {sel} — login successful")
                return True
        except Exception:
            continue

    # Last check: see if the login form is still visible
    try:
        login_form_visible = await page.locator('input[name="UserName"]').is_visible(timeout=1000)
        if login_form_visible:
            print("[auth] Login form still visible — login likely failed")
            return False
    except Exception:
        pass

    # If login form disappeared, we probably logged in
    print("[auth] Login form gone — assuming login succeeded")
    return True
