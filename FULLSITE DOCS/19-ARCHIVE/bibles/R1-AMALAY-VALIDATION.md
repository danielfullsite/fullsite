# R1-AMALAY-VALIDATION — Runbook de validación operativa

**Propósito:** Confirmar en AMALAY que el comportamiento real del sistema coincide con el modelo documentado en R1-INVENTORY-CUTOVER.md, antes y después de implementar el Paso 1.

**No implementa nada.** No cambia código. No modifica ramas. Si cualquier resultado difiere del esperado, se detiene la prueba y se documenta como incidente separado.

**Clave de notación:**
- `[PRE]` — aplica al estado actual (sin Paso 1)
- `[POST]` — aplica después de deploying el Paso 1
- `{ORDER_ID}` — sustituir con el UUID real de la orden bajo prueba
- `{MENU_ITEM_ID}` — sustituir con el ID del ítem de menú seleccionado
- `{ITEM_ID}` — sustituir con el UUID del ítem dentro de `pos_orders.items`
- `{INGREDIENT_ID}` — sustituir con el ID del ingrediente a verificar

---

## 1. Prerrequisitos

### 1.1 Estado esperado en base de datos

Ejecutar antes de cualquier prueba. Resultado debe coincidir con los valores indicados.

```sql
-- P-01: Verificar autoridad de AMALAY
SELECT client_id, sale_authority, cutover_at, cutover_by
FROM pos_mutation_authority
WHERE client_id = 'amalay';
-- Esperado: sale_authority = 'r1', cutover_at = '2026-07-14T06:55:21+00:00'
```

```sql
-- P-02: Conteo de modos de inventario
SELECT inventory_mode, COUNT(*) AS total
FROM pos_item_inventory_policy
WHERE client_id = 'amalay'
GROUP BY inventory_mode
ORDER BY total DESC;
-- Esperado: recipe=178, direct_stock=197, unclassified=300, non_inventory=12
-- Si los números difieren: documentar y NO proceder hasta aclarar.
```

```sql
-- P-03: Seleccionar ítem recipe para pruebas
-- Ejecutar este query para elegir el ítem de prueba. Anotar menu_item_id, recipe_version_id.
SELECT
  pip.menu_item_id,
  rv.id         AS recipe_version_id,
  COUNT(rl.id)  AS ingredient_count,
  STRING_AGG(rl.ingredient_id || ':' || rl.quantity::text || rl.recipe_unit, ', ') AS ingredientes
FROM pos_item_inventory_policy pip
JOIN pos_recipe_versions rv
  ON rv.menu_item_id = pip.menu_item_id AND rv.client_id = pip.client_id AND rv.active = true
JOIN pos_recipe_lines rl ON rl.recipe_version_id = rv.id AND rl.client_id = pip.client_id
WHERE pip.client_id = 'amalay' AND pip.inventory_mode = 'recipe'
GROUP BY pip.menu_item_id, rv.id
ORDER BY ingredient_count DESC
LIMIT 5;
-- Anotar en la hoja de resultados: MENU_ITEM_ID y los ingredientes que serán afectados.
```

```sql
-- P-04: Seleccionar ítem direct_stock para prueba TC-12
SELECT pip.menu_item_id, pip.market_stock_id, ms.stock, ms.stock_unit
FROM pos_item_inventory_policy pip
JOIN pos_market_stock ms ON ms.id = pip.market_stock_id AND ms.client_id = pip.client_id
WHERE pip.client_id = 'amalay' AND pip.inventory_mode = 'direct_stock'
ORDER BY ms.stock DESC
LIMIT 5;
```

```sql
-- P-05: Seleccionar ítem unclassified para prueba TC-13
SELECT pip.menu_item_id
FROM pos_item_inventory_policy pip
WHERE pip.client_id = 'amalay' AND pip.inventory_mode = 'unclassified'
LIMIT 5;
```

```sql
-- P-06: Snapshot de stock inicial — ejecutar antes de cada TC recipe
-- Sustituir {MENU_ITEM_ID} con el ID elegido en P-03.
SELECT inv.ingredient_id, inv.stock, inv.stock_unit, inv.updated_at
FROM pos_inventory inv
WHERE inv.client_id = 'amalay'
  AND inv.ingredient_id IN (
    SELECT rl.ingredient_id
    FROM pos_recipe_versions rv
    JOIN pos_recipe_lines rl ON rl.recipe_version_id = rv.id
    WHERE rv.client_id = 'amalay'
      AND rv.menu_item_id = '{MENU_ITEM_ID}'
      AND rv.active = true
  );
-- Guardar estos valores. Serán el baseline de comparación de cada prueba.
```

### 1.2 Rama y build

`[PRE]` No hay Paso 1 en producción. La rama debe ser la rama de producción actual, sin cambios.

`[POST]` La rama debe contener el Paso 1 aprobado por Daniel. Verificar que el deployment de Vercel completó antes de iniciar pruebas.

```bash
# Verificar build activo (ejecutar en terminal del proyecto)
vercel ls --prod
# Confirmar que el deployment corresponde al commit de Paso 1
```

### 1.3 Scripts previos

Antes de ejecutar cualquier TC, correr la Sección 0 de R1-DIAGNOSTIC-READONLY.sql para confirmar que los parámetros de cutover son correctos.

```sql
-- Equivalente a Sección 0 del diagnóstico:
SELECT
  client_id,
  sale_authority,
  cutover_at AT TIME ZONE 'America/Monterrey' AS cutover_local,
  cutover_by
FROM pos_mutation_authority
WHERE client_id = 'amalay';
```

### 1.4 Verificar InventoryPolicyService [POST únicamente]

El InventoryPolicyService aún no existe. Esta sección aplica solamente después de deploying Paso 1.

**Verificación en browser (DevTools → Console):**

Al abrir el POS, el log debe mostrar:
```
[inventory-policy] loading for client amalay...
[inventory-policy] map loaded: 687 items, state → READY
```

Si aparece en su lugar:
```
[inventory-policy] state → FAILED, using stale map (0 items)
```
→ Detener prueba. Reportar estado de red. No proceder hasta alcanzar READY.

Si el log no aparece: el servicio no está en el build. Detener prueba.

### 1.5 Confirmar gate activo [POST únicamente]

Al cobrar cualquier ítem recipe, el console debe mostrar:
```
[deduct:r1-owned] "{NOMBRE_ITEM}" ({MENU_ITEM_ID}) — R1 handles this item
```

Si en cambio aparece:
```
[inventory] Deducted N ingredients for 1 items at payment
```
→ El gate no está activo. Detener prueba. Revisar el build.

---

## 2. Setup de referencia — Identificar la orden activa

Después de crear una orden en el POS (antes de enviar a cocina), ejecutar:

