# CURRENT PRIMITIVES — qué ya existe en Fullsite

> **Track:** Operational Brain / Universal Operational Ledger — investigación, no implementación.
> **Fecha:** 2026-09-18
> **Revisión auditada:** `origin/main` = `10017cf91a9c46db8bfbebe339d626111be0e868` (2026-09-15).
> **Working tree del checkout:** `ab38234c` en `feat/pos-ui-kit`, **663 commits detrás de `origin/main`** y sucio (123 archivos).
> **Por eso TODA lectura de código de este documento se hizo con `git show origin/main:<ruta>` / `git grep origin/main`, nunca contra el disco.**
> Las líneas citadas (`archivo:L`) son las de `origin/main`, no las del working tree.
>
> **Evidencia de producción:** consultas `SELECT` de sólo lectura contra el proyecto Supabase AMALAY
> (`qjiomlvudfmzuvqvhwpk`) vía MCP `supabase-amalay`, 2026-09-18. Cero escrituras.

---

## Cómo leer las marcas

| Marca | Significa |
|---|---|
| **FACT** | Verificado directamente en `origin/main` o en una consulta a la base de producción. Se cita la fuente. |
| **INFERENCE** | Conclusión fuerte derivada de hechos citados. No se verificó en runtime. |
| **UNKNOWN** | No comprobado en esta sesión. No es "no existe". |

---

## 1. Identidad de operación (command identity)

| Primitivo | Dónde vive | Qué garantiza | Estado |
|---|---|---|---|
| `save_operation_id` | `dashboard-app/src/app/api/pos/save-order/route.ts:83`, `dashboard-app/sql/r2d_save_operation_idempotency.sql` | Clave de idempotencia por `(client_id, order_id, save_operation_id)`. El servidor devuelve `first_execution` / `idempotent_replay`. | **FACT** — vivo en prod |
| `pos_save_operations` (tabla) | baseline `supabase/migrations/00000000000000_baseline_esquema.sql:3952` | Recibo de comando: `EXECUTING → COMMITTED \| REJECTED`, con `payload_hash` SHA-256 canónico y `committed_revision`. Detecta reuso de clave con otro contenido → `PAYLOAD_IDENTITY_CORRUPTION`. | **FACT** — 984 filas, 2026-07-15 → 2026-09-18 |
| `useClaveDeOperacion()` | `dashboard-app/src/lib/clave-de-operacion.ts:57` | La clave identifica la **operación**, no el instante: aleatoria, estable entre reintentos, se renueva sólo al confirmar. Nació de un doble cobro real de inventario en AMALAY (2026-07-20, dos entradas de la misma factura con 1 min 12 s de diferencia). | **FACT** |
| `command_id` (Pedro) | `electron-app/local-server/core/event-store.js:29` (`processCommand`) | Idempotencia en disco **y** en vuelo: dos reintentos concurrentes del mismo `command_id` comparten promesa; contenido distinto → `IDEMPOTENCY_KEY_REUSED`. | **FACT** (código) |
| `sameCommand()` | `electron-app/local-server/core/command-identity.js` | Identidad de contenido canónica: `{type, restaurant_id, payload}` con claves ordenadas. La identidad del relay (qué terminal reenvía) **no** forma parte de la identidad del comando. | **FACT** |
| Diario de reintento del navegador | `dashboard-app/src/lib/pedro-comandos.ts:17` (`claveDeIntento`) | Persiste el comando inmutable en `localStorage` **antes** de enviarlo, con ámbito `[bridgeUrl, clientId, locationId, terminalId, operation]`. Un ACK perdido se reintenta con el mismo ID y cuerpo tras recargar. | **FACT** |
| `RecoverableOperation<T>` | `dashboard-app/src/lib/recoverable-operation.ts:52` | Tres primitivos para efectos externos tipo A (terminal bancaria API): persistencia pre-llamada, `opId` estable, estado bloqueado al montar. Documenta explícitamente qué **no** entra (impresión, cola offline, turnos, huella). | **FACT** |

---

## 2. Eventos

