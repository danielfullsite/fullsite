# OFFLINE-GAP-001 — Outbox Architecture

> P0-01 | Versión: 2026-07-27
> Contrato completo del Outbox del Local Server.
> Documento de diseño — sin código todavía.

---

## Contexto

El Local Server mantiene un event store en `events.ndjson`. Cada evento tiene un campo `synced: false` al ser creado. El campo `markSynced(sequences)` existe en la interfaz del EventStore. Sin embargo, **ningún componente del sistema llama `markSynced` de manera que persista la sincronización a Supabase**.

Esto no es un bug — es una omisión planificada en Phase 1. El comentario en `index.js` lo dice explícitamente:

```
// Supabase is still primary write authority (Phase 2 will change this)
```

En Phase 1, el POS browser hace su propio sync directamente a Supabase via `syncAll()`. El Local Server es un "observador" que propaga eventos vía WS pero no escribe a Supabase.

Este documento define el contrato que el Outbox del Local Server debe implementar en Phase 2.

---

## 1. Quién Produce Eventos

### Productor 1: Comandos de terminales (vía WS o HTTP)

Cuando un terminal envía un COMMAND al Local Server:

```
Terminal → WS COMMAND → CommandHandler.handle()
                              → CoreEventStore.processCommand()
                                    → NdjsonEventStore.append()
                                          → events.ndjson (synced: false)
```

El evento es producido por `CoreEventStore.processCommand()`. El `command_id` del terminal se convierte en el `id` del evento (pairing idempotente).

**Tipos de eventos producidos por terminales**:
- `ORDER_UPSERTED`, `ORDER_SENT`, `ORDER_CLOSED`, `ORDER_CANCELLED`
- `KDS_ITEM_STATUS`
- `MESA_LOCK`, `MESA_UNLOCK`
- `TURNO_OPENED`, `TURNO_CLOSED`
- `PRINT_COMMAND`

### Productor 2: Supabase poll (interno, solo Phase 1)

El Supabase poll genera eventos `STATE_SYNC` internamente vía `eventStore.appendInternal()`. Estos eventos NO deben sincronizarse hacia Supabase (serían redundantes — ya vienen de ahí). El outbox debe filtrarlos por tipo.

**Tipos de eventos que NO deben salir del outbox**:
- `STATE_SYNC`

---

## 2. Dónde Viven los Eventos

### Archivo: `userData/events.ndjson`

Una línea JSON por evento. Ejemplo:

```json
{"id":"abc123","type":"ORDER_SENT","ts":1753660000000,"sequence":42,"client_id":"terminal-uuid","restaurant_id":"rest-uuid","payload":{"order_id":"ord-uuid","mesa":"5","items":[...]},"synced":false}
```

### Archivo: `userData/processed-commands.ndjson`

Índice de idempotencia. Mapea `command_id → { eventId, sequence }`. Se carga en memoria en `load()`. Una línea por comando procesado.

### En memoria: `RestaurantState`

Proyección del event log. Se reconstruye en startup con `state.apply(ev)` para cada evento del log. El outbox NO lee de la state machine — lee directamente del event log.

---

## 3. Quién Consume los Eventos

### Consumidor 1 (Phase 1, ya implementado): Browser POS

El browser POS hace su propio sync a Supabase via `syncAll()` en `pos-offline-db.ts`. Este sync es independiente del event log del Local Server — usa su propia IDB sync_queue.

**Problema**: En Phase 2, el Local Server será la autoridad de escritura. El browser NO debe escribir directamente a Supabase — solo debe enviar comandos al Local Server. El sync a Supabase lo debe hacer el outbox del Local Server.

### Consumidor 2 (Phase 2, a implementar): Outbox Worker

Un proceso que lee `events.ndjson`, filtra eventos no sincronizados y los envía a Supabase. Una vez confirmado por Supabase, llama `markSynced(sequences)`.

### Consumidor 3 (ya implementado): WsHub broadcast

El `CommandHandler` llama `wsHub.broadcast(event)` inmediatamente después de procesar el evento. Este es un consumidor LAN, no de Supabase.

---

## 4. Cuándo se Considera Sincronizado un Evento

Un evento pasa de `synced: false` a `synced: true` cuando y solo cuando:

1. El outbox envía el evento a Supabase (upsert con idempotency key)
2. Supabase responde con 2xx
3. `markSynced([sequence])` es llamado
4. `NdjsonEventStore.markSynced()` reescribe el archivo con el flag actualizado

