# EVENT TAXONOMY — las tres lenguas que hoy habla Fullsite

> **Track:** Operational Brain — investigación, no implementación.
> **Fecha:** 2026-09-18 · **Revisión:** `origin/main` = `10017cf9`.

---

## 1. El hallazgo: hay tres vocabularios y ninguno traduce al otro

**FACT.** Los mismos hechos de negocio se nombran de tres maneras incompatibles, en tres capas que sí se hablan entre sí:

| Capa | Vocabulario | Dónde se define | Forma |
|---|---|---|---|
| **LAN / Pedro** | `ORDER_SAVE`, `ORDER_SENT`, `CASH_MOVEMENT`, `TURNO_CLOSED`, `FINANCIAL_PAYMENT_RESULT`, `PRINT_UNCERTAIN_RESOLVE` | `electron-app/local-server/protocol.js` | `SCREAMING_SNAKE`, 30 constantes, sin versión |
| **Event store de nube** | `orders.item.added.v1`, `payments.payment.captured.v1`, `orders.item.cancelled.v1`, `inventory.waste.recorded.v1` | `dashboard-app/src/lib/events/envelope.ts` + filas reales de `events` | `dominio.entidad.acción.vN`, con `typeVersion` aparte |
| **Auditoría del POS** | `item_added`, `order_sent_kitchen`, `payment_processed`, `status_changed`, `cash_deposito`, `skimming_suspect` | Escritores dispersos en rutas `/api/pos/*` | `snake_case`, sin catálogo, sin versión |

**Ejemplo concreto.** Un mesero agrega un platillo. El mismo hecho puede aparecer como:

```
ORDER_SAVE                 (Pedro, NDJSON local)
orders.item.added.v1       (events, 207 filas en prod)
item_added                 (pos_audit_log, 849 filas en prod)
```

Y un `UPDATE` de `pos_orders` con `order_revision` incrementada, que es el efecto real.

**INFERENCE.** Ningún join reconstruye esa historia hoy. No por falta de datos, sino porque las tres tablas **no comparten ni identidad ni vocabulario**. Un caso de soporte requiere que un ingeniero lea las tres y traduzca a mano.

---

## 2. Un cuarto vocabulario está a punto de nacer

`docs/architecture/CAJA-CLOUD-MATERIALIZATION-2026-09-05.md` introduce un catálogo nuevo, ya escrito en SQL pendiente: `CASH_MOVEMENT`, `KITCHEN_SET`, `ORDER_PRECHECK_PRINT`, `PAYMENT_RECEIPT_PRINT`, `DRAWER_OPEN`, `PRINT_UNCERTAIN_RESOLVE`, `PAYMENT_DRAWER_OPEN`, `DRAWER_UNCERTAIN_RESOLVE`.

Reusa el vocabulario de Pedro (bien), pero va a persistirlo en la nube junto a `events`, que usa el otro. **Ése es el momento de decidir, no después.**

---

## 3. Qué vocabulario gana, y por qué

**RECOMMENDATION: gana `dominio.entidad.acción.vN`** — el de `events` / `envelope.ts`.

Razones, en orden de peso:

1. **Ya está en producción y en una tabla inmutable.** Cambiarlo obliga a migrar datos de un log append-only, que es exactamente lo que no se debe hacer.
2. **Trae versión en el nombre**, además de `typeVersion` en el envelope. Los otros dos no tienen forma de evolucionar sin romper consumidores.
3. **El dominio es prefijo**, así que `type LIKE 'inventory.%'` es un índice, no un `CASE`.
4. **Ya tiene un CHECK de negocio colgado**: `sensitive_requires_audit` enumera 5 tipos que exigen `audit.approvedBy`. Eso sólo funciona con nombres estables.

**Lo que NO se hace:** renombrar `protocol.js`. El vocabulario LAN es un **protocolo de transporte** entre procesos que se actualizan por instalador, no por Vercel. Tocarlo obliga a reinstalar las cuatro terminales de AMALAY (regla dura de `docs/offline/OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md`). Se deja como está y se **traduce en la frontera**.

