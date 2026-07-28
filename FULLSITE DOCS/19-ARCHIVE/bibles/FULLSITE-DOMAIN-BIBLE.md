# Fullsite Domain Bible

**Versión:** 2.0 — 2026-07-23  
**Fuentes verificadas:** `src/lib/pos-data.ts` (2680 líneas), `src/lib/pos-offline-db.ts`, `src/app/api/pos/save-order/route.ts`, `src/lib/inventory.ts`, `src/lib/pos-permissions.ts`, `docs/technical/SCHEMA-INFRASTRUCTURE-REPORT.md`

### Convención de evidencia

Cada afirmación técnica usa una de estas etiquetas:

- **[HECHO]** — Existe en el código y fue verificado directamente. Incluye archivo y línea cuando es posible.
- **[INFERENCIA]** — Deducido del comportamiento observado o del contexto, pero no verificado línea a línea en el código fuente.
- **[PENDIENTE]** — No existe todavía. Está diseñado, decidido, pero aún no implementado.

---

## 1. Propósito

Este documento es el glosario canónico del dominio de Fullsite. Define todas las entidades del sistema, sus estados, relaciones, invariantes y fuentes de verdad. Es la referencia obligatoria antes de:
- Diseñar una nueva feature
- Escribir una migración de base de datos
- Resolver una discrepancia entre código y comportamiento observado
- Onboardear a un nuevo colaborador técnico

Audiencia: ingenieros de Fullsite, cofundadores técnicos, y cualquier colaborador que intervenga en el código del POS o dashboard.

---

## 2. Filosofía

### 2.1 El restaurante no debe pensar en el POS

"El restaurante debe olvidar que Fullsite existe." La confiabilidad es el primer feature. Un POS que falla durante servicio es peor que no tener POS.

### 2.2 Offline-first con sincronización determinista

Todo lo que el mesero hace en el POS debe funcionar sin red. Las operaciones se encolan en IndexedDB y se replayan con exactamente la misma semántica al reconectar. Si hay conflicto, se preserva el payload para recuperación manual — nunca se hace overwrite silencioso.

### 2.3 El servidor es la autoridad; el cliente es el intermediario

Las mutaciones críticas (órdenes, inventario) pasan por funciones RPC en PostgreSQL. El cliente nunca escribe directamente a tablas de pos_orders. El servidor verifica revisiones, aplica reglas de negocio y garantiza consistencia.

### 2.4 Audit trail sobre todo

Nada se borra. `pos_audit_log` es inmutable. `pos_inventory_movements` es un ledger append-only. Si hay una discrepancia, el audit log gana como evidencia. Este principio evita fraude y permite reconstruir el estado desde cero.

### 2.5 Paridad con Wansoft antes que features nuevas

Cada entidad y flujo del sistema fue diseñado entendiendo primero cómo lo hace Wansoft (el POS incumbente). El objetivo no es copiar botones sino entender el "por qué" operativo y rediseñarlo mejor.

---

## 3. Arquitectura

### 3.1 Stack

- **Frontend:** Next.js 16 (App Router), TypeScript, Tailwind CSS
- **Backend:** Supabase (PostgreSQL 15, PostgREST, Realtime, Auth)
- **Offline:** IndexedDB (`fullsite_pos`, versión 1)
- **Deployment:** Vercel (frontend) + Supabase Cloud

### 3.2 Tres capas de almacenamiento

```
┌─────────────────────────────────────────────────┐
│ React State (memoria)                           │
│ Estado de trabajo, efímero, no persiste entre   │
│ recargas                                        │
├─────────────────────────────────────────────────┤
│ IndexedDB (navegador)                           │
│ Cache offline: orders, menu, inventory,         │
│ sync_queue, meta                                │
├─────────────────────────────────────────────────┤
│ Supabase PostgreSQL                             │
│ Source of truth autoritativo                    │
│ 116 tablas, RLS, triggers, 16 funciones RPC     │
└─────────────────────────────────────────────────┘
```

### 3.3 Aislamiento multi-tenant

Todas las tablas tienen columna `client_id TEXT`. No existe schema separado por cliente. El filtro `client_id=eq.{slug}` aplica en cada consulta. Las RLS policies en Supabase refuerzan esto en el servidor.

El `client_id` activo se resuelve via `getActiveClientSlug()` en `src/lib/data.ts`, que lee de la sesión de Supabase Auth.

### 3.4 Control de concurrencia optimista (OCC)

Las mutaciones de `pos_orders` usan el campo `order_revision` (INTEGER). El cliente envía el `expected_revision` que tenía al momento de leer. El RPC `r1_save_order` verifica que `expected_revision === server.order_revision` antes de escribir. Si no coincide → `STALE_WRITE_REJECTED`.

#### Rationale: Por qué OCC via expected_revision

- **Problema [HECHO]:** El POS opera offline. Los locks distribuidos (pesimistas) requieren mantener una conexión activa con el servidor para adquirir y liberar el lock. Eso es imposible cuando el dispositivo no tiene red.
- **Alternativas consideradas [INFERENCIA]:** (a) Locks pesimistas: descartan bajo conectividad intermitente. (b) Last-write-wins por timestamp: el timestamp del cliente no es confiable (el reloj puede estar desfasado). (c) Versión vectorial (vector clocks): complejidad excesiva para el tamaño actual del equipo.
- **Elección [HECHO]:** OCC via `expected_revision` — el cliente lee la revisión actual, aplica su cambio, y envía ambos. Si la revisión en el servidor cambió mientras tanto, el servidor rechaza la escritura. No requiere conexión sostenida.
- **Tradeoffs [HECHO]:** Requiere retry logic en el cliente. Un `STALE_WRITE_REJECTED` obliga al cliente a re-leer la orden y aplicar su cambio encima. En modo offline esto se traduce en un `STALE_WRITE_CONFLICT` que queda en la cola para resolución manual.
- **Cuándo replantear [INFERENCIA]:** Si la tasa de conflictos observada en producción supera el 5% de las operaciones, sería indicio de que múltiples dispositivos están editando la misma orden simultáneamente con frecuencia, y convendría evaluar un modelo de reserva de mesa.

### 3.5 Idempotencia de operaciones

El campo `save_operation_id` permite que `r1_save_order_idempotent` detecte replays de la misma operación lógica y devuelva el resultado original sin re-ejecutar. Esto permite que el sistema offline reintente sin crear duplicados.

#### Rationale: Por qué save_operation_id además de OCC

- **Problema [HECHO]:** OCC via `expected_revision` detecta escrituras concurrentes sobre la misma orden, pero no detecta que el cliente está retransmitiendo la misma operación que ya fue aplicada. Si el servidor aplica una operación pero el cliente no recibe el ACK (por ejemplo, la red cae exactamente en ese momento), el cliente vuelve a encolar la misma operación. Sin idempotencia, `r1_save_order` la aplicaría dos veces, creando inconsistencias.
- **Alternativas consideradas [INFERENCIA]:** Sería posible depender únicamente de `expected_revision` para detectar replays: si la revisión ya avanzó, el servidor rechazaría el replay como `STALE_WRITE`. Sin embargo, este rechazo no distingue entre "escritura en conflicto con otro dispositivo" y "replay de una operación ya exitosa". La resolución manual sería necesaria en ambos casos, lo que es excesivo para un replay benigno.
- **Elección [HECHO]:** Dos garantías en capas ortogonales. OCC (`expected_revision`) previene sobrescrituras entre dispositivos diferentes. Idempotencia (`save_operation_id`) previene duplicados por retransmisión del mismo dispositivo. Son problemas distintos con soluciones distintas.
- **Tradeoffs [HECHO]:** Agrega un campo UUID al payload de cada operación. El servidor debe mantener un índice sobre `save_operation_id` para la detección eficiente.
- **Cuándo replantear [INFERENCIA]:** Nunca en su totalidad — las dos garantías son ortogonales. Si se migrara a un modelo de event sourcing puro con log append-only, el `save_operation_id` podría transformarse en el ID del evento.

### 3.6 Sistema de inventario R1