```sql
-- SETUP-01: Encontrar la orden más reciente de la mesa de prueba
-- Sustituir {MESA} con el número de mesa usado.
SELECT id, mesa, mesero, status, order_revision, created_at
FROM pos_orders
WHERE client_id = 'amalay'
  AND mesa = '{MESA}'
  AND status IN ('abierta', 'enviada', 'preparando')
ORDER BY created_at DESC
LIMIT 3;
-- Anotar el ORDER_ID de la fila más reciente.
```

---

## 3. Casos de prueba

### TC-01 — Crear orden con ítem recipe, sin enviar a cocina

**Objetivo:** Confirmar que agregar un ítem al POS no dispara ningún movimiento de inventario.

**Pasos en el POS:**
1. Abrir terminal en la mesa de prueba.
2. Seleccionar el ítem recipe elegido en P-03. Agregar 1 unidad.
3. NO tocar "Enviar a Cocina". Esperar 5 segundos.

**SQL a ejecutar:**
```sql
-- TC-01-Q1: Verificar que no hay orden en DB todavía (o que no tiene reconciliación)
SELECT id, status, order_revision, last_inventory_processed_revision
FROM pos_orders
WHERE client_id = 'amalay'
  AND mesa = '{MESA}'
  AND created_at > NOW() - INTERVAL '10 minutes'
ORDER BY created_at DESC
LIMIT 1;
-- Si no hay fila: correcto, la orden aún no fue a DB.
-- Si hay fila: anotar order_revision y last_inventory_processed_revision.
```

```sql
-- TC-01-Q2: Confirmar que no hay movimientos de inventario
SELECT COUNT(*) AS movimientos
FROM pos_inventory_movements
WHERE client_id = 'amalay'
  AND created_at > NOW() - INTERVAL '10 minutes'
  AND movement_type IN ('deduction', 'recipe_deduction');
-- Esperado: 0
```

**Resultado esperado [PRE y POST]:** Sin movimientos de inventario. `last_inventory_processed_revision = NULL` si la orden no fue enviada a DB.

**Si difiere:** La orden llegó a DB antes de lo esperado. Anotar y continuar a TC-02 de inmediato.

---

### TC-02 — Enviar a cocina (primer save-order)

**Objetivo:** Confirmar que R1 ejecuta la primera deducción al enviar a cocina.

**Pasos en el POS:**
1. Continuar desde TC-01 con el ítem recipe en la orden.
2. Presionar "Enviar a Cocina".
3. Esperar confirmación visual ("X items enviados").
4. Esperar 3 segundos y ejecutar SQL.

**SQL a ejecutar:**
```sql
-- TC-02-Q1: Verificar que la orden quedó en DB con revisión 1
SELECT id, status, order_revision, last_inventory_processed_revision, last_inventory_complete_revision
FROM pos_orders
WHERE client_id = 'amalay'
  AND mesa = '{MESA}'
  AND created_at > NOW() - INTERVAL '10 minutes'
ORDER BY created_at DESC LIMIT 1;
-- Esperado: order_revision=1, last_inventory_processed_revision=1, last_inventory_complete_revision=1
```

```sql
-- TC-02-Q2: Verificar reconciliación
SELECT order_item_id, menu_item_id, cantidad, applied_consumption, pinned_mode, result, last_mutation_revision
FROM pos_reconciliation_results
WHERE client_id = 'amalay'
  AND order_id = '{ORDER_ID}';
-- Esperado:
--   result = 'RECONCILED'
--   applied_consumption = cantidad (ej. 1 si se pidió 1 unidad)
--   pinned_mode = 'recipe'
--   last_mutation_revision = 1
```

```sql
-- TC-02-Q3: Verificar movimientos de R1
SELECT m.ingredient_id, m.movement_type, m.quantity, m.actor, m.mutation_revision, m.created_at
FROM pos_inventory_movements m
JOIN pos_reconciliation_results rr ON rr.id = m.reconciliation_result_id
WHERE rr.client_id = 'amalay'
  AND rr.order_id = '{ORDER_ID}';
-- Esperado:
--   1 fila por ingrediente de la receta
--   movement_type = 'recipe_deduction'
--   quantity = -(cantidad * dosis_ingrediente) — valor negativo
--   actor = 'r1_reconciler'
--   mutation_revision = 1
```

```sql
-- TC-02-Q4: Comparar stock post-kitchen con baseline de P-06
SELECT inv.ingredient_id, inv.stock, inv.stock_unit
FROM pos_inventory inv
WHERE inv.client_id = 'amalay'
  AND inv.ingredient_id IN (
    SELECT rl.ingredient_id FROM pos_recipe_lines rl
    JOIN pos_recipe_versions rv ON rv.id = rl.recipe_version_id
    WHERE rv.client_id = 'amalay' AND rv.menu_item_id = '{MENU_ITEM_ID}' AND rv.active = true
  );
-- Calcular: stock_actual = stock_baseline + quantity (de TC-02-Q3)
-- El stock debe haber disminuido exactamente en los valores de TC-02-Q3.
```

**Resultado esperado [PRE y POST]:** Idéntico. R1 siempre corre al save-order de kitchen send. Un movimiento `recipe_deduction` por ingrediente. `applied_consumption = cantidad`.

---

### TC-03 — Guardar varias veces sin modificar la orden

**Objetivo:** Confirmar que R1 no genera movimientos adicionales en save-orders repetidos con misma cantidad.

**Pasos en el POS:**
1. Continuar desde TC-02 (orden enviada a cocina).
2. Sin modificar nada, presionar "Enviar a Cocina" 3 veces más (o editar un campo no-inventario como notas y guardar).
3. Esperar 3 segundos después del último envío.

**SQL a ejecutar:**
```sql
-- TC-03-Q1: Contar movimientos totales de R1 para esta orden
SELECT m.movement_type, COUNT(*) AS total, SUM(ABS(m.quantity)) AS total_qty
FROM pos_inventory_movements m
JOIN pos_reconciliation_results rr ON rr.id = m.reconciliation_result_id
WHERE rr.client_id = 'amalay'
  AND rr.order_id = '{ORDER_ID}'
  AND m.movement_type = 'recipe_deduction'
GROUP BY m.movement_type;
-- Esperado: mismo resultado que TC-02-Q3. El COUNT no debe haber crecido.
-- Si count creció: R1 ejecutó mutaciones adicionales → investigar applied_consumption
```

```sql
-- TC-03-Q2: Verificar que applied_consumption no cambió
SELECT applied_consumption, last_mutation_revision, updated_at
FROM pos_reconciliation_results
WHERE client_id = 'amalay' AND order_id = '{ORDER_ID}';
-- Esperado: applied_consumption = cantidad (sin cambio vs TC-02-Q2)
-- last_mutation_revision = 1 (sin incremento)
```

