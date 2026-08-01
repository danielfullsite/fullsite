# OFFLINE-IMPL-001 — Propuesta de Implementación: Outbox

> Estado: **PROPUESTA — pendiente aprobación de diseño**
> Precede a: `_lastSyncedSeq` → Opción B (merge) → Opción C (deprecar STATE_SYNC)
> No se escribe código hasta aprobación explícita de este documento.

---

## Alcance

Este documento cubre únicamente el primer paso del orden aprobado:

```
1. Outbox (este documento)        ← aquí
2. _lastSyncedSeq
3. Sequence-based merge (Opción B)
4. Deprecación STATE_SYNC (Opción C)
```

Las decisiones de diseño de GAP-001 son propuestas de partida. Este documento las desarrolla con suficiente detalle para revisar y aprobar antes de implementar.

---

## Parte 1: Contrato de `pos_local_events`

### 1.1 Propósito y relación con tablas existentes

`pos_local_events` es un **log de eventos inmutable append-only**. Es distinto de `pos_orders`:

| | `pos_local_events` | `pos_orders` |
|---|---|---|
| Naturaleza | Inmutable. Append-only. | Mutable. Proyección del estado actual. |
| Escritor | Outbox Worker (vía service key) | Browser POS en Phase 1; materializer en Phase 2 |
| Semántica | "Esto ocurrió, en este orden" | "Así está la orden ahora" |
| Borrado | Nunca (solo archived tras compactación en Phase 3) | Sí (cuando se cierra el turno) |

Durante la transición Phase 1 → Phase 2, el Outbox escribe solo a `pos_local_events`. El browser POS sigue escribiendo a `pos_orders` mediante Phase 1. No hay solapamiento. La reconciliación entre ambas tablas (hacer que `pos_orders` sea derivado de `pos_local_events`) es Phase 3.

### 1.2 Definición de la tabla

```
Tabla: pos_local_events
Propósito: event log del Local Server, sincrónizado por el Outbox

Columnas:
  id             UUID NOT NULL         -- = command_id del terminal (idempotency key)
                                       -- Para eventos server-originated: UUID generado por appendInternal
  sequence       INTEGER NOT NULL      -- Secuencia local monotónica del EventStore
  type           TEXT NOT NULL         -- ORDER_SENT | ORDER_CLOSED | ORDER_UPSERTED |
                                       -- ORDER_CANCELLED | KDS_ITEM_STATUS | MESA_LOCK |
                                       -- MESA_UNLOCK | TURNO_OPENED | TURNO_CLOSED | PRINT_COMMAND
                                       -- (nunca STATE_SYNC — filtrado por el Outbox)
  ts             BIGINT NOT NULL       -- Unix timestamp en ms del evento
  client_id      UUID                  -- Terminal que originó el comando (NULL si server-originated)
  restaurant_id  UUID NOT NULL         -- FK a clients.id
  payload        JSONB NOT NULL        -- Payload completo del evento, sin transformaciones
  synced_at      TIMESTAMPTZ           -- Cuándo fue recibido por Supabase (DEFAULT NOW() en INSERT)
  conflict_note  TEXT                  -- Valor cuando Supabase ya tenía este id: 'already_exists'
  sync_error     TEXT                  -- 'TERMINAL_REJECTION' si Supabase rechaza con 4xx

Constraints:
  PRIMARY KEY (id)
  NOT NULL: id, sequence, type, ts, restaurant_id, payload
  CHECK type NOT IN ('STATE_SYNC')     -- Defensa en profundidad; el Outbox ya filtra

Índices:
  (restaurant_id, sequence)  -- lectura paginada por el Outbox; orden garantizado
  (restaurant_id, synced_at) -- dashboard de fleet (cuántos eventos sincronizados hoy)

RLS:
  service_role: INSERT, SELECT, UPDATE  -- el Outbox usa service key
  authenticated: SELECT                 -- audit trail para admins
  Sin escritura por usuarios finales
```

