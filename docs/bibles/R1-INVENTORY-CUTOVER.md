# R1 Inventory Cutover Plan

**Estado:** DISEÑO APROBADO — Paso 0 y Paso 1 pendientes de ejecución  
**Severidad:** P0 — bug de consistencia activo en producción  
**Fecha de descubrimiento:** 2026-07-25  
**Evidencia:** Queries directas a Supabase (pos_reconciliation_results, pos_inventory_movements)  
**Documentos relacionados:**
- `scripts/sql/R1-DIAGNOSTIC-READONLY.sql` — diagnóstico de solo lectura (9 secciones)
- `scripts/sql/R1-RECOVERY-DRAFT.sql` — recovery con snapshot, validación y rollback
- `docs/bibles/R1-REVERSAL-STRATEGY.md` — estrategia de reversals (documento separado)

---

## 1. Estado actual

### Dos sistemas de deducción de recetas coexisten en producción

| Sistema | Identificador | Ruta de código | Tabla de recetas | Tabla de inventario | Gate de autoridad |
|---------|---------------|----------------|------------------|---------------------|------------------|
| A — Legacy TypeScript | `deductIngredientsForOrder()` | `pos/page.tsx:3101` → `pos-data.ts:1925` | `pos_recipes_old` | `pos_inventory` | Ninguno — siempre corre |
| B — R1 SQL | `r1_reconcile_order` → `r1_reconcile_item` | `save-order/route.ts:157` | `pos_recipe_versions + pos_recipe_lines` | `pos_inventory` | `pos_mutation_authority.sale_authority = 'r1'` |

### Estado actual de AMALAY en base de datos

```
pos_mutation_authority:
  client_id:       amalay
  sale_authority:  r1         ← cutover completado el 2026-07-14
  cutover_at:      2026-07-14T06:55:21 UTC
  cutover_by:      r2_phase8

pos_item_inventory_policy (687 filas):
  recipe:          178 items  ← cubiertos por R1
  direct_stock:    197 items  ← cubiertos por R1 (pos_market_stock)
  unclassified:    300 items  ← R1 devuelve BLOCKED_UNCLASSIFIED (ver §8)
  non_inventory:    12 items  ← R1 devuelve NO_MUTATION_APPROVED

pos_recipe_versions (activas):
  178 versiones activas → coincide exacto con los 178 items en modo recipe

pos_reconciliation_results (301 filas):
  RECONCILED:            233  ← R1 ha deducido exitosamente
  BLOCKED_UNCLASSIFIED:   65
  NO_MUTATION_APPROVED:    3
```

### Doble deducción confirmada

```
Órdenes con doble deducción confirmada (muestra):
  72364e61-a02c-4520-af5d-7f62562290a1  (2026-07-24)
  6269155b-663c-432b-add9-0db997b2825b  (2026-07-23)

Cross-reference:
  pos_inventory_movements.movement_type = 'deduction'   → Sistema A ejecutó
  pos_reconciliation_results.result     = 'RECONCILED'  → Sistema B ejecutó
  Overlap por order_id: CONFIRMADO (6 items de 2 órdenes como muestra)
  Alcance total: determinar con R1-DIAGNOSTIC-READONLY.sql §9
```

---

## 2. Causa raíz

### Cronología del bug

| Fecha | Evento |
|-------|--------|
| Antes de 2026-07-14 | `sale_authority = 'legacy'`. `r1_reconcile_item` devuelve `BLOCKED_OWNER_MISSING`. Solo Sistema A corre. |
| 2026-07-14 | Cutover: `sale_authority` cambió a `'r1'` via `r2_phase8`. R1 ahora ejecuta mutaciones. Sistema A no fue desactivado. |
| 2026-07-21 | Eduardo: `deductIngredientsForOrder()` movida a PAYMENT (antes era al enviar a cocina). Ambos sistemas ahora coinciden en el mismo momento del flujo. |
| 2026-07-23–24 | Primera evidencia confirmada de doble deducción. |

### Por qué ocurre

`r1_reconcile_item` tiene un gate de autoridad explícito (SQL línea 566):
```sql
-- ═══ STEP 6: Authority check — MUST be r1 for sale mutation ═══
IF p_sale_authority != 'r1' THEN
  RETURN QUERY SELECT p_item_id, 'BLOCKED_OWNER_MISSING'...
END IF;
```