**Resultado esperado [PRE y POST]:** Cero nuevos movimientos. `applied_consumption` estable. `last_mutation_revision` sin cambio. Idempotencia de R1 confirmada.

---

### TC-04 — Cobrar (payment)

**Objetivo:** Confirmar el comportamiento actual de doble deducción [PRE] y su ausencia [POST].

**Pasos en el POS:**
1. Continuar desde TC-02 o TC-03 (orden enviada a cocina, no cobrada).
2. Presionar "Cobrar", seleccionar método (Efectivo), confirmar pago.
3. Esperar 5 segundos.

**SQL a ejecutar:**
```sql
-- TC-04-Q1: Movimientos totales para esta orden, todos los tipos
SELECT
  COALESCE(m.order_id, rr.order_id)  AS source_order_id,
  m.movement_type,
  m.ingredient_id,
  m.quantity,
  m.actor,
  m.notes,
  m.created_at
FROM pos_inventory_movements m
LEFT JOIN pos_reconciliation_results rr ON rr.id = m.reconciliation_result_id
WHERE m.client_id = 'amalay'
  AND (m.order_id = '{ORDER_ID}' OR rr.order_id = '{ORDER_ID}')
ORDER BY m.created_at ASC;
-- [PRE] Esperado: VER DOS BLOQUES
--   Bloque 1: recipe_deduction (actor=r1_reconciler) — kitchen send
--   Bloque 2: deduction (actor=mesero) — pago con Sistema A
-- [POST] Esperado: VER UN SOLO BLOQUE
--   Solo recipe_deduction (actor=r1_reconciler) — kitchen send
--   NO debe aparecer movimiento de type='deduction' para items recipe
```

```sql
-- TC-04-Q2: Detectar doble deducción por ingrediente
SELECT
  COALESCE(a.ingredient_id, b.ingredient_id) AS ingredient_id,
  a.qty_sistema_a,
  b.qty_r1,
  CASE
    WHEN a.ingredient_id IS NOT NULL AND b.ingredient_id IS NOT NULL THEN 'DOBLE_DEDUCCION'
    WHEN a.ingredient_id IS NOT NULL THEN 'SOLO_SISTEMA_A'
    ELSE 'SOLO_R1'
  END AS diagnostico
FROM (
  SELECT ingredient_id, SUM(ABS(quantity)) AS qty_sistema_a
  FROM pos_inventory_movements
  WHERE client_id = 'amalay'
    AND order_id = '{ORDER_ID}'
    AND movement_type = 'deduction'
  GROUP BY ingredient_id
) a
FULL OUTER JOIN (
  SELECT m.ingredient_id, SUM(ABS(m.quantity)) AS qty_r1
  FROM pos_inventory_movements m
  JOIN pos_reconciliation_results rr ON rr.id = m.reconciliation_result_id
  WHERE m.client_id = 'amalay'
    AND rr.order_id = '{ORDER_ID}'
    AND m.movement_type = 'recipe_deduction'
  GROUP BY m.ingredient_id
) b ON a.ingredient_id = b.ingredient_id
ORDER BY diagnostico, ingredient_id;
-- [PRE] Esperado: filas con diagnostico = 'DOBLE_DEDUCCION' — confirma el P0
-- [POST] Esperado: solo filas con diagnostico = 'SOLO_R1' — gate funcionó
```

```sql
-- TC-04-Q3: Verificar applied_consumption post-pago (R1 no debe haber re-deducido)
SELECT applied_consumption, last_mutation_revision, result, updated_at
FROM pos_reconciliation_results
WHERE client_id = 'amalay' AND order_id = '{ORDER_ID}';
-- Esperado [PRE y POST]: applied_consumption = cantidad (sin cambio vs TC-02-Q2)
-- El payment save-order no incrementa applied_consumption porque v_delta=0
```

**Resultado esperado:**
- `[PRE]` Se confirma doble deducción: `diagnostico = 'DOBLE_DEDUCCION'` para los ingredientes recipe.
- `[POST]` Solo `SOLO_R1`. No aparece `'deduction'` con `actor = mesero` para ítems recipe.

---

### TC-05 — Simular doble cobro (idempotencia de save-order)

**Objetivo:** Confirmar que un payment save-order repetido no produce movimientos adicionales.

**Pasos:**
1. Después de cobrar (TC-04), llamar directamente al endpoint con el mismo `save_operation_id`.

```bash
# Ejecutar desde terminal — sustituir valores
curl -X POST https://{TU-DOMINIO}/api/pos/save-order \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {SUPABASE_ANON_KEY}" \
  -d '{
    "order_id": "{ORDER_ID}",
    "expected_revision": 0,
    "save_operation_id": "{MISMO_OP_ID_DEL_PAGO}",
    "status": "cerrada"
  }'
# El save_operation_id debe ser el mismo que usó el POS en el pago original.
# Obtenerlo de los logs del browser: buscar "opId" en la solicitud al network.
```

**SQL a ejecutar:**
```sql
-- TC-05-Q1: Verificar que el count de movimientos no creció
SELECT movement_type, COUNT(*) AS total
FROM pos_inventory_movements m
LEFT JOIN pos_reconciliation_results rr ON rr.id = m.reconciliation_result_id
WHERE m.client_id = 'amalay'
  AND (m.order_id = '{ORDER_ID}' OR rr.order_id = '{ORDER_ID}')
GROUP BY movement_type;
-- Esperado: mismo resultado que TC-04-Q1. Ningún count debe haber crecido.
```

**Resultado esperado [PRE y POST]:** `idempotent_replay = true` en la respuesta JSON. Cero movimientos nuevos. Stock sin cambio.

---

### TC-06 — Cancelar antes de enviar a cocina

**Objetivo:** Confirmar que cancelar un ítem no enviado produce cero movimientos de inventario.

**Pasos en el POS:**
1. Abrir una nueva orden en la mesa de prueba.
2. Agregar el ítem recipe elegido.
3. Presionar el botón de cancelar del ítem.
4. En el modal: seleccionar motivo, ingresar PIN de gerente.
5. En la pantalla de "¿fue enviado a cocina?": presionar **"No fue enviado a cocina"** (prepared=false, voided=false).
6. Confirmar cancelación.

**SQL a ejecutar:**
```sql
-- TC-06-Q1: Buscar movimientos generados en los últimos 2 minutos
SELECT movement_type, ingredient_id, quantity, actor, notes, created_at
FROM pos_inventory_movements
WHERE client_id = 'amalay'
  AND created_at > NOW() - INTERVAL '2 minutes'
  AND movement_type IN ('deduction', 'recipe_deduction', 'adjustment');
-- Esperado: 0 filas (ningún movimiento de inventario)
```