### 1.3 Semántica del upsert

El Outbox envía a Supabase con:
```
POST /rest/v1/pos_local_events
Prefer: resolution=merge-duplicates
```

Comportamiento:
- Si `id` no existe → INSERT, Supabase retorna 201
- Si `id` ya existe → UPDATE de `synced_at = NOW()`, `conflict_note = 'already_exists'`, retorna 200
- Ambos casos son "éxito" para el Outbox → `markSynced([sequence])` se llama en ambos

Un 409 que no sea por conflict (ej. constraint violation no relacionada con PK) → `TERMINAL_REJECTION`.

### 1.4 ¿Qué NO va en esta tabla?

- Eventos `STATE_SYNC`: el Outbox los filtra por tipo antes de enviar. Son "observaciones de Supabase", no comandos de terminales.
- Datos de sesión del usuario (tokens, passwords): el payload es el mismo payload del event store — no contiene autenticación.
- Metadatos de sync del Outbox (cuántos intentos, backoff actual): esos son state del OutboxWorker, no del evento.

---

## Parte 2: Mecanismo del Switch `client.data_source`

### 2.1 Estado actual del campo

La columna `clients.data_source` hoy distingue la fuente de datos para analytics: `'wansoft'` vs `'fullsite'`. No debe modificarse — tiene una semántica establecida.

**Propuesta**: agregar una nueva columna separada que controle la autoridad de escritura POS.

```
Columna nueva: clients.pos_write_authority
Tipo: TEXT
Default: 'supabase'
Valores válidos: 'supabase' | 'local_server'
```

La separación evita que un cambio en la autoridad de escritura afecte el pipeline de analytics existente. Son dos conceptos ortogonales.

### 2.2 Qué controla el flag

| Componente | `pos_write_authority = 'supabase'` (Phase 1) | `pos_write_authority = 'local_server'` (Phase 2) |
|---|---|---|
| Browser POS — escrituras | Llama `/api/pos/*` → Supabase directo | Solo envía COMMAND via WS; no escribe a `/api/pos/*` |
| `pos-offline-db.ts` `syncAll()` | Activo — sincroniza IDB → Supabase | No-op (las escrituras ya no pasan por IDB→Supabase) |
| Outbox Worker | Inactivo (o modo dry-run sin escrituras) | Activo — sincroniza events.ndjson → pos_local_events |
| `_lastSyncedSeq` | Siempre 0 (el Outbox no avanza) | Avanza conforme el Outbox confirma |
| STATE_SYNC poll | Activo (Phase 1 normal) | Activo (hasta Opción C) |

### 2.3 Cómo lee el flag el Local Server

El flag se lee al iniciar el Outbox Worker:

```
startLocalServer()
  → leer config.json (ya existe: restaurantId, serverName, etc.)
  → GET /rest/v1/clients?id=eq.{restaurantId} → pos_write_authority
  → si 'local_server': OutboxWorker.start()
  → si 'supabase': OutboxWorker no inicia (modo Phase 1)
```

El flag también se re-lee si el heartbeat detecta un cambio (comparando el valor en caché con Supabase cada 30 min). Esto permite activar o desactivar sin reiniciar el servidor.

### 2.4 Cómo lee el flag el Browser POS

```
useBridgeClient
  → al conectar: fetch /api/auth/client-config → pos_write_authority
  → si 'local_server': sendCommand() via WS; syncAll() deshabilitado
  → si 'supabase': comportamiento actual
```

El flag se cachea en localStorage (`pos_write_authority`) con TTL de 5 minutos para no consultar Supabase en cada render.

### 2.5 Pre-condiciones para activar el flag

Antes de setear `pos_write_authority = 'local_server'` en cualquier restaurante:

