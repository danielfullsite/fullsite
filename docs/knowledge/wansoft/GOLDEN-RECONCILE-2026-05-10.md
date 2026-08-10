# Golden Reconciliation — Wansoft export 2026-05-10 (AMALAY, Plaza Duendes)

Deterministic golden test that reconciles a **real Wansoft daily export** against
**Fullsite's aggregation contract** (`dashboard-app/src/lib/data.ts::getDashboardFromPosOrders`),
exact to the cent. Built from a local export; only the sanitized numeric fixture is committed.

- **Fixture (committable):** `agents/wansoft/test_data/fixtures/golden_2026-05-10.json`
- **Test (committable):** `scripts/wansoft/golden_reconcile.py` → `python3 scripts/wansoft/golden_reconcile.py` (exit 0 = pass)
- **Raw source (LOCAL ONLY, never commit):** `agents/wansoft/test_data/ReporteVentasPorMesero2026-05-10.xlsx`

## What the Wansoft export actually contains

Both `.xlsx` are **"Ventas por mesero"** exports with 4 sheets each:
`Ventas por mesero por grupo`, `Resumen de ventas por mesero`, `Ventas por mesero por mesa`,
`Ventas por tipo de grupo`. They are **sales-by-waiter-by-group only**.

They do **NOT** contain: formas de pago, propinas, cancelaciones, devoluciones/anulaciones,
cortesías, cortes/turnos, or a contador report. Those live in *other* Wansoft reports not in
this export. Any Fullsite metric that depends on them is a **mapping gap**, not a data mismatch.

Note on the two files:
- `real_2026-05-10.xlsx` → business date **2026-05-09** ("Reporte del: 2026-05-09 al 2026-05-09"), Gran total **$105,093.00**. Its per-mesero Resumen sums to $118,315.60 because it includes an `APLICACIONES` (delivery-apps) pseudo-mesero worth $13,222.60 that the group-level Gran total excludes — a real Wansoft definition nuance.
- `ReporteVentasPorMesero2026-05-10.xlsx` → business date **2026-05-10** (the target day), with a clean `Total` row. **This is the authoritative source for the golden.**

## Sheet → metric → Fullsite field mapping (redacted; waiters as M1..M10)

Source: `ReporteVentasPorMesero2026-05-10.xlsx`, sheet **`Resumen de ventas por mesero`**,
`Total` row (row 18). Columns (1-based cell col in parens):

| Wansoft target metric | Sheet / cell | Sample value | Fullsite field | Relationship |
|---|---|---|---|---|
| Ventas netas sin IVA (Subtotal) | `Resumen…` Total row, col Subtotal (D18) | $91,125.00 | *(none — Fullsite stores tax-inclusive only)* | base |
| IVA (16%) | col IVA (F18) | $14,580.00 | *(none — no IVA breakout field)* | `= round(subtotal*0.16,2)` |
| IEPS | col IEPS (E18) | $0.00 | *(none)* | 0 |
| Gran total / ventas netas | col Total (G18) | **$105,705.00** | `ventas_dia` = `sum(order.total)` | `= subtotal+iva+ieps` |
| Ventas brutas | derived (= gran_total, descuentos=0) | $105,705.00 | `ventas_brutas` = `ventas + descuentos` | `= gran_total` here |
| Descuentos | header "Total descuentos sobre cuentas" (blank) | $0.00 | `descuentos` = `sum(order.descuento)` | 0 in this export |
| Personas | col Personas atendidas (I18) | 219 | `personas_restaurant` = `sum(order.personas)` | direct |
| Per-mesero total | rows 8..17, col Total | M1..M10 (Σ = $105,705.00) | `meseros[].total` | `Σ == gran_total` |
| Business date | "Reporte del: 2026-05-10 al 2026-05-10" | 2026-05-10 | `fecha` | direct |
| Devoluciones / anulaciones | **not in export** | — | `devoluciones` (hardcoded `0`) | gap |
| Cancelaciones | **not in export** | — | *(no field)* | gap |
| Propinas | **not in export** | — | `propinas_total` = `sum(order.propina)` | gap |
| Formas de pago | **not in export** | — | `efectivo` / `tarjeta` (2-way split) | gap |
| Corte / turno | **not in export** | — | *(no field)* | gap |

## Reconciliation results (exact to cent)

