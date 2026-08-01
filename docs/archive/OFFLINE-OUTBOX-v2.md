# OFFLINE-IMPL-001 v2 — Propuesta de Implementación: Outbox

> Estado: **PROPUESTA v2 — pendiente aprobación**
> Supersede: OFFLINE-IMPL-001-OUTBOX.md (v1)
> No se ejecuta ningún commit hasta aprobación explícita de este documento.

---

## Decisiones incorporadas

| Decisión | Valor aprobado |
|---|---|
| Nombre de columna | `clients.pos_write_authority` (`supabase` \| `local_server`) |
| Ejecución del Outbox | Híbrido: despertar inmediato al agregar evento + polling 5s fallback |
| Rollback a Phase 1 | Requiere reconciliación explícita; `pos_local_events` se conserva siempre |
| Dry-run | Eliminado como precondición de rollout |

---

## Parte 1: `pos_local_events` — Contrato Revisado

### 1.1 El log es verdaderamente inmutable

`pos_local_events` es append-only. Un registro insertado nunca se modifica — ni para actualizar `synced_at` en reenvíos, ni para anotar conflictos. El evento representa lo que ocurrió; esa información no cambia con el número de intentos de entrega.

**Consecuencia**: la información operacional del Outbox (cuántos intentos, cuándo fue el último intento, si fue rechazado) vive en un almacenamiento separado. Ver Parte 2.

### 1.2 Definición de la tabla

```
Tabla: pos_local_events
Propósito: event log inmutable del Local Server — append-only, nunca UPDATE

Columnas:
  id             UUID        NOT NULL  -- command_id del terminal (idempotency key)
                                       -- server-originated: UUID generado por appendInternal
  sequence       INTEGER     NOT NULL  -- secuencia local monotónica del EventStore
  type           TEXT        NOT NULL  -- ORDER_SENT | ORDER_CLOSED | ORDER_UPSERTED |
                                       -- ORDER_CANCELLED | KDS_ITEM_STATUS | MESA_LOCK |
                                       -- MESA_UNLOCK | TURNO_OPENED | TURNO_CLOSED | PRINT_COMMAND
  ts             BIGINT      NOT NULL  -- Unix ms del evento (timestamp del EventStore)
  client_id      UUID                  -- Terminal de origen (NULL si server-originated)
  restaurant_id  UUID        NOT NULL  -- FK a clients.id — identidad del tenant
  payload        JSONB       NOT NULL  -- Payload completo, sin transformaciones

Constraints:
  PRIMARY KEY (id)
  UNIQUE (restaurant_id, sequence)  -- un EventStore no puede emitir el mismo sequence dos veces
                                    -- si viola esta constraint: incident, no retry
  NOT NULL: id, sequence, type, ts, restaurant_id, payload
  CHECK (type <> 'STATE_SYNC')      -- defensa en profundidad; el Outbox ya filtra antes de enviar

Sin columnas de sync-state (synced_at, conflict_note, sync_error):
  → esa información vive en el checkpoint del Outbox, no en el evento

Índices:
  (restaurant_id, sequence)  -- lectura paginada del Outbox; FIFO garantizado
  (restaurant_id, ts)        -- queries de audit por ventana de tiempo

RLS:
  service_role: INSERT, SELECT — escribe el Outbox; sin UPDATE, sin DELETE
  authenticated: SELECT restringido por tenant y rol (ver 1.4)
  Sin escritura para usuarios finales
```

### 1.3 Semántica del INSERT — sin UPDATE

El Outbox usa:

```
INSERT INTO pos_local_events (id, sequence, type, ts, client_id, restaurant_id, payload)
VALUES (...)
ON CONFLICT (id) DO NOTHING
```

Con `Prefer: return=minimal` (respuesta vacía en éxito).

Interpretación de la respuesta:

| Respuesta de Supabase | Interpretación del Outbox |
|---|---|
| 201 Created | Evento insertado por primera vez — éxito |
| 200 + cuerpo vacío | `id` ya existía → ON CONFLICT DO NOTHING → éxito (idempotente) |
| 409 con `code: 23505` en `id` | Igual que arriba si Supabase lo reporta como 409 — éxito |
| 409 con `code: 23505` en `(restaurant_id, sequence)` con `id` distinto | **INCIDENT**: el EventStore emitió el mismo sequence dos veces con id distinto. No es retriable. Reportar como `integrity_violation`. El Outbox se detiene hasta intervención manual. |
| 4xx (400, 403, 422, etc.) | TERMINAL_REJECTION: ver Parte 2 checkpoint |
| 5xx / timeout | TRANSIENT_ERROR: retry con backoff |