**Resultado esperado [PRE y POST]:** Cero movimientos. La cancelación pre-cocina no tiene impacto en inventario. El PATCH a pos_orders actualiza el ítem como cancelled=true pero no pasa por save-order → R1 no corre.

---

### TC-07 — Cancelar después de enviar a cocina (antes del pago)

**Objetivo:** Documentar el comportamiento actual del reversal de Sistema A post-cocina.

**Pasos en el POS:**
1. Abrir nueva orden. Agregar ítem recipe. Enviar a cocina.
2. Esperar confirmación de kitchen send.
3. Presionar cancelar en el mismo ítem.
4. Seleccionar motivo, ingresar PIN gerente.
5. En "¿fue enviado a cocina?": presionar **"Sí fue enviado a cocina"** (prepared=true, voided=false).
6. Confirmar cancelación.
7. Esperar 5 segundos.

**SQL a ejecutar:**
```sql
-- TC-07-Q1: Movimientos antes y después del cancel
-- Ejecutar este query para ver la secuencia temporal completa
SELECT
  COALESCE(m.order_id, rr.order_id) AS fuente_order_id,
  m.movement_type,
  m.ingredient_id,
  m.quantity,
  m.actor,
  m.notes,
  m.created_at
FROM pos_inventory_movements m
LEFT JOIN pos_reconciliation_results rr ON rr.id = m.reconciliation_result_id
WHERE m.client_id = 'amalay'
  AND (
    m.order_id = '{ORDER_ID}'
    OR rr.order_id = '{ORDER_ID}'
  )
ORDER BY m.created_at ASC;
-- Esperado [PRE y POST]:
--   Fila 1: recipe_deduction (actor=r1_reconciler) — kitchen send
--   Fila 2: adjustment      (actor={nombre_gerente}, notes LIKE 'Cancelacion:%') — Sistema A reversal
-- La cantidad de la fila 2 debe ser POSITIVA (suma stock)
-- La cantidad de la fila 1 debe ser NEGATIVA (resta stock)
```

```sql
-- TC-07-Q2: Verificar que applied_consumption NO cambió (R1 no corrió al cancelar)
SELECT applied_consumption, last_mutation_revision, result, updated_at
FROM pos_reconciliation_results
WHERE client_id = 'amalay' AND order_id = '{ORDER_ID}';
-- Esperado: applied_consumption = cantidad (sin cambio vs TC-02-Q2)
-- R1 no fue invocado por el cancel (PATCH directo, no save-order)
```

```sql
-- TC-07-Q3: Balance neto de inventario para el ingrediente principal
-- Sustituir {INGREDIENT_ID} con el ingrediente de mayor dosis de la receta.
SELECT
  stock_baseline.stock AS stock_pre_prueba,  -- de P-06
  inv.stock             AS stock_actual,
  inv.stock - stock_baseline.stock AS diferencia
FROM pos_inventory inv
CROSS JOIN (SELECT {STOCK_BASELINE_VALUE}::numeric AS stock) AS stock_baseline
WHERE inv.client_id = 'amalay'
  AND inv.ingredient_id = '{INGREDIENT_ID}';
-- [PRE y POST] Si las cantidades de pos_recipes_old y pos_recipe_lines coinciden:
--   diferencia ≈ 0 (R1 dedujo, Sistema A devolvió el mismo monto)
-- Si difieren:
--   diferencia ≠ 0 → desincronía entre tablas de recetas. DOCUMENTAR COMO INCIDENTE.
```

**Resultado esperado [PRE y POST]:** Dos movimientos: `recipe_deduction` (R1, kitchen) y `adjustment` (Sistema A, cancel). `applied_consumption` sin cambio. Documentar si las cantidades de los dos movimientos no son simétricas.

---

### TC-08 — Void completo de la orden

**Objetivo:** Confirmar que void de la orden activa el orphan removal de R1 (desired=0 para todos los ítems).

**Pasos en el POS:**
1. Abrir nueva orden. Agregar 2 ítems recipe diferentes. Enviar a cocina.
2. Esperar confirmación.
3. Abrir menú de void (anular orden completa).
4. Seleccionar motivo, ingresar PIN gerente.
5. Confirmar void.
6. Esperar 5 segundos.

**SQL a ejecutar:**
```sql
-- TC-08-Q1: Verificar que la orden quedó con status 'cancelada'
SELECT id, status, order_revision
FROM pos_orders
WHERE id = '{ORDER_ID}' AND client_id = 'amalay';
-- Esperado: status = 'cancelada'
```

```sql
-- TC-08-Q2: Secuencia temporal de movimientos
SELECT
  COALESCE(m.order_id, rr.order_id) AS fuente_order_id,
  m.movement_type,
  m.ingredient_id,
  m.quantity,
  m.actor,
  m.mutation_revision,
  m.created_at
FROM pos_inventory_movements m
LEFT JOIN pos_reconciliation_results rr ON rr.id = m.reconciliation_result_id
WHERE m.client_id = 'amalay'
  AND (m.order_id = '{ORDER_ID}' OR rr.order_id = '{ORDER_ID}')
ORDER BY m.created_at ASC, m.ingredient_id ASC;
-- Esperado:
--   Bloque 1 (kitchen send): recipe_deduction por cada ingrediente de ítem 1 + ítem 2
--   Bloque 2 (void R1):      recipe_reversal por cada ingrediente (orphan removal, desired=0)
--   Bloque 3 (void Sistema A): adjustment (actor=gerente, notes LIKE 'Cancelacion:%')
-- [PRE] Los bloques 2 y 3 existen: doble reversal para ítems que tienen receta en pos_recipes_old
-- [POST] Si gate excluye ítems recipe de Sistema A: solo bloque 2 (R1 reversal)
```

```sql
-- TC-08-Q3: Verificar que applied_consumption volvió a 0 (orphan removal R1)
SELECT order_item_id, applied_consumption, result, last_mutation_revision
FROM pos_reconciliation_results
WHERE client_id = 'amalay' AND order_id = '{ORDER_ID}';
-- Esperado: applied_consumption = 0 para todos los ítems (R1 ejecutó delta negativo = 0 - original)
-- result = 'RECONCILED'
```

```sql
-- TC-08-Q4: Stock neto post-void
SELECT inv.ingredient_id, inv.stock, inv.stock_unit
FROM pos_inventory inv
WHERE inv.client_id = 'amalay'
  AND inv.ingredient_id IN (
    SELECT rl.ingredient_id FROM pos_recipe_lines rl
    JOIN pos_recipe_versions rv ON rv.id = rl.recipe_version_id
    WHERE rv.client_id = 'amalay' AND rv.menu_item_id = '{MENU_ITEM_ID}' AND rv.active = true
  );
-- Calcular: stock_actual debería ≈ stock_baseline (de P-06)
-- Si hay discrepancia: cuantificar. Documentar si > 0.01 unidades.
```

