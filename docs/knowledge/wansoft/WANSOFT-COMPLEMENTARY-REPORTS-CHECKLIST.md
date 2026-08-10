# Wansoft — reportes complementarios requeridos (para conciliación financiera completa)

Búsqueda read-only del corpus local (Downloads + agents/wansoft + docs/knowledge/wansoft),
2026-08-10: **NO existe** ninguno de estos exports. Solo hay exports tipo "Ventas por mesero"
(4 hojas: ventas por mesero/grupo/mesa/tipo-grupo), que no llevan pagos/propinas/cancelaciones/cortes.

**Regla:** no scraping, no Turnstile. Estos reportes se obtienen manualmente del portal
Wansoft (login 1 vez, cookie relay) o de BD NetSilver, cuando se autorice.

Para conciliar al centavo las dimensiones `WAITING_SOURCE`, se necesita — por cada día objetivo
(mínimo el par 2026-05-09 y 2026-05-10 ya en corpus):

| # | Dimensión | Reporte Wansoft (nombre exacto probable) | Periodo | Columnas mínimas requeridas |
|---|---|---|---|---|
| 1 | Formas de pago | "Ventas por forma de pago" / "Resumen por forma de pago" | día (Reporte del: X al X) | forma de pago (efectivo, tarjeta crédito, débito, transferencia, UberEats/apps), monto, % |
| 2 | Propinas | "Propinas por mesero" / "Reporte de propinas" (`spSelReportePropinas*`) | día | mesero, propina efectivo, propina tarjeta, total; base de tip-out si existe |
| 3 | Cancelaciones/devoluciones | "Cancelaciones" / "Anulaciones" / "Devoluciones" | día | folio/orden, item, cantidad, motivo, usuario, autorizador, ¿preparado? (merma vs stock), hora |
| 4 | Cortes / arqueo | "Corte de caja Z" / "Corte X" / "Arqueo" | por turno del día | turno, fondo inicial, ventas efectivo, propinas efectivo, depósitos, retiros/vales, efectivo real, diferencia, usuario |
| 5 | Business date (validación) | cualquiera de los anteriores | — | encabezado "Reporte del: YYYY-MM-DD" (fuente autoritativa del business date, ver invariante) |

Notas de mapeo (ya documentadas en `MAP-WANSOFT-FULLSITE.md` / `REGRESSION-CASES.md`):
- Fullsite colapsa pagos a 2 vías (efectivo/tarjeta); Wansoft distingue 4+. La conciliación
  debe normalizar antes de comparar (RC-45).
- `devoluciones` en Fullsite está hardcodeado 0 (gap conocido).
- El corte cuadra por fórmula ya testeada (`pos-arqueo.test.ts`, RC-01), pero falta el export
  Wansoft para conciliar el número real vs terminal bancaria (RC-45, gap Getnet tecleo manual).
- Cuidado con el pseudo-mesero `APLICACIONES` (delivery) que Wansoft excluye del gran total de
  grupo pero incluye en el Resumen por mesero (divergencia real de definición).

Cuando lleguen estos exports: extender `fixtures/golden_2026-05-10.json` con las secciones
`formas_pago`, `propinas`, `cancelaciones`, `corte`, y activar en `golden_reconcile.py` las
filas hoy marcadas `WAITING_SOURCE` → conciliación al centavo. El bruto permanece local; solo
el fixture sanitizado entra a git.
