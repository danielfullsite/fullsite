> ⚠️ **ADVERTENCIA DE FIABILIDAD (añadida 2026-09-18).** Este documento lo produjo un agente del
> intento de research en paralelo del 2026-09-17, que **terminó abortado por límite de uso**; varios
> de esos agentes agotaron el presupuesto de búsqueda y degradaron sus fuentes a mitad del trabajo.
> Además, **toda referencia a código de este repo se leyó del working tree `feat/pos-ui-kit`, que
> está 663 commits atrás de `origin/main`** — el mismo error que invalidó un hallazgo del Track A
> (ver `P0B-COMMAND-RECEIPTS.md`). **No fue revisado.** Úsalo como pista, no como fuente. Antes de
> citar cualquier cosa de aquí: verifica la URL, y verifica el código con `git show origin/main:<ruta>`.

# Track A — Offline-first POS: qué sabe la industria y qué debe construir Fullsite

> Investigación read-only, 2026-09-17. Fuentes primarias consultadas vía WebFetch/WebSearch el mismo día.
> Cada afirmación va marcada como **HECHO** (documentado públicamente, URL exacta), **INFERENCIA**
> (deducción mía a partir de lo público) o **RECOMENDACIÓN** (qué significa para Fullsite).
> Lo que no es público se dice como tal. No se tocó código ni producción.

Contexto que se da por sabido (no se repite en cada sección): Pedro = servidor local Node :7717 con
event store NDJSON append-only, dedup por `command_id` en `processed-commands.ndjson`, `RestaurantState`
en memoria reconstruido por replay, broadcast WebSocket a POS secundarios y KDS; UI Next.js desde Vercel
con Service Worker; outbox IndexedDB (`sync_queue`) con `base_version` + `save_operation_id`; dos
autoridades (Supabase = dinero; Pedro = estado LAN). Huecos conocidos: dos `appendFileSync` no atómicos,
SQLite considerado para fase 2, outbox v2.2 con checkpoint versionado.

---

## 0. Respuesta corta

**El patrón que más trabajo ahorra sin ceder control es el que Fullsite ya eligió y el que Replicache,
PowerSync y Odoo ejecutan de formas distintas: *log de comandos idempotentes con un único escritor
autoritativo por dominio, cola FIFO de subida que no avanza hasta recibir ACK, y rebase del estado
local sobre el estado canónico*.** No es una librería que se instala; es una disciplina. Lo que sí se
puede tomar prestado casi literal es:

1. La **semántica de cola** de PowerSync (FIFO bloqueante; "mientras haya mutaciones pendientes el
   cliente no avanza a un checkpoint nuevo, por eso nunca resuelve conflictos localmente").
2. El **contrato `clientID + lastMutationID`** de Replicache (entero secuencial por cliente, el
   servidor guarda el último aplicado → dedup y orden en una sola comparación).
3. La **transacción única SQLite** (evento + marca de comando procesado + snapshot pointer) con
   `synchronous=FULL` en WAL, que cierra el hueco de los dos `appendFileSync`.
4. Las **reglas de negocio de pagos offline** que Toast, Square y Clover publican casi idénticas
   (tope por transacción, tope total, ventana de 24–72 h, responsabilidad del comerciante, cifrar
   y guardar, nunca refund de algo no subido). Eso es un feature copiable, no arquitectura.

Lo que **no** hay que copiar: CRDTs para el dominio de mesas/tickets/dinero (Zero lo dice sin rodeos:
"ningún sync engine ni algoritmo CRDT puede resolverlo automáticamente"), FUSE/LiteFS (un solo primario
en datacenter, no LAN), Ditto como dependencia (propietario, y el proveedor de sync que más se le
parecía —Atlas Device Sync— murió en 2024), y el modelo Toast de "cada tablet es una isla" cuando no
hay hub local.

---

## 1. Vendors POS: lo que publican

### 1.1 Toast

**HECHO.** Toast documenta dos modos. *Offline estándar*: "40 seconds after no Internet connectivity or
during a Toast outage, your Toast POS device enters offline mode"; "order data is stored locally on each
individual device"; "Devices cannot sync with each other while offline, so orders added or updated on
one device do not appear on other devices" ([adminOfflineModeOverview](https://doc.toasttab.com/doc/platformguide/adminOfflineModeOverview.html),
[platformOfflineMode](https://doc.toasttab.com/doc/platformguide/platformOfflineMode.html)).
*Offline con local sync*: "uses a Toast device as the point of connection, or the local hub device,
between all devices on a restaurant's local network"; el hub se asigna automáticamente y debe ser
cableado por Ethernet, no handheld, "active, meaning it received a ping from Toast within the last
three minutes"; "a restaurant can only have one local hub device"
([platformOfflineModeLocalSync](https://doc.toasttab.com/doc/platformguide/platformOfflineModeLocalSync.html)).
Incluso con hub, lo que se comparte en LAN es **KDS, pagos offline, impresión y cajón**; "Sharing orders
between devices on the same local network that are not KDS devices" sigue **no disponible**.

**HECHO.** Numeración de cheques offline: "Add 2 to the POS device number. Next, the new device number is
multiplied by 1000" (dispositivo 1 → cheques desde 3000); al reconectar "check numbering resumes from
where it left off before going offline". Advertencia: "Do not uninstall and reinstall the Toast POS app
on a device. Doing so permanently removes all stored data and payments from the device."

**HECHO.** Pagos: "takes the card information, encrypts it, and stores it on the Toast POS device";
"You are responsible for any declined, expired, or disputed payments while operating in offline mode";
recomiendan volver online "within three days, preferably within 24 hours"; tope configurable por
transacción con aprobación de gerente arriba del tope ([adminOfflineCCPayments](https://doc.toasttab.com/doc/platformguide/adminOfflineCCPayments.html)).

**No es público:** el formato del log local, cómo resuelven conflictos al reconectar, cómo deduplican.
La patente US 11151536 ("Systems and methods for providing a point of sale platform") aparece en
búsquedas junto a Toast; el PDF que bajé es imagen CCITT sin capa de texto, así que **no pude confirmar
asignatario ni claims** — no lo cito como hecho.

**INFERENCIA.** El esquema de numeración por rangos (device×1000) es un *ID espacio disjunto por
terminal* barato para evitar colisiones sin coordinación; lo que Toast **no** resuelve es la vista
compartida de mesas offline. Su hub es un relay, no una autoridad de estado — por eso "share orders"
sigue apagado. Pedro es estrictamente más ambicioso que Toast en ese punto.

**RECOMENDACIÓN.** (a) Copiar el criterio de elegibilidad del hub como *check ejecutable* de Pedro
(Ethernet, no portátil, ping reciente) y mostrarlo en arranque. (b) Adoptar un rango de folios offline
por terminal, o mejor, folio = `(terminal_id, seq)` y renumerar al cerrar turno — el folio "bonito" es
una proyección, no identidad. (c) Publicar en la UI la advertencia de Toast/Shopify sobre reinstalar o
cerrar sesión con cola pendiente.

### 1.2 Square

**HECHO.** Mobile Payments SDK: "Each device running the Mobile Payments SDK can take up to 1000 payments
for up to 24 hours before reconnecting to the network"; límites `offlineTransactionAmountLimit` y
`offlineTotalStoredAmountLimit`; cola local con estados `QUEUED / UPLOADED / FAILED_TO_UPLOAD /
FAILED_TO_PROCESS / PROCESSED`; cada pago tiene `localID` y un `id` de Square que "is always null until
the SDK uploads the payment"; `FAILED_TO_PROCESS` "cannot be recovered, and the seller doesn't receive
funds"; "Sellers must contact Square and opt-in"
([Android offline payments](https://developer.squareup.com/docs/mobile-payments-sdk/android/offline-payments)).
Help center: "You must upload your offline payments within 72 hours of the start of your offline
payments session. However, uploading your offline payments within 24 hours is highly recommended";
tope por transacción configurable "between $1 and $50,000"; "Offline payments can't be canceled or
refunded while they're still processing"; "You will not receive notifications for declined payments
while processing offline payments"
([Process offline payments](https://squareup.com/help/us/en/article/7777-process-card-payments-with-offline-mode)).
Square lleva offline desde 2014 y en 2024 lo extendió a todo el hardware
([press](https://squareup.com/us/en/press/square-brings-offline-payments)).

**INFERENCIA.** El par `localID` / `id` es exactamente el par `save_operation_id` / `payment_id` de
Fullsite; Square lo expone como *máquina de estados con nombre* por pago, no como flag booleano.

**RECOMENDACIÓN.** Adoptar la máquina de estados de Square **tal cual** para cada operación de dinero
en la outbox: `QUEUED → UPLOADED → PROCESSED | FAILED_TO_UPLOAD (reintentable) | FAILED_TO_PROCESS
(terminal, requiere acción humana)`. Y la regla "no refund ni void de lo que no ha subido" como guardia
en Supabase, no sólo en UI.

### 1.3 Clover

**HECHO.** "By default Clover Mini and Flex are set to take offline payments for up to 7 days"; el
comerciante puede "disable offline payments, set transaction amount limits, or establish total offline
processing caps"; tres niveles de override para apps (`allowOfflinePayment` con challenge al
comerciante, `approveOfflinePaymentWithoutPrompt`, `forceOfflinePayment`); la respuesta lleva
`issues.offline`; "By using any of the offline payments settings, you assume responsibility for warning
the merchant" ([handling-offline-payments](https://docs.clover.com/dev/docs/handling-offline-payments)).

**RECOMENDACIÓN.** La idea del **challenge** (el sistema pregunta "¿aceptas riesgo offline por $X?"
arriba de un umbral, con auto-aprobación por debajo) es un feature de bajo costo y alto valor para
la caja de AMALAY: umbral por tenant en configuración, sin tocar código (§12 del protocolo).

### 1.4 Lightspeed

**HECHO.** Marketing y soporte: "fully-featured offline mode with automatic syncs and backups";
"continue to process and send orders to the kitchen or bar, and data will sync to your back office once
the internet is back up"; sólo efectivo y pagos manuales offline
([App Store listing](https://apps.apple.com/us/app/lightspeed-restaurant-pos-k/id1486190847),
[O-Series offline](https://o-series-support.lightspeedhq.com/hc/en-us/articles/31329361292571-Working-with-Lightspeed-Offline)).
**No es público** el mecanismo. Nada que aprender arquitectónicamente; sirve como *benchmark de
promesa comercial* ("orders to kitchen offline" es tabla de apuestas mínima).

### 1.5 Shopify POS

**HECHO.** "Logging out of Shopify POS, or turning off the device might cause loss of offline orders";
offline no hay returns, voids, exchanges, gift cards, ni "view a recent cart that was created on another
device"; card auth offline sólo con Shopify Payments y habilitado de antemano; "Shopify does not publish
a specific transaction limit" ([offline-features](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/selling-offline/offline-features)).

**INFERENCIA.** Shopify guarda la cola en el proceso de la app (por eso cerrar sesión la pierde). Es
el anti-patrón que Odoo también sufrió (§1.6). Fullsite ya está mejor (IndexedDB), pero el Service
Worker de Vercel introduce el mismo riesgo si una actualización limpia storage — verificar.

### 1.6 Odoo POS (open source, LGPL-3.0, ~54.4k★, Python/JS)

Es la única implementación **leíble** de un POS de restaurante con offline real y mucho tráfico de
producción. Lo que enseña está en sus issues, no en sus docs.

**HECHO.** Arquitectura: SPA JS que precarga productos/clientes/precios al abrir sesión; "You cannot
open a new POS session without internet—only existing sessions continue to work offline"; órdenes
offline "saved locally as unsynced data" y el ícono wifi muestra en rojo cuántas faltan
([foro](https://www.odoo.com/forum/help-1/what-s-the-mechanism-of-pos-offline-283217)).

**HECHO (código, rama 18.0, `addons/point_of_sale/static/src/app/store/pos_store.js`).** Órdenes
pendientes se rastrean en `pendingOrder.{create,write,delete}`; identidad por `uuid`; comentario
literal en el código: *"We are now syncing orders one by one to avoid cancelling all sync when one order
fails, this also avoid timeout issues with a lot of orders"*; cada orden va a
`pos.order.sync_from_ui`; un `Set` `syncingOrders` filtra "orders that are already being synced";
`ConnectionLostError` se atrapa y se queda en modo offline; errores no de red disparan
`deviceSync.readDataFromServer()`
([raw](https://raw.githubusercontent.com/odoo/odoo/18.0/addons/point_of_sale/static/src/app/store/pos_store.js)).

**HECHO (issues).**
- [#125037](https://github.com/odoo/odoo/issues/125037): "localStorage has a 5-second default commit
  delay and limits to 60 commits per hour"; con apagón dentro de esos 5 s la orden confirmada
  desaparece, y luego "the order syncs but gets rejected as a duplicate" o reaparece como no
  confirmada. Propuesta: IndexedDB. Sin respuesta de mantenedores en la página.
- [#189836](https://github.com/odoo/odoo/issues/189836) (Odoo 18): al restaurar, IndexedDB se carga
  primero y luego `sync_from_ui` "**overwriting** the orders restored from indexedDB" sin merge → se
  pierde el último producto agregado. Afecta `pos_restaurant` porque ahí los borradores sincronizan
  seguido.
- [PR #191383](https://github.com/odoo/odoo/pull/191383): `_flush_orders_retry` manda una por una y
  lleva estado `connected/error/disconnected` por orden.

**INFERENCIA.** Odoo pasó por tres lecciones que Fullsite está a tiempo de no repetir: (1) el
almacenamiento del navegador no es durable salvo IndexedDB y aun así el proceso puede morir antes del
commit; (2) "restaurar de local y luego bajar del servidor" **sin rebase** pierde escrituras — es
justamente lo que Replicache/PowerSync formalizan; (3) sincronizar en lote hace que un fallo
contamine a todos; uno por uno con estado por ítem es lo robusto.

**RECOMENDACIÓN.** Escribir tres pruebas de regresión con los nombres de esos issues:
`odoo-125037` (kill del proceso <5 s después de confirmar → la orden sobrevive), `odoo-189836`
(reload con outbox pendiente y snapshot del servidor más viejo → rebase, no overwrite),
`odoo-191383` (una operación envenenada en la cola no bloquea las demás **excepto** cuando el orden
importa — ver §3.2).

### 1.7 Open source clásico (Floreant, uniCenta, Chromis)

**HECHO.** Los tres son Java + BD relacional central (Derby/MySQL/Postgres) en LAN
([Floreant](https://github.com/fat-tire/floreantpos), [Chromis](https://github.com/chafarleston/ChromisPOS-1)).
"Offline" para ellos significa *sin nube*, no *sin servidor*: si se cae la máquina de la BD se cae
todo. Calidad de producción: mantenimiento esporádico (Floreant "updated from SVN source 7-3-22").
**No hay nada que reutilizar** en sync; sí confirman que el modelo "un servidor LAN autoritativo +
terminales delgadas" es el que la industria pequeña ha usado 20 años. Pedro es eso más un WAL y una
nube.

---

## 2. Motores de sync y bases local-first

Tabla resumen (cifras leídas de GitHub el 2026-09-17; "activo" = commits recientes visibles):

| Repo | ★ | Licencia | Lenguaje | Estado | Autoridad | Escrituras offline |
|---|---|---|---|---|---|---|
| electric-sql/electric | 10.4k | Apache-2.0 | Elixir/TS | 1.0, activo | Postgres | **No** (sólo read-path) |
| powersync-ja/powersync-service | 382 | FSL (server) / Apache+MIT (SDKs) | TS | activo | tu backend | Sí, cola FIFO |
| pubkey/rxdb | 23.4k | Apache-2.0 (+premium) | JS | activo | tu backend | Sí, push/pull con checkpoints |
| rocicorp/replicache | 1.2k | abierto, mantenimiento | TS | **archivado 2026-06-10** | tu backend | Sí, mutators + rebase |
| Zero (rocicorp) | — | — | TS | beta | Postgres | **No** ("writes are rejected") |
| automerge/automerge | 6.6k | MIT | Rust/JS | activo | ninguna (CRDT) | Sí |
| yjs/yjs | 22.8k | MIT | JS | activo | ninguna (CRDT) | Sí |
| pouchdb/pouchdb | 17.6k | Apache-2.0 | JS | mantenido | CouchDB (rev trees) | Sí |
| vlcn-io/cr-sqlite | 3.8k | MIT | Rust/C | activo | ninguna (CRDT por columna) | Sí |
| superfly/litefs | 4.9k | Apache-2.0 | Go | beta | un primario | No (single writer) |
| tursodatabase/libsql | 17.2k | MIT | Rust | "new features in Turso" | primario cloud | beta (`offline: true`) |
| Ditto | — | propietario | — | comercial ($82M 2025) | mesh CRDT + Big Peer | Sí |
| odoo/odoo | 54.4k | LGPL-3.0 | Python/JS | activo | servidor Odoo | Sí (ver §1.6) |

### 2.1 ElectricSQL

**HECHO.** "Electric does read-path sync. It syncs data out-of Postgres, into local apps and services.
Electric does not do write-path sync" ([writes guide](https://electric.ax/docs/guides/writes)). Documenta
cuatro patrones de escritura: online, optimista efímero, **optimista persistente compartido**
("Combining data on-read makes local reads slightly slower... writes are still made via an API") y
through-the-database con PGlite ("adds quite a heavy dependency"). Nota explícita: "Conflicts are
extremely rare and can be mitigated well by strategies like presence". Repo 10.4k★, Apache-2.0,
"Status 1.0" ([repo](https://github.com/electric-sql/electric)).

**QUÉ APRENDER.** El patrón 3 (optimista persistente + API para escribir + rebase al leer) es una
descripción formal de lo que Fullsite ya hace con `sync_queue` + Supabase. Sus docs de *rollback*
("Context availability differs: API-based writes preserve context; database syncing loses it") son el
argumento para **no** irse a sync a nivel de tabla.
**QUÉ REUTILIZAR.** Potencialmente Electric como read-path de menú/precios/empleados desde Postgres
hacia las terminales (reemplaza polling). **RIESGO:** dependencia Elixir en infra; Supabase ya da
Realtime. **NO COPIAR:** through-the-DB con PGlite en Electron (peso y schema shadow).

### 2.2 PowerSync

**HECHO.** Modelo de consistencia: checkpoints atómicos ("The client only updates its local state when
it has all the data matching a checkpoint"); cola de subida FIFO bloqueante que "cannot advance if the
backend does not acknowledge a mutation"; y la frase clave: **"While mutations are present in the
upload queue, the client does not advance to a new checkpoint. This means the client never has to
resolve conflicts locally"** ([consistency](https://docs.powersync.com/architecture/consistency)).
Conflictos: los decide tu backend en `uploadData`. Server FSL, SDKs Apache/MIT (según su propia
comparación con Ditto, [vendor-written](https://powersync.com/blog/ditto-vs-powersync)). Sólo lee de
Postgres directamente hoy ([FAQ](https://docs.powersync.com/resources/faq)).

**QUÉ APRENDER.** Es la formalización más limpia del *"outbox bloqueante + servidor autoritativo"*.
**QUÉ REUTILIZAR.** La regla de "no avanzar checkpoint con cola pendiente" como invariante del outbox
v2.2. **RIESGO.** Requiere un PowerSync Service entre Supabase y clientes (otro servicio, licencia FSL);
Pedro no es Postgres, así que no puede ser fuente para PowerSync sin un segundo Postgres local.
**NO COPIAR:** su LWW por default para tablas de dinero.

### 2.3 Replicache (archivado) y Zero

**HECHO.** Replicache: mutators que corren "both on the client (speculatively) and on the server
(canonically)"; **mutation IDs** enteros secuenciales por cliente; el servidor guarda `lastMutationID`
por cliente; en pull el cliente "rewinds to the last server state, applies the patch, then replays
pending mutations" (rebase) ([how-it-works](https://doc.replicache.dev/concepts/how-it-works)).
Está en "maintenance mode", gratis, sin features nuevos ([replicache.dev](https://replicache.dev/));
repo archivado el 2026-06-10 ([repo](https://github.com/rocicorp/replicache)).
Zero, su sucesor: **"Zero does not support offline writes"**; "supporting offline writes in
collaborative applications is inherently difficult, and no sync engine or CRDT algorithm can
automatically solve it for you"; recomiendan "a modal overlay that covers the entire screen and tells
the user to reconnect" ([offline](https://zero.rocicorp.dev/docs/offline)).

**INFERENCIA.** Que el equipo con más experiencia comercial en sync **retrocediera** en offline-writes
es el dato más importante de este track: confirma que offline con escrituras es un problema de dominio,
no de librería, y que el valor de Fullsite está precisamente ahí.

**QUÉ REUTILIZAR (patrón, no código).** `(client_id, mutation_seq)` como identidad de comando en Pedro
y en la outbox, con `last_applied_seq[client_id]` persistido en el servidor. Reemplaza el
`processed-commands.ndjson` de crecimiento ilimitado por una tabla de N filas (una por terminal) y
resuelve dedup **y** orden en la misma comparación. Es el mismo diseño que las *activities* de Helland
(§4).

### 2.4 RxDB

**HECHO.** Protocolo "git-like": pull con checkpoint, push con `assumedMasterState` + `newForkState`
por documento y el servidor devuelve los estados master en conflicto; el conflict handler corre en
cliente y "typically preserves server data by default"; `RESYNC` al volver online; sólo una pestaña
replica ([replication](https://rxdb.info/replication.html)). 23.4k★, Apache-2.0 con plugins premium
de pago ([repo](https://github.com/pubkey/rxdb)).

**QUÉ APRENDER.** `assumedMasterState` es `base_version` generalizado a documento completo — Fullsite
ya tiene la versión escalar, que es más barata y suficiente para tickets. **RIESGO.** Modelo de
documento; los plugins de storage rápido (SQLite, OPFS) son premium. **NO COPIAR** como motor: obliga a
modelar Pedro como "master" RxDB y perder el log de comandos.

### 2.5 CRDTs: Automerge, Yjs, cr-sqlite, Ditto

**HECHO.** Automerge (6.6k★, MIT) y Yjs (22.8k★, MIT) son CRDTs de documento/texto para "concurrent
changes on different devices to be merged automatically without requiring any central server"
([automerge](https://automerge.org/docs/hello/), [yjs](https://github.com/yjs/yjs)). cr-sqlite (3.8k★,
MIT): extensión SQLite que convierte tablas en CRRs con LWW por columna, counters, fractional index;
"inserts into CRRs are 2.5x slower"; el causal event log (v2) está **planeado, no implementado**
([repo](https://github.com/vlcn-io/cr-sqlite)). Ditto: mesh BLE/LAN/P2P-WiFi/WebSocket con
"multiplexer", tipos `REGISTER` (LWW) y `COUNTER` (PN-counter con RESTART LWW)
([mesh](https://docs.ditto.live/key-concepts/mesh-networking), [DQL types](https://docs.ditto.live/dql/types-and-definitions));
Chick-fil-A lo usa para su POS "cloud-optional" y dice que acortó el rebuild "two years quicker than
planned" ([QSR](https://www.qsrmagazine.com/operations/fast-food/chick-fil-a-modernizes-its-pos-systems-with-ditto/));
Ditto levantó $82M en 2025 ([TechCrunch](https://techcrunch.com/2025/03/12/ditto-lands-82m-to-synchronize-data-from-the-edge-to-the-cloud/)).
Kleppmann et al. (Ink & Switch, 2019) posicionan CRDTs como base de local-first
([essay](https://www.inkandswitch.com/essay/local-first/)).

**INFERENCIA / contradicción entre fuentes.** Ditto + Chick-fil-A demuestra que *un* POS grande sí
corre sobre CRDTs en producción. Zero dice que ningún CRDT resuelve offline colaborativo por sí solo.
Ambas son ciertas a la vez: Chick-fil-A es *quick service* (ticket corto, sin mesa compartida entre
meseros, sin split de cuenta prolongado) y tiene un equipo interno que diseñó el modelo de datos
alrededor de las primitivas CRDT. El problema no es "CRDT sí/no" sino qué invariantes tiene el dominio:
un contador de "cantidad de tacos" merge bien; "la mesa 7 ya fue cobrada" **no** es mergeable — es
una decisión que necesita un árbitro. Fullsite es full-service con mesas, cuentas separadas, y cortes
de caja: el árbitro (Pedro para LAN, Supabase para dinero) es la arquitectura correcta.

**RECOMENDACIÓN.** No adoptar CRDTs como capa de estado. Sí robar dos ideas puntuales: (a) el
**fractional index** de cr-sqlite/Yjs para ordenar renglones/cursos de un ticket cuando dos meseros
insertan a la vez (evita renumerar); (b) el **PN-counter** para contadores puramente aditivos
(cantidad de un ítem antes de enviar a cocina) *sólo* si algún día se permite editar la misma cuenta
desde dos terminales sin lock. Hoy Pedro tiene locks; mantenerlos es más barato.

### 2.6 PouchDB / CouchDB

**HECHO.** CouchDB guarda **todas** las revisiones en conflicto como árbol; "By default, CouchDB picks
one arbitrary revision as the 'winner', using a deterministic algorithm so that the same choice will be
made on all peers"; la app debe presentar y fusionar ("Any sensible business-card application will, at
minimum, have to present the conflicting versions") ([conflicts](https://docs.couchdb.org/en/stable/replication/conflicts.html)).
Replicación por `_rev` + sequence numbers ([pouchdb.com](https://pouchdb.com/)).

**QUÉ APRENDER.** "Nunca perder una rama; elegir ganador determinista; dejar la fusión al negocio" es
el modelo de *reconciliación* correcto para cuando Pedro y Supabase divergen (por ejemplo, un pago
registrado en la outbox de un POS mientras Pedro reinició). **NO COPIAR** PouchDB como storage: el
modelo de documento + árbol de revisiones es pesado para un event log.

### 2.7 LiteFS, Turso/libSQL

**HECHO.** LiteFS: FUSE, "Single Writer Primary Model", lease vía Consul, "currently in a beta state"
([repo](https://github.com/superfly/litefs)). libSQL (17.2k★, MIT): embedded replicas con "reads run
locally... writes are sent to the cloud primary"; "You can write locally if you set the `offline`
config option to `true`"; "Cannot open the local database while syncing (corruption risk)"
([docs](https://docs.turso.tech/features/embedded-replicas/introduction)); offline writes en beta con
estrategias discard/rebase/manual y "if two devices write offline, the first to sync wins by default"
([blog](https://turso.tech/blog/introducing-offline-writes-for-turso)); el propio README dice
"If you're starting a new project, you probably want to look into Turso. libSQL is actively
maintained, but new features are being developed in Turso" ([repo](https://github.com/tursodatabase/libsql)).

**RECOMENDACIÓN.** Descartar ambos como capa de sync. LiteFS resuelve failover de un primario en
datacenter; Turso offline writes es beta y su default "primero en sincronizar gana" es exactamente lo
que un POS **no** quiere para dinero. Sí vale SQLite plano (embebido, `better-sqlite3` o similar) para
Pedro fase 2 — sin sync integrado.

### 2.8 MongoDB Realm / Atlas Device Sync (lección de mercado)

**HECHO.** Deprecado en septiembre 2024, EOL 30-sep-2025; MongoDB había comprado Realm en 2019; los
migradores fueron PowerSync, RxDB, Ditto (con quien MongoDB se asoció)
([foro MongoDB](https://www.mongodb.com/community/forums/t/atlas-device-sync-end-of-life-and-deprecation/296687),
[PowerSync blog](https://powersync.com/blog/powersync-as-alternative-to-mongodb-atlas-device-sync),
[RxDB](https://rxdb.info/articles/alternatives/mongodb-realm-alternative.html)). El hilo de HN devolvió
429, no lo cito.

**INFERENCIA.** Dos motores comerciales de sync (Realm Sync, Replicache) se retiraron o archivaron en
menos de dos años; un tercero (Zero) renunció a offline writes. El **motor de sync es la parte del
stack con mayor riesgo de abandono del proveedor** y la que más cuesta migrar (datos en vuelo en
miles de dispositivos). Argumento fuerte para que la cola y el log sean IP propio con formato abierto.

---

## 3. Patrones transversales y qué dicen las referencias clásicas

### 3.1 Idempotencia y "exactly-once effect"

**HECHO.** Stripe: "a client generates a unique ID to identify just that operation and sends it up to
the server"; al reintentar "the server simply replies with a cached result of the successful
operation"; backoff exponencial con jitter ([Stripe](https://stripe.com/blog/idempotency)).
Helland: "Messages are repeated. Later messages arrive before earlier ones"; la entidad es "the
boundary of atomicity"; sin transacciones entre entidades; las *activities* llevan estado por
partner para detectar duplicados y reorden ([resumen acolyer de "Life beyond…"](https://blog.acolyer.org/2014/11/20/life-beyond-distributed-transactions/);
original ACM Queue 14(5) 2016; "Idempotence Is Not a Medical Condition", CACM 55(5) 2012 — la página
de ACM Queue devolvió 403, cito por dblp/researchgate). Kleppmann (DDIA cap. 12): pasar un
request ID generado por el cliente por todos los niveles habilita "end-to-end duplicate
suppression"; exactly-once delivery no existe, lo que se construye es efecto-una-vez sobre
at-least-once + idempotencia (resúmenes: [rocky.dev](https://www.rocky.dev/notes/books/designing-data-intensive-applications),
[davidreis.me](https://www.davidreis.me/2024/designing-data-intensive-applications)).
Outbox transaccional: "messages are guaranteed to be sent if and only if the database transaction
commits"; el relay "might publish a message more than once", el consumidor debe ser idempotente
([microservices.io](https://microservices.io/patterns/data/transactional-outbox.html)).

**Qué ya hace Fullsite.** `command_id` en Pedro y `save_operation_id` en la outbox son idempotency
keys correctas. **Lo que falta según Stripe:** guardar y **devolver la respuesta original** al
reintento (hoy —inferencia por la descripción— se devuelve "ya procesado" sin el resultado, lo que
obliga al cliente a re-leer estado). Y según Helland: la entidad de atomicidad. En Pedro la entidad
natural es la **mesa/cuenta**; en Supabase es el **turno de caja**. Ninguna transacción debe cruzar
mesa↔turno; se comunican por comandos idempotentes. Hoy eso ya es implícitamente así — conviene
escribirlo como contrato.

### 3.2 Orden, revisiones y la trampa del "uno por uno"

**HECHO.** PowerSync: cola FIFO estrictamente ordenada. Odoo: uno por uno para que un fallo no bloquee.
**Contradicción aparente.** Se resuelve por entidad: el orden importa **dentro** de una mesa/cuenta
(agregar ítem antes de cobrar), no entre mesas. **RECOMENDACIÓN.** Outbox v2.2 con **una FIFO por
entidad** (`aggregate_id`), avance independiente entre entidades, y bloqueo estricto dentro de cada
una. Una operación envenenada bloquea su mesa, no el restaurante — y esa mesa aparece en rojo en la
UI de reconciliación (§5).

### 3.3 Event sourcing, snapshots y efectos externos en replay

**HECHO.** Fowler: "We can discard the application state completely and rebuild it by re-running the
events"; snapshot diario: "A system in use during a working day could be started at the beginning of
the day from an overnight snapshot"; y el aviso clave: "if these events cause update messages to be
sent to external systems, then things will go wrong because those external systems don't know the
difference between real processing and replays" → gateways que detectan modo replay
([Fowler](https://martinfowler.com/eaaDev/EventSourcing.html)).

**RECOMENDACIÓN.** (a) Snapshot de `RestaurantState` **al corte de turno** (cadencia natural de
Fowler; además el turno es la entidad de Supabase) más uno cada N eventos. (b) Los efectos externos
de Pedro —imprimir ticket, mandar a KDS, disparar sync a Supabase— deben pasar por un **gateway con
flag de replay**; si Pedro reconstruye estado en arranque, no debe reimprimir 300 comandas. Verificar
si hoy existe ese flag; si no, es el hueco #2 de la lista final.

### 3.4 Durabilidad real del log local

**HECHO.** SQLite WAL: "Writers sync the WAL on every transaction commit if PRAGMA synchronous is set
to FULL but omit this sync if... NORMAL"; con NORMAL "transactions are no longer durable and might
rollback following a power failure or hard reset" ([sqlite.org/wal](https://www.sqlite.org/wal.html)).
Blog agwa: "With WAL mode, FULL seems to suffice"; un driver Go popular pone NORMAL por default
([agwa](https://www.agwa.name/blog/post/sqlite_durability)). Odoo #125037: localStorage retrasa 5 s.

**INFERENCIA sobre Pedro.** `fs.appendFileSync` **no** implica `fsync`; en Windows con NTFS y caché de
escritura, un apagón puede perder el final del NDJSON, y peor: puede persistir la línea de
`processed-commands` sin la del evento (o viceversa) porque son dos archivos. Es el mismo fallo que
Odoo #125037 pero en el servidor. La caja de AMALAY va a UPS? (pregunta a Daniel; no la inferí).

**RECOMENDACIÓN (hueco #1).** Una sola transacción SQLite por comando:
`BEGIN; INSERT events(seq, aggregate_id, type, payload); INSERT processed(client_id, mutation_seq,
response); UPDATE cursors SET last_seq=?; COMMIT;` con `PRAGMA journal_mode=WAL; PRAGMA
synchronous=FULL;`. Atomicidad evento+dedup+respuesta cacheada en un solo fsync. NDJSON se conserva
como **export/backup legible**, no como fuente.

### 3.5 Split brain y stale devices

**HECHO.** Toast: un solo hub, elegible por Ethernet y ping <3 min. Ditto: mesh sin árbitro (y por eso
CRDT). Turso: "first to sync wins". **No es público** cómo Toast evita dos hubs.
**RECOMENDACIÓN.** Pedro ya es único por diseño (corre en "la caja"). El riesgo real no es dos Pedros,
es un **POS secundario que siguió aceptando comandos sin Pedro** y luego reaparece. Regla: los
terminales sin Pedro sólo escriben a su outbox *como comandos*, nunca aplican estado compartido
localmente más allá de su propio ticket abierto; al reconectar, Pedro aplica con `base_version` y
rechaza lo obsoleto (rebase Replicache). Y **epoch de Pedro**: cada arranque de Pedro incrementa un
`epoch`; comandos con epoch viejo se aceptan sólo si `base_version` sigue válido.

---

## 4. Features vs patrones arquitectónicos

| Es un **feature** (copiar, configurable por tenant) | Es un **patrón** (diseñar una vez, es IP) |
|---|---|
| Ventana 24/72 h para subir pagos offline (Square/Toast) | Log de comandos idempotentes con `(client_id, seq)` |
| Tope por transacción + tope total + challenge de gerente (Clover/Square/Toast) | FIFO por entidad que no avanza sin ACK (PowerSync) |
| Estados `QUEUED/UPLOADED/PROCESSED/FAILED_*` visibles (Square) | Rebase local sobre estado canónico (Replicache) |
| Banner offline a los N s con causa y acciones (Toast: 40 s) | Transacción única evento+dedup+respuesta (Stripe+SQLite) |
| Folio offline por rango de terminal (Toast) | Snapshot al corte + gateway anti-replay (Fowler) |
| "No reinstales / no cierres sesión con cola pendiente" (Toast/Shopify) | Ledger de reconciliación con ramas visibles (CouchDB) |
| Contador rojo de "N órdenes sin sincronizar" (Odoo) | Dos autoridades por dominio, sin transacción cruzada (Helland) |
| Criterio de elegibilidad del hub (Toast) | Epoch del servidor local + rechazo de comandos obsoletos |

---

## 5. Cierre

### (1) Lo que la industria ya sabe y Fullsite no debe redescubrir

- Offline con escrituras **no** se resuelve con una librería; los tres motores comerciales más
  sofisticados lo abandonaron, archivaron o nunca lo soportaron (Realm Sync, Replicache, Zero).
- Dinero offline es un **contrato de riesgo**, no un problema técnico: cifrar, guardar, subir en
  ≤24 h (72 máx), tope por transacción, responsabilidad del comerciante, nada de refunds sobre lo
  no subido. Toast, Square y Clover lo publican casi igual.
- Almacenamiento del navegador ≠ durable (Odoo #125037, Shopify). `appendFileSync` ≠ durable
  (SQLite docs). Sólo un commit con fsync lo es.
- "Restaurar local y luego bajar del servidor" sin rebase pierde escrituras (Odoo #189836). El rebase
  (Replicache) o el "no avanzar con cola pendiente" (PowerSync) son las dos soluciones conocidas.
- Sincronizar uno por uno con estado por ítem, dentro de cada entidad; nunca un lote monolítico.
- CRDTs sirven para texto, listas y contadores; no para "esta mesa ya se cobró". Chick-fil-A es la
  excepción que confirma: QSR con equipo interno de modelado.
- Un solo hub LAN, con criterio de elegibilidad explícito (Toast).

### (2) Lo que Fullsite debe construir como IP propio

- El **log de comandos de restaurante** (tipos, invariantes por mesa/cuenta/turno, folios) en formato
  abierto (SQLite + export NDJSON), con `(client_id, seq)` y respuesta cacheada. Nadie lo vende y los
  que lo intentaron como genérico se retiraron.
- La **reconciliación de dos autoridades**: el ledger que cuadra outbox(POS) ↔ Pedro ↔ Supabase por
  `save_operation_id`, con ramas visibles y decisión humana sólo cuando la regla no basta. Es lo que
  hace que "más confiable que Wansoft sin internet" sea demostrable, no prometido.
- El **runbook ejecutable** de arranque en frío (elegibilidad del hub, epoch, snapshot, cola
  pendiente por terminal) — la versión Fullsite de la regla "lo que no se puede olvidar es lo que se
  ejecuta solo".
- La certificación offline 23/23 como matriz reproducible. Ningún vendor publica la suya.

### (3) Top 5 URLs para leer, y por qué

1. https://docs.powersync.com/architecture/consistency — la regla "no avanzar checkpoint con cola
   pendiente" en dos párrafos; es la especificación del outbox v2.2 que falta escribir.
2. https://doc.replicache.dev/concepts/how-it-works — `lastMutationID` por cliente + rebase; el
   reemplazo natural de `processed-commands.ndjson`.
3. https://zero.rocicorp.dev/docs/offline — una página; explica por qué offline-writes es problema de
   dominio y por qué el árbitro (Pedro/Supabase) es la decisión correcta.
4. https://github.com/odoo/odoo/issues/125037 y https://github.com/odoo/odoo/issues/189836 — los dos
   bugs de producción que Fullsite tiene que convertir en pruebas de regresión antes de la próxima
   visita a AMALAY.
5. https://developer.squareup.com/docs/mobile-payments-sdk/android/offline-payments — la máquina de
   estados de pago offline y los límites, listos para copiar a la outbox de dinero.

(Bonus obligatorio para quien toque Pedro fase 2: https://www.sqlite.org/wal.html, sección
"Performance considerations", por la frase sobre NORMAL y pérdida de durabilidad.)

### (4) Huecos concretos del diseño actual de Pedro y cómo los cierran fuentes públicas

| # | Hueco | Fuente que muestra el cierre | Cierre propuesto |
|---|---|---|---|
| 1 | Dos `appendFileSync` no atómicos; sin fsync | sqlite.org/wal, agwa, Stripe | Una transacción SQLite (evento + processed + respuesta + cursor), WAL + `synchronous=FULL`. NDJSON queda como export. |
| 2 | Dedup por `command_id` en archivo de crecimiento ilimitado; no da orden | Replicache `lastMutationID`, Helland activities | `(client_id, seq)` monótono por terminal; servidor guarda `last_applied_seq[client_id]`; gap → esperar/pedir reenvío; ≤ → responder cache. |
| 3 | Replay reconstruye estado; ¿reimprime/re-emite efectos? (no verificado en código) | Fowler, "external updates" | Gateway de efectos con flag `replaying`; efectos externos se registran como eventos propios (`ticket_printed`) para no repetirlos. |
| 4 | Sin cadencia de snapshot definida | Fowler ("overnight snapshot") | Snapshot al corte de turno + cada N eventos; arranque = último snapshot + cola desde `seq`. |
| 5 | Outbox v2.2: un solo checkpoint global | PowerSync FIFO, Odoo uno-por-uno | FIFO **por entidad** (`aggregate_id`); bloqueo estricto dentro, independencia entre; estado por operación estilo Square. |
| 6 | Restaurar local + bajar servidor sin rebase (riesgo Odoo #189836) | Replicache rebase, PowerSync | Al reconectar: aplicar snapshot canónico, **luego** replay de outbox pendiente sobre él; nunca overwrite. |
| 7 | "Money authority" split existe pero sin contrato escrito ni ledger | Helland entidades, CouchDB ramas | Contrato: mesa/cuenta = entidad Pedro; turno = entidad Supabase; sin transacción cruzada; ledger de reconciliación por `save_operation_id` con estado `matched / only_pos / only_pedro / only_supabase / amount_mismatch`. |
| 8 | POS secundario que opera sin Pedro y reaparece | Toast hub único, `base_version` propio | Epoch de Pedro + `base_version`; terminales sin Pedro sólo encolan comandos de su propio ticket. |
| 9 | Pagos con tarjeta offline: ¿límites, ventana, liability configurables por tenant? (no verificado) | Square/Toast/Clover | Config por tenant: tope/transacción, tope total, ventana 24/72 h, challenge de gerente; guardia en Supabase contra refund de no-subidos. |
| 10 | Elegibilidad del host de Pedro no se comprueba en arranque (no verificado) | Toast local hub | Check ejecutable en `arranque-campo`: Ethernet, no portátil, reloj sincronizado, disco con espacio, UPS presente (pregunta abierta). |

### Contradicciones entre fuentes, registradas

- **Ditto/Chick-fil-A** ("CRDT mesh funciona para POS") vs **Zero** ("ningún CRDT resuelve offline
  colaborativo"). Resuelto por dominio: QSR sin mesas vs full-service con cuentas compartidas.
- **PowerSync** (FIFO global estricta) vs **Odoo** (uno por uno independiente). Resuelto: FIFO por
  entidad.
- **Toast marketing** ("24/7 offline reliability") vs **Toast docs** ("orders added on one device do
  not appear on other devices" y "share orders" apagado aun con hub). La promesa comercial es más
  grande que el mecanismo documentado; Pedro ya hace más que eso en LAN.
- **Turso** default "first to sync wins" vs todo lo anterior. Para dinero, es el default equivocado.

### Lo que no pude verificar (y no afirmo)

- Claims de la patente US 11151536 (PDF sin texto).
- Mecanismo interno de Lightspeed y Shopify (no publican).
- Licencia exacta del PowerSync Service leída del repo (la FAQ no la trae; me baso en su propio blog:
  FSL server, Apache/MIT SDKs).
- Contenido del hilo de HN sobre Realm (429).
- Que Pedro hoy carezca de flag de replay para efectos, o de check de elegibilidad — están marcados
  "no verificado en código" y son lo primero que hay que abrir en `git show origin/main`.

---

*Verificado 2026-09-17 contra las URLs citadas. Este documento no modifica código ni es una decisión;
es insumo para el diseño del outbox v2.2 y de Pedro fase 2.*