**Lo que NO cuenta como sincronizado**:
- El evento fue procesado por la state machine → solo en memoria
- El evento fue broadcast a terminales vía WS → solo LAN
- El browser POS envió su propia copia a Supabase → diferente canal

---

## 5. Garantías de Idempotencia

### Idempotencia del comando (ya implementada)

El `command_id` del terminal es el `id` del evento. Si el mismo comando llega dos veces al Local Server, el segundo es rechazado como `duplicate: true`. Solo hay un evento en `events.ndjson` por command_id.

### Idempotencia del outbox → Supabase (a implementar)

El outbox debe usar el `event.id` (que es el `command_id` original) como idempotency key al escribir a Supabase:

```
POST /rest/v1/pos_events
Prefer: resolution=merge-duplicates
Body: { id: event.id, type: event.type, ... }
```

Si el outbox envía el mismo evento dos veces (por retry), Supabase hace upsert y devuelve 2xx. El resultado es idéntico: un solo registro en Supabase.

**La clave es**: `event.id = command_id del terminal`. Esta cadena garantiza que una operación del operador resulta en exactamente un registro en Supabase, sin importar cuántas veces el outbox intente enviarlo.

---

## 6. Recovery Tras Reinicio

### Qué pasa hoy

Al reiniciar el Local Server:
1. `NdjsonEventStore.load()` lee `events.ndjson`
2. Reconstruye `_sequence` y `_unsyncedCount` leyendo todas las líneas
3. `CoreEventStore.load()` recarga el índice de `processed-commands.ndjson`

El estado de `synced: false` en el archivo es correcto — los eventos no sincronizados mantienen su estado entre reinicios.

### Qué debe pasar el outbox tras reinicio

1. Al iniciar el outbox worker: leer todos los eventos con `synced: false`
2. Enviarlos a Supabase en orden de secuencia (FIFO)
3. Marcar cada uno como synced después de confirmación

**Garantía requerida**: El outbox debe ser capaz de retomar desde donde quedó. Si fue interrumpido en el medio de un batch, al reiniciar debe detectar cuáles están sin `synced: true` y reenviarlos. Dado que la idempotencia de Supabase es por `event.id`, los reenvíos son seguros.

### Límite del log (pendiente)

El log crece indefinidamente en Phase 1 porque nadie llama `markSynced`. En Phase 2, el outbox debe marcar eventos como synced. A futuro (Phase 3), el log puede ser compactado: eliminar eventos más viejos que N días que estén `synced: true`.

---

## 7. Manejo de Conflictos del Outbox

### Conflicto tipo A: Supabase ya tiene un registro más nuevo

Escenario: El browser POS ya sincronizó una versión del evento directamente a Supabase (Phase 1). El outbox intenta sincronizar el evento del Local Server que tiene una revision diferente.

**Comportamiento esperado**: El outbox debe detectar el 409 o el mismatch de revision y marcar el evento como `synced: true` con `conflict_note: 'browser_already_synced'`. No debe sobreescribir.

**Por qué**: En Phase 1, el browser es la autoridad. El evento del Local Server es una "observación" redundante. En Phase 2, el orden se invierte — el Local Server es la autoridad.

### Conflicto tipo B: Supabase rechaza con validación

El evento contiene datos inválidos que Supabase rechaza (constraint violation, RLS, etc.).

**Comportamiento esperado**: Marcar el evento con `sync_error: 'TERMINAL_REJECTION'`. No reintentar indefinidamente. Notificar en heartbeat como `events_rejected`.

### Conflicto tipo C: Supabase no responde (timeout)

**Comportamiento esperado**: Retry con backoff exponencial. El evento permanece `synced: false`. El outbox retoma en el siguiente ciclo o al reiniciar.

**Garantía**: El outbox NUNCA descarta un evento. La durabilidad está en el archivo. El outbox solo es un lector + notificador de estado.

---

## 8. Interfaz Propuesta del Outbox Worker

```javascript
// local-server/outbox/worker.js
class OutboxWorker {
  constructor({ eventStore, supabaseUrl, supabaseKey, restaurantId })

  // Inicia el loop de sync. Llama a _syncBatch() cada INTERVAL_MS.
  start()

  // Detiene el worker limpiamente.
  stop()

  // Lee todos los eventos no sincronizados y los envía a Supabase.
  // Retorna { sent, failed, skipped }.
  async _syncBatch()

  // Envía un único evento a Supabase con idempotency.
  // Retorna { ok, conflict, rejection, error }.
  async _sendEvent(event)
}
```

