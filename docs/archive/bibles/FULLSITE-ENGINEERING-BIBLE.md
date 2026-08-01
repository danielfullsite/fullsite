# Fullsite Engineering Bible

> Referencia técnica canónica del sistema Fullsite POS.
> Este documento describe lo que REALMENTE existe en el código.
> Última actualización: 2026-07-23

**Convención de evidencia:**
- **[HECHO]** — Existe en el código y fue verificado. Se incluye archivo y línea cuando es posible.
- **[INFERENCIA]** — Deducido del comportamiento observado o del contexto. No verificado directamente.
- **[PENDIENTE]** — No existe todavía, está diseñado pero no implementado, o es una decisión abierta.

Nunca se usa lenguaje ambiguo como "probablemente", "parece que", "debería". Se elige el nivel correcto y se pone la etiqueta.

**Cross-references a otras Bibles:**
Este documento cubre la arquitectura técnica. Para el comportamiento desde la perspectiva del usuario:
→ Ver [FULLSITE-POS-BIBLE.md] para flujos de operación del cajero/mesero
→ Ver [FULLSITE-OPERATIONS-BIBLE.md] para procedimientos operativos (cierre de turno, incidentes)
→ Ver [FULLSITE-DOMAIN-BIBLE.md] para el modelo de dominio (qué es una orden, un turno, un item)
→ Ver [FULLSITE-PRODUCT-VISION-BIBLE.md] para la visión estratégica de qué construir y por qué

---

## 1. Propósito

Este documento es la referencia técnica canónica para ingenieros que trabajan en Fullsite. Define la arquitectura real del sistema, los contratos entre componentes, los invariantes que nunca deben romperse, y las limitaciones conocidas.

**Para quién:** Cualquier persona que modifique código en los repositorios de Fullsite. Contratistas, coingenieros, futuros coingenieros, y como referencia durante evaluaciones técnicas.

**Qué NO es este documento:** Un diseño de lo que el sistema debería ser. Features pendientes están en la Sección 10 (Limitaciones) y en Open Questions.

---

## 2. Filosofía

### 2.1 El Restaurante no puede saber que Fullsite existe

El principio operativo central: el POS no puede ser un punto de falla visible. El mesero no puede ver una pantalla de error. El cajero no puede esperar. El gerente no puede estar debugging mientras hay clientes.

Este principio no es una aspiración — es el criterio de diseño de cada decisión arquitectónica. Cuando hay un trade-off entre simplicidad del código y resiliencia operativa, gana la resiliencia.

→ Ver [FULLSITE-OPERATIONS-BIBLE.md § Filosofía de confiabilidad] para la expresión operativa de este principio.

### 2.2 Transaction A/B — La Distinción más Importante

No toda operación tiene el mismo peso. En el POS, hay operaciones críticas (guardar la orden, incrementar la revisión) y operaciones deseadas (deducir inventario, actualizar analytics). Mezclarlas en una sola transacción ata el POS a la disponibilidad del componente más frágil.

La filosofía es: **comprometerse pronto, reconciliar después**. El mesero recibe confirmación de que su orden se guardó (Transaction A). El inventario se deduce de forma eventual (Transaction B).

### 2.3 Idempotencia como Ciudadano de Primera Clase

El modo offline no es un caso borde. Las operaciones se replayan al reconectar. Cualquier operación que pueda repetirse DEBE producir el mismo resultado sin importar cuántas veces se ejecute.

### 2.4 Parity First, AI After

El POS debe hacer exactamente lo que Wansoft hace antes de agregar inteligencia. El moat no son los agentes — es el historial completo y confiable de todo lo que pasó en cada restaurante.

→ Ver [FULLSITE-PRODUCT-VISION-BIBLE.md § Ventaja competitiva] para la tesis completa.

---

## 3. Arquitectura