La reconciliación de inventario ocurre server-side en la función PostgreSQL `r1_reconcile_order`. Al cerrar una orden, el sistema:
1. Lee las recetas de cada item (via `pos_recipe_versions` + `pos_recipe_lines`)
2. Verifica las políticas de inventario (`pos_item_inventory_policy`)
3. Aplica deducciones a `pos_inventory`
4. Registra movimientos en `pos_inventory_movements`
5. Escribe resultados en `pos_reconciliation_results`

#### Rationale: Por qué dos sistemas de inventario paralelos

- **Contexto [HECHO]:** Coexisten dos sistemas de deducción. Sistema A: cliente, via `deductIngredientsForOrder()` en `src/lib/pos-data.ts` — fue el sistema original, construido para dar feedback inmediato al operador. Sistema B: servidor, via `r1_reconcile_order` en PostgreSQL — fue el sistema canónico del R1, construido para garantía server-side y reconciliación auditada.
- **Problema [HECHO]:** El Sistema A fue construido primero porque el dashboard de inventario necesitaba reflejar las deducciones inmediatamente, antes de que existiera el sistema R1. Los dos sistemas actualmente escriben a tablas distintas (Sistema A a `pos_inventory` vía cliente; Sistema B a `pos_inventory` + `pos_inventory_movements` vía RPC), lo que puede producir doble deducción si ambos se activan para la misma orden.
- **Alternativas consideradas [INFERENCIA]:** (a) Mantener solo Sistema A (cliente): pierde la garantía server-side y no resiste replay offline. (b) Mantener solo Sistema B (servidor): correcto a largo plazo, pero requiere migración de todas las pantallas que consumen el Sistema A.
- **Elección [HECHO]:** Transitoriamente ambos. Sistema A se mantiene para feedback inmediato en el cliente mientras Sistema B madura.
- **Tradeoffs [HECHO]:** Complejidad de dos sistemas activos. Riesgo de doble deducción si no se controla cuál sistema aplica para qué orden.
- **Cuándo replantear [PENDIENTE]:** Cuando Transaction B Step 3 (inventario server-side completo) esté implementado y validado en producción — Sistema A se elimina. Ese es el momento de unificar en un solo sistema canónico server-side.

### 3.7 Transporte de sincronización offline

Dos transportes para el replay de operaciones encoladas:
- **APP_API:** replaya via `/api/pos/save-order` — para mutaciones de órdenes (pasan por OCC y reconciliación)
- **SUPABASE_REST:** replaya directo a PostgREST — para audit logs, market stock, inventory movements (no necesitan OCC)

### 3.8 Funciones PostgreSQL clave

| Función | Propósito |
|---|---|
| `r1_save_order` | Guarda orden con OCC (expected_revision check) |
| `r1_save_order_idempotent` | Igual que r1_save_order pero con deduplicación por save_operation_id |
| `r1_reconcile_order` | Deduce ingredientes al cerrar una orden |
| `r1_reconcile_item` | Deduce un ingrediente específico |
| `r1_merge_orders` | Fusiona dos órdenes (juntar mesas) |
| `r1_adjust_market_stock` | Ajusta stock de Market con autoridad serializada |
| `r1_legacy_sale_deduction` | Deducción directa (legacy, pre-R1) |
| `set_pos_order_number` | Trigger: asigna número secuencial por client_id |
| `activate_recipe_version` | Activa una versión de receta como canónica |

---

## 4. Flujos Principales

### 4.1 Flujo de orden completo (camino feliz)

```
1. Staff se autentica (PIN/huella) → sesión en sessionStorage['pos_staff']
2. Verificar turno activo (pos_turnos) → si no hay → abrir turno (fondo inicial)
3. Seleccionar mesa → crear Order en React state (status='abierta')
4. Agregar OrderItems → cada item con station, modificadores, comanda_batch_id=null
5. Enviar a cocina → asignar comanda_batch_id a items sin batch → saveOrder(status='enviada')
   └─ saveOrder() → POST /api/pos/save-order → r1_save_order (OCC)
   └─ Si offline → queueOperation() en IndexedDB sync_queue, transport='APP_API'
6. KDS muestra comanda → cocina prepara → marca items como listos en kds_item_status
7. Servir → (opcional) status='entregada'
8. Pagar → seleccionar método(s) de pago → propina opcional
   └─ Verificar pagos.sum === total + propina (en centavos)
9. Cerrar cuenta → saveOrder(status='cerrada') → r1_reconcile_order deduce inventario
10. Imprimir ticket → logAudit(payment_processed)
```

### 4.2 Flujo offline → online

```
1. POS pierde red (navigator.onLine = false)
2. saveOrder() falla fetch → cae a catch → queueOperation() en IndexedDB
   └─ También cacheOrder() para mostrar orden en KDS offline
3. Operaciones locales continúan normalmente (React state + IndexedDB)
4. Red se restaura → evento 'online' dispara registerAutoSync()
5. syncAll() procesa la queue en orden de creación:
   └─ APP_API items → replayViaAppApi() → r1_save_order_idempotent
   └─ SUPABASE_REST items → fetch directo a PostgREST
6. Éxito → markSynced() → clearSyncedItems()
7. STALE_WRITE_CONFLICT → markConflict() → queda en queue para operador
8. window.dispatchEvent('pos-order-synced') → POS page actualiza revision en state
```

### 4.3 Flujo de deducción de inventario

```
1. Orden se cierra (status='cerrada')
2. /api/pos/save-order llama r1_reconcile_order
3. r1_reconcile_order:
   a. Lee pos_recipe_versions + pos_recipe_lines para cada item
   b. Verifica pos_item_inventory_policy (puede bloquear)
   c. Para cada ingrediente: INSERT pos_inventory_movements (type='deduction')
   d. UPDATE pos_inventory.stock -= cantidad
   e. INSERT pos_reconciliation_results (r_result='RECONCILED' o 'BLOCKED_*')
4. inventory_status = 'COMPLETE' | 'BLOCKED' | 'PENDING' | 'SKIPPED'
```

### 4.4 Flujo de compra de insumos

```
1. Revisar inventario bajo mínimo → getSuggestedPurchaseItems()
2. Crear OC (borrador) → createPurchaseOrder()
3. Enviar a proveedor → updatePurchaseOrderStatus('enviada')
4. Recibir mercancía → receiveOrderItems() + updatePurchaseOrderStatus('recibida')
5. Restock → restockFromPurchaseOrder()
   └─ updateInventoryStock(ingredient_id, stock + qty)
   └─ logInventoryMovement(type='restock')
6. Capturar factura → createFactura() → updateFacturaStatus('pagada')
```

### 4.5 Flujo de autenticación del POS

```
1. Terminal muestra pantalla de identificación
2. Staff ingresa PIN de 4 dígitos (o toca lector HID para huella)
3. POST /api/pos/pin { pin, client_id, min_role? }
   └─ Server consulta pos_staff con service key (cliente nunca lee directamente)
   └─ Verifica ROLE_HIERARCHY[staff.role] >= ROLE_HIERARCHY[min_role]
4. Si válido → { staff: { name, role } }
   └─ sessionStorage.setItem('pos_staff', JSON.stringify({ name, role }))
   └─ localStorage cache de PIN (TTL 15 min, para operaciones offline)
5. getPermissions(role) → POSPermissions (50+ permisos)
```

---

## 5. Reglas de Negocio

### 5.1 Órdenes

- Toda orden requiere `turno_id` activo. Sin turno: `saveOrder()` retorna `{ ok: false, error: 'NO_TURNO' }`.
- El status solo puede avanzar hacia adelante. No existe retroceso directo (excepción: `reopenOrder()` para gerente, mueve de `cerrada` a `enviada`).
- `cancelar_ordenes` es el permiso más restrictivo del sistema — solo `admin`. Ningún otro rol puede cancelar una orden completa.
- Items cancelados no se eliminan del array `items` — se marcan con `cancelled: true`. Esto es obligatorio para el audit trail.
- Cambio de mesa requiere permiso `cambio_mesa` (capitan y superiores).
- Descuentos en porcentaje requieren `descuentos_ordenes_pct`; en monto requieren `descuentos_ordenes_monto`.