- [ ] `pos_local_events` existe en Supabase con RLS configurado
- [ ] `OutboxWorker` ha corrido en modo dry-run ≥48h sin errores
- [ ] `_lastSyncedSeq` avanza correctamente (verificable en `/health`)
- [ ] El plan de rollback está documentado y probado (ver sección 2.6)
- [ ] El coordinador del restaurante ha autorizado explícitamente

La activación es por restaurante (`restaurant_id`), no global.

### 2.6 Rollback

Si algo sale mal tras activar el flag:

1. Setear `pos_write_authority = 'supabase'` en Supabase (1 UPDATE)
2. El Local Server detecta el cambio en el próximo heartbeat y detiene el Outbox Worker
3. El Browser POS detecta el cambio y reactiva `syncAll()`
4. Los eventos en `pos_local_events` que ocurrieron durante Phase 2 quedan ahí — son el audit trail
5. El browser POS puede quedar con IDB sync_queue vacío si el operador no hizo operaciones durante la ventana de Phase 2 — sin problema
6. Si hay órdenes en `pos_local_events` que NO están en `pos_orders` (porque el browser no las envió): requiere reconciliación manual (script de migración point-in-time)

El riesgo de rollback es proporcional al tiempo que estuvo activo Phase 2. En las primeras 48h, el riesgo es bajo.

---

## Parte 3: Modelo de Recuperación del Outbox

### 3.1 Startup normal

```
NdjsonEventStore.load()
  → lee events.ndjson línea a línea
  → para cada evento: si synced === true → acumula en maxSyncedSeq
  → al final: this._lastSyncedSequence = maxSyncedSeq

OutboxWorker.start()
  → lee eventStore._lastSyncedSequence → startFrom
  → llama eventStore.readAfter(startFrom)  ← eventos pendientes
  → envía a Supabase en orden FIFO
```

Si `events.ndjson` no tiene ningún evento con `synced: true` (primera vez, o nunca se sincronizó), `startFrom = 0` → el Outbox procesa el log completo desde el inicio.

### 3.2 Fallo durante un batch (interrupción mid-sync)

El Outbox procesa eventos **uno a uno**, no en bulk. Después de cada evento exitoso, llama `markSynced([sequence])` antes de pasar al siguiente.

Si el proceso es interrumpido entre evento N y evento N+1:
- Al reiniciar: `load()` lee el NDJSON y calcula `_lastSyncedSequence = N`
- `readAfter(N)` devuelve eventos N+1, N+2, ...
- El Outbox retoma desde N+1

**Garantía**: ningún evento puede quedar "enviado a Supabase pero no marcado como synced" de forma permanente. Si eso ocurre, el evento se reenvía en el siguiente ciclo (idempotente por `id`).

**¿Por qué procesar uno a uno y no en batch?**

El procesamiento en batch (enviar 50 eventos, luego marcarlos todos) es más eficiente pero introduce una ventana donde el proceso puede morir después de que Supabase recibió los eventos pero antes de que se marcaron como synced. Al reiniciar, el Outbox los reenviaría — correcto gracias a la idempotencia. Sin embargo, el procesamiento uno a uno simplifica la lógica de recovery a cero: el invariante es simple y verificable. La eficiencia puede mejorarse en Phase 3 si el volumen lo justifica.

### 3.3 Supabase no responde (timeout o red caída)

```
_sendEvent(event)
  → timeout: 10s
  → si timeout o error de red:
      → no llamar markSynced
      → incrementar _consecutiveFailures
      → si _consecutiveFailures >= 3:
            → calcular backoffDelay = min(2^_consecutiveFailures * 1000, 5 * 60 * 1000)
            → suspender batch; scheduleRetry(backoffDelay)
      → retornar { ok: false, error: 'TIMEOUT' }
```

El backoff: 3 fallos → 8s, 4 → 16s, 5 → 32s, ..., tope 5 minutos.

En el heartbeat: si `_consecutiveFailures > 10` y `_unsyncedCount > 0` → `health_status: 'outbox_stalled'`.

Los eventos permanecen `synced: false` en el NDJSON. No hay pérdida de datos.

