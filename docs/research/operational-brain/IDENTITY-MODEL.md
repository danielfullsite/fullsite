# IDENTITY MODEL — qué recibe identidad nueva y qué la conserva

> **Track:** Operational Brain — investigación, no implementación.
> **Fecha:** 2026-09-18 · **Revisión:** `origin/main` = `10017cf9`.
> Complementa [`CURRENT-PRIMITIVES.md`](CURRENT-PRIMITIVES.md) y [`FULLSITE-OPERATIONAL-BRAIN.md`](FULLSITE-OPERATIONAL-BRAIN.md).

---

## 0. La frase que resuelve el 80 % de las preguntas de soporte

> **El `id` de una fila de Postgres es identidad física. La intención humana necesita su propia identidad, y ésa la genera el dispositivo, antes de que haya red.**

Cuando esas dos se confunden, aparecen los tres bugs de siempre:

1. **Doble efecto**: el reintento nace con otra identidad → dos filas. *(Ocurrió: `pos_inventory_movements` de AMALAY, 2026-07-20, misma factura de 6 insumos entrando dos veces con 1 min 12 s de diferencia — 57 unidades fantasma. `dashboard-app/src/lib/clave-de-operacion.ts`.)*
2. **Pérdida silenciosa**: la clave es demasiado estable y una captura legítima se descarta como duplicado. *(El mismo archivo documenta este riesgo como el opuesto exacto.)*
3. **Imposible de reconstruir**: la fila existe pero nadie sabe de qué gesto humano vino, ni desde qué terminal.

---

## 1. Las siete identidades de Fullsite

Se numeran de la más humana a la más física. **Una capa nunca debe inferirse de otra.**

| # | Identidad | Quién la genera | Cuándo cambia | Existe hoy |
|---|---|---|---|---|
| **I1** | **Intención de negocio** — "el gerente retiró $2 000 de caja" | El humano, al tocar el botón | Nunca. Es el hecho. | Sólo implícita |
| **I2** | **`operation_id`** (hoy `save_operation_id`, `command_id`, `opId`, `clave`) | El **dispositivo**, antes del primer intento | Sólo cuando la operación se **confirma** y empieza otra | ✅ `clave-de-operacion.ts`, `event-store.js`, `recoverable-operation.ts`, `pedro-comandos.ts` |
| **I3** | **`attempt_id`** — un intento de transporte | El dispositivo, en cada envío | En cada reintento | ❌ **no existe** |
| **I4** | **`request_id`** — una petición HTTP | El servidor / el borde | En cada request | ❌ no se persiste |
| **I5** | **`event_id` + `sequence`** — el hecho registrado | El event store (local o nube) | Nunca. Append-only. | ✅ `events.id/sequence`, NDJSON de Pedro, `pos_local_events` |
| **I6** | **`transaction_id` / `revision`** — el commit | Postgres | En cada commit | ✅ `order_revision`, `txid_current()` en el materializador |
| **I7** | **`row id`** — la fila | Postgres / la app | Nunca (salvo migración) | ✅ `pos_orders.id`, etc. |

Y tres identidades de **contexto**, que no describen la operación sino dónde ocurrió:

| Identidad | Generador | Estado hoy |
|---|---|---|
| `client_id` (tenant) | Provisioning | ✅ presente en casi todo |
| `location_id` (sucursal) | Provisioning | ⚠️ 95.9 % de `pos_orders`; **no** en `pos_audit_log`, **no** en `events` |
| `terminal_id` (dispositivo) | `TerminalConfig` en la instalación | ⚠️ **existe en el navegador, no llega a ninguna fila de negocio de la nube** |

---

## 2. La regla de propagación

```
I1 intención          ──▶ 1 : 1 con I2
I2 operation_id       ──▶ 1 : N con I3 (reintentos)
I3 attempt_id         ──▶ 1 : 1 con I4 (si hubo request)
I4 request_id         ──▶ 0..1 con I6 (puede no llegar a commit)
I2 operation_id       ──▶ 1 : 1 con I5 (exactamente un evento de negocio)
I5 event_id           ──▶ 1 : 1 con I6 (un commit)
I6 transaction        ──▶ 1 : N con I7 (varias filas)
```