**Resultado esperado [PRE]:** recipe_deduction + recipe_reversal (R1) + adjustment (Sistema A). Posible doble reversal. `applied_consumption = 0`.

**Resultado esperado [POST]:** recipe_deduction + recipe_reversal (R1 únicamente). `applied_consumption = 0`. Stock vuelve a baseline.

---

### TC-09 — Orden offline → sincronización

**Objetivo:** Confirmar doble deducción en órdenes offline [PRE] y comportamiento post-gate [POST].

**Pasos:**
1. Abrir el POS en modo Electron (o browser).
2. Desconectar la red (DevTools → Network → Offline, o desconectar cable).
3. Crear orden con ítem recipe, enviar a cocina (queda en offline queue).
4. Cobrar la orden (Sistema A corre localmente al cobrar — offline).
5. Anotar el ORDER_ID del log de consola o del localStorage.
6. Reconectar la red.
7. Esperar que el offline sync complete (log: "Sync complete" o similares).
8. Esperar 5 segundos adicionales.

**SQL a ejecutar:**
```sql
-- TC-09-Q1: Verificar timestamps de los movimientos — clave para confirmar offline
SELECT
  COALESCE(m.order_id, rr.order_id)  AS fuente_order_id,
  m.movement_type,
  m.ingredient_id,
  m.quantity,
  m.actor,
  m.created_at,
  m.created_at AT TIME ZONE 'America/Monterrey' AS created_monterrey
FROM pos_inventory_movements m
LEFT JOIN pos_reconciliation_results rr ON rr.id = m.reconciliation_result_id
WHERE m.client_id = 'amalay'
  AND (m.order_id = '{ORDER_ID}' OR rr.order_id = '{ORDER_ID}')
ORDER BY m.created_at ASC;
-- [PRE] Esperado:
--   Fila 1: deduction (actor=mesero, timestamp ≈ hora del cobro offline)
--   Fila 2: recipe_deduction (actor=r1_reconciler, timestamp ≈ hora del sync online)
--   GAP temporal entre filas confirma: Sistema A antes del sync, R1 después del sync
-- [POST] Si gate excluye recipe items en Sistema A:
--   Solo Fila 2: recipe_deduction (R1) en el momento del sync
```

```sql
-- TC-09-Q2: Verificar doble deducción (mismo query que TC-04-Q2)
SELECT
  COALESCE(a.ingredient_id, b.ingredient_id) AS ingredient_id,
  a.qty_sistema_a,
  b.qty_r1,
  CASE
    WHEN a.ingredient_id IS NOT NULL AND b.ingredient_id IS NOT NULL THEN 'DOBLE_DEDUCCION'
    WHEN a.ingredient_id IS NOT NULL THEN 'SOLO_SISTEMA_A'
    ELSE 'SOLO_R1'
  END AS diagnostico
FROM (
  SELECT ingredient_id, SUM(ABS(quantity)) AS qty_sistema_a
  FROM pos_inventory_movements
  WHERE client_id = 'amalay'
    AND order_id = '{ORDER_ID}'
    AND movement_type = 'deduction'
  GROUP BY ingredient_id
) a
FULL OUTER JOIN (
  SELECT m.ingredient_id, SUM(ABS(m.quantity)) AS qty_r1
  FROM pos_inventory_movements m
  JOIN pos_reconciliation_results rr ON rr.id = m.reconciliation_result_id
  WHERE m.client_id = 'amalay'
    AND rr.order_id = '{ORDER_ID}'
    AND m.movement_type = 'recipe_deduction'
  GROUP BY m.ingredient_id
) b ON a.ingredient_id = b.ingredient_id;
-- [PRE] DOBLE_DEDUCCION para ítems recipe — confirma P0 en path offline
-- [POST] SOLO_R1 — gate evitó deducción de Sistema A
```

**Resultado esperado [PRE]:** `DOBLE_DEDUCCION` con gap temporal entre movimientos. **Esto confirma que el P0 también afecta órdenes offline.** El stock está subcontado.

**Resultado esperado [POST]:** `SOLO_R1`, un solo movimiento por ingrediente.

---

### TC-10 — Reinicio del POS

**Objetivo:** Confirmar que reiniciar el POS no genera movimientos de inventario adicionales y que el estado se restaura correctamente.

**Pasos:**
1. Abrir orden con ítem recipe, enviar a cocina. NO cobrar.
2. Cerrar completamente el browser/Electron.
3. Reabrir el POS.
4. Navegar a la misma mesa. El POS debe cargar la orden desde DB.
5. Esperar 5 segundos.

**SQL a ejecutar:**
```sql
-- TC-10-Q1: Verificar que no hay nuevos movimientos post-reinicio
SELECT COUNT(*) AS movimientos_post_reinicio
FROM pos_inventory_movements
WHERE client_id = 'amalay'
  AND created_at > NOW() - INTERVAL '2 minutes'
  AND (
    order_id = '{ORDER_ID}'
    OR reconciliation_result_id IN (
      SELECT id FROM pos_reconciliation_results
      WHERE order_id = '{ORDER_ID}' AND client_id = 'amalay'
    )
  );
-- Esperado: 0 — el reinicio no genera movimientos
```

```sql
-- TC-10-Q2: Verificar que applied_consumption es el mismo que antes del reinicio
SELECT applied_consumption, result, last_mutation_revision
FROM pos_reconciliation_results
WHERE client_id = 'amalay' AND order_id = '{ORDER_ID}';
-- Esperado: mismo valor que TC-02-Q2. Sin cambio.
```

`[POST]` Verificar en DevTools → Console que aparece:
```
[inventory-policy] loading for client amalay...
[inventory-policy] map loaded: 687 items, state → READY
```

**Resultado esperado [PRE y POST]:** Cero movimientos post-reinicio. `applied_consumption` sin cambio.

---

### TC-11 — Dos terminales simultáneas

**Objetivo:** Confirmar que OCC previene doble deducción por escritura concurrente.

**Pasos:**
1. Abrir la misma mesa en dos browsers/tabs distintos (Terminal A y Terminal B).
2. En Terminal A: agregar ítem recipe X.
3. En Terminal B (al mismo tiempo): agregar ítem recipe Y (distinto).
4. En ambas terminales, presionar "Enviar a Cocina" simultáneamente (o con < 1 segundo de diferencia).
5. Esperar resultado en ambas terminales (una verá éxito, la otra verá conflicto o append).

