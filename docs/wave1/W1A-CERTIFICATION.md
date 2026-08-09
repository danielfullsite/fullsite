# W1-A — Autoridad única de depleción · Certificación

**Fecha:** 2026-08-08 · **Rama:** `wave1/inventory-truth` (base `main` @ 6f60dae) · **Alcance:** retiro de Sistema A; R1 (`r1_reconcile_order`/`r1_reconcile_item`) como única autoridad canónica venta→inventario.

## Cambios

| Archivo | Cambio |
|---|---|
| `dashboard-app/src/app/pos/page.tsx` | Retiradas 4 llamadas: deducción en kitchen-send, reversa en cancel-item, reversa en void-order, deducción Market legacy en payment |
| `dashboard-app/src/lib/pos-data.ts` | `deductIngredientsForOrder`, `reverseIngredientDeduction`, `deductMarketStockForOrder` → stubs inertes (cero I/O); eliminados el Set de idempotencia de sesión, el fuzzy matching por nombre, `fetchRecipeRefs` (privada, sin otros callers) y el phase-gate `RECIPE_FALLBACK_ENABLED` |
| `scripts/sql/wave1/w1a_policy_backfill.sql` | Backfill determinista de cobertura de policy (reglas R1/R2, fail-closed, idempotente) |
| Tests | `inventory-double-deduction`, `inventory-policy-gate`, `pos-recipe-ref` reescritos como suites de retiro (invariante: cero escrituras client-side) |

Diff total: 5 archivos, +173/−1,222. **Cero cambios en electron-app/bridge/KDS.**

## Semántica preservada

- **Depleción:** R1 corre en CADA save (`/api/pos/save-order` Step 2) con lineage `last_inventory_processed_revision`; envíos parciales y adiciones → delta por revisión; pinning de modo histórico.
- **Cancelación/void:** los items cancelados/anulados salen de `items[]` en el siguiente save (`activeItems`/`payingItems`) → orphan discovery → `desired=0` → `recipe_reversal`. Paridad 1:1 con la conducta previa.
- **Offline:** la cola offline replayea por `APP_API` → misma ruta → misma idempotencia (`save_operation_id`). El stock canónico se actualiza al sincronizar (dirección de producto aceptada).
- **Stock negativo:** permitido (semántica R1), detectable vía ledger y stocks; nunca clampeado en silencio.
- **Bug colateral eliminado:** la reversa Sistema A no verificaba modo — reponía stock que nunca dedujo para items recipe-mode (inflación doble junto con `recipe_reversal` de R1). Retirada.

## Cobertura de policy (backfill)

Baseline prod AMALAY (read-only, 2026-08-08): 178 recipe · 197 direct_stock · 12 non_inventory · **300 unclassified** (27 con receta directa en `pos_recipes_old`, 165 categoría `mkt-%` sin fila market, 108 sin fuente determinista).

Reglas del script (fail-closed): R1 materializa `pos_recipe_versions`+`lines` desde `pos_recipes_old` solo si TODAS las líneas prevalidan (ingrediente en `pos_inventory` + `pos_ingredients`, unidad convertible, sin sub-recetas); R2 crea `pos_market_stock` con stock=0 ("sin conteo inicial" — el negativo es verdad operativa) para `mkt-%`; el resto PERMANECE `unclassified` → `BLOCKED_UNCLASSIFIED` visible, para clasificación humana. **NO aplicado a producción.**

## Evidencia de certificación (staging `w1acert`, RPCs reales)

| # | Escenario | Resultado |
|---|---|---|
| CERT-1 | Backfill: 3 items unclassified (receta directa / mkt / sin fuente) | recipe=1 (1 versión, 2 líneas) · direct_stock=1 (stock 0) · unclassified=1 (fail-closed) · **PASS** |
| CERT-1b | Re-ejecución del backfill | Cero filas tocadas (guard NOT EXISTS + ON CONFLICT) · **PASS** |
| CERT-2 | Exactly-once: save op-1 (2x receta) → reconcile → **replay op-1** → reconcile | 1ª: rev=1, delta=2, 2 movimientos (−12 pz, −0.4 kg). Replay: `idempotent_replay=true`, delta=0, **cero movimientos nuevos** · **PASS** |
| CERT-3 | Segundo terminal, revisión stale (op-terminal2, rev 0 vs actual 1, cantidad 9) | `STALE_WRITE_REJECTED`, conflict=true, **cero depleción** · **PASS** |
| CERT-4 | Adición post-envío (2→3, rev 1→2) | Reconcile delta=1: solo el incremento (−6 pz, −0.2 kg); stocks 82/9.4 exactos · **PASS** |
| CERT-5 | Cancelación (items[]=[], status cancelada, rev 2→3) | `recipe_reversal` +18/+0.6; stocks vuelven a 100/10; **suma neta del ledger = 0.0000** · **PASS** |
| CERT-6 | Market direct_stock (1x agua, stock inicial 0) | `pos_market_stock` → **−1** (negativo visible) + movimiento `venta` con provenance · **PASS** |

Suite dashboard-app completa: **54 archivos / 2,080 tests PASS** (incluye las 3 suites de retiro). Typecheck limpio.

## Twin / electron-app

N/A por construcción: el twin harness (`tests/twin/`) existe solo en `release/offline-field-2026-08-06` (frozen, prohibido tocar), no en `main`; y el diff W1-A contiene 0 líneas de electron-app/local-server/KDS. La invariante offline se certificó por la vía equivalente: el replay offline usa `APP_API` → misma ruta → CERT-2 (replay = cero movimientos nuevos).

## Comportamiento mínimo offline identificado (sin expandir alcance)

Con Sistema A retirado, en offline el stock canónico se decrementa al sincronizar (no al instante). Sistema A tampoco actualizaba nada visible localmente (PATCHeaba el servidor), así que **no hay regresión de UX**; el indicador "pendiente de sync" ya existente en el POS cubre la comunicación al operador. Nada adicional requerido en W1-A.

## Gates

- Una sola depleción por revisión/batch lógico: **PASS** (CERT-2/3/4)
- Sin depleción perdida: **PASS** (cobertura por policy + BLOCKED visible para unclassified)
- Sin depleción duplicada (sesión/reload/2º terminal/retry/replay): **PASS** (idempotencia BD; el cliente ya no escribe)
- Reversa de cancelación sin regresión: **PASS** (CERT-5, simetría exacta)
- Replay offline exactamente-una-vez: **PASS** (CERT-2 vía APP_API)