`deductIngredientsForOrder()` no tiene gate equivalente. El cutover del 14-jul activó el gate del SQL pero no desactivó el código TypeScript. Ambos quedaron activos sobre los mismos 178 items `recipe`.

### Qué items están afectados

Un item sufre doble deducción si cumple TODAS las condiciones:
1. Tiene `inventory_mode = 'recipe'` en `pos_item_inventory_policy`
2. Tiene versión activa en `pos_recipe_versions`
3. Tiene receta en `pos_recipes_old` (que `deductIngredientsForOrder()` lee)
4. Es pagado a través del POS (que llama `deductIngredientsForOrder()`)

| Modo | Sistema A | Sistema B | Estado |
|------|-----------|-----------|--------|
| `recipe` + receta en pos_recipes_old | Sí | Sí (RECONCILED) | DOBLE DEDUCCIÓN — P0 |
| `recipe` + sin receta en pos_recipes_old | No | Sí (RECONCILED) | Sin problema |
| `unclassified` | Sí si hay receta en pos_recipes_old | No (BLOCKED_UNCLASSIFIED) | Ver §8 |
| `direct_stock` | No (A no toca pos_market_stock) | Sí (pos_market_stock) | Sin problema |
| `non_inventory` | Solo si hay receta en pos_recipes_old | No (NO_MUTATION_APPROVED) | Verificación preventiva |

---

## 3. Flujo completo de inventario (mapa de ejecución)

### Al cobrar una orden (PAYMENT)

```
pos/page.tsx → handlePayment()
│
├─① deductMarketStockForOrder()                    ← pos-data.ts:2370
│   └─ POST /api/pos/deduct-market
│       └─ r1_legacy_sale_deduction (SQL)
│           └─ GATE: sale_authority = 'legacy' → BLOCKED para AMALAY ✓
│
├─② deductIngredientsForOrder(payingItems)          ← pos-data.ts:1925
│   ├─ Lee pos_recipes_old
│   ├─ Sin gate de autoridad — siempre ejecuta   ⚠️
│   ├─ updateInventoryStock() → pos_inventory.stock -= cantidad
│   └─ logInventoryMovement() → pos_inventory_movements (type: 'deduction')
│       → CORRE para los 178 items recipe + los unclassified con receta ⚠️
│
└─③ saveOrder() → POST /api/pos/save-order
    ├─ r1_save_order (SQL) → INSERT/UPDATE pos_orders con OCC
    └─ r1_reconcile_order (SQL)
        └─ Lee pos_mutation_authority → sale_authority = 'r1' → PROCEDE ✓
            └─ Para cada item en pos_orders.items:
                └─ r1_reconcile_item()
                    ├─ Lee pos_item_inventory_policy → modo = 'recipe'
                    ├─ GATE: sale_authority = 'r1' → PASA ✓
                    ├─ Lee pos_recipe_versions + pos_recipe_lines
                    ├─ pos_inventory.stock -= delta    ← SEGUNDA DEDUCCIÓN ⚠️
                    └─ pos_reconciliation_results → RECONCILED
```

### Al cancelar un item (CANCEL)

```
pos/page.tsx:2342 → reverseIngredientDeduction(item)    ← Sistema A únicamente
  ├─ Lee pos_recipes_old
  └─ pos_inventory.stock += cantidad_devuelta
  → R1 tiene orphan detection (desired=0) pero no reversal explícito activo
```

Ver `R1-REVERSAL-STRATEGY.md` para análisis completo por escenario.

### Al fusionar mesas (MERGE)

```
POST /api/pos/merge-orders
  ├─ r1_merge_orders (SQL) → mueve items entre órdenes
  └─ r1_reconcile_order × 2 (target + source)    ← solo Sistema B
```

### Al sincronizar offline

```
offline-sync.ts → syncQueue()
  └─ transport: APP_API → POST /api/pos/save-order → r1_reconcile_order
      → Sistema A es no-op al pagar sin red (getRecipes() usa cache: 'no-store' — falla sin conexión)
      → Sistema B corre al sincronizar
      → Sin doble deducción en offline: solo B deduce al sincronizar (una sola deducción)
      → NOTA: este análisis asume que getRecipes() no tiene cache local; verificar antes de cambiar
```

---

## 4. Arquitectura objetivo

Sistema B (R1) es el sistema autoritativo para todos los items clasificados.
Sistema A queda como path de escritura solo para items que R1 no cubre.

