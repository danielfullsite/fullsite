# OFFLINE / SYNC / RECONCILIATION — Lo que la industria ya resolvió

> ## ⚠️ CORRECCIÓN 2026-09-18 — leer antes que el resto
>
> **Este documento leyó el working tree, que está 663 commits atrás de `origin/main`.** Verificado al
> día siguiente: `git rev-list --left-right --count HEAD...origin/main` → `58 663`.
>
> **El hallazgo #3 (dedup de inventario por `LIKE`) es FALSO en `origin/main`.** Ahí existe
> `pos_record_inventory_movement` con tabla de recibos, índice único por línea, advisory lock y
> replay del resultado guardado (`supabase/migrations/20260910050000_inventory_movement_atomic.sql`).
> El `LIKE` que cité es código viejo de esta rama. Detalle y alcance en
> [P0B-COMMAND-RECEIPTS.md](P0B-COMMAND-RECEIPTS.md).
>
> Los hallazgos #1 (sin `fsync`) y #2 (ACK duplicado sin outcome) **no fueron desmentidos**, pero
> tampoco fueron reverificados contra `main` en aquel pase. Trátalos como pendientes de confirmar ahí.
>
> **La lección, que es la que vale:** un research que lee el working tree describe esta rama, no
> producción. Igual que [[project_uber_routes_sin_auth]]. A partir de aquí se lee con
> `git show origin/main:<ruta>`.

> **Sprint:** Architecture & Industry Intelligence Lab — Track A (único).
> **Fecha:** 2026-09-17 · **Modo:** research read-only. No se tocó código, DB, ni se abrió PR.
> **Objetivo declarado:** alimentar **P0A — Append Idempotency Foundation** y **P0B — Offline Replay Semantics**.
> **Alcance de la búsqueda:** fuentes primarias públicas (docs de vendors, specs de protocolo, papers) +
> lectura directa del código de Fullsite en el working tree de `feat/pos-ui-kit`.
> **Lo que NO se hizo:** no se ejecutó nada contra AMALAY, no se leyeron secretos, no se contactó a ningún vendor.

**Convención de evidencia** (§17 del protocolo): cada afirmación va marcada.

| Marca | Significado |
|---|---|
| **[FACT]** | Está escrito en la fuente citada, o lo leí en el archivo/línea citado. |
| **[INFER]** | Deducción mía a partir de los FACTs. Puede estar mal. |
| **[REC]** | Recomendación. No es un hecho. |

---

## EXECUTIVE SUMMARY

**La conclusión corta: el enfoque de Fullsite (cola durable local + operation ids + dedup en servidor) es el
enfoque correcto y es el mismo que usan Toast, Square, Replicache, RxDB y PowerSync. El problema no es el
diseño — es que la implementación tiene tres agujeros que los sistemas maduros cerraron hace años.**

Los tres agujeros, en orden de riesgo:

1. **Nada se escribe a disco de verdad.** No existe una sola llamada a `fsync`/`fdatasync` en todo
   `electron-app/` ni en `dashboard-app/src` (verificado por grep, 0 coincidencias). El event store usa
   `fs.appendFileSync` ([ndjson.js:84](electron-app/local-server/adapters/storage/ndjson.js:84)), que entrega
   los bytes al kernel y regresa — no a disco. En un restaurante, donde el corte de luz es el modo de falla
   normal, esto significa que Pedro puede confirmar un ACK por eventos que ya no existen después del apagón.
   **Es el hallazgo más grave de este track y es P0A puro.**

