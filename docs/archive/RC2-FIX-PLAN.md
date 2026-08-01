# RC2 Fix Plan — Post Smoke Test

**Fecha:** 2026-07-23  
**Alcance:** Bugs identificados en smoke test RC2. Sin nuevas features. Sin refactors oportunistas.  
**Prerequisito:** Este documento debe estar aprobado antes de escribir cualquier línea de código.

---

## Resumen de bugs a resolver

| ID | Fase | Severidad | Descripción breve |
|----|------|-----------|-------------------|
| P1-1 | 1 | P1 | Inventario C2 falla con 400 (ingredient_id vs product_id) |
| P0-3 | 1 | P0 | Sync queue guard bloquea cierre de turno con errores terminales |
| P0-2 | 2 | P0 | Orden padre del split queda en "enviada" |
| P0-1 | 2 | P0 | OCC falso positivo — KDS bumps updated_at sin tocar order_revision |
| C-PL | 3 | UX | Platillos vendidos = 0 en corte (JSON.parse sobre objeto ya parseado) |
| C-UX | 3 | UX | Corte y wizard requieren scroll en touchscreen |

---

## Grafo de dependencias

```
P1-1 (fix 400 inventario)
  └─ Previene NUEVAS entradas terminales en IndexedDB
  └─ No elimina las 25 entradas existentes
  └─ Debe ir ANTES de P0-3 para no acumular más artefactos

P0-3 (fix sync queue guard)
  └─ Depende de: P1-1 primero (de lo contrario, el fix no es permanente)
  └─ Tiene sub-decisión: qué hacer con las 25 entradas existentes (ver §P0-3)
  └─ Implementación independiente, pero en secuencia DESPUÉS de P1-1

P0-2 (cerrar orden padre del split)
  └─ Independiente de P1-1/P0-3
  └─ Secuenciada después para que la revalidación ocurra con inventario limpio

P0-1 (OCC KDS)
  └─ Independiente de todos
  └─ Mayor riesgo de regresión — último en implementarse
  └─ Requiere decisión de diseño antes de código (ver §P0-1)

C-PL (platillos vendidos)
  └─ 1 línea, aislado — puede ir en cualquier fase como fix de baja fricción
  └─ Recomendado: junto con P0-2 (misma área: corte)

C-UX (scroll en touchscreen)
  └─ No depende de nada — layout puro
  └─ Después de todos los fixes funcionales
```

---

## Fase 1 — Desbloquear operación

### P1-1. Inventario C2 — 400 Bad Request

**Archivo:** `src/lib/pos-data.ts` — `logInventoryMovement()` ~línea 1754

**Causa confirmada / hipótesis:**  
El código envía `ingredient_id` (string), pero `pos_inventory_movements` fue migrada a `product_id` (BIGINT → `pos_inventory_products`). Documentado en el propio código en línea 1750. La causa exacta del 400 debe verificarse inspeccionando el cuerpo de respuesta de error antes de codificar.

**Paso previo obligatorio — confirmar payload (aprobado 2026-07-23):**  
Abrir DevTools Network en Chrome, cobrar una orden con ingredientes, capturar la request fallida a `pos_inventory_movements`. Registrar:
- Status: 400
- Response body completo (Supabase especifica el campo exacto que rechaza)
- Payload enviado (body del POST)
- Headers relevantes si aportan contexto (apikey, Authorization, Content-Type)

Un 400 de Supabase puede ser: columna incorrecta, tipo incorrecto, constraint, FK, RLS, campo NOT NULL, o trigger. No asumir que es `ingredient_id → product_id` hasta ver la respuesta. Sin este paso no se escribe código.

**Opciones de fix (evaluar después de confirmar payload):**

| Opción | Descripción | Riesgo |
|--------|-------------|--------|
| A | Resolver `product_id` desde `ingredient_id` antes del POST — requiere join o mapa en cliente | Medio — afecta toda la ruta de inventario |
| B | Si la tabla aún acepta `ingredient_id` como alias, corregir solo el nombre del campo | Bajo — cambio mínimo |
| C | Agregar columna `ingredient_id` como alias en la tabla hasta migración completa | Bajo en código, requiere migración DB |

**Scope de cambio:** 1 función (`logInventoryMovement`), ~10-15 líneas. No tocar `deductIngredientsForOrder` salvo que el payload lo requiera.

**Riesgo de regresión:** MEDIO — toca la ruta de escritura de inventario de TODOS los cobros (no solo split). Un error aquí silencia la deducción de inventario globalmente.

**Plan de revalidación:**
1. Cobro normal (1 cuenta, sin split) → verificar en DB que existan filas en `pos_inventory_movements` para esa orden
2. Split 2 cuentas → verificar filas para C1 y para C2
3. Verificar que IndexedDB queue NO acumule nuevas entradas `pos_inventory_movements` después del cobro
4. Console: cero 400 en requests de inventario