| Primitivo | Dónde vive | Qué es | Estado en producción |
|---|---|---|---|
| Tabla `events` | baseline `:1949` | Event store append-only en la nube. Columnas: `sequence` (identity), `id` (uuid), `type`, `version`, `occurred_at`, `recorded_at`, `actor` jsonb, `payload` jsonb, `audit` jsonb. CHECKs: `envelope_actor_complete` (exige `userId`+`deviceId`) y `sensitive_requires_audit`. | **FACT: 231 filas, 2026-06-12 → 2026-09-04.** Muerta hace 14 días. Distribución: `orders.item.added.v1` 207, `payments.payment.captured.v1` 15, `orders.item.cancelled.v1` 4, `orders.item.voided.v1` 3, `orders.discount.applied.v1` 2. |
| Inmutabilidad de `events` | trigger `events_immutable` → `reject_mutation()` | UPDATE/DELETE rechazados por Postgres. | **FACT** (consultado en `pg_trigger`, 2026-09-18) |
| `publishEvent()` "Shadow Mode" | `dashboard-app/src/lib/events.ts:134` | Publicador fire-and-forget: cola en `localStorage` (tope 1 000), reenvío al reconectar, `on_conflict=id` + `ignore-duplicates`, dedupe de firma <1 s. Nunca truena ni bloquea la venta. | **FACT** (código) — pero ver fila anterior: casi no se llama. |
| `EventEnvelopeV2` | `dashboard-app/src/lib/events/envelope.ts:11` | Contrato **puro y versionado** del envelope: `envelopeVersion`, `id`, `type`, `typeVersion`, `occurredAt`, `actor{userId,deviceId}`, `scope{clientId,locationId,shiftId}`, `payload`, `audit?`. Falla cerrado: sin tenant/sucursal/turno/actor, lanza. Incluye `toEventsRow()` para la migración futura. | **FACT (código) / UNKNOWN (adopción)** — la tabla `events` **no** tiene `client_id`, `location_id` ni `shift_id`; el propio archivo lo dice. |
| `SENSITIVE_EVENT_TYPES` | `envelope.ts:38` | 5 tipos que exigen `audit.approvedBy`, espejo del CHECK de la BD. | **FACT** |
| Event store local de Pedro (NDJSON) | `electron-app/local-server/adapters/storage/ndjson.js`, `core/event-store.js` | Log append-only con transacción + checksum + `fsync`, secuencia monótona, recibos de comando derivados del log, cola de efectos (impresión/cajón) en la misma transacción durable. | **FACT** (código + `docs/architecture/DURABLE-COMMANDS-2026-09-05.md`, 309/309 tests) |
| Catálogo de tipos del protocolo LAN | `electron-app/local-server/protocol.js` | 30 constantes `EVENT.*` (`ORDER_SAVE`, `TURN_OPEN`, `CASH_MOVEMENT`, `FINANCIAL_PAYMENT_RESULT`, `PRINT_UNCERTAIN_RESOLVE`, `STATE_SYNC`…). | **FACT** |

---

## 3. Outbox y recibos

| Primitivo | Dónde vive | Qué garantiza | Estado |
|---|---|---|---|
| `OutboxWorker` (shadow) | `electron-app/local-server/core/outbox.js:110` | Sube eventos a `pos_local_events` en FIFO estricto por `sequence`. **No acepta un 200 vacío como recibo**: si `ignore-duplicates` devuelve `[]`, relee la fila y compara `id`, `sequence`, `ts`, `terminal_id` y contenido canónico. Un 409 detiene el FIFO, no lo salta. | **FACT (código)** · **`pos_local_events` = 0 filas en prod** |
| `BusinessOutbox` | `electron-app/local-server/core/business-outbox.js:21` | Cadena de hash: `historyHash(prev, event)` sobre el sobre canónico `{id, sequence, type, ts, client_id, restaurant_id, payload, result}`. Checkpoint durable por stream. Sólo avanza con un **recibo** que traiga `stream_id`, `sequence`, `event_id`, `history_hash`, `materialized:boolean`, `duplicate:boolean`. | **FACT (código)** · no activado |
| `apply_pos_caja_event()` + `pos_caja_business_receipts` | `supabase/migrations/PENDIENTE_20260905010000_caja_business_materializer.sql` | Proyección de negocio **y** recibo en una sola transacción Postgres. Fence de escritura (`pos_caja_write_fence`) que rechaza cualquier escritor que no haya registrado su recibo en la transacción actual — incluso con service role. | **FACT (SQL escrito)** · **`PENDIENTE`, no aplicado**: no aparece en `supabase_migrations.schema_migrations`, y las tablas `pos_caja_streams` / `pos_caja_business_receipts` **no existen** en AMALAY |
| Puente HTTP fijo | `dashboard-app/src/app/api/pos/caja/materialize/route.ts` | Única ruta al materializador. Valida forma y tamaño (4 MiB + sobre), nunca manda la service key a la terminal. Devuelve `SYNC_UNCONFIRMED` en timeout — no miente. | **FACT** |
| `materialized: false` | `docs/architecture/CAJA-CLOUD-MATERIALIZATION-2026-09-05.md` §Auditoría de papel | Un recibo puede confirmar que el evento **se registró** sin afirmar que movió dinero: impresión, apertura de cajón, resolución de trabajo incierto. | **FACT (diseño escrito)** |