| Modo post-cutover | Quién deduce | Quién revierte |
|------------------|-------------|----------------|
| `recipe` | Solo R1 | Ver R1-REVERSAL-STRATEGY.md |
| `direct_stock` | Solo R1 (pos_market_stock) | R1 orphan |
| `unclassified` | Decisión pendiente — ver §8 | Decisión pendiente |
| `non_inventory` | Nadie | N/A |

**Qué permanece del Sistema A:**
- `reverseIngredientDeduction()` — transitoriamente, hasta resolución de reversal strategy
- Observabilidad: logs `[deduct:summary]` son valiosos para monitoreo post-cutover

---

## 5. Invariantes

Estas reglas describen el comportamiento correcto del sistema. El diseño de migración se valida contra ellas. Cualquier violación es un bug.

**I-1. Un item `recipe` clasificado genera exactamente una deducción de inventario por unidad vendida.**
Violación actual: items `recipe` generan dos deducciones. El Paso 1 la corrige.

**I-2. La autoridad del sistema está centralizada en `pos_mutation_authority`. Ningún código de mutación ignora esa tabla.**
Violación actual: `deductIngredientsForOrder()` no consulta `pos_mutation_authority`. El Paso 1 introduce el gate equivalente en TypeScript.

**I-3. Todo reversal corresponde a una deducción previa del mismo sistema.**
Estado actual: `reverseIngredientDeduction()` solo revierte Sistema A. Si la deducción fue hecha por R1 (sin pasada de Sistema A), el reversal devuelve stock que no fue quitado por A. Decisión pendiente — ver `R1-REVERSAL-STRATEGY.md`.

**I-4. Ningún movimiento de compensación existe sin un `recovery_batch_id` trazable.**
Garantizado por: el tipo `adjustment` con `actor = 'system-recovery-r1-*'` + referencia en `pos_inventory_recovery_snapshot`.

**I-5. El gate de TypeScript falla hacia abajo (safe-fail).**
Si el policy map no está disponible (caché vacía + fetch fallido), `deductIngredientsForOrder()` mantiene el comportamiento actual — no bloquea el pago. Esto prioriza disponibilidad operativa sobre consistencia de inventario durante un error de infraestructura.

**I-6. La idempotencia de R1 garantiza que `applied_consumption` en `pos_reconciliation_results` = suma exacta de todos los `recipe_deduction` para ese `order_item_id`.**
Verificable: `SELECT rr.applied_consumption, SUM(ABS(m.quantity)) FROM pos_reconciliation_results rr JOIN pos_inventory_movements m ON m.reconciliation_result_id = rr.id GROUP BY rr.id HAVING rr.applied_consumption != SUM(ABS(m.quantity))` debe retornar 0 filas.

**I-7. Un item `unclassified` no tiene deducción garantizada — su comportamiento es declarado, no accidental.**
Hoy: Sistema A puede deducir o no dependiendo de si hay receta en pos_recipes_old. Eso es un estado no declarado. La decisión de §8 lo vuelve explícito.

**I-8. El recovery es idempotente: ejecutar la misma recovery dos veces produce el mismo estado final.**
Garantizado por: `UNIQUE(recovery_batch_id, order_id, ingredient_id)` en snapshot + `WHERE compensation_movement_id IS NULL` en las fases de ejecución.

---

## 6. Pasos de migración

### Pre-condición: aprobación de Daniel

No implementar hasta revisión conjunta. Pasos en orden estricto: 0 → 1 → 2 → 3.

### Paso 0 — Corrección de datos (recovery)

**Archivos SQL:**
- `scripts/sql/R1-DIAGNOSTIC-READONLY.sql` — ejecutar primero, solo lectura
- `scripts/sql/R1-RECOVERY-DRAFT.sql` — ejecutar después de aprobación, contiene el recovery

**Garantías de determinismo del recovery:**

El recovery tiene tres mecanismos encadenados que garantizan que puede re-ejecutarse sin producir resultados distintos:

**(a) Identificación de casos ya recuperados**

`pos_inventory_recovery_snapshot` tiene un UNIQUE constraint en `(recovery_batch_id, order_id, ingredient_id)`. La inserción en la Sección E1 usa `ON CONFLICT DO NOTHING`. Si un row ya existe para ese batch + orden + ingrediente, la inserción no ocurre y el row original no cambia. Ejecutar E1 dos veces es equivalente a ejecutarlo una vez.

