# Wave 1 — Runbook de Release (preparado 2026-08-08; PROD NO tocado)

## Estado de integración

- **Rama:** `wave1/inventory-truth` (5 commits certificados 54f6c28→63faea9 + release-prep).
- **Merge a main remoto (`danielfullsite/fullsite`):** `git merge-tree` = **0 conflictos** contra `b6343aa` (que incluye el hotfix BUG-019 aplicado a prod y el retiro del scraper Rappi). Los 3 archivos compartidos (pos/page.tsx, pos-data.ts, onboard_client.py) tienen hunks disjuntos y semántica ortogonal (auth/keys vs depleción).
- **Prerequisito de integración:** el main LOCAL tiene **37 commits sin push** (base común `e104e19`) que Wave 1 trae en su historia — la unidad de integración es (main local + wave1) → main remoto. El push del main local es del stream de field (bloqueado en push auth); Wave 1 no lo resuelve.
- **BUG-019 branch (`bug-019/security-consolidation`):** **cero overlap de archivos** (34 vs 41). Un dueño por dominio se mantiene.

## Orden canónico de migraciones (prod, en el approval gate)

Todas aditivas, idempotentes, con rollback documentado en cada archivo. Certificadas en staging incluyendo re-apply.

| # | Archivo | Qué hace | Prerreq |
|---|---|---|---|
| 1 | `w1b_ledger_migration.sql` | idempotency_key + UNIQUE por línea + índice | — |
| 2 | `w1d_close_migration.sql` | snapshot/sealed_at, pos_cierre_ajustes, guard de inmutabilidad, triggers post-cierre, vista | usa `uq_cierres_turno_id` (YA existe en prod) |
| 3 | `w1e_cost_migration.sql` | pos_cost_events, applied_cost, RPC r1_reconcile_item W1-E, vista extendida (DROP+CREATE) | 2 (guard) + prod ya tiene recipe_versions/policy (r2_phase8) |
| 4 | **DATA** `w1a_policy_backfill.sql` (client amalay) | cobertura de policy determinista | 3 |
| 5 | **DATA** `w1b_opening_balance.sql` (client amalay) | saldo inicial = stock actual (incl. negativos) | 1 |
| 6 | `w1b_drift_report.sql` parte 2 | clasificación humana de anomalías históricas (READ-ONLY) | 5 |

**No requerido:** config de business date de AMALAY — **prod YA tiene `timezone='America/Monterrey'` + `business_day_start_local='05:00:00'` operando con los agentes**. La dirección "04:00" queda superada por evidencia: ambos valores caen en la ventana muerta certificada (02:00–06:00, resultados idénticos) y cambiar a 04:00 crearía inconsistencia con el histórico de `ops_daily` sin beneficio. **AMALAY se queda en 05:00.** Deploy de app: los tres batches TS (dashboard) van en el deploy normal de Vercel tras el merge.

## Artefactos staging-only (NO van a prod)

Tenants sintéticos `w1acert`, `w1acert2`, `cl2clean` y sus datos; los `SET LOCAL app.cierre_admin_unlock` de limpieza de fixtures; migraciones espejo de staging previas (BUG-013). Los archivos `scripts/sql/wave1/*.sql` SÍ son canónicos.

## Consolidación de funciones

`004_functions.sql` reconciliado: `r1_reconcile_item` = **byte-idéntico** a la versión certificada W1-E (verificado por extracción+diff). Un bootstrap/rebuild ya no puede pisar la función certificada con la versión pre-costo. Re-consolidación de tablas W1 en `010_consolidated_core.sql`: diferida al siguiente ciclo de consolidación (los archivos wave1 son parte de la cadena canónica y crean sus objetos).

## Dos caminos, deliberadamente distintos

### A. AMALAY (migración legacy)
Impacto recomputado contra prod HOY (300 unclassified sin cambios desde el forense):

| Bucket | n | Acción |
|---|---|---|
| AUTO_SAFE_RECIPE | **1** | Backfill automático (la prevalidación estricta redujo 27→1: unidades/FK/sub-recetas inválidas) |
| AUTO_SAFE_MARKET (mkt-%) | **168** | Backfill automático: direct_stock con stock=0 → el negativo pide conteo, no inventa stock |
| HUMAN_DECISION | **116** | `docs/wave1/AMALAY-W1-DECISIONES.csv` — 93 sin fuente + 23 receta inválida, con recomendación por fila (patrones: botellas/copas/nieves/kombuchas → direct_stock; combos/decoración → non_inventory; platos → crear/arreglar receta). Daniel marca la columna `decision_daniel`; no toca SQL |
| NO_ACTION (inactivos) | **15** | Permanecen fail-closed |

Opening balance AMALAY: **objetivo** (stock almacenado actual, incl. negativos como verdad conocida) → automatable (paso 5). El drift histórico (flor_comestible etc.) NO se absorbe: reporte parte 2 → clasificación humana → correcciones solo vía `adjustment` auditado post-decisión.

### B. Client #2 (inicialización limpia — SIN remediation legacy)
Certificado en staging (`cl2clean` + `scripts/wave1/client2_clean_init_cert.sql`): config obligatoria (gate de onboarding W1-D en `onboard_client.py` la exige), policy 100% clasificada día 0, saldo inicial EXPLÍCITO capturado, y el ciclo completo venta→R1→costo inmutable→cierre sellado→ajuste tardío→drift 0→aislamiento — **cero backfills, cero unclassified, cero pasos AMALAY**. Client #2 NUNCA ejecuta los pasos 4-6.

## Rollback por paso

Cada migración lleva su bloque de rollback (certificado en staging: drop→reapply→misma conducta). Los backfills de datos son idempotentes con keys estables; revertirlos = eventos compensatorios/ajustes auditados, jamás DELETE de históricos (el guard lo bloquea por diseño — probado en vivo durante esta preparación).

## Trampas operativas conocidas (aprendidas en rehearsal)

1. **NO encadenar save+reconcile en un statement SQL con CTEs** — el orden de evaluación de CTEs volátiles no está garantizado ("Order not found" abortando todo). La app no sufre esto (ruta API secuencial); aplica a scripts manuales/certs.
2. La vista `pos_cierres_estado` requiere **DROP+CREATE** (no OR REPLACE) al agregar columnas.
3. El registro de save-operations no se limpia con los fixtures — usar `save_operation_id` frescos en certs.
4. Los DELETE de fixtures sobre tablas selladas requieren el unlock administrativo explícito.

## Gate de aprobación de producción (pendiente — NO ejecutado)

Checklist para solicitar aprobación: merge integrado en main remoto · deploy de app en preview/staging verificado · pasos 1-3 aplicados y verificados en prod (solo DDL aditivo) · CSV de decisiones resuelto por Daniel · pasos 4-5 + decisiones aplicadas en ventana controlada · drift report = 0 post-opening · smoke POS en AMALAY (venta→evento de costo→cierre).