### 5.2 Pagos

- El pago es la última operación antes de cerrar. Una vez cerrada la cuenta, el pago no se puede modificar sin reabrir.
- Pago mixto (multi-forma): la suma de `pagos[*].monto` debe ser exactamente igual a `total + propina` en centavos enteros. Un centavo de diferencia rechaza el cierre.
- La propina no está en el `total` de la orden pero sí se debe incluir en los pagos.
- El método `Cortesía` (cuenta gratis) requiere permiso `cerrar_cuentas_cortesia`.

### 5.3 Turno

- Solo puede haber un turno abierto (`closed_at IS NULL`) por `client_id` simultáneamente.
- Un turno abierto por más de 18 horas se considera `stale` (del día anterior).
- El `fondo_inicial` del turno se establece al abrir y no se puede modificar después.
- Corte X = reporte parcial sin cerrar. Corte Z = cierra el turno. `corte_z` requiere `gerente` o `admin`.

### 5.4 Inventario

- Entradas de inventario solo con cantidades positivas. Para registrar salidas sin venta, usar `waste` o `adjustment` (con cantidad negativa).
- El stock no puede quedar negativo por una venta normal. `r1_reconcile_order` bloqueará la deducción y registrará `underflow_prevented`.
- Todo cambio de stock pasa por `pos_inventory_movements` (ledger). Nunca escribir directamente a `pos_inventory.stock` sin registrar el movimiento.
- La función `recordMovement()` implementa idempotencia via `idempotency_key` en `notes`.

### 5.5 Modificadores multinivel

- Un grupo de modificadores puede tener `minSelections > 0` (requerido) y `maxSelections` (límite).
- Los grupos de tipo "Término de cocción" solo aparecen para items de categoría `food`.
- Los grupos de tipo "Shots / Leche" solo aparecen para categorías `coffee` y `beverage`.
- Si no hay grupos configurados en DB, el POS cae al sistema legacy de modificadores estáticos.

---

## 6. Estados

### 6.1 Order — Máquina de estados

```
             ┌──────────────────────────────────────┐
             │           [ABIERTA]                  │
             │  Orden creada, items siendo agregados │
             └──────────────┬───────────────────────┘
                            │ enviar a cocina (saveOrder status='enviada')
                            ▼
             ┌──────────────────────────────────────┐
             │           [ENVIADA]                  │
             │  Comanda visible en KDS              │
             └──────────────┬───────────────────────┘
                            │ cocina confirma inicio
                            ▼
             ┌──────────────────────────────────────┐
             │          [PREPARANDO]                │
             │  En proceso en cocina                │
             └──────────────┬───────────────────────┘
                            │ cocina termina
                            ▼
             ┌──────────────────────────────────────┐
             │            [LISTA]                   │
             │  Lista para servir                   │
             └──────────────┬───────────────────────┘
                            │ (opcional) servir
                            ▼
             ┌──────────────────────────────────────┐
             │          [ENTREGADA]                 │
             │  Entregada al comensal               │
             └──────────────┬───────────────────────┘
                            │ cobrar y cerrar
                            ▼
             ┌──────────────────────────────────────┐
             │           [CERRADA]                  │
             │  Pagada, cerrada, inventario deducido│
             └──────────────────────────────────────┘

Desde cualquier estado:
[CUALQUIERA] ──── cancelar (solo admin) ──→ [CANCELADA]

Excepción:
[CERRADA] ──── reopenOrder() (gerente) ──→ [ENVIADA]
```

Transiciones directas permitidas (sin pasar por estados intermedios):
- `abierta` → `cerrada` (cuenta de para llevar, cobro inmediato)
- `lista` → `cerrada` (sin pasar por `entregada`)

### 6.2 Turno — Máquina de estados

```
[NO EXISTE]
     │
     │ openTurno(fondo_inicial, opened_by)
     ▼
 [ABIERTO]   ←── getActiveTurno() returns row
     │
     │ > 18 horas desde opened_at
     │
 [ABIERTO/STALE]  ← getActiveTurnoWithStaleCheck() returns isStale=true
     │
     │ closeTurno() o autoCloseStaleTurno()
     ▼
 [CERRADO]   ← closed_at IS NOT NULL
```

### 6.3 Purchase Order — Máquina de estados

```
[BORRADOR]
     │ enviar a proveedor
     ▼
[ENVIADA]  ← sent_at populated
     │ recibir mercancía
     ▼
[RECIBIDA]  ← received_at, received_by populated
     │ capturar factura
     ▼
[FACTURADA]
     │ pagar factura
     ▼
[PAGADA]

Desde cualquier estado:
[CUALQUIERA] ──→ [CANCELADA]
```

### 6.4 CFDI — Máquina de estados

```
[PENDIENTE]
     │ Facturama comienza proceso
     ▼
[PROCESANDO]
     │ SAT emite folio_fiscal
     ▼
[EMITIDA]  ← folio_fiscal, pdf_url, xml_url populated
     │ cancelación ante SAT
     ▼
[CANCELADA]

Fallo:
[PROCESANDO] → [ERROR]  ← error_msg populated
[ERROR] → [PENDIENTE]   (retry manual)
```

### 6.5 SyncQueueItem — Máquina de estados

```
[PENDING] ← synced=false, retries=0
     │
     │ syncAll() intenta replay
     │
     ├─ éxito → [SYNCED] ← synced=true → eliminar en clearSyncedItems()
     │
     ├─ TRANSIENT_RETRYABLE → [PENDING retries+1]
     │     si retries >= 5 → [ABANDONED] (ignorado, no marcado explícitamente)
     │
     ├─ STALE_WRITE_CONFLICT → [CONFLICT]
     │     conflict=true, error_class='STALE_WRITE_CONFLICT'
     │     No hay transición automática. Requiere operador.
     │
     └─ TERMINAL_NON_RETRYABLE → [CONFLICT]
           conflict=true, error_class='TERMINAL_NON_RETRYABLE'
```

### 6.6 Factura de Proveedor — Máquina de estados

```
[CAPTURADA]
     │ aprobación de gerente
     ▼
[APROBADA]
     │ pago registrado
     ▼
[PAGADA]  ← paid_at populated
```

### 6.7 OrderItem courseStatus — Máquina de estados

```
[pending] → (mesero dispara tiempo) → [fired] → [preparing] → [ready] → [served]
```

Solo aplica cuando el mesero usa la función de tiempos (`courseId` asignado). La mayoría de órdenes no usa este flujo.

### 6.8 CFDI Request inventory_status (en SaveOrderResult)

```
PENDING  ← default, reconciliación no completada
SKIPPED  ← no había recetas configuradas para los items
COMPLETE ← todas las deducciones aplicadas exitosamente
BLOCKED  ← al menos un ingrediente fue bloqueado
```

---

## 7. Source of Truth