De donde salen las **cinco invariantes de identidad**:

| # | Invariante | Cómo se comprueba |
|---|---|---|
| **INV-1** | Un `operation_id` produce **como máximo un** efecto de negocio. | `count(distinct event_id) ≤ 1` por `operation_id` |
| **INV-2** | Un `operation_id` con dos contenidos distintos es un **error**, nunca un éxito. | Ya implementado dos veces: `PAYLOAD_IDENTITY_CORRUPTION` (SQL) e `IDEMPOTENCY_KEY_REUSED` (Pedro) |
| **INV-3** | Un reintento **no** genera `operation_id` nuevo. | Diario de reintento en `localStorage` antes de enviar (`pedro-comandos.ts:17`) |
| **INV-4** | Un evento de negocio **siempre** trae `client_id`, `location_id`, `terminal_id`, `shift_id`. | `buildEnvelope()` ya falla cerrado si falta tenant/sucursal/turno/actor (`events/envelope.ts`) |
| **INV-5** | Un ACK perdido **no** es un fallo de negocio. | `clasificar-fallo.ts` + `SYNC_UNCONFIRMED` del materializador |

**INV-4 es el único que hoy no se puede cumplir en la nube**, porque `events` no tiene esas columnas y `pos_orders` no tiene `terminal_id`. El contrato ya está escrito (`envelope.ts`); falta la migración. El propio archivo lo dice.

---

## 3. El ejemplo canónico: "Retiro de caja"

El gerente toca **Retiro de caja · $2 000**. Red intermitente.

| t | Qué pasa | Identidad nueva | Identidad conservada |
|---|---|---|---|
| 0.00 s | Gerente confirma en pantalla | **I1** intención | — |
| 0.00 s | UI genera la clave | **I2** `op=7f3a…` | — |
| 0.01 s | Se persiste el comando inmutable en `localStorage` | — | I2 |
| 0.02 s | Pedro recibe `COMMAND{command_id=7f3a…}` | **I3** `att=1` | I2 |
| 0.03 s | `processCommand` → transacción NDJSON + `fsync` | **I5** `seq=4021`, `event_id=7f3a…` | I2 |
| 0.03 s | ACK al navegador; la UI dice "hecho" | — | I2, I5 |
| 0.04 s | Efecto durable: pulso de cajón encolado | `job_id` | I5 |
| 5.0 s | `BusinessOutbox` intenta materializar | **I3** `att=2` | I2, I5 |
| 5.0 s | → HTTP a `/api/pos/caja/materialize` | **I4** `req=…` | I2, I5 |
| 13.0 s | **Timeout.** No se sabe si commiteó. | — | — |
| 18.0 s | Reintento | **I3** `att=3`, **I4** `req'` | **I2, I5 iguales** |
| 18.2 s | `apply_pos_caja_event` reconoce `event_id` + `history_hash` | **I6** `txid` (o el original) | I2, I5 |
| 18.2 s | Recibo `{materialized:true, duplicate:true}` | — | todas |
| 18.2 s | Avanza el checkpoint local | — | — |

**Resultado: 1 intención · 1 `operation_id` · 3 intentos · 2 requests · 1 evento · 1 efecto de negocio · 1 movimiento de caja.**

Lo que hoy Fullsite **puede** responder de esta historia: el evento local (Pedro), el recibo de negocio (si el materializador estuviera activo), el estado final de la fila.
Lo que **no puede**: los intentos 1–3 y el timeout. **I3 e I4 no existen en ningún registro.** Ése es el hueco que hace que soporte tenga que adivinar.

---

## 4. Las tres ambigüedades y cómo las resuelve este modelo

### 4.1 El servidor commiteó, el cliente vio timeout