---

## 4. Offline, conflictos y clasificación de fallos

| Primitivo | Dónde vive | Qué es | Estado |
|---|---|---|---|
| Cola de sync IndexedDB | `dashboard-app/src/lib/pos-offline-db.ts` (DB `fullsite_pos` v4) | Stores: `menu`, `orders`, `inventory`, `sync_queue`, `meta`, modificadores, `payment_methods`, `staff`, `turnos`, `cash_movements`, `print_jobs`. | **FACT** |
| `SyncErrorClass` | `pos-offline-db.ts:27` | `TRANSIENT_RETRYABLE` · `STALE_WRITE_CONFLICT` (terminal, no auto-retry, no sobrescribe) · `TERMINAL_NON_RETRYABLE` · `AUTH_EXPIRED` (sólo 401; preserva la cola y pide re-PIN). Un 403 **no** entra ahí. | **FACT** |
| `ReplayTransport` | `pos-offline-db.ts:19` | `APP_API` (obligatorio para mutaciones de orden relevantes a conciliación, pasa por `r1_save_order` + `r1_reconcile_order`) vs `SUPABASE_REST`. | **FACT** |
| `base_version` / `server_revision` / `conflict` | `pos-offline-db.ts:36-43` | Evidencia de conflicto guardada en el ítem de la cola. | **FACT** |
| `clasificar-fallo.ts` | `dashboard-app/src/lib/clasificar-fallo.ts:25` | **TRANSPORT_FAILURE ≠ BUSINESS_FAILURE, ya codificado.** `SIN_ALCANCE` = {0, 408, 425, 429, 5xx, 52x}. `esFalloDeContrato()`, `esFalloDeAutenticacion()`, `ErrorDeSesion`, `ErrorDeContrato`. El encabezado documenta los 4 bugs del 2026-08-31 que produjo confundirlos. | **FACT** |
| `veredicto-de-la-autoridad.ts` | `dashboard-app/src/lib/veredicto-de-la-autoridad.ts` | La misma idea aplicada al PIN: sólo un 401 es un veredicto sobre el PIN; 429/5xx = `autoridad-no-disponible` → respaldo local, no intento fallido. | **FACT** |
| `order_revision` (OCC) | `pos_orders.order_revision bigint` | Control de concurrencia optimista en la orden. | **FACT** (columna confirmada en prod) |
| `pos_reconciliation_results` | baseline `:3868` | Resultados de conciliación de inventario por orden. | **FACT: 1 158 filas, 2026-07-14 → 2026-09-18 (viva)** |

---

## 5. Identidad de terminal, sucursal y build

