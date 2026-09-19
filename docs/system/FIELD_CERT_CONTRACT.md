# FIELD CERT — contrato de certificación en campo

> **INTERNO.** Diseño. **No implementado, no ejecutado.**
> **Fecha:** 2026-09-18 · Vocabulario heredado de `cert/rig-v1-pr2:.../cert/CONTRATO-v1.md`.
> No se inventa ninguna clase nueva.

---

## 0 · El objetivo, en una frase

> **Daniel ejecuta el flujo físico. No anota nada.** El software correlaciona solo, y le pregunta
> únicamente lo que ningún sensor puede ver.

Hoy una sesión de campo produce evidencia en la cabeza de quien estuvo ahí y, con suerte, en un
documento escrito después. Eso no se puede volver a correr, y por tanto no certifica.

---

## 1 · La sesión

```jsonc
{
  "cert_session_id": "fcert-<tenant>-<YYYYMMDDTHHMMSSZ>-<6hex>",
  "mode": "FIELD_CERT",
  "release_sha": "<40 hex>",        // el que quedó sirviendo, no el del repo local
  "deployment_id": "<vercel>",
  "tenant_class": "CERT | PROD",    // PROD sólo con autorización explícita de Daniel
  "tenant_id": "<slug>",
  "location_id": "<id|null>",
  "terminal_id": "<uuid provisionado|null>",
  "actor_id": "<staff_id>",
  "shift_id": "<turno_id|null>",     // se enlaza cuando abre, no antes
  "started_at": "<ISO8601>",
  "ended_at": "<ISO8601|null>"
}
```

**`cert_session_id` es la raíz y existe ANTES que cualquier orden**, igual que `run_id` en el arnés.
El recorrido arranca en el PIN, y ahí todavía no hay `order_id` ni `client_op_id` que usar de llave.

### 1.1 · Cómo se abre sin que nadie teclee

| Dato | De dónde sale | Sin intervención |
|---|---|---|
| `release_sha`, `deployment_id` | Vercel + `/identity` de Pedro | ✅ |
| `terminal_id` | `config.json` vía `renderer-identity.js` | ✅ **ya está en el navegador** |
| `tenant_id`, `location_id` | misma inyección | ✅ |
| `actor_id` | la sesión del PIN | ✅ |
| `shift_id` | se enlaza al primer `SHIFT_OPENED` | ✅ |
| `started_at`, `ended_at` | reloj del emisor | ✅ |

**Cero campos a mano.** El único acto humano para abrir la sesión es decir «empieza».

---

## 2 · La ventana de correlación

Todo lo que ocurra en ese tenant, esa terminal y esa ventana temporal **se atribuye a la sesión**,
sin necesidad de que el producto conozca la existencia del field cert. Es correlación por
**observación externa**, no por instrumentación — y por eso se puede construir hoy sin tocar producto.

**Lo que eso permite y lo que no:**

- ✅ atribuir órdenes, turnos, movimientos de caja, filas de auditoría y recibos
- ✅ medir latencia entre eventos observables
- ⚠️ **no distingue dos terminales** si ambas operan a la vez sin `terminal_id` en la fila —
  y hoy ninguna fila de negocio lo lleva (§4)
- ❌ no ve nada que sólo exista dentro de la terminal: cola offline, trabajos inciertos, caché

---

## 3 · Los dieciséis eventos de la línea de tiempo