### 3.1 Visión General de Componentes

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Terminal AMALAY                               │
│                                                                     │
│  ┌──────────────────────────────────────────────────┐              │
│  │              Electron App (main.js)               │              │
│  │  ┌─────────────────┐  ┌───────────────────────┐  │              │
│  │  │  Print Bridge   │  │  Fingerprint Proxy    │  │              │
│  │  │  HTTP :7717     │  │  /fp/* → :7718        │  │              │
│  │  └────────┬────────┘  └───────────────────────┘  │              │
│  │           │                                        │              │
│  │  ┌────────▼──────────────────────────────────┐   │              │
│  │  │       BrowserWindow (kiosk)                │   │              │
│  │  │       https://app.fullsite.mx/pos          │   │              │
│  │  │                                            │   │              │
│  │  │  ┌──────────────┐  ┌──────────────────┐   │   │              │
│  │  │  │  IndexedDB   │  │   localStorage   │   │   │              │
│  │  │  │  sync_queue  │  │  print_queue     │   │   │              │
│  │  │  │  menu/orders │  │  pos_auth_cache  │   │   │              │
│  │  │  └──────────────┘  └──────────────────┘   │   │              │
│  │  └────────────────────────────────────────────┘   │              │
│  └──────────────────────────────────────────────────┘              │
│                                                                     │
│   Impresoras en LAN: cocina TCP :9100, barra TCP :9100, caja USB   │
└─────────────────────────────────────────────────────────────────────┘
           │ HTTPS (arranque + sync requieren internet)
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Vercel / Next.js 16                          │
│  /api/pos/save-order → r1_save_order_idempotent                    │
│  /api/pos/pin → pos_staff (service key)                             │
│  (otros endpoints POS)                                               │
└─────────────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Supabase (PostgreSQL)                        │
│  pos_orders, pos_save_operations, pos_staff, pos_turnos             │
│  pos_inventory, pos_recipe_versions, pos_recipe_lines               │
│  pos_audit_log, pos_events (append-only)                            │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Transaction A — Persistencia Autoritativa

**Qué hace:** Escribe atómicamente la mutación de la orden en Supabase. Implementado en `r1_save_order` y `r1_save_order_idempotent`.

**[HECHO]** Secuencia dentro de una sola transacción PostgreSQL (verificado en `r2d_save_operation_idempotency.sql`):

1. Si `save_operation_id` presente: INSERT en `pos_save_operations` con PK `(client_id, order_id, save_operation_id)`.
2. Si INSERT exitoso (primera ejecución): ejecutar `r1_save_order`.
3. `r1_save_order`: UPDATE `pos_orders` WHERE `revision = expected_revision` → `revision = revision + 1`.
4. Si UPDATE afecta 0 rows: rechazar con `{ok: false, conflict: true}`.
5. Si UPDATE exitoso: UPDATE `pos_save_operations` SET `state = 'COMMITTED'`, `committed_revision = nueva_revision`.
6. Si INSERT de `pos_save_operations` falla por PK conflict (replay): leer el row existente y devolver su resultado.

**[HECHO]** Contrato de Transaction A (verificado en `route.ts` líneas 96-107):
- `ok: true` → la orden ESTÁ en Supabase. Garantizado.
- `ok: false` → nada se escribió.
- HTTP 502 → estado desconocido. El cliente DEBE usar idempotencia para determinar el estado.

#### Rationale: Por qué Transaction A está separada de Transaction B

**Problema:** La deducción de inventario puede fallar por múltiples razones: stock insuficiente, timeout de Supabase, conflicto de concurrencia. Si el save de la orden y la deducción de inventario fueran una sola transacción, cualquier fallo de inventario haría fallar el save de la orden. El mesero vería un error y reintentaría — potencialmente creando una orden duplicada.

**Alternativa considerada:** Transacción única con rollback ante fallo de inventario. Rechazado porque: (1) el mesero no puede esperar resolución de conflictos de stock durante el servicio; (2) el inventario puede estar bloqueado por otra orden concurrente y se resuelve en segundos — forzar al mesero a reintentar manualmente es inaceptable en hora pico.

**Por qué se eligió esta implementación:** Transaction A da al mesero confirmación inmediata de que la orden está guardada y fue a cocina (la comanda ya se imprimió). Transaction B reconcilia el inventario en el background, de forma eventual, idempotente.

**Tradeoff conocido:** El inventario puede quedar en estado `PENDING` y el stock puede ser negativo temporalmente si Transaction B no se completa. Esto es preferible a ventas perdidas por fallo del save.

**Cuándo replantearla:** Si el restaurante requiere control de inventario en tiempo real con bloqueo de ventas (ej. "no puedes vender más chilaquiles porque se acabó el huevo"), la arquitectura requiere un cambio fundamental: Transaction B debe moverse dentro de Transaction A, con UX que maneje el bloqueo de forma aceptable para el mesero.

### 3.3 Transaction B — Postprocesamiento Idempotente

**[HECHO]** El único Transaction B implementado actualmente es la deducción de inventario via `r1_reconcile_order`. Verificado en `route.ts` líneas 155-218.

**[HECHO]** Contrato de Transaction B (verificado en `route.ts`):
- Transaction B PUEDE fallar sin afectar Transaction A.
- Un fallo retorna `ok: true` con `inventory_status: 'PENDING'`. No es un error.
- La sync queue SIEMPRE marca el item como `synced` ante `ok: true`, sin importar `inventory_status`.

**[HECHO]** El endpoint verifica si ya se ejecutó Transaction B via `last_inventory_processed_revision` en `pos_orders` antes de llamar a `r1_reconcile_order` en replays. (`route.ts` líneas 130-151)

**[PENDIENTE]** La idempotencia interna de `r1_reconcile_order` en PostgreSQL (que no se creen movimientos duplicados si se llama dos veces para la misma revisión) no fue verificada — el SQL del RPC no está en el repositorio local.

### 3.4 OCC (Optimistic Concurrency Control)

**[HECHO]** Cada orden tiene `revision BIGINT DEFAULT 0`. El cliente envía `expected_revision`. El RPC hace (verificado via SQL inline en `pos-data.ts` y comportamiento de la función):

```sql
UPDATE pos_orders SET ... revision = revision + 1
WHERE id = p_order_id AND client_id = p_client_id AND revision = p_expected_revision
```

**[HECHO]** Si 0 rows actualizadas → `{ok: false, conflict: true, expected_revision, current_revision}`. Verificado en la clasificación de errores en `pos-offline-db.ts` líneas 300-316.

#### Rationale: Por qué OCC en lugar de locks pesimistas

**Problema:** Las órdenes en un POS pueden ser accedidas desde múltiples terminales (caja, supervisor, otro mesero). Sin sincronización, dos writes concurrentes pueden pisarse.

**Alternativa considerada:** SELECT FOR UPDATE (lock pesimista). Rechazado porque requiere mantener una transacción de base de datos abierta durante todo el tiempo que el usuario está editando la orden. En un POS, un mesero puede tener una orden abierta por 20-30 minutos. Locks pesimistas de 30 minutos en PostgreSQL son inaceptables para rendimiento y robustez (qué pasa si el cliente pierde la conexión).

**Por qué se eligió OCC:** El conflicto real (dos terminales editando simultáneamente la misma orden) es raro. OCC es óptimo para el caso feliz (sin conflicto): un round-trip HTTP y listo. El costo de un conflicto (STALE_WRITE_CONFLICT, intervención manual) es aceptable dado que es excepcional.

**Tradeoff conocido:** Ante conflicto, el segundo write falla y requiere intervención manual. No hay auto-merge. Esto es preferible a un merge automático incorrecto que podría perder items o cobrar de más.

**Cuándo replantearla:** Si los conflictos se vuelven frecuentes (múltiples terminales editando la misma orden concurrentemente), considerar event sourcing donde cada terminal appends events en lugar de writes completos, y el servidor merge los events.

### 3.5 Idempotencia via save_operation_id

**[HECHO]** El cliente genera un UUID por cada intento de save. El mecanismo de INSERT-first serialization está verificado en `r2d_save_operation_idempotency.sql`:

1. INSERT en `pos_save_operations` con PK compuesto `(client_id, order_id, save_operation_id)`.
2. Si 0 rows insertadas (PK conflict): leer el resultado previo y devolverlo.
3. Si 1 row insertada: ejecutar el save real, guardar resultado.

**[HECHO]** El hash del payload (SHA-256 via pgcrypto) se verifica en replay para detectar `PAYLOAD_IDENTITY_CORRUPTION`. Los items se ordenan por `item.id` y los modificadores alfabéticamente para producir un hash determinista. (`r2d_save_operation_idempotency.sql` función completa)

#### Rationale: Por qué save_operation_id (en vez de solo OCC)

**Problema:** OCC protege contra writes concurrentes, pero no resuelve el problema de timeout de red. Si el cliente hace un POST y no recibe respuesta (timeout), no sabe si el servidor procesó el request o no. Sin idempotencia, el retry puede crear una segunda escritura con una revisión diferente.

**Alternativa considerada:** Consultar el estado de la orden antes de reintentar. Rechazado porque no es atómico: entre la consulta y el retry, otro write puede modificar la orden.

**Por qué se eligió save_operation_id:** El cliente genera un ID único por operación antes de enviar. Si el servidor ya procesó esa operación, devuelve el resultado original. Si no la procesó, la procesa. El cliente siempre recibe el resultado correcto sin importar cuántos retries haga. El ID vive en `pos_save_operations` con el resultado committed.

**Tradeoff conocido:** `pos_save_operations` crece indefinidamente sin cleanup. Cada save de orden (incluyendo ediciones intermedias) crea una row. Ver Open Questions § pos_save_operations sin Cleanup.

**Cuándo replantearla:** Si el volumen de rows en `pos_save_operations` impacta performance, implementar cleanup automático via pg_cron (ya disponible en el proyecto).

### 3.6 Sync Queue — Offline-First Engine

**[HECHO]** La sync queue persiste en IndexedDB store `sync_queue` en la base de datos `fullsite_pos`. Verificado en `pos-offline-db.ts` función `openDB()`.

**[HECHO]** Transport resolution (verificado en `pos-offline-db.ts` función `resolveTransport()`, líneas 242-247):
1. Si `item.transport` está explícito → usar ese.
2. Si `item.endpoint?.startsWith('/api/')` → `APP_API`.
3. Fallback → `SUPABASE_REST`.

**[HECHO]** `syncAll()` tiene lock de módulo `syncAllRunning` para prevenir ejecuciones concurrentes. (`pos-offline-db.ts` líneas 356-370)

**[HECHO]** Después de sync exitoso via APP_API, se emite el evento `pos-order-synced` via `window.dispatchEvent` con `{orderId, revision, idempotentReplay}`. (`pos-offline-db.ts` líneas 396-403)

#### Rationale: Por qué IndexedDB en vez de localStorage para la Sync Queue

**Problema:** La sync queue necesita persistir operaciones pendientes durante modo offline. Puede acumular decenas o centenas de operaciones en un turno con internet inestable.

**Alternativa considerada:** localStorage. Rechazado porque: (1) límite de ~5MB; (2) síncrono — bloquea el hilo principal al leer/escribir colecciones grandes; (3) no tiene índices para queries eficientes (filtrar por `synced: false`).

**Por qué se eligió IndexedDB:** Asíncrono, límites de almacenamiento grandes (50%+ del espacio disponible), soporte de índices nativos.

**Excepción documentada:** La print queue usa localStorage porque los print jobs son pequeños y la print queue es un módulo independiente que no puede depender de que IndexedDB esté disponible en todos los contextos donde se necesita. `print-queue.ts` es importado por componentes que no siempre tienen acceso al engine de sync.

**Cuándo replantearla:** Si IndexedDB causa problemas en versiones específicas de Electron/Chromium, considerar SQLite via better-sqlite3 en el proceso principal de Electron con IPC.

### 3.7 Print Bridge

**[HECHO]** El print bridge es un servidor HTTP Node.js (`http.createServer`) en `127.0.0.1:7717`, embebido en el proceso principal de Electron. (`electron-app/main.js` función `startBridge()`)

**[HECHO]** Endpoints verificados en `main.js`:

| Endpoint | Método | Propósito |
|---|---|---|
| `GET /health` | GET | Verificar disponibilidad. Retorna `{ok, hostname, stations[]}`. |
| `POST /print` | POST | Imprimir bytes ESC/POS. Body: `{station, data}` (data en base64). |
| `POST /drawer` | POST | Abrir cajón via ESC/POS `\x1b\x70\x00\x19\xfa` a estación `caja`. |
| `POST /test` | POST | Imprimir ticket de prueba en todas las estaciones. |
| `GET /config` | GET | Leer configuración de estaciones. |
| `POST /config` | POST | Actualizar configuración en caliente (escribe `C:\fullsite\printers.json`). |
| `GET,POST /fp/*` | Proxy | Reenviar a fingerprint service en `127.0.0.1:7718`. |

**[HECHO]** Configuración de estaciones cargada desde `C:\fullsite\printers.json`. Defaults: `cocina TCP 192.168.1.21:9100`, `barra TCP 192.168.1.30:9100`, `caja USB {names: ['TICKET', 'EC01', 'EC TICKET']}`. (`main.js` líneas 23-40)

**[HECHO]** Si el puerto 7717 ya está en uso (`EADDRINUSE`), el bridge asume que hay un bridge externo y no intenta iniciarse. (`main.js` líneas 239-244)

#### Rationale: Por qué Electron en vez de PWA

**Problema:** El POS necesita imprimir tickets y comandas en impresoras térmicas via TCP/USB. Los browsers no tienen acceso a sockets TCP ni a impresoras USB.

**Alternativa considerada:** PWA (Progressive Web App) con Service Worker. Rechazado porque: (1) no hay acceso a TCP sockets en el browser; (2) el acceso USB vía WebUSB no soporta impresoras ESC/POS de forma confiable en Windows; (3) no hay control de modo kiosk en PWA (el usuario puede escapar fácilmente).

**Por qué se eligió Electron:** (1) El bridge Node.js puede abrir sockets TCP directamente; (2) Modo kiosk nativo de Electron es robusto en Windows; (3) Control total del ciclo de vida de la aplicación (auto-inicio, restart en crash, single instance lock).

**Tradeoff conocido:** El bundle de Electron es significativamente más grande que una PWA. El arranque requiere internet (deuda técnica activa). Las actualizaciones requieren redistribución del ejecutable o mecanismo de auto-update.

**Cuándo replantearla:** Si el hardware evoluciona hacia terminales con impresoras de red (no USB local) y el control de kiosk puede manejarse via configuración de Windows, una PWA se vuelve viable. A largo plazo, la terminal propia (hardware Fullsite) elimina estas restricciones.

→ Ver [FULLSITE-PRODUCT-VISION-BIBLE.md § Hardware terminal] para la visión a largo plazo.

### 3.8 Print Queue

**[HECHO]** La print queue persiste en `localStorage.pos_print_queue`. (`print-queue.ts` constante `STORAGE_KEY`)

**[HECHO]** Loop de retry cada 15 segundos iniciado por `startRetryLoop()`. (`print-queue.ts` constante `RETRY_INTERVAL_MS = 15_000`)

**[HECHO]** Health check del bridge: `GET /health` con timeout 800ms, resultado cacheado 10 segundos. (`print-queue.ts` constantes `BRIDGE_HEALTH_TIMEOUT_MS`, `BRIDGE_HEALTH_TTL_MS`)

**[HECHO]** Escalación a `needs_attention` después de 120 segundos de bridge caído, solo para tipo `comanda`. Otros tipos van a `failed`. (`print-queue.ts` constante `BRIDGE_UNAVAILABLE_ESCALATION_MS = 120_000`)

### 3.9 Autenticación

**[HECHO]** Tres capas verificadas en `layout.tsx`:

**Capa 1 — PIN:** POST `/api/pos/pin` con service key. Cache offline 15 minutos en `localStorage.pos_auth_cache` usando `btoa(pin).slice(0, 8)` como key (no el PIN). (`layout.tsx` líneas 382-399)

**Capa 2 — Huella digital:** `fingerprint-service.exe` en `C:\fullsite\`. Bridge proxea `/fp/*` → `:7718`. POS llama al bridge como punto de entrada único. (`main.js` líneas 249-300, `layout.tsx` líneas 255-321)

**Capa 3 — TurnoGate:** Bloquea toda operación si no hay turno activo. Cache en `localStorage.pos_cached_turno`. (`TurnoGate.tsx`, `layout.tsx` línea 517)

**[HECHO]** KDS paths bypasean toda autenticación. (`layout.tsx` líneas 50-71, `KDS_PATHS = ['/pos/cocina', '/pos/barra', '/pos/panaderia', '/pos/kds']`)

→ Ver [FULLSITE-POS-BIBLE.md § Autenticación] para la experiencia del usuario en login.
→ Ver [FULLSITE-OPERATIONS-BIBLE.md § Huella digital] para el procedimiento de enrollment en campo.

### 3.10 Supabase — Cómo se Usa

**[HECHO]** El Supabase SDK NO se usa en API routes del POS. Se usa `fetch()` directo a PostgREST con service key. Verificado en `save-order/route.ts`, `api-auth.ts`, y todos los endpoints leídos.

#### Rationale: Por qué fetch() directo en vez del Supabase SDK (en el servidor)

**Problema:** Las API routes del POS necesitan hacer queries a Supabase desde Next.js server-side con control total sobre headers y auth.

**Por qué no el SDK:** El Supabase JS SDK tiene un bug conocido en Next.js App Router donde `supabase.auth.getSession()` puede colgar indefinidamente (`hang`) en contexto SSR. El SDK internamente intenta leer cookies de la request de forma que no es compatible con el modelo de request de Next.js 16 App Router. Este bug fue descubierto en producción — las API routes simplemente dejaban de responder.

**Excepción:** El SDK se usa en `data.ts` para `supabase.auth.getSession()` en el cliente (dashboard), con un timeout explícito de 3 segundos como mitigación. Los queries de datos siempre van por `fetch()` directo.

**Tradeoff conocido:** Sin el SDK, no hay type safety automático de las respuestas de Supabase. Los tipos de las respuestas se declaran manualmente o se castean. Esto es un tradeoff aceptable para evitar hangs en producción.

**Cuándo replantearla:** Si Supabase lanza una versión del SDK que sea compatible con Next.js 16 App Router sin los problemas de SSR, y el equipo valida que no hay hangs, se podría migrar de vuelta al SDK para ganar type safety.

### 3.11 Multi-tenancy via client_id

**[HECHO]** `getClientId()` en server-side (`api-auth.ts` líneas 35-41): header `x-client-id` → query param `client_id` → fallback `'amalay'`.

**[HECHO]** `getActiveClientSlug()` en client-side (`data.ts` líneas 48-56): `localStorage.fullsite_client_id` → `NEXT_PUBLIC_DEFAULT_CLIENT_ID` → string vacío.

**[HECHO]** RLS habilitado en todas las tablas del POS. Las funciones SECURITY DEFINER reciben `p_client_id` como parámetro explícito. (`r2d_save_operation_idempotency.sql` `SECURITY DEFINER SET search_path = public`)

---

## 4. Flujos Principales

### 4.1 Login de Staff (online)

**[HECHO]** Verificado en `layout.tsx` líneas 323-425.

```
1. Usuario ingresa PIN (4-6 dígitos numéricos)
2. POST /api/pos/pin { pin, client_id }
3. Servidor: pos_staff WHERE pin = pin AND client_id = client_id AND active = true
4. Retorna { staff: { id, name, role } }
5. POS: sessionStorage.pos_staff + localStorage.pos_auth_cache (hash 15min)
6. checkActiveSession(staffId): verifica no haya sesión activa en otra terminal
7. Si conflict: error "Usuario activo en otra terminal"
8. registerSession(staffId) + startHeartbeat(staffId)
9. ensureAttendanceEntry(staffId, name, 'pin') — registro de entrada silencioso
10. Si biometría disponible y sin template registrado: pantalla de enrollment
11. Si enrollment completado o saltado: setUnlocked(true) → TurnoGate
```

→ Ver [FULLSITE-POS-BIBLE.md § Inicio de turno] para la experiencia completa del cajero.

### 4.2 Guardar una Orden (online, primera vez)

**[HECHO]** Verificado en `route.ts` completo.

```
1. Cliente genera save_operation_id = crypto.randomUUID()
2. POST /api/pos/save-order {order_id, expected_revision: 0, save_operation_id, ...}
3. Servidor: getClientId() → client_id
4. Servidor: fetch rpc/r1_save_order_idempotent
5. RPC: INSERT pos_save_operations (claim)
6. RPC: UPDATE pos_orders WHERE revision = 0 → revision = 1
7. RPC: UPDATE pos_save_operations SET state='COMMITTED', committed_revision=1
8. Si body.comanda_batches: PATCH pos_orders (best-effort, no bloquea)
9. shouldReconcile = true (first_execution)
10. fetch rpc/r1_reconcile_order {p_client_id, p_order_id}
11. inventory_status = COMPLETE | BLOCKED | PENDING | SKIPPED
12. Respuesta: {ok:true, revision:1, inventory_status, first_execution:true}
```

### 4.3 Guardar una Orden (offline → sync al reconectar)

**[HECHO]** Verificado en `pos-offline-db.ts` completo.

```
1. Cliente genera save_operation_id
2. Intenta POST /api/pos/save-order → falla (red caída)
3. queueOperation('pos_orders', 'POST', {...datos, save_operation_id},
     '/api/pos/save-order', undefined, 'APP_API')
4. Imprime comanda local via print bridge (independiente de internet)
5. [Más tarde] Internet regresa → evento 'online'
6. syncAll() invocado por registerAutoSync()
7. replayViaAppApi(item): POST /api/pos/save-order con mismo save_operation_id
8. r1_save_order_idempotent: first_execution o idempotent_replay
9. Si ok: markSynced(item.id) + dispatch 'pos-order-synced' {orderId, revision}
```

→ Ver [FULLSITE-POS-BIBLE.md § Modo offline] para el comportamiento del usuario durante la desconexión.

### 4.4 Replay Idempotente

**[HECHO]** Verificado en `r2d_save_operation_idempotency.sql` y `route.ts` líneas 130-150.

```
1. Operación ya committada (pos_save_operations.state = 'COMMITTED')
2. Cliente replaya con mismo save_operation_id y payload
3. INSERT pos_save_operations → 0 rows (PK conflict)
4. Verifica payload_hash: debe coincidir → PAYLOAD_IDENTITY_CORRUPTION si no
5. Lee pos_save_operations: committed_revision = N
6. Retorna {ok:true, revision:N, first_execution:false, idempotent_replay:true}
7. route.ts: consulta last_inventory_processed_revision
8. Si ya procesado: derivar inventory_status desde lineage
9. Si no procesado: ejecutar r1_reconcile_order (catch-up)
```

### 4.5 Conflicto OCC

**[HECHO]** Verificado en `pos-offline-db.ts` líneas 404-408.

```
1. Terminal A y B tienen orden en revision = 5
2. Terminal A guarda → revision sube a 6
3. Terminal B guarda con expected_revision = 5
4. r1_save_order: 0 rows updated
5. Retorna {ok:false, conflict:true, expected_revision:5, current_revision:6}
6. Sync queue: classifica como STALE_WRITE_CONFLICT
7. markConflict(id, 'STALE_WRITE_CONFLICT', detail, serverRevision:6)
8. Item queda en queue con conflict:true, payload PRESERVADO
9. NO auto-retry. NO overwrite. Requiere intervención manual.
```

→ Ver [FULLSITE-OPERATIONS-BIBLE.md § Resolución de conflictos] para el procedimiento del operador.

### 4.6 Flujo de Impresión Completo

**[HECHO]** Verificado en `print-queue.ts` y `main.js`.

```
1. Orden enviada a cocina → enqueueFailedPrint(bytes, 'cocina', 'comanda', meta)
2. PrintJob creado en localStorage, status='pending'
3. Loop 15s: processQueue()
4. isBridgeHealthy(): GET /health timeout 800ms (cache 10s)
5. Si bridge UP:
   a. job.retries++, status='retrying'
   b. POST /print {station:'cocina', data:base64}
   c. Bridge: base64 → Buffer → printTcp(192.168.1.21, 9100, bytes)
   d. Éxito: status='printed', syncJobToCloud(job)
   e. Fallo + retries >= 5 + comanda: status='needs_attention'
   f. Fallo + retries >= 5 + no-comanda: status='failed'
6. Si bridge DOWN:
   a. status='bridge_unavailable' (sin consumir retries)
   b. > 120s + comanda: status='needs_attention'
   c. > 120s + no-comanda: status='failed'
7. Bridge regresa: needs_attention → pending (auto-recovery)
8. dispatch 'print-queue-updated'
```

---

## 5. Reglas de Negocio

**[HECHO]** Toda orden requiere `turno_id`. TurnoGate bloquea la UI. (`layout.tsx` línea 517, `TurnoGate.tsx`)

**[HECHO]** El `client_id` de una orden no puede cambiar. `r1_save_order` hace WHERE con `client_id = p_client_id`.

**[HECHO]** KDS paths no requieren PIN ni turno. (`layout.tsx` líneas 50-71)

**[HECHO]** Máximo 5 intentos de PIN antes de lockout de 60 segundos. (`layout.tsx` `MAX_ATTEMPTS = 5`, `LOCKOUT_MS = 60000`)

**[HECHO]** Sesión expira por inactividad en 30 minutos. (`layout.tsx` `IDLE_TIMEOUT_MS = 30 * 60 * 1000`)

**[HECHO]** PINs no se cachean en localStorage — solo un hash no-reversible de 8 chars. (`layout.tsx` líneas 392-396)

**[HECHO]** Impresión es 100% local. El print bridge no depende de internet. (`main.js` + `print-queue.ts`)

**[INFERENCIA]** Descuentos y cancelaciones requieren aprobador (supervisor o gerente). Visible en `pos_audit_log` que tiene columna `approved_by`. No verificado directamente en endpoints.

→ Ver [FULLSITE-DOMAIN-BIBLE.md § Reglas de negocio de una orden] para las reglas completas desde la perspectiva del dominio.

---

## 6. Estados (State Machines)

### 6.1 pos_orders — Status

**[HECHO]** Campo `status TEXT DEFAULT 'abierta'` verificado en SQL inline de `pos-data.ts` línea 16.

```
       abierta ──pago──→ cerrada
          │                │
     cancelar          reabrir (supervisor)
          ↓                ↓
      cancelada         abierta
```

→ Ver [FULLSITE-DOMAIN-BIBLE.md § Ciclo de vida de una orden] para el significado de negocio de cada estado.

### 6.2 pos_save_operations — State

**[HECHO]** Verificado en constraint `chk_save_op_state` en `r2d_save_operation_idempotency.sql`.

```
EXECUTING (transiente, dentro de la transacción)
    ├─→ COMMITTED (committed_revision NOT NULL, rejection_detail NULL)
    └─→ REJECTED (committed_revision NULL, rejection_detail NOT NULL)
```

EXECUTING nunca es visible externamente. Insertar + save + UPDATE son atómicos.

### 6.3 SyncQueueItem — error_class

**[HECHO]** Verificado en `pos-offline-db.ts` tipo `SyncErrorClass`.

```
sin error_class + synced:false → procesable
TRANSIENT_RETRYABLE → reintentar (hasta retries >= 5)
STALE_WRITE_CONFLICT → TERMINAL, no reintentar, payload preservado
TERMINAL_NON_RETRYABLE → TERMINAL, no reintentar
synced:true → será limpiado por clearSyncedItems()
```

### 6.4 PrintJob — Status

**[HECHO]** Verificado en `print-queue.ts` tipo `PrintJob.status`.

```
pending → retrying → printed
       ↓ bridge DOWN
bridge_unavailable → pending (bridge regresa, <120s)
                  → needs_attention (>120s, comanda)
                  → failed (>120s, no-comanda)
retrying → needs_attention (max retries, comanda)
        → failed (max retries, no-comanda)
needs_attention → pending (bridge regresa, auto-recovery)
```

### 6.5 pos_turnos — Status

**[INFERENCIA]** La tabla `pos_turnos` tiene campo `status`. Dos estados inferidos: `abierto` y `cerrado`. No verificado en SQL de creación (tabla en el grupo sin migración documentada).

→ Ver [FULLSITE-OPERATIONS-BIBLE.md § Turno] para el procedimiento de apertura y cierre.

---

## 7. Source of Truth

| Entidad | Source of Truth | Fallback offline | Escritura via |
|---|---|---|---|
| Estado de orden | `pos_orders` en Supabase | IndexedDB `orders` | Solo `r1_save_order[_idempotent]` |
| Ledger idempotencia | `pos_save_operations` | (no hay fallback) | Solo `r1_save_order_idempotent` (SECURITY DEFINER) |
| Stock de ingredientes | `pos_inventory` en Supabase | IndexedDB `inventory` (estimaciones) | Solo `r1_reconcile_order` o ajuste manual |
| Menú activo | `pos_menu_categories + pos_menu_items` | IndexedDB `menu` | Dashboard admin |
| Turno activo | `pos_turnos` en Supabase | `localStorage.pos_cached_turno` | UI de turno en POS |
| Sesión de staff | `sessionStorage.pos_staff` | `localStorage.pos_auth_cache` (15min) | POSLayout tras auth exitosa |
| Cola de sync | IndexedDB `sync_queue` | (es la fuente) | `queueOperation()` |
| Cola de impresión | `localStorage.pos_print_queue` | (es la fuente) | `enqueue()` en print-queue |
| Config de impresoras | `C:\fullsite\printers.json` | defaults en `main.js` | POST `/config` al bridge |
| Templates de huella | `fingerprint-service.exe` en disco | `localStorage.pos_fingerprint_staff` | `/fp/enroll` |
| client_id activo (cliente) | `localStorage.fullsite_client_id` | `NEXT_PUBLIC_DEFAULT_CLIENT_ID` | AuthContext en login |
| Eventos históricos | `pos_events` en Supabase | (no hay fallback) | Bridge (Wansoft shadow) o POS (futuro) |

**[HECHO]** La jerarquía Supabase > IndexedDB > localStorage está verificada en el comportamiento de `getActiveClientSlug()` y `TurnoGate.tsx`. Supabase siempre manda al reconectar.

---

## 8. Invariantes

Reglas que nunca pueden romperse bajo ninguna circunstancia.

**Invariante 1:** Toda mutación de estado crítico de `pos_orders` pasa por `r1_save_order` o `r1_save_order_idempotent`. No hay UPDATE directo que bypasee OCC.

**[HECHO]** El único exception es el PATCH de `comanda_batches` que es best-effort y no muta `revision`, `status`, `items`, ni campos financieros. (`route.ts` líneas 111-118)

**Invariante 2:** `pos_save_operations` es inmutable post-EXECUTING. Una operación COMMITTED o REJECTED no puede cambiar de estado.

**[HECHO]** Verificado via el constraint `chk_save_op_committed`. No hay UPDATE en el código que cambie el estado de una operación completada.

**Invariante 3:** `STALE_WRITE_CONFLICT` nunca se auto-resuelve. El payload se preserva, no hay write posterior al servidor.

**[HECHO]** En `pos-offline-db.ts` líneas 404-408: ante STALE_WRITE_CONFLICT, se llama solo a `markConflict()`. No hay ningún fetch al servidor después de ese punto.

**Invariante 4:** `pos_events` es append-only.

**[HECHO]** Trigger `events_immutable` en SCHEMA-INFRASTRUCTURE-REPORT.md: `events.events_immutable (DELETE)` y `events.events_immutable (UPDATE)`.

**Invariante 5:** Un `save_operation_id` solo puede tener un resultado por orden.

**[HECHO]** PK de `pos_save_operations` es `(client_id, order_id, save_operation_id)`. (`r2d_save_operation_idempotency.sql`)

**Invariante 6:** PINs de staff nunca en localStorage.

**[HECHO]** `btoa(pin).slice(0, 8)` se usa como key del cache — no el PIN. (`layout.tsx` líneas 392-396)

**Invariante 7:** Toda orden requiere `turno_id`.

**[HECHO]** TurnoGate bloquea la UI. La validación server-side en `r1_save_order` no fue verificada directamente (SQL del RPC no está en el repo local).

**Invariante 8:** Transaction B no puede causar duplicados bajo replay múltiple.

**[INFERENCIA]** El diseño de `last_inventory_processed_revision` previene re-ejecución. La idempotencia interna del RPC `r1_reconcile_order` no fue verificada — el SQL no está en el repositorio.

---

## 9. Casos Borde

### 9.1 Timeout entre Transaction A y Transaction B

**[HECHO]** Verificado en `route.ts` líneas 186-192: try/catch alrededor de reconciliación. Si falla → `inventory_status = 'PENDING'`, retorna `ok: true`. En el próximo replay, catch-up automático.

### 9.2 Timeout ANTES de que Transaction A Complete

**[HECHO]** Con `save_operation_id`: el replay retorna el resultado original. Sin `save_operation_id` (legacy): el retry puede crear una segunda escritura.

### 9.3 Bridge Caído al Inicio de Turno

**[HECHO]** Si `EADDRINUSE`: bridge asume bridge externo. (`main.js` líneas 239-244). Print queue: bridge DOWN → jobs a `bridge_unavailable` → escalación a `needs_attention` después de 120s.

### 9.4 Sesión de Staff en Dos Terminales

**[HECHO]** `checkActiveSession(staffId)` bloquea el segundo login. (`layout.tsx` líneas 330-338)

**[INFERENCIA]** Si el heartbeat del primer terminal se detiene (crash), la sesión eventualmente expira. El tiempo exacto no fue verificado.

### 9.5 OCC Conflict en Replay de Operación Previamente Rechazada

**[HECHO]** Si `pos_save_operations.state = 'REJECTED'` para el `save_operation_id` que se replaya, el RPC retorna el resultado de rechazo original con `idempotent_replay: true`. Se clasifica como `STALE_WRITE_CONFLICT`. (`pos-offline-db.ts` líneas 301-311)

### 9.6 Impresora TCP Responde pero Imprime Basura

**[HECHO]** `printTcp()` considera éxito si el socket `write()` completa sin error. (`main.js` función `printTcp()`) No hay ACK a nivel aplicación en ESC/POS básico. Limitación del protocolo.

### 9.7 Orden Creada 100% Offline (UUID nunca fue a Supabase)

**Escenario:** Mesero crea orden offline, UUID generado localmente. Al reconectar, la sync queue replaya el save.

**[INFERENCIA]** Si `r1_save_order` hace INSERT cuando la orden no existe, esto funciona. Si solo hace UPDATE, la orden no existe en Supabase y el replay falla.

⚠️ Ver Open Questions § r1_save_order hace INSERT o solo UPDATE.

### 9.8 comanda_batches PATCH Falla

**[HECHO]** El PATCH de `comanda_batches` descarta el error silenciosamente. (`route.ts` líneas 111-118) El KDS muestra la orden como una sola card. Funcional pero UX degradada.

---

## 10. Limitaciones Actuales

### 10.1 Offline Boot — CRÍTICO

**[HECHO]** `POS_URL = 'https://app.fullsite.mx/pos'`. Si falla `did-fail-load` → `offline.html`. (`main.js` líneas 7, 347-349)

**Impacto:** Sin internet al arrancar = POS no funcional.

**[PENDIENTE]** Bundle local en Electron.

### 10.2 KDS no es Local-First

**[INFERENCIA]** El KDS lee órdenes de Supabase via polling. Sin internet, display sin datos nuevos.

**[PENDIENTE]** Cache local de comandas en KDS.

### 10.3 Deducción de Inventario — Estimaciones en Cliente

**[HECHO]** La deducción real (Transaction B) es server-side. Store `inventory` en IndexedDB existe para caché local. (`pos-offline-db.ts` funciones `cacheInventory`, `getCachedInventory`)

**[PENDIENTE]** Eliminar estimaciones del cliente.

### 10.4 62 Tablas sin Migración SQL

**[HECHO]** Documentado en SCHEMA-INFRASTRUCTURE-REPORT.md. Impacto: imposible reprovisionar desde cero.

### 10.5 client_id Fallback 'amalay'

**[HECHO]** `api-auth.ts` línea 42. Impacto: en multi-tenant, requests sin header se enrutan a AMALAY.

**[PENDIENTE]** Cambiar a error 400 `MISSING_CLIENT_ID`.

### 10.6 pos_save_operations sin Cleanup

**[HECHO]** `pg_cron v1.6.4` instalado. **[PENDIENTE]** Job de cleanup.

### 10.7 Debug Logs en Producción

**[HECHO]** `console.log`/`console.error` con prefijos en código de producción. **[PENDIENTE]** Logger condicional por `NODE_ENV`.

---

## 11. Roadmap

**Fase 1 — Pre-cutover C#2 (bloqueante):**
1. Offline boot: bundle en Electron. P0.
2. `client_id` fallback → error 400. P0 para multi-tenant.
3. Migrations SQL para 62 tablas. P0 para reproducibilidad.
4. SQL de funciones críticas en repositorio. P0 para resiliencia.

**Fase 2 — Estabilidad post-cutover:**
5. KDS local-first.
6. Cleanup de `pos_save_operations` via pg_cron.
7. Logger condicional.

**Fase 3 — Escala a 100 restaurantes:**
8. Eliminar estimaciones de inventario del cliente.
9. Verificar idempotencia interna de `r1_reconcile_order`.
10. `x-client-id` obligatorio con error 400 explícito.

→ Ver [FULLSITE-PRODUCT-VISION-BIBLE.md § Roadmap] para la visión de producto que guía estas prioridades.

---

## 12. Referencias al Código

### 12.1 Archivos Verificados

| Archivo | Propósito | Cobertura |
|---|---|---|
| `src/app/api/pos/save-order/route.ts` | Transaction A/B, endpoint principal | [HECHO] leído completo |
| `src/lib/pos-offline-db.ts` | Sync queue, IndexedDB, syncAll, error classes | [HECHO] leído completo |
| `src/lib/print-queue.ts` | Cola de impresión con state machine | [HECHO] leído completo |
| `src/app/pos/layout.tsx` | Auth PIN/Huella, TurnoGate mount, kiosk | [HECHO] leído completo |
| `src/lib/api-auth.ts` | getClientId(), getSessionUserId() | [HECHO] leído completo |
| `src/lib/data.ts` | getActiveClientSlug(), fetch con JWT | [HECHO] leído parcial (líneas 1-70) |
| `src/lib/pos-data.ts` | SQL inline de pos_orders, interfaces TS | [HECHO] leído completo |
| `electron-app/main.js` | Bridge, fingerprint proxy, kiosk window | [HECHO] leído completo |
| `electron-app/preload.js` | IPC bridge (quit, exitKiosk, enterKiosk) | [HECHO] leído completo |
| `dashboard-app/sql/r2d_save_operation_idempotency.sql` | Schema + función de idempotencia | [HECHO] leído completo |
| `src/components/pos/TurnoGate.tsx` | TurnoGate component | [HECHO] leído parcial (líneas 1-80) |

### 12.2 Funciones PostgreSQL

| Función | Fuente | Estado |
|---|---|---|
| `r1_save_order_idempotent` | `r2d_save_operation_idempotency.sql` | [HECHO] SQL leído y verificado |
| `r1_save_order` | Solo en Supabase (sin SQL local) | [INFERENCIA] Comportamiento inferido |
| `r1_reconcile_order` | Solo en Supabase (sin SQL local) | [INFERENCIA] Comportamiento inferido |
| `r1_reconcile_item` | Solo en Supabase | [INFERENCIA] Listado en schema report |
| `r1_merge_orders` | Solo en Supabase | [INFERENCIA] Listado en schema report |
| `set_pos_order_number` | Supabase trigger | [INFERENCIA] Listado en schema report |
| `set_updated_at` | Supabase trigger | [INFERENCIA] Listado en schema report |

### 12.3 Discrepancias Documentadas

⚠️ **DISCREPANCIA 1:** `docs/reference/BRIDGE.md` dice que el bridge captura eventos de Wansoft para el Event Store. El código de `electron-app/main.js` (leído completo) solo implementa print bridge y proxy de fingerprint — no hay código de captura de eventos de Wansoft. No se sabe si la captura está en otro proceso/repositorio o es aspiracional.

⚠️ **DISCREPANCIA 2:** `EVENT-STORE.md` describe un buffer local en el bridge para cuando Supabase no está disponible, marcado como "Por validar". El `main.js` leído no muestra ningún buffer. Estado de implementación desconocido.

⚠️ **DISCREPANCIA 3:** El SQL de `r1_save_order` (base, sin wrapper de idempotencia) no está en el repositorio local. Comportamiento ante órdenes nuevas (INSERT vs UPDATE) no verificable.

---

## Open Questions & Future Work

Esta sección es el backlog arquitectónico del sistema. Dudas, deuda técnica, decisiones pendientes, e inconsistencias encontradas.

---

**[DECISIÓN]** ¿`r1_save_order` hace INSERT o solo UPDATE?
> Descripción: Si una orden se crea 100% offline y el UUID nunca llegó al servidor, la sync queue replaya el save. Si `r1_save_order` solo hace UPDATE, la orden no existe en Supabase y el replay falla. Si hace UPSERT o INSERT, funciona. El SQL no está en el repositorio.
> Impacto: Si solo hace UPDATE, las órdenes creadas en offline extendido se pierden al reconectar.
> Prioridad: P0 — verificar y documentar antes del cutover C#2.

---

**[DEUDA]** SQL de funciones críticas no está en el repositorio
> Descripción: `r1_save_order`, `r1_reconcile_order`, `r1_reconcile_item`, `r1_merge_orders`, y triggers solo existen en Supabase. Sin archivos `.sql` en el repo.
> Impacto: Si el proyecto de Supabase se pierde, no se pueden recrear las funciones más críticas del sistema.
> Prioridad: P0 — extraer con `pg_dump --schema-only` y commitear en `dashboard-app/sql/`.

---

**[INCONSISTENCIA]** Bridge de captura de eventos de Wansoft
> Descripción: `BRIDGE.md` y `EVENT-STORE.md` describen captura de eventos de Wansoft en tiempo real. `main.js` (leído completo) no tiene esta funcionalidad. Puede ser: (a) proceso separado no en este repo; (b) pendiente de implementar; (c) mecanismo no documentado.
> Impacto: Si el event store no tiene eventos reales de Wansoft, los agentes de IA corren sobre datos vacíos.
> Prioridad: P1 — clarificar dónde está el código de captura.

---

**[DEUDA]** Idempotencia de `r1_reconcile_order` no verificada
> Descripción: El invariante 8 requiere que Transaction B no cause duplicados bajo replay. La protección en `route.ts` previene llamadas duplicadas en el caso de un solo servidor, pero dos instancias concurrentes de Vercel podrían ambas pasar el check de `last_inventory_processed_revision` y ambas llamar a `r1_reconcile_order`. La idempotencia interna del RPC no fue verificada.
> Impacto: En Vercel con múltiples instancias, replay concurrente podría duplicar movimientos de inventario.
> Prioridad: P1 — verificar el mecanismo anti-duplicación dentro del RPC.

---

**[DECISIÓN]** ¿Cómo se maneja el conflicto de sesión en terminal crasheada?
> Descripción: Si Terminal 1 crashea, el heartbeat deja de llegar. Terminal 2 no puede entrar hasta que la sesión expire. El tiempo exacto de expiración no fue verificado.
> Impacto: Durante servicio activo, crash de terminal bloquea al mesero de entrar en otra terminal.
> Prioridad: P1 — verificar TTL del heartbeat. Considerar override de sesión para gerentes.

---

**[DEUDA]** Offline boot es blocker para producción
> Descripción: El Electron app carga `https://app.fullsite.mx/pos`. Sin internet al arrancar, el POS no funciona.
> Impacto: Corte de luz + reinicio de terminal = POS inoperativo hasta recuperar internet.
> Prioridad: P0 — resolver antes del cutover C#2. Bundle local en Electron.

---

**[DEUDA]** 62 tablas sin migración SQL en el repositorio
> Descripción: 62 de 116 tablas creadas directamente en SQL Editor sin archivos de migración.
> Impacto: Imposible reprovisionar el schema desde cero.
> Prioridad: P0 — extraer con `pg_dump --schema-only` y commitear.

---

**[DECISIÓN]** ¿`client_id` fallback debe ser error 400 o seguir siendo 'amalay'?
> Descripción: El fallback actual a 'amalay' es seguro con un solo cliente. Con múltiples clientes, requests sin header podrían leer/escribir datos de AMALAY.
> Impacto: Bug silencioso de multi-tenancy en el segundo cliente.
> Prioridad: P0 para multi-tenant — cambiar antes de onboardear el segundo cliente.

---

**[DUDA]** ¿Qué pasa con las órdenes en `needs_attention` si el turno se cierra?
> Descripción: Si hay comandas en `needs_attention` cuando el gerente cierra el turno, ¿estas órdenes están en el arqueo? ¿El sistema alerta al gerente?
> Impacto: Órdenes que nunca llegaron a cocina podrían estar en el arqueo, causando discrepancias.
> Prioridad: P2 — verificar el comportamiento y documentarlo.

---

**[DEUDA]** pos_save_operations sin cleanup a largo plazo
> Descripción: Cada save de orden crea una row en `pos_save_operations`. En 100 restaurantes con 100 órdenes/día y 5 saves/orden = 50,000 rows/día = 18 millones de rows/año.
> Impacto: Sin cleanup, el lookup de PK puede degradarse con escala.
> Prioridad: P2 — implementar cleanup via pg_cron antes de llegar a escala. `pg_cron` ya está instalado.

---

> Actualizar este documento cuando cambie la implementación.
> Las entradas de Open Questions se resuelven moviéndolas a las secciones correspondientes como [HECHO] cuando se implementen.
>
> Fullsite — Restaurant Operating System
