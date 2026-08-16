#!/usr/bin/env python3
"""
SPIKE — Scrapling vs el scraper Playwright actual de Wansoft.
NO toca producción. Es una prueba aislada para medir si Scrapling estabiliza la
ingesta de Wansoft (el dolor #1 de Fullsite): selectores frágiles, cambios de HTML
y detección de bots.

Qué prueba, en orden:
  1. Bypass de anti-bot (StealthyFetcher) — llega a la página de login sin trabarse.
  2. Login con manejo tolerante de selectores.
  3. Extracción de datos (/Menu/Saucer) con SELECTORES ADAPTIVOS (auto_match):
     Scrapling guarda una "huella" del elemento y lo re-encuentra aunque Wansoft
     cambie el HTML → deja de romperse el scraper en cada rediseño.

Cómo correrlo (TÚ, contra Wansoft real — no corre en el sandbox):
    pip install "scrapling[fetchers]"
    scrapling install                 # baja los navegadores stealth
    export WANSOFT_USER='...'          # mismas creds que usa el scraper de prod
    export WANSOFT_PASS='...'
    python3 scripts/spikes/scrapling_wansoft_spike.py

Éxito = imprime "[OK] login", un conteo de platillos > 0, y el archivo de huellas
`scrapling_fingerprints.db` queda guardado. Corre 2 veces: la 2da usa las huellas
(demuestra el auto-match). Compara el tiempo/robustez vs el scraper actual.

Nota: la API exacta de Scrapling puede variar entre versiones (auto_match vs
adaptive). Doc oficial: https://scrapling.readthedocs.io
"""
import os
import sys
import time

WANSOFT_URL = os.environ.get("WANSOFT_URL", "https://www.wansoft.net/Wansoft.Web")
WANSOFT_USER = os.environ.get("WANSOFT_USER", "").strip()
WANSOFT_PASS = os.environ.get("WANSOFT_PASS", "").strip()

if not WANSOFT_USER or not WANSOFT_PASS:
    sys.exit("ERROR: define WANSOFT_USER y WANSOFT_PASS (las mismas creds del scraper de prod).")

try:
    from scrapling.fetchers import StealthyFetcher
except ImportError:
    sys.exit('ERROR: instala Scrapling primero:  pip install "scrapling[fetchers]" && scrapling install')


def do_login_and_open_saucers(page):
    """page_action: se ejecuta dentro del navegador stealth ya cargado en la home.
    Hace login y navega a la pantalla de platillos. Devuelve la page para que
    Scrapling capture el HTML final."""
    # Login — Scrapling expone la page de Playwright, así que reusamos el mismo flujo.
    page.fill('input[name="UserName"]', WANSOFT_USER)
    page.fill('input[name="Password"]', WANSOFT_PASS)
    page.click('input[type="submit"]')
    page.wait_for_load_state("networkidle")
    # Navega a la pantalla de datos que hoy es frágil de scrapear.
    page.goto(f"{WANSOFT_URL}/Menu/Saucer", wait_until="load")
    page.wait_for_load_state("networkidle")
    return page


def main():
    print(f"[spike] Scrapling → {WANSOFT_URL}")
    t0 = time.time()

    # StealthyFetcher = navegador con fingerprint anti-bot (bypass Cloudflare/Turnstile
    # out-of-the-box). auto_match/adaptive activa la re-localización de elementos.
    page = StealthyFetcher.fetch(
        f"{WANSOFT_URL}/",
        headless=True,
        network_idle=True,
        page_action=do_login_and_open_saucers,
    )

    elapsed = time.time() - t0
    print(f"[spike] status HTTP: {getattr(page, 'status', '?')}  ({elapsed:.1f}s)")

    if "UserName" in (page.body or "") or "login" in (page.url or "").lower():
        print("[!] Parece que NO logueó (seguimos en login). Revisa creds/selectores.")
        sys.exit(1)
    print("[OK] login — pasó el gate de Wansoft con StealthyFetcher")

    # Extracción ADAPTIVA: guarda huella la 1ra vez, la reusa las siguientes.
    # Probamos varias formas de encontrar la tabla de platillos; el punto es que
    # con auto_match, si Wansoft cambia la clase/estructura, Scrapling la reencuentra.
    rows = []
    for selector in ("table tbody tr", ".grid tr", "tr[role='row']", "table tr"):
        try:
            found = page.css(selector, auto_match=True)  # <-- self-healing
        except TypeError:
            found = page.css(selector)  # fallback si la versión no soporta auto_match
        if found:
            rows = found
            print(f"[OK] datos — {len(rows)} filas via selector adaptivo '{selector}'")
            break

    if not rows:
        print("[!] No se encontró la tabla de platillos. Guarda page.body para inspeccionar.")
        with open("scrapling_saucer_dump.html", "w") as f:
            f.write(page.body or "")
        print("    volcado: scrapling_saucer_dump.html")
        sys.exit(2)

    # Muestra 3 filas de ejemplo
    for r in rows[:3]:
        txt = " | ".join((r.css("::text") or [])[:4]) if hasattr(r, "css") else str(r)[:80]
        print(f"    · {txt[:100]}")

    print(f"\n[spike] LISTO en {time.time()-t0:.1f}s. Compara vs el scraper actual:")
    print("  - ¿pasó el anti-bot sin cookie manual?")
    print("  - ¿los selectores adaptivos aguantan aunque muevas una clase en Wansoft?")
    print("  - corre 2da vez: debe reusar scrapling_fingerprints.db (auto-match)")


if __name__ == "__main__":
    main()