**(b) Prevención de doble compensación**

La columna `compensation_movement_id` actúa como sentinel de completitud:
- `NULL` = snapshot registrado pero movimiento de compensación aún no creado
- `NOT NULL` = compensación aplicada y confirmada

Las Secciones E2, E3 y E4 filtran con `WHERE compensation_movement_id IS NULL`. Si ya se aplicó la compensación (sentinel = NOT NULL), esas secciones no hacen nada al re-ejecutarse.

**(c) Manejo de interrupción entre snapshot y compensación**

Dentro de una transacción explícita `BEGIN...COMMIT`:
- Si la sesión se interrumpe antes del `COMMIT`, PostgreSQL hace `ROLLBACK` automático. El estado queda limpio — ningún row en snapshot, ningún movimiento creado, ningún stock modificado.
- Si el `COMMIT` ya ocurrió para E1 pero no para E2/E3/E4 (imposible en una sola transacción, pero posible si se rompe el bloque en transacciones separadas): los rows del snapshot tienen `compensation_movement_id = NULL`. Re-ejecutar E2 los procesa. El recovery continúa desde donde quedó.

**Secuencia de Paso 0:**
1. Ejecutar R1-DIAGNOSTIC-READONLY.sql Secciones 0–9. Revisar outputs con Daniel.
2. Aprobar la lista de casos `CONFIRMADO` + `AUTO_CORRECTABLE` de la Sección 2.
3. Definir el `recovery_batch_id` aprobado (ej. `r1-recovery-20260726-001`).
4. Ejecutar R1-RECOVERY-DRAFT.sql Sección P (preview) — solo lectura.
5. Aprobar el preview.
6. Desbloquear Sección E (quitar comentarios), ejecutar como bloque único `BEGIN...COMMIT`.
7. Revisar output de cada paso antes del COMMIT.
8. Ejecutar Sección V (validación post-recovery).

**Criterio de completitud del Paso 0:** Sección V retorna 0 errores. El snapshot tiene `compensation_movement_id IS NOT NULL` para todos sus rows.

### Paso 1 — Gate en TypeScript (la corrección de código)

#### Diseño del policy map en memoria

El gate **no hace ninguna llamada HTTP en el camino crítico del pago**. El policy map se carga una vez por sesión de browser (o cuando expira) y se mantiene en caché a nivel de módulo en `pos-data.ts`.

**Implementación en `pos-data.ts`:**

```typescript
// ─── Inventory policy cache (module-level, persists across payments) ─────────
// Loaded once on first use, refreshed every POLICY_CACHE_TTL ms.
// On HTTP failure, returns stale cache (safe-fail: payment path not blocked).

const POLICY_CACHE_TTL = 5 * 60 * 1000  // 5 min — policy changes don't happen mid-service

let _policyMap: Map<string, string> | null = null
let _policyMapExpiry = 0

export async function getInventoryPolicyMap(): Promise<Map<string, string>> {
  if (_policyMap && Date.now() < _policyMapExpiry) return _policyMap

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_item_inventory_policy` +
      `?client_id=eq.${_getClientId()}&select=menu_item_id,inventory_mode`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
    )
    if (res.ok) {
      const rows: { menu_item_id: string; inventory_mode: string }[] = await res.json()
      _policyMap = new Map(rows.map(r => [r.menu_item_id, r.inventory_mode]))
      _policyMapExpiry = Date.now() + POLICY_CACHE_TTL
    }
    // If !res.ok: fall through to stale cache below
  } catch {
    // Network error: fall through to stale cache
  }

  return _policyMap ?? new Map()  // empty map = safe-fail (A runs for all items, same as today)
}