No hay `Prefer: resolution=merge-duplicates`. No hay UPDATE de ningún campo.

### 1.4 RLS — tenant-scoped

```sql
-- El service_role de Supabase bypasea RLS por defecto — no requiere policy.
-- Solo se definen policies para authenticated.

-- Lectura solo dentro del propio restaurante y solo para admins:
CREATE POLICY "pos_local_events_tenant_admin_read"
  ON pos_local_events
  FOR SELECT
  TO authenticated
  USING (
    restaurant_id IN (
      SELECT client_id
      FROM client_users
      WHERE user_id = auth.uid()
        AND role IN ('admin', 'owner')
    )
  );

-- Sin INSERT, UPDATE, DELETE para authenticated.
-- El Outbox usa la service_role key — no es una sesión authenticated.
```

Personal operativo (meseros, cajeros) no puede leer este log. No hay acceso cross-tenant. El payload del audit trail no es visible para usuarios sin rol `admin` o `owner`.

---

## Parte 2: Checkpoint del Outbox — Almacenamiento Separado

### 2.1 Por qué un checkpoint separado

El NDJSON (`events.ndjson`) registra lo que ocurrió en el restaurante. El checkpoint registra qué fue sincronizado y en qué estado está ese proceso. Son dos contratos distintos que no deben mezclarse.

Reescribir el NDJSON para marcar `synced: true` viola la inmutabilidad del log de eventos y es O(N) por cada evento sincronizado. El checkpoint es O(1) por escritura.

### 2.2 Estructura del checkpoint

```
Archivo: userData/outbox-checkpoint.json
Escrito: atómicamente (write → rename, no overwrite directo)
Leído: al iniciar OutboxWorker

Campos:
{
  "last_synced_sequence": 124,       // último sequence confirmado por Supabase (PK insert exitoso)
  "rejected_sequences": [47, 89],    // sequences con TERMINAL_REJECTION (no retryable)
  "incident_sequences": [102],       // sequences con INTEGRITY_VIOLATION (requieren intervención)
  "consecutive_failures": 0,         // fallos transitorios consecutivos (para backoff)
  "last_attempt_at": 1753660000000,  // Unix ms del último intento de sincronización
  "last_success_at": 1753659000000,  // Unix ms del último éxito
  "outbox_version": 1                // versión del schema del checkpoint (para migración futura)
}
```

### 2.3 Comportamiento del checkpoint

**En startup**:
```
OutboxWorker.start()
  → leer outbox-checkpoint.json (si no existe: inicializar con last_synced_sequence = 0)
  → startFrom = last_synced_sequence + 1
  → excluir de sync: rejected_sequences ∪ incident_sequences
  → llamar eventStore.readAfter(startFrom, exclude: [rejected..., incident...])
```

**Después de un éxito**:
```
INSERT OK (201 o DO NOTHING)
  → checkpoint.last_synced_sequence = sequence
  → checkpoint.consecutive_failures = 0
  → checkpoint.last_success_at = now()
  → escribir checkpoint (atómico)
```

**Después de TERMINAL_REJECTION (4xx)**:
```
Supabase → 4xx (no 409-PK, no 5xx)
  → checkpoint.rejected_sequences.push(sequence)
  → escribir checkpoint (atómico)
  → el Outbox continúa con el siguiente evento
  → el evento rechazado NO bloquea la cola
  → heartbeat reporta: events_rejected: N
```

**Después de INTEGRITY_VIOLATION (sequence duplicado con id distinto)**:
```
Supabase → 409 en UNIQUE(restaurant_id, sequence) con id diferente
  → checkpoint.incident_sequences.push(sequence)
  → escribir checkpoint (atómico)
  → el Outbox se detiene inmediatamente
  → heartbeat reporta: health_status = 'outbox_incident'
  → requiere intervención manual para continuar
```

**Después de TRANSIENT_ERROR (5xx / timeout)**:
```
  → checkpoint.consecutive_failures += 1
  → checkpoint.last_attempt_at = now()
  → escribir checkpoint
  → calcular backoff: min(2^consecutive_failures * 1s, 5min)
  → suspender batch; scheduleRetry(backoffDelay)
```