---

### P0-3. Sync queue guard — CierreCajaWizard bloqueado por errores terminales

**Archivo:** `src/components/pos/CierreCajaWizard.tsx` — `handleSave()` línea 154-162

**Causa confirmada:**  
`getPendingQueue()` devuelve todas las entradas con `!synced`. El guard no distingue `TRANSIENT_RETRYABLE` (reintentable) de `STALE_WRITE_CONFLICT` / `TERMINAL_NON_RETRYABLE` (terminales, nunca sincronizarán).

**Decisión tomada — Opción A (aprobada 2026-07-23):**

El wizard solo bloquea si `error_class === 'TRANSIENT_RETRYABLE'`. Las entradas con `error_class: undefined` o error_class terminal (`STALE_WRITE_CONFLICT`, `TERMINAL_NON_RETRYABLE`) no bloquean el cierre. La cola sigue visible en UI para auditoría.

**Supuesto temporal explícito — debe documentarse en el código y permanecer hasta que se implemente la clasificación completa:**

> Las entradas con `error_class: undefined` existentes al momento de este fix provienen de errores HTTP 400 terminales observados durante el smoke test RC2 (2026-07-23). Son movimientos de `pos_inventory_movements` que fallaron por mismatch de schema (P1-1) y nunca sincronizarán. Si en el futuro aparecen entradas `undefined` de naturaleza transitoria, este supuesto deja de ser válido y será necesario implementar clasificación explícita (Opción C: auto-clasificar en carga según `retries`, código HTTP, y turno activo).

Este supuesto debe aparecer como comentario en `CierreCajaWizard.tsx` junto al guard modificado — no en un doc externo.

**Scope de cambio:** `CierreCajaWizard.tsx` — cambio en el filtro del guard (~2-3 líneas). Posiblemente `pos-offline-db.ts` si se elige Opción C.

**Riesgo de regresión:** BAJO — aislado a la pantalla de cierre de turno. No toca la ruta de cobro.

**Importante:** La UI del wizard ya dice "Huella o PIN de gerente para aprobar" — PR-1 (validar que HID reader funcione en esta pantalla) queda pendiente de prueba en terminal física.

**Plan de revalidación:**
1. Con 25 entradas `!synced` existentes en IndexedDB → intentar cerrar turno → debe avanzar al paso de huella/PIN
2. Verificar que las 25 entradas siguen visibles (auditoría) aunque no bloqueen
3. Después del cierre: verificar en DB que `pos_turnos.closed_at` fue actualizado

---

## Fase 2 — Consistencia del dominio

### P0-2. Orden padre del split queda en "enviada"

**Archivo:** `src/app/pos/page.tsx` — `handlePayment`, bloque de cobro de split

**Causa confirmada:**  
Al cobrar la última cuenta, el código crea la sub-orden `-C2` como `cerrada` pero nunca cierra la orden padre. La orden padre permanece `enviada` con `metodo_pago = null`.

**Fix:**  
Después de `saveResult.ok` en la última cuenta (`splitPayingCuenta === totalCuentas`), agregar un PATCH a la orden padre:

```
status: 'cerrada'
metodo_pago: 'Split'
closed_at: now
```

**OCC en el PATCH padre:**  
La orden padre puede tener un `updated_at` diferente al que teníamos al cargar (KDS pudo haberla tocado — P0-1). Para este PATCH de cierre, se recomienda PATCH por `id` sin If-Match: es un estado terminal, es la terminal que realizó el cobro, y el riesgo de conflicto aquí es mínimo comparado con un cobro duplicado. Documentar esta decisión en el código.

**Scope de cambio:** ~15-20 líneas dentro del bloque de split en `handlePayment`. No tocar la ruta de cobro simple (sin split).

**Riesgo de regresión:** MEDIO — está dentro del flujo de cobro de split. Errores posibles:
- Cierre prematuro si `totalCuentas` se calcula mal (verificar con split de 3 cuentas también)
- PATCH padre puede fallar silenciosamente — debe loguearse

**Plan de revalidación:**
1. Split 2 cuentas → cobrar C1 → cobrar C2 → verificar en DB: padre `cerrada`, C1 `cerrada`, C2 `cerrada`
2. Split 3 cuentas → cobrar C1, C2 → verificar padre sigue `enviada` → cobrar C3 → verificar padre `cerrada`
3. Verificar que la mesa desaparece del grid de mesas activas después del split
4. Verificar que el corte muestra 0 órdenes abiertas después del split completo
5. Cobro normal (sin split) → verificar que no se ve afectado

---

### P0-1. OCC falso positivo — KDS bumps updated_at

**Archivo:** `src/app/pos/page.tsx` — `checkOrderConflict()` línea 2594, guard de pago línea 2902

