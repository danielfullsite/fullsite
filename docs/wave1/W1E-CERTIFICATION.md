# W1-E — Verdad de costo canónica + COGS real · Certificación

**Fecha:** 2026-08-08 · **Rama:** `wave1/inventory-truth` · **Depende de:** W1-A/B/C/D (54f6c28 → c0b9511)

## Preflight (derivado, sin decisión de producto)

**Evento canónico de reconocimiento: `r1_reconcile_item` PHASE B** — el mismo instante transaccional donde R1 depleta inventario. **Por qué:** ahí es donde Fullsite reconoce el consumo de ingredientes (delta por revisión, receta PINNEADA, locks deterministas, exactly-once certificado en W1-A); pago y cierre son eventos financieros, no de consumo. **BOM canónico:** `pos_recipe_versions` + `pos_recipe_lines` vía `pinned_recipe_version_id` (la inmunidad a ediciones de receta ya existía en R1). **Costo canónico de ingrediente:** `pos_ingredients.cost_per_unit` (weighted-average, único escritor `recordMovement` post-W1-B), leído DENTRO de la transacción de reconciliación. **Identidad económica:** `(reconciliation_result_id, mutation_revision)` — UNIQUE en BD. **Falso/legacy eliminado del camino:** `items[].recipe_cost` (navegador — ignorado), fallback 35% presentado como real, fuzzy Wansoft.

## Cambios

| Pieza | Cambio |
|---|---|
| `scripts/sql/wave1/w1e_cost_migration.sql` | `pos_cost_events` (append-only, inmutable vía `w1d_sealed_guard`, UNIQUE identidad económica); `pos_reconciliation_results.applied_cost` (base de reversa); `r1_reconcile_item` con captura de costo — **la mutación de inventario queda idéntica a W1-A**; solo se añade: costo por línea al weighted-avg vigente en la transacción (forward), evento con breakdown y cobertura FULL/PARTIAL/UNKNOWN, y reversa proporcional a `applied_cost/applied_consumption` (snapshot ORIGINAL, jamás precio actual); vista `pos_cierres_estado` extendida con `cogs_sealed` / `cogs_post_close` / `cogs_unknown_events`. Rollback documentado y certificado. |
| `api/contabilidad/polizas` | COGS diario y mensual desde `pos_cost_events` exclusivamente (rangos por bounds W1-C); eliminados `items[].recipe_cost` y el 35% disfrazado de real; respuesta declara `cogsSource`, `cogsCoverage`, `cogsParcial`. |
| `contabilidad/page.tsx` | Etiquetas "(parcial)" / "cobertura parcial" cuando la cobertura no es completa — el margen parcial se declara parcial. |

## Matriz de certificación (staging `w1acert`, RPCs reales)

Receta V1: 6pz tortilla @$1.50 + 0.2kg salsa @$80 → $25/porción.