| Entidad | Source of Truth | Cache Offline | Estado Cliente | Escritura |
|---|---|---|---|---|
| **Order** | `pos_orders` (Supabase) | IndexedDB `orders` store | React state `pos/page.tsx` | Via `r1_save_order` RPC |
| **OrderItem** | JSONB en `pos_orders.items` | IndexedDB (embebido) | Array en state de orden | Parte del payload de r1_save_order |
| **KDS Item Status** | JSONB `pos_orders.kds_item_status` | No | React state en KDS | PATCH directo Supabase REST (solo KDS) |
| **Comanda Batch** | JSONB `pos_orders.comanda_batches` | IndexedDB (embebido) | Embebido en order state | Parte del payload de saveOrder |
| **Mesa** | Inferida de `pos_orders` activas | IndexedDB (inferida) | Computed en mesas page | No persiste |
| **Turno** | `pos_turnos` (Supabase) | sessionStorage (turno activo) | React state en layout | PATCH directo Supabase REST |
| **Staff** | `pos_staff` (Supabase) | sessionStorage `pos_staff` + localStorage PINs (15 min) | sessionStorage | CRUD en admin |
| **Permission Profile** | `pos-permissions.ts` (código) | No | getPermissions(role) | Cambios requieren deploy |
| **Ingredient** | `pos_ingredients` (Supabase) | No | No | CRUD en dashboard inventario |
| **Inventory Stock** | `pos_inventory` (Supabase) | IndexedDB `inventory` store | No | Via `recordMovement()` o `r1_reconcile_order` |
| **Inventory Movement** | `pos_inventory_movements` (immutable) | Cola offline si sin red | No | INSERT via `logInventoryMovement()` |
| **Recipe (legacy)** | `pos_recipes_old` (Supabase) | No | No | CRUD en `/recetas` |
| **Recipe (canónico)** | `pos_recipe_versions` + `pos_recipe_lines` | No | No | Via `activate_recipe_version` RPC |
| **Purchase Order** | `pos_purchase_orders` (Supabase) | No | No | CRUD en `/compras` |
| **PO Item** | `pos_purchase_order_items` (Supabase) | No | No | CRUD en `/compras` |
| **Market Stock** | `pos_market_stock` (Supabase) | No | No | Via `r1_adjust_market_stock` RPC |
| **Payment Methods** | `pos_payment_methods` (Supabase) | No | Loaded on POS init | CRUD en admin |
| **Menu** | `pos_menu_categories` + `pos_menu_items` | IndexedDB `menu` store | React state POS | CRUD en admin |
| **Modifier Groups** | `pos_modifier_groups` + `pos_modifiers` | No | Loaded on item select | CRUD en admin |
| **CFDI** | `pos_cfdi_requests` (Supabase) | No | No | Via `createCFDIRequest()` |
| **Audit Log** | `pos_audit_log` (Supabase, inmutable) | Cola offline si sin red | No | Via `logAudit()` |
| **Agent Run** | `agent_runs` (Supabase) | No | React state dashboard | GitHub Actions scripts |
| **Client/Tenant** | `clients` (Supabase) | No | Sesión Supabase Auth | Admin Supabase |
| **SyncQueue** | IndexedDB `sync_queue` | Es la fuente | No | `queueOperation()` |

---

## 8. Invariantes

Las siguientes reglas nunca pueden romperse bajo ninguna circunstancia. Si una feature o migración propuesta las viola, debe rechazarse.

### I1 — Turno obligatorio

Toda orden debe tener `turno_id`. `saveOrder()` verifica antes de cualquier operación:
```typescript
if (!order.turnoId) {
  return { ok: false, error: 'NO_TURNO' }
}
```
**Motivación:** El turno es la unidad de accountability financiero. Sin turno, es imposible cuadrar caja.

#### Rationale: Por qué turno es obligatorio en toda orden

- **Problema [HECHO]:** Sin el contexto del turno, una orden no tiene trazabilidad financiera. No es posible cuadrar la caja (sumar pagos del turno), detectar fraude (cancelaciones fuera de turno), ni reconciliar el efectivo (corte Z). Cada venta necesita pertenecer a un período operativo con responsable.
- **Alternativas consideradas [INFERENCIA]:** Turno opcional: permitir crear órdenes sin turno para facilitar ventas rápidas o pruebas. Esta alternativa fue descartada porque rompe el audit trail — si una orden no tiene `turno_id`, es imposible saber bajo responsabilidad de quién ocurrió.
- **Elección [HECHO]:** Turno obligatorio como invariante de primer nivel. El bloqueo ocurre en `saveOrder()` antes de cualquier operación, con un error tipado `NO_TURNO` que el cliente debe manejar explícitamente.
- **Tradeoffs [HECHO]:** El cajero no puede crear ninguna orden si no hay un turno abierto. Esto es un bloqueante real en el flujo operativo: si el turno anterior no se cerró correctamente y el nuevo no se abrió, el POS queda inoperante hasta que se resuelva. El flujo de turno stale (`autoCloseStaleTurno`) existe precisamente para manejar este caso.
- **Cuándo replantear [INFERENCIA]:** Nunca — es un invariante de negocio. El turno obligatorio no es una restricción técnica arbitraria sino el núcleo del modelo de accountability financiero del sistema. Eliminarlo invalidaría los cortes de caja, los reportes de turno y la detección de fraude.

### I2 — OCC en mutaciones de orden

`r1_save_order(expected_revision)` rechaza si `expected_revision !== server.order_revision`. No hay overwrite forzado.
**Motivación:** Dos dispositivos pueden editar la misma mesa. Sin OCC, el último en guardar borra el trabajo del otro.

### I3 — Idempotencia de operaciones de red

Con `save_operation_id`, `r1_save_order_idempotent` devuelve el resultado original sin re-ejecutar. El replay offline nunca duplica una mutación.
**Motivación:** El sistema offline puede intentar N veces la misma operación al reconectar. Sin idempotencia, se crearían estados inconsistentes.

### I4 — Reconciliación de pago en centavos exactos

```typescript
pagosSum_centavos === (total + propina) * 100
```
Verificado en `saveOrder()` antes de enviar al servidor.
**Motivación:** Un peso de diferencia en el corte de caja genera desbalance diario acumulativo.

### I5 — Audit log inmutable

`pos_audit_log` nunca se borra ni se modifica. Hay trigger `events_immutable` que rechaza DELETE y UPDATE en la tabla `events`.
**Motivación:** Anti-fraude. Si un empleado cancela órdenes para robar, queda en el audit log aunque el dinero no esté en caja.

### I6 — Inventario es un ledger append-only

`pos_inventory_movements` solo tiene INSERTs. Para corregir un error, se crea un movimiento de `reversal`. El stock en `pos_inventory` es el estado materializado reconstruible con `SUM(quantity) GROUP BY ingredient_id`.
**Motivación:** Permite auditoría completa del inventario y detectar mermas anómalas.

### I7 — KDS y POS escriben campos separados

KDS escribe en `kds_item_status`. POS de ventas escribe en `items`. Nunca mezclar. El payload de `r1_save_order` nunca incluye `kds_item_status`.
**Motivación:** Evita race condition donde un PATCH del POS (agregar item) sobrescribe el estado que cocina ya marcó como listo.

### I8 — client_id en toda consulta

Toda query a Supabase filtra por `client_id`. Las RLS policies refuerzan esto en el servidor.
**Motivación:** Aislamiento de datos entre restaurantes. Una vulnerabilidad aquí expone datos de todos los tenants.

### I9 — Cancelación de orden: solo admin

`cancelar_ordenes: true` solo existe en el perfil `admin`. Ningún otro rol puede cancelar una orden completa.
**Motivación:** La cancelación de una orden cerrada implica devolución de dinero o eliminación de venta. Es la operación más susceptible a fraude.

### I10 — Stock no puede quedar negativo por venta normal

`r1_reconcile_order` bloquea deducciones si el stock resultaría negativo, registrando `underflow_prevented`. El sistema no silencia este evento.
**Motivación:** Si cocina vende algo que no hay en almacén, hay un error en el inventario o en las recetas. El sistema debe alertar, no silenciar.

### I11 — STALE_WRITE_CONFLICT es terminal sin auto-retry

Un `SyncQueueItem` con `error_class='STALE_WRITE_CONFLICT'` no se reintenta automáticamente ni se hace overwrite. El payload se preserva.
**Motivación:** Si dos dispositivos editaron la misma orden offline, la resolución requiere decisión humana. El sistema no puede adivinar cuál versión es la correcta.

### I12 — Items cancelados no se eliminan del JSONB

`OrderItem.cancelled = true` es el único mecanismo de cancelación. Nunca `items.splice()`.
**Motivación:** El ticket impreso ya salió. El audit trail debe reflejar exactamente lo que se pidió, qué se canceló y qué se cobró.

---

## 9. Casos Borde

### 9.1 Dos meseros abren la misma mesa simultáneamente

Escenario: mesa 5 está disponible. Mesero A y Mesero B la abren al mismo tiempo en dispositivos diferentes.

Resultado: ambas órdenes se crean exitosamente en `pos_orders` (son UUIDs diferentes). La vista de mesas mostrará la mesa como "ocupada" con la primera orden que llegó al servidor. La segunda orden existe pero sin mesa asociada a la UI. El gerente debe resolver manualmente con `r1_merge_orders` o cancelando una.