**SQL a ejecutar:**
```sql
-- TC-11-Q1: Ver el estado final de la orden
SELECT id, order_revision, last_inventory_processed_revision,
       jsonb_array_length(items) AS item_count, status
FROM pos_orders
WHERE client_id = 'amalay' AND mesa = '{MESA}'
  AND created_at > NOW() - INTERVAL '10 minutes'
ORDER BY created_at DESC LIMIT 1;
-- Anotar order_revision y item_count.
```

```sql
-- TC-11-Q2: Verificar que hay un solo recipe_deduction por ingrediente por ítem
SELECT
  rr.order_item_id,
  rr.menu_item_id,
  rr.applied_consumption,
  rr.result,
  COUNT(m.id) AS movement_count
FROM pos_reconciliation_results rr
LEFT JOIN pos_inventory_movements m ON m.reconciliation_result_id = rr.id
WHERE rr.client_id = 'amalay' AND rr.order_id = '{ORDER_ID}'
GROUP BY rr.order_item_id, rr.menu_item_id, rr.applied_consumption, rr.result
ORDER BY rr.order_item_id;
-- Esperado: movement_count = 1 por order_item_id (un solo recipe_deduction)
-- Si movement_count > 1: hay movimientos duplicados — DETENER y documentar.
```

```sql
-- TC-11-Q3: Verificar que applied_consumption = cantidad para todos los ítems
SELECT rr.order_item_id, rr.cantidad, rr.applied_consumption,
  rr.cantidad = rr.applied_consumption AS correcto
FROM pos_reconciliation_results rr
WHERE rr.client_id = 'amalay' AND rr.order_id = '{ORDER_ID}';
-- Esperado: correcto = true para todos los ítems
```

**Resultado esperado [PRE y POST]:** Un `recipe_deduction` por ítem, no importa cuántas terminales compitieron. OCC garantiza que una sola revisión gana y R1 aplica la deducción exactamente una vez.

---

### TC-12 — Venta normal (direct_stock)

**Objetivo:** Confirmar que ítems `direct_stock` no tienen doble deducción.

**Pasos en el POS:**
1. Agregar ítem direct_stock elegido en P-04. Enviar a cocina. Cobrar.

**SQL a ejecutar:**
```sql
-- TC-12-Q1: Verificar movimiento en pos_market_stock (no pos_inventory)
SELECT m.movement_type, m.quantity, m.menu_item_id, m.actor, m.created_at
FROM pos_market_movements m
WHERE m.client_id = 'amalay'
  AND m.order_id = '{ORDER_ID}';
-- Esperado: 1 fila con movement_type='venta', quantity=-(cantidad pedida)
```

```sql
-- TC-12-Q2: Confirmar que NO hay movimientos en pos_inventory para este ítem
SELECT COUNT(*) AS movimientos_en_inventory
FROM pos_inventory_movements
WHERE client_id = 'amalay'
  AND order_id = '{ORDER_ID}';
-- Esperado: 0 — direct_stock va a pos_market_stock, no a pos_inventory
```

```sql
-- TC-12-Q3: Verificar reconciliación
SELECT applied_consumption, result, pinned_mode
FROM pos_reconciliation_results
WHERE client_id = 'amalay' AND order_id = '{ORDER_ID}';
-- Esperado: result='RECONCILED', pinned_mode='direct_stock'
```

**Resultado esperado [PRE y POST]:** Sin doble deducción en `direct_stock`. R1 gestiona vía `pos_market_stock`. Sistema A no toca ese flujo.

---

### TC-13 — Venta normal (unclassified)

**Objetivo:** Documentar exactamente qué ocurre con ítems unclassified. Sin asumir comportamiento.

**Pasos en el POS:**
1. Agregar ítem unclassified elegido en P-05. Enviar a cocina. Cobrar.

**SQL a ejecutar:**
```sql
-- TC-13-Q1: Verificar resultado de reconciliación R1
SELECT applied_consumption, result, pinned_mode
FROM pos_reconciliation_results
WHERE client_id = 'amalay' AND order_id = '{ORDER_ID}';
-- Esperado: result='BLOCKED_UNCLASSIFIED', applied_consumption=0
```

```sql
-- TC-13-Q2: Verificar si Sistema A dedujo algo
SELECT movement_type, ingredient_id, quantity, actor, notes, created_at
FROM pos_inventory_movements
WHERE client_id = 'amalay'
  AND order_id = '{ORDER_ID}'
  AND movement_type = 'deduction';
-- [PRE] Si el ítem tiene receta en pos_recipes_old: habrá 1+ filas
--       Si no tiene receta en pos_recipes_old: 0 filas
-- Documentar el resultado. Esto determina si la alternativa A, B o C aplica.
```

```sql
-- TC-13-Q3: Si hubo deducción de Sistema A, cuantificar vs baseline
SELECT inv.ingredient_id, inv.stock, inv.stock_unit
FROM pos_inventory inv
WHERE inv.client_id = 'amalay'
  AND inv.ingredient_id IN (
    SELECT DISTINCT ingredient_id FROM pos_inventory_movements
    WHERE client_id = 'amalay' AND order_id = '{ORDER_ID}' AND movement_type = 'deduction'
  );
-- Comparar con P-06 del ítem unclassified (si se capturó baseline).
```

**Resultado esperado:** Documentar el resultado exacto. No hay un "esperado" definido hasta que se elija alternativa A/B/C. Este TC genera evidencia para esa decisión.

---

## 4. SQL de referencia — Consultas genéricas reutilizables

### R-01: Resumen completo de una orden

```sql
-- Sustituir {ORDER_ID}
SELECT
  o.id, o.mesa, o.mesero, o.status, o.order_revision,
  o.last_inventory_processed_revision,
  o.last_inventory_complete_revision,
  o.closed_at,
  jsonb_array_length(o.items) AS total_items,
  (
    SELECT COUNT(*) FROM pos_reconciliation_results rr
    WHERE rr.order_id = o.id AND rr.client_id = o.client_id
  ) AS intents_reconciliacion,
  (
    SELECT COUNT(*) FROM pos_reconciliation_results rr
    WHERE rr.order_id = o.id AND rr.client_id = o.client_id AND rr.result = 'RECONCILED'
  ) AS intents_reconciled,
  (
    SELECT SUM(rr.applied_consumption) FROM pos_reconciliation_results rr
    WHERE rr.order_id = o.id AND rr.client_id = o.client_id
  ) AS total_applied_consumption
FROM pos_orders o
WHERE o.id = '{ORDER_ID}' AND o.client_id = 'amalay';
```

### R-02: Todos los movimientos de una orden (vista cronológica)