`TRANSPORT_FAILURE ≠ BUSINESS_FAILURE` (`clasificar-fallo.ts`). El cliente **nunca** declara el fallo de negocio: reintenta con el mismo `operation_id`. El servidor devuelve el recibo original con `duplicate:true`. El estado observable es `UNCONFIRMED`, nunca `FAILED`.

> El materializador ya devuelve exactamente `SYNC_UNCONFIRMED` (HTTP 503) en el catch del timeout. El vocabulario ya existe; falta que **todas** las superficies lo usen.

### 4.2 El cliente vio éxito, la nube falló

Es el caso normal de Fullsite y **no es un bug**: el éxito que ve el operador es el recibo **local durable** de Pedro, y eso es lo correcto — el restaurante no puede depender de la WAN. Lo que falta es que el ledger distinga:

- `local_committed` (hay recibo NDJSON) — lo que el mesero vio
- `cloud_materialized` (hay `pos_caja_business_receipts`) — lo que la nube sabe
- `pending_for = now - local_committed_at` — la deuda

`BusinessOutbox.status()` ya devuelve `{last_sequence, pending_events, error}`. Falta exponerlo por tenant/terminal en la nube.

### 4.3 Un efecto físico incierto

Ya resuelto y documentado en `docs/architecture/DURABLE-COMMANDS-2026-09-05.md`: estados `pending`/`retrying`/`printing`/`printed`/`recoverable`/**`uncertain`**, con `resolveUncertain(id, 'printed'|'reprint')` y `recovered_before_sequence` para que una decisión vieja no reautorice un pulso nuevo.

**Ese vocabulario de cinco estados es reusable tal cual para cualquier efecto externo** (terminal bancaria, envío a Rappi/Uber, timbrado CFDI, WhatsApp). No hay que inventar otro.

---

## 5. `terminal_id`: el campo que falta en todas partes

**FACT:** la identidad de terminal ya existe y ya está en el navegador.
`electron-app/local-server/core/renderer-identity.js:22` inyecta `FULLSITE_TERMINAL_ID` y `FULLSITE_LOCATION_ID` desde `config.json`.

**FACT:** no llega a ninguna fila de negocio de la nube.
`pos_orders` no tiene columna de terminal ni de dispositivo (consultado en `information_schema`, 2026-09-18). `pos_audit_log` tampoco. `pos_sessions` sí la tiene y está **vacía**. `pos_terminals` **no existe** porque sus migraciones nunca se aplicaron a AMALAY.

**INFERENCE:** hoy es **imposible** responder *"¿desde qué terminal salió esta orden?"* para las 128 769 órdenes de producción. El principio #4 de `docs/constitution/PRINCIPLES.md` dice literalmente *"Quien lo hizo. Cuando. **Desde donde.** Que cambio…"*. El "desde dónde" no se cumple.

**RECOMMENDATION:** ésta es la primera columna que se agrega, y es aditiva:

```
pos_orders           + terminal_id text null
pos_audit_log        + terminal_id text null, + location_id text null, + operation_id text null
pos_save_operations  + terminal_id text null
pos_cash_movements   + terminal_id text null
events               + client_id, location_id, shift_id, terminal_id  (ya proyectados por toEventsRow())
```

Todas nullable. Ninguna rompe una escritura existente. Ninguna toca el camino crítico offline. El valor se toma del `localStorage` que Electron ya rellena, y del `TerminalConfig` que el provisioning ya emite.

**Riesgo de no hacerlo ahora:** cada día que pasa acumula filas sin terminal que nunca se podrán reconstruir. Con AMALAY todavía en Wansoft (36 órdenes en 30 días), el costo de retro-llenar es ~cero. Después del cutover, no.

---

## 6. `terminal_id` durable vs. inventado

| Superficie | De dónde sale | Durable |
|---|---|---|
| Electron (caja, POS secundario, KDS) | `config.json` → `renderer-identity.js` → `localStorage.pos_terminal_id` | ✅ sobrevive reinstalación de la UI; vive con la instalación |
| Navegador web puro | `getTerminalId()` **inventa** `term_<base36>_<rand>` (`pos-sessions.ts:23`) | ❌ se pierde al limpiar el navegador; se regenera al cambiar de tenant (`AuthContext.tsx:141`) |

**RECOMMENDATION:** no unificar por la fuerza. Distinguir dos campos:

- `terminal_id` — **aprovisionado**. Sólo existe si hubo instalación. Puede ser `null`.
- `device_id` — **del navegador**, best-effort, siempre presente.

Un `terminal_id` nulo con `device_id` presente significa *"entró por web, no por una terminal instalada"* — que es un dato operativo real y útil, no un hueco.

---

## 7. `actor`: persona, terminal y agente son tres cosas

Hoy conviven varias formas: `pos_audit_log.actor` (texto libre, el nombre del mesero), `events.actor{userId,deviceId}`, `platform_audit_log.actor_email + actor_user_id`, `agent_audit_log.agent_name`.

**RECOMMENDATION — un solo par, tres valores de tipo:**

```
actor_type : 'human' | 'system' | 'agent'
actor_id   : staff_id | service_name | agent_id
```

Y para agentes, dos campos más, que ya existen en `agent_runs`:

```
agent_id      : 'inventory' | 'fraud' | 'dashboard:operations' | …
agent_run_id  : la corrida concreta
```

**La regla que no se negocia: una acción de IA entra al ledger con la misma forma que una acción humana.** Cambia `actor_type`, no el esquema. Si un agente cierra un turno, la fila de `pos_turnos` debe poder contestar "quién" igual de bien que si lo cerró un gerente. `copilot.ts` ya lo hace bien por otra vía — reusa los endpoints humanos, así que hereda su auditoría.

---

## 8. Reintento, replay, duplicado y conflicto — cuatro palabras distintas

| Palabra | Definición operativa | Identidad | Ya implementado en |
|---|---|---|---|
| **Reintento** (retry) | Mismo `operation_id`, mismo contenido, porque no llegó respuesta | I2 igual, I3 nuevo | `pedro-comandos.ts`, `OutboxWorker`, cola IndexedDB |
| **Replay** | Reproducción del log tras un reinicio o recuperación | I2 e I5 iguales | `recoverPendingEffects()`, drenado de la cola offline |
| **Duplicado** | Dos identidades distintas para la misma intención — **siempre un bug** | I2 distintos | El caso de 2026-07-20; corregido por `clave-de-operacion.ts` |
| **Conflicto** | Mismo objetivo, dos intenciones distintas concurrentes | I2 distintos, revisión distinta | `STALE_WRITE_CONFLICT`, `order_revision`, `expected_revision` |

**Lo importante:** duplicado y conflicto son categorías **opuestas** y se confunden con facilidad. Un duplicado hay que absorberlo en silencio; un conflicto hay que **mostrárselo a alguien**. El código ya los separa (`SyncErrorClass`); el ledger tiene que heredar esa separación y no aplanarla a "error".

---

## 9. Esquema de correlación mínima (propuesta)

Tres cabeceras HTTP, propagadas desde el choke point que ya existe
(`supabase-fetch-patch.ts:69`, donde ya se inyecta `x-fullsite-tenant`):

```
x-fullsite-operation : el operation_id (I2)   — estable entre reintentos
x-fullsite-attempt   : 1, 2, 3… (I3)          — cuántas veces se ha intentado
x-fullsite-terminal  : terminal_id            — de localStorage, ya poblado por Electron
```

y una cuarta opcional, para el análisis de regresión por build:

```
x-fullsite-build     : sha corto de la UI (espejo de identidadDeBuild())
```

Ninguna es secreta. Ninguna es PII. Ninguna cambia el comportamiento del camino crítico.
Con esas cuatro cabeceras, cualquier ruta `/api/*` puede escribir una línea de ledger sin cambiar su firma.

**Dónde NO ponerlas:** nunca en la query string. Es la regla de privacidad de este repo, y además los logs de Vercel las capturarían.

---

## 10. Campos: requeridos, opcionales, derivados, peligrosos, redundantes

El prompt de este track proponía ~30 campos de envelope. El veredicto, contra lo que Fullsite ya tiene:

### REQUERIDOS (sin uno de éstos el registro no sirve)

`event_id` · `operation_id` · `client_id` · `location_id` · `terminal_id` · `actor_type` · `actor_id` · `domain` · `event_type` · `type_version` · `occurred_at` (reloj local) · `recorded_at` (reloj servidor) · `schema_version`

### OPCIONALES (según el dominio)

`shift_id` (obligatorio en POS/caja, ausente en plataforma) · `entity_type` + `entity_id` · `parent_operation_id` (sólo cuando hay descomposición real) · `attempt` · `audit{approvedBy, reason}` · `agent_id` + `agent_run_id` · `build_sha` · `outcome` · `error_class`

### DERIVADOS (nunca se escriben; se calculan)

`correlation_id` → **es** `operation_id` en el 95 % de los casos; un campo aparte invita a que diverjan
`causation_id` → se deriva de la arista padre→hijo del grafo
`sequence` → lo asigna el store
`pending_for` → `now() − recorded_at`
`network_state` → se infiere de `error_class`; el estado auto-declarado miente

### PELIGROSOS (no incluir, o incluir con reglas duras)

| Campo | Por qué |
|---|---|
| `payload` completo | PII (nombres de clientes, RFC, teléfonos) y datos de pago. **Guardar referencia + hash, no el cuerpo.** El repo ya redacta en `integrations/audit-logger.ts`; el ledger necesita la misma lista. |
| `ui_state` / "lo que la UI creía" | Tentador para soporte, imposible de acotar, y crece sin límite. Registrar la **decisión** de la UI (`mostró OFFLINE_QUEUED`), no su estado. |
| `local_timestamp` sin `recorded_at` | El reloj de una caja en un restaurante **no es confiable**. Nunca ordenar por él. |
| `session_id` | Se cruza con `shift_id` y con la sesión de auth; tres cosas con nombres parecidos. Si hace falta, llamarlo `auth_session_id`. |
| `request_fingerprint` | Hash de un payload que puede traer PII: hay que definir sobre qué se calcula, o es un identificador de cliente encubierto. |

### REDUNDANTES (ya cubiertos, no duplicar)

`save_operation_id` y `command_id` → **son** `operation_id` con otro nombre; unificar por alias, no por columna nueva
`idempotency_key` → lo mismo
`retry` / `replay` como booleanos → se deducen de `attempt > 1` y del origen del evento
`source_component` / `destination_component` → `domain` + `terminal_id` ya lo dicen
`ui_revision` + `Pedro_version` + `build_sha` → **un solo** `build_sha` por componente que emite, no tres campos en cada fila

---

## 11. Qué se rompe si esto se hace mal

| Error de diseño | Consecuencia concreta en Fullsite |
|---|---|
| Derivar `operation_id` del reloj | El doble cobro de inventario del 2026-07-20. Ya pasó. |
| `operation_id` demasiado estable | Una merma legítima se descarta como duplicada. El comentario de `clave-de-operacion.ts` lo advierte explícitamente. |
| Tratar el `id` de la fila como identidad lógica | Un merge de órdenes o un split de cuenta pierde el rastro de la intención. |
| Un solo campo "error" sin clase | Los 4 bugs del 2026-08-31 (`clasificar-fallo.ts`). Un 400 leído como "no hay red" dejó al POS sin mandar comandas una noche entera. |
| `correlation_id` separado de `operation_id` | Divergen en tres meses, y ninguna consulta vuelve a cuadrar. |
| Guardar el payload completo "por si acaso" | PII en un ledger inmutable = un problema de cumplimiento que **no se puede borrar por diseño**. |
