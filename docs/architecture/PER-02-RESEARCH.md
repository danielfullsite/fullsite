# Capa de Persistencia — Investigación PER-02

> Investigación completa del event store, persistencia durable y autoridades de escritura.
> Creado: 2026-07-27 | Auditor: Claude Code
> Resultado: **Opción A** — documentación obsoleta, no crear nuevo archivo.

---

## 1. Resumen ejecutivo

`dashboard-app/AGENTS.md` declaraba `src/lib/event-store.ts` como contrato formal del "Event store (POS)". El archivo no existe. Pero la investigación revela que **la arquitectura real es coherente y cubre la responsabilidad** — solo que distribuida en tres módulos, no en uno solo.

No se crea `src/lib/event-store.ts`. Se corrige la documentación.

---

## 2. Los tres sistemas de persistencia de eventos

| Sistema | Ubicación | Propósito | Autoridad | Persistencia | Dedup | Replay |
|---------|-----------|-----------|-----------|--------------|-------|--------|
| **Local Server Event Store** | `electron-app/local-server/` | Eventos LAN en tiempo real: mesas, KDS, locks, turno | **Autoritativa para estado LAN** | NDJSON en disco local | `command_id` → `processed-commands.ndjson` | Sí — completo desde seq 0 en startup |
| **Shadow Mode Publisher** | `dashboard-app/src/lib/events.ts` | Eventos de negocio append-only a Supabase (audit log para agentes IA) | Auditoría / IA — no operativa | localStorage queue → Supabase `events` | `event_id UNIQUE INDEX` en Supabase | No — fire-and-forget |
| **IDB Outbox** | `dashboard-app/src/lib/pos-offline-db.ts` | Cola de operaciones REST hacia Supabase cuando hay falla de red | **Sin autoridad propia** — es un buffer | IndexedDB `sync_queue` | Revisión por `base_version` + `APP_API` idempotency | `syncAll()` al reconectar |

---

## 3. Flujo real de un comando (Phase 1)

```
POS genera opId = crypto.randomUUID()         ← command_id estable
            │
            ├─► [path principal] fetch /api/pos/save-order
            │         │ éxito → orden en Supabase (autoridad durable para cobro/reconciliación)
            │         │ fallo → IDB sync_queue (outbox, syncAll en reconexión)
            │
            └─► [paralelo] bridge-client.sendCommand(ORDER_SENT, { command_id: opId, ... })
                      │
                      ▼  (WS COMMAND o POST /events)
              CommandHandler.handle()
                      │
                      ▼
              CoreEventStore.processCommand()
                 1. hasProcessedCommand(opId)    ← check dedup en memoria
                 2. NdjsonEventStore.append()    ← PERSISTE a events.ndjson
                 3. saveProcessedCommand(opId)   ← PERSISTE a processed-commands.ndjson
                      │
                      ▼
              RestaurantState.apply(event)       ← aplica al estado en memoria
                      │
                      ▼
              WsHub.broadcast(event)             ← DELTA a todos los terminales
                      │
                      ▼
              ACK al cliente originador
```

**Orden garantizado:** persistencia → estado → broadcast → ACK.
Un ACK visible implica que el evento ya está en disco.

---

## 4. Respuestas a las 9 preguntas

### Q1 — ¿Qué es autoridad hoy?

**Hay dos autoridades separadas con scope distinto:**

| Dominio | Autoridad | Justificación |
|---------|-----------|---------------|
| Cobro, pagos, reconciliación, turnos | **Supabase** (via REST / APP_API) | La transacción financiera se escribe en Supabase primero. El Local Server recibe una observación posterior. |
| Estado LAN: mesas, KDS, locks, ordenes en cocina | **Local Server CoreEventStore** | El evento se persiste aquí antes del ACK. El estado se reconstruye desde este log en cada restart. |

Estas dos autoridades no entran en conflicto porque cubren scopes distintos. Solo divergen si Supabase escribe un ORDER_CLOSED que el Local Server no vio — cubierto por STATE_SYNC (Supabase poll cada 5s que actualiza el Local Server).

**No hay dos autoridades compitiendo sobre el mismo dato.**

### Q2 — ¿Se persiste antes de confirmar?

**Sí**, en el path Local Server. El orden en `CommandHandler.handle()`:

```
CoreEventStore.processCommand()  ← PERSISTE (events.ndjson + processed-commands.ndjson)
RestaurantState.apply()          ← aplica a memoria
WsHub.broadcast()                ← broadcast a clientes
return { event }                 ← ACK
```