```sql
SELECT
  m.created_at AT TIME ZONE 'America/Monterrey' AS ts,
  m.movement_type,
  m.ingredient_id,
  m.quantity,
  m.actor,
  LEFT(m.notes, 80) AS notes_preview,
  m.mutation_revision,
  CASE WHEN m.order_id IS NOT NULL THEN 'Sistema_A'
       WHEN m.reconciliation_result_id IS NOT NULL THEN 'R1'
       ELSE 'Desconocido'
  END AS sistema_origen
FROM pos_inventory_movements m
LEFT JOIN pos_reconciliation_results rr ON rr.id = m.reconciliation_result_id
WHERE m.client_id = 'amalay'
  AND (m.order_id = '{ORDER_ID}' OR rr.order_id = '{ORDER_ID}')
ORDER BY m.created_at ASC;
```

### R-03: Estado de reconciliación de una orden

```sql
SELECT
  rr.order_item_id,
  rr.menu_item_id,
  rr.cantidad             AS qty_deseada,
  rr.applied_consumption  AS qty_aplicada,
  rr.cantidad - rr.applied_consumption AS pendiente,
  rr.pinned_mode,
  rr.result,
  rr.last_mutation_revision,
  rr.created_at AT TIME ZONE 'America/Monterrey' AS creado,
  rr.updated_at AT TIME ZONE 'America/Monterrey' AS actualizado
FROM pos_reconciliation_results rr
WHERE rr.client_id = 'amalay'
  AND rr.order_id = '{ORDER_ID}'
ORDER BY rr.created_at ASC;
```

### R-04: Delta esperado vs. aplicado por ingrediente

```sql
SELECT
  m.ingredient_id,
  SUM(CASE WHEN m.movement_type = 'recipe_deduction' THEN ABS(m.quantity) ELSE 0 END) AS total_r1_deduccion,
  SUM(CASE WHEN m.movement_type = 'recipe_reversal'  THEN ABS(m.quantity) ELSE 0 END) AS total_r1_reversal,
  SUM(CASE WHEN m.movement_type = 'deduction'        THEN ABS(m.quantity) ELSE 0 END) AS total_a_deduccion,
  SUM(CASE WHEN m.movement_type = 'adjustment' AND m.notes LIKE 'Cancelacion:%'
                                               THEN ABS(m.quantity) ELSE 0 END)        AS total_a_reversal,
  SUM(m.quantity)                                                                       AS balance_neto
FROM pos_inventory_movements m
LEFT JOIN pos_reconciliation_results rr ON rr.id = m.reconciliation_result_id
WHERE m.client_id = 'amalay'
  AND (m.order_id = '{ORDER_ID}' OR rr.order_id = '{ORDER_ID}')
GROUP BY m.ingredient_id
ORDER BY m.ingredient_id;
```

### R-05: Detectar doble deducción global (desde cutover)

```sql
SELECT
  COALESCE(a.order_id, b.order_id)           AS order_id,
  COALESCE(a.ingredient_id, b.ingredient_id) AS ingredient_id,
  a.total_a,
  b.total_b,
  CASE
    WHEN a.order_id IS NOT NULL AND b.order_id IS NOT NULL THEN 'DOBLE_DEDUCCION'
    WHEN a.order_id IS NOT NULL THEN 'SOLO_SISTEMA_A'
    ELSE 'SOLO_R1'
  END AS diagnostico
FROM (
  SELECT order_id, ingredient_id, SUM(ABS(quantity)) AS total_a
  FROM pos_inventory_movements
  WHERE client_id = 'amalay'
    AND movement_type = 'deduction'
    AND created_at >= '2026-07-14T06:55:21+00:00'
    AND order_id IS NOT NULL
  GROUP BY order_id, ingredient_id
) a
FULL OUTER JOIN (
  SELECT rr.order_id, m.ingredient_id, SUM(ABS(m.quantity)) AS total_b
  FROM pos_inventory_movements m
  JOIN pos_reconciliation_results rr ON rr.id = m.reconciliation_result_id
  WHERE m.client_id = 'amalay'
    AND m.movement_type = 'recipe_deduction'
    AND m.created_at >= '2026-07-14T06:55:21+00:00'
    AND rr.result = 'RECONCILED'
  GROUP BY rr.order_id, m.ingredient_id
) b ON a.order_id = b.order_id AND a.ingredient_id = b.ingredient_id
ORDER BY diagnostico, order_id, ingredient_id;
```

### R-06: Verificar BLOCKED inesperados en un período

```sql
SELECT result, COUNT(*) AS total
FROM pos_reconciliation_results
WHERE client_id = 'amalay'
  AND created_at > NOW() - INTERVAL '1 hour'
GROUP BY result
ORDER BY total DESC;
-- Después del Paso 1: no debe aparecer BLOCKED_RECIPE_MISSING para ítems recipe
-- que previamente eran RECONCILED. Si aparece: investigar.
```

### R-07: Estado actual del inventario para un ingrediente específico

```sql
SELECT
  ingredient_id,
  stock,
  stock_unit,
  updated_at AT TIME ZONE 'America/Monterrey' AS actualizado_monterrey
FROM pos_inventory
WHERE client_id = 'amalay'
  AND ingredient_id = '{INGREDIENT_ID}';
```

---

## 5. Checklist de aprobación

### Pre-Paso-1 (confirmación del modelo P0)

| # | Check | Evidencia requerida | OK |
|---|-------|--------------------|----|
| B-01 | Enviar a cocina ejecuta exactamente un `recipe_deduction` por ingrediente | TC-02-Q3: 1 fila por ingrediente | ☐ |
| B-02 | Múltiples save-orders no generan movimientos adicionales | TC-03-Q1: count sin cambio vs TC-02-Q3 | ☐ |
| B-03 | `applied_consumption` = `cantidad` después del primer save-order | TC-02-Q2: applied_consumption = qty | ☐ |
| B-04 | Cobrar genera `deduction` adicional de Sistema A | TC-04-Q1: aparece fila `deduction` | ☐ |
| B-05 | Doble deducción confirmada: `DOBLE_DEDUCCION` en TC-04-Q2 | TC-04-Q2: al menos 1 fila con ese diagnóstico | ☐ |
| B-06 | Cancelar pre-cocina no genera movimientos | TC-06-Q1: 0 filas | ☐ |
| B-07 | Cancelar post-cocina genera `adjustment` de Sistema A, no `recipe_reversal` | TC-07-Q1: fila `adjustment` con notes `Cancelacion:` | ☐ |
| B-08 | R1 no corre al cancelar ítem (PATCH directo) | TC-07-Q2: `applied_consumption` sin cambio | ☐ |
| B-09 | Void completo genera `recipe_reversal` de R1 (orphan removal) | TC-08-Q2: filas `recipe_reversal` con actor `r1_reconciler` | ☐ |
| B-10 | `applied_consumption = 0` después del void | TC-08-Q3: applied_consumption = 0 | ☐ |
| B-11 | Offline: Sistema A dedujo antes del sync (timestamp gap) | TC-09-Q1: fila `deduction` con ts < sync | ☐ |
| B-12 | Offline: R1 dedujo después del sync | TC-09-Q1: fila `recipe_deduction` con ts = sync | ☐ |
| B-13 | `direct_stock` va a `pos_market_movements`, no a `pos_inventory_movements` | TC-12-Q2: 0 filas en pos_inventory_movements | ☐ |
| B-14 | Dos terminales: un solo `recipe_deduction` por ítem (OCC funcionó) | TC-11-Q2: movement_count = 1 | ☐ |