### 9.2 Pago offline y sincronización posterior

Escenario: el POS está offline. El mesero cierra una cuenta y el pago queda encolado en IndexedDB.

Resultado: el `SyncQueueItem` tiene `transport='APP_API'`. Al reconectar, `replayViaAppApi()` llama `r1_save_order_idempotent` con el `save_operation_id` original. Si la orden no fue modificada en el servidor (otro dispositivo), la operación se aplica normalmente. Si hubo modificación → `STALE_WRITE_CONFLICT`.

### 9.3 Orden cerrada y luego reabierta

`reopenOrder()` cambia status de `cerrada` a `enviada` y limpia `closed_at` y `metodo_pago`. **No revierte la deducción de inventario.** Los ingredientes ya deducidos quedan deducidos. Al cerrar nuevamente, `r1_reconcile_order` verifica `last_inventory_processed_revision` y puede deducir nuevamente si la revisión no coincide.

⚠️ DISCREPANCIA: `reopenOrder()` en `pos-data.ts:2520` escribe directamente a `pos_orders` via PATCH REST sin pasar por `r1_save_order`. Esto bypasea el OCC y no incrementa `order_revision`. Es una deuda técnica conocida.

### 9.4 Turno stale al iniciar el día

Si el turno del día anterior no se cerró (caída de luz, olvido), `getActiveTurnoWithStaleCheck()` detecta `isStale=true`. El POS ofrece auto-cierre con `autoCloseStaleTurno()` antes de permitir abrir un turno nuevo.

### 9.5 Modificador con precio en el campo `modificadores` string

El campo `OrderItem.modificadores` es `string[]`. Cuando un modificador tiene precio, el string incluye el sufijo `" +$XX"`, por ejemplo: `"Extra queso +$25"`. El campo `precioExtra` contiene la suma numérica de estos extras. Esta representación es legacy; el sistema multilevel usa `ModifierGroupDef` con precios separados.

### 9.6 Menu item sin receta configurada

Si un platillo se vende pero no tiene receta en `pos_recipes_old` ni en `pos_recipe_versions`, `r1_reconcile_order` retorna `inventory_status='SKIPPED'` para ese item. No es un error — simplemente no hay deducción. Esto es normal para items de Market (que usan `pos_market_stock` directamente).

### 9.7 Orden sin mesa (cuenta por nombre)

`Order.mesa = 0` y `Order.clienteNombre = "#SR RAUL"` (estilo Wansoft). La vista de mesas no muestra estas órdenes en el mapa físico. Se listan separadamente. La invariante de `turno_id` aplica igual.

### 9.8 Replay idempotente de una operación que fue rechazada

Si `r1_save_order` rechazó la operación original (por `STALE_WRITE`), y el cliente reintenta con el mismo `save_operation_id`, el servidor detecta el replay pero retorna `idempotent_replay_of_rejected`. El sistema offline clasifica esto como `STALE_WRITE_CONFLICT` y no reintenta.

### 9.9 Batch de comanda en items de diferentes estaciones

Un único "envío a cocina" puede contener items con `station='cocina'` y `station='barra'`. El sistema imprime comandas separadas por estación pero todos comparten el mismo `comanda_batch_id`. El KDS de cocina solo ve items de `station='cocina'`.

---

## 10. Limitaciones Actuales (Deuda Técnica)

### L1 — Sistema de recetas dual (legacy y canónico)

El código de producción usa `pos_recipes_old` (tabla flat sin versiones). El sistema canónico R1 (`pos_recipe_versions` + `pos_recipe_lines`) existe en la base de datos y tiene la función `activate_recipe_version`, pero el código TypeScript en `getRecipes()` y `getRecipeForItem()` todavía lee de `pos_recipes_old`. **Migración pendiente.**

### L2 — COMPAT BRIDGE en pos_inventory_movements

`pos_inventory_movements` tiene dos columnas de referencia: `product_id` (BIGINT → `pos_inventory_products`) para el sistema nuevo, e `ingredient_id` (TEXT → `pos_ingredients`) para compatibilidad. Todo el código TypeScript usa `ingredient_id`. La migración a `product_id` está documentada en `docs/INVENTORY-MIGRATION.md` pero no completada.

#### Rationale: Por qué existe el COMPAT BRIDGE en pos_inventory_movements

- **Problema [HECHO]:** El sistema de inventario fue diseñado originalmente con `ingredient_id` (TEXT) como clave de referencia al ingrediente, derivado de `pos_ingredients`. En la revisión R1, se introdujo el concepto de `pos_inventory_products` con `product_id` BIGINT — un modelo más robusto con UUID y relación explícita. La migración no puede hacerse en un corte limpio porque el código cliente aún usa `ingredient_id` en todos los puntos de escritura y lectura.
- **Alternativas consideradas [INFERENCIA]:** (a) Migración big-bang: renombrar la columna en producción y actualizar todo el código en un solo deploy. Alto riesgo — una falla en producción durante el servicio dejaría el inventario inconsistente. (b) Vista de compatibilidad: exponer una vista que traduzca `ingredient_id` a `product_id`. Introduce latencia y complejidad adicional.
- **Elección [HECHO]:** Columna de compatibilidad temporal (`ingredient_id TEXT`) junto a la columna de destino (`product_id BIGINT`). El código nuevo puede escribir a `product_id` mientras el código legacy sigue usando `ingredient_id`. Ambas columnas coexisten hasta que la migración esté completa.
- **Tradeoffs [HECHO]:** Deuda conocida y explícita. Requiere que cualquier query sobre movimientos de inventario sepa cuál columna consultar según la antigüedad del registro.
- **Cuándo replantear [PENDIENTE]:** Ver `docs/INVENTORY-MIGRATION.md`. La migración completa a `product_id` es parte del roadmap mediano plazo (post-cutover).

### L3 — reopenOrder bypasea OCC

`reopenOrder()` usa PATCH directo a Supabase REST sin pasar por `r1_save_order`. No incrementa `order_revision`. Si otro dispositivo tiene la misma orden cacheada, el siguiente save desde ese dispositivo podría rechazarse con `STALE_WRITE` aunque `reopenOrder()` ya aplicó el cambio.

### L4 — Offline boot no está implementado

El Electron app carga desde la URL de Vercel. Sin internet, la aplicación no carga en absoluto. El medio de operación offline durante el servicio (ya está conectado, pierde red) funciona, pero no el escenario de "arrancar el POS sin red". Esto es un P0 antes del cutover.

### L5 — 62 tablas sin migration SQL documentada

El informe SCHEMA-INFRASTRUCTURE-REPORT.md identifica 62 tablas creadas directamente en el SQL Editor de Supabase sin archivos de migración correspondientes. Estas tablas no pueden recrearse ni versionarse sin exportarlas manualmente.

### L6 — Órdenes de Producción en wansoft_data

El módulo de producción (`/inventario-real/produccion`) guarda órdenes de producción en la tabla genérica `wansoft_data` usando `data_key=production_order_*`. No existe una tabla dedicada `pos_production_orders`. Esto hace difícil hacer queries estructurados sobre el historial de producción.

### L7 — MESEROS es una variable mutable del módulo

`export let MESEROS: string[] = []` en `pos-data.ts` es una variable mutable del módulo. Es compartida entre instancias (si hubiera SSR) y puede causar race conditions en el populate inicial. Se mitiga con `fetchMeseros()` que lo actualiza explícitamente en el init del POS.

### L8 — Permisos hardcodeados en código

Los perfiles de permisos están en `pos-permissions.ts` como constantes TypeScript. Cambiar permisos requiere deploy. No hay tabla en DB para gestionar permisos por tenant.

### L9 — Alias de recetas hardcodeados (RECIPE_ALIASES)

El mapeo entre nombres del menú del POS y nombres en la base de recetas está hardcodeado en `RECIPE_ALIASES`. Cada vez que se agrega un item al menú, hay que agregar su alias manualmente si el nombre no coincide exactamente.

