# Barrido 3 — lente CONCURRENCIA MULTI-TERMINAL (3 POS + KDS)

Base: `origin/main` f9f8965c, worktree `wt-barrido3`. Sólo lectura del repo; las
reproducciones viven en `/tmp/rep3/`.
No se repiten hallazgos ya corregidos en `docs/audit/BARRIDO-2026-09-10.md`.

Estado del vocabulario del repo: todo lo de abajo está **reproducido localmente**
con código real. Nada está validado en campo.

---

### [P0] El hub puede mandar un DELTA ANTES del SNAPSHOT; la secundaria lo lee como «la Caja reinició su historia» y re-entrega las comandas

`electron-app/local-server/core/ws-hub.js:151-171` (el cliente entra a `_clients`
antes de los `await`) · `electron-app/local-server/core/ws-hub.js:216-226`
(`broadcast` sella el sobre con `getLastSequence()`, no con `event.sequence`) ·
`electron-app/local-server/core/enlace-con-caja.js:206-213`
(`secuenciaRetrocedio` → `cursor = -1`) · `.../enlace-con-caja.js:227`
(los deltas se aplican DESPUÉS del reset).

**confianza: 0.9** (las dos mitades reproducidas por separado con código real).

**escenario.** Se reinicia la Caja a media operación (o se cae el AP 20 s) y las
tres terminales reconectan a la vez. Mientras el hub atiende el `SUBSCRIBE` de
POS-2 —entre `await getLastSequence()` y `await readAfter(cursor)`— POS-1 manda
una comanda. El hub ya tiene a POS-2 en `_clients`, así que el `broadcast` del
evento nuevo **sale antes** del SNAPSHOT que todavía se está armando. POS-2
recibe `DELTA(seq 101)` y luego `SNAPSHOT(sequence 100)`.

En `enlace-con-caja` ese orden dispara la heurística de «la Caja reinstalada»:
`msg.sequence < cursor` ⇒ `cursor = -1`. Y como el reset ocurre **antes** del
bucle `for (const ev of deltas) aplicar(ev)`, todos los deltas del catch-up
—que ya habían llegado como DELTA— se vuelven a entregar.

`alRecibirEvento` (index.js:1169-1174) hace `state.apply(ev)` **y**
`wsHub.broadcast(ev)`: la comanda se aplica dos veces al estado de esa terminal y
se re-transmite dos veces a su cocina, barra y plano.

**reproducción.**

```
cd /tmp/rep3 && node --test orden.test.js dup.test.js
```

- `orden.test.js` A — `WsHub` real + cliente `ws` real. Se retiene el primer
  `readAfter` y se hace `broadcast` durante la espera. Salida observada:
  `orden recibida: [ 'DELTA', 'SNAPSHOT' ] seqs: [ 101, 100 ]`. **PASA** (o sea:
  el orden invertido ocurre de verdad).
- `orden.test.js` B — `conectarConLaCaja` real con WS inyectado. Tras
  `DELTA(101)` + `SNAPSHOT(100)`: `la caja reinició su historia (secuencia 100 <
  cursor 101); se reinicia el cursor`; `cursor final: 100` (retrocedió).
- `dup.test.js` C — mismo enlace, dos eventos en vuelo. Entregados:
  `[ 'e100', 'e101', 'e100', 'e101' ]`. **FALLA contra el código actual** — que es
  el punto: cada comanda llega dos veces a la cocina de esa terminal.

**fix mínimo.** Dos líneas, independientes y ambas necesarias:

1. `ws-hub.js` — armar el SNAPSHOT **antes** de registrar al cliente en
   `_clients` (mover el `this._clients.set(...)` después de los dos `await`, o
   encolar los DELTAs que lleguen durante la ventana y vaciarlos justo después
   del `ws.send(SNAPSHOT)`).
2. `ws-hub.js:218` — sellar el sobre del DELTA con `event.sequence` cuando exista
   (`const seq = Number.isInteger(event?.sequence) ? event.sequence : await this._getLastSeq()`),
   para que el número del sobre no pueda ir por delante ni por detrás del evento.

Refuerzo barato en `enlace-con-caja.js:213`: mover el reset de cursor a **después**
del bucle de deltas, y exigir las DOS señales (identidad distinta **o** retroceso
mayor que el tamaño del catch-up) antes de declarar historia nueva.

**refutación intentada.** ¿Se salva porque `getState()` se evalúa al hacer
`ws.send`, es decir ya con el evento 101 aplicado? Sí, el ESTADO llega completo —
por eso no es pérdida de datos sino **duplicación**. ¿Se salva porque el POS
serializa comandos? No: la serialización es del `CommandHandler`, no del handler
de `SUBSCRIBE` del hub; son dos cadenas distintas. ¿Es sólo teórico? El escenario
es «reinicio de Caja a media operación», que es un renglón explícito de la matriz.