### 2.4 El NDJSON no se modifica

El OutboxWorker solo lee `events.ndjson` via `eventStore.readAfter()`. Nunca lo modifica. La interfaz `markSynced()` del EventStore no es utilizada por el Outbox — es un vestigio del diseño anterior que puede deprecarse o removerse.

El estado de sincronización se determina comparando `checkpoint.last_synced_sequence` con `eventStore.lastSequence`. La diferencia es `unsyncedCount`.

```
unsyncedCount = lastSequence - last_synced_sequence
              - length(rejected_sequences)
              - length(incident_sequences)
```

---

## Parte 3: Ejecución Híbrida del Outbox

### 3.1 Modelo híbrido: event-driven + polling fallback

El Outbox no depende solo de un timer. Tiene dos canales de disparo:

**Canal A — Notificación inmediata**:
```
CommandHandler.handle(command)
  → CoreEventStore.processCommand(command)  → nuevo evento en NDJSON
  → outboxWorker.notify()                   ← canal de disparo
```

`notify()` interrumpe el timer actual y ejecuta `_syncBatch()` de inmediato. Si el Outbox está en medio de un batch, encola la notificación (no lanza batch concurrentes).

**Canal B — Polling fallback**:
```
setInterval(() => outboxWorker._syncBatch(), 5_000)
```

Corre aunque no lleguen notificaciones. Captura eventos que podrían haberse perdido si la notificación interna falló (reinicio, excepción no capturada en el path de notificación).

**Garantía**: si Canal A funciona, la latencia de sync es O(ms). Si Canal A falla silenciosamente, Canal B cierra el gap en ≤5s.

### 3.2 Batch concurrente: prevención

`_syncBatch()` usa un flag `_batchRunning`:

```
_syncBatch():
  si _batchRunning: return (no-op)
  _batchRunning = true
  try { ... } finally { _batchRunning = false }
```

Las notificaciones adicionales mientras corre un batch se marcan como `_pendingNotification = true`. Al terminar el batch, si `_pendingNotification`, lanza otro batch inmediatamente.

---

## Parte 4: Protocolo de Transición de Autoridad

### 4.1 Por qué "cambiar una columna" no es atómico

Con el diseño anterior:
- Browser cachea `pos_write_authority` por 5 minutos
- Local Server refresca cada 30 minutos

Ventana de inconsistencia posible: hasta 30 minutos con componentes en estados distintos:
- Browser en Phase 2 (solo WS) + Local Server aún sin Outbox activo → escrituras perdidas
- Local Server en Phase 2 (Outbox activo) + Browser aún en Phase 1 (syncAll activo) → dual-write

### 4.2 Máquina de estados de `pos_write_authority`

```
supabase ──────────► transitioning ──────────► local_server
                          │
                          ▼ (rollback con reconciliación)
                       supabase
```

El estado `transitioning` es un estado intermedio de coordinación. No es permanente — existe para dar tiempo a que todos los componentes acuerden antes de completar el switch.

### 4.3 Protocolo de activación (supabase → local_server)

```
Paso 1 — Coordinator:
  UPDATE clients SET pos_write_authority = 'transitioning'
  WHERE id = '{restaurantId}'

Paso 2 — Local Server (descubre en próximo heartbeat, máximo 5 min):
  → detecta 'transitioning'
  → inicia OutboxWorker en SHADOW MODE:
      - lee eventos desde events.ndjson
      - hace INSERT a pos_local_events
      - NO cambia el comportamiento de recepción de comandos
      - el browser POS sigue escribiendo a pos_orders (Phase 1 activo)
  → registra: UPDATE clients SET outbox_ready_at = now(), outbox_shadow_sequence = N
  → cambia polling de heartbeat a 30s (alta frecuencia durante transición)

Paso 3 — Browser POS (descubre en próximo config fetch, máximo 5 min):
  → detecta 'transitioning'
  → cambia polling de config a 30s
  → NO cambia el comportamiento de escritura todavía
  → reporta: pos_transition_state = 'pending'

Paso 4 — Coordinator (después de verificar en dashboard):
  → confirma: outbox_ready_at existe, shadow_sequence > 0, browser en 'pending'
  → UPDATE clients SET pos_write_authority = 'local_server'

Paso 5 — Local Server (descubre en ≤30s):
  → detecta 'local_server'
  → Outbox sale de shadow mode (ya estaba corriendo — continúa sin restart)
  → Local Server es la única autoridad de escritura
  → restaura polling de heartbeat a 5 min

Paso 6 — Browser POS (descubre en ≤30s):
  → detecta 'local_server'
  → desactiva syncAll()
  → escrituras solo via WS COMMAND al Local Server
  → restaura polling de config a 5 min
```