#### Rationale: Por qué existe normalizeRecipeName y RECIPE_ALIASES

- **Problema [HECHO]:** Los nombres de los ítems del menú en `pos_menu_items` no coinciden exactamente con los nombres de las recetas en `pos_recipes_old`. Los nombres del menú contienen prefijos de marca ("SPRW -"), tamaños ("14oz", "16oz"), temperaturas ("caliente", "frío", "ice"), y variantes ("half & half"). Los nombres de las recetas son más cortos y canónicos. El matching exacto por nombre produce cero coincidencias para muchos ítems.
- **Alternativas consideradas [INFERENCIA]:** (a) Renombrar los ítems del menú para que coincidan con las recetas: requeriría actualizar todos los tickets históricos y podría romper reportes existentes. (b) Renombrar las recetas para que coincidan con el menú: igualmente disruptivo. (c) Usar ID canónico en lugar de nombre: la solución correcta a largo plazo, pero requiere agregar `recipe_id` a `pos_menu_items` y una UI para configurarlo.
- **Elección [HECHO]:** `normalizeRecipeName()` aplica reglas de limpieza (quitar prefijos, sufijos de tamaño, palabras de temperatura) y `RECIPE_ALIASES` provee un mapa de excepciones para casos que la normalización no resuelve automáticamente.
- **Tradeoffs [HECHO]:** La normalización puede producir falsos positivos (dos ítems distintos que normalizan al mismo nombre). `RECIPE_ALIASES` es AMALAY-específico y hardcodeado en el bundle compartido — bloquea la escalabilidad multi-tenant del sistema de inventario.
- **Cuándo replantear [PENDIENTE]:** Cuando el menú tenga un campo `recipe_id` explícito que relacione cada ítem de menú con su receta canónica. En ese momento, `normalizeRecipeName` y `RECIPE_ALIASES` se vuelven obsoletos y se eliminan.

---

## 11. Roadmap

### Corto plazo (pre-cutover)

1. **Offline boot:** empaquetar el frontend en el bundle del Electron app para no depender de Vercel al arrancar.
2. **Migration SQL para 62 tablas:** generar archivos de migración desde el schema export de Supabase.
3. **reopenOrder via r1_save_order:** migrar `reopenOrder()` para pasar por el RPC con OCC.

### Mediano plazo (post-cutover, 100 restaurantes)

4. **Migrar de pos_recipes_old a pos_recipe_versions:** activar el sistema canónico R1 y deprecar la tabla flat.
5. **COMPAT BRIDGE to product_id:** completar la migración de `ingredient_id` → `product_id` en `pos_inventory_movements`.
6. **Tabla dedicada para production_orders:** crear `pos_production_orders` y migrar del hacky `wansoft_data`.
7. **Device JWT:** implementar "Design C" de aislamiento por terminal (pos_clients → device JWT en header).
8. **Permisos en DB:** tabla `pos_client_permissions` para que cada tenant configure sus permisos sin deploy.

### Largo plazo (plataforma)

9. **Terminal propia:** hardware tipo Toast/Clip con Fullsite embebido.
10. **Cloudflare Turnstile:** proteger las páginas de integración contra scraping no autorizado.

---

## 12. Referencias al Código

### Tipos TypeScript

| Entidad | Interface / Type | Archivo | Status |
|---|---|---|---|
| Order | `Order` | `src/lib/pos-data.ts:625` | [HECHO] |
| OrderItem | `OrderItem` | `src/lib/pos-data.ts:164` | [HECHO] |
| Mesa | `Mesa` | `src/lib/pos-data.ts:655` | [HECHO] |
| PagoForma | `PagoForma` | `src/lib/pos-data.ts:620` | [HECHO] |
| ComandaBatch | `ComandaBatch` | `src/lib/pos-data.ts:1253` | [HECHO] |
| KitchenOrderFromDB | `KitchenOrderFromDB` | `src/lib/pos-data.ts:1259` | [HECHO] |
| SaveOrderResult | `SaveOrderResult` | `src/lib/pos-data.ts:1108` | [HECHO] |
| SaveResult (servidor) | `SaveResult` | `src/app/api/pos/save-order/route.ts:21` | [HECHO] |
| AuditAction | `AuditAction` (type union) | `src/lib/pos-data.ts:1320` | [HECHO] |
| AuditEvent | `AuditEvent` | `src/lib/pos-data.ts:1354` | [HECHO] |
| AuditLogEntry | `AuditLogEntry` | `src/lib/pos-data.ts:1404` | [HECHO] |
| Ingredient | `Ingredient` | `src/lib/pos-data.ts:1574` | [HECHO] |
| RecipeRow | `RecipeRow` | `src/lib/pos-data.ts:1586` | [HECHO] |
| InventoryItem | `InventoryItem` | `src/lib/pos-data.ts:1598` | [HECHO] |
| InventoryMovement | `InventoryMovement` | `src/lib/pos-data.ts:1613` | [HECHO] |
| MovementType | `MovementType` | `src/lib/inventory.ts:38` | [HECHO] |
| MovementRequest | `MovementRequest` | `src/lib/inventory.ts:57` | [HECHO] |
| MovementResult | `MovementResult` | `src/lib/inventory.ts:66` | [HECHO] |
| PurchaseOrder | `PurchaseOrder` | `src/lib/pos-data.ts:2245` | [HECHO] |
| PurchaseOrderItem | `PurchaseOrderItem` | `src/lib/pos-data.ts:2264` | [HECHO] |
| Factura | `Factura` | `src/lib/pos-data.ts:2276` | [HECHO] |
| CFDIRequest | `CFDIRequest` | `src/lib/pos-data.ts:2576` | [HECHO] |
| PaymentMethodDB | `PaymentMethodDB` | `src/lib/pos-data.ts:351` | [HECHO] |
| ModifierGroupDef | `ModifierGroupDef` | `src/lib/pos-data.ts:423` | [HECHO] |
| ModificadorAgregar | `ModificadorAgregar` | `src/lib/pos-data.ts:195` | [HECHO] |
| MenuItem | `MenuItem` | `src/lib/pos-data.ts:149` | [HECHO] |
| MenuCategory | `MenuCategory` | `src/lib/pos-data.ts:157` | [HECHO] |
| SyncQueueItem | `SyncQueueItem` | `src/lib/pos-offline-db.ts:22` | [HECHO] |
| ReplayTransport | `ReplayTransport` | `src/lib/pos-offline-db.ts:14` | [HECHO] |
| SyncErrorClass | `SyncErrorClass` | `src/lib/pos-offline-db.ts:20` | [HECHO] |
| AgentRun | `AgentRun` | `src/lib/data.ts:381` | [HECHO] |
| POSPermissions | `POSPermissions` | `src/lib/pos-permissions.ts:7` | [HECHO] |
| MarketStockRow | `MarketStockRow` | `src/lib/pos-data.ts:1995` | [HECHO] |
| MarketMovement | `MarketMovement` | `src/lib/pos-data.ts:2010` | [HECHO] |
| RecipeDetail | `RecipeDetail` | `src/lib/pos-data.ts:2473` | [HECHO] |

### Funciones clave del cliente

| Función | Archivo | Status |
|---|---|---|
| `saveOrder()` | `src/lib/pos-data.ts:1120` | [HECHO] |
| `getActiveTurno()` | `src/lib/pos-data.ts:371` | [HECHO] |
| `openTurno()` | `src/lib/pos-data.ts:404` | [HECHO] |
| `getActiveTurnoWithStaleCheck()` | `src/lib/pos-data.ts:384` | [HECHO] |
| `fetchMeseros()` | `src/lib/pos-data.ts:1044` | [HECHO] |
| `verifyManagerPin()` | `src/lib/pos-data.ts:1459` | [HECHO] |
| `verifyPinWithMinRole()` | `src/lib/pos-data.ts:1538` | [HECHO] |
| `logAudit()` | `src/lib/pos-data.ts:1365` | [HECHO] |
| `deductMarketStockForOrder()` | `src/lib/pos-data.ts:2184` | [HECHO] |
| `recordMovement()` | `src/lib/inventory.ts:101` | [HECHO] |
| `getModifierGroupsForItem()` | `src/lib/pos-data.ts:458` | [HECHO] |
| `getMenuCategoriesFromDB()` | `src/lib/pos-data.ts:317` | [HECHO] |
| `queueOperation()` | `src/lib/pos-offline-db.ts:148` | [HECHO] |
| `syncAll()` | `src/lib/pos-offline-db.ts:360` | [HECHO] |
| `getPermissions()` | `src/lib/pos-permissions.ts:189` | [HECHO] |
| `computeMarketDeductions()` | `src/lib/pos-data.ts:2032` | [HECHO] |
| `restockFromPurchaseOrder()` | `src/lib/pos-data.ts:2421` | [HECHO] |

