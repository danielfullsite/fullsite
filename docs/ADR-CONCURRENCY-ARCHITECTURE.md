# ADR: Arquitectura de Concurrencia y Estado Compartido

> Architecture Decision Record
> Fecha: 2026-06-30
> Status: PROPUESTA — pendiente decision del founder
> Contexto: Auditoria de concurrencia revelo 4 bugs criticos de race condition
> en el POS. Este documento compara 3 opciones arquitectonicas antes de
> escribir una sola linea de codigo.

---

## El problema

Fullsite POS maneja el estado de una orden como un JSON monolitico en una
columna `items JSONB` de la tabla `pos_orders`. Cada escritura reemplaza
el JSON completo. No hay comunicacion entre terminales. No hay locking.

Esto produce 4 bugs criticos:
1. Items desaparecen cuando dos terminales editan la misma mesa
2. Doble cobro posible (`handlePayment` sin check de concurrencia)
3. Ordenes fantasma cuando dos terminales abren la misma mesa nueva
4. Cambios offline se pierden silenciosamente (409 tratado como exito)

Hoy AMALAY opera con una sola terminal POS. Los bugs no se manifiestan.
Pero el segundo restaurante, o la primera terminal adicional en AMALAY,
los activaria inmediatamente.

---

## Opcion A — Parches para cutover

### Que se hace

1. **Agregar `updated_at` check a `handlePayment`** — antes de cobrar,
   verificar que la orden no cambio desde que se cargo. Si cambio,
   mostrar error y recargar.

2. **Lock de mesa al abrir** — cuando un terminal abre una mesa, escribir
   un campo `locked_by` con device ID + timestamp. Otros terminales ven
   "Mesa en uso por [terminal]". Lock expira en 5 minutos si no se renueva.

3. **Arreglar 409 en sync offline** — en vez de `markSynced`, mostrar
   notificacion al usuario: "Esta orden fue modificada mientras estabas
   offline. Revisa mesa X." No silenciar.

4. **Polling cada 5s en la pagina POS** — recargar la orden de Supabase
   periodicamente para detectar cambios de otros terminales. Mostrar
   banner "Orden actualizada por otro terminal" si `updated_at` cambio.

5. **Separar KDS writes** — el KDS escribe a un campo `kds_status JSONB`
   separado, no al campo `items`. Asi POS y KDS no compiten por el
   mismo campo.

### Ventajas

- Implementacion rapida: 1-2 dias
- No rompe nada existente
- Suficiente para 1 terminal por restaurante
- Permite hacer el cutover de AMALAY esta semana
- Bajo riesgo de regresiones

### Desventajas

- La raiz del problema (JSON monolitico) sigue ahi
- Polling cada 5s no es realtime — hay una ventana de 5s para conflictos
- Lock de mesa es pesimista y puede causar bloqueos si un terminal crashea
- Cada nuevo flujo (split, merge, transfer) necesita su propio check de concurrencia
- No escala a multiples terminales editando la misma mesa simultaneamente
- Deuda tecnica que se acumula: cada parche agrega complejidad al JSON blob

### Deuda tecnica generada

- `updated_at` checks duplicados en 5+ funciones
- Campo `locked_by` que necesita cleanup (cron o TTL)
- Campo `kds_status` separado que duplica informacion del `items`
- Polling que consume ancho de banda y queries a Supabase
- Logica de conflicto dispersa en multiples archivos

### Tiempo de implementacion

- 1-2 dias de desarrollo
- 0.5 dia de testing
- Total: 2-3 dias

### Riesgo

- **Para AMALAY (1 terminal):** BAJO. Los parches previenen los escenarios mas peligrosos
- **Para 10 restaurantes:** MEDIO. El polling y los locks empiezan a no ser suficientes
- **Para 100 restaurantes:** ALTO. La deuda tecnica se vuelve inmanejable

---

## Opcion B — Modelo normalizado + Realtime

### Que se hace

Migrar de un JSON monolitico a tablas relacionales. El estado de la orden
se distribuye en multiples tablas donde cada fila es una unidad atomica.

