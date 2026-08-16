# Spikes — pruebas aisladas que NO tocan producción

## `scrapling_wansoft_spike.py`
Mide si **Scrapling** estabiliza la ingesta de Wansoft (el dolor #1 de Fullsite:
scraper Playwright frágil, cookie que se rompe, cambios de HTML, detección de bots).

**No corre en CI ni en el sandbox** — lo corres tú contra Wansoft real:

```bash
pip install "scrapling[fetchers]" && scrapling install
export WANSOFT_USER='...' WANSOFT_PASS='...'
python3 scripts/spikes/scrapling_wansoft_spike.py
```

**Qué prueba:** bypass anti-bot (StealthyFetcher) + login + extracción con
**selectores adaptivos** (auto_match) que se auto-reparan cuando Wansoft cambia el HTML.

**Decisión:** si el spike pasa el anti-bot sin cookie manual y los selectores
adaptivos aguantan, vale migrar `wansoft_browser_scraper.py` a Scrapling (detrás de
un flag), empezando por el login + los selectores de datos frágiles.