### Funciones PostgreSQL (RPCs)

| Función | Estado | Notes |
|---|---|---|
| `r1_save_order` | [HECHO] | OCC, production |
| `r1_save_order_idempotent` | [HECHO] | + idempotencia por save_operation_id |
| `r1_reconcile_order` | [HECHO] | Deducción de inventario al cerrar |
| `r1_reconcile_item` | [HECHO] | Deducción de un ingrediente específico |
| `r1_merge_orders` | [HECHO] | Fusionar órdenes (juntar mesas) |
| `r1_adjust_market_stock` | [HECHO] | Ajuste de stock Market con autoridad |
| `activate_recipe_version` | [HECHO] | Activar versión canónica de receta |
| `set_pos_order_number` | [HECHO] | Trigger en INSERT de pos_orders |
| `r1_legacy_sale_deduction` | [HECHO] | Deducción legacy (Sistema A) |
| `r1_observation_sample` | [INFERENCIA] | Muestreo para tablas r1_observation_* |

### Schema SQL documentado en código (SQL comments en pos-data.ts)

Estas tablas tienen su DDL en comentarios del archivo TypeScript `src/lib/pos-data.ts`:
- `pos_orders` (línea 6)
- `pos_audit_log` (línea 28)
- `pos_ingredients` (línea 49)
- `pos_recipes` (línea 60)
- `pos_inventory` (línea 71)
- `pos_inventory_movements` (línea 83)
- `pos_purchase_orders` (línea 101)
- `pos_purchase_order_items` (línea 119)
- `pos_facturas` (línea 133)
- `pos_cfdi_requests` (línea 2551)

### Rutas API relevantes

| Ruta | Función | Status |
|---|---|---|
| `POST /api/pos/save-order` | Guarda orden, llama r1_save_order + r1_reconcile_order | [HECHO] |
| `POST /api/pos/pin` | Verifica PIN de staff | [HECHO] |
| `POST /api/pos/adjust-market` | Ajuste de stock Market via RPC | [HECHO] |
| `POST /api/pos/deduct-market` | Deducción de Market al vender | [HECHO] |

### Páginas principales del POS

| Página | Ruta | Propósito |
|---|---|---|
| POS principal | `/pos` | Crear y gestionar órdenes |
| KDS cocina | `/pos/kds` | Display de cocina, marca items listos |
| Mesas | `/pos/mesas` | Vista del mapa de mesas |
| Compras | `/pos/compras` | Gestión de OCs y facturas |
| Corte | `/pos/corte` | Cierre de turno |
| Monitor | `/pos/monitor` | Vista de operador en tiempo real |

---

## Apéndice: Glosario de Términos del Negocio

**Almacén:** Área física de recepción y almacenamiento de insumos. Los movimientos se registran como `pos_inventory_movements`.

**Arqueo de caja:** Conteo del efectivo en caja al cierre de turno. Se compara contra suma de pagos en `Efectivo` del turno.

**Batch (comanda batch):** Un envío específico de items a cocina. UUID único. Todos los items del mismo envío comparten `comanda_batch_id`.

**CFDI:** Comprobante Fiscal Digital por Internet. Factura electrónica requerida por el SAT mexicano.

**Cocina:** Estación de preparación de alimentos. Items con `station='cocina'` se imprimen/muestran en cocina.

**Comanda:** Ticket o pantalla que muestra los items pedidos a cocina.

**Corte X / Z:** Corte X = reporte parcial (turno sigue abierto). Corte Z = reporte final y cierre de turno.

**Cuenta:** Sinónimo de Orden en contexto de servicio.

**Fondo inicial:** Efectivo de arranque en caja al abrir turno.

**Huella digital:** Autenticación biométrica via lector HID. Alternativa al PIN para staff.

**IVA:** Impuesto al Valor Agregado. Rate configurado en `pos-constants.ts`.

**KDS:** Kitchen Display System. Pantalla en cocina para ver comandas en tiempo real.

**Ledger:** Registro append-only de transacciones. `pos_inventory_movements` es el ledger de inventario.

**Market:** Sección de retail de AMALAY (proteínas, snacks, accesorios). Usa `pos_market_stock` en lugar de sistema de recetas/ingredientes.

**Merma:** Desperdicio de insumos. Tipo de movimiento `waste` en el inventario.

**Mesa:** Mesa física numerada del restaurante. No tiene tabla propia.

**OC (Orden de Compra):** Solicitud formal de compra a un proveedor.

**OCC:** Optimistic Concurrency Control. Sistema de control de escrituras concurrentes via `order_revision`.

**Propina:** Cantidad adicional al total. No incluida en `total`, sí debe incluirse en `pagos`.

**R1:** Sistema de reconciliación de inventario server-side. Función PostgreSQL `r1_reconcile_order`.

**Receta:** Descripción de ingredientes de un platillo. Define qué se deduce del inventario al vender.

**Revisión:** Campo `order_revision` INTEGER. Se incrementa en cada mutación exitosa de una orden. Base del OCC.

**RPC:** Remote Procedure Call. Funciones PostgreSQL llamadas via `/rest/v1/rpc/{nombre}`.

**Stale write:** Escritura con `expected_revision` desactualizado. Rechazada por `r1_save_order`.

**Tentáculo:** Grupo de agentes IA con responsabilidad temática (ops, reportes, kb, orquestador).

**Tiempo:** División de una comida. `courseId=1` = primer tiempo, `courseId=2` = segundo, etc.

**Turno:** Período operativo. Unidad de accountability financiero. Toda orden requiere `turno_id`.

**Yield factor:** Factor de rendimiento de un ingrediente. Si `yield_factor=0.85`, pierde 15% en preparación. El costo efectivo = `cost_per_unit / yield_factor`.

---

## Cross References

Las siguientes Bibles contienen información relacionada. No se duplica aquí — se referencia.

**→ POS Bible** — Ver § Flujos principales para cómo se crea y transiciona una Order en el flujo real de operación. Ver § State Machines para las máquinas de estado desde la perspectiva del usuario.

**→ Engineering Bible** — Ver § Arquitectura (Transaction A/B) para cómo se persiste una Order en el servidor. Ver § Source of Truth para la tabla completa de fuentes autoritativas por entidad. Ver § Flujos principales (save online / save offline / replay) para el ciclo de vida técnico de una Order.

**→ Operations Bible** — Ver § Flujos principales (Un día completo) para cómo las entidades del dominio se usan en operación real. Ver § Reglas de negocio para las restricciones por rol sobre cada entidad.

**→ Master Bible** — Ver § Source of Truth (tabla global) para el mapa completo de todas las entidades del sistema. Ver § Decision Log para las decisiones que afectan la estructura de las entidades.

**→ Dashboard Bible** — Ver § Source of Truth para qué campos de pos_orders, pos_inventory, y pos_turnos alimentan cada visualización del dashboard.

---

## Open Questions & Future Work

Esta sección es el backlog arquitectónico del dominio. Incluye dudas surgidas durante el análisis, deuda técnica identificada, decisiones pendientes e inconsistencias encontradas.

---