#### Nuevo schema

```sql
-- La orden es solo metadata (mesa, mesero, status, totales)
pos_orders (
  id TEXT PK,
  client_id TEXT,
  mesa INTEGER,
  mesero TEXT,
  personas INTEGER,
  status TEXT,        -- abierta, enviada, cerrada, cancelada
  turno_id TEXT,
  notas TEXT,
  subtotal NUMERIC,
  iva NUMERIC,
  total NUMERIC,
  descuento NUMERIC,
  propina NUMERIC,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ
)

-- Cada item es una fila independiente
pos_order_items (
  id TEXT PK,
  order_id TEXT FK → pos_orders,
  menu_item_id TEXT,
  nombre TEXT,
  precio NUMERIC,
  cantidad INTEGER,
  subtotal NUMERIC,
  modificadores JSONB,    -- solo los mods de ESTE item
  notas TEXT,
  silla INTEGER,
  curso INTEGER,
  curso_status TEXT,       -- pending, fired, preparing, ready
  kds_done BOOLEAN DEFAULT false,
  cancelled BOOLEAN DEFAULT false,
  cancelled_by TEXT,
  cancelled_reason TEXT,
  sort_order INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)

-- Pagos separados (soporta split naturalmente)
pos_payments (
  id TEXT PK,
  order_id TEXT FK → pos_orders,
  metodo TEXT,
  monto NUMERIC,
  propina NUMERIC,
  referencia TEXT,         -- folio tarjeta, etc.
  created_at TIMESTAMPTZ
)

-- Descuentos con trazabilidad
pos_discounts (
  id TEXT PK,
  order_id TEXT FK → pos_orders,
  tipo TEXT,               -- porcentaje, monto, cortesia, 2x1
  valor NUMERIC,
  razon TEXT,
  approved_by TEXT,
  created_at TIMESTAMPTZ
)

-- Movimientos de caja
pos_cash_movements (
  -- ya existe, no cambia
)
```

#### Cambios en el POS

1. **Agregar item:** `INSERT INTO pos_order_items` — no toca el row de la orden
2. **Modificar item:** `UPDATE pos_order_items SET ... WHERE id = ?` — solo 1 fila
3. **Cancelar item:** `UPDATE pos_order_items SET cancelled = true WHERE id = ?`
4. **KDS marca listo:** `UPDATE pos_order_items SET kds_done = true WHERE id = ?`
5. **Cobrar:** `INSERT INTO pos_payments` + `UPDATE pos_orders SET status = 'cerrada'`
6. **Cargar orden:** `SELECT * FROM pos_orders WHERE mesa = ? AND status IN (...)`
   + `SELECT * FROM pos_order_items WHERE order_id = ?`

#### Supabase Realtime

```typescript
supabase
  .channel('pos-orders')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'pos_order_items',
    filter: `order_id=eq.${currentOrderId}`
  }, (payload) => {
    // Actualizar estado local con el cambio
    // No recargar todo — aplicar el delta
  })
  .subscribe()
```

#### Optimistic locking

```sql
-- Cada UPDATE incluye WHERE updated_at = ?
UPDATE pos_orders
SET mesa = $new_mesa, updated_at = NOW()
WHERE id = $id AND updated_at = $loaded_updated_at
RETURNING id;
-- Si RETURNING vacio → conflicto detectado
```

#### Migracion sin romper lo existente

1. Crear las nuevas tablas (`pos_order_items`, `pos_payments`, `pos_discounts`)
2. Agregar RLS policies
3. Escribir funcion de migracion que convierte JSON `items` a filas en `pos_order_items`
4. Actualizar el POS para leer/escribir de las nuevas tablas
5. Mantener el campo `items` JSONB como cache de lectura rapida (read model)
   durante la transicion — se puede eliminar despues
6. Las ordenes viejas (cerradas) no necesitan migrarse — solo las activas

### Ventajas