| st | metric | wansoft | fullsite | delta | probable cause / mapping gap |
|---|---|---|---|---|---|
| OK | ventas_netas (gran total) | $105,705.00 | $105,705.00 | $0.00 | Wansoft gran_total ≡ Fullsite `sum(order.total)` |
| OK | ventas_brutas | $105,705.00 | $105,705.00 | $0.00 | brutas = net + descuentos; descuentos=0 |
| OK | descuentos | $0.00 | $0.00 | $0.00 | export discount header blank → 0 |
| OK | personas | 219 | 219 | 0 | direct field map |
| GAP | devoluciones | — (not in export) | $0.00 | n/a | Fullsite `devoluciones` is **hardcoded 0** — never computes anulaciones |
| GAP | iva (16%) | $14,580.00 | — (no field) | n/a | Fullsite stores tax-inclusive totals only; no IVA/subtotal breakout |
| GAP | propinas | — | — | n/a | no tips sheet in ventas-por-mesero export |
| GAP | formas_pago.efectivo | — | — | n/a | no formas-de-pago sheet in export |
| GAP | formas_pago.tarjeta_credito | — | — | n/a | Fullsite `efectivo/tarjeta` is 2-way; Wansoft has 4+ types (crédito, débito, transferencia, efectivo, UberEats) |
| GAP | cancelaciones | — | — | n/a | neither side captures cancelaciones in this pipeline |
| GAP | corte_total | — | — | n/a | corte/turno is a separate Wansoft report |

**Internal relationship gates (all PASS, exact to cent):**
`gran_total == subtotal + iva + ieps` · `iva == round(subtotal*0.16,2)` ·
`Σ meseros.total == gran_total` · `ventas_brutas == gran_total`.

**Result:** PASS — 4 mapped metrics reconcile exactly ($0.00 delta), 7 declared gaps (non-blocking), 0 arithmetic failures. Exit 0.

## Mapping gaps found (Wansoft concepts Fullsite doesn't capture / computes differently)

1. **`devoluciones` is hardcoded `0`** in `data.ts` (`devoluciones: 0`). Fullsite never derives returns/anulaciones. If a client needs anulaciones parity, this is a real feature gap.
2. **No IVA / subtotal breakout.** Wansoft separates Subtotal + IVA (16%) + IEPS; Fullsite `wansoft_daily` stores only tax-inclusive totals. Reports needing an IVA line can't be reproduced from Fullsite's model.
3. **Payment split is 2-way, Wansoft is 4+-way.** `data.ts` buckets everything non-efectivo (`/efectivo|cash/`) into `tarjeta` — tarjeta de crédito, débito, transferencia and UberEats all collapse into one number. Wansoft distinguishes them.
4. **Propinas require per-order data.** `propinas_total` = `sum(order.propina)`; absent from this export, so it can't be golden-tested from it.
5. **No cancelaciones metric on the Fullsite side.** Neither the export nor `wansoft_daily` carries cancelaciones.
6. **No corte/turno aggregate.** Wansoft's cash-cut/shift report is separate; Fullsite has no equivalent daily field.
7. **`APLICACIONES` pseudo-mesero (delivery apps).** In the 05-09 file, delivery-app sales appear as a synthetic mesero and are excluded from the group-level Gran total but included in the per-mesero Resumen — a $13,222.60 divergence. Fullsite classifies delivery via `ordenes_llevar` (mesa 0 / mesa ≥ 900), a different axis; direct per-mesero equivalence would double-count unless normalized.

## Commit / privacy note

The raw `.xlsx` under `agents/wansoft/test_data/` contain waiter and customer PII and
**must never be committed**. Only `fixtures/golden_2026-05-10.json` (numeric totals +
anonymized M1..M10 labels), `scripts/wansoft/golden_reconcile.py`, and this doc are committable.
See `agents/wansoft/test_data/.gitignore`.

## Estado registrado (2026-08-10)

`GOLDEN SALES RECONCILIATION PASS — PAYMENT/CASH DIMENSIONS WAITING ON SOURCE EXPORTS`

NO es conciliación financiera completa. Dimensiones disponibles (ventas, ventas_brutas,
descuentos, personas, business date, total general, Σ meseros) pasan **al centavo**.
Pagos, propinas, cancelaciones/devoluciones y cortes = `WAITING_SOURCE` (no `FAILED`):
el tipo de export "Ventas por mesero" no las contiene; viven en reportes Wansoft distintos
(ver `WANSOFT-COMPLEMENTARY-REPORTS-CHECKLIST.md`).

## INVARIANTE PERMANENTE — business date desde contenido

El business date SIEMPRE se toma del contenido del reporte ("Reporte del: YYYY-MM-DD"),
NUNCA del nombre del archivo. Caso real: `real_2026-05-10.xlsx` (nombre 05-10) contiene
business date **2026-05-09** (gran total $105,093.00). Guard en
`scripts/wansoft/golden_reconcile.py::assert_business_date_from_content` — falla si un
fixture futuro deja que el nombre de archivo sea la fuente de verdad sin documentar la divergencia.