**Shadow mode**: el Outbox escribe a `pos_local_events` pero el browser POS sigue escribiendo a `pos_orders`. Esto permite validar que el Outbox funciona correctamente antes de cortar el acceso directo. Durante shadow mode, `pos_local_events` y `pos_orders` deberían ser consistentes (ambos reciben las mismas operaciones). El coordinator puede verificar esto.

**Polling de 30s durante transición**: tanto el Local Server como el browser POS aumentan la frecuencia de lectura del flag exclusivamente durante `transitioning`. Esto reduce la ventana de inconsistencia de 30 minutos a ≤30 segundos. Al confirmar `local_server`, vuelven a frecuencia normal.

### 4.4 Protocolo de rollback (local_server → supabase)

El rollback no es simétrico. Requiere reconciliación antes de completar.

```
Paso 1 — Coordinator:
  UPDATE clients SET pos_write_authority = 'transitioning'

Paso 2 — Local Server:
  → detecta 'transitioning'
  → pausa el Outbox (deja de enviar nuevos eventos a Supabase)
  → reporta: outbox_paused_at, last_synced_sequence = N

Paso 3 — Browser POS:
  → detecta 'transitioning'
  → NO reactiva syncAll() todavía

Paso 4 — Reconciliación (manual o script):
  → para cada evento en pos_local_events donde sequence > last_pre_phase2_sequence:
      → verificar si el evento está representado en pos_orders
      → si falta: clasificar como materializable o como pérdida operativa aceptada
      → documentar sequence reconciliado
  → si hay eventos no materializados: rollback BLOQUEADO hasta resolución explícita
  → el coordinator debe aceptar explícitamente cualquier pérdida antes de continuar

Paso 5 — Solo después de reconciliación aceptada:
  UPDATE clients SET pos_write_authority = 'supabase'

Paso 6 — Local Server:
  → detecta 'supabase'
  → detiene OutboxWorker completamente
  → restaura Phase 1

Paso 7 — Browser POS:
  → detecta 'supabase'
  → reactiva syncAll()
```

El checkpoint de reconciliación debe quedar registrado: qué secuencias fueron materializadas, cuáles no, y quién aprobó la pérdida. No es aceptable un rollback silencioso.

---

## Parte 5: Recovery del Outbox — Modelo Revisado

### 5.1 Startup

```
OutboxWorker.start():
  1. leer outbox-checkpoint.json
     → si no existe: { last_synced_sequence: 0, rejected: [], incidents: [] }
  2. startFrom = last_synced_sequence + 1
  3. exclude = rejected_sequences ∪ incident_sequences
  4. events = eventStore.readAfter(startFrom, exclude)
  5. si len(events) == 0: iniciar polling fallback solamente
  6. si len(events) > 0: _syncBatch() inmediato, luego polling fallback
```

### 5.2 Orden de procesamiento: FIFO estricto

El Outbox procesa eventos en orden ascendente de `sequence`. No envía el evento N+1 hasta que el evento N fue confirmado (éxito, rechazo o incidente).

**Excepción**: un evento con `TERMINAL_REJECTION` no bloquea la cola. Se marca en el checkpoint y se continúa con el siguiente.

**Sin excepción para incidentes**: un evento con `INTEGRITY_VIOLATION` detiene el Outbox completamente. No tiene sentido continuar si el EventStore tiene una violación de invariante — la causa raíz debe resolverse antes.

### 5.3 Supabase no responde

```
_sendEvent(event):
  timeout: 10s
  error de red o timeout:
    → consecutive_failures += 1
    → escribir checkpoint
    → backoff: min(2^consecutive_failures * 1_000ms, 300_000ms)
    → no procesar más eventos hasta retry
    → si consecutive_failures >= 6: health_status = 'outbox_stalled'
```

Backoff: 2s → 4s → 8s → 16s → 32s → 60s → ... → tope 5 minutos.

### 5.4 Evento corrupto en events.ndjson