| Primitivo | Dónde vive | Qué es | Estado |
|---|---|---|---|
| `TerminalConfig` | `dashboard-app/src/lib/terminal-config.ts:31` | `config_version`, `restaurant_id`, `terminal_id` (uuid), `terminal_role` (`server_pos\|pos\|kds\|admin`), `local_server_host/port`, `protocol_version`, `provisioned_at`, `client_id`, `location_id`, `channel`, `timezone`. Deep-link `fullsite-pos://provision?data=…`. | **FACT** |
| `rendererIdentity()` | `electron-app/local-server/core/renderer-identity.js:22` | Inyecta al navegador `fullsite_client_id`, `pos_terminal_id`, `FULLSITE_TERMINAL_ID`, `FULLSITE_LOCATION_ID`, `FULLSITE_LAN_SECRET`, `FULLSITE_BRIDGE_URL`. Sólo para orígenes propios (`app.fullsite.mx` o el KDS local). | **FACT** — **la identidad de terminal YA está en el navegador** |
| `identidadDeBuild()` | `electron-app/local-server/core/identidad-de-build.js` | Lee `build-info.json`: `sha` (7–40 hex, truncado a 12), `rama`, `sellado_en`, `limpio`. Etiqueta `1.4.0 · a1b2c3d4e5f6+cambios`. Si no hay sello, lo dice en vez de inventar. | **FACT** |
| `getTerminalId()` (web) | `dashboard-app/src/lib/pos-sessions.ts:23` | Si no hay `pos_terminal_id`, **inventa** `term_<base36>_<rand>` en `localStorage`. | **FACT** |
| `pos_sessions` | baseline `:3987` | Única tabla-registro de terminal en la nube: `terminal_id`, `staff_id`, `client_id`, `last_heartbeat`. Heartbeat cada 2 min, expira a 5. | **FACT: 0 filas en producción.** |
| `local_server_heartbeats` | baseline `:2116` | Telemetría de flota de Pedro: versión, protocolo, uptime, `clients_connected`, `sync_queue_size`, `print_jobs_failed`, `health_status`, `disk_free_mb`. PK `server_id` + `merge-duplicates` → guarda **sólo el último**, sin serie de tiempo. | **FACT: 0 filas en producción.** El código avisa en `warn` cuando se apaga (`telemetry/heartbeat.js:46`) tras meses muerto en silencio. |
| `pos_terminals` / `pos_terminal_enrollments` | migraciones `20260827120000`, `20260827130000` | Registro de terminales por sucursal. | **FACT: las migraciones NO están aplicadas en AMALAY** y las tablas **no existen** en producción. |

---

## 6. Auditoría

| Tabla | Filas (prod, 2026-09-18) | Inmutable en BD | Lleva actor | Lleva terminal | Lleva operation_id |
|---|---:|---|---|---|---|
| `pos_audit_log` | **1 686** (2026-07-08 → 2026-09-18, **viva**) | ❌ no | ✅ `actor` (texto), `approved_by`, `reason` | ❌ | ❌ |
| `events` | 231 (última 2026-09-04, **dormida**) | ✅ `events_immutable` | ✅ `actor{userId,deviceId}` | ✅ vía `deviceId` | ✅ `id` = command_id |
| `platform_audit_log` | 15 | ✅ `platform_audit_log_no_mutate` | ✅ `actor_email`, `actor_user_id` | ❌ | ❌ |
| `agent_audit_log` | 9 412 | ❌ | ✅ `agent_name`, `auth_role` | n/a | ❌ |
| `integration_audit_log` | 292 | ❌ | ✅ `provider` | n/a | ✅ `correlation_id` |
| `pos_staff_audit` | 0 | ❌ | — | — | — |
| `pos_local_events` | 0 | ❌ | — | ✅ columna existe | ✅ `id` |

Acciones registradas en `pos_audit_log` (prod): `item_added` 849 · `order_sent_kitchen` 395 · `status_changed` 276 · `payment_processed` 54 · `cerrar_app` 34 · `preticket_printed` 23 · `skimming_suspect` 15 · `item_cancelled` 9 · `cash_deposito` 9 · `quantity_changed` 5 · `mesero_reassigned` 3 · `kitchen_item_updated` 3 · `item_modified` 3 · `comandas_print_on/off` 2+2 · `item_voided` 2 · `order_cancelled` 1 · `item_transferred` 1.

**INFERENCE:** el registro que la operación realmente usa (`pos_audit_log`) es el que **no** es inmutable, no lleva terminal y no lleva identidad de operación. El que sí cumple el contrato (`events`) es el que casi no se escribe. El ledger correcto existe y está apagado.

---

## 7. Redacción y manejo de secretos

| Primitivo | Dónde | Qué hace |
|---|---|---|
| `integrations/audit-logger.ts` | `dashboard-app/src/lib/integrations/audit-logger.ts` | Redacta 14 claves (`access_token`, `client_secret`, `api_key`, `authorization`…) hasta 6 niveles antes de persistir. `***REDACTED***`. Nunca lanza. **FACT** |
| `command-authority.js` | `electron-app/local-server/core/command-authority.js` | "Auth tokens stay out of the command payload and therefore out of durable logs and broadcasts." El `actor` lo construye sólo la frontera de transporte. **FACT** |
| `business-outbox.js` `committedEnvelope()` | idem | Omite `synced` y los efectos de impresión (bytes) del sobre que viaja a la nube. **FACT** |

---

## 8. Plano de control y acciones

