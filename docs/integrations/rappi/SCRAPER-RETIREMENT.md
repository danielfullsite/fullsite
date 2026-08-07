# Rappi Legacy Portal Scraper — Retirement (SEC-1)

**Fecha:** 2026-08-07 · **Base:** `main` @ `ef989c3` · **Branch:** `security/rappi-sec1-retirement`

## Qué se retiró

El scraper legacy del **portal de partners de Rappi** queda **RETIRADO permanentemente**. Se eliminaron del árbol actual:

- `.github/scripts/rappi_cron_local.sh` (launcher de cron local)
- `.github/scripts/rappi_sync.py` (scraper Playwright: login al portal + navegación de páginas financieras)
- `.github/workflows/rappi-sync.yml` (workflow de GitHub Actions, ya desactivado)

## Hechos probados al momento del retiro

- **Sin scheduler activo:** no existía entrada de `crontab` para el scraper (la línea de instalación en el script era solo un comentario), no había LaunchAgent, y el workflow de Actions estaba desactivado (`on: workflow_dispatch` únicamente; el `schedule` estaba comentado — Rappi bloquea logins desde IPs de datacenter).
- **Última frescura de datos conocida:** 2026-06-13 (no se registran corridas posteriores en esta máquina; `/tmp/rappi-sync.log` ausente).
- **No alimenta operación:** el scraper **no** alimenta POS, KDS, impresión, ni el flujo de **órdenes** de Rappi de Wansoft. Solo escribía datos **financieros/reporting**: upsert a `delivery_platform_payments` (lotes de pago), consumido únicamente por la página de dashboard `dashboard-app/src/app/delivery/page.tsx`.
- **Sin dependencia viva:** cero imports o referencias de runtime a estos 3 artefactos fuera de ellos mismos (verificado en `ef989c3`; la única mención era el artefacto generado `graphify-out/graph.html`, no una dependencia).
- **Datos históricos intactos:** las filas históricas de `delivery_platform_payments` (Rappi/Uber) **no** se borran ni mutan. No hubo migración ni cambio de DB en este retiro.

## Seguridad

- La credencial del portal estuvo **expuesta históricamente en git** (`.github/scripts/rappi_cron_local.sh`, introducida en el commit `2a31e38`, presente en `origin/main` y varias ramas empujadas).
- La contraseña del portal fue **rotada manualmente** por el fundador (2026-08-07); la credencial vieja del historial queda **INVALIDADA**.
- El historial de git **no se reescribe** en este cambio (la rotación es la contención; el scrub de historia es endurecimiento opcional posterior). Ninguna credencial aparece en este documento ni en el árbol actual tras el retiro.

## Reemplazo

- **Órdenes:** la integración oficial de la **Rappi API** (workstream `docs/integrations/rappi/DESIGN.md`, `WAITING_EXTERNAL`) es el camino de reemplazo para el flujo operativo.
- **Financiero:** el reemplazo del scraper financiero es el **Financial API / Margin Engine (D5, post-pilot)** — no bloquea la integración de órdenes.
- **Métricas agregadas del portal / Rappi Ads:** el reemplazo por API **no está probado todavía** (pregunta abierta de TAM/superficie).

## Regla

**El scraper del portal NO debe reactivarse.** Cualquier necesidad futura de datos de Rappi debe resolverse por la API oficial, no por scraping del portal.