**[INCONSISTENCIA]** `reopenOrder()` bypasea OCC
> Descripción: `reopenOrder()` en `src/lib/pos-data.ts:2520` [HECHO] hace un PATCH directo a Supabase REST sin pasar por `r1_save_order`. No incrementa `order_revision`. Si otro dispositivo tiene la misma orden cacheada con la revisión pre-reapertura, el siguiente `saveOrder()` desde ese dispositivo se rechazará con `STALE_WRITE_REJECTED` aunque la reapertura ya fue aplicada.
> Impacto: En un restaurante con múltiples terminales, una reapertura de cuenta puede causar confusión de revisiones y bloquear la operación en el segundo dispositivo hasta que recargue.
> Prioridad sugerida: P1

---

**[DEUDA]** Dos sistemas de recetas activos simultáneamente
> Descripción: `pos_recipes_old` (sistema legacy flat) [HECHO] y `pos_recipe_versions` + `pos_recipe_lines` (sistema R1 canónico) [HECHO] coexisten en la base de datos. El código TypeScript usa exclusivamente `pos_recipes_old` (`getRecipes()`, `getRecipeForItem()` en `src/lib/pos-data.ts:1637,1658`). El sistema canónico tiene su infraestructura completa (función `activate_recipe_version`, vista `pos_recipes_canonical`) pero no hay código cliente que lo consuma.
> Impacto: El sistema R1 de reconciliación de inventario podría estar leyendo de la tabla incorrecta o no encontrar recetas si la migración de datos no se completó. Las sub-recetas y factores de rendimiento del sistema R1 no tienen efecto en las deducciones actuales.
> Prioridad sugerida: P0 (antes de depender de reconciliación automática en producción)

---

**[DEUDA]** COMPAT BRIDGE en `pos_inventory_movements`
> Descripción: La tabla `pos_inventory_movements` tiene dos columnas de referencia al ingrediente: `product_id` (BIGINT → `pos_inventory_products`, nuevo) e `ingredient_id` (TEXT → `pos_ingredients`, legacy). El comentario SQL en `src/lib/pos-data.ts:86` [HECHO] dice "temporary, maps to pos_ingredients.id". Todo el código TypeScript usa `ingredient_id`. No hay código que escriba a `product_id`.
> Impacto: Si las funciones PostgreSQL de R1 (`r1_reconcile_order`, `r1_reconcile_item`) leen de `product_id`, las deducciones automáticas pueden estar fallando silenciosamente. Requiere verificar el cuerpo de las RPCs.
> Prioridad sugerida: P0

---

**[DUDA]** ¿Qué tabla lee `r1_reconcile_order` para las recetas?
> Descripción: No se verificó el cuerpo SQL de `r1_reconcile_order` directamente. [INFERENCIA] Se asume que lee de `pos_recipe_versions` + `pos_recipe_lines` (sistema R1 canónico) basado en el diseño documentado. Pero el código cliente usa `pos_recipes_old`. Si el RPC y el cliente leen tablas diferentes, podría haber discrepancias en qué se deduce.
> Impacto: Si la deducción automática usa recetas que no coinciden con lo que el cajero ve en pantalla, el inventario diverge del esperado.
> Prioridad sugerida: P0

---

**[INCONSISTENCIA]** `pos_clients` vs `clients` — dos tablas de clientes
> Descripción: El schema report [HECHO] lista tanto `clients` (38 columnas, clasificación Critical) como `pos_clients` (16 columnas, clasificación "Legacy/duplicate, Low"). No está claro cuál es la fuente activa ni si hay datos en ambas o solo en `clients`.
> Impacto: Si código futuro crea lógica sobre `pos_clients` asumiendo que es la tabla activa, puede leer datos desactualizados o vacíos.
> Prioridad sugerida: P2

---

**[DEUDA]** 62 tablas sin migration SQL
> Descripción: El `SCHEMA-INFRASTRUCTURE-REPORT.md` [HECHO] identifica 62 tablas creadas directamente en el SQL Editor de Supabase sin archivos de migración. Incluye tablas críticas: `pos_turnos`, `pos_staff`, `clients`, `agent_runs`, `pos_cfdi_requests`.
> Impacto: Si el proyecto de Supabase se destruye o migra a otra instancia, estas 62 tablas deben recrearse manualmente desde el schema export. Sin migraciones versionadas, es imposible hacer un "dry run" de la infraestructura.
> Prioridad sugerida: P1

---

**[DEUDA]** Offline boot no implementado
> Descripción: El Electron app carga la UI desde la URL de Vercel [INFERENCIA basada en `project_offline_debt.md` en MEMORY]. Si el dispositivo no tiene internet al arrancar, la aplicación no carga. El modo offline durante la operación (ya está conectado, pierde red) sí funciona via IndexedDB.
> Impacto: Un corte de luz + reset del router antes de abrir el restaurante significa que el POS no arranca. Esto viola la promesa de confiabilidad.
> Prioridad sugerida: P0 (blocker pre-cutover)

---

**[DUDA]** ¿El campo `agent_runs.tentacle` está poblado consistentemente?
> Descripción: El tipo TypeScript `AgentRun` en `src/lib/data.ts:381` [HECHO] no incluye `tentacle` aunque el `CLAUDE.md` documenta que la tabla tiene ese campo. El código en `src/proxy.ts:59` [HECHO] escribe `tentacle: 'security'` al registrar runs de anti-scraping, confirmando que el campo existe. Sin embargo, no es claro si todos los GitHub Actions scripts llenan este campo correctamente.
> Impacto: Filtrar `agent_runs` por tentáculo para dashboards o alertas puede dar resultados incompletos si algunos runs no tienen `tentacle`.
> Prioridad sugerida: P2

---

**[DECISIÓN PENDIENTE]** ¿Cuándo activar el Device JWT (Design C)?
> Descripción: El diseño de aislamiento por terminal (Device JWT, "Design C") está documentado en `project_tenant_isolation.md` [INFERENCIA, no verificado en código]. La memoria dice "Post-cutover. Do NOT implement before validation." No hay código de Device JWT en el repositorio.
> Impacto: Sin Device JWT, el aislamiento multi-tenant depende enteramente de `client_id` en las queries del cliente + RLS en Supabase. Una vulnerabilidad en el cliente puede exponer datos cross-tenant.
> Prioridad sugerida: P1 (post-cutover, antes de 100 restaurantes)

---

**[INCONSISTENCIA]** `RECIPE_ALIASES` hardcodeado en cliente
> Descripción: `RECIPE_ALIASES` en `src/lib/pos-data.ts:544` [HECHO] mapea nombres del menú del POS a nombres en la base de recetas. Este mapeo es AMALAY-específico y hardcodeado en el bundle compartido entre todos los tenants. Para un segundo cliente con diferentes nombres de platillos, este código no funcionará.
> Impacto: Bloquea la escalabilidad multi-tenant del sistema de inventario. Cada nuevo restaurante necesitaría su propio `RECIPE_ALIASES`.
> Prioridad sugerida: P1 (antes de onboardear el segundo restaurante)

---

**[DUDA]** ¿`r1_reconcile_order` es idempotente?
> Descripción: El campo `last_inventory_processed_revision` en `pos_orders` [HECHO, verificado en `route.ts:141`] se usa para detectar si ya se procesó una revisión. La lógica en `save-order/route.ts` verifica si `last_inventory_processed_revision < committedRevision` para decidir si llamar la reconciliación. Sin embargo, no se verificó si la función PostgreSQL `r1_reconcile_order` es internamente idempotente o puede crear movimientos duplicados si se llama dos veces para la misma revisión.
> Impacto: Un retry del replay offline podría generar dos deducciones del mismo ingrediente por la misma venta.
> Prioridad sugerida: P0

---

**[DEUDA]** `MESEROS` como variable mutable de módulo
> Descripción: `export let MESEROS: string[] = []` en `src/lib/pos-data.ts:1040` [HECHO] es una variable mutable del módulo JavaScript. En el contexto de Next.js con múltiples workers o SSR, puede ser compartida entre requests, causando que un tenant vea los meseros de otro.
> Impacto: En un entorno multi-tenant con múltiples usuarios concurrentes en el servidor, podría haber cross-contamination de datos de staff entre sesiones.
> Prioridad sugerida: P1 (antes de escalar a múltiples restaurantes)