| Primitivo | Dónde | Qué es | Estado |
|---|---|---|---|
| `SUPPORT_ACTIONS` | `dashboard-app/src/lib/support-actions.ts:21` | Allowlist de 3 acciones (`diagnose` readOnly, `request_sync`, `restart_print_queue`), cada una con `readOnly` y `requiresConsent`. `isConsentValid()` exige consentimiento **con expiración**. Sin `exec`, `shell` ni `sql`. | **FACT** |
| `platform-writes.auditLog()` | `dashboard-app/src/lib/platform-writes.ts:56` | Toda escritura cross-tenant: `requirePlatformAdmin` + service role + fila en `platform_audit_log` con actor derivado del contexto verificado, **nunca del body**. Rate-limit 20/min por admin. | **FACT** |
| `ACTION_TOOLS` (copiloto) | `dashboard-app/src/lib/copilot.ts:88` | 3 acciones de IA (`create_tenant`, `toggle_flag`, `set_tenant_active`) que **reusan endpoints existentes** → heredan auth + auditoría + rate-limit. **El copiloto propone; el humano confirma.** Ejecución gateada por `requirePlatformAdmin2FA`. | **FACT** |
| `pos_authority_transitions` | baseline `:2713` | Máquina de estados de cambio de autoridad de escritura (`supabase ↔ local_server`): `pending → shadow → completing → completed \| cancelled \| timed_out`, con `baseline_sequence`, `shadow_sequence`, `last_reconciled_sequence`, `initiated_by`, `approved_by`, índice único de una transición activa por restaurante. | **FACT (esquema)** · **0 filas** |
| `/api/health` | `dashboard-app/src/app/api/health/route.ts` | 5 checks (conexión, frescura de datos, agentes, auth, costeo). 503 sólo si falla el crítico. **Global, no por tenant ni por terminal.** | **FACT** |

---

## 9. Capa de IA

| Primitivo | Dónde | Qué es | Estado |
|---|---|---|---|
| `AgentEvent` | `dashboard-app/src/lib/agents/types.ts` | `evidence` jsonb + `confidence` (0–1) + `estimated_value` (MXN) + `suggested_action` + `outcome` (`correct`/`false_positive`). | **FACT** |
| `agent_events` | baseline `:1510` | CHECKs de `agent_id`, `severity`, `status`, `confidence ∈ [0,1]`, `outcome`. | **FACT: 292 filas, 2026-08-19 → 2026-09-18 (viva)** |
| `agent_runs` | baseline `:1635` | Traza de ejecución: `status`, `duration_ms`, `rows_processed`, `skip_reason`, `data_status`, `output_summary`. `engine.ts` documenta por qué existe: *"Un agente que no deja rastro de haber corrido es indistinguible de uno que no existe"*. | **FACT: 13 484 filas, 2026-05-07 → 2026-09-18 (la tabla más escrita fuera de `pos_orders`)** |
| `analyst/contract.ts` | `dashboard-app/src/lib/analyst/contract.ts:51` | **Read model determinista para el LLM.** Lista blanca de vistas (no SQL), validada por igualdad exacta; el `tenant` lo pone el servidor y la capa **ni acepta un campo donde ponerlo**; cada vista declara `cobertura` para que un cero por falta de captura no se lea como un cero real; el plan escrito **es** la procedencia de la respuesta. | **FACT** |
| `agents/learning.ts` | `dashboard-app/src/lib/agents/learning.ts` | `applyLearning`, `tallyVerdicts` — realimentación de precisión. | **FACT** (existe; comportamiento **UNKNOWN**) |

---

## 10. Puntos de estrangulamiento (choke points) — dónde instrumentar sale casi gratis

**INFERENCE, con el código citado como base:**

