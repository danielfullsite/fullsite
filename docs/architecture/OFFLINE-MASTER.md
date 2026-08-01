# OFFLINE-MASTER — Arquitectura Offline de Fullsite

> Auditoría OFFLINE-100. Fecha: 2026-07-27.
> Cada componente tiene status: **VERIFIED** | **PARTIAL** | **UNKNOWN** | **NOT IMPLEMENTED**
> VERIFIED = código existe + test corre verde. PARTIAL = código existe, sin test o con gap. UNKNOWN = no hay evidencia suficiente. NOT IMPLEMENTED = diseñado pero sin código.

---

## 1. Vista General de la Arquitectura

```
┌───────────────────────────────────────────────────────────────────┐
│                    INTERNET (Supabase)                            │
│        Heartbeat ←──────────────────── Solo telemetría            │
│        Poll ←────────────────────────── Cada 5s (Phase 1)        │
│        Sync ←────────────────────────── sync_queue → /api/pos/*  │
└─────────────────────────┬─────────────────────────────────────────┘
                          │  Cuando Internet existe
                          │
┌─────────────────────────▼──────────────────────────────────────────┐
│                   LAN LOCAL (192.168.x.x)                          │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │   Electron POS (electron-app/)            port 7717           │ │
│  │   ┌─────────────────────────────────────────────────────┐    │ │
│  │   │ Local Server (local-server/)                         │    │ │
│  │   │  • HTTP  0.0.0.0:7717   (rutas: /health, /state,    │    │ │
│  │   │          /events, /print, /drawer, /config,          │    │ │
│  │   │          /identity)                                   │    │ │
│  │   │  • WebSocket  ws://0.0.0.0:7717/ws                  │    │ │
│  │   │  • EventStore  events.ndjson (append-only)           │    │ │
│  │   │  • RestaurantState (in-memory, rebuilt en startup)   │    │ │
│  │   │  • mDNS  _fullsite-pos._tcp                          │    │ │
│  │   └─────────────────────────────────────────────────────┘    │ │
│  │   ┌─────────────────────────────────────────────────────┐    │ │
│  │   │ Next.js POS (app.fullsite.mx/pos — cargado en WV)   │    │ │
│  │   │  • IndexedDB (pos-offline-db.ts)                     │    │ │
│  │   │    ─ menu, orders, inventory, sync_queue,            │    │ │
│  │   │      modifier_groups, staff, turnos,                 │    │ │
│  │   │      cash_movements, print_jobs                      │    │ │
│  │   │  • Print Queue (print-queue.ts)                      │    │ │
│  │   │    ─ localStorage hot + IDB backup                   │    │ │
│  │   │  • Service Worker (offline.html)                     │    │ │
│  │   └─────────────────────────────────────────────────────┘    │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─────────────────────────┐   ┌────────────────────────────────┐ │
│  │  Electron KDS            │   │  Tablet / POS adicional        │ │
│  │  (electron-kds/)         │   │  (browser, misma LAN)          │ │
│  │  • /pos/cocina           │   │  • WS ws://[server_ip]:7717/ws │ │
│  │  • Shared session IDB    │   │  • Discovery: mDNS → last IP   │ │
│  │    (si es window 2 en    │   │    → manual                    │ │
│  │    el mismo proceso)     │   └────────────────────────────────┘ │
│  └─────────────────────────┘                                       │
└────────────────────────────────────────────────────────────────────┘
```

---

## 2. Flujo POS → Local Server → KDS

**Status: PARTIAL** — el flujo existe y funciona en happy path; los edge cases de reconexión KDS no están probados.

```
POS (browser)
  1. Usuario envía orden
  2. sendCommand({ command_id, command_type: 'ORDER_SENT', ... })
  3. → WS COMMAND al Local Server

Local Server
  4. CommandHandler.handle() valida restaurant_id
  5. CoreEventStore.processCommand() verifica idempotency (command_id)
  6. NdjsonEventStore.append() escribe evento a events.ndjson (fsAppend)
  7. RestaurantState.apply(event) actualiza estado en memoria
  8. WsHub.broadcast(event) → DELTA a todos los clientes conectados

KDS (mismo proceso Electron o cross-device)
  9. Recibe DELTA con ORDER_SENT
  10. Renderiza la orden en /pos/cocina
```