El `NdjsonEventStore.load()` ya skipea líneas corruptas. El sequence del evento corrupto queda ausente del log en memoria. El Outbox nunca lo verá. El gap en sequence no bloquea los eventos siguientes.

El heartbeat reporta `corrupted_events_count`. El evento es irrecuperable desde el NDJSON; si el contenido importa, debe recuperarse de `pos_orders` o de los logs del browser POS.

---

## Parte 6: Commits Propuestos

La secuencia es lineal — cada commit es prerequisito del siguiente. No se mezclan.

### Commit 1 — SQL: tabla + columna + RLS

**Sin código JavaScript. Solo schema.**

Crea:
- `pos_local_events` con todos los campos, constraints e índices de la Parte 1
- `UNIQUE (restaurant_id, sequence)`
- Policy RLS `pos_local_events_tenant_admin_read`
- Columna `clients.pos_write_authority TEXT DEFAULT 'supabase' NOT NULL`
- Columnas auxiliares de transición: `clients.outbox_ready_at TIMESTAMPTZ`, `clients.outbox_shadow_sequence INTEGER`

Verificación antes de avanzar:
- `INSERT` con service key inserta correctamente
- `INSERT` del mismo `id` retorna 200 con cuerpo vacío (DO NOTHING)
- `INSERT` de `(restaurant_id, sequence)` duplicado con distinto `id` retorna 409 con código 23505 en la constraint correcta
- Un usuario authenticated sin rol admin no puede SELECT
- Un usuario authenticated con rol admin solo ve filas de su restaurant_id

### Commit 2 — EventStore: `readAfter` con exclusión + deprecar `markSynced`

**Qué cambia** en `NdjsonEventStore` y `CoreEventStore`:
- `readAfter(sequence, exclude?: Set<number>)`: filtra los sequences del set antes de devolver
- `markSynced()` marcado como `@deprecated` con nota: "use OutboxWorker checkpoint"
- Getter `lastSequence`: ya existe, sin cambio
- Getter `lastSyncedSequence`: **removido** del EventStore — ahora lo mantiene el checkpoint del Outbox

**Tests** (actualizar `event-store.test.js`):
- `readAfter with exclude omits rejected sequences`
- `readAfter with exclude omits incident sequences`
- `readAfter with empty exclude returns all events after sequence`

### Commit 3 — OutboxCheckpoint: clase de checkpoint atómico

**Nuevo archivo**: `electron-app/local-server/outbox/checkpoint.js`

Comportamiento:
- `load()`: lee `outbox-checkpoint.json`; si no existe, retorna estado inicial
- `markSynced(sequence)`: actualiza `last_synced_sequence`, escribe atómico (tmp + rename)
- `markRejected(sequence, reason)`: agrega a `rejected_sequences`, escribe atómico
- `markIncident(sequence, reason)`: agrega a `incident_sequences`, escribe atómico
- `recordFailure()`: incrementa `consecutive_failures`, escribe atómico
- `recordSuccess(sequence)`: actualiza `last_success_at`, resetea `consecutive_failures`, escribe atómico

**Tests** (nuevo `outbox-checkpoint.test.js`):
- `load returns initial state when file not found`
- `markSynced persists last_synced_sequence`
- `markSynced survives restart`
- `markRejected adds to rejected list; subsequent load reflects it`
- `markIncident adds to incident list`
- `recordFailure increments consecutive_failures`
- `recordSuccess resets consecutive_failures`
- `concurrent writes do not corrupt checkpoint (write is atomic)`

### Commit 4 — OutboxWorker: clase + tests

**Nuevo archivo**: `electron-app/local-server/outbox/worker.js`

Interfaz:
```
constructor({ eventStore, checkpoint, supabaseUrl, supabaseKey, restaurantId })
start()          → inicia Canal A (notify hook) + Canal B (5s fallback)
stop()           → limpia timers, espera batch actual si está corriendo
notify()         → dispara _syncBatch() inmediato si no hay uno corriendo
get stats()      → { unsyncedCount, lastSyncedSeq, consecutiveFailures, rejectedCount, incidentCount, mode }
async _syncBatch() → Promise<{ sent, rejected, incidents, skipped }>
async _sendEvent(event) → Promise<{ ok, conflict, rejected, incident, transient }>
```

