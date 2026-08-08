# W1-C — Business date canónico · Certificación

**Fecha:** 2026-08-08 · **Rama:** `wave1/inventory-truth` · **Depende de:** W1-A (54f6c28), W1-B (358d38a)

## Diseño

**Un solo primitivo TS** (`dashboard-app/src/lib/business-date.ts`) espejo 1:1 de la referencia Python (`ops_aggregate.py`, la que ya usan los agentes — no se inventó una segunda definición ni se alteró el Python):

- `getBusinessDate(ts, timeZone, boundary)` — instante UTC → fecha operativa; hora local < boundary → día calendario anterior; el boundary exacto pertenece al día nuevo.
- `getBusinessDayBounds(fecha, timeZone, boundary)` — intervalo UTC semiabierto `[D@boundary, D+1@boundary)`; cada extremo construido desde su propia fecha calendario (DST-safe).
- `getBusinessDayConfig()` — fail-closed idéntico a Python (throw en timezone o boundary faltante/inválido; valida IANA vía Intl).
- `resolveBusinessDayConfig()` — resolver para superficies de UI: si el tenant no tiene `business_day_start_local` degrada **explícitamente** (flag `degraded` + warn único) a medianoche = conducta pre-W1-C. Nunca fallback silencioso a zona de servidor/navegador; timezone sigue siendo obligatoria.
- Conversión pared→UTC por doble iteración de offset (IANA-aware, sin librerías, sin offsets fijos).

**Config por tenant**: `timezone` + `business_day_start_local` se leen de `clients` (vía `fetchClientConfig` client-side / fetch directo en la ruta server). **04:00 no aparece en ningún archivo de código** — es configuración de AMALAY que se escribirá en el release gate, no en este batch.

## Adopción (solo rutas operativas — calendario intacto)

| Superficie | Antes | Ahora |
|---|---|---|
| `data.ts getDashboardFromPosOrders` | `gte.${fecha}T00:00:00-06:00` + agrupación `created_at.slice(0,10)` | Bounds UTC del primitivo + agrupación por `getBusinessDate` |
| `api/contabilidad/polizas` (día) | `gte.${fecha}T00:00:00` / `lte.T23:59:59` **naive** (cortaba el día en UTC y dejaba hueco de 1s) | `gte.utcStart` + `lt.utcEnd` del día operativo; fecha default = business date actual |
| `api/contabilidad/polizas` (mes) | Ídem naive | `[bounds(día 1).start, bounds(último día).end)` |
| `CierreCajaWizard.fecha` | `now.split('T')[0]` (calendario UTC-ish) | Fecha operativa del tenant; **el cierre nunca se bloquea**: sin red/config degrada a calendario con warn |
| `date-mx.ts` | — | Marcado explícitamente CALENDAR-ONLY con pointer a business-date.ts |

**NO migrado (correctamente):** reservaciones, cumpleaños, fechas de emisión CFDI, `getRecentDays`/`getDateRange` sobre `wansoft_daily.fecha` (ya viene business-aligned del cierre Wansoft) y demás fechas calendario.

## Certificación

| Gate | Evidencia | Resultado |
|---|---|---|
| TS ↔ PYTHON PARITY | Fixtures generados por el Python de referencia (`scripts/wave1/w1c_parity_gen.py`): **105 casos** instante→fecha + **30 casos** de bounds — 3 zonas IANA (Monterrey, New_York, Tokyo), boundaries 04:00/00:00/05:30, relojes 03:59:59 / 04:00:00 / 04:00:01 / 23:59:59 / 00:00:01, y los DOS días de transición DST de New_York (2025-03-09, 2025-11-02). Salida idéntica en todos | **PASS** |
| NO HARDCODED −06 | `grep -r '\-06:00' src` → solo comentarios; el hardcode de data.ts eliminado; timestamps naive de pólizas eliminados | **PASS** |
| BUSINESS DAY QUERY BOUNDS | Propiedad `end(D) == start(D+1)` en todos los pares consecutivos (incl. días DST); semántica `[start, end)` exacta (start∈D, start−1s∉D, end−1s∈D, end∉D) | **PASS** |
| NO DOUBLE COUNT / NO MISSING | Staging (w1acert): 4 órdenes en los límites exactos (03:59:59/04:00:00 × 2 días) contadas por 3 ventanas consecutivas → 1+2+1=4, cada una exactamente una vez, límite al día nuevo | **PASS** |
| DASHBOARD BUSINESS-DATE TOTAL | `w1c-dashboard-adoption.test.ts`: madrugada (23:00 + 03:59) suma al día anterior, boundary exacto al nuevo; suma de días == suma de órdenes; mismos instantes con tenant Tokyo agrupan distinto; degradación explícita sin boundary | **PASS** |
| PÓLIZA BUSINESS-DATE TOTAL | Misma primitiva de bounds certificada arriba; ruta reestructurada para resolver config ANTES de armar rangos; typecheck + suite | **PASS** |
| CLOSE DATE PARITY | `CierreCajaWizard.fecha` = `getBusinessDate(now, cfg)` — misma función que agentes/reportes; fallback no-bloqueante documentado | **PASS** |
| CALENDAR-DATE FEATURES REGRESSION | Suite completa 57 files / 2,236 tests PASS; superficies calendario no tocadas | **PASS** |
| BUILD / STATIC / TESTS | `tsc --noEmit` limpio; vitest 2,236/2,236 | **PASS** |

## Notas

- **Schema:** sin cambios (adopción query-side; no se materializó `business_date` en `pos_orders` — no fue necesario para corrección).
- **Python:** sin cambios — no se encontró defecto en la referencia.
- **Fixture regen:** `python3 scripts/wave1/w1c_parity_gen.py` (re-generar si la referencia Python evoluciona; el JSON es artefacto versionado).
- **Prod:** ni config ni datos tocados. El valor 04:00 de AMALAY se escribe en el release gate de Wave 1.