**Brecha**: Si el KDS no está conectado al WS en el momento del broadcast, NO recibe el evento. Al reconectarse recibe SNAPSHOT + deltas desde su último sequence, lo que cubre la brecha — **SIEMPRE QUE EL LOCAL SERVER NO HAYA REINICIADO ENTRE MEDIAS** (ver §7 Riesgos).

---

## 3. Cola de Sincronización

Hay **dos colas** paralelas. Esto es técnicamente correcto pero complejo:

### 3a. Cola del Local Server (events.ndjson)

**Status: VERIFIED** (tests en `local-server/tests/event-store.test.js`)

| Propiedad | Detalle |
|---|---|
| Archivo | `userData/events.ndjson` |
| Formato | Una línea JSON por evento, append-only |
| Secuencia | Monotónica, asignada en append |
| Idempotencia | `command_id` → `processed-commands.ndjson` |
| Flag `synced` | Existe en cada evento; `markSynced(sequences)` reescribe el archivo |
| Quién llama `markSynced` | **NADIE** — ver §7 Riesgos |
| Escalado | O(N) en `markSynced` — aceptable para ~500 eventos/día |
| Corrupción | Líneas corruptas salteadas con warning; el servidor arranca |

### 3b. Cola del Browser (IndexedDB sync_queue)

**Status: VERIFIED** (código en `pos-offline-db.ts`, tests en `pos-offline-resilience.test.ts`)

| Propiedad | Detalle |
|---|---|
| Storage | IndexedDB `fullsite_pos` v4, store `sync_queue` |
| Transporte | APP_API (`/api/pos/*`) o SUPABASE_REST (PostgREST directo) |
| Conflict detection | `STALE_WRITE_CONFLICT` (terminal, no retry) \| `TERMINAL_NON_RETRYABLE` \| `TRANSIENT_RETRYABLE` |
| Lock de concurrencia | `syncAllRunning` booleano — previene runs paralelos |
| Emergency buffer | `offline-sync.ts` escribe a `localStorage` como fallback; `drainLocalStorageToIdb()` lo migra |
| Límite de retries | 5 intentos por ítem |

---

## 4. Persistencia Local

### 4a. events.ndjson (Local Server)

**Status: VERIFIED**

- Ubicación: `app.getPath('userData')/events.ndjson`
- Persiste entre reinicios del Local Server y del Electron
- La secuencia se recupera al leer el archivo en `load()`
- Los comandos procesados (`processed-commands.ndjson`) también persisten — idempotencia sobrevive restart

### 4b. IndexedDB (Browser)

**Status: VERIFIED**

| Store | Contenido | Versión introducida |
|---|---|---|
| `menu` | Categorías y platillos | v1 |
| `orders` | Órdenes con índices por status y mesa | v1 |
| `inventory` | Ingredientes | v1 |
| `sync_queue` | Cola de operaciones pendientes | v1 |
| `meta` | Timestamps de cache | v1 |
| `modifier_groups` | Grupos de modificadores | v2 |
| `modifiers` | Modificadores | v2 |
| `item_modifier_links` | Relaciones ítem-modificador | v2 |
| `payment_methods` | Métodos de pago | v2 |
| `staff` | Meseros | v2 |
| `turnos` | Turnos (abierto/cerrado) | v3 |
| `cash_movements` | Movimientos de caja | v3 |
| `print_jobs` | Cola de impresión (durable) | v4 |

### 4c. localStorage (Browser)

**Status: PARTIAL** — usado como hot cache para print queue y como emergency buffer de sync. Es volátil (se puede borrar en modo privado o clear de datos). La migración a IDB existe (`drainLocalStorageToIdb`) pero depende de que se llame correctamente en cada ciclo de vida.

### 4d. print-queue.json (Local Server)

**Status: PARTIAL** — el printer adapter escribe jobs al archivo antes de imprimir. El código de retry en startup existe. No hay test de este flujo.

---

## 5. Replicación

**Status: PARTIAL**

En Phase 1, la replicación funciona así:

```
Supabase → (poll 5s) → Local Server → (WS DELTA) → Terminales conectados
```

**Lo que falta (Phase 2):**
```
Local Server → (outbox sync) → Supabase
```

El `unsyncedCount` se reporta en el heartbeat y en `/health`, pero **ningún componente llama `markSynced`** ni empuja eventos del log a Supabase. Los eventos del Local Server son "observaciones" — Phase 1 todavía depende de que el POS haga su propio `syncAll()` al volver a internet.

---

## 6. IPC (Inter-Process Communication)

**Status: VERIFIED**

Electron usa `contextIsolation: true` — el IPC es vía `ipcMain.handle` / `ipcRenderer.invoke` (expuesto en preload.js). **No hay comunicación directa Node.js desde el renderer.**

| Canal IPC | Dirección | Propósito |
|---|---|---|
| `provision:get-info` | renderer → main | Info del sistema + config legacy |
| `provision:scan-lan` | renderer → main | Escaneo de subnet 255 hosts en port 7717 |
| `provision:test-server` | renderer → main | Prueba conectividad a host:port |
| `provision:reset` | renderer → main | Borra config, relanza al wizard |
| `provision:import-config` | renderer → main | Importa respaldo de config |
| `provision:save` | renderer → main | Guarda config, relanza |
| `provision:load-printers` | renderer → main | Lee printers.json |
| `provision:save-printers` | renderer → main | Guarda printers.json (write-tmp → rename) |
| `provision:test-printer` | renderer → main | Prueba TCP a impresora |
| `provision:import-printers` | renderer → main | Importa respaldo printers |
| `app-quit` | renderer → main | Salir de la app |
| `exit-kiosk` | renderer → main | Salir de modo kiosk |
| `enter-kiosk` | renderer → main | Entrar a modo kiosk |

El POS y el KDS se comunican **vía WebSocket** (no IPC), lo que permite que el KDS esté en otra máquina.

---

## 7. Comunicación LAN

**Status: PARTIAL**

### Descubrimiento

| Método | Implementado | Notas |
|---|---|---|
| mDNS (`bonjour-service`) | PARTIAL | Pure JS, no nativo. Error no-fatal si multicast no disponible. Sin test. |
| Last known IP (localStorage) | PARTIAL | El POS guarda la última IP del servidor. No hay código visible que lea y valide esto automáticamente. |
| Manual IP (settings) | PARTIAL | Existe en el wizard de setup, pero la lógica del cliente que usa esta IP no fue auditada. |
| Subnet scan | VERIFIED | `provision:scan-lan` escanea 255 hosts con timeout 500ms. Solo para setup, no recovery runtime. |

### WebSocket

- El servidor escucha en `0.0.0.0:7717` (LAN accesible, no solo localhost)
- Ping/pong: cada 15s, timeout 10s
- Cliente desconectado: eliminado del hub; al reconectar, envía SUBSCRIBE + `last_sequence` y recibe SNAPSHOT + deltas

### Cambio de IP del servidor

**Status: UNKNOWN** — Si el servidor cambia de IP (DHCP), mDNS reanuncia pero los clientes con WS activo pierden conexión. No hay código visible de auto-rediscovery en el cliente WS.

---

## 8. Estados Offline / Online

### Electron POS

**Status: VERIFIED**

```
app_start
  → loadAndValidateConfig()
    ┌─ NOT_PROVISIONED → setup wizard (POS NO inicia)
    └─ PROVISIONED → startLocalServer() → createWindow()

createWindow()
  → loadURL(POS_URL)
    ┌─ SUCCESS → POS operativo
    └─ FAILURE (did-fail-load)
        ├─ net.online = false → loadFile('offline.html') inmediato
        └─ net.online = true  → retry 3x (progresivo 800ms, 1600ms, 2400ms)
                                  → 4º intento fallido → loadFile('offline.html')

setupOfflineRetry()
  → cada 10s, si URL no empieza con 'https://' → loadURL(POS_URL)
```

### Browser POS

**Status: VERIFIED**