- **Elimina la raiz del problema:** cada item es independiente, no hay blob que sobreescribir
- **Concurrencia natural:** dos terminales pueden agregar items a la misma orden sin conflicto (INSERT, no UPDATE del mismo campo)
- **KDS independiente:** marca `kds_done` en su fila sin tocar las demas
- **Split nativo:** los pagos son filas separadas, no logica sobre un JSON
- **Realtime real:** Supabase Realtime notifica cambios item por item
- **Optimistic locking simple:** `WHERE updated_at = ?` en cada UPDATE
- **Auditable por diseno:** cada fila tiene `created_at`, `updated_at`, actor
- **Offline compatible:** INSERT de items se puede queued igual que hoy
- **Escala a N terminales:** no hay contention en un solo campo

### Desventajas

- **Implementacion:** 4-5 dias de desarrollo + 2 dias de testing
- **Migracion:** ordenes activas necesitan convertirse
- **Mas queries:** cargar una orden requiere 2+ queries en vez de 1
- **Complejidad de sync offline:** ahora son multiples tablas que sincronizar
- **Supabase Realtime:** agrega dependencia de WebSocket (que no funciona offline)
- **Cambio grande antes del cutover:** riesgo de regresiones

### Deuda tecnica generada

- Minima. El modelo normalizado es la forma correcta de modelar esto.
- El unico residuo seria el campo `items` JSONB si se mantiene como cache.

### Tiempo de implementacion

- 4-5 dias de desarrollo (schema + POS + KDS + sync)
- 2 dias de testing intensivo
- Total: 6-7 dias

### Riesgo

- **Para AMALAY:** MEDIO durante la migracion, BAJO despues
- **Para 10 restaurantes:** BAJO. El modelo soporta concurrencia naturalmente
- **Para 100 restaurantes:** BAJO. Escala sin cambios arquitectonicos

---

## Opcion C — Event Sourcing

### Que se hace

Cada accion del POS genera un evento inmutable. El estado de la orden
se deriva de la secuencia de eventos. No hay UPDATEs — solo INSERTs.

#### Schema

```sql
pos_events (
  id BIGSERIAL PK,
  stream_id TEXT,          -- order_id
  event_type TEXT,         -- item_added, item_cancelled, payment_processed, etc.
  version INTEGER,         -- numero secuencial por stream
  payload JSONB,           -- datos del evento
  actor TEXT,              -- quien lo hizo
  device_id TEXT,          -- desde donde
  created_at TIMESTAMPTZ DEFAULT NOW()
)

-- Indice para reconstruir una orden
CREATE INDEX ON pos_events (stream_id, version);

-- Vista materializada para lectura rapida
pos_orders_view AS (
  -- Se reconstruye desde eventos
  -- Trigger o CRON que actualiza despues de cada INSERT en pos_events
)
```

#### Ejemplo de flujo

```
Evento 1: { type: "order_opened", stream: "ord-123", payload: { mesa: 10, mesero: "Oscar" } }
Evento 2: { type: "item_added", stream: "ord-123", payload: { item: "Chilaquiles", precio: 189 } }
Evento 3: { type: "item_added", stream: "ord-123", payload: { item: "Cafe americano", precio: 65 } }
Evento 4: { type: "item_cancelled", stream: "ord-123", payload: { item_id: 2, reason: "cliente cambio", approved_by: "gerente" } }
Evento 5: { type: "discount_applied", stream: "ord-123", payload: { tipo: "cortesia", valor: 189, reason: "cliente frecuente" } }
Evento 6: { type: "payment_processed", stream: "ord-123", payload: { metodo: "Efectivo", monto: 65, propina: 10 } }
```

#### Resolucion de conflictos

No hay conflictos. Dos terminales pueden emitir eventos simultaneamente.
El orden cronologico determina el estado. `item_added` de POS-1 y
`item_added` de POS-2 son ambos validos — la orden tiene ambos items.

El unico conflicto real seria un `payment_processed` duplicado, que se
resuelve con `version` check: si la version esperada no coincide, rechazar.

### Beneficios reales