2. **El ACK duplicado no devuelve el resultado original.** Cuando Pedro reconoce un `command_id` repetido,
   contesta `{ duplicate: true, event: null }`
   ([event-store.js:29-31](electron-app/local-server/core/event-store.js:29)). El cliente que perdió el ACK
   no puede recuperar qué pasó. Stripe guarda "el status code y el body de la primera petición… las
   peticiones subsecuentes con la misma llave devuelven el mismo resultado, incluidos los errores 500"
   ([Stripe API](https://docs.stripe.com/api/idempotent_requests)). Fullsite ya hace esto bien en el camino
   del dinero (`r1_save_order_idempotent` devuelve `first_execution` vs `idempotent_replay` + la revisión
   comprometida, ver [save-order/route.ts:141-143](dashboard-app/src/app/api/pos/save-order/route.ts:141)) —
   pero no en Pedro. **Es P0B puro: sin esto, el replay no puede decidir.**

3. **El inventario deduplica con un `LIKE` sobre texto libre.** La "idempotency check" de
   `recordMovement()` es un `GET … notes=like.*{key}*&limit=1` seguido de un insert
   ([inventory.ts:144-146](dashboard-app/src/lib/inventory.ts:144)). Es check-then-act: dos réplicas
   simultáneas pasan ambas la revisión y ambas escriben. No hay constraint único que lo impida.

Los tres tienen la misma forma: **la identidad de la operación existe, pero no está anclada a nada que el
sistema de almacenamiento haga cumplir.** La industria resolvió eso con una regla de una línea, que aparece
idéntica en Replicache, en el outbox transaccional y en CouchDB: *el efecto y el registro de que el efecto
ocurrió se comprometen en la misma transacción, o no valen.*

**Lo que NO hay que cambiar:** la arquitectura LAN-first con Pedro como autoridad de estado local está
validada por el competidor más grande del mercado. Toast introdujo exactamente lo mismo — un *local hub
device* elegido automáticamente, uno solo por restaurante, por Ethernet, que distribuye las órdenes entre
terminales cuando no hay internet ([Toast platform docs](https://doc.toasttab.com/doc/platformguide/platformOfflineModeLocalSync.html)) **[FACT]**.
Fullsite llegó a la misma topología de forma independiente. Eso no se toca.

**Lo que NO hay que comprar:** ningún motor de sync (ElectricSQL, PowerSync, RxDB, Replicache, Ditto)
reemplaza a Pedro sin que Fullsite pierda el control del camino del dinero. El dato decisivo: ElectricSQL,
el proyecto más financiado de la categoría, **borró la escritura local de su producto** y hoy dice
explícitamente "Electric no maneja escrituras… las escrituras van por el backend que ya tienes"
([Electric docs](https://electric.ax/docs/guides/writes)) **[FACT]**. El camino de lectura es comprable;
el de escritura es de la casa.

---

## TOP 10 INDUSTRY LESSONS

1. **"Exactly once" no existe en la entrega; existe en el efecto.** La consigna operativa de Helland es
   "los mensajes pueden reintentarse. Idempotencia significa que eso está bien"
   (Helland, *Idempotence Is Not a Medical Condition*, ACM Queue 10(4), 2012,
   [DOI 10.1145/2181796.2187821](https://dl.acm.org/doi/10.1145/2181796.2187821)) **[FACT, vía resumen de
   búsqueda; la página de ACM devolvió 403 a la herramienta, no pude leer el texto completo]**. Todo lo
   demás en este documento es consecuencia de esa frase.

2. **El que pierde el ACK no puede distinguir "no llegó" de "llegó y se perdió la respuesta" — y no
   necesita hacerlo.** RxDB lo dice literal en su spec de protocolo: "la escritura del documento pudo ya
   haber llegado a la instancia remota y haber sido procesada, mientras que sólo falla la respuesta"
   ([RxDB Replication](https://rxdb.info/replication.html)) **[FACT]**. La solución no es adivinar: es
   reintentar con la misma identidad y que el receptor decida.

3. **La identidad de la operación la genera el cliente, no el servidor.** Stripe: "un cliente genera una
   idempotency key… sugerimos UUID v4" ([Stripe](https://docs.stripe.com/api/idempotent_requests)) **[FACT]**.
   Replicache va más lejos: un entero incremental **por cliente**, no un UUID, para poder detectar huecos
   ([Replicache push](https://doc.replicache.dev/reference/server-push)) **[FACT]**.

4. **El resultado se cachea, no sólo el hecho de haber visto la llave.** Stripe guarda el status y el body
   de la primera ejecución y los reproduce, **incluidos los 500** **[FACT]**. Un "ya lo vi" sin el resultado
   deja al cliente sin forma de continuar.

5. **La llave se valida contra los parámetros originales.** Stripe: "la capa de idempotencia compara los
   parámetros entrantes con los de la petición original y da error si no son iguales, para prevenir mal uso
   accidental" **[FACT]**. Reusar una llave con otro payload es un bug del cliente, y el servidor lo debe
   gritar, no absorberlo.

6. **El efecto y el marcador de "ya procesado" van en la MISMA transacción.** Replicache:
   "el `lastMutationID` de un cliente debe actualizarse transaccionalmente junto con los efectos de las
   mutaciones… ambos cambios comprometidos como parte de la misma transacción" **[FACT]**. Es exactamente
   el mismo requisito que el patrón outbox transaccional, cuyo problema declarado es el *dual write*
   ([microservices.io](https://microservices.io/patterns/data/transactional-outbox.html)) **[FACT]**.

7. **Un error permanente debe AVANZAR el marcador, no bloquear la cola.** Replicache: "si una mutación es
   inválida o no puede manejarse, el servidor debe de todos modos marcarla como procesada… de lo contrario
   el cliente reintentará indefinidamente"; los errores temporales sí abortan sin avanzar **[FACT]**. Esto
   es la diferencia entre `TERMINAL_NON_RETRYABLE` y `TRANSIENT_RETRYABLE`, y la industria dice que el
   terminal **se consume**.

8. **La cola de subida es FIFO y bloqueante, y el estado local no avanza mientras haya pendientes.**
   PowerSync usa "una cola FIFO bloqueante" y "mientras hay mutaciones en la cola de subida, el cliente no
   avanza a un nuevo checkpoint" ([PowerSync](https://docs.powersync.com/architecture/consistency)) **[FACT]**.
   Evita que el cliente vea un estado del servidor que todavía no incluye su propio trabajo.

9. **El progreso se guarda en un checkpoint separado, no mutando el log.** CouchDB guarda `recorded_seq` /
   `source_last_seq` en documentos locales para que "en caso de falla de replicación, la replicación pueda
   reanudarse desde el último punto de éxito, no desde el principio"
   ([CouchDB Replication Protocol](https://docs.couchdb.org/en/stable/replication/protocol.html)) **[FACT]**.

10. **El offline de pagos es una decisión de riesgo del negocio, no una función técnica — y todos los
    vendors lo acotan y lo transfieren al comerciante.** Square: 24 h para reconectar, límites de monto
    configurables, hasta 1,000 pagos por dispositivo, y "el vendedor es responsable de cualquier pago
    expirado, declinado o disputado" ([Square](https://squareup.com/help/us/en/article/7777-process-card-payments-with-offline-mode)) **[FACT]**.
    Clover: 7 días por default, límites configurables, y los `offlineOptions` del SDK **anulan** los límites
    del comerciante — con la advertencia explícita de que el desarrollador "asume la responsabilidad de
    advertir al comerciante del riesgo" ([Clover dev](https://docs.clover.com/dev/docs/handling-offline-payments)) **[FACT]**.
    Toast llega a pedir "conservar las copias de comercio de los recibos firmados por los comensales como
    registro de los pagos tomados offline, **por si el pago se pierde**"
    ([Toast](https://doc.toasttab.com/doc/platformguide/platformOfflinePaymentsOverview.html)) **[FACT]**.
    El líder del mercado documenta por escrito que su offline puede perder dinero.

---

## PATTERN MATRIX

| # | PROBLEM | INDUSTRY PATTERN | SOURCE | FULLSITE CURRENT STATE | GAP | RECOMMENDATION |
|---|---|---|---|---|---|---|
| 1 | El ACK se confirma sobre datos que el disco todavía no tiene | `fsync` antes de confirmar; SQLite `WAL` + `synchronous=FULL` = ACID incluso ante corte de luz; `NORMAL` en WAL es "quizá no durable" | [SQLite PRAGMA](https://www.sqlite.org/pragma.html#pragma_synchronous) | `fs.appendFileSync` sin sync ([ndjson.js:84](electron-app/local-server/adapters/storage/ndjson.js:84)); **0 llamadas a fsync en todo el repo** | Un apagón puede borrar eventos ya ACKeados | **P0A-1.** Abrir el log con descriptor persistente y `fs.fsyncSync(fd)` antes de responder; o migrar a SQLite `WAL`+`synchronous=FULL` (ver #3) |
| 2 | Escritura dual: evento y marcador de dedup en dos archivos | Efecto + `lastMutationID` en **una** transacción; outbox transaccional para evitar el dual write | [Replicache](https://doc.replicache.dev/reference/server-push), [microservices.io](https://microservices.io/patterns/data/transactional-outbox.html) | `append()` a `events.ndjson` y luego `saveProcessedCommand()` a otro archivo ([event-store.js:42-44](electron-app/local-server/core/event-store.js:42)) — ya documentado como gap en [PER-02-RESEARCH.md §4 Q2](docs/architecture/PER-02-RESEARCH.md) | Crash entre las dos → el evento existe pero se reprocesa como nuevo | **P0A-2.** Un solo registro: el marcador de dedup se deriva del log, no vive aparte (ver #4) |
| 3 | Reconstruir estado y deduplicar desde archivos planos | Base embebida transaccional (SQLite) como estándar de facto del edge | [SQLite PRAGMA](https://www.sqlite.org/pragma.html#pragma_synchronous) | NDJSON con índice en memoria; SQLite ya contemplado como "Phase 2" ([ndjson.js:3](electron-app/local-server/adapters/storage/ndjson.js:3)) | #1 y #2 son gratis con SQLite y caros a mano | **P0A-3.** Migrar `NdjsonEventStore` → `SqliteEventStore` detrás de la misma interfaz `EventStore`. La interfaz ya existe y ya está aislada; es un swap de adapter, no un rediseño |
| 4 | ¿Cómo sé que ya vi este comando? | Marcador monotónico por cliente (`lastMutationID`), no un set de UUIDs | [Replicache](https://doc.replicache.dev/reference/server-push) | `Map` de UUIDs en memoria + NDJSON que crece sin límite ([ndjson.js:23,116-121](electron-app/local-server/adapters/storage/ndjson.js:116)) | Memoria y archivo crecen sin cota; no se detectan huecos en la secuencia | **[REC]** Añadir `(terminal_id, client_seq)` al comando además del UUID. Permite detectar comandos perdidos, no sólo duplicados |
| 5 | Respuesta a un duplicado | Devolver el **resultado original** cacheado | [Stripe](https://docs.stripe.com/api/idempotent_requests) | `{ duplicate:true, event:null }` ([event-store.js:30](electron-app/local-server/core/event-store.js:30)); el cliente sólo recibe `ACK{duplicate}` ([bridge-client.ts:57](dashboard-app/src/lib/bridge-client.ts:57)) | El que perdió el ACK no puede saber qué pasó | **P0B-1.** Devolver el evento original (`sequence`, `ts`, payload aplicado) en la respuesta duplicada |
| 6 | Misma llave, distinto payload | Comparar parámetros y **fallar** | [Stripe](https://docs.stripe.com/api/idempotent_requests) | No se compara nada | Un bug de cliente se traga en silencio | **[REC]** Guardar hash del payload junto al `command_id`; si no coincide → error explícito, no ACK |
| 7 | Mensaje venenoso bloquea la cola | Error permanente: marcar como procesado y avanzar; error temporal: abortar sin avanzar | [Replicache](https://doc.replicache.dev/reference/server-push) | Web: clasificación correcta en 3 clases ([pos-offline-db.ts:17-21](dashboard-app/src/lib/pos-offline-db.ts:17)) pero se corta por `retries >= 5` ([pos-offline-db.ts:534](dashboard-app/src/lib/pos-offline-db.ts:534)). Pedro: `failedAt` corta el flush y reintenta todo ([outbox.js:98-101](electron-app/local-server/core/outbox.js:98)) | En Pedro, un evento terminalmente inválido **bloquea la cola para siempre** | **P0B-2.** Clasificar la respuesta en Pedro igual que en la web y mover el terminal a una *dead-letter* con alerta, no reintentar |
| 8 | Orden de la cola | FIFO estricto y bloqueante | [PowerSync](https://docs.powersync.com/architecture/consistency) | FIFO estricto, ya implementado y comentado ([outbox.js:89-90](electron-app/local-server/core/outbox.js:89)) | **Ninguno. Esto ya está alineado.** | Mantener |
| 9 | Marcar progreso de sync | Checkpoint separado del log; el log es inmutable | [CouchDB](https://docs.couchdb.org/en/stable/replication/protocol.html) | `markSynced()` **reescribe el archivo completo** mutando el flag `synced` dentro de cada evento ([ndjson.js:128-152](electron-app/local-server/adapters/storage/ndjson.js:128)) | O(n) en cada flush (cada 5 s); el "append-only log" no es append-only | **P0A-4.** Cursor `last_synced_sequence` aparte. **El diseño correcto YA está escrito** en [OFFLINE-IMPL-001-OUTBOX-v2.2.md](docs/architecture/OFFLINE-IMPL-001-OUTBOX-v2.2.md) (checkpoint versionado + escritura atómica por rename) — sólo falta implementarlo |
| 10 | Leer pendientes | Leer desde el cursor | [CouchDB](https://docs.couchdb.org/en/stable/replication/protocol.html) | `flush()` hace `readAfter(0)`: lee y parsea **todo el log** cada 5 s ([outbox.js:77](electron-app/local-server/core/outbox.js:77)) | A ~500 eventos/día son ~180k líneas/año parseadas cada 5 s | **P0A-5.** `readAfter(checkpoint)`. Se resuelve solo con #9 |
| 11 | Dedup de movimientos de inventario | Constraint único en la base; el insert falla o no hace nada | [microservices.io](https://microservices.io/patterns/data/transactional-outbox.html) (consumidor idempotente) | `GET …notes=like.*{key}*` y luego insert ([inventory.ts:144](dashboard-app/src/lib/inventory.ts:144)) | Check-then-act: dos réplicas concurrentes pasan las dos | **P0A-6.** Columna `idempotency_key` con `UNIQUE (client_id, idempotency_key)` + `ON CONFLICT DO NOTHING`. Dejar de deduplicar por texto libre |
| 12 | Dedup de órdenes (dinero) | Llave de idempotencia + resultado cacheado + revisión | [Stripe](https://docs.stripe.com/api/idempotent_requests) | `r1_save_order_idempotent` con `first_execution` / `idempotent_replay` / `revision` ([save-order/route.ts:77-103,141-143](dashboard-app/src/app/api/pos/save-order/route.ts:77)) | **Ninguno de fondo. Éste es el patrón bien hecho** — y es el modelo a copiar hacia adentro | Usarlo como referencia canónica para los otros dominios |
| 13 | Cola de auditoría | Cola durable; nunca descartar en silencio | [microservices.io](https://microservices.io/patterns/data/transactional-outbox.html) | `localStorage`, tope 1,000, **descarta los más viejos con un `console.warn`** ([events.ts:59-67](dashboard-app/src/lib/events.ts:59)) | Pérdida silenciosa de auditoría justo cuando más se necesita (offline largo) | **[REC]** Mover a IndexedDB (donde ya vive `sync_queue`) y alertar por profundidad de cola, no descartar |
| 14 | Autoridad local en LAN | Un *hub* local, uno solo por restaurante, elegido automáticamente, por Ethernet | [Toast](https://doc.toasttab.com/doc/platformguide/platformOfflineModeLocalSync.html) | Pedro en la caja, IP estática escrita a mano en un JSON de config | Toast **auto-elige** el hub; Fullsite lo hardcodea (ya causó el incidente de BOM en un install) | **[REC] post-P0.** Descubrimiento (mDNS) con IP estática como respaldo. No es P0A/P0B |
| 15 | Dos autoridades de escritura | Una autoridad por dominio, fronteras explícitas | [Replicache](https://doc.replicache.dev/reference/server-push) | Supabase = dinero; Pedro = estado LAN. Documentado y sin traslape ([PER-02-RESEARCH.md §4 Q1](docs/architecture/PER-02-RESEARCH.md)) | **Ninguno mientras las fronteras no se muevan** | Mantener. Cualquier cambio de autoridad necesita su propio gate |

---

## BUILD / BUY / KEEP

| Componente | Veredicto | Por qué |
|---|---|---|
| **Pedro (event store + autoridad LAN)** | **KEEP** | Toast construyó lo mismo y lo documenta como su modo offline con sync local **[FACT]**. Es el activo, no la deuda. |
| **Motor de sync de escritura (Electric / PowerSync / Replicache / RxDB)** | **NO BUY** | ElectricSQL retiró las escrituras locales de su producto y hoy te dice que uses tu propio backend **[FACT]**. PowerSync y RxDB delegan la resolución de conflictos y la idempotencia al servidor que tú escribes **[FACT]**. Comprarlos no te ahorra el trabajo que falta: te lo devuelve con otro nombre. |
| **Sus protocolos como especificación** | **BUY (gratis, como lectura)** | El `lastMutationID` de Replicache y el checkpoint de CouchDB son la respuesta exacta a P0A/P0B, publicados y probados. Copiar el patrón, no el código. |
| **SQLite como storage de Pedro** | **BUILD (swap de adapter)** | Ya existe la interfaz `EventStore` y el adapter NDJSON está aislado ([adapters/storage/](electron-app/local-server/adapters/storage/)). SQLite con `WAL`+`synchronous=FULL` resuelve durabilidad, atomicidad y el índice de dedup de una sola vez **[FACT sobre las garantías; [INFER] sobre el esfuerzo]**. |
| **Ditto (CRDT edge mesh)** | **NO BUY hoy, VIGILAR** | Chick-fil-A reconstruyó su POS sobre Ditto y reporta haber terminado dos años antes de lo planeado **[FACT, fuente = comunicado conjunto de las dos empresas, es decir marketing de vendor, no un paper]** ([QSR Magazine](https://www.qsrmagazine.com/operations/fast-food/chick-fil-a-modernizes-its-pos-systems-with-ditto/)). Los CRDT resuelven multi-escritor sin coordinación; Fullsite hoy tiene **un** escritor por mesa con lock. Adoptarlo cambiaría el modelo de datos completo. No antes del cliente #2. |
| **Cola de impresión** | **KEEP** | Ya es durable en IndexedDB (`print_jobs`, v4 del schema, [pos-offline-db.ts:90](dashboard-app/src/lib/pos-offline-db.ts:90)) y la doble impresión es aceptable por contrato explícito ([recoverable-operation.ts:19-21](dashboard-app/src/lib/recoverable-operation.ts:19)). Correcto. |

---

## TOP PUBLIC SOURCES

1. **[Replicache — Push Endpoint Reference](https://doc.replicache.dev/reference/server-push)** — La
   especificación más limpia que existe del problema exacto de P0A/P0B: qué hacer con una mutación ya vista,
   con una fuera de orden, y por qué el marcador va en la misma transacción. Léelo completo antes de tocar
   `event-store.js`.
2. **[Stripe — Idempotent requests](https://docs.stripe.com/api/idempotent_requests)** — El contrato de
   idempotencia de referencia de la industria: cachear el resultado, comparar parámetros, expirar a 24 h.
   Responde la pregunta 1 y la 2 por sí solo.
3. **[Toast — Offline mode with local sync](https://doc.toasttab.com/doc/platformguide/platformOfflineModeLocalSync.html)** —
   La validación de que Pedro es la topología correcta, escrita por el competidor más grande. También revela
   sus límites: sólo KDS ve las órdenes de otro POS estando offline.
4. **[SQLite — PRAGMA synchronous](https://www.sqlite.org/pragma.html#pragma_synchronous)** — La tabla que
   decide si Fullsite pierde o no una comanda en un apagón. `WAL` + `FULL` = ACID; `WAL` + `NORMAL` = "quizá
   no durable".
5. **[CouchDB — Replication Protocol](https://docs.couchdb.org/en/stable/replication/protocol.html)** — El
   diseño de checkpoints que hace la replicación reanudable. Es lo que le falta al `flush()` de Pedro.
6. **[RxDB — Replication protocol](https://rxdb.info/replication.html)** — Declara at-least-once y nombra el
   ACK perdido explícitamente. Buen texto para alinear a todo el equipo en el vocabulario.
7. **[microservices.io — Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html)** —
   El nombre canónico de lo que Fullsite ya está construyendo, con el problema del *dual write* enunciado.
8. **[Electric — Writes guide](https://electric.ax/docs/guides/writes)** — Los cuatro patrones de escritura
   local con sus trade-offs, y la decisión de no manejar escrituras. La mejor defensa escrita contra comprar
   un motor de sync.
9. **[Square — Process offline payments](https://squareup.com/help/us/en/article/7777-process-card-payments-with-offline-mode)** —
   Los límites concretos del offline de pagos y la transferencia de riesgo al comerciante.
10. **Pat Helland, *Idempotence Is Not a Medical Condition*, ACM Queue 10(4), 2012 —
    [DOI 10.1145/2181796.2187821](https://dl.acm.org/doi/10.1145/2181796.2187821)** — El fundamento teórico.
    **Aviso honesto: no pude abrir el texto completo (ACM devolvió 403 a la herramienta); lo cito por su
    referencia bibliográfica y por el resumen que arrojó la búsqueda, no por lectura directa.**

---

## TOP GITHUB REPOS

**[REC]** Ninguno de estos entra como dependencia de Pedro. Entran como referencia de implementación o, en
un caso, como dependencia trivial del lado servidor.

| Repo | Para qué sirve a Fullsite | Cómo usarlo | Riesgo |
|---|---|---|---|
| [rocicorp/replicache docs](https://doc.replicache.dev/reference/server-push) (spec, no el runtime) | El algoritmo de dedup con marcador transaccional | **Referencia.** Copiar el algoritmo, no el runtime | Licencia del runtime no verificada en esta sesión |
| [electric-sql/electric — `examples/write-patterns`](https://github.com/electric-sql/electric/tree/main/examples/write-patterns) | Cuatro implementaciones comparables de cola de escritura local con matching por write-id | **Referencia.** El patrón 3 (estado optimista persistente compartido) es el análogo directo del `sync_queue` | Es ejemplo, no librería |
| [pouchdb/pouchdb](https://github.com/pouchdb/pouchdb) + spec de CouchDB | Checkpointing reanudable probado en producción por más de una década | **Referencia** para el cursor de P0A-4 | Adoptar el runtime implicaría cambiar el modelo de datos |
| SQLite (via `better-sqlite3`) | Storage transaccional para Pedro | **Dependencia**, si se aprueba P0A-3. API síncrona, encaja con el código síncrono actual | Módulo nativo → hay que reconstruir por versión de Electron. Es el riesgo real de esta opción |
| [pgmq](https://github.com/tembo-io/pgmq) / `pg-boss` | Cola durable del lado Supabase si el outbox necesita un consumidor confiable en la nube | **Evaluar después de P0** | Fuera del alcance de P0A/P0B |

**Nota de honestidad:** no verifiqué stars, licencia ni último commit de estos repos en esta sesión — el
presupuesto de búsqueda se usó en las fuentes primarias de protocolo, que era lo que pedía el track.
Antes de adoptar cualquiera como dependencia hay que correr esa verificación. **Estado:
`NO VERIFICADO`, no `no existe`.**

---

## DIRECT IMPLICATIONS FOR P0A — APPEND IDEMPOTENCY FOUNDATION

El nombre "Append Idempotency Foundation" es correcto, pero hoy le falta el cimiento: **no hay append
durable.** En orden de ejecución:

**P0A-1 · Durabilidad real antes del ACK.** `fs.appendFileSync` no es durable
([ndjson.js:84](electron-app/local-server/adapters/storage/ndjson.js:84)); no hay un solo `fsync` en el repo.
Hoy Pedro promete lo que documenta ("un ACK visible implica que el evento ya está en disco",
[PER-02-RESEARCH.md §3](docs/architecture/PER-02-RESEARCH.md)) y no lo cumple ante corte de luz. **Esa frase
del doc es falsa y hay que corregirla o hacerla verdadera.** Guardián que la vuelve comprobable: una prueba
que mate el proceso con `SIGKILL` inmediatamente después del ACK y verifique que el evento sobrevive.

**P0A-2 · Un solo commit, no dos escrituras.** Evento y marcador de dedup deben comprometerse juntos
([event-store.js:42-44](electron-app/local-server/core/event-store.js:42)). Con SQLite es una transacción;
con NDJSON hay que derivar el índice de dedup del propio log al arrancar (es decir, borrar
`processed-commands.ndjson` como fuente y reconstruirlo por replay). La segunda opción es más barata y
elimina la clase de bug entera.

**P0A-3 · SQLite con `WAL` + `synchronous=FULL`.** Resuelve P0A-1 y P0A-2 de un golpe, con garantías
documentadas **[FACT]**, y ya estaba contemplado como Fase 2 en el propio código. La interfaz `EventStore`
existe justo para esto.

**P0A-4 · Checkpoint fuera del log.** Dejar de mutar `synced` dentro de cada evento
([ndjson.js:128-152](electron-app/local-server/adapters/storage/ndjson.js:128)). El diseño ya está escrito
en `OFFLINE-IMPL-001-OUTBOX-v2.2.md` — con versionado y rename atómico. **Implementar lo ya diseñado antes
de diseñar otra cosa.**

**P0A-5 · `readAfter(checkpoint)` en vez de `readAfter(0)`** ([outbox.js:77](electron-app/local-server/core/outbox.js:77)).
Cae solo con P0A-4.

**P0A-6 · Constraint único para inventario** ([inventory.ts:144](dashboard-app/src/lib/inventory.ts:144)).
Es el único de los seis que vive en la base de datos, no en Pedro. **[REC]** tratarlo como PR separado (§7 del
protocolo: un P0 por rama).

---

## DIRECT IMPLICATIONS FOR P0B — OFFLINE REPLAY SEMANTICS

**P0B-1 · El duplicado devuelve el resultado.** Cambiar `{ duplicate:true, event:null }` por el evento
original con su `sequence` ([event-store.js:29-31](electron-app/local-server/core/event-store.js:29)).
Sin esto, el replay sabe que "ya pasó" pero no *qué* pasó, y no puede reconciliar. Modelo a copiar:
`r1_save_order_idempotent`, que ya devuelve `first_execution`, `idempotent_replay` y `revision`
([save-order/route.ts:141-143](dashboard-app/src/app/api/pos/save-order/route.ts:141)).

**P0B-2 · Semántica de error de tres vías en Pedro.** La web ya clasifica bien
(`TRANSIENT_RETRYABLE` / `STALE_WRITE_CONFLICT` / `TERMINAL_NON_RETRYABLE`,
[pos-offline-db.ts:17-21](dashboard-app/src/lib/pos-offline-db.ts:17)); el outbox de Pedro sólo distingue
ok / conflict / falla y **se detiene para siempre** ante una falla dura
([outbox.js:98-101](electron-app/local-server/core/outbox.js:98)). La regla de Replicache es explícita: el
error permanente avanza el marcador para no bloquear al cliente **[FACT]**. Un terminal debe ir a
dead-letter con alerta.

**P0B-3 · Matar el corte silencioso por `retries >= 5`.** En la web, un ítem que agota reintentos deja de
intentarse ([pos-offline-db.ts:534](dashboard-app/src/lib/pos-offline-db.ts:534)) y sólo se cuenta como
"exhausted" ([pos-offline-db.ts:275](dashboard-app/src/lib/pos-offline-db.ts:275)). Un ítem de dinero
abandonado en silencio es exactamente el descuadre que §8 del protocolo prohíbe declarar cerrado. **[REC]**
backoff exponencial sin tope de intentos para transitorios, y alerta visible al operador por profundidad y
antigüedad de cola.

**P0B-4 · Auditoría que no se tira.** La cola de eventos de auditoría descarta los más viejos al pasar de
1,000 ([events.ts:59-67](dashboard-app/src/lib/events.ts:59)), con `console.warn`. Es pérdida silenciosa
de evidencia. **[REC]** IndexedDB + alerta, nunca descarte.

**P0B-5 · Orden de replay entre dominios.** **[INFER]** Hoy el `sync_queue` de la web y el outbox de Pedro
reproducen de forma independiente; nada garantiza que un `ORDER_CLOSED` no se sincronice antes que el
`ORDER_SENT` correspondiente si viajan por rutas distintas. No lo pude descartar leyendo el código en esta
sesión. **Pregunta abierta, no hallazgo.**

---

## WHAT NOT TO BUILD

1. **Un motor de sync propio de propósito general.** Fullsite no necesita sincronizar tablas arbitrarias;
   necesita reproducir ~10 tipos de comando con identidad estable. El alcance acotado es la ventaja.
2. **CRDTs.** Resuelven escritura concurrente sin coordinación. Fullsite tiene locks de mesa
   ([command-handler.js:59-65](electron-app/local-server/core/command-handler.js:59)) y un solo escritor por
   recurso. Meter CRDTs sería pagar el costo de un problema que no se tiene.
3. **Relojes vectoriales / Lamport.** Pedro ya asigna una secuencia total monotónica en un solo proceso
   ([ndjson.js:76](electron-app/local-server/adapters/storage/ndjson.js:76)). Un solo escritor no necesita
   relojes lógicos. Sólo harían falta si hubiera dos Pedros escribiendo el mismo log — que es un escenario
   a **evitar**, no a soportar.
4. **Autorización de tarjetas offline propia.** Toast, Square y Clover documentan límites, ventanas y
   transferencia de riesgo al comerciante **[FACT]**. Eso es negocio y contrato con el adquirente, no
   ingeniería. Track C.
5. **Un segundo Pedro "de respaldo" con elección de líder.** Toast tiene un solo hub por restaurante
   **[FACT]**. Dos autoridades es split-brain garantizado. La respuesta a "¿y si muere la caja?" es
   recuperación rápida, no consenso distribuido.
6. **Reescribir el camino de `r1_save_order_idempotent`.** Es la pieza que ya está bien. Se copia hacia
   adentro, no se toca.

---

## DECISIONS WE CAN MAKE NOW

Estas no requieren más investigación. **[REC]** en todas — la decisión es de Daniel.

| # | Decisión | Justificación en una línea |
|---|---|---|
| D1 | **Todo ACK de Pedro implica disco sincronizado.** Se vuelve invariante escrito y probado. | Hoy el doc lo afirma y el código no lo cumple. |
| D2 | **Un duplicado siempre devuelve el resultado original.** Regla de toda la casa, no sólo de órdenes. | Stripe, Replicache; y Fullsite ya lo hace bien en órdenes. |
| D3 | **Ninguna deduplicación por `LIKE` sobre texto libre.** Toda identidad de operación tiene columna propia y constraint único. | `inventory.ts:144` es check-then-act. |
| D4 | **El log de eventos es inmutable; el progreso vive en un checkpoint aparte.** | CouchDB; y ya está diseñado en el repo sin implementar. |
| D5 | **Ningún elemento de dinero se abandona en silencio.** Sin tope de reintentos para transitorios; los terminales van a dead-letter con alerta visible. | `retries >= 5` hoy abandona callado. |
| D6 | **No se compra motor de sync para el camino de escritura.** | ElectricSQL retiró esa función de su propio producto. |
| D7 | **Un solo Pedro por restaurante. No se explora alta disponibilidad local.** | Toast documenta un solo hub. |
| D8 | **SQLite es el destino del storage de Pedro**, detrás de la interfaz `EventStore` existente. | Resuelve durabilidad + atomicidad + índice de dedup de un golpe. |

**Cuál haría primero, si sólo se puede una:** D1 / P0A-1. Es la única de la lista donde el modo de falla es
*pérdida de datos ya confirmados al usuario*, y el corte de luz no es un caso raro en un restaurante de
Monterrey — es el martes.

---

## OPEN QUESTIONS

Preguntas que este research **no** puede contestar. Las tres primeras son para Daniel; sólo él tiene la
respuesta y preguntarle sale más barato que inferirla (§2 del protocolo).

1. **¿Cuánto tiempo real ha operado AMALAY sin WAN de corrido?** Determina si la cota de 1,000 eventos de
   auditoría y el tamaño del log son teóricos o inminentes.
2. **¿Ha habido un apagón con el POS abierto desde la instalación de agosto?** Si la respuesta es sí y no se
   perdió nada, tuvimos suerte, y conviene saberlo. Si se perdió algo, P0A-1 sube de prioridad y de
   argumento.
3. **¿Qué significa "cerrado" para P0A/P0B en el gate del cliente #2** — código con pruebas, o validación
   física con corte de luz real en el restaurante? El §10 del protocolo dice lo segundo; quiero que sea
   explícito antes de que alguien lo declare.
4. **[INFER, sin verificar]** ¿Puede un `ORDER_CLOSED` sincronizarse antes que su `ORDER_SENT` cuando viajan
   por rutas distintas (web `sync_queue` vs outbox de Pedro)? No lo pude descartar leyendo el código. Requiere
   una lectura dirigida de `pos-data.ts` + `syncAll()`, no más web research.
5. **¿Qué tan caro es `better-sqlite3` en el pipeline de Electron** (rebuild por versión, firma, tamaño del
   instalador)? Es el único riesgo real de D8 y se contesta construyendo, no investigando.
6. **No verificado en esta sesión:** stars, licencias y actividad de los repos listados. Estado
   `NO VERIFICADO`, que no es lo mismo que "no sirven".

---

## Respuestas directas a las 7 preguntas

**1 · ¿Cómo debe modelarse una operation identity durable?**
Cinco propiedades, todas presentes en Stripe y Replicache **[FACT]**: **(a)** la genera el cliente, antes del
primer intento; **(b)** es estable entre reintentos — nunca se regenera; **(c)** viaja con cada intento;
**(d)** el receptor la persiste **en la misma transacción que el efecto**; **(e)** el receptor guarda también
el *resultado*, no sólo la llave. Fullsite tiene (a)–(c) y le falta (d) y (e) en Pedro. **[REC]** añadir un
sexto campo: `(terminal_id, client_seq)` monotónico junto al UUID, que es lo que permite detectar comandos
**perdidos**, no sólo duplicados — un UUID solo nunca revela un hueco.

**2 · ¿Cómo distinguen los sistemas maduros "nunca llegó" de "llegó y se perdió el ACK"?**
**No lo distinguen — y ése es el punto.** RxDB lo enuncia: la escritura pudo haberse procesado y fallar sólo
la respuesta **[FACT]**. El cliente reintenta con la misma identidad; el servidor decide. Lo que sí hacen los
sistemas maduros es hacer que el reintento sea **informativo**: Stripe devuelve el resultado original;
Replicache devuelve un `lastMutationID` del que el cliente deduce qué se aplicó **[FACT]**. Pedro hoy
contesta "duplicado" sin más — el cliente sabe que llegó pero no qué pasó. **Ésa es la brecha de P0B-1.**

**3 · ¿Qué patrón para cada dominio?**

| Dominio | Patrón | Por qué | Estado hoy |
|---|---|---|---|
| **Order save** | Idempotency key + **resultado cacheado** + OCC por revisión | Es dinero y tiene estado previo | ✅ Correcto (`r1_save_order_idempotent`) |
| **Cash movement** | Insert-only con `UNIQUE(client_id, op_id)` + `ON CONFLICT DO NOTHING` | Es dinero, inmutable, sin estado previo → no necesita OCC | Parcial: la cola es durable, falta confirmar el constraint |
| **Inventory movement** | Ledger append-only + `UNIQUE(client_id, idempotency_key)` | Es un ledger: la suma debe ser exacta, el orden no importa | ❌ Dedup por `LIKE` — **P0A-6** |
| **Market movement** | Igual que inventory | Mismo contrato | Igual que inventory |
| **Audit event** | At-least-once con dedup por `event_id` en destino; **nunca descartar** | Duplicar una auditoría es feo; perderla es inaceptable | ⚠️ Dedup OK (`on_conflict=id`), pero descarta al llegar a 1,000 — **P0B-4** |

La regla general, y es la de Helland: **clasificar cada operación por su naturaleza, no por su tecnología.**
Un ledger inmutable sólo necesita un constraint único. Un objeto mutable necesita además control de
concurrencia. Una auditoría necesita durabilidad pero tolera duplicados. Un `print` no necesita nada de esto
— y el repo ya lo dice por escrito ([recoverable-operation.ts:19-21](dashboard-app/src/lib/recoverable-operation.ts:19)).

**4 · ¿Qué NO debería hacer Fullsite?**
Ver *What Not To Build*. El resumen: no construir un motor de sync general, no meter CRDTs ni relojes
lógicos, no montar un segundo Pedro, no inventar autorización de tarjeta offline, y no tocar el camino de
`r1_save_order_idempotent`.

**5 · ¿Hay librerías que ahorren trabajo sin reemplazar a Pedro?**
**Para el camino de escritura, no — y la mejor evidencia la da el propio mercado:** ElectricSQL quitó las
escrituras locales de su producto y hoy recomienda usar el backend propio **[FACT]**; PowerSync y RxDB
delegan idempotencia y conflictos al servidor que tú escribes **[FACT]**. Lo que sí ahorra trabajo de verdad:
**SQLite** (durabilidad y atomicidad gratis, con garantías documentadas) y **los protocolos publicados de
Replicache y CouchDB como especificación**. La forma de ahorrar meses aquí no es adoptar un motor: es dejar
de diseñar el algoritmo y copiar uno que ya está escrito.

**6 · ¿Está alineado el enfoque actual?**
**Sí, y bastante.** Cola durable local + operation ids + dedup en servidor es literalmente el patrón de
Replicache, RxDB, PowerSync y el outbox transaccional **[FACT]**. Tres cosas ya están al nivel de la
industria: el FIFO bloqueante del outbox, la clasificación de errores en tres clases del lado web, y la
idempotencia con resultado cacheado de `r1_save_order`. **Lo que no está alineado son tres detalles de
implementación, no el diseño**: durabilidad (no hay `fsync`), atomicidad (dos escrituras separadas) y
respuesta al duplicado (no devuelve el resultado). Los tres son acotados y los tres son P0A/P0B.

**7 · ¿Qué cambiaría antes del cliente #2?**
Sólo cuatro cosas, en este orden:
1. **`fsync` antes del ACK** (o SQLite `WAL`+`FULL`). Es la única con pérdida de datos confirmados.
2. **Evento + marcador de dedup en un solo commit.**
3. **El duplicado devuelve el resultado original.**
4. **Constraint único en inventario, en lugar del `LIKE`.**

Todo lo demás — descubrimiento mDNS, checkpoint versionado, dead-letter, auditoría en IndexedDB — es real
pero no bloquea al cliente #2. **[REC]** Y una regla de método, de §17: cada una de estas cuatro se cierra
con una prueba que **falle primero** reintroduciendo el bug (matar el proceso tras el ACK, disparar dos
réplicas concurrentes del mismo movimiento). Un guardián que nunca se vio fallar no protege nada.

---

## Cierre del track

**Este documento cierra Track A.** No se inició hardware, payments, ni ningún track P1/P2, y no se lanzaron
agentes adicionales.

**Seguimiento (2026-09-17, mismo día).** Daniel recibió este track y **no amplió el alcance de P0A**. Los
hallazgos quedaron registrados —sin autorización de implementar— en
[BACKLOG-P0.md](BACKLOG-P0.md): el requisito de *outcome* en el replay idempotente se suma a **P0B**;
la durabilidad del event store se registra como **P0C-PEDRO-DURABILITY**; la carrera de dedup de
inventario como **P0D-INVENTORY-DEDUP-RACE**. Orden vigente:
`P0A → certificar → P0B → P0C → P0D/reliability wave`.

> **Y la regla con la que hay que leer todo lo de arriba:** lo que produjo este documento son
> **hallazgos estáticos**, no defectos de producto. Un hallazgo se promueve a defecto **después** de
> reproducirlo en runtime, no antes. Ningún renglón de este research autoriza un fix por sí solo.
</content>
</invoke>