```
navigator.onLine = false → Lee de IndexedDB → Opera sin internet
navigator.onLine = true  → syncAll() al montar (si hay pendientes)
                         → window.addEventListener('online') → syncAll()
                         → setInterval 30s → syncAll() si hay pendientes
```

### KDS Standalone (electron-kds)

**Status: PARTIAL**

```
did-fail-load → loadFile('offline.html') inmediato (sin retries)
setupOfflineRetry() → cada 10s → loadURL(KDS_URL)
```

**BRECHA**: el KDS standalone no tiene retries progresivos. Si la red es lenta pero no está caída, carga offline.html prematuramente.

---

## 9. Recovery

**Status: PARTIAL**

| Escenario | Mecanismo | Status |
|---|---|---|
| Local Server reinicia | Replay de events.ndjson → state reconstruido | VERIFIED |
| Electron reinicia | loadAndValidateConfig() → startLocalServer() → state rebuilt | VERIFIED |
| Print jobs pendientes al reiniciar | `_retryPendingJobs()` en printer adapter | PARTIAL (sin test) |
| Print queue browser al reiniciar | `recoverFromIDB()` en print-queue.ts | PARTIAL (sin test) |
| LS buffer a IDB | `drainLocalStorageToIdb()` en registerAutoSync() | VERIFIED (código) |
| Internet vuelve | `window.online` → `syncAll()` | VERIFIED |
| Internet vuelve después de mucho tiempo | Mismo mecanismo + retry hasta 5x por ítem | VERIFIED |
| KDS reconecta a WS | SUBSCRIBE + last_sequence → SNAPSHOT + deltas | VERIFIED (código) |
| Windows reinicia | app.setLoginItemSettings(openAtLogin: true) | VERIFIED |

---

## 10. Resolución de Conflictos

**Status: PARTIAL**

### Browser sync queue

| Tipo | Manejo |
|---|---|
| `STALE_WRITE_CONFLICT` | Terminal. Payload preservado. Sin retry. Sin overwrite. Requiere intervención manual. |
| `TERMINAL_NON_RETRYABLE` | Terminal. Payload preservado. Sin retry. |
| `TRANSIENT_RETRYABLE` | Retry hasta 5x. |
| Evento duplicado (409 Supabase REST) | Se marca como synced (data ya existe). |

### Local Server

| Tipo | Manejo |
|---|---|
| Comando duplicado (mismo `command_id`) | EventStore devuelve `duplicate: true` → WsHub envía ACK con `duplicate: true`. NO se crea un segundo evento. |
| MESA_LOCK simultáneo | CommandHandler verifica lock existente de otro terminal. Si existe y no ha expirado → `REJECT`. |
| STATE_SYNC vs eventos locales | **RIESGO CRÍTICO**: `_applyStateSync` reemplaza todo el estado de mesas/kds/turno. Eventos locales recientes pueden ser sobreescritos por el siguiente poll de Supabase. |

---

## 11. Riesgos

### R1 — CRÍTICO: outbox sync no implementado

**El `unsyncedCount` se reporta pero nadie llama `markSynced`.** Los eventos del Local Server nunca se empujan a Supabase. En Phase 1 esto se mitiga porque el POS browser hace su propio sync a Supabase. En Phase 2 (cuando Local Server sea autoridad de escritura), esto debe estar completamente implementado antes de que se pueda operar sin internet.

### R2 — CRÍTICO: STATE_SYNC borra estado local

`_applyStateSync` (llamado cada 5s desde el Supabase poll) reemplaza completamente `_mesas`, `_kds` y `_turno`. Si hay eventos locales en el event store que aún no se han reflejado en Supabase, serán overwritten en el próximo poll. Este es el comportamiento correcto en Phase 1 (Supabase es autoridad), pero **se convierte en pérdida de datos en Phase 2**.

### R3 — ALTO: KDS hardcoded credentials

`electron-kds/main.js` tiene credenciales hardcodeadas en `executeJavaScript`. Si el KDS standalone se usa, esto es un riesgo de seguridad.

### R4 — ALTO: reconexión WS no probada bajo IP change

Si el DHCP cambia la IP del servidor mientras hay clientes conectados, no hay prueba de que los clientes se redescubran y reconecten automáticamente. mDNS reanuncia, pero el cliente WS no tiene lógica de rediscovery visible.