| # | Gate | Evidencia | Resultado |
|---|---|---|---|
| 1-2 | Venta básica + breakdown | 2x → evento delta 2, **$50** = 12pz×1.5 + 0.4kg×80; breakdown por ingrediente exacto; FULL | **PASS** |
| 3 | Autoridad de servidor | `items[].recipe_cost: 99999` en el payload → reconocido $50 (campo ignorado por el RPC) | **PASS** |
| 4-5 | Reconocimiento inicial + replay | Replay de `op-e1` completo → `idempotent_replay`, delta 0, **cero eventos nuevos** | **PASS** |
| 6 | Race / doble disparo | INSERT directo con misma (intent, revisión) → `unique_violation` a nivel BD | **PASS** |
| 7-8 | Adición / envío parcial | 2→3 → evento delta 1 únicamente ($28); jamás re-suma de la orden completa | **PASS** |
| 9 | Terminal stale | `STALE_WRITE_REJECTED` (W1-A) → la reconciliación nunca corre → cero costo duplicado | **PASS** |
| 10 | Cambio de receta | V2 (8pz) activada → la adición de la orden vieja usó V1 PINNEADA ($28 = 6pz@2.0+16); evento histórico $50 intacto | **PASS** |
| 11 | Cambio de costo de ingrediente | Tortilla 1.5→2.0 → evento histórico $50 intacto; consumo futuro usa 2.0 | **PASS** |
| 12 | Venta futura | Orden nueva pinnea V2 → **$32** = 8pz×2.0 + 16 | **PASS** |
| 13 | Reversa al costo ORIGINAL | Cancelación (3 porciones, applied_cost 78) → evento **−78** con basis `original_snapshot_average` — NO −84 (V1@precios actuales) NI −96 (V2); applied_cost → 0.0000; neto económico de la orden = 0.0000; stocks exactos | **PASS** |
| 14 | Retry de reversa | Re-reconcile → delta 0, cero eventos | **PASS** |
| 15 | Refund SIN reversa de inventario | Cambio de total sin cambio de items (semántica actual: refund monetario) → **cero eventos de costo** — el COGS permanece consumido; el ajuste de ingreso lo captura W1-D | **PASS** |
| 16 | Refund CON reversa canónica | = cancelación/remoción de items (semántica actual certificada en gate 13) | **PASS** |
| 17 | Business date | Reportes consumen eventos por bounds del primitivo W1-C (sin math independiente; sin columna de fecha duplicada) | **PASS** |
| 18 | Cierre normal | Vista: `cogs_sealed` reconstruible del sello (0 para turnos sin eventos previos — correcto) | **PASS** |
| 19 | Orden tardía post-cierre | Evento $32 + ajuste W1-D `late_order` $214.60 + `cogs_post_close`=32; sello original intacto (300); sin doble conteo | **PASS** |
| 20 | Reversa post-cierre | Cubierta por triggers W1-D (mutación financiera → ajuste) + evento REVERSAL; sello intacto | **PASS** |
| 21 | Receta desconocida | `mi-mystery` (unclassified) → `BLOCKED_UNCLASSIFIED`, **cero eventos** — jamás COGS=0 silencioso | **PASS** |
| 22 | Cobertura parcial | `mi-agua` (direct_stock sin base de costo) → evento `UNKNOWN` con `total_cost NULL`; pólizas reportan `cogsParcial=true` y UI etiqueta "(parcial)" | **PASS** |
| 23 | Cross-tenant | Tenant B: 0 eventos; `r1_reconcile_order` scoped por client en todo el camino | **PASS** |
| 24 | Reconstrucción | `applied_cost == Σ eventos` en TODOS los intents recipe del tenant (0 discrepancias) | **PASS** |
| 25-26 | Migración / rollback / reapply | Rollback limpio (tabla fuera) → reapply → reconocimiento nuevo funcional ($32, V2) | **PASS** |
| 27 | Build/static/tests | `tsc` limpio; suite 57 files / 2,236 PASS | **PASS** |
| 28 | Regresión W1-A/B/C/D | Suites intactas en verde; mutación de inventario del RPC sin cambios de comportamiento | **PASS** |

## Timing de costo bajo offline (propiedad probada, no pretendida)

El evento canónico de consumo ES la reconciliación server-side (dirección de producto aceptada en W1-A: el stock canónico se actualiza al sincronizar). Por lo tanto **el costo aplicable al consumo canónico = weighted-average vigente en esa transacción** — para operaciones originadas offline, eso es el momento del sync. No existe (ni se inventó) un costo local canónico previo al sync; capturarlo requeriría protocolo nuevo en la release offline congelada. La ventana de deriva está acotada por la duración de la caída y el evento registra su `created_at` (auditable contra `pos_orders.created_at`). Documentado como semántica, no como gap oculto.

## No tocado

Producción, BUG-019, release offline congelada, Wave 2, Margin Engine completo (labor/gastos/comisiones = waves posteriores). `004_functions.sql` se re-consolida en el release gate.
