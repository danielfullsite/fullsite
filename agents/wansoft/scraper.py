#!/usr/bin/env python3
"""Headless scraper: login to Wansoft, export Ventas por Mesero report as XLSX."""

import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

# ── Constants ────────────────────────────────────────────────────────────────

WANSOFT_BASE = "https://wansoft.net/Wansoft.Web"
LOGIN_URL = f"{WANSOFT_BASE}/"
# Eduardo confirmed: REPORTES → INGRESOS → VENTAS POR SUCURSAL is the definitive report
# 2026-06-11: Wansoft movió "Ventas por sucursal" de Reports/SalesByBranch
# a Reports/ConsolidatedSalesMasterReport (misma página, mismos IDs).
REPORT_URL = f"{WANSOFT_BASE}/Reports/ConsolidatedSalesMasterReport"

DOWNLOADS_DIR = Path(__file__).parent / "downloads"
ENV_FILE = Path(__file__).parent / ".env"

TZ_MX = ZoneInfo("America/Mexico_City")

EXIT_MISSING_ENV = 1
EXIT_LOGIN_FAIL = 2
EXIT_EXPORT_TIMEOUT = 3
EXIT_OTHER = 4


# ── Helpers ──────────────────────────────────────────────────────────────────

def log(msg: str):
    ts = datetime.now(TZ_MX).strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def screenshot_error(page, step: str):
    """Save a debug screenshot on failure."""
    DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(TZ_MX).strftime("%Y%m%d_%H%M%S")
    path = DOWNLOADS_DIR / f"ERROR_{step}_{ts}.png"
    try:
        page.screenshot(path=str(path), full_page=True)
        log(f"Screenshot guardado: {path}")
    except Exception:
        log("No se pudo guardar screenshot")


def dump_page(page, step: str):
    """Save HTML + screenshot for debugging selector issues."""
    DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(TZ_MX).strftime("%Y%m%d_%H%M%S")
    html_path = DOWNLOADS_DIR / f"page_dump_{step}_{ts}.html"
    try:
        html_path.write_text(page.content(), encoding="utf-8")
        log(f"HTML dump guardado: {html_path}")
    except Exception:
        log("No se pudo guardar HTML dump")
    screenshot_error(page, step)


def resolve_target_date(cli_arg: str | None) -> str:
    """Return target date as YYYY-MM-DD string."""
    # 1. CLI argument
    if cli_arg:
        return cli_arg
    # 2. Env override
    env_date = os.environ.get("WANSOFT_DATE")
    if env_date:
        return env_date
    # 3. Yesterday in Mexico City
    yesterday = datetime.now(TZ_MX).date() - timedelta(days=1)
    return yesterday.isoformat()


# ── Main flow ────────────────────────────────────────────────────────────────

