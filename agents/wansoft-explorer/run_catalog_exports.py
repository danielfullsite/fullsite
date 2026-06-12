"""Descarga fresca de los catálogos de menú/modificadores/recetas de Wansoft.

Baja los XLSX de: Platillos, Modificadores, Asignación de modificadores,
Configuración de modificadores en niveles, Grupos, y Reporte de recetas.
Guarda en output/catalog_fresh/ (sobrescribe — siempre queremos lo más nuevo).
"""

import asyncio
import os
from datetime import date

from dotenv import load_dotenv
from playwright.async_api import async_playwright

from src.auth import login
from src.export_handler import (
    _select_all_subsidiaries,
    _dismiss_modals,
    _find_export_button,
)

TARGETS = {
    "platillos": "https://www.wansoft.net/Wansoft.Web/Menu/SaucerList",
    "modificadores": "https://www.wansoft.net/Wansoft.Web/Menu/ComplementaryList",
    "asignacion-modificadores": "https://www.wansoft.net/Wansoft.Web/Menu/AllocationByComplementary",
    "modificadores-niveles": "https://www.wansoft.net/Wansoft.Web/Menu/AllocationByLevels",
    "grupos": "https://www.wansoft.net/Wansoft.Web/Menu/GroupList",
    "recetas": "https://www.wansoft.net/Wansoft.Web/Inventory/SaucerRecipeReport",
}

OUT_DIR = "output/catalog_fresh"


async def run():
    load_dotenv(override=True)
    os.makedirs(OUT_DIR, exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 900},
            accept_downloads=True,
        )
        page = await context.new_page()
        page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))

        ok = await login(
            page,
            os.getenv("WANSOFT_PORTAL_URL"),
            os.getenv("WANSOFT_USER"),
            os.getenv("WANSOFT_PASS"),
        )
        if not ok:
            print("LOGIN FAILED")
            await browser.close()
            return

        results = {}
        for name, url in TARGETS.items():
            print(f"\n[{name}] {url}")
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=20000)
                await asyncio.sleep(2.5)
                await _select_all_subsidiaries(page)
                await _dismiss_modals(page)

                btn = await _find_export_button(page)
                if not btn:
                    print(f"[{name}] SIN BOTON DE EXPORT")
                    results[name] = "no-export-button"
                    continue

                path = os.path.join(OUT_DIR, f"{name}.xlsx")
                try:
                    async with page.expect_download(timeout=30000) as dl:
                        await btn.click(force=True)
                    download = await dl.value
                    await download.save_as(path)
                    size = os.path.getsize(path)
                    print(f"[{name}] OK -> {path} ({size:,} bytes)")
                    results[name] = f"ok ({size:,} bytes)"
                except Exception as e:
                    # reintento tras cerrar modal de sucursal
                    if await _dismiss_modals(page):
                        await _select_all_subsidiaries(page)
                        await asyncio.sleep(1)
                        async with page.expect_download(timeout=30000) as dl:
                            await btn.click(force=True)
                        download = await dl.value
                        await download.save_as(path)
                        size = os.path.getsize(path)
                        print(f"[{name}] OK (retry) -> {path} ({size:,} bytes)")
                        results[name] = f"ok-retry ({size:,} bytes)"
                    else:
                        print(f"[{name}] FALLO: {e}")
                        results[name] = f"failed: {e}"
                await asyncio.sleep(2)
            except Exception as e:
                print(f"[{name}] ERROR: {e}")
                results[name] = f"error: {e}"

        await browser.close()

    print(f"\n=== Resumen {date.today().isoformat()} ===")
    for k, v in results.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    asyncio.run(run())