---

## 4. La tabla de traducción (el artefacto que falta)

Un solo módulo puro, sin red ni base, del estilo de `envelope.ts`:

```
protocol.EVENT.*     ──▶  dominio.entidad.acción.vN
pos_audit_log.action ──▶  dominio.entidad.acción.vN
```

Borrador, para discutir — no es normativo:

| LAN (`protocol.js`) | `pos_audit_log.action` | Canónico propuesto |
|---|---|---|
| `ORDER_SAVE` / `ORDER_UPSERTED` | `item_added`, `item_modified`, `quantity_changed` | `orders.order.saved.v1` (+ `orders.item.added.v1`) |
| `ORDER_SEND` / `ORDER_SENT` | `order_sent_kitchen` | `orders.order.sent_to_kitchen.v1` |
| `ORDER_VOID` / `ORDER_CANCELLED` | `order_cancelled` | `orders.order.cancelled.v1` |
| — | `item_cancelled` | `orders.item.cancelled.v1` ⚠️ sensible |
| — | `item_voided` | `orders.item.voided.v1` |
| `ORDER_ITEMS_TRANSFERRED` | `item_transferred` | `orders.items.transferred.v1` |
| `ORDER_MOVE` | `mesero_reassigned` | `orders.order.reassigned.v1` |
| `ORDER_CLOSED` | `status_changed`, `payment_processed` | `payments.payment.captured.v1` + `orders.order.closed.v1` |
| `CASH_MOVEMENT` | `cash_deposito`, retiro | `cash.movement.recorded.v1` ⚠️ sensible si es retiro |
| `TURNO_OPENED` / `TURN_OPEN` | — | `shifts.shift.opened.v1` |
| `TURNO_CLOSED` / `TURN_CLOSE` | — | `shifts.shift.closed.v1` |
| `KDS_ITEM_STATUS` | `kitchen_item_updated` | `kitchen.item.status_changed.v1` |
| `KITCHEN_SET` | — | `kitchen.order.set.v1` |
| `PRINT_COMMAND` | — | `print.job.accepted.v1` |
| `ORDER_PRECHECK_PRINT` | `preticket_printed` | `print.precheck.issued.v1` |
| `PAYMENT_RECEIPT_PRINT` | — | `print.receipt.issued.v1` |
| `PRINT_UNCERTAIN_RESOLVE` | — | `print.job.resolved.v1` |
| `DRAWER_OPEN` / `PAYMENT_DRAWER_OPEN` | — | `cash.drawer.opened.v1` |
| `DRAWER_UNCERTAIN_RESOLVE` | — | `cash.drawer.resolved.v1` |
| `MESA_LOCK` / `MESA_UNLOCK` | — | `tables.table.locked.v1` / `.unlocked.v1` |
| `FINANCIAL_OPEN` / `FINANCIAL_SPLIT` | — | `payments.account.opened.v1` / `.split.v1` |
| `FINANCIAL_PAYMENT_START` | — | `payments.attempt.started.v1` |
| `FINANCIAL_PAYMENT_RESULT` | — | `payments.attempt.resolved.v1` |
| `STATE_SYNC` | — | **no se traduce** — es observación interna, nunca evento de negocio |
| — | `skimming_suspect` | `fraud.skimming.suspected.v1` *(no es un evento de negocio: es una detección → ver §6)* |
| — | `cerrar_app`, `comandas_print_on/off` | `terminal.app.closed.v1`, `settings.printing.toggled.v1` |
| — | `inventory.waste.recorded.v1` ⚠️ sensible | ya definido en `envelope.ts` |
| — | `inventory.adjusted.v1` ⚠️ sensible | ya definido en `envelope.ts` |
| — | `orders.discount.applied.v1` ⚠️ sensible | ya definido en `envelope.ts` |
| — | `payments.cash.withdrawn.v1` ⚠️ sensible | ya definido en `envelope.ts` |