def scrape(target_date: str) -> Path:
    """Run the full scrape flow. Returns path to downloaded XLSX."""
    from playwright.sync_api import sync_playwright, TimeoutError as PwTimeout

    output_path = DOWNLOADS_DIR / f"{target_date}.xlsx"

    # Skip if already downloaded
    if output_path.exists():
        log(f"Archivo ya existe: {output_path}")
        return output_path

    DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)

    user = os.environ.get("WANSOFT_USER")
    passwd = os.environ.get("WANSOFT_PASS")
    if not user or not passwd:
        log("Error: WANSOFT_USER y WANSOFT_PASS requeridos")
        sys.exit(EXIT_MISSING_ENV)

    debug = os.environ.get("WANSOFT_DEBUG", "").strip() == "1"
    headless = not debug

    log(f"Target date: {target_date}")
    log(f"Mode: {'headed (debug)' if debug else 'headless'}")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=headless,
            args=[
                "--disable-blink-features=AutomationControlled",
            ],
        )
        context = browser.new_context(
            accept_downloads=True,
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 800},
            locale="es-MX",
            timezone_id="America/Mexico_City",
        )
        page = context.new_page()

        # Hide webdriver flag from headless detection scripts
        page.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        """)

        # ── Step 1: Login ────────────────────────────────────────────────
        log("Navegando a login...")
        page.goto(LOGIN_URL, wait_until="networkidle", timeout=30000)

        try:
            page.wait_for_selector(
                "input[type='text'], input[name='Usuario'], input[id*='ser']",
                timeout=15000,
            )
        except PwTimeout:
            screenshot_error(page, "login_page")
            log("Error: no se encontro formulario de login")
            browser.close()
            sys.exit(EXIT_LOGIN_FAIL)

        log("Llenando credenciales...")
        user_input = page.locator(
            "input[type='text'], input[name='Usuario'], input[id*='ser']"
        ).first
        pass_input = page.locator("input[type='password']").first

        # Type with delay (more human-like, avoids anti-bot)
        user_input.click()
        user_input.type(user, delay=50)

        page.wait_for_timeout(1000)  # pause between fields

        pass_input.click()
        pass_input.type(passwd, delay=50)

        page.wait_for_timeout(500)  # let client-side validation enable button

        # Submit
        submit_btn = page.locator(
            "button[type='submit'], input[type='submit'], "
            "button:has-text('Ingresar'), button:has-text('Iniciar'), "
            "button:has-text('Login'), button:has-text('Entrar')"
        ).first
        submit_btn.click()

        # ── Post-login verification ──────────────────────────────────────
        log("Verificando login...")
        login_ok = False

        # Wait for navigation after submit — Wansoft redirects to a dashboard
        # or sub-page. The login page URL ends with /Wansoft.Web/ (with or
        # without trailing slash and possible query string).
        try:
            page.wait_for_load_state("networkidle", timeout=15000)
        except PwTimeout:
            pass

        # Option A: URL changed away from the bare login page
        current = page.url
        # Strip query string for path comparison
        path_part = current.split("?")[0].rstrip("/")
        if path_part.endswith("/Wansoft.Web"):
            # Still on login page — could be a redirect race
            pass
        elif "/Wansoft.Web/" in current:
            login_ok = True

        if not login_ok:
            # Option B: authenticated element appears (user name in sidebar)
            try:
                page.wait_for_selector(
                    "text=D.RAMONFAUR, .user-name, .username, [class*='user']",
                    timeout=10000,
                )
                login_ok = True
            except PwTimeout:
                pass

        if not login_ok:
            # Login failed — collect diagnostics
            current_url = page.url
            log(f"Login fallido. URL actual: {current_url}")

            # Check if password field still has value (page didn't reload)
            try:
                pass_val = pass_input.input_value()
                log(f"Password input tiene valor: {'si' if pass_val else 'no (vacio)'}")
            except Exception:
                log("Password input no accesible")

            # Check for visible error messages
            try:
                error_el = page.locator(
                    ".alert-danger, .error-message, .validation-summary-errors, "
                    "[class*='error'], [class*='alert']"
                ).first
                if error_el.is_visible():
                    error_text = error_el.text_content() or ""
                    log(f"Mensaje de error visible: {error_text[:200]}")
            except Exception:
                pass

            dump_page(page, "login_failed")
            browser.close()
            sys.exit(EXIT_LOGIN_FAIL)

        log("Login verificado")

        # ── Step 2: Navigate to report ───────────────────────────────────
        log("Navegando a reporte Ventas por Sucursal...")
        page.goto(REPORT_URL, wait_until="domcontentloaded", timeout=15000)

        # ── Step 3: Set date range ───────────────────────────────────────
        log(f"Configurando fechas: {target_date} → {target_date}")

        # Wansoft uses readonly inputs with a Material DTP datepicker widget.
        # IDs are stable: #startDate, #endDate. We set values via JS
        # and dispatch change events so the form picks them up.
        try:
            page.wait_for_selector("#startDate", timeout=15000)
        except PwTimeout:
            dump_page(page, "date_inputs")
            log("Error: #startDate no encontrado en el reporte")
            browser.close()
            sys.exit(EXIT_OTHER)

        log("Pagina de reporte cargada")

        # Set dates via JS — readonly inputs can't be filled normally
        page.evaluate("""([startVal, endVal]) => {
            const startEl = document.getElementById('startDate');
            const endEl = document.getElementById('endDate');
            startEl.removeAttribute('readonly');
            startEl.value = startVal;
            startEl.setAttribute('readonly', 'readonly');
            startEl.dispatchEvent(new Event('change', { bubbles: true }));
            endEl.removeAttribute('readonly');
            endEl.value = endVal;
            endEl.setAttribute('readonly', 'readonly');
            endEl.dispatchEvent(new Event('change', { bubbles: true }));
        }""", [target_date, target_date])

        # Let any JS handlers settle
        page.wait_for_timeout(1500)

        # Verify dates were set correctly
        actual_inicio = page.input_value("#startDate")
        actual_fin = page.input_value("#endDate")
        if actual_inicio != target_date or actual_fin != target_date:
            dump_page(page, "date_verify")
            log(
                f"Error: fechas no se setearon correctamente. "
                f"inicio={actual_inicio}, fin={actual_fin}, esperado={target_date}"
            )
            browser.close()
            sys.exit(EXIT_OTHER)

        log("Fechas configuradas y verificadas")

        # ── Step 4: Export ───────────────────────────────────────────────
        log("Buscando boton Exportar...")

        # Wansoft: <input type="button" id="btnExport" value="Exportar">
        export_btn = page.locator("#btnExport")

        try:
            export_btn.wait_for(state="visible", timeout=10000)
        except PwTimeout:
            # Fallback to text-based search
            export_btn = page.locator("input[value='Exportar'], button:has-text('Exportar')").first
            try:
                export_btn.wait_for(state="visible", timeout=5000)
            except PwTimeout:
                dump_page(page, "export_button")
                log("Error: boton Exportar no encontrado")
                browser.close()
                sys.exit(EXIT_OTHER)

        log("Iniciando descarga...")
        try:
            with page.expect_download(timeout=60000) as download_info:
                export_btn.click()
            download = download_info.value
        except PwTimeout:
            screenshot_error(page, "export_timeout")
            log("Error: timeout esperando descarga (>60s)")
            browser.close()
            sys.exit(EXIT_EXPORT_TIMEOUT)

        # Save to target path
        download.save_as(str(output_path))
        log(f"Descarga guardada: {output_path}")

        browser.close()

    return output_path


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    # Load .env from agents/wansoft/.env
    if ENV_FILE.exists():
        load_dotenv(ENV_FILE)

    cli_date = sys.argv[1] if len(sys.argv) > 1 else None
    target_date = resolve_target_date(cli_date)

    # Validate date format
    try:
        datetime.strptime(target_date, "%Y-%m-%d")
    except ValueError:
        log(f"Error: fecha invalida '{target_date}'. Formato: YYYY-MM-DD")
        sys.exit(EXIT_MISSING_ENV)

    try:
        result = scrape(target_date)
        print(str(result))
    except SystemExit:
        raise
    except Exception as e:
        log(f"Error inesperado: {e}")
        sys.exit(EXIT_OTHER)


if __name__ == "__main__":
    main()