### 3.4 Supabase rechaza con 4xx (TERMINAL_REJECTION)

```
_sendEvent(event)
  → Supabase retorna 400, 403, 422, etc.
  → no retryable (la causa no se resuelve sola)
  → escribir en el evento: sync_error: 'TERMINAL_REJECTION'
  → llamar markRejected([sequence]):
      → en NDJSON: evento queda con synced: false pero sync_error: 'TERMINAL_REJECTION'
  → el Outbox excluye eventos con sync_error en readAfter()
  → heartbeat reporta: events_rejected: N
```

El evento rechazado no bloquea los siguientes. El Outbox continúa con el evento N+1.

Un evento rechazado es un dato sin canal de sincronización. Requiere intervención manual o un script de reconciliación.

### 3.5 Supabase retorna 409 / "already exists"

Con `Prefer: resolution=merge-duplicates`, Supabase hace UPDATE en lugar de INSERT si el id existe. Retorna 200 o 201 según la implementación.

Si por alguna razón Supabase retorna 409 (conflict) en lugar del merge:
- El Outbox interpreta 409 como éxito (el evento ya está ahí)
- Llama `markSynced([sequence])` con `conflict_note: 'already_exists'`
- Continúa con el siguiente evento

El 409 más probable es si el browser POS ya sincronizó el evento directamente (Phase 1 dual path). Resolución correcta: el evento ya llegó a Supabase → marcar synced.

### 3.6 Evento corrupto en events.ndjson

`NdjsonEventStore.load()` ya salta líneas corruptas con un warning. Un evento corrupto tiene su secuencia "desaparecida" del log en memoria.

El Outbox nunca verá ese evento porque `readAfter()` solo devuelve eventos que fueron parseados correctamente. El gap de secuencia (ej. falta el sequence 47) no bloquea los eventos 48, 49, 50.

El heartbeat reporta: `corrupted_events: N` (ya implementado en load() con un contador).

El evento corrupto es irrecuperable desde el NDJSON. Si el contenido importa (ej. un ORDER_CLOSED con monto), requiere reconciliación desde `pos_orders` (que el browser POS sí sincronizó en Phase 1).

---

## Parte 4: Sequencia de Implementación Propuesta

Se describe como commits + archivos de test. Sin código todavía.

### Commit 1 — Supabase: crear tabla y columna

**Qué cambia**:
- SQL migration: `CREATE TABLE pos_local_events (...)` con índices y RLS
- SQL: `ALTER TABLE clients ADD COLUMN pos_write_authority TEXT DEFAULT 'supabase'`

**Tests**: ninguno (es schema solo). Verificable con `SELECT * FROM pos_local_events LIMIT 1` y `\d clients`.

**Precondición para el commit siguiente**: tabla existe y es accesible con service key.

---

### Commit 2 — EventStore: `lastSyncedSequence` + estado `rejected`

**Qué cambia** en `electron-app/local-server/adapters/storage/ndjson.js`:
- `load()` calcula `_lastSyncedSequence` durante el replay
- Getter `lastSyncedSequence` expuesto en la interfaz
- `markRejected(sequences)`: reescribe el archivo con `sync_error: 'TERMINAL_REJECTION'`
- `readAfter(seq)` excluye eventos con `sync_error` presente

**Tests** (agregar a `event-store.test.js`):
- `lastSyncedSequence returns 0 when no synced events`
- `lastSyncedSequence returns max synced sequence after markSynced`
- `lastSyncedSequence survives restart after partial sync`
- `markRejected sets sync_error and excludes from readAfter`
- `readAfter skips rejected events but not unsync events`

---

### Commit 3 — OutboxWorker: clase + tests

**Qué crea**: `electron-app/local-server/outbox/worker.js`