- **Cero conflictos por diseno:** INSERTs no compiten entre si
- **Auditoria perfecta:** cada evento es un hecho inmutable con actor y timestamp
- **Time travel:** puedes reconstruir el estado de cualquier orden en cualquier momento
- **Replay:** puedes recalcular totales, detectar fraude, corregir errores
- **Offline natural:** los eventos se generan offline y se sincronizan como append-only
- **Multi-terminal nativo:** cada terminal emite eventos independientemente
- **Debug total:** si algo sale mal, la secuencia de eventos te dice exactamente que paso

### Complejidad

- **Modelo mental diferente:** el equipo tiene que pensar en eventos, no en estado
- **Reconstruccion de estado:** leer una orden requiere recorrer todos sus eventos
- **Vista materializada:** necesitas un read model actualizado para queries rapidas
- **Snapshots:** para ordenes con muchos eventos, necesitas snapshots periodicos
- **Migracion de eventos:** si cambias el schema de un evento, los viejos siguen existiendo
- **Testing:** probar una secuencia de 20 eventos es mas complejo que probar un JSON

### Costo de mantenimiento

- **Bajo** si el equipo entiende el patron
- **Alto** si el equipo lo trata como una base de datos relacional
- La curva de aprendizaje es la barrera principal

### Cuando tiene sentido

- Cuando la auditoria y trazabilidad son requisitos de negocio (restaurantes: SI)
- Cuando multiples escritores concurrentes son la norma (multi-terminal: SI)
- Cuando el offline-first es critico (restaurantes: SI)
- Cuando necesitas reconstruir estado historico (reportes, fraude: SI)

### Cuando seria sobreingenieria

- Si solo operas 1 terminal por restaurante y nunca mas de 1
- Si no necesitas auditoria detallada
- Si el equipo es de 1 persona y no tiene tiempo de aprender el patron
- Si la velocidad de shipping es mas importante que la arquitectura

### Tiempo de implementacion

- 8-12 dias de desarrollo (event store + projections + migration + POS + KDS)
- 3-4 dias de testing
- Total: 12-16 dias

### Riesgo

- **Para AMALAY:** ALTO durante implementacion (cambio radical), BAJO despues
- **Para 10 restaurantes:** BAJO
- **Para 100 restaurantes:** MUY BAJO — escala sin cambios
- **Para 1,000 restaurantes:** MUY BAJO — el patron esta probado a esa escala

---

## Comparativa

| Criterio | Opcion A (Parches) | Opcion B (Normalizado) | Opcion C (Event Sourcing) |
|---|---|---|---|
| Tiempo de implementacion | 2-3 dias | 6-7 dias | 12-16 dias |
| Resuelve bugs criticos | Si (parcialmente) | Si (completamente) | Si (por diseno) |
| Concurrencia multi-terminal | Polling + locks | Realtime + row-level | Append-only, sin conflictos |
| Offline | Parche al 409 | Multi-tabla sync | Eventos append-only |
| Auditoria | Logs separados | Logs separados | Nativa en cada evento |
| Deuda tecnica | Alta | Baja | Minima |
| Riesgo de regresiones | Bajo | Medio | Alto (cambio radical) |
| Escala a 10 restaurantes | Con friccion | Si | Si |
| Escala a 100 restaurantes | No | Si | Si |
| Escala a 1,000 restaurantes | No | Con ajustes | Si |
| Complejidad para 1 developer | Baja | Media | Alta |
| Complejidad para equipo de 3+ | Baja | Baja | Media |

---

## Recomendacion

### Para 10 restaurantes: Opcion B

La normalizacion del modelo de datos es la decision correcta para una
startup que planea crecer. Resuelve la raiz del problema (JSON monolitico),
habilita concurrencia real, y no agrega complejidad excesiva para un
equipo pequeno.

### Para 100 restaurantes: Opcion B con elementos de C

A 100 restaurantes, la Opcion B sigue funcionando. Lo que agregarias es:
- Event log append-only ADEMAS del modelo normalizado (dual write)
- El event log alimenta analytics, fraude, y auditoria
- El modelo normalizado sigue siendo el state store primario
- Esto es mas pragmatico que event sourcing puro