// Call this on POS mount to warm the cache before the first payment.
// Non-blocking — errors are silent.
export function prefetchInventoryPolicyMap(): void {
  getInventoryPolicyMap().catch(() => {})
}
```

**Modificación en `deductIngredientsForOrder()` (`pos-data.ts:1925`):**

```typescript
export async function deductIngredientsForOrder(...) {
  try {
    const recipes  = await getRecipes()
    const inventory = await getInventory()
    const invMap   = new Map(inventory.map(i => [i.ingredient_id, i]))

    // ── R1 gate: load once from module cache, O(1) per item ──────────────────
    // If policyMap is empty (cache miss + HTTP error), gate is no-op and
    // Sistema A runs for all items — same as pre-Paso-1 behavior (safe-fail).
    const policyMap = await getInventoryPolicyMap()

    // ... rest of existing setup (recipeRefMap, normalizeRecipeName, etc.) ...

    for (const item of items) {
      // ── Skip items owned by R1 ───────────────────────────────────────────
      if (policyMap.get(item.menuItemId) === 'recipe') {
        resolution.DB_MAPPING.push(item.nombre + ' [r1-owned, skipped]')
        console.info(`[deduct:r1-owned] "${item.nombre}" (${item.menuItemId}) — R1 handles this item`)
        continue
      }
      // ... existing deduction logic unchanged for non-recipe items ...
    }
```

**Inicialización en `pos/layout.tsx` (startup):**

```typescript
// Se llama junto con los otros settings al montar el layout del POS.
// Resuelve antes del primer pago — no requiere warm-up separado.
import { inventoryPolicyService } from '@/lib/inventory-policy'

Promise.all([
  getEffectiveSetting(clientId, 'pos.idle_timeout_ms'),
  getEffectiveSetting(clientId, 'pos.station_routing'),
  inventoryPolicyService.initialize(clientId),   // ← state machine: LOADING → READY | FAILED
]).then(...)
```

**Propiedades del gate (v3 — InventoryPolicyService):**

| Propiedad | Comportamiento |
|-----------|----------------|
| Costo en payment | O(1) — un `Map.get()` sobre un `Map<string, string>` en memoria |
| Carga inicial | Una fetch al inicio de sesión (paralela con otros settings); zero overhead en pagos |
| Estado observable | UNINITIALIZED → LOADING → READY \| FAILED; log estructurado con items, duration, hash |
| Fallo de inicialización | FAILED → getMode() retorna null → gate es no-op → Sistema A corre para todo |
| Invalidación | No hay TTL — política es inmutable durante una sesión (cambios requieren restart) |
| Cambio de cliente | Re-init detectado, warning logeado; datos del cliente anterior purgados |
| Implementación | `src/lib/inventory-policy.ts` — `inventoryPolicyService` singleton exportado |

**Contrato de cambios de política (Policy Change Contract):**

Los cambios a `pos_item_inventory_policy` son migraciones de nivel admin. Toman efecto al inicio de la siguiente sesión POS. Después de cualquier migración de clasificación, los operadores deben reiniciar todas las terminales activas. El servicio detecta y loguea reinicializaciones mid-sesión como señal de alerta operativa.

**Efectos por modo:**

| Modo | Antes del Paso 1 | Después del Paso 1 |
|------|------------------|--------------------|
| `recipe` (178) | A + B → doble deducción | Solo B → correcto |
| `unclassified` (300) | Según decisión §8 | Según decisión §8 |
| `direct_stock` (197) | Solo B (A no tocaba pos_market_stock) | Sin cambio |
| `non_inventory` (12) | A si hay receta (improbable) | Sin cambio |

### Paso 2 — Validación en AMALAY (smoke test)

1. Confirmar que `_policyMap` está caliente (log en consola al montar POS)
2. Procesar 3 órdenes con items `recipe` conocidos
3. Verificar que en `pos_inventory_movements` NO aparece `movement_type = 'deduction'` para esos items
4. Verificar que en `pos_reconciliation_results` aparece `RECONCILED` para esos items
5. Verificar stock antes/después — debe coincidir con una sola deducción (R1)
6. Simular fallo de red al montar el POS (DevTools → Network → offline): verificar que el payment no se bloquea (safe-fail activo)
7. Cancelar un item `recipe` — verificar comportamiento según `R1-REVERSAL-STRATEGY.md`

### Paso 3 — Retirement del Sistema A (horizonte futuro, post-smoke-test)

Una vez que R1 tenga reversal nativo y todos los items estén clasificados:
1. Eliminar `deductIngredientsForOrder()` del flujo de pago
2. Eliminar `reverseIngredientDeduction()` cuando R1 maneje orphan removal completamente
3. Marcar `pos_recipes_old` como deprecated en documentación

---

## 7. Estrategia de rollback

### Rollback del Paso 1

El cambio es un `continue` condicional dentro del loop de `deductIngredientsForOrder()`. Rollback = revertir ese `continue` y la llamada a `prefetchInventoryPolicyMap()`. El Sistema A vuelve a deducir para todos los items — idéntico al estado actual (doble deducción).

El rollback del Paso 1 no requiere cambios en base de datos.

**Implicación:** Si el Paso 0 ya fue ejecutado (datos corregidos) pero el Paso 1 necesita rollback, el inventario vuelve a acumular doble deducción sobre el stock ya corregido. La doble deducción es incremental — el Paso 0 se puede re-ejecutar con un nuevo `batch_id` para corregir las nuevas órdenes.

### No hay rollback del Paso 0 en sentido estricto

La Sección R del recovery draft incluye el mecanismo: eliminar los movimientos `adjustment` del batch y restar lo que se sumó al stock. Sin embargo, esto produce un estado idéntico al pre-recovery (con la doble deducción activa), no un estado "neutral". La Sección R existe para emergencias, no como path normal.

---

## 8. Decisión abierta: items `unclassified`

Los 300 items `unclassified` en `pos_item_inventory_policy` tienen un estado ambiguo:
- R1 los bloquea (`BLOCKED_UNCLASSIFIED`) — no deduce
- Sistema A los procesa si tienen receta en `pos_recipes_old`

Esto no es doble deducción (R1 no actúa sobre ellos), pero es un estado no declarado. Hay tres alternativas:

**Alternativa A — Mantener en legacy (comportamiento actual)**

El gate del Paso 1 solo excluye items con `inventory_mode = 'recipe'`. Los `unclassified` no cambian: Sistema A sigue deduciendo si encuentra receta en pos_recipes_old.

- Ventaja: cero cambio en comportamiento para esos 300 items.
- Riesgo: cuando se clasifiquen como `recipe` en el futuro, habrá un momento entre la clasificación y la creación de la versión en `pos_recipe_versions` donde el gate de A los excluirá pero R1 devolverá `BLOCKED_RECIPE_MISSING`. Resultado: ningún sistema deduce en esa ventana.
- Implica: la transición de cada item unclassified → recipe requiere su propio mini-cutover.

**Alternativa B — Bloquear completamente los `unclassified`**

El gate del Paso 1 excluye también `unclassified` (o cualquier modo conocido que no sea `null`/`undefined`):
```typescript
const mode = policyMap.get(item.menuItemId)
if (mode === 'recipe' || mode === 'unclassified' || mode === 'non_inventory') {
  continue
}
```

- Ventaja: `unclassified` se vuelve explícitamente "sin deducción" — ningún sistema actúa.
- Riesgo: 300 items dejarían de tener deducción de inventario inmediatamente. Si hay recetas en pos_recipes_old para esos items, el stock dejará de decrementarse hasta que sean clasificados en R1.
- Implica: clasificar los 300 items antes o inmediatamente después del Paso 1.

**Alternativa C — Clasificar primero, luego implementar el gate**

Antes del Paso 1, completar la clasificación de los 300 items `unclassified` en `pos_item_inventory_policy`:
- Los que tienen recetas en `pos_recipe_versions` → `recipe`
- Los que son productos físicos sin receta → `direct_stock`
- Los que no tienen impacto de inventario → `non_inventory`

Una vez clasificados, el gate de A solo necesita excluir `recipe` (Alternativa A), porque los demás casos ya están correctamente manejados por R1.

- Ventaja: elimina el caso especial de unclassified. El sistema queda sin estados ambiguos.
- Costo: requiere trabajo de clasificación antes del Paso 1.
- Esta es la arquitectura más limpia a largo plazo.

**Decisión requerida:** Elegir A, B o C antes de implementar el Paso 1. La elección cambia el código del gate y la secuencia de pasos.

---

## 9. Validaciones posteriores al Paso 1

| Check | Método | Criterio de éxito |
|-------|--------|-------------------|
| Cero doble deducción | Query cruzada: `pos_inventory_movements` tipo `deduction` × `pos_reconciliation_results` RECONCILED por order_id | 0 order_ids con ambos tipos en órdenes post-Paso 1 |
| Caché caliente al montar | Log `[inventory-policy] map loaded: N items` en consola del POS | N = 687 (total de pos_item_inventory_policy) |
| Safe-fail funciona | Simular offline al montar → pagar orden → verificar payment completa | Payment sin errores, sin gate (Sistema A corre para todo) |
| Stock correcto | Conteo físico de 5 ingredientes críticos vs `pos_inventory.stock` | Discrepancia ≤ error de medición manual |
| Offline completo | Tomar orden offline, pagar, reconectar, verificar movimientos | Una sola entrada en `pos_inventory_movements` (recipe_deduction, no deduction) |
| Invariante I-6 | Query de consistencia de applied_consumption | 0 filas con discrepancia |

---

## 10. Registro del hallazgo como bug P0

**Bug ID:** INV-P0-2026-07-25  
**Título:** Doble deducción de inventario — Sistema A y R1 activos sobre mismos items  
**Descubierto:** Auditoría C8 de QA-REPORT.md, 2026-07-25  
**Impacto:** `pos_inventory.stock` subcontado para los 178 items recipe desde el 2026-07-14. Volumen exacto determinado por R1-DIAGNOSTIC-READONLY.sql §9.

---

## 11. Criterios de cierre del P0 (INV-P0-2026-07-25)

El incidente se considera **cerrado** únicamente cuando se cumplen TODOS los siguientes criterios. Cada uno requiere evidencia verificable, no estimación.

**C1 — Recovery ejecutado y auditado**
- R1-DIAGNOSTIC-READONLY.sql §9 muestra 0 nuevos casos confirmados post-Paso 1
- `pos_inventory_recovery_snapshot` tiene `compensation_movement_id IS NOT NULL` para todos los rows del batch aprobado
- Daniel revisó y aprobó el output de Sección V del recovery

**C2 — Cero doble deducciones nuevas durante 7 días consecutivos**
- Query diaria: `SELECT COUNT(*) FROM pos_inventory_movements a JOIN pos_reconciliation_results b ON a.order_id = b.order_id WHERE a.movement_type = 'deduction' AND b.result = 'RECONCILED' AND a.created_at > [fecha_paso_1]`
- Debe retornar 0 durante 7 días sin excepción

**C3 — Smoke test completo en AMALAY**
- Los 7 pasos del Paso 2 ejecutados y documentados
- Safe-fail verificado explícitamente (fallo de red simulado)
- Cancelación de item verificada

**C4 — Inventario físico reconciliado**
- Conteo físico de al menos 10 ingredientes de alta rotación (a definir por Daniel/Eduardo)
- Discrepancia entre conteo físico y `pos_inventory.stock` ≤ 5% para cada ingrediente
- Si algún ingrediente muestra discrepancia > 5%, abrir ticket separado (no bloquea el cierre del P0)

**C5 — Monitoreo limpio**
- No hay alertas de tipo `[deduct:r1-owned]` seguidas de un movimiento `deduction` para el mismo item (indicaría que el gate no funcionó)
- `pos_reconciliation_results` no muestra aumento en `BLOCKED_RECIPE_MISSING` post-Paso 1 (indicaría clasificación rota)

**C6 — Decisión de reversals documentada**
- `R1-REVERSAL-STRATEGY.md` tiene decisión tomada por Daniel para cada escenario
- O bien: el comportamiento actual (Sistema A) está explícitamente aceptado como transitorio con fecha de revisión

**C7 — Decisión de items `unclassified` documentada**
- Alternativa A, B o C seleccionada en §8 de este documento
- Si B o C: clasificación completada o cronograma definido

**C8 — Partición de 48 horas post-deploy**

Ejecutar exactamente una vez, 48h después del deploy. Reemplazar `C8_DEPLOY_DATE` con el timestamp UTC del deploy (ej. `'2026-07-26 18:00:00+00'`).

**Criterio:** La columna `clasificacion` no debe contener ninguna fila `gate_fallido_o_doble`.

```sql
-- C8: clasificación de órdenes cerradas en la ventana post-deploy
WITH r1_orders AS (
  SELECT DISTINCT order_id
  FROM pos_reconciliation_results
  WHERE client_id = 'amalay'
    AND created_at >= 'C8_DEPLOY_DATE'
),
sistema_a_orders AS (
  SELECT DISTINCT order_id
  FROM pos_inventory_movements
  WHERE client_id = 'amalay'
    AND movement_type = 'deduction'
    AND actor != 'r1_reconciler'
    AND created_at >= 'C8_DEPLOY_DATE'
)
SELECT
  clasificacion,
  COUNT(*) AS n
FROM (
  SELECT
    o.id,
    CASE
      WHEN r.order_id IS NOT NULL AND a.order_id IS NULL THEN 'solo_r1'
      WHEN r.order_id IS NOT NULL AND a.order_id IS NOT NULL THEN 'gate_fallido_o_doble'
      WHEN r.order_id IS NULL AND a.order_id IS NOT NULL THEN 'solo_sistema_a'
      ELSE 'sin_movimientos'
    END AS clasificacion
  FROM pos_orders o
  LEFT JOIN r1_orders r ON r.order_id = o.id
  LEFT JOIN sistema_a_orders a ON a.order_id = o.id
  WHERE o.client_id = 'amalay'
    AND o.status = 'cerrada'
    AND o.closed_at >= 'C8_DEPLOY_DATE'
) t
GROUP BY clasificacion
ORDER BY n DESC;
-- PASS: 'solo_r1' n>0, sin filas 'gate_fallido_o_doble'
-- FAIL: cualquier fila 'gate_fallido_o_doble' → el gate no funcionó → investigar
```

Para ver el detalle de órdenes problemáticas (si las hay):
```sql
WITH r1_orders AS (
  SELECT DISTINCT order_id FROM pos_reconciliation_results
  WHERE client_id = 'amalay' AND created_at >= 'C8_DEPLOY_DATE'
),
sistema_a_orders AS (
  SELECT DISTINCT order_id FROM pos_inventory_movements
  WHERE client_id = 'amalay' AND movement_type = 'deduction'
    AND actor != 'r1_reconciler' AND created_at >= 'C8_DEPLOY_DATE'
)
SELECT o.id, o.closed_at, o.mesero
FROM pos_orders o
JOIN r1_orders r ON r.order_id = o.id
JOIN sistema_a_orders a ON a.order_id = o.id
WHERE o.client_id = 'amalay'
  AND o.status = 'cerrada' AND o.closed_at >= 'C8_DEPLOY_DATE'
ORDER BY o.closed_at DESC;
-- Filas aquí = P0 no resuelto → NO proceder a C9/C10
```

**C9 — Cero `policy_gate_failure` en ventana de 48h**

Un evento `policy_gate_failure` significa que el POS arrancó sin política cargada y la LKG cache tampoco estaba disponible. Sistema A no corrió (correcto), pero es un evento operativo a documentar.

**Criterio:** `gate_failures_48h = 0`. Si hay eventos, las órdenes afectadas NO tienen doble deducción (el gate funcionó), pero documentar la causa y revisar cobertura de LKG.

```sql
-- C9: conteo de fallos de gate en ventana post-deploy
SELECT
  COUNT(*)                      AS gate_failures_48h,
  jsonb_agg(DISTINCT order_id)  AS affected_orders
FROM pos_inventory_movements
WHERE client_id = 'amalay'
  AND movement_type = 'policy_gate_failure'
  AND created_at >= 'C8_DEPLOY_DATE';
-- PASS: gate_failures_48h = 0
-- WARN: si > 0, revisar causa (arranque sin red, TTL expirado) y documentar
```

**C10 — Aprobación explícita de cierre**
- Daniel emite la aprobación explícita de cierre del incidente en esta sesión o la siguiente
- El estado del documento se actualiza a: `Estado: CERRADO — fecha`

---

*Versión 4 — actualizado 2026-07-26 post-implementación gate fail-restrictive.*  
*Cambios v4: C8 corregido a query 48h (partición solo_r1/gate_fallido_o_doble), C9 añadido (policy_gate_failure), C10 = aprobación de cierre (renumerado desde C8 v3). Ver R1-REVERSAL-STRATEGY.md para estrategia de reversals.*

---

## Bugs relacionados (no mezclar con este P0)

### B1 — Parejo split: posible deducción múltiple por R1

En split parejo, cada cuenta genera un `payId` distinto (`${orderId}-C1`, `${orderId}-C2`, ...). `save-order` se llama una vez por cuenta. Si `pos_orders` contiene los mismos items para todas las cuentas, `r1_reconcile_order` podría deducir los mismos ingredientes N veces (una por cuenta), ya que cada `order_id` genera un row independiente en `pos_reconciliation_results`.

Sistema A lo evita hoy con el guard `splitPayingCuenta === 1`. R1 no tiene guard equivalente visible en TypeScript.

**Status:** Separado del P0. No investigar ni mezclar con el cutover actual. Abrir ticket independiente cuando el P0 esté cerrado.