`STATE_SYNC` merece nota aparte: ya tiene un `CHECK (type <> 'STATE_SYNC')` en `pos_local_events`. **Esa decisión es correcta y hay que generalizarla**: una observación interna del poll no es un hecho de negocio y no debe contaminar el ledger.

---

## 5. Los ocho dominios

Derivados de lo que ya existe, no inventados:

| Dominio | Cubre | Escritor autoritativo hoy |
|---|---|---|
| `orders` | órdenes, ítems, mesas, traslados, merges | `r1_save_order` / Pedro |
| `payments` | cuentas, intentos, capturas, propinas, splits | `r1_save_order` / `financial-domain.js` |
| `cash` | turnos… no: retiros, depósitos, cajón, arqueo | `financial-domain.js` |
| `shifts` | apertura, cierre, corte Z | `pos_turnos` / `turn-report.js` |
| `kitchen` | KDS, estaciones, rondas, tiempos | `operational-domain.js` |
| `inventory` | movimientos, mermas, recetas, conteos | `inventory.ts` (`recordMovement`) |
| `print` | trabajos, copias, inciertos, resoluciones | `adapters/print-queue.js` |
| `platform` | tenants, flags, provisioning, soporte, terminales | `platform-writes.ts` |

Y tres **no-dominios**, que a propósito no son eventos de negocio:

- `telemetry` — heartbeats, latencia, disco. Serie de tiempo, retención corta, no ledger.
- `detection` — hallazgos de agentes (`agent_events`). Son **interpretaciones**, no hechos. Tienen `confidence`; los eventos no.
- `trace` — spans HTTP / Sentry. Diagnóstico de ingeniería, no verdad de negocio.

---

## 6. La regla que mantiene limpio el ledger

> **Un evento no lleva `confidence`. Una detección sí. Si un registro necesita `confidence`, no es un evento — es una interpretación, y va a otra tabla.**

Fullsite ya lo hace bien por accidente: `agent_events.confidence numeric(3,2) CHECK (0..1)` vive separado de `events`, que no tiene el campo. **Hay que volverlo explícito antes de que alguien "unifique" las dos tablas por elegancia.**

Corolario para IA: una recomendación de agente **no** entra al ledger. Lo que entra es la **acción** que se ejecutó a partir de ella, con `actor_type='agent'`, `agent_id`, `agent_run_id` y una referencia a la detección que la originó.

---

## 7. Versionado

Reglas, tomadas de lo que `envelope.ts` ya declara:

1. **Nunca se renombra un tipo.** Se crea `.v2` y se mantiene `.v1` legible para siempre.
2. **Agregar un campo opcional al payload no sube la versión.** Quitar, renombrar o cambiar el significado de uno, sí.
3. **`envelopeVersion` y `typeVersion` son independientes.** El sobre evoluciona para todos; el tipo, para uno solo.
4. **Un consumidor que no entiende una versión la salta con ruido, no en silencio.** La lección de `protocol.js` §RECHAZO: un cliente conectado y mudo costó dos corridas completas de E2E el 2026-09-03 porque el rechazo devolvía `null` sin decir nada.
5. **La tabla de traducción es código con pruebas**, no un documento. Un tipo nuevo en `protocol.js` sin entrada en la tabla debe **fallar una prueba**, no pasar callado.

---

## 8. Lo que este documento NO propone

- **No propone migrar `pos_audit_log`.** Sus 1 686 filas históricas se quedan como están; se añade `event_type` canónico a las **nuevas**.
- **No propone tocar `protocol.js`.** Cambiarlo cuesta un instalador y una visita a AMALAY.
- **No propone una tabla de eventos nueva.** `events` existe, es inmutable por trigger, y tiene el vocabulario correcto. Lo que necesita son columnas de scope y llamadores.
- **No propone un bus de eventos ni un broker.** Con ~1 orden real al día y un restaurante en producción, sería infraestructura para un problema que no existe.