| # | Choke point | Archivo | Qué pasa ya por ahí |
|---|---|---|---|
| 1 | `window.fetch` parcheado del navegador | `dashboard-app/src/lib/supabase-fetch-patch.ts:69` | **Todo** fetch del POS y del dashboard. Ya inyecta `x-fullsite-tenant` y reenrutá al proxy `/api/pos/db`. Es el lugar natural para añadir cabeceras de correlación. |
| 2 | `withPOSAuth` | `dashboard-app/src/lib/api-auth.ts` | Todas las rutas `/api/pos/*`. Resuelve tenant y shift token server-side. |
| 3 | `r1_save_order_idempotent` | `dashboard-app/sql/r2d_save_operation_idempotency.sql` | Toda escritura de orden con clave de operación. Ya escribe el recibo. |
| 4 | `CoreEventStore.processCommand` | `electron-app/local-server/core/event-store.js:29` | Todo comando LAN que pasa por Pedro. |
| 5 | `serverEnvelope()` / `WsHub` | `electron-app/local-server/protocol.js`, `core/ws-hub.js` | Todo broadcast a terminales (SNAPSHOT/DELTA/ACK/REJECT). |
| 6 | `publishEvent()` | `dashboard-app/src/lib/events.ts:134` | Ya tiene cola durable, dedupe e idempotencia. Sólo le faltan llamadores. |
| 7 | `auditLog()` de plataforma | `dashboard-app/src/lib/platform-writes.ts:56` | Toda escritura cross-tenant del plano de control. |
| 8 | `queueOperation` de la cola offline | `dashboard-app/src/lib/pos-offline-db.ts` | Toda escritura diferida del POS. |

---

## 11. Lo que NO se verificó (UNKNOWN honesto)

- **No se ejecutó nada en runtime.** Ni POS, ni KDS, ni Pedro, ni el instalador. Todo el análisis de comportamiento es lectura de código más consultas de sólo lectura a la base.
- **No se abrió `docs/architecture/LOCAL-FIRST.md` (1 476 líneas) completo**, ni `OFFLINE-MASTER.md` (391), ni `docs/offline/OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md`. Se leyeron `EVENT-STORE.md`, `DURABLE-COMMANDS-2026-09-05.md`, `CAJA-CLOUD-MATERIALIZATION-2026-09-05.md`, `DECISION-BRAIN.md` y `constitution/PRINCIPLES.md` (parcial).
- **No se auditaron las 116 rutas `/api/*`** una por una; se listaron todas y se leyeron 6.
- **No se sabe si la llave `anon` de este proyecto es pública** (pendiente heredado de la fuga de `ops_consumo`).
- **No se midió latencia ni volumen real** del outbox de Pedro: `pos_local_events` está en cero, así que no hay datos operativos que medir.
- **No se revisó el KDS de Electron (`electron-kds/`) ni `print-bridge/`** más allá del listado de archivos.
- **`docs/architecture/EVENT-STORE.md` describe una tabla `pos_events`** con `stream_id` / `version` por stream. Esa tabla **no existe** en producción (**FACT**, consultado). El documento está fechado 2026-07-02 y quedó superado por `events` + `pos_local_events`; debe marcarse ⚠️ en `DECISION-BRAIN.md`.

---

## 12. Números de producción citados en este track (todos 2026-09-18)

```
pos_orders                   128 769 filas   2026-05-17 → 2026-09-18
  · con location_id          123 437 (95.9 %)
  · con turno_id             128 769 (100 %)
  · con terminal/device      0  — la columna NO EXISTE
agent_runs                    13 484         2026-05-07 → 2026-09-18
agent_audit_log                9 412
agent_insights                 4 501
pos_audit_log                  1 686         2026-07-08 → 2026-09-18
pos_reconciliation_results     1 158         2026-07-14 → 2026-09-18
agent_results                  1 209
pos_save_operations              984         2026-07-15 → 2026-09-18
pos_print_jobs                   385         2026-06-16 → 2026-09-04
agent_events                     292         2026-08-19 → 2026-09-18
integration_audit_log            292
events                           231         2026-06-12 → 2026-09-04   ← dormida
lab_issues                       200
platform_audit_log                15
pos_local_events                   0
local_server_heartbeats            0
pos_sessions                       0
pos_authority_transitions          0
pos_staff_audit                    0
pos_terminals                      —  tabla inexistente
pos_caja_streams                   —  tabla inexistente
pos_caja_business_receipts         —  tabla inexistente
```

Órdenes por tenant en los últimos 30 días: `scyf-demo` 42 510 · `lab-resto` 2 256 · `tekila-rg` 1 269 · `diezmex-demo` 522 · `demo` 173 · **`amalay` 36** · `fullsite-cert-lab-v2` 24 · `chickin-demo` 16 · `boruca` 16 · `carls-jr` 1.

**FACT que cambia todo el análisis de escala:** el restaurante real produce ~1 orden/día en Fullsite hoy; el resto del volumen es demo y laboratorio. AMALAY sigue operando en Wansoft. **El costo de instrumentar es hoy prácticamente cero, y no volverá a serlo.**