**Gap documentado (Phase 2):** `NdjsonEventStore.append()` y `saveProcessedCommand()` son dos `fs.appendFileSync` separados. Si el proceso muere entre ellos, el evento queda en `events.ndjson` pero no en `processed-commands.ndjson`. En el próximo restart, el mismo `command_id` se procesaría de nuevo → evento duplicado en el log.

Consecuencia: estado duplicado (ej. ORDER_SENT dos veces para la misma orden). La segunda aplicación sobreescribe la primera — en la práctica no corrompe, pero la deduplicación pierde su garantía atómica.

Mitigación en Phase 2: SQLite con transacción atómica para append + saveProcessedCommand.

### Q3 — ¿Existe replay real?

**Sí.** En `electron-app/local-server/index.js:307-309`:
```javascript
const events = await eventStore.readAfter(0)
for (const ev of events) state.apply(ev)
```

**Qué preserva el replay:**
- Estado de mesas (ocupada/libre/pagando, order_id)
- KDS item statuses (vía `kds_item_status` en `_orders`)
- Locks de mesas con expiry
- Estado de turno (abierto/cerrado)
- Todos los órdenes activos con sus items y rondas
- Flag `_kds_sent` para segunda ronda

**Qué NO preserva:**
- Pagos (no fluyen por el Local Server en Phase 1)
- Eventos emitidos solo a Supabase sin pasar por el Local Server
- STATE_SYNC: se replayan en secuencia — el estado Supabase al momento de la captura se reconstruye correctamente, pero representa un snapshot del pasado

**Tests existentes en `event-store.test.js`:**
- ✅ `state is rebuilt correctly after restart` (seq, payloads correctos)
- ✅ `duplicate detection survives restart`
- ✅ `corrupt lines in log are skipped gracefully`

**Tests que faltan (ver Sección 7).**

### Q4 — ¿Cómo se evita duplicar comandos?

| Contexto | Mecanismo | Autoridad |
|----------|-----------|-----------|
| Comandos al Local Server | `command_id` → `processed-commands.ndjson` | CoreEventStore |
| Operaciones a Supabase | `base_version` + `STALE_WRITE_CONFLICT` en APP_API | save-order API route |
| Eventos shadow Supabase | `event_id UNIQUE INDEX` ON CONFLICT DO NOTHING | Supabase DB |
| KDS dedup de DELTAs | Sliding window 256 IDs en localStorage | `useKdsWsClient` |

La deduplicación de `command_id` **sobrevive restart** (loaded from `processed-commands.ndjson` en `NdjsonEventStore.load()`).

### Q5 — ¿Quién genera la secuencia?

**Una sola autoridad:** `NdjsonEventStore._sequence` (in-memory, incrementado en `append()`).

```javascript
// ndjson.js — append()
for (const ev of events) {
  this._sequence++                         // ← única fuente
  const full = { ...ev, sequence: this._sequence, synced: false }
  ...
}
fs.appendFileSync(this._logPath, lines.join('\n') + '\n')
```

Cargado en `load()` desde el log (máximo `ev.sequence` visto). `WsHub` y `CommandHandler` llaman `eventStore.getLastSequence()` que devuelve este mismo `_sequence`. No hay secuencias paralelas.

**El que asigna secuencia === el que persiste === el que responde a catch-up.** Línea única y clara.

### Q6 — ¿Qué contiene el NDJSON?

**Formato por línea:**
```json
{
  "id": "uuid",
  "type": "ORDER_SENT",
  "ts": 1722121200000,
  "client_id": "terminal-uuid",
  "restaurant_id": "amalay-001",
  "payload": { "mesa": "5", "items": [...], "mesero": "Omar" },
  "sequence": 42,
  "synced": false
}
```

**Garantías:**
- Append-only: `fs.appendFileSync` — single write syscall por batch
- Corrupción parcial: cada línea es JSON independiente; líneas corruptas se saltean con `console.warn`
- Concurrencia: imposible — Node.js single-threaded, no hay acceso concurrente al archivo
- Rotación: ninguna en Phase 1

**Sin garantías (Phase 2):**
- No hay `fsync` explícito: `appendFileSync` llama `write()` de OS pero no `fsync()`. En Windows con power cut, el último batch puede perderse si el OS no flushó el buffer. El archivo queda íntegro hasta la última línea completa visible.
- No hay schema version: si el schema evoluciona, no hay forma de detectar líneas de formato anterior
- No hay rotación ni compactación: crece indefinidamente

**Tamaño estimado a escala AMALAY (~150 eventos/día):**
- 1 mes: ~4,500 líneas (~450 KB)
- 1 año: ~55,000 líneas (~5.5 MB)
- 5 años: ~275,000 líneas (~27 MB)