| Evento | Fuente observable hoy | Estado |
|---|---|---|
| `SHIFT_OPENED` | `pos_turnos.opened_at` | ✅ |
| `ORDER_CREATED` | `pos_orders.created_at` | ✅ |
| `ITEM_ADDED` | `pos_audit_log action='item_added'` | ⚠️ 849 filas, sin `terminal_id` |
| `ORDER_SENT` | `pos_audit_log action='order_sent_kitchen'` | ⚠️ idem |
| `KDS_RECEIVED` | — | ❌ **no existe ack del KDS** |
| `PRINT_JOB_CREATED` | `pos_print_jobs.created_at` | ⚠️ 385 filas, ninguna desde 2026-09-04 |
| `PRINT_JOB_ACKNOWLEDGED` | `pos_print_jobs.printed_at` | ⚠️ existe la columna; «impreso» = el spooler aceptó, **no** que salió papel |
| `PAYMENT_RECORDED` | `pos_orders.pagos` + `pos_audit_log` | ✅ |
| `CASH_MOVEMENT_CREATED` | `pos_cash_movements` + `client_op_id` | ✅ **la mejor instrumentada** |
| `SHIFT_CLOSED` | `pos_turnos.closed_at` / `pos_cierres` | ✅ |
| `OFFLINE_ENTERED` | — | ❌ sólo vive en la terminal |
| `COMMAND_QUEUED` | — | ❌ IndexedDB `sync_queue`, no reporta |
| `RECONNECT_DETECTED` | — | ❌ idem |
| `QUEUE_DRAIN_STARTED` | — | ❌ idem |
| `QUEUED_DRAINED` | — | ❌ idem |
| `CLOUD_RECEIPT_CONFIRMED` | `pos_save_operations` | ⚠️ sólo órdenes |

**Seis de dieciséis se observan bien hoy. Seis no se observan en absoluto**, y los seis son
exactamente el ciclo offline — que es el corazón del producto.

---

## 4 · Campos de evento — inventario de evidencia

`CURRENT_SOURCE` · `RELIABLE` · `MISSING` · `IMPLEMENTATION_REQUIRED`

| Campo | CURRENT_SOURCE | RELIABLE | MISSING | IMPLEMENTATION_REQUIRED |
|---|---|---|---|---|
| `timestamp` | `created_at`/`opened_at` de cada tabla | **sí**, reloj de servidor | — | ninguna |
| `cert_session_id` | — | — | **sí** | emisor del field cert (fuera de producto) |
| `release_sha` | Pedro `/identity`, Vercel | sí | — | capturarlo al abrir sesión |
| `tenant_id` | `client_id` en toda tabla | **sí** | — | ninguna |
| `location_id` | `pos_orders.location_id` (95.9 %) | parcial | en turnos, caja, auditoría | columna nullable |
| `terminal_id` | `renderer-identity.js` → `localStorage` | **no llega a ninguna fila** | **sí** | producto + DB |
| `actor_id` | `pos_audit_log.actor` (texto), `opened_by` | parcial — es un nombre, no un id | id estable | producto |
| `shift_id` | `pos_orders.turno_id` (100 %) | **sí** | — | ninguna |
| `order_id` | `pos_orders.id` | **sí** | — | ninguna |
| `client_op_id` | `pos_cash_movements`, `pos_audit_log`, `pos_market_movements` | sí donde existe | **en `pos_orders` no existe** | DB + producto |
| `business_fact_id` | `movement_operation_key` | existe, **2 de 4 179 filas** | uso real | producto |
| `print_job_id` | `pos_print_jobs.id` | sí, pero sin escrituras recientes | — | reactivar el escritor |
| `kds_job_id` | — | — | **sí** | producto (no hay concepto de job de KDS) |
| `queue_depth_before/after` | `local_server_heartbeats.sync_queue_size` | **0 filas** | **sí** | encender heartbeat (config) |
| `online_state` | — | — | **sí** | **no derivar de `navigator.onLine`** — la constitución lo prohíbe; se infiere de `error_class` |
| `local_result` | NDJSON de Pedro | sí, **sólo en LAN** | en nube | outbox de Pedro (0 filas hoy) |
| `cloud_result` | `pos_save_operations.state` | sí, sólo órdenes | otros dominios | recibos por dominio |
| `latency_ms` | derivable entre dos timestamps | sí | — | ninguna |
| `error_code` | `clasificar-fallo.ts`, `SyncErrorClass` | **sí, ya tipado** | no se persiste | persistirlo |
| `receipt_reference` | `pos_save_operations` | sí, un dominio | resto | recibos por dominio |
| `provenance` | `build_sha` de `identidadDeBuild()` | sí en Pedro | no llega a filas | propagar |

---

## 5 · Confirmaciones físicas — lo que ningún sensor ve

> **La regla:** el software pregunta **sólo** lo que no puede observar, y **nunca** pide una hora.
> El reloj lo pone el emisor.

