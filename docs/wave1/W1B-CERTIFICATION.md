# W1-B — Ledger canónico reconstruible e idempotente · Certificación

**Fecha:** 2026-08-08 · **Rama:** `wave1/inventory-truth` · **Depende de:** W1-A (54f6c28)

## Cambios

| Pieza | Cambio |
|---|---|
| `scripts/sql/wave1/w1b_ledger_migration.sql` | ADITIVA: columna `idempotency_key` + UNIQUE `(client_id, idempotency_key, ingredient_id)` parcial + índice `(client_id, ingredient_id, id)`. Rollback: DROP INDEX + DROP COLUMN. |
| `dashboard-app/src/lib/inventory.ts` | Idempotencia por columna (match exacto; el LIKE sobre notes se eliminó); INSERT 409 = duplicado exitoso (carrera entre procesos); **sin clamp a cero** (el stock sigue la cantidad exacta — reconstruibilidad; cruzar bajo cero emite `underflow_prevented` como detección, no bloqueo); el halt por stock negativo se eliminó (contradecía la semántica R1 post-W1-A); tipo `opening_balance`; `recordTransfer()` de dos piernas balanceadas con keys derivadas `_out`/`_in` (retry tras falla parcial completa la pierna faltante sin duplicar). |
| `transferencias/page.tsx` | Catálogo canónico (`loadInventoryWithStock`) + `recordTransfer` al ledger. Antes: solo blob `wansoft_data` con códigos Wansoft que no son `ingredient_id`. El blob se conserva como metadata de almacenes (modelo canónico = single-bucket; las piernas netean cero en stock y el valor del par es auditoría). |
| `devoluciones/page.tsx` | Catálogo canónico + `recordMovement('return')` (cantidades negativas, idempotente, metadata de proveedor). Antes: solo blob. |
| `pos/recepcion-factura/page.tsx` | **Violación de costo eliminada**: el PATCH directo de `cost_per_unit` al precio de factura + stock manual + insert crudo se reemplazó por un solo `recordMovement('restock')` con key `cfdi_restock_{UUID}` (promedio ponderado, stock y ledger en un camino). Cambio de conducta: un cambio de precio SIN recepción ya no muta el costo (el costo solo cambia con entrada ponderada — contrato canónico). |
| `pos/facturas-proveedor/page.tsx` | Ídem: PATCH directo de costo + doble escritura manual → un `recordMovement('restock')`. |
| `w1b_opening_balance.sql` | Saldo inicial por ingrediente = **stock actual almacenado** (incluidos negativos — se preservan como verdad conocida, no se "corrigen"). Key estable → idempotente. **No reescribe historia**: los movimientos pre-cutover quedan intactos; la reconstrucción arranca en el opening. |
| `w1b_drift_report.sql` | READ-ONLY. Parte 1: drift post-cutover (meta: 0 filas). Parte 2: clasificación de anomalías históricas (ej. sospecha de escala de unidad tipo `flor_comestible`) para revisión humana — sin corrección automática. |

## Evidencia de certificación (staging `w1acert`)

| # | Escenario | Resultado |
|---|---|---|
| CERT-B0 | Migración aplicada DOS veces | Idempotente (IF NOT EXISTS) · **PASS** |
| CERT-B1 | INSERT duplicado misma `(client, key, ingredient)` | `unique_violation` a nivel BD · **PASS** |
| CERT-B2 | Opening balance ejecutado dos veces | 1 fila por ingrediente (re-run no duplica) · **PASS** |
| CERT-B3 | Reconstrucción: opening + SUM(post) vs stored tras merma post-cutover | tortilla 93=93, salsa 10=10, **drift=0** · **PASS** |
| CERT-B4 | Mutación FUERA del camino canónico (UPDATE stock sin movimiento, +999) | Drift la detecta exacto (999); revertida → drift 0 · **PASS** |
| CERT-B5 | Transferencia dos piernas | Neto ledger 0.0000, drift se mantiene 0 · **PASS** |

Unit tests nuevos: `w1b-ledger.test.ts` (10 tests — idempotencia por columna, carrera 409, sin clamp, negativo no bloquea, promedio ponderado 10@$10+10@$20→$15, opening_balance, return, transferencia balanceada + retry que sana sin duplicar). Suite completa: **55 archivos / 2,090 tests PASS**. Typecheck limpio.

## Drift de producción — NO tocado

Las anomalías conocidas de AMALAY (ej. `flor_comestible` stored 852.6 vs suma ledger −10,140 — sospecha de escala de unidad en receta; stocks negativos como `crema_acida` −0.12) quedan **intactas**. El camino de adopción en prod (requiere autorización): (1) migración aditiva, (2) opening balance preservando stocks actuales tal cual, (3) drift report parte 2 para clasificación humana de anomalías históricas, (4) correcciones solo vía `adjustment` auditado post-clasificación.

## BUG-019

Sin solape: la migración no toca policies RLS de ninguna tabla. La rama `bug-019/security-consolidation` (BATCH A: token en `pos_mesas`) opera sobre superficies distintas.