A estos volúmenes, `readAfter(0)` en startup lee todo el archivo — aceptable en Phase 1.

### Q7 — ¿Existen snapshots consistentes?

**No.** No hay snapshot persistente a disco. `state.toSnapshot()` genera el estado actual en memoria pero nunca se escribe a disco entre restarts.

Startup siempre hace: `readAfter(0)` → replay completo.

Consecuencia: startup time es O(N eventos). A escala AMALAY, esto es milisegundos hoy. Con años de operación y STATE_SYNC events (uno cada 5s mientras el servidor corre), el archivo puede crecer significativamente más rápido de lo estimado arriba.

**Riesgo real de STATE_SYNC en el log:** Si el Local Server corrió 8 horas con poll cada 5s, ese turno genera ~5,760 STATE_SYNC events además de los events operativos. En 1 año: ~1.5M de STATE_SYNC events solo. Esto sí es un problema de Phase 2.

### Q8 — ¿Cómo se compacta?

`markSynced()` es la única "operación de limpieza" — reescribe el archivo actualizando `synced: true` en los eventos indicados. No elimina nada.

No hay política de retención. No hay rotación. No hay archivado.

Phase 2 debe resolver esto antes de que STATE_SYNC infle el archivo. La solución correcta es excluir STATE_SYNC del log durable (son observaciones de Supabase, no comandos) o mover a SQLite con DELETE de eventos viejos.

### Q9 — ¿El POS necesita event store propio?

**No.**

El POS necesita y ya tiene:
- **`command_id` estable por operación** → `crypto.randomUUID()` en `pos/page.tsx` + `bridge-client.sendCommand()`
- **Outbox para Supabase** → IDB `sync_queue` en `pos-offline-db.ts`
- **Cache de estado** → IDB `orders`, `menu`, `turnos`
- **Última secuencia conocida** → `kds_last_sequence` en localStorage (via `useKdsWsClient`)
- **Dedup de DELTAs** → `kds_seen_event_ids` sliding window

Lo que NO necesita:
- Append-only event log en el browser — el Local Server es la autoridad
- Secuencia propia — la secuencia del Local Server es suficiente
- Replay propio — el catch-up via SUBSCRIBE + `last_sequence` cubre este caso

Crear `event-store.ts` en el POS crearía una quinta fuente de verdad sin valor adicional.

---

## 5. Mapa de responsabilidades

| Responsabilidad | Implementación actual | Autoridad | Persistencia | Replay | Riesgo | Gap real |
|---|---|---|---|---|---|---|
| Recepción de comandos | `WsHub._onConnection` + `POST /events` | Local Server | No aplica | — | Bajo | — |
| Validación de comandos | `CommandHandler.handle()` | Local Server | No aplica | — | Bajo | — |
| Asignación de secuencia | `NdjsonEventStore.append()` | `_sequence` in-memory, fuente única | Sí (NDJSON) | Cargado de disco en startup | Bajo | No atómica con saveProcessedCmd |
| Deduplicación de comandos | `CoreEventStore.processCommand()` | `processed-commands.ndjson` | Sí | Cargado en startup | Medio | append + saveCmd no atómicos |
| Aplicación al estado | `RestaurantState.apply()` | En memoria | No | Replay completo | Bajo | — |
| Publicación vía WsHub | `WsHub.broadcast()` | — | No | — | Bajo | — |
| Persistencia durable | `NdjsonEventStore.append()` | NDJSON en disco | Sí | Sí | Medio | Sin fsync explícito |
| Snapshots | Ninguno | — | No | — | Medio (crece) | No existe — Phase 2 |
| Catch-up | `WsHub` SUBSCRIBE + `readAfter` | Local Server | Vía NDJSON | — | Bajo | — |
| Dedup de DELTAs (KDS) | `useKdsWsClient` sliding window | localStorage | 256 IDs | — | Bajo | — |
| Recuperación tras crash | Replay de NDJSON en startup | NDJSON | Sí | Sí | Medio | Non-atomic append+dedup |
| Sincronización cloud | `syncAll()` outbox IDB | IDB sync_queue | Sí (IDB) | Sí (APP_API) | Bajo | — |
| Compactación | Ninguna | — | — | — | **Alto a largo plazo** | STATE_SYNC infla el log |
| Retención | Ninguna | — | — | — | Medio | Sin política definida |
| Auditoría de negocio | `events.ts` → Supabase `events` | Supabase | Sí (Supabase) | No (fire-and-forget) | Bajo | Estado post-cutover sin confirmar |

---

## 6. Decisión: Opción A

`src/lib/event-store.ts` no se crea.