**Causa confirmada:**  
`checkOrderConflict()` compara `updated_at`. El PATCH de KDS actualiza `updated_at` sin incrementar `order_revision`. Resultado: terminal de caja detecta "modificación" cuando cocina cambia estado.

**Decisión de diseño requerida antes de codificar:**

| Opción | Descripción | Riesgo |
|--------|-------------|--------|
| 1 | Eliminar `checkOrderConflict()`. Confiar solo en `order_revision` OCC del RPC `r1_save_order`. | Elimina detección de writes que bypaseen el RPC. Riesgo moderado. |
| 2 | Separar timestamp de KDS: nuevo campo `kds_last_updated_at`. KDS escribe ahí; `checkOrderConflict` ignora ese campo. | Requiere migración DB + trigger + cambios en KDS. Más limpio a largo plazo. |
| 3 | Excluir cambios de `kds_item_status` del trigger que actualiza `updated_at`. | Requiere modificar trigger de Supabase. Riesgo: otros consumers del trigger. |

Recomendación: Opción 1 para fix inmediato (eliminar el preflight). `order_revision` ya provee OCC real. La cobertura que se pierde (writes que bypaseen el RPC) es baja en la arquitectura actual donde todo pasa por `r1_save_order`. Opción 2 queda como mejora de diseño post-estabilización.

**Scope de cambio (Opción 1):** Eliminar la llamada a `checkOrderConflict()` en el guard de pago (~3 líneas). Mantener el guard de `saveResult.conflict` (RPC OCC, línea 2971).

**Riesgo de regresión:** ALTO — toca el mecanismo que protege contra cobro simultáneo. Cambio mínimo en código pero impacto alto en seguridad operativa.

**Revalidación en DOS terminales (obligatorio):**
1. Terminal A: abrir Mesa X, enviar a cocina, NO navegar
2. Terminal B (KDS): marcar ítem como "Preparando"
3. Terminal A: cobrar → criterio PASS: cobro pasa sin toast de "modificada"
4. Terminal A y B: intentar cobrar la misma mesa simultáneamente → criterio PASS: una terminal recibe el toast del RPC ("Orden modificada por otra terminal"), la otra completa el cobro
5. Registrar ambos resultados como evidencia antes de merge

---

## Fase 3 — Calidad operacional

### C-PL. Platillos vendidos = 0 en corte

**Archivo:** `src/app/pos/corte/page.tsx` — línea 284

**Causa confirmada en código:**  
```javascript
// ACTUAL — siempre falla cuando items viene como objeto JSON (jsonb de Supabase)
const items = JSON.parse(o.items)

// FIX — maneja string y objeto
const items = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || [])
```
`JSON.parse` sobre un array ya parseado lanza SyntaxError → catch silencioso → `totalPlatillos = 0`.

**Scope de cambio:** 1 línea.  
**Riesgo de regresión:** MUY BAJO — solo afecta el display del corte. No toca datos.

**Revalidación:**  
Abrir corte después de un turno con órdenes → verificar que "Platillos vendidos" muestra un número mayor a 0.

---

### C-UX. Corte y wizard sin scroll en touchscreen

**Alcance:**  
- `/pos/corte`: reordenar secciones para que la información crítica (ventas, efectivo, diferencia) quede above the fold
- `CierreCajaWizard` paso 2: compactar el resumen para que quede en pantalla sin scroll

**Riesgo de regresión:** MUY BAJO — layout puro.  
**Revalidación:** Visual en terminal física (pantalla táctil).

---

## Matriz de smoke tests por fix

| Fix | Tests obligatorios | Tests de regresión |
|-----|-------------------|--------------------|
| P1-1 | Cobro normal + movimientos DB; Split C1+C2 + movimientos DB; 0 entradas nuevas en IndexedDB | Cobro simple previo a split |
| P0-3 | Cierre de turno con cola no vacía → debe pasar | Cierre de turno con cola vacía (control) |
| P0-2 | Split 2 cuentas → DB; Split 3 cuentas → padre solo cierra en última; Corte post-split | Cobro normal (sin split) completo |
| P0-1 | KDS + cobro terminal separada → no bloquea; Cobro simultáneo → solo una terminal completa | Cobro normal; OCC por edición real |
| C-PL | Platillos vendidos > 0 en corte | Resto de métricas del corte sin cambio |

---

## Notas de proceso

- Un bug, un commit. Mensaje de commit incluye ID del bug (P1-1, P0-3, etc.).
- Reproduce ANTES de codificar cuando sea posible (especialmente P1-1: capturar el 400 real).
- No implementar fixes combinados. P0-3 no va junto con P1-1 en el mismo commit aunque sean Fase 1.
- P0-1 requiere aprobación explícita de la opción de diseño antes de cualquier línea de código.
- P0-3 requiere decisión sobre las 25 entradas existentes antes de codificar.