### Tabla destino en Supabase

```sql
CREATE TABLE IF NOT EXISTS pos_local_events (
  id            UUID PRIMARY KEY,   -- = command_id del terminal
  sequence      INTEGER NOT NULL,
  type          TEXT NOT NULL,
  ts            BIGINT NOT NULL,
  client_id     UUID,
  restaurant_id UUID NOT NULL,
  payload       JSONB,
  synced_at     TIMESTAMPTZ DEFAULT NOW(),
  conflict_note TEXT         -- si hubo conflicto al sincronizar
);
```

El outbox hace `POST` con `Prefer: resolution=merge-duplicates`. Si el id ya existe, Supabase actualiza `synced_at`. Idempotente por diseño.

---

## 9. Decisiones Arquitectónicas (resueltas — requieren aprobación antes de implementar)

Las tres preguntas abiertas originales están respondidas aquí. No se implementa hasta que estas decisiones sean aprobadas explícitamente.

---

### Decisión 1: Tabla destino del outbox

**Pregunta**: ¿`pos_local_events` (nueva) o `pos_orders` (existente)?

**Decisión propuesta**: `pos_local_events` para el event log; `pos_orders` sigue como tabla de negocio.

**Razonamiento**:
- `pos_local_events` almacena eventos inmutables en orden de secuencia. Es un log de audit, no un estado.
- `pos_orders` es una proyección mutable del estado actual de las órdenes. Dos propósitos distintos requieren dos tablas.
- El outbox escribe a `pos_local_events`. La materialización de `pos_orders` desde los eventos es una operación de reconciliación separada (Phase 3 o trigger de Supabase).
- Mezclar el event log con la tabla de negocio haría que un INSERT del outbox sobreescriba una versión más reciente en `pos_orders` si el browser también escribe. Con tablas separadas, no hay solapamiento.

**Consecuencia**: La tabla `pos_local_events` debe ser creada en Supabase antes de iniciar la implementación del outbox. DDL en sección 8.

---

### Decisión 2: ¿El browser deja de sincronizar directamente a Supabase en Phase 2?

**Pregunta**: ¿Switch atómico o dual-write durante la transición?

**Decisión propuesta**: Switch atómico via feature flag `client.data_source`.

**Razonamiento**:
- Dual-write produce conflictos por diseño: el browser y el outbox escriben la misma entidad desde ángulos distintos. Resolver esos conflictos requiere la misma lógica que queremos evitar.
- El feature flag `client.data_source = 'local_server'` ya existe en la tabla `clients` para separar Wansoft de Fullsite POS. El mismo mecanismo aplica aquí.
- Cuando `data_source = 'local_server'`: el browser no llama `/api/pos/*` para escrituras, solo envía COMMAND via WS. El Local Server es la única fuente de escritura a Supabase.
- La transición ocurre por restaurante, no globalmente. Un restaurante puede estar en Phase 1 mientras otro migra a Phase 2.

**Precondición**: El outbox debe estar completamente implementado, probado y con al menos 48h de operación estable antes de activar el flag para cualquier restaurante en producción.

---

### Decisión 3: ¿Outbox en el mismo proceso que el Local Server o proceso separado?

**Pregunta**: ¿Simplicidad (mismo proceso) o resiliencia (proceso separado)?

**Decisión propuesta**: Mismo proceso en Phase 2.

**Razonamiento**:
- El outbox lee del EventStore que ya está en memoria. Acceso directo sin IPC.
- El modelo de fallo es simétrico: si el Local Server cae, el outbox tampoco debe correr (no tiene qué leer). Si el outbox falla, el Local Server debe seguir procesando comandos — esto es compatible con el mismo proceso si el outbox es un worker aislado dentro del proceso (clase independiente, try/catch que no propaga al servidor).
- Un proceso separado requiere su propio mecanismo de descubrimiento del EventStore en disco, aumenta la complejidad operativa, y añade un punto de fallo sin ganancia real en Phase 2.
- **La clase `OutboxWorker` debe fallar silenciosamente**: si `_syncBatch()` lanza, el Local Server no se entera. Los errores se loguean, se reportan en `/health`, y se retoman en el siguiente ciclo.

**Revisión en Phase 3**: Si el restaurante requiere alta disponibilidad (múltiples instancias del Local Server), el outbox debe ser un proceso separado con coordinación de líder. Eso es Phase 3, no ahora.