**Razones:**

1. La responsabilidad prometida en AGENTS.md ("generar un evento inmutable antes de mutar estado POS") ya está cubierta:
   - `command_id` estable generado en POS antes de cualquier escritura
   - El mismo `command_id` llega al Local Server que lo persiste en `events.ndjson` como evento inmutable
   - El Local Server responde ACK solo después de persistir

2. Un `event-store.ts` en el POS sería el sexto sistema de persistencia sin resolver ningún gap real.

3. Los gaps reales (non-atomic append+dedup, sin fsync, sin snapshots, STATE_SYNC inflation, sin schema version) están en el Local Server y se resuelven en Phase 2 con SQLite — no con un nuevo archivo en el POS.

**Qué cambia:**
- `dashboard-app/AGENTS.md`: la fila "Event store (POS)" se actualiza con los módulos reales
- `docs/offline/CODE-AUDIT.md`: PER-02 → FIXED (documentación)
- Este documento queda como referencia canónica

---

## 7. Tests que faltan

Los 8 tests existentes en `event-store.test.js` cubren el path feliz. Faltan:

| Test | Qué verifica | Prioridad |
|---|---|---|
| Línea NDJSON incompleta al final del archivo | Crash durante write deja última línea truncada — debe skipearse sin error | Alta |
| Crash entre append y saveProcessedCommand | Simular: append event exitoso, luego `saveProcessedCommand` lanza. En restart, ¿se duplica el evento? | Alta |
| STATE_SYNC en replay rebuilds correct state | Mezclar ORDER_SENT + STATE_SYNC + ORDER_CLOSED en log, verificar estado final | Media |
| readAfter no carga todo en memoria innecesariamente | Con 10K eventos, readAfter(9990) no debe ser O(10K) de procesamiento visible | Media |
| processedCommands con key colision diferente eventId | Key igual, eventId diferente — debe retornar el primero sin sobrescribir | Baja |
| Schema desconocido (campo extra) | Línea con campos adicionales no bloquea el parse | Baja |

Los dos de Alta prioridad son los únicos que podrían causar pérdida de datos en producción.

---

## 8. Gaps de Phase 2 (documentados, no bloqueantes para Phase 1)

| Gap | Riesgo en producción hoy | Solución Phase 2 |
|---|---|---|
| append + saveProcessedCommand no atómicos | Duplicado de evento en crash durante esa ventana (~ms). En práctica, el segundo apply sobreescribe el primero sin corrupción visible. | SQLite TRANSACTION: INSERT evento + INSERT processed_cmd en una transacción |
| Sin fsync explícito | En apagón de Windows durante write, último batch puede perderse. El log queda íntegro hasta el último `\n` visible. | `fs.fsyncSync(fd)` después de appendFileSync, o SQLite WAL |
| STATE_SYNC events en log durable | A 1 evento/5s × 8h de operación = ~5,760 STATE_SYNC/día = crecimiento desproporcionado | Excluir STATE_SYNC del log NDJSON (son observaciones, no comandos); guardar solo en memoria |
| Sin snapshots | Startup O(N eventos). Con STATE_SYNC incluidos, puede volverse lento en meses | Periodic snapshot to disk + truncate log antes del snapshot |
| Sin schema version | Imposible detectar eventos de formato anterior en el log | Agregar `schema_version: 1` a cada evento |
| `events.ts` post-cutover | El shadow publisher apunta a Supabase `events` (tabla para AI agents). No está claro si sigue activo post-cutover o si fue abandonado con Wansoft. | Verificar en producción si la tabla `events` recibe datos. Si no → marcar `events.ts` como deprecated. |

---

## 9. Qué requiere validación física

| Validación | Cómo hacerlo | Qué confirma |
|---|---|---|
| Replay completo tras restart | Cerrar Local Server durante servicio, reabrir, verificar estado de mesas/KDS en UI | Que replay reconstruye exactamente el estado correcto |
| Dedup tras crash + restart | Enviar ORDER_SENT, matar proceso entre append y saveCmd (timing difícil), verificar log en restart | Gap de atomicidad |
| Truncated last line | Escribir línea parcial manualmente al .ndjson, arrancar servidor, verificar warning y recuperación | Fault tolerance |
| STATE_SYNC volume | Correr Local Server 1 turno completo, medir tamaño de events.ndjson | Evaluar urgencia de excluir STATE_SYNC del log |
| `events.ts` en producción | Consultar tabla Supabase `events` durante turno de AMALAY | Confirmar si shadow mode sigue activo post-cutover |

---

*Fullsite — Persistence Layer Research | 2026-07-27*