---

### [P1] `kds_item_status` es un mapa completo sin revisión: dos pantallas de cocina se pisan las marcas (modo legacy, el que corre AMALAY)

`dashboard-app/src/app/kds/page.tsx:300-308` (se construye el mapa ENTERO desde
el `Set` local y se manda completo) · `.../kds/page.tsx:317` (el mismo mapa
completo va por PATCH a `pos_orders`) ·
`electron-app/local-server/core/state.js:433-443` (`_applyKdsItemStatus`
reemplaza la cadena entera) · `dashboard-app/src/hooks/useKdsWsClient.ts:188-199`
(el DELTA también reemplaza el mapa entero).

**confianza: 0.8**

**escenario.** «Cocina marca lista mientras entra otra ronda», con dos pantallas
(cocina y barra, o dos bumpers de cocina) sobre la misma orden. KDS-A marca el
renglón 0; KDS-B, en la misma ventana de ida y vuelta, marca el renglón 1. B
construye `kdsStatus` desde su `doneItems` local, que todavía no tiene el 0, así
que escribe `{0:false, 1:true}` — y como nadie fusiona, la marca de A se borra.
El cocinero ve el renglón re-encenderse. El mismo mapa pisa también la fila de
`pos_orders` en la nube.

La ventana no es de milisegundos: `doneItems` sólo se reconstruye cuando llega
el siguiente `orders` (`kds/page.tsx:131-154`, `setDoneItems(restored)`), o sea
tras el round-trip del DELTA. Con WAN caído y la Caja ocupada, son segundos.

Contraste que confirma que es un hueco y no una decisión: el camino de Caja SÍ
tiene control de concurrencia — `KITCHEN_SET` exige `expected_kitchen_revision`
y falla con `KITCHEN_REVISION_CONFLICT`
(`electron-app/local-server/core/operational-domain.js:156`). El camino legacy no
tiene ninguno, y legacy es lo que hay instalado hoy.

**reproducción.** No se ejecutó E2E de navegador (fuera de presupuesto). La
lectura del código es directa: no existe `expected_*` ni merge en ninguno de los
cuatro puntos citados; `_applyKdsItemStatus` hace
`this._orders.set(order_id, { ...order, kds_item_status: <cadena recibida> })`.
Para verlo sin navegador basta aplicar dos `KDS_ITEM_STATUS` seguidos con mapas
disjuntos contra `RestaurantState` y leer el resultado.

**fix mínimo.** Que el comando lleve sólo el delta (`{ idx, done }`) y que
`_applyKdsItemStatus` lo fusione sobre el mapa guardado, en vez de reemplazarlo.
Es aditivo y no rompe el protocolo viejo: si viene `kds_item_status` completo se
reemplaza como hoy; si viene `kds_item_delta` se fusiona.

---

### [P1] En una terminal secundaria, el sobre del DELTA lleva la secuencia del log LOCAL, no la de la Caja

`electron-app/local-server/index.js:1173` (`wsHub.broadcast(ev)` re-transmite el
evento de la Caja) · `electron-app/local-server/core/ws-hub.js:218`
(`const seq = await this._getLastSeq()` — el de ESTA terminal) ·
`dashboard-app/src/hooks/useKdsWsClient.ts:317`
(`applyEvent({ ...event, sequence: msg.sequence })` pisa la secuencia real del
evento con la del sobre) · `.../useKdsWsClient.ts:206-208` (`saveSeq` la
persiste en `localStorage`).

**confianza: 0.75**

**escenario.** Una secundaria no commitea nada en su propio log —todo se reenvía
a la Caja (`index.js:963-975`)— así que su `getLastSequence()` es un número casi
fijo y bajo. Cada comanda que la secundaria relaya a su cocina sale sellada con
ese número. El KDS del navegador lo guarda como su `kds_last_sequence` y lo manda
en el siguiente `SUBSCRIBE`.

Consecuencia concreta: el cursor del KDS de una secundaria no avanza nunca, así
que su ventana de catch-up por deltas no existe — depende por completo de que el
SNAPSHOT del estado venga bien. Y el `sequence` real del evento de la Caja, que
sí viaja dentro de `payload.event.sequence`, se descarta a propósito en la línea
317 del hook.

**refutación intentada.** ¿Rompe algo hoy? No de forma visible: el KDS deduplica
por `event.id` (`useKdsWsClient.ts:136-139`) y el SNAPSHOT reconstruye el tablero
entero. Por eso queda en P1 y no en P0. Lo que sí es: un número que miente y en
el que descansa la recuperación.

**fix mínimo.** En `ws-hub.js:218` usar `event.sequence` cuando venga (mismo fix
que el punto 2 del P0 de arriba), y en `useKdsWsClient.ts:317` preferir
`event.sequence ?? msg.sequence` en vez de pisarla siempre.

