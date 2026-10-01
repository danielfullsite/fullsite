# FULLSITE OPERATIONAL BRAIN — arquitectura del ledger operativo universal

> **Track:** investigación y diseño. **No implementación.**
> **Fecha:** 2026-09-18
> **Revisión auditada:** `origin/main` = `10017cf91a9c46db8bfbebe339d626111be0e868` (2026-09-15, PR #417)
> **Working tree del checkout:** `ab38234c` (`feat/pos-ui-kit`), **663 commits detrás** y sucio.
> **STALE_TREE = true** → todo el código citado se leyó con `git show origin/main:` / `git grep origin/main`, nunca del disco.
> **Escrituras a producto: 0 · a base de datos: 0 · a AMALAY: 0 · subagentes: 0.**
>
> Documentos hermanos:
> · [`CURRENT-PRIMITIVES.md`](CURRENT-PRIMITIVES.md) — inventario con evidencia
> · [`IDENTITY-MODEL.md`](IDENTITY-MODEL.md) — identidad y semántica de reintentos
> · [`EVENT-TAXONOMY.md`](EVENT-TAXONOMY.md) — vocabulario y versionado

**Marcas usadas en todo el documento:** **FACT** (verificado en `origin/main` o en la base de producción, con cita) · **INFERENCE** (conclusión derivada de hechos citados) · **UNKNOWN** (no comprobado) · **RECOMMENDATION** (propuesta futura).

---

## 1. EXECUTIVE SUMMARY

### Lo que hay que construir

Un **lenguaje operativo común** y un **ledger** que lo persista, para que cualquier pregunta sobre lo que pasó en cualquier restaurante se conteste con una consulta y no con un ingeniero reconstruyendo la realidad a mano desde tres tablas y un log de Vercel.

### La conclusión que más importa

**Fullsite no necesita una arquitectura nueva. Necesita terminar de conectar la que ya tiene.**

Tras auditar `origin/main` y la base de producción, la situación es ésta:

- Existe un contrato de envelope versionado, puro y validado — y **la tabla que debería recibirlo no tiene sus columnas**. *(`dashboard-app/src/lib/events/envelope.ts`; la tabla `events` no tiene `client_id`, `location_id` ni `shift_id`. El propio archivo lo dice.)*
- Existe un event store local durable con `fsync`, checksum, recibos de comando y cola de efectos con estado `uncertain` — con 309/309 pruebas — y **su outbox a la nube tiene 0 filas en producción**. *(`electron-app/local-server/`, `pos_local_events` = 0.)*
- Existe una tabla de recibos de comando con `payload_hash` y detección de reuso de clave — **y sólo cubre un camino de escritura de un dominio**. *(`pos_save_operations`, 984 filas vs. 128 769 órdenes.)*
- Existe un materializador de negocio con cadena de hash, recibos transaccionales y un fence de escritura a nivel Postgres — **escrito, probado en laboratorio, y con prefijo `PENDIENTE`**. *(`supabase/migrations/PENDIENTE_20260905010000_caja_business_materializer.sql`; las tablas no existen en AMALAY.)*
- Existe telemetría de flota — **con 0 filas**. *(`local_server_heartbeats`.)*
- Existe la identidad de terminal, inyectada al navegador en cada arranque — **y no llega a una sola fila de negocio en la nube**. *(`renderer-identity.js:22`; `pos_orders` no tiene columna de terminal.)*

**INFERENCE:** el cerebro operativo de Fullsite está construido en un ~70 %, disperso en cinco capas, y desconectado. El trabajo no es diseñar; es **cablear, versionar y encender**.

### El momento

**FACT:** AMALAY produjo **36 órdenes en 30 días** en Fullsite (sigue operando en Wansoft). El resto del volumen de producción es demo y laboratorio. **El costo de instrumentar hoy es prácticamente cero y no volverá a serlo.** Cada día de operación real que pase sin `terminal_id` en las filas es historia que no se podrá reconstruir nunca.

### La respuesta a la pregunta crítica del encargo

> *"¿Cuál es la arquitectura fundacional más pequeña que, mantenida cinco años, se convierte naturalmente en el cerebro operativo de todo Fullsite?"*

**Tres cosas, y nada más:**

1. **Un `operation_id` que sobreviva al reintento y viaje en cada escritura** — ya existe en cuatro formas con cuatro nombres; hay que unificarlo y propagarlo.
2. **Un scope obligatorio en cada hecho: `client_id` + `location_id` + `terminal_id` + `shift_id`** — el contrato ya está escrito en `envelope.ts`; faltan las columnas.
3. **Una tabla append-only de hechos con vocabulario versionado** — ya existe (`events`), ya es inmutable por trigger, y está dormida.

No hace falta un event store nuevo, ni un bus, ni un servicio central, ni OpenTelemetry como fuente de verdad. Hace falta que las escrituras que ya ocurren lleven tres identificadores más y dejen una línea en una tabla que ya existe.

---

## 2. CURRENT REALITY

### 2.1 FACT — lo verificado

**Código en `origin/main`:**

| Hecho | Evidencia |
|---|---|
| Contrato de envelope v2, puro y versionado, que falla cerrado sin tenant/sucursal/turno/actor | `dashboard-app/src/lib/events/envelope.ts:11-130` |
| Publicador "Shadow Mode" con cola durable, dedupe y idempotencia por `id` | `dashboard-app/src/lib/events.ts:134` |
| Clave de idempotencia que identifica la operación, no el instante | `dashboard-app/src/lib/clave-de-operacion.ts:57` |
| Clasificación transporte vs. contrato, con 4 bugs de producción documentados en el encabezado | `dashboard-app/src/lib/clasificar-fallo.ts:25` |
| Veredicto de autoridad: sólo un 401 juzga el PIN | `dashboard-app/src/lib/veredicto-de-la-autoridad.ts` |
| Framework de operación recuperable para efectos externos, con la lista explícita de lo que **no** aplica | `dashboard-app/src/lib/recoverable-operation.ts:52` |
| Event store local con transacción + checksum + `fsync`, idempotencia en disco y en vuelo | `electron-app/local-server/core/event-store.js:29` |
| Outbox que **no acepta un 200 vacío como recibo**: relee y compara la fila | `electron-app/local-server/core/outbox.js:110` |
| `BusinessOutbox` con cadena de hash y checkpoint durable por stream | `electron-app/local-server/core/business-outbox.js:21` |
| Recibo de comando en SQL con `payload_hash` canónico y `PAYLOAD_IDENTITY_CORRUPTION` | `dashboard-app/sql/r2d_save_operation_idempotency.sql` |
| Materializador transaccional + fence de escritura a nivel trigger | `supabase/migrations/PENDIENTE_20260905010000_caja_business_materializer.sql` |
| Read model determinista para el LLM: lista blanca de vistas, tenant server-side, columnas de cobertura | `dashboard-app/src/lib/analyst/contract.ts:51` |
| Allowlist de acciones de soporte con `readOnly` y consentimiento con expiración | `dashboard-app/src/lib/support-actions.ts:21` |
| Copiloto que **propone** y el humano confirma; las acciones reusan endpoints ya auditados | `dashboard-app/src/lib/copilot.ts:88` |
| Auditoría de plataforma append-only con actor del contexto verificado, nunca del body | `dashboard-app/src/lib/platform-writes.ts:56` |
| Redacción de 14 claves de secreto antes de persistir | `dashboard-app/src/lib/integrations/audit-logger.ts` |
| Identidad de build sellada (`sha`, `rama`, `limpio`), que dice "sin sellar" en vez de inventar | `electron-app/local-server/core/identidad-de-build.js` |
| Identidad de terminal inyectada al navegador desde `config.json` | `electron-app/local-server/core/renderer-identity.js:22` |

**Base de datos de producción (AMALAY, consultas `SELECT`, 2026-09-18):**

| Hecho | Número |
|---|---|
| `pos_orders` | 128 769 filas · 100 % con `turno_id` · 95.9 % con `location_id` · **0 % con terminal (la columna no existe)** |
| `events` | 231 filas, última **2026-09-04** · inmutable por trigger `events_immutable` |
| `pos_audit_log` | 1 686 filas, viva hoy · **no inmutable**, sin terminal, sin `operation_id`, sin `location_id` |
| `pos_save_operations` | 984 filas, viva hoy · cubre sólo el guardado de orden |
| `pos_local_events`, `local_server_heartbeats`, `pos_sessions`, `pos_authority_transitions`, `pos_staff_audit` | **0 filas cada una** |
| `pos_terminals`, `pos_terminal_enrollments`, `pos_caja_streams`, `pos_caja_business_receipts`, `pos_events` | **no existen** — migraciones no aplicadas |
| `agent_runs` | 13 484 filas — la tabla más escrita fuera de `pos_orders` |
| Órdenes de `amalay` en 30 días | **36** |

### 2.2 INFERENCE — lo derivado

1. **La verdad operativa de Fullsite hoy vive en el estado final de `pos_orders`, no en una historia.** Las tres fuentes de historia (`events`, `pos_audit_log`, `pos_local_events`) cubren respectivamente el 0.2 %, el 1.3 % y el 0 % del volumen.
2. **El registro que la operación usa es el que no cumple el contrato; el que cumple está apagado.** `pos_audit_log` es mutable y sin identidad; `events` es inmutable y con identidad, y no se escribe.
3. **La instrumentación tiene un choke point único y ya construido.** `supabase-fetch-patch.ts:69` intercepta *todo* fetch del navegador y ya inyecta una cabecera de tenant. Añadir tres cabeceras de correlación ahí cubre el 100 % del tráfico del POS y del dashboard sin tocar un solo llamador.
4. **El vocabulario de efectos inciertos ya está resuelto y es genérico.** Los cinco estados de `DURABLE-COMMANDS` (`pending`/`printing`/`printed`/`recoverable`/`uncertain`) sirven tal cual para terminal bancaria, delivery y CFDI.
5. **La empresa ya paga el costo de no tener esto.** Las memorias del proyecto registran al menos tres incidentes que este ledger habría contestado en una consulta: el doble cobro de inventario (2026-07-20), los 4 bugs de clasificación de fallo (2026-08-31), y las dos semanas de "demo muerto con CI en verde".

### 2.3 UNKNOWN — lo no comprobado

- **Nada se ejecutó en runtime.** Ni POS, ni KDS, ni Pedro. Todo es lectura de código y consultas de sólo lectura.
- No se leyeron completos `LOCAL-FIRST.md` (1 476 líneas), `OFFLINE-MASTER.md`, ni `OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md`.
- No se auditaron una por una las 116 rutas `/api/*`; se leyeron 6.
- Se desconoce el volumen real de escrituras por segundo que producirá un restaurante en horas pico con Fullsite como POS autoritativo. Los números de escala de §15 son órdenes de magnitud, no mediciones.
- Se desconoce si la llave `anon` de este proyecto es pública (pendiente heredado).
- Se desconoce si hay ramas o worktrees con trabajo adelantado sobre estos mismos archivos. Hay **~100 worktrees** en la máquina; no se inspeccionaron.

---

## 3. CURRENT ARCHITECTURE MAP

```
┌─ TERMINAL (Electron, o navegador puro) ─────────────────────────────────┐
│                                                                          │
│  UI POS/KDS (Next.js servido desde app.fullsite.mx o desde Pedro)        │
│    · clave-de-operacion.ts        I2 operation_id                        │
│    · pedro-comandos.ts            diario de reintento en localStorage    │
│    · pos-offline-db.ts            IndexedDB v4 · SyncErrorClass · OCC    │
│    · events.ts                    publishEvent → cola localStorage       │
│    · supabase-fetch-patch.ts   ◀── CHOKE POINT #1 (todo fetch)           │
│    · clasificar-fallo.ts          transporte ≠ contrato                  │
│                                                                          │
│  PEDRO (electron-app/local-server, :7717) — sólo rol server_pos          │
│    · protocol.js                  30 tipos EVENT.* · SNAPSHOT/DELTA/ACK  │
│    · ws-hub.js                    broadcast LAN + locks de mesa          │
│    · command-authority.js         actor construido SÓLO en el transporte │
│    · event-store.js            ◀── CHOKE POINT #4 (todo comando LAN)     │
│    · adapters/storage/ndjson.js   transacción + checksum + fsync         │
│    · adapters/print-queue.js      efectos: pending→printing→uncertain    │
│    · outbox.js                 ──▶ pos_local_events    (0 filas)         │
│    · business-outbox.js        ──▶ /api/pos/caja/materialize (inactivo)  │
│    · telemetry/heartbeat.js    ──▶ local_server_heartbeats (0 filas)     │
│    · identidad-de-build.js        build-info.json → sha                  │
│    · renderer-identity.js         inyecta TERMINAL_ID / LOCATION_ID      │
└──────────────────────────────────────────────────────────────────────────┘
                     │ HTTPS
┌─ NUBE (Vercel + Supabase) ───────────────────────────────────────────────┐
│  116 rutas /api/*                                                        │
│    · api-auth.withPOSAuth      ◀── CHOKE POINT #2 (todo /api/pos/*)      │
│    · pos/save-order            ──▶ r1_save_order_idempotent  CHOKE #3    │
│    · pos/caja/materialize      ──▶ apply_pos_caja_event      (PENDIENTE) │
│    · platform/* + platform-writes.auditLog   CHOKE #7                    │
│    · platform/support/action   allowlist + consentimiento con expiración │
│    · platform/copiloto/execute IA propone, humano confirma, 2FA          │
│    · health                    5 checks, global, no por tenant           │
│                                                                          │
│  POSTGRES                                                                │
│    VERDAD DE NEGOCIO   pos_orders 128 769 · pos_turnos · pos_cash_movs   │
│    RECIBOS             pos_save_operations 984  ← sólo un dominio        │
│    HECHOS              events 231 (inmutable, dormida)                   │
│                        pos_local_events 0                                │
│    AUDITORÍA           pos_audit_log 1 686 (mutable) · platform_audit 15 │
│                        integration_audit_log 292 (con correlation_id)    │
│    IA                  agent_runs 13 484 · agent_events 292 · insights   │
│    FLOTA               local_server_heartbeats 0 · pos_sessions 0        │
│    CONTROL             pos_authority_transitions 0 · feature_flags       │
│    LECTURA IA          vistas ocm_* + contrato del analista              │
│                                                                          │
│  OBSERVABILIDAD        Sentry (instrumentation.ts) · PostHog (browser)   │
└──────────────────────────────────────────────────────────────────────────┘
```

Detalle archivo por archivo con evidencia: [`CURRENT-PRIMITIVES.md`](CURRENT-PRIMITIVES.md).

---

## 4. EXISTING PRIMITIVES WE SHOULD REUSE

**Nada de esto se reconstruye. Se conecta.**

| # | Primitivo | Por qué se reusa tal cual |
|---|---|---|
| 1 | `events/envelope.ts` | Es exactamente el envelope canónico que este track iba a diseñar. Puro, versionado, falla cerrado, y ya trae `toEventsRow()` para la migración. **Ya está hecho.** |
| 2 | Tabla `events` + trigger `events_immutable` | Append-only garantizado por Postgres, con `sequence` monótona y CHECK de eventos sensibles. Crear otra tabla sería duplicar. |
| 3 | `publishEvent()` | Cola durable, reenvío al reconectar, `on_conflict=id`, dedupe, fire-and-forget que nunca bloquea la venta. Le faltan llamadores, no funcionalidad. |
| 4 | `pos_save_operations` + `r1_save_order_idempotent` | El recibo de comando canónico. Se **extiende a otros dominios**, no se reemplaza. |
| 5 | `clasificar-fallo.ts` | `TRANSPORT_FAILURE ≠ BUSINESS_FAILURE` ya codificado, con los bugs reales documentados. Es la clasificación de error del ledger. |
| 6 | `SyncErrorClass` de `pos-offline-db.ts` | Cuatro clases con semánticas distintas. El ledger hereda esta taxonomía; no la aplana. |
| 7 | Estados de efecto de `DURABLE-COMMANDS` | `pending`/`retrying`/`printing`/`printed`/`recoverable`/`uncertain` + `resolveUncertain` + `recovered_before_sequence`. Genérico para cualquier efecto externo. |
| 8 | `BusinessOutbox` + `apply_pos_caja_event` | Recibo transaccional con cadena de hash y `materialized:boolean`. Es **el** protocolo de recibo de Fullsite. |
| 9 | `analyst/contract.ts` | Read model determinista para IA, con `cobertura` para distinguir "cero real" de "sin captura". Se extiende con vistas del ledger. |
| 10 | `SUPPORT_ACTIONS` + `isConsentValid` | Modelo de permiso/aprobación con expiración. Es la base del permiso de agente. |
| 11 | `copilot.ts` `ACTION_TOOLS` | IA que propone y reusa endpoints humanos → hereda auth, auditoría y rate-limit. **Este patrón es la decisión correcta y hay que declararlo ley.** |
| 12 | `integrations/audit-logger.ts` | Redacción probada. El ledger usa esta misma lista. |
| 13 | `agent_runs` | Traza de ejecución de agente con `skip_reason` y `data_status`. Ya escribe 13 484 filas. Es la base del audit de agentes. |
| 14 | `identidadDeBuild()` | `build_sha` por componente, con el caso "sin sellar" resuelto honestamente. |
| 15 | `renderer-identity.js` | La identidad de terminal ya está en el navegador. Sólo hay que persistirla. |

---

## 5. GAPS — lo que genuinamente falta

Ordenados por (daño × cuán barato es cerrarlos).

| # | Gap | Evidencia | Severidad |
|---|---|---|---|
| **G1** | **`terminal_id` no llega a ninguna fila de negocio.** El principio #4 de la constitución exige "desde dónde" y hoy es incontestable para 128 769 órdenes. | `pos_orders` sin columna (consultado); `renderer-identity.js:22` sí la tiene en el navegador | **Crítica / trivial de cerrar** |
| **G2** | **No existe identidad de intento (I3) ni de request (I4).** Nadie puede decir cuántas veces se intentó algo, ni cuál intento ganó. | No hay `attempt` ni `request_id` persistido en ninguna tabla | **Crítica / barata** |
| **G3** | **`events` no tiene columnas de scope.** El envelope v2 las exige y la tabla no las tiene, así que el contrato no se puede cumplir. | `envelope.ts` lo declara explícitamente; baseline `:1949` | **Alta / trivial** |
| **G4** | **El registro que se usa es mutable.** `pos_audit_log` (1 686 filas, vivo) sin trigger de inmutabilidad. | `pg_trigger` consultado: sólo `events` y `platform_audit_log` lo tienen | **Alta / trivial** |
| **G5** | **Tres vocabularios sin traducción.** `ORDER_SAVE` / `orders.item.added.v1` / `item_added` nombran lo mismo y no se cruzan. | [`EVENT-TAXONOMY.md`](EVENT-TAXONOMY.md) §1 | **Alta / media** |
| **G6** | **No hay timeline de soporte.** Ninguna consulta reconstruye una orden de punta a punta. Es la consecuencia de G1–G5. | — | **Alta / media** (se cae sola al cerrar G1–G5) |
| **G7** | **Sin telemetría de flota.** `local_server_heartbeats` en 0 y el propio código advierte que una flota que no reporta se ve idéntica a una sana. | `heartbeat.js:46`; 0 filas | **Alta / baja** (es configuración, no código) |
| **G8** | **El heartbeat no guarda serie de tiempo.** PK `server_id` + `merge-duplicates` = sólo el último estado. No se puede ver una degradación. | baseline `:2116` | **Media / baja** |
| **G9** | **Los recibos de comando cubren un solo dominio.** Turnos, caja, inventario, KDS e impresión no tienen equivalente en la nube. | `pos_save_operations` 984 filas | **Media / media** |
| **G10** | **La detección de agente no se liga a la acción resultante.** `agent_events` no apunta a la operación que se ejecutó por su causa. | `agents/types.ts` | **Media / baja** |
| **G11** | **`/api/health` es global.** No hay salud por tenant, por sucursal ni por terminal. | `api/health/route.ts` | **Media / media** |
| **G12** | **El materializador está escrito y apagado.** Todo el trabajo de recibo transaccional + fence existe como `PENDIENTE`. | migración no aplicada; tablas inexistentes | **Alta / alta** (gate de campo) |
| **G13** | **Doc superado sin marcar.** `EVENT-STORE.md` describe `pos_events` con `stream_id`/`version`; esa tabla no existe. | consultado | **Baja / trivial** |

---

## 6. UNIVERSAL OPERATIONAL LANGUAGE

Once conceptos. **La regla que los mantiene útiles: no se colapsan en un "evento" genérico.**

| Concepto | Definición operativa | Dueño de la escritura | Mutable | Lleva `confidence` | Dónde vive hoy |
|---|---|---|---|---|---|
| **COMMAND** | Alguien **quiere** que algo pase. Tiene `operation_id`, contenido inmutable y puede ser rechazado. | El dispositivo | ❌ | ❌ | `pedro-comandos.ts`, `save_operation_id` |
| **EVENT** | Algo **pasó**. Pasado, inmutable, con secuencia. Nunca se rechaza — ya ocurrió. | El event store | ❌ | ❌ | `events`, NDJSON de Pedro |
| **STATE** | Lo que el sistema **cree** que es verdad ahora. Proyección, reconstruible. | El materializador / RPC | ✅ | ❌ | `pos_orders`, `core/state.js` |
| **EFFECT** | Una mutación de negocio **ocurrió** — dinero se movió, stock bajó, papel salió. | El dominio | ✅ | ❌ | filas de negocio + cola de impresión |
| **RECEIPT** | Evidencia **autoritativa** del resultado de un comando. Dice `committed`/`rejected`/`duplicate`/`materialized`. Un 200 no es un recibo. | El servidor | ❌ | ❌ | `pos_save_operations`, `pos_caja_business_receipts` |
| **OBSERVATION** | Un componente **vio** algo. No prueba nada del negocio. | Cualquiera | ❌ | ❌ | `STATE_SYNC`, poll operacional |
| **AUDIT RECORD** | Registro de **rendición de cuentas**: quién, cuándo, desde dónde, qué había antes, quién aprobó. | La frontera de auth | ❌ **nunca** | ❌ | `pos_audit_log` (hoy mutable), `platform_audit_log` |
| **INCIDENT** | Se **violó** un comportamiento esperado. Tiene ciclo de vida y dueño. | Detector o humano | ✅ (estado) | ❌ | `lab_issues` (200 filas), parcialmente `agent_events` |
| **INVARIANT** | Una regla que **siempre** debe ser cierta. Se evalúa; no se declara. | El sistema | n/a | ❌ | CHECKs de Postgres, tests |
| **RECONCILIATION** | Evidencia de que **dos representaciones convergen**. Produce un veredicto, no un booleano. | El reconciliador | ❌ | ❌ | `pos_reconciliation_results` (1 158), `parity_reports` (79) |
| **HEALTH SIGNAL** | Evidencia sobre **disponibilidad**. Serie de tiempo, retención corta, nunca ledger. | El componente | ✅ | ❌ | `local_server_heartbeats` (0), `/api/health` |
| **AI INTERPRETATION** | Explicación **derivada**. Tiene `confidence` y `evidence`. **Nunca es fuente de verdad.** | El agente | ✅ | ✅ | `agent_events`, `agent_insights` |
| **AI ACTION** | Un COMMAND cuyo `actor_type = 'agent'`. **No es una categoría aparte.** | El agente, vía el mismo endpoint humano | ❌ | ❌ | `copilot.ts` (el patrón ya es correcto) |

### Las cinco reglas que hacen que el lenguaje no se degrade

1. **Un EVENT nunca lleva `confidence`.** Si lo necesita, es una AI INTERPRETATION y va a otra tabla. *(Fullsite ya lo hace bien: `agent_events.confidence` existe, `events.confidence` no.)*
2. **Un RECEIPT nunca es un código HTTP.** Un 200 sin cuerpo verificado no confirma nada — `outbox.js:110` ya relee la fila por esta razón exacta.
3. **Un AUDIT RECORD es inmutable a nivel base de datos, no por convención.** Trigger, no buena voluntad.
4. **Una OBSERVATION nunca se convierte en EFFECT.** `pos_local_events` ya tiene `CHECK (type <> 'STATE_SYNC')`; hay que generalizar la idea.
5. **Una AI ACTION entra al ledger con la misma forma que una humana.** Cambia `actor_type`, no el esquema.

---

## 7. IDENTITY MODEL

Desarrollo completo en [`IDENTITY-MODEL.md`](IDENTITY-MODEL.md). Resumen:

**Siete capas de identidad**, de la más humana a la más física:

```
I1 intención humana      (nunca cambia — es el hecho)
I2 operation_id          (dispositivo, antes de la red; cambia sólo al confirmar)   ✅ existe ×4 nombres
I3 attempt_id            (cambia en cada reintento)                                 ❌ NO EXISTE
I4 request_id            (cambia en cada HTTP)                                      ❌ no se persiste
I5 event_id + sequence   (el hecho registrado — nunca cambia)                       ✅ existe
I6 transaction / revision(el commit)                                                ✅ existe
I7 row id                (la fila)                                                  ✅ existe
```

**Cinco invariantes:**

| | Invariante |
|---|---|
| INV-1 | Un `operation_id` produce **como máximo un** efecto de negocio |
| INV-2 | Un `operation_id` con dos contenidos distintos es un error, nunca un éxito |
| INV-3 | Un reintento **no** genera `operation_id` nuevo |
| INV-4 | Un evento de negocio **siempre** trae `client_id` + `location_id` + `terminal_id` + `shift_id` |
| INV-5 | Un ACK perdido **no** es un fallo de negocio |

INV-1, INV-2, INV-3 e INV-5 ya están implementadas al menos una vez cada una. **INV-4 es la única que hoy no se puede cumplir en la nube**, y es la más barata de cerrar.

**El ejemplo canónico** (retiro de caja con red intermitente) produce: **1 intención · 1 `operation_id` · 3 intentos · 2 requests · 1 evento · 1 efecto · 1 movimiento de caja.** De esa historia, Fullsite hoy puede contar el evento y el estado final. No puede contar los intentos ni el timeout — I3 e I4 no existen.

---

## 8. CANONICAL ENVELOPE

**Punto de partida: no se inventa uno. Se extiende `events/envelope.ts` de v2 a v3.**

```ts
// v2 → v3: se AGREGAN campos opcionales. Ningún v2 existente deja de validar.
interface EventEnvelopeV3 {
  envelopeVersion: 3
  schemaVersion: number          // del payload del tipo

  // ── identidad ──────────────────────────────────────────────
  id: string                     // I5 · = operationId en eventos originados por comando
  operationId: string            // I2 · REQUERIDO · estable entre reintentos
  parentOperationId?: string     // sólo si hay descomposición real
  attempt?: number               // I3 · 1, 2, 3…

  // ── scope · REQUERIDO, falla cerrado (ya validado en v2) ──
  scope: {
    clientId: string
    locationId: string
    terminalId: string           // ← NUEVO en v3. El gap G1.
    shiftId?: string             // requerido en POS/caja; ausente en plataforma
  }

  // ── actor ──────────────────────────────────────────────────
  actor: {
    type: 'human' | 'system' | 'agent'
    id: string
    deviceId?: string            // navegador, best-effort (≠ terminalId aprovisionado)
    agentRunId?: string          // sólo type === 'agent'
  }

  // ── qué pasó ───────────────────────────────────────────────
  domain: 'orders'|'payments'|'cash'|'shifts'|'kitchen'|'inventory'|'print'|'platform'
  type: string                   // dominio.entidad.acción.vN
  typeVersion: number
  entity?: { type: string; id: string }

  // ── tiempo · DOS relojes, nunca uno ────────────────────────
  occurredAt: string             // reloj local — puede mentir
  recordedAt?: string            // reloj del servidor — lo pone el store

  // ── resultado ──────────────────────────────────────────────
  outcome?: 'committed' | 'rejected' | 'unconfirmed' | 'duplicate'
  errorClass?: 'TRANSPORT' | 'CONTRACT' | 'AUTH' | 'CONFLICT' | 'BUSINESS'

  // ── procedencia ────────────────────────────────────────────
  buildSha?: string              // de identidadDeBuild()

  // ── carga ──────────────────────────────────────────────────
  payload: Record<string, unknown>   // SIN PII — ver §14
  audit?: { approvedBy: string; reason?: string }
}
```

### Veredicto campo por campo sobre la lista del encargo

**REQUERIDOS:** `event_id`, `operation_id`, `client_id`, `location_id`, `terminal_id`, `actor_type`, `actor_id`, `domain`, `event_type`, `type_version`, `occurred_at`, `recorded_at`, `schema_version`.

**OPCIONALES:** `shift_id` (por dominio), `entity_type`+`entity_id`, `parent_operation_id`, `attempt`, `audit`, `agent_id`+`agent_run_id`, `build_sha`, `outcome`, `error_class`.

**DERIVADOS — nunca se escriben:**

| Campo | Se deriva de |
|---|---|
| `correlation_id` | **es** `operation_id`. Un campo aparte garantiza que en tres meses divergen. |
| `causation_id` | la arista padre→hijo del grafo |
| `sequence` | lo asigna el store |
| `pending_for` | `now() − recorded_at` |
| `network_state` | `error_class`. El estado auto-declarado miente — `navigator.onLine` es el ejemplo clásico y la constitución ya lo prohíbe. |
| `retry` / `replay` booleanos | `attempt > 1` y el origen del evento |

**PELIGROSOS:**

| Campo | Por qué |
|---|---|
| `payload` completo | PII (nombres, RFC, teléfonos) y datos de pago en una tabla **inmutable por diseño** = un problema de cumplimiento que no se puede borrar. Guardar referencia + hash. |
| `ui_state` / "lo que la UI creía" | Tentador para soporte, sin cota de tamaño. Registrar la **decisión** de la UI, no su estado. |
| `local_timestamp` solo | El reloj de una caja de restaurante no es confiable. **Nunca ordenar por él.** |
| `session_id` | Se confunde con `shift_id` y con la sesión de auth. Si hace falta: `auth_session_id`. |
| `request_fingerprint` | Hash sobre datos que pueden traer PII → identificador de cliente encubierto. Definir el dominio del hash o no incluirlo. |

**REDUNDANTES:** `save_operation_id`, `command_id`, `idempotency_key` → son `operation_id` con otro nombre (unificar por alias, no por columna). `source_component`/`destination_component` → `domain` + `terminal_id`. `ui_revision` + `Pedro_version` + `build_sha` → **un solo** `build_sha` por componente emisor.

---

## 9. CAUSAL MODEL

### El grafo mínimo

```
OPERATION (I2)  ← la raíz: la intención humana o de agente
  ├── COMMAND        aceptado por Pedro / por la API
  ├── LOCAL EVENT    seq=N en el NDJSON de la caja
  ├── LOCAL EFFECT   trabajo de impresión / pulso de cajón  [pending|printed|uncertain]
  ├── ATTEMPT 1      → TRANSPORT_FAILURE (timeout)
  ├── ATTEMPT 2      → RECEIPT {committed, duplicate:false, materialized:true}
  ├── CLOUD EFFECT   pos_orders.order_revision = R
  └── RECONCILIATION veredicto: convergen
```

Dos tipos de arista, y sólo dos:

- **`caused_by`** — el hijo no existiría sin el padre *(operación → intento)*
- **`same_operation`** — mismo `operation_id` en otra capa *(evento local ↔ recibo de nube)*

`same_operation` **no es una arista almacenada: es un `WHERE`.** No hay que persistir el grafo. Un índice sobre `operation_id` en cada tabla lo produce.

### ¿Stream único, tablas relacionales, grafo, event store o híbrido?

**RECOMMENDATION: (E) híbrido — pero un híbrido específico y ya empezado.**

| Capa | Forma | Por qué |
|---|---|---|
| Hechos de negocio | **Event store append-only** (`events`, particionada) | Ya existe, ya es inmutable, ya tiene secuencia |
| Recibos de comando | **Tabla relacional** con PK compuesta | La unicidad es la garantía; un stream no la da |
| Estado | **Tablas de negocio** (`pos_orders`…) | Ya existen, ya tienen RLS y OCC |
| Intentos / transporte | **Tabla relacional** de retención corta | Alto volumen, bajo valor histórico |
| Causalidad | **Consulta**, no almacenamiento | Se deriva de `operation_id` + `parent_operation_id` |
| Salud | **Serie de tiempo** con retención corta | No es ledger |

**Se descarta explícitamente:**

- **Base de grafos.** Añade un motor para resolver algo que dos índices resuelven. No hay consultas de camino arbitrario en el caso de uso real de soporte.
- **Un solo stream append-only para todo.** Colapsaría COMMAND, EVENT, OBSERVATION y HEALTH en una tabla. Serían ~90 % telemetría y ~10 % negocio, con retenciones incompatibles.
- **Event sourcing como fuente de verdad de estado.** Fullsite ya tomó la decisión contraria y correcta: `pos_orders` es estado, los eventos son historia. Cambiar eso es reescribir el POS, que está prohibido.

---

## 10. STORAGE ARCHITECTURE

### Quién guarda qué

| Dato | Terminal | Pedro | Nube | Retención |
|---|---|---|---|---|
| Comando en vuelo | `localStorage` (diario de reintento) | — | — | hasta confirmar |
| Cola de escritura | IndexedDB `sync_queue` | — | — | hasta drenar |
| Evento de negocio | — | **NDJSON autoritativo** (fsync) | copia en `events` | local: hasta compactar · nube: 24 meses |
| Efecto físico (impresión/cajón) | — | **cola durable local** | sólo el recibo, `materialized:false` | local: hasta resolver |
| Recibo de comando | — | derivado del log | tabla relacional | 24 meses |
| Estado de negocio | caché IndexedDB | proyección `state.js` | **autoritativo** | vida del tenant |
| Intentos de transporte | — | contador en memoria | tabla, retención corta | **30–90 días** |
| Salud / heartbeat | — | emite | serie de tiempo | **90 días** |
| Traza HTTP | — | — | Sentry | lo que dé el plan |

### Postgres, sí — con tres condiciones

Supabase/Postgres es la elección correcta (ya está pagado, ya tiene RLS, ya tiene los datos, y el equipo lo sabe operar). Pero:

1. **`events` se particiona por mes** antes de que crezca. Hoy tiene 231 filas — es el momento gratis.
2. **Los intentos de transporte NO van a `events`.** Tabla aparte, retención por partición, `DROP PARTITION` como política de borrado.
3. **Payloads grandes: referencia, no cuerpo.** El materializador ya topa en 4 MiB por evento; el ledger debe topar mucho antes y guardar un puntero.

### Caliente vs. frío

- **Caliente (0–90 días):** Postgres, índices completos. Es el 100 % de las consultas de soporte.
- **Tibio (90 días – 24 meses):** Postgres particionado, sin índices secundarios. Auditoría y análisis.
- **Frío (>24 meses):** exportación mensual a objeto (Supabase Storage o S3) en Parquet/NDJSON comprimido. El `DROP PARTITION` sólo se hace **después** de verificar la exportación.

**RECOMMENDATION:** no construir caliente/frío ahora. Definir la **política** ahora (el particionado desde el día uno la hace posible) y construirla cuando la primera partición cumpla 24 meses.

### Logs y eventos de negocio: separados, sin excepción

Un log de aplicación es diagnóstico de ingeniería, puede perderse y no es auditable. Un evento de negocio es evidencia. **Nunca comparten tabla ni retención.** Si algo aparece sólo en un log, no ocurrió para efectos del ledger.

---

## 11. SUPPORT EXPERIENCE

### Lo que un agente de soporte debe poder teclear

Restaurante · Orden · Terminal · Empleado · Mesa · `operation_id` · rango de tiempo · pago. Cualquiera de ellos devuelve **la misma vista**: una línea de tiempo de operaciones.

### La vista

```
ORDEN #842 · AMALAY · Sucursal Centro · Turno T-2026-09-18-A
════════════════════════════════════════════════════════════════════
19:04:11  op=7f3a…  CAJA-01  Daniel (mesero)      build 1.4.0·a1b2c3
          orders.item.added.v1               Chilaquiles $189
          ├ local     COMMITTED  seq=4021              +2 ms
          ├ efecto    comanda impresa · Cocina         +180 ms
          ├ intento 1 TRANSPORT_FAILURE (timeout 8 s)  +8.0 s
          ├ intento 2 TRANSPORT_FAILURE (sin red)      +14 s
          │  ⏳ pendiente en la nube 2 m 31 s
          ├ intento 3 RECEIPT committed rev=17         +2 m 32 s
          └ conciliación  CONVERGE                     +2 m 33 s

19:06:44  op=9c1e…  CAJA-01  Daniel
          payments.payment.captured.v1       Efectivo $189
          └ local COMMITTED · nube COMMITTED rev=18 · cajón: papel confirmado

RESUMEN
  4 operaciones · 0 pendientes · 0 conflictos · 0 efectos inciertos
  Deuda máxima con la nube: 2 m 31 s (19:04:11 → 19:06:44)
  Veredicto: la orden NUNCA se perdió. Estuvo durable localmente 2 m 31 s.
```

### La consulta que la produce

Con `operation_id` y `terminal_id` en todas las tablas, es un `UNION ALL` de seis fuentes ordenado por `recorded_at`. **Nada exótico.** El motivo por el que hoy no se puede escribir no es la falta de un motor: es la falta de tres columnas.

### Las siete preguntas que soporte hace de verdad

| Pregunta | Qué la contesta | ¿Se puede hoy? |
|---|---|---|
| "Desapareció una orden" | timeline + `pending_for` | ❌ |
| "Se cobró dos veces" | `operation_id` distintos con mismo contenido | ⚠️ sólo en el guardado de orden |
| "No imprimió" | cola de efectos, estado `uncertain` | ⚠️ sólo local, hay que ir a la caja |
| "La caja no sincroniza" | `pending_events` por terminal | ❌ (`local_server_heartbeats` = 0) |
| "Desde qué terminal salió esto" | `terminal_id` | ❌ |
| "Qué build introdujo esto" | `build_sha` en el evento | ❌ |
| "A qué otros restaurantes afecta" | mismo `type` + `error_class` + `build_sha` cross-tenant | ❌ |

**INFERENCE:** las siete se vuelven contestables con las mismas tres columnas. No hay que construir siete cosas.

### La regla de honestidad de la vista

**Una operación sin evidencia se muestra como `NOT_OBSERVED`, nunca como `OK`.** Un hueco en el timeline es un hueco, no un éxito silencioso. Es la traducción directa de `NOT_OBSERVED != PASS` a la UI.

---

## 12. CONTROL PLANE RELATIONSHIP

### La relación en una frase

> **El Operational Brain es el sustantivo; el Control Plane es el verbo. El Control Plane lee del ledger y escribe **al** ledger. Nunca lo esquiva.**

```
                ┌──────────────────────┐
                │   OPERATIONAL BRAIN   │
                │  eventos · recibos    │
                │  auditoría · salud    │
                └───────┬───────┬──────┘
                    lee │       │ escribe (toda acción)
                        ▼       │
                ┌──────────────┴──────┐
                │    CONTROL PLANE     │
                │  flota · diagnóstico │
                │  acciones · updates  │
                └──────────────────────┘
```

### Vista de terminal

| Campo | Fuente | Estado hoy |
|---|---|---|
| `terminal_id`, rol, sucursal | `TerminalConfig` / registro de terminales | ⚠️ tabla no existe en prod |
| `build_sha` de Pedro y de la UI | heartbeat + `identidadDeBuild()` | ⚠️ 0 heartbeats |
| online / offline, último latido | heartbeat | ❌ |
| tamaño de cola, `pending_for` | `BusinessOutbox.status()` | ⚠️ existe, no expuesto |
| conflictos sin resolver | `STALE_WRITE_CONFLICT` en la cola | ❌ local |
| efectos inciertos (papel/cajón) | `getUncertainJobs()` | ⚠️ existe, sólo LAN |
| impresoras, KDS, disco | heartbeat | ❌ |
| operaciones recientes | ledger | ❌ |

**INFERENCE:** el 80 % del Control Plane se enciende **configurando el heartbeat**, no escribiendo código. `local_server_heartbeats` en 0 con el código escrito y avisando en `warn` es un problema de despliegue.

### Acciones y su contrato

Toda acción del Control Plane obedece las cinco reglas que `support-actions.ts` ya implementa para tres acciones:

1. Está en una **allowlist** — sin `exec`, `shell` ni `sql` arbitrario
2. Declara si es **`readOnly`**
3. Declara si exige **consentimiento del cliente, con expiración**
4. Deja una **fila de auditoría** con actor del contexto verificado
5. Produce un **recibo de comando** — "se encoló" ≠ "se ejecutó"

**RECOMMENDATION:** el catálogo crece así (cada una con su nivel):

| Acción | readOnly | consentimiento | aprobación |
|---|---|---|---|
| ver timeline / diagnóstico | ✅ | — | — |
| ver logs de terminal | ✅ | ✅ | — |
| pedir sincronización | ❌ | ✅ | — |
| reiniciar cola de impresión | ❌ | ✅ | — |
| forzar conciliación | ❌ | ✅ | ✅ 2FA |
| preparar update | ❌ | ✅ | ✅ 2FA |
| rollback de versión | ❌ | ✅ | ✅ 2FA + ventana |
| cambiar autoridad de escritura | ❌ | ✅ | ✅ 2FA + corte coordinado (ya especificado en `pos_authority_transitions`) |

---

## 13. AI / AGENT ARCHITECTURE

### La cadena, y dónde está el muro

```
ESTADO DETERMINISTA + EVENTOS + RECIBOS + AUDITORÍA + SYNC + SALUD + INVARIANTES + CONCILIACIÓN
                                    │
                            ╔═══════▼════════╗
                            ║  READ MODEL    ║  ← lista blanca, tenant server-side
                            ╚═══════╤════════╝     (analyst/contract.ts YA ES ESTO)
                                    ▼
                          AI INTERPRETATION  ← confidence + evidence, NUNCA verdad
                                    ▼
                            RECOMMENDATION
                                    ▼
                    ┌───────────────┴───────────────┐
              reversible                      irreversible
                    │                               │
              ejecuta + audita          propone → humano confirma → ejecuta + audita
                    └───────────────┬───────────────┘
                                    ▼
                    LA ACCIÓN ENTRA AL LEDGER como cualquier acción humana
```

### Lo que Fullsite ya hace bien (y hay que declarar ley)

**FACT:** `copilot.ts:88` — las acciones de IA **reusan los endpoints `/api/platform/*` existentes**, así que heredan auth, auditoría, rate-limit y validación sin escribir nada nuevo. Y `copiloto/execute` exige `requirePlatformAdmin2FA` y sólo acepta acciones de la allowlist.

**RECOMMENDATION — la regla, en una línea:**

> **Un agente no tiene una API propia. Un agente usa las mismas puertas que un humano, con `actor_type='agent'`.**

Un agente con su propio camino de escritura es un agente fuera del sistema que observa — que es exactamente lo que el encargo prohíbe.

### Lo que falta

| # | Gap | Propuesta |
|---|---|---|
| A1 | La detección no apunta a la acción resultante | `agent_events.resulting_operation_id` |
| A2 | No hay política de reversibilidad por acción | `reversible: boolean` + `undo_operation` en la definición de la herramienta |
| A3 | Cada agente decide su umbral de confianza | Política central: `confidence` y severidad determinan si propone, ejecuta o escala |
| A4 | Nada valida la frescura del contexto | El read model devuelve `as_of`; una acción con contexto viejo se rechaza, no se ejecuta |
| A5 | Un agente en bucle no tiene tope | Presupuesto por agente/tenant/hora — el patrón de `platform-writes.rateLimit` ya existe |

### Las cosas que un agente debe poder decir, y qué las habilita

| Afirmación | Requiere |
|---|---|
| "La terminal PDV3 acumula 42 escrituras pendientes" | heartbeat + `pending_events` (G7) |
| "La orden 123 está comprometida localmente y no hay recibo de nube" | ledger con recibos (G1–G3) |
| "Hubo 3 reintentos y un solo efecto de negocio" | `attempt` + `operation_id` (G2) |
| "La impresora de Cocina dejó de confirmar trabajos" | cola de efectos expuesta (G7) |
| "Divergencia de inventario" | `pos_reconciliation_results` — **ya se puede hoy** |
| "El proveedor A es más caro que el B" | datos de compras — fuera de este track |

### Traceabilidad: la regla dura

**Toda afirmación de un agente debe poder rendir sus `event_id` / `receipt_id`.** El read model no devuelve números sueltos: devuelve números **con la lista de identificadores que los produjeron**. `analyst/contract.ts` ya diseñó la mitad de esto (el plan escrito **es** la procedencia). El ledger le da la otra mitad: los identificadores concretos.

---

## 14. SECURITY / TENANCY / PRIVACY

### Tenancy

- **Todo registro lleva `client_id`, sin excepción.** Ya hay un CHECK de `client_id` no vacío en prod (`20260901211727_client_id_no_vacio`).
- **RLS en `events` desde el día uno**, como ya lo tiene `pos_local_events` (sólo lectura, sólo admin/owner del propio restaurante).
- **El tenant nunca viene del body.** Ya es el patrón: `x-fullsite-tenant` validado contra `client_users`, y `analyst/contract.ts` **ni siquiera acepta un campo** donde ponerlo.
- **Vistas del ledger con `security_invoker`.** La fuga de `ops_consumo` (2026-09-09) fue exactamente esto: vistas expuestas a `anon` sin `security_invoker`. El ledger no puede repetirla.

### Privacidad — la regla que hay que fijar antes de escribir la primera fila

> **Un ledger inmutable con PII es un problema de cumplimiento que, por diseño, no se puede borrar.**

Por lo tanto:

| Dato | Va al ledger |
|---|---|
| `menu_item_id`, cantidades, montos, `staff_id` | ✅ |
| Nombre del cliente, teléfono, email, RFC, dirección | ❌ **referencia a la fila, nunca el valor** |
| PAN, token de tarjeta, últimos 4 | ❌ **nunca**, ni truncado |
| PIN, hash de PIN, huella, plantilla biométrica | ❌ **nunca** |
| Tokens, service keys, secretos LAN | ❌ **nunca** — `command-authority.js` ya lo garantiza por construcción |

La lista de redacción de `integrations/audit-logger.ts` (14 claves, 6 niveles) se reusa y se amplía. Y la **regla de construcción** de `command-authority.js` es mejor que redactar: *"auth tokens stay out of the command payload and therefore out of durable logs and broadcasts."* Lo que no entra no hay que redactarlo.

### PCI

Fullsite integra terminales por API (MP Point, Clip). **El ledger registra el `payment_attempt_id` del proveedor y el resultado, nunca datos de tarjeta.** `pos_payment_attempts` (en la migración pendiente) ya está diseñada así, con estados `pendiente|aceptado|rechazado|desconocido` — y `desconocido` es precisamente el estado honesto que la mayoría de los sistemas no tiene.

### Cifrado

En reposo: el de Supabase. En tránsito: TLS, y el materializador **rechaza no-HTTPS por construcción** (`business-outbox.js`). Cifrado a nivel columna: no, no hay PII en el ledger — ésa es la mitigación.

### Retención vs. derecho de borrado

Un ledger inmutable y el derecho de borrado chocan. La resolución: **el ledger guarda referencias, no valores**. Borrar el cliente borra la fila de `pos_customers`; el evento conserva un identificador que ya no resuelve a nada. La historia operativa sobrevive; el dato personal no.

---

## 15. SCALE ANALYSIS

### La base de estimación

**FACT:** AMALAY hizo 36 órdenes en 30 días en Fullsite (sigue en Wansoft). Un restaurante real en cutover produce del orden de **150–400 tickets/día**.

**Supuestos declarados (órdenes de magnitud, no mediciones):** ~8 eventos de negocio por ticket + ~4 de turno/caja/impresión por día-terminal. Payload medio 1.5 KB. **UNKNOWN**: nadie midió esto en un restaurante con Fullsite autoritativo.

| Escala | Tickets/día | Eventos/día | Eventos/año | Tamaño/año (1.5 KB) | Veredicto |
|---|---:|---:|---:|---:|---|
| 1 restaurante | 300 | ~2.5 K | ~0.9 M | **~1.4 GB** | Postgres sin pensarlo |
| 10 | 3 K | 25 K | 9 M | ~14 GB | Postgres sin pensarlo |
| **100** | 30 K | 250 K | 90 M | **~135 GB** | Postgres **particionado por mes** |
| **1 000** | 300 K | 2.5 M | 900 M | **~1.4 TB** | Particionado + frío a objeto + índices por tenant |
| **10 000** | 3 M | 25 M | 9 000 M | **~14 TB** | Caliente 90 d en Postgres; el resto en objeto + motor analítico |

**INFERENCE:** hasta ~1 000 restaurantes, **un Postgres particionado es suficiente**, con exportación en frío. El cambio de arquitectura no ocurre hasta ~10 000, y para entonces habrá datos reales. Diseñar hoy para 10 000 es construir para un cliente que no existe mientras el cliente #1 todavía no hizo cutover.

**La única decisión que hay que tomar ahora porque después cuesta 100×: particionar `events` por mes desde el principio.** Con 231 filas es un `ALTER` trivial.

### Costo

**FACT (memoria del proyecto, `project_costo_polling`):** Supabase se pasó de cuota por **~12 M de requests** de polling (la cocina consultaba cada 2 s), no por disco — y la base estaba en 150 MB de 500 MB, con el 95 % en datos de demo.

**INFERENCE crítica para este diseño:** en Fullsite, **el costo es de requests, no de almacenamiento**. Un ledger que escribe **un lote por operación** es barato. Un ledger que alguien consulta por polling cada 2 s desde un dashboard es lo que tumba la cuota. La decisión de diseño que se deriva:

> **Escrituras en lote, lecturas bajo demanda. Ningún panel del Control Plane hace polling del ledger.** Se refresca cuando alguien lo mira, o por push.

---

## 16. FAILURE MODES

| # | Modo | Cómo lo maneja este diseño | ¿Ya existe? |
|---|---|---|---|
| 1 | **Evento duplicado** | Idempotencia por `event_id` = `operation_id`; `on_conflict` + verificación de la fila almacenada | ✅ `events.ts`, `outbox.js:110` |
| 2 | **Evento faltante** | `sequence` monótona detecta el hueco; el outbox **detiene el FIFO**, no lo salta | ✅ `outbox.js`, `business-outbox.js` |
| 3 | **Evento fuera de orden** | Se ordena por `sequence` y `recorded_at`, **nunca** por `occurred_at` | ✅ (parcial) |
| 4 | **Desfase de reloj** | Dos relojes siempre: `occurred_at` (local, puede mentir) y `recorded_at` (servidor). Si `\|Δ\| > umbral`, se emite un incidente | ⚠️ `events` ya tiene ambos; falta el detector |
| 5 | **Terminal offline** | El NDJSON local es autoritativo; la nube es copia. `pending_for` mide la deuda | ✅ Pedro |
| 6 | **Ambigüedad de red** | `TRANSPORT ≠ BUSINESS`. Estado `UNCONFIRMED`, nunca `FAILED` | ✅ `clasificar-fallo.ts`, `SYNC_UNCONFIRMED` |
| 7 | **Reintento duplicado** | Mismo `operation_id`, `attempt` distinto → recibo `duplicate:true` | ✅ SQL y Pedro |
| 8 | **Mutación en conflicto** | OCC por `order_revision` → `STALE_WRITE_CONFLICT`, terminal, **nunca auto-retry ni sobrescritura**, se muestra a un humano | ✅ `pos-offline-db.ts` |
| 9 | **Commit en servidor + timeout en cliente** | El reintento devuelve el recibo original. El cliente jamás declara fallo de negocio | ✅ `r1_save_order_idempotent` |
| 10 | **Éxito en UI + fallo en nube** | Es el caso **normal** y correcto: el éxito del operador es el recibo local. El ledger distingue `local_committed` de `cloud_materialized` | ⚠️ diseñado, no expuesto |
| 11 | **Operación multi-paso parcial** | `parent_operation_id` + recibo por paso. El materializador ya hace proyección + recibo **en una transacción** | ⚠️ `PENDIENTE` |
| 12 | **Evolución de esquema** | `envelopeVersion` + `typeVersion`; nunca se renombra un tipo, se crea `.v2`; el consumidor que no entiende **hace ruido, no silencio** | ✅ contrato escrito |
| 13 | **Agente con bug o malicioso** | Allowlist + reversibilidad + aprobación + presupuesto por hora + **toda acción auditada con `actor_type='agent'`** | ⚠️ parcial (`copilot.ts`) |
| 14 | **Contexto de agente viejo** | El read model devuelve `as_of`; acción con contexto caduco → rechazo | ❌ |
| 15 | **Efecto físico incierto** | 5 estados + `resolveUncertain` + `recovered_before_sequence` para que una decisión vieja no reautorice un efecto | ✅ `DURABLE-COMMANDS` |
| 16 | **El ledger mismo cae** | **Fire-and-forget con cola durable. El ledger NUNCA bloquea una venta.** Ya es el contrato de `events.ts` | ✅ |
| 17 | **Silencio indistinguible de salud** | Alertar por **ausencia**: cero heartbeats = alerta, no calma. La lección ya está en `heartbeat.js:46` y en `protocol.js` §RECHAZO | ⚠️ conocida, no implementada |

**El #17 merece su propio párrafo.** Es el fallo que más ha costado en este proyecto: telemetría de flota muerta meses sin que nadie lo notara, agentes que no corrían durante nueve días, un cliente conectado y mudo que quemó dos corridas de E2E. **Todo componente del ledger debe tener un guardián que alerte cuando deja de escribir**, no sólo cuando escribe algo malo.

---

## 17. IMPLEMENTATION ROADMAP

> **Restricción absoluta: nada de esto entra antes que P0A / la certificación de release.** El track Fork tiene prioridad. Todo lo de abajo es **aditivo**: columnas nullable, tablas nuevas, cabeceras opcionales. Cero cambios al camino crítico de venta. Cero cambios a offline.

### NOW — lo que se puede hacer sin tocar el camino crítico

| Paso | Qué | Costo | Desbloquea |
|---|---|---|---|
| **N1** | **Encender el heartbeat.** `local_server_heartbeats` está en 0 con el código escrito. Es configuración (`supabaseUrl` + `supabaseKey` en `config.json`). | ~0 código | Control Plane, G7 |
| **N2** | **Columnas nullable de identidad.** `terminal_id` en `pos_orders`, `pos_audit_log`, `pos_save_operations`, `pos_cash_movements`. `location_id` + `operation_id` en `pos_audit_log`. Todas nullable, ninguna escritura existente se rompe. | 1 migración | G1, G4 parcial |
| **N3** | **Tres cabeceras de correlación** en `supabase-fetch-patch.ts`: `x-fullsite-operation`, `x-fullsite-attempt`, `x-fullsite-terminal`. Un solo archivo, cubre todo el tráfico. | 1 archivo | G2 |
| **N4** | **Trigger de inmutabilidad en `pos_audit_log`.** El mismo `reject_mutation()` que ya protege `events`. | 1 línea | G4 |
| **N5** | **Particionar `events` por mes** mientras tiene 231 filas. | 1 migración | Escala |
| **N6** | **Marcar `EVENT-STORE.md` como ⚠️ superado** en `DECISION-BRAIN.md`: describe una tabla `pos_events` que no existe. | 2 líneas | G13 |

**N1–N6 no tocan una sola línea del camino de venta.**

### NEXT — después de que el release esté certificado

| Paso | Qué | Desbloquea |
|---|---|---|
| **X1** | **Envelope v3**: `scope.terminalId`, `operationId`, `attempt`, `outcome`, `errorClass`, `buildSha`. Extensión aditiva de `envelope.ts`. | G3 |
| **X2** | **Columnas de scope en `events`** + RLS + `security_invoker`. `toEventsRow()` ya las proyecta. | G3 |
| **X3** | **Instrumentar dos dominios, no diez.** `orders` y `cash` — los del principio #1 y #3 de la constitución. Con `publishEvent()`, que ya existe. | G6 |
| **X4** | **Tabla de traducción de vocabulario** como módulo puro con pruebas. Un tipo nuevo en `protocol.js` sin entrada **falla una prueba**. | G5 |
| **X5** | **Timeline de soporte** — `UNION ALL` de seis fuentes por `operation_id`. | G6 |
| **X6** | **Tabla de intentos de transporte**, retención 90 días, particionada. | G2 |
| **X7** | **Guardián de ausencia** por componente del ledger: cero escrituras en N horas = alerta. | #17 |

### LATER — con evidencia de campo, no antes

| Paso | Qué | Condición de entrada |
|---|---|---|
| **L1** | Activar el materializador de caja (`PENDIENTE_20260905010000`) | Cutover de AMALAY + certificación física; es un gate de campo, no de código |
| **L2** | Salud por tenant / sucursal / terminal | X1–X3 escribiendo |
| **L3** | Read model del ledger para agentes (extensión de `analyst/contract.ts`) | X3 con datos reales |
| **L4** | Acciones de agente con reversibilidad y presupuesto | L3 |
| **L5** | Caliente/frío, exportación a objeto | Primera partición con 24 meses |
| **L6** | Instrumentar los 6 dominios restantes | X3 demostrado en 2 |

**No se propone reescribir nada.** Ni el POS, ni Pedro, ni el modelo de datos, ni `protocol.js`.

---

## 18. WHAT NOT TO BUILD YET

Esta sección es tan importante como el roadmap.

| No construir | Por qué |
|---|---|
| **Base de datos de grafos** | Dos índices sobre `operation_id` resuelven el 100 % del caso de uso de soporte. Un motor nuevo es coste sin pregunta que lo justifique. |
| **Un bus de eventos / broker (Kafka, NATS, Queues)** | Con 36 órdenes reales en 30 días, sería infraestructura para un problema inexistente. Postgres aguanta hasta ~1 000 restaurantes. |
| **Un servicio central "Operational Brain"** | Sería un cuello de botella y un punto único de fallo en un sistema cuyo principio #7 es *"el restaurante siempre debe poder seguir operando"*. El ledger es **un contrato compartido + un esquema**, no un servidor. |
| **OpenTelemetry como fuente de verdad de negocio** | OTel es muestreable, efímero y orientado a diagnóstico. Reusar `traceparent` para correlación: sí. Que un span sea evidencia de un cobro: nunca. |
| **Instrumentar los 8 dominios de golpe** | Dos dominios bien instrumentados demuestran el modelo. Ocho a medias lo entierran. |
| **Portal de proveedores / marketplace** | Es un **consumidor** del ledger, no un requisito de su diseño. Dejarlo influir ahora distorsiona el modelo por un caso de uso sin cliente. |
| **Reescribir `pos_audit_log`** | 1 686 filas de historia. Se congela, se le añade inmutabilidad, y los campos nuevos entran sólo en filas nuevas. |
| **Cambiar `protocol.js`** | Cuesta un instalador nuevo y una visita física a AMALAY. Se traduce en la frontera. |
| **Event sourcing como fuente de verdad de estado** | Fullsite ya eligió lo contrario y bien: `pos_orders` es estado, los eventos son historia. Cambiarlo es reescribir el POS. |
| **Un panel de Control Plane con polling** | Es exactamente cómo se quemó la cuota de Supabase (~12 M requests). Bajo demanda o push. |
| **Análisis predictivo sobre el ledger** | No hay datos todavía. Primero hechos, después patrones. |
| **Retro-llenar `terminal_id` en las 128 769 filas históricas** | El 99 % son demo y laboratorio. Sólo hacia adelante. |

---

## 19. TOP 10 ARCHITECTURAL DECISIONS

### D1 · Extender `events` en vez de crear un ledger nuevo

**Por qué:** ya existe, ya es inmutable por trigger, ya tiene secuencia, ya tiene CHECK de eventos sensibles, y `envelope.ts` ya proyecta hacia ella.
**Alternativas:** tabla nueva `operational_ledger`; servicio externo.
**Trade-off:** se hereda un esquema que no se diseñó para esto (no hay `stream_id`).
**Reversibilidad:** **alta** — `events` tiene 231 filas.

### D2 · `operation_id` es el `correlation_id`

**Por qué:** dos campos con el mismo contenido divergen. Fullsite ya tiene cuatro nombres para lo mismo (`save_operation_id`, `command_id`, `opId`, `clave`); un quinto empeora el problema.
**Alternativas:** `correlation_id` separado, como en `integration_audit_log`.
**Trade-off:** un flujo con varias operaciones reales necesita `parent_operation_id` para agruparse.
**Reversibilidad:** media — añadir el campo después es fácil; separarlos después de escribir, no.

### D3 · `terminal_id` en toda fila de negocio, nullable

**Por qué:** el principio #4 de la constitución exige "desde dónde" y hoy es incontestable para 128 769 órdenes. La identidad ya existe en el navegador (`renderer-identity.js:22`).
**Alternativas:** dejarlo sólo en `events`; usar `pos_sessions` (0 filas).
**Trade-off:** desnormalización.
**Reversibilidad:** **alta al agregarla, nula al omitirla** — los datos que no se capturan no se recuperan. **Ésta es la decisión con asimetría más brutal del documento.**

### D4 · Postgres particionado, no un motor nuevo

**Por qué:** sirve hasta ~1 000 restaurantes; el equipo ya lo opera; ya tiene RLS y los datos.
**Alternativas:** ClickHouse/Timescale; event store dedicado.
**Trade-off:** techo a ~10 000 restaurantes.
**Reversibilidad:** **alta** si se particiona desde el día uno; **baja** si no.

### D5 · Contrato compartido, no servicio central

**Por qué:** un servicio central viola el principio #7. Lo compartido debe ser un esquema y un SDK, no un proceso.
**Alternativas:** microservicio de ledger.
**Trade-off:** la consistencia del esquema depende de disciplina + pruebas, no de un guardián en runtime.
**Reversibilidad:** alta — un servicio se puede poner delante después.

### D6 · Escrituras de ledger fire-and-forget, nunca bloqueantes

**Por qué:** principio #1 (nunca perder una orden) y #7. `events.ts` ya lo implementa así.
**Alternativas:** escritura transaccional con la operación de negocio.
**Trade-off:** el ledger puede quedar detrás del negocio; hace falta conciliación.
**Reversibilidad:** alta.
**Excepción explícita:** el **recibo de negocio** sí es transaccional (`apply_pos_caja_event` escribe proyección + recibo en una transacción). Fire-and-forget aplica al ledger de observación, no al recibo.

### D7 · Dos relojes siempre

**Por qué:** el reloj de una caja de restaurante no es confiable. Ordenar por `occurred_at` produce timelines falsos.
**Alternativas:** un solo timestamp; reloj lógico (Lamport/HLC).
**Trade-off:** dos columnas y la disciplina de nunca ordenar por la del cliente.
**Reversibilidad:** alta — `events` ya tiene ambas (`occurred_at`, `recorded_at`).

### D8 · Sin PII en el ledger — referencias, nunca valores

**Por qué:** un registro inmutable con PII es un problema que por diseño no se puede borrar.
**Alternativas:** PII cifrada a nivel columna; ledger borrable.
**Trade-off:** el timeline de soporte requiere un join extra para mostrar el nombre de un cliente.
**Reversibilidad:** **nula** — una vez escrita la PII en una tabla inmutable, se queda. **Hay que decidirlo antes de la primera fila.**

### D9 · Los agentes usan las puertas humanas

**Por qué:** un agente con su propio camino de escritura vive fuera del sistema que observa. `copilot.ts` ya lo hace bien.
**Alternativas:** API dedicada de agentes.
**Trade-off:** un agente hereda las restricciones humanas, incluidas las de UX que no le aplican.
**Reversibilidad:** alta.

### D10 · Instrumentar dos dominios, no ocho

**Por qué:** `orders` y `cash` son los principios #1 y #3 de la constitución y concentran los incidentes reales. Dos dominios bien hechos prueban el modelo; ocho a medias lo entierran.
**Alternativas:** cobertura total desde el inicio.
**Trade-off:** el timeline queda incompleto durante meses; hay que decirlo en la UI (`NOT_OBSERVED`, no `OK`).
**Reversibilidad:** alta.

---

## 20. OPEN QUESTIONS

Sólo las que **cambian la arquitectura**. Las demás se resuelven en la implementación.

### Q1 — ¿`terminal_id` es la terminal aprovisionada o el navegador?

Hay dos identidades distintas: la de `config.json` (durable, sólo con instalador) y la que `getTerminalId()` inventa en el navegador. **Propuesta:** dos campos, `terminal_id` (nullable, aprovisionado) y `device_id` (siempre, best-effort). Un `terminal_id` nulo con `device_id` presente significa "entró por web", que es un dato real.
**Por qué importa:** define si `terminal_id` puede ser `NOT NULL`. **Pregunta para Daniel.**

### Q2 — ¿La sucursal es parte de la identidad de la operación o sólo un atributo?

Con multi-sucursal, ¿un `operation_id` puede cruzar sucursales? *(Probablemente no, pero un traslado de inventario entre almacenes es el contraejemplo.)*
**Por qué importa:** determina si la PK de recibos es `(client_id, operation_id)` o `(client_id, location_id, operation_id)`. Cambiarlo después es una migración de PK.

### Q3 — ¿Cuándo hace cutover AMALAY?

**FACT:** 36 órdenes en 30 días; sigue en Wansoft.
**Por qué importa:** determina si la instrumentación se hace **antes** del cutover (costo ~0, historia completa desde el día uno) o **después** (historia con un hueco permanente). Es la única pregunta cuya respuesta **cambia el orden del roadmap**. **Pregunta para Daniel.**

### Q4 — ¿La llave `anon` de este proyecto Supabase es pública?

Pendiente heredado de la fuga de `ops_consumo`.
**Por qué importa:** si es pública, el ledger no puede exponerse ni siquiera con RLS de lectura sin revisar cada política. Si no lo es, el modelo de acceso se simplifica. **Pregunta para Daniel.**

### Q5 — ¿El ledger es un producto para el restaurantero, o interno?

Si el dueño ve su propio timeline operativo, hay que diseñar UX, PII y traducción. Si es sólo para soporte e ingeniería, no.
**Por qué importa:** define el modelo de permisos, la política de PII y si hace falta una capa de presentación. **Pregunta para Daniel.**

### Q6 — ¿Cuál es el presupuesto de requests?

**FACT:** la cuota de Supabase se quemó por ~12 M de requests de polling, no por disco.
**Por qué importa:** determina si el Control Plane puede refrescar en vivo o debe ser bajo demanda. La respuesta ya se inclina a "bajo demanda", pero el número cambia el diseño de la UI.

### Q7 — ¿Cuántos worktrees tienen trabajo adelantado sobre estos archivos?

Hay **~100 worktrees** en la máquina; varios con nombres como `codex/fullsite-cierre-arquitectura-20260904`, `closure-durability-20260905`, `p0a/append-idempotency`.
**Por qué importa:** este documento puede estar proponiendo algo que ya existe en una rama. **UNKNOWN — no se inspeccionaron.** Antes de implementar cualquier paso NOW, hay que revisarlos (§18 del protocolo: no pisar trabajo ajeno).

---

## Apéndice — dónde viven estos documentos

Los cuatro archivos de este track se crearon en el working tree local, que está **663 commits detrás de `origin/main`**. Son archivos **nuevos** (`docs/research/operational-brain/` no existe en `origin/main`), así que no pisan nada y no hay conflicto posible.

**Para llevarlos a `main`:** crear un worktree limpio desde `origin/main`, copiar los cuatro archivos, y abrir un PR de sólo documentación. No se hizo aquí porque este track es de investigación y no tiene autorización para commitear.

```
docs/research/operational-brain/
├── FULLSITE-OPERATIONAL-BRAIN.md   (este documento)
├── CURRENT-PRIMITIVES.md            (inventario con evidencia)
├── IDENTITY-MODEL.md                (identidad y reintentos)
└── EVENT-TAXONOMY.md                (vocabulario y versionado)
```