### R5 — MEDIO: NDJSON markSynced es O(N)

`markSynced` reescribe el archivo completo. A ~500 eventos/día esto es <2MB/año. Pero si hay un bug que acumula eventos sin marcar, el archivo crece y las reescrituras se vuelven lentas.

### R6 — MEDIO: dos coexisten sync sistemas

`offline-sync.ts` (localStorage, más viejo) y `pos-offline-db.ts` (IDB, más nuevo) coexisten. `drainLocalStorageToIdb()` migra los datos, pero si algún código sigue usando `offline-sync.ts`, los datos pueden quedar en localStorage y nunca llegar al sync IDB.

### R7 — BAJO: print queue durable sin test de restart

Los mecanismos de durabilidad (IDB backup, startup recovery) existen pero no tienen tests automatizados que simulen un reinicio real.

### R8 — BAJO: mDNS no garantizado en todas las redes

`bonjour-service` es pure JS y puede no funcionar en redes con multicast bloqueado (ej. redes empresariales, algunos routers TP-Link). Los fallbacks (last known IP, manual) existen pero no están documentados para el operador.

---

## 12. Resumen de Status por Componente

| Componente | Status | Evidencia |
|---|---|---|
| HTTP Server (routes) | VERIFIED | index.js, /health, /state, /events, /print |
| WebSocket Hub | VERIFIED | ws-hub.js + ws-hub.test.js |
| EventStore (NDJSON) | VERIFIED | ndjson.js + event-store.test.js |
| State Machine | VERIFIED | state.js + state.test.js |
| Idempotencia (command_id) | VERIFIED | event-store.test.js: duplicate detection survives restart |
| Outbox sync (events → Supabase) | NOT IMPLEMENTED | markSynced existe, nadie la llama externamente |
| mDNS discovery | PARTIAL | código existe, no hay test, errores no-fatales |
| LAN discovery fallback (last IP) | PARTIAL | mencionado en comments, sin código visible en cliente |
| WS keepalive (ping/pong) | VERIFIED | ws-hub.js 15s/10s |
| WS catch-up (SNAPSHOT + deltas) | VERIFIED | ws-hub.js SUBSCRIBE handler |
| Mesa lock concurrency | VERIFIED | command-handler.js + state.js |
| Supabase poll (STATE_SYNC) | PARTIAL | funciona pero borra estado local (R2) |
| Heartbeat | VERIFIED | heartbeat.js, non-fatal, backoff |
| Update manager | PARTIAL | Phase 1: detecta, no instala |
| Electron offline retry | VERIFIED | main.js did-fail-load + setupOfflineRetry |
| Provisioning gate | VERIFIED | main.js NOT_PROVISIONED → setup, bloquea todo |
| IndexedDB offline cache | VERIFIED | pos-offline-db.ts + tests |
| IDB sync queue | VERIFIED | pos-offline-db.ts |
| Conflict detection (IDB sync) | VERIFIED | STALE_WRITE_CONFLICT + TERMINAL_NON_RETRYABLE |
| LS → IDB migration | VERIFIED | drainLocalStorageToIdb |
| Auto-sync on reconnect | VERIFIED | window.online → syncAll() |
| Turno offline | VERIFIED | turnos store en IDB |
| Print queue (browser) | VERIFIED | 5 estados + IDB backup |
| Print queue (servidor) | PARTIAL | código existe, sin test de restart |
| KDS session sharing (window 2) | VERIFIED | mismo Electron session → mismo IDB |
| KDS standalone offline | PARTIAL | offline.html inmediato, sin retries |
| KDS auto-login | PARTIAL | hardcoded credentials (R3) |
| Windows auto-start | VERIFIED | setLoginItemSettings |
| Config migration (legacy) | VERIFIED | fromLegacy + auto-save a userData |
| IP change auto-reconnect | UNKNOWN | sin código ni test visible |
| Concurrent 3 POS | PARTIAL | MESA_LOCK previene conflictos de mesa; concurrencia de sync no probada |
| Queue con 1000 eventos | UNKNOWN | sin test de volumen |