---

### [P2] El vencimiento del lock de mesa lo fija el reloj del cliente

`electron-app/local-server/core/state.js:449`
(`expires_ms: expires_ms || Date.now() + 30_000` — `expires_ms` viene del
payload) · `electron-app/local-server/core/command-handler.js:262-267`
(el conflicto se decide con `existingLock.expires_ms > Date.now()`, reloj de la
Caja) · `.../core/state.js:637-643` (`gcLocks`, mismo reloj).

**confianza: 0.8** de que el código es así; **0.7** de que importe hoy (ver abajo).

**escenario.** «Relojes distintos» de la matriz. Tres Windows en una LAN sin
internet no sincronizan NTP. Una terminal adelantada 10 min manda
`expires_ms = su Date.now() + 30s`; la Caja lo guarda tal cual y esa mesa queda
bloqueada diez minutos y medio. Una atrasada manda un `expires_ms` ya vencido y
su lock no protege nada.

Además el lock se guarda con `payload.client_id` (`state.js:449`) pero el
conflicto se compara contra `fromClientId` (`command-handler.js:265`), que en el
reenvío HTTP de una secundaria es `req.headers['x-fullsite-terminal']`
(`index.js:684`). Si los dos no coinciden, una terminal no puede ni refrescar su
propio lock.

**reproducción.** No se ejecutó, y por una razón que cambia la prioridad: **hoy
ningún cliente emite `MESA_LOCK`.** `rg -n "MESA_LOCK" dashboard-app/src` sólo
devuelve `pos/plano/page.tsx:216`, donde aparece en una lista de tipos que se
ESCUCHAN. O sea que el mecanismo de exclusión mutua entre POS sobre una misma
mesa está construido en Pedro y no lo usa nadie.

**fix mínimo.** Que la Caja fije el vencimiento con su propio reloj
(`expires_ms: Date.now() + LOCK_EXPIRY_MS`, ignorando el del payload) y que el
lock se guarde con el mismo identificador con el que se compara (`fromClientId`).
Aparte, decidir si el lock se conecta o se borra: dejarlo a medias hace que
«locks de mesa que no expiran» sea imposible de razonar.

---

## Descartados

- **`CommandHandler.handle` no serializa suficiente.** Se revisó
  (`command-handler.js:57-62`): la cadena `this._commands` cubre
  leer/validar/commitear/proyectar, y `_enVuelo` en `event-store.js:38-50`
  cubre dos reintentos simultáneos del MISMO `command_id`. **Mismo `command_id`
  desde dos terminales**: `sameCommand` compara contenido y lanza
  `IDEMPOTENCY_KEY_REUSED` si difiere. Correcto.
- **Split cobrado desde dos terminales / una cobra mientras otra agrega.**
  `financial-domain.js:101-121` y `operational-domain.js:181-189` exigen
  `expected_revision`, `expected_financial_revision` y `expected_kitchen_revision`;
  la segunda terminal recibe `ORDER_REVISION_CONFLICT` /
  `FINANCIAL_REVISION_CONFLICT`. Falla cerrado. Sin hallazgo.
- **Dos POS mueven dos órdenes a la misma mesa libre.** `checkTable`
  (`operational-domain.js:36-40`) corre dentro de la cadena serializada y ve el
  estado ya proyectado del comando anterior. Sin hallazgo.
- **Cancelación que llega después del cobro.** `state.js:591-597` sólo cancela
  desde la nube `if (cancelled(row) && !cancelled(existing) && !settled(existing))`.
  Ya cubierto por el barrido del 09-10.
- **`TURNO_CLOSED` con orden en vuelo.** `state.js:193` ignora un `TURNO_CLOSED`
  de otro turno, y `operational-domain.js:139-142` bloquea el cierre con
  `salon_orders` o `kds_orders` vivos. Ya cubierto por el barrido del 09-10.
- **Catch-up con `caja_id` nuevo.** `enlace-con-caja.js:206-211` lo maneja bien
  cuando el `server_id` cambia de verdad; el defecto reportado arriba es el
  FALSO positivo de esa misma heurística, no el caso legítimo.
- **`_sinTransmitir` pierde el broadcast si el POS no reintenta.**
  `command-handler.js:181-186`: un fallo de `_recoverEffect` en un comando NO
  duplicado marca el evento y lo re-lanza; el POS ve `REJECT` sobre algo ya
  commiteado. Depende de que la capa web reintente el mismo `command_id`, y no
  se verificó esa capa. Por debajo del umbral de confianza.
- **Keepalive del hub.** `ws-hub.js:12-24` ya trae la invariante
  `pongTimeout > 2 × pingInterval` verificada en el constructor. Sin hallazgo.