### Para 1,000 restaurantes: Opcion C

A esta escala, event sourcing puro se justifica. El volumen de operaciones
concurrentes, la necesidad de auditoria regulatoria, y la complejidad de
sincronizacion offline hacen que el patron sea la eleccion natural. Pero
a 1,000 restaurantes ya no eres un solo developer — tienes equipo.

---

## La pregunta real: que hacer AHORA

### Dato clave: AMALAY opera con 1 terminal POS

Los 4 bugs criticos de concurrencia **no se manifiestan con 1 terminal**.
El unico escenario peligroso hoy es KDS vs POS (escenario C-5), que
se resuelve con el parche de separar `kds_status` del campo `items`.

### Mi recomendacion

**Hacer A ahora (2 dias) + B inmediatamente despues del cutover (1 semana).**

Razon:

1. **El cutover de AMALAY no puede esperar 2 semanas mas.** Cada dia sin
   cutover es un dia donde Wansoft sigue siendo el sistema principal y
   el momentum se pierde.

2. **Los parches de A son suficientes para 1 terminal.** AMALAY no va a
   agregar una segunda terminal POS en la primera semana.

3. **B se implementa la semana 2-3 post-cutover**, cuando AMALAY ya esta
   operando y estable. Esto tiene la ventaja de que el stress test real
   (turno completo) revela exactamente que flujos son criticos.

4. **B no es una reescritura** — es una migracion incremental. Las ordenes
   cerradas no se migran. Solo las nuevas usan el modelo normalizado.
   El JSON blob se mantiene como fallback de lectura durante la transicion.

5. **C se evalua cuando haya equipo.** Event sourcing con 1 developer es
   riesgo de sobreingenieria. Con 3+ developers y 50+ restaurantes, es
   la decision obvia.

### Plan concreto

```
SEMANA 0 (ahora):
  Dia 1: Parches A (updated_at en payment, fix 409, separar kds_status)
  Dia 2: Probar parches + definir Corte Z con AMALAY
  Dia 3: Implementar Corte Z + instalar en devices
  Dia 4: Shadow Day
  Dia 5: Cutover

SEMANA 2-3 (post-cutover, AMALAY estable):
  Dia 1-2: Schema migration (pos_order_items, pos_payments)
  Dia 3-4: Actualizar POS para leer/escribir de nuevas tablas
  Dia 5: Actualizar KDS
  Dia 6: Supabase Realtime
  Dia 7: Testing + segunda terminal

SEMANA 6+ (cuando haya equipo o segundo restaurante):
  Evaluar event log append-only como complemento de B
```

### Lo que NO recomiendo

- **Hacer B antes del cutover.** 7 dias de desarrollo + riesgo de regresiones
  cuando AMALAY ya esta listo para operar es una mala apuesta.

- **Hacer C ahora.** Event sourcing con 1 developer, sin equipo, antes del
  primer cliente en produccion es la definicion de sobreingenieria prematura.

- **No hacer nada.** Los bugs existen. Aunque no se manifiesten con 1 terminal,
  el segundo restaurante los activaria el dia 1.

---

## Decision pendiente

| Pregunta | Opciones |
|---|---|
| Que hacemos para el cutover? | A (parches, 2 dias) |
| Que hacemos post-cutover? | B (normalizacion, 1 semana) |
| Cuando evaluamos C? | Cuando haya equipo (3+ devs) o 50+ restaurantes |
| AMALAY agrega segunda terminal pronto? | Si si → B sube a pre-cutover |

**Esta decision es del founder.** Este documento presenta las opciones.
La recomendacion es A+B secuencial, pero si el founder prefiere hacer B
antes del cutover y atrasar una semana, es una decision valida.

---

> ADR generado 2026-06-30.
> Basado en auditoria de concurrencia de 8 escenarios.
> Archivos auditados: pos/page.tsx, pos-data.ts, pos-offline-db.ts,
> mesas/page.tsx, kds/page.tsx.