**Interfaz** (a revisar antes de implementar):
- `constructor({ eventStore, supabaseUrl, supabaseKey, restaurantId, dryRun })`
- `start()` → inicia loop con `_syncBatch()` cada `INTERVAL_MS` (propuesto: 5s)
- `stop()` → limpia timers, permite restart limpio
- `_syncBatch()` → Promise<{ sent, rejected, skipped, errors }>
- `_sendEvent(event)` → Promise<{ ok, conflict, rejected, error }>
- `get stats()` → `{ unsyncedCount, lastSyncedSeq, consecutiveFailures, rejectedCount }`

**Tests** (nuevo `outbox.test.js` con Supabase mockeado):
- `sends unsynced events in sequence order`
- `marks event as synced after 2xx`
- `does not send STATE_SYNC events`
- `retries after timeout with backoff`
- `marks event as rejected after 4xx; continues with next event`
- `treats 409/already_exists as success`
- `dry-run mode: reads events but does not call markSynced`
- `resumes from lastSyncedSequence after restart`

---

### Commit 4 — Local Server: integrar OutboxWorker en index.js

**Qué cambia** en `electron-app/local-server/index.js`:
- Al iniciar: leer `pos_write_authority` del config (o fetch de Supabase)
- Si `pos_write_authority === 'local_server'`: `startOutboxWorker()`
- Exponer stats del worker en `/health` como `outbox: { unsynced, lastSyncedSeq, failures }`
- Re-evaluar el flag cada 30 minutos (heartbeat cycle)

**Tests**: integración — `startLocalServer` con `pos_write_authority = 'local_server'` inicia el worker.

---

### Commit 5 — RestaurantState: `_lastSyncedSeq` + getter

**Qué cambia** en `electron-app/local-server/core/state.js`:
- Constructor recibe `lastSyncedSeq` inicial (del EventStore)
- `_lastSyncedSeq` como propiedad interna
- `get lastSyncedSeq()` público
- El Outbox Worker llama `state.onEventSynced(sequence)` para actualizar

Este commit es el puente entre el Outbox (que confirma sequences) y el STATE_SYNC guard de Opción B (que leerá `_lastSyncedSeq` para decidir si preservar estado local).

**Tests** (agregar a `state.test.js`):
- `_lastSyncedSeq initializes from EventStore`
- `_lastSyncedSeq updates when OutboxWorker confirms sync`

---

## Parte 5: Preguntas que Requieren Decisión Antes de Implementar

Las siguientes preguntas no tienen respuesta en este documento. Requieren revisión del equipo:

1. **`pos_write_authority`: columna nueva en `clients` (recomendado) o reusar `data_source` con un valor nuevo?**
   La columna nueva evita colisión semántica con el pipeline de analytics. Si se agrega columna nueva, ¿cuál es el nombre correcto: `pos_write_authority`, `phase2_enabled`, `local_server_authority`?

2. **Intervalo del batch del Outbox: ¿5 segundos o event-driven?**
   - 5s (polling): simple, predecible, introduce hasta 5s de lag entre comando y sync a Supabase
   - Event-driven (el CommandHandler notifica al Outbox en cada evento): sin lag, más complejo, requiere canal interno
   - El polling de 5s es razonable para Phase 2 (no es tiempo real); el Supabase poll actual también es 5s

3. **¿Qué pasa con los eventos en `pos_local_events` si se hace rollback a Phase 1?**
   - Opción A: se dejan como registro histórico — `pos_orders` es la fuente de verdad
   - Opción B: script de reconciliación que actualiza `pos_orders` desde `pos_local_events`
   - El riesgo de Opción A es que haya órdenes en `pos_local_events` que no estén en `pos_orders` (si el browser no las capturó durante Phase 2)

4. **¿El dry-run del OutboxWorker es necesario para el rollout o es solo para testing?**
   Dry-run significa: leer eventos, simular el envío, pero no llamar ni `markSynced` ni hacer POST a Supabase. Útil para validar que el Outbox encuentra los eventos correctos antes de activar Phase 2. Si el dry-run no aporta garantías verificables, puede eliminarse para simplificar.