Modo `shadow` (para `transitioning`): el worker llama `_sendEvent` pero no llama `checkpoint.markSynced`. Los eventos llegan a Supabase pero el checkpoint no avanza. Útil para validación antes del switch completo.

**Tests** (nuevo `outbox-worker.test.js`, con Supabase HTTP mockeado):
- `sends unsynced events in sequence order`
- `skips STATE_SYNC events`
- `marks event as synced in checkpoint after 201`
- `treats DO NOTHING (200 empty) as success`
- `treats 409 on id PK as success`
- `marks 409 on sequence constraint as incident and stops`
- `marks 4xx as rejected; continues with next event`
- `retries after 5xx with exponential backoff`
- `notify() triggers immediate batch without waiting for 5s timer`
- `concurrent notify() calls do not run concurrent batches`
- `shadow mode sends events but does not advance checkpoint`
- `resumes from checkpoint.last_synced_sequence after restart`

### Commit 5 — Local Server: integrar Outbox en index.js

**Qué cambia** en `index.js`:
- En `startLocalServer()`: leer `pos_write_authority` de Supabase al iniciar
- Si `'local_server'` o `'transitioning'`: iniciar `OutboxWorker` (con `shadow: pos_write_authority === 'transitioning'`)
- Si `'supabase'`: no iniciar OutboxWorker
- Re-leer el flag cada 30s durante `transitioning`, cada 5min en estado estable
- Hookear `CommandHandler` para llamar `outboxWorker.notify()` después de cada evento procesado
- Exponer stats del Outbox en `/health`:
  ```json
  "outbox": {
    "mode": "active|shadow|disabled",
    "unsynced": 3,
    "last_synced_seq": 124,
    "consecutive_failures": 0,
    "rejected": 0,
    "incidents": 0,
    "last_success_at": "2026-07-27T15:00:00Z"
  }
  ```
- Columnas de transición: Local Server actualiza `outbox_ready_at` y `outbox_shadow_sequence` al entrar en shadow mode

**Tests** (actualizar `index.test.js` o crear `outbox-integration.test.js`):
- `pos_write_authority = 'supabase': OutboxWorker not started`
- `pos_write_authority = 'local_server': OutboxWorker started in active mode`
- `pos_write_authority = 'transitioning': OutboxWorker started in shadow mode`
- `CommandHandler triggers outboxWorker.notify() after successful processCommand`
- `/health includes outbox stats`

---

## Parte 7: Lo que NO cambia todavía

Hasta que este documento esté aprobado e implementado, nada de lo siguiente se toca:

- `events.ndjson`: sigue siendo el log de eventos. No se modifica su formato ni su escritura.
- `CoreEventStore` / `NdjsonEventStore`: solo el cambio mínimo del Commit 2 (`readAfter` con exclusión).
- `RestaurantState`: sin `_lastSyncedSeq` — eso viene en la siguiente fase (Opción B).
- `_applyStateSync`: sin cambios — STATE_SYNC sigue operando como Phase 1.
- `useBridgeClient` / `BridgeClient`: sin cambios — T-09 es una tarea separada.
- `pos-offline-db.ts` / `syncAll()`: sin cambios — el browser sigue en Phase 1.
- `pos_orders`: sin cambios — sigue siendo la tabla de negocio del browser.

---

## Parte 8: Preguntas Pendientes

Las siguientes preguntas no tienen respuesta en este documento. Requieren decisión antes de iniciar Commit 1:

1. **¿El estado `transitioning` debe perseguirse hasta completar o puede quedar indefinido?**
   Si el Local Server o el browser no confirman la transición en un tiempo razonable (ej. 10 minutos), ¿debe el coordinator recibir una alerta y decidir? ¿O el sistema puede vivir en `transitioning` indefinidamente hasta que el coordinator actúe?

2. **¿Quién ejecuta la reconciliación de rollback?**
   El protocolo de rollback requiere comparar `pos_local_events` con `pos_orders`. ¿Es un script manual, un dashboard action en la admin UI, o un workflow de GitHub Actions? La respuesta afecta la complejidad del Commit 1 (si el script de reconciliación es parte del mismo rollout o es un entregable separado).

3. **¿`clients.outbox_ready_at` y `outbox_shadow_sequence` son columnas permanentes o se pueden eliminar después de la transición?**
   Si son solo de coordinación de transición, pueden vivir en una tabla aparte (`client_transitions`) para no contaminar `clients`.