| Confirmación | ¿Por qué humana? | ¿Se puede automatizar? |
|---|---|---|
| `PAPER_PRINTED` | `printed` significa que el spooler aceptó los bytes. **No hay garantía de una hoja física** — lo dice el propio contrato de comandos durables | no con el hardware actual |
| `CASH_DRAWER_OPENED` | el pulso se envía; la posición del cajón no se lee | sólo con telemetría de hardware que no existe |
| `KDS_VISIBLE` | no hay ack de pantalla | **sí, si se implementa el ack** — cerraría el hueco más grande |
| `AMOUNT_PRINTED_CORRECTLY` | el ticket físico contra el total de la fila | no |

### 5.1 · La captura

Cuatro toques, sin campos de texto, sin horas:

```
F4 · IMPRESIÓN DE COMANDA
   [ ] salió papel
   [ ] el monto es correcto

F6 · MOVIMIENTO DE CAJA
   [ ] abrió el cajón

F3 · ENVÍO A COCINA
   [ ] se ve en el KDS
```

Cada toque emite `{check_id, session_id, confirmed: true|false, at: <reloj del emisor>}`.
**Un check sin confirmar no es `false`: es `WAITING_PHYSICAL_CONFIRMATION`**, y eso nunca promueve a
`PASS`. Es la primera regla dura del arnés aplicada al mundo físico.

---

## 6 · El tablero, derivado

```
CERT SESSION: fcert-amalay-20260919T0130Z-a1b2c3
SHA: <release_sha>          TERMINAL: caja-01        ACTOR: <staff_id>

F1 ABRIR TURNO        PASS
F2 CREAR ORDEN        PASS
F3 ENVIAR A COCINA    PASS
F4 IMPRIMIR           WAITING_PHYSICAL_CONFIRMATION
F5 COBRO              PASS
F6 MOVIMIENTO CAJA    PASS
F7 CERRAR TURNO       PASS
F8 FLUJO OFFLINE      RUNNING
F9 RECONEXIÓN         WAITING
```

Ante un fallo, el tablero **no dice qué se rompió: dice dónde se cortó la cadena.**

```
F3 FAIL

  ORDER_CREATED       PASS   order_id=…  +0.4 s
  KDS_JOB_CREATED     PASS   kds_job=…   +0.6 s
  KDS_ACK             MISSING            —
  PRINT_JOB_CREATED   PASS   print=…     +0.7 s
  PRINT_ACK           PASS               +1.9 s

  SUSPECTED_BOUNDARY = entrega al KDS
```

**`MISSING` no es `FAIL`.** Con el ack de KDS inexistente hoy, F3 **siempre** terminaría en
`NOT_OBSERVED`. Decirlo es el punto: el tablero muestra el hueco de instrumentación en vez de
inventar un veredicto.

El tablero **se genera**. Lleva en la cabecera el hash del artefacto del que salió. Editarlo a mano
rompe el hash y lo marca no confiable.

---

## 7 · Pasos 9–12, aditivos

Viven en `deployment-sequence.v2.json`. **`deployment-sequence.json` no se tocó.**

| Paso | Qué | Dueño |
|---|---|---|
| **9 · PREPARE_FIELD_CERT_SESSION** | abrir la sesión capturando identidad sola; verificar L0 de campo (build sellado, Pedro sano, tenant permitido) | BACKLOG |
| **10 · RUN_LIVE_FIELD_CERT** | Daniel ejecuta F1–F9 físicamente. El software observa. | DANIEL + BACKLOG |
| **11 · CORRELATE_FIELD_EVIDENCE** | reconstruir la línea de tiempo por ventana y correlación; marcar `MISSING` lo no observable | BACKLOG |
| **12 · EMIT_FIELD_CERT_ARTIFACT** | emitir `FIELD_CERT_ARTIFACT` con veredicto por la regla del arnés | BACKLOG |

---

## 8 · Lo que este contrato NO promete

- **No prueba que salió papel.** Ningún software de este sistema puede.
- **No distingue dos terminales** mientras `terminal_id` no llegue a las filas.
- **No ve la cola offline.** Seis de los dieciséis eventos son ciegos hasta que Pedro reporte.
- **No certifica con una sesión.** Una corrida demuestra viabilidad, no confiabilidad.