### Post-Paso-1 (validación del gate)

| # | Check | Evidencia requerida | OK |
|---|-------|--------------------|----|
| G-01 | InventoryPolicyService llega a READY en < 5s post-mount | Console: `state → READY` | ☐ |
| G-02 | Policy map tiene 687 ítems | Console: `map loaded: 687 items` | ☐ |
| G-03 | Console muestra `[deduct:r1-owned]` para cada ítem recipe al cobrar | DevTools Console al pagar | ☐ |
| G-04 | NO aparece `[inventory] Deducted` para ítems recipe | Console: ausencia del log | ☐ |
| G-05 | TC-04-Q2: `SOLO_R1` para todos los ingredientes recipe | TC-04-Q2: diagnóstico = SOLO_R1 | ☐ |
| G-06 | TC-04-Q1: NO hay fila con `movement_type='deduction'` y actor ≠ `r1_reconciler` | TC-04-Q1: ausencia | ☐ |
| G-07 | Simular FAILED (bajar red antes de mount): pago no se bloquea | POS responde al cobrar aunque falle el fetch | ☐ |
| G-08 | En modo FAILED: console muestra `state → FAILED, using stale map` | DevTools Console | ☐ |
| G-09 | TC-09 offline: `SOLO_R1` en el sync post-gate | TC-09-Q2: diagnóstico = SOLO_R1 | ☐ |
| G-10 | R-06 no muestra `BLOCKED_RECIPE_MISSING` inesperados | R-06 ejecutado post-prueba | ☐ |
| G-11 | TC-11: dos terminales siguen produciendo 1 movimiento por ítem | TC-11-Q2: movement_count = 1 | ☐ |
| G-12 | TC-08 void: `applied_consumption = 0` y solo `recipe_reversal` de R1 | TC-08-Q3 y TC-08-Q2 | ☐ |

**El Paso 1 se considera validado cuando los 12 checks de la sección POST están marcados OK, más los 14 de la sección PRE confirmados en la sesión baseline.**

---

## 6. Criterio de rollback

### Qué observar durante las pruebas

| Señal | Acción |
|-------|--------|
| `movement_count > 1` por `order_item_id` en TC-11-Q2 | Detener prueba. Posible fallo de OCC. |
| `applied_consumption ≠ cantidad` después de kitchen send exitoso | Detener prueba. Inconsistencia en reconciliación. |
| `BLOCKED_RECIPE_MISSING` para un ítem que era `RECONCILED` antes del Paso 1 | Detener prueba. Posible borrado de `pos_recipe_versions` activa. |
| `G-05` muestra `DOBLE_DEDUCCION` después del Paso 1 | Rollback inmediato. El gate no está funcionando. |
| POS no responde al cobrar cuando `InventoryPolicyService` está en `FAILED` | Detener prueba. Violación de Invariante I-5 (safe-fail). |
| `stock < -99999` para cualquier ingrediente | Detener prueba. Mutación sin control. |

### Cuándo detener la prueba

Cualquiera de las siguientes condiciones requiere detener todas las pruebas:
1. Un check marcado con "Detener prueba" en la tabla anterior.
2. `G-05` muestra resultado distinto de `SOLO_R1` después del Paso 1.
3. Más de 2 checks G-## no pasan.
4. El stock de algún ingrediente critico se desvía del baseline en > 20% sin orden activa.

### Cuándo revertir la rama

Revertir a la rama de producción anterior si:
- `G-05` confirma que el gate no funciona (doble deducción persiste post-Paso-1).
- El POS se vuelve inoperable durante la prueba (pago no completa, error crítico en consola).
- El Supabase editor muestra errores de base de datos en `r1_reconcile_order` no vistos antes.

Revertir solo requiere hacer rollback del deployment en Vercel. No hay cambios de DB en el Paso 1.

### Evidencia a guardar antes del rollback

Ejecutar estos queries y guardar los resultados (copy/paste del SQL editor) antes de revertir:

```sql
-- ROLLBACK-EVIDENCE-01: Snapshot de todos los movimientos de las órdenes de prueba
SELECT
  m.id, m.client_id, m.ingredient_id, m.movement_type, m.quantity,
  m.actor, LEFT(m.notes, 120) AS notes, m.order_id,
  m.reconciliation_result_id, m.mutation_revision,
  m.created_at AT TIME ZONE 'America/Monterrey' AS ts_monterrey
FROM pos_inventory_movements m
WHERE m.client_id = 'amalay'
  AND m.created_at > NOW() - INTERVAL '3 hours'
ORDER BY m.created_at DESC;
```

```sql
-- ROLLBACK-EVIDENCE-02: Snapshot de reconciliación
SELECT
  rr.id, rr.order_id, rr.order_item_id, rr.menu_item_id,
  rr.cantidad, rr.applied_consumption, rr.pinned_mode,
  rr.result, rr.last_mutation_revision,
  rr.created_at AT TIME ZONE 'America/Monterrey' AS ts
FROM pos_reconciliation_results rr
WHERE rr.client_id = 'amalay'
  AND rr.created_at > NOW() - INTERVAL '3 hours'
ORDER BY rr.created_at DESC;
```

```sql
-- ROLLBACK-EVIDENCE-03: Stock de ingredientes afectados en las pruebas
SELECT ingredient_id, stock, stock_unit, updated_at
FROM pos_inventory
WHERE client_id = 'amalay'
  AND ingredient_id IN (
    SELECT DISTINCT ingredient_id FROM pos_inventory_movements
    WHERE client_id = 'amalay' AND created_at > NOW() - INTERVAL '3 hours'
  )
ORDER BY ingredient_id;
```

Guardar los tres outputs en un archivo `ROLLBACK-EVIDENCE-{FECHA}-{HORA}.txt`. Adjuntar al ticket del incidente.

---

*Versión 1 — 2026-07-25. Solo lectura y validación. Sin cambios de código.*
