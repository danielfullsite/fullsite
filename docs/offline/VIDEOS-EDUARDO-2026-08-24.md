# Los videos de Eduardo (AMALAY, 2026-08-24) — qué decían, qué hay hoy, cómo se probó

> **Qué es esto.** Eduardo grabó la prueba offline del 24 de agosto con tres terminales.
> Daniel pegó la transcripción en el hilo el 2026-09-09 con una instrucción: *«hay que ver
> que tenemos ahorita y certificar las pruebas aquí»*. Este documento separa la transcripción
> en defectos, dice qué commit cubre cada uno HOY, y registra cómo se reprodujo cada escenario
> con los botones reales en tres procesos Electron sin internet.
>
> **Qué NO es.** No es una certificación. La matriz ([`TEST-MATRIX.md`](TEST-MATRIX.md)) pide
> ejecución física en AMALAY —huella, impresora, router de verdad— y sigue en 0 de 26. Esto
> mueve la columna **probado**, que es lo que una computadora puede mover.

## Fuentes

| Fuente | Dónde | Nota |
|---|---|---|
| Transcripción de los videos | Pegada por Daniel en el hilo, 2026-09-09 | Texto literal en §1. Los videos mismos no están en el repo |
| Entorno del 24-ago | [`EVIDENCIA-CAMPO-AMALAY-2026-08-24.md`](EVIDENCIA-CAMPO-AMALAY-2026-08-24.md) §1 | POS 1.3.3, KDS 1.3.8→1.3.11, `SERVER1` 192.168.1.71. Esa evidencia es de la madrugada y de UNA terminal; los videos son de después, con tres |
| Laboratorio | [`electron-app/lab/videos-de-eduardo-ui.cjs`](../../electron-app/lab/videos-de-eduardo-ui.cjs) | Se llama desde `laboratorio-ui-multiterminal.cjs` en modo legacy, que es como se instala AMALAY (`localAuthorityEnabled` apagado, [`AMALAY-INSTALACION-CANDIDATO-2026-09-05.md`](AMALAY-INSTALACION-CANDIDATO-2026-09-05.md) §22) |
| Evidencia de cada corrida | `output/closure/ui/` (no versionado) | `results.json`, capturas `eduardo-*.png`, `<terminal>.log` |

## 1. La transcripción, literal

> Un poquito, poquito lento. Se visualizan los montos de las cuentas, pero al abrirlos no
> están. 90 que tenía el conflicto del matcha. Ya no está. Pero en el otro punto de venta
> parecía. marca un montón de 684., pero al abrirla solo tenemos 220 pesos. La cuenta 43 me ha
> un monto 682 y al abrir Lucía y 682. Esta cuenta marca de 93 por fuera por dentro, perdón. Y
> por fuera 416. Hay un poco de inconsistencia en los montos de las cuentas. Ojo. Estas
> cuentas ya no deberían estar. Cuenta de 684. ¿La abres? 220. Modo offline un poco lento,
> pero solo un poco. Esta cuenta marca 393 en el interior, pero por fuera. Cuatro16. Las
> cuentas nueve y ocho, yo las abrí y traen montos de 90 por unos chilaquiles que yo mismo
> marqué, pero al abrirlas. No aparece nada. Aquí la cuenta de 684 aparecen ceros. Y esta
> cuenta número 43 con 682 pesos al abrirla también aparece en ceros. En el punto de venta del
> cuarto de servicio, la cuenta ocho la pagué previamente desde el punto de venta de caja, pero
> aquí al abrirla, desde fuera se visualan ceros, y aquí marca dos 90. Se marcó una cerveza en
> la mesa nueve, esa mesa que debió cerrarse porque se pagó antes de las pruebas Offling.
> Marqué una cerveza lager, sigue manejando los 290 pesos, pero al abrirla, aparece en 59, o
> sea, si somos 60 pesos de lager, pero en la visualización exterior, no se puede ver. El
> monto. En punto de venta caja, se en todas las comandas en ceros. Pero al abrirla sí se
> pueden ver platillos y cuentas. Estas cuentas, yo las pagué previamente aquí. Voy a pagar la
> cuenta La cuenta se cobra correctamente. Aparecen ceros. Pero si vuelves a ingresar, hay un
> platillo. Y se puede volver a cobrar.

## 2. Cinco defectos, no uno

La transcripción mezcla cinco cosas distintas. Se separan porque tienen causas distintas y se
cerraron en commits distintos. La columna «hoy» se verificó contra el código de `origin/main`
en `57610d6e` (2026-09-09), no contra memoria.

| # | Palabras de Eduardo | Qué era en la build del 24-ago | Qué hay hoy | Dónde está probado |
|---|---|---|---|---|
| **1** | «marca 684, pero al abrirla solo tenemos 220» · «393 en el interior, por fuera 416» | **Dos verdades.** El mapa leía Supabase (`status=in.(...)`) y el editor leía Supabase + `localStorage.pos_order_N`. Sin internet, cada uno mostraba lo último que había alcanzado a ver. | Mapa y editor leen del **mismo Pedro**: `mesas/page.tsx:295` (`leerSalon` → `debeUsarPedro`) y `pos/page.tsx:2363-2470` (`leerCuenta`). Commits `365eaf22` (H3, 09-03) y `a32b484a` (09-04). | Lab «Video 1» ×2: mapa idéntico en Caja, POS 2 y POS 3; «por dentro» = «por fuera». PASS en las corridas 1-6 |
| **2** | «Estas cuentas ya no deberían estar» · «la cuenta ocho la pagué previamente desde caja» | El POS no emitía `ORDER_CLOSED`: cocina, barra y plano escuchaban un evento que nadie mandaba. | `lib/aviso-lan.ts` (`444fd222`, 09-02): el cobro avisa a la LAN en las dos salidas. Pedro libera la mesa (`state.js:253` `_applyOrderClosed`). | Lab «Video 2»: la mesa cobrada desaparece del mapa de las tres terminales, sin ceros. PASS corridas 5-6 |
| **3** | «La cuenta se cobra correctamente. Aparecen ceros. Pero si vuelves a ingresar, hay un platillo. Y se puede volver a cobrar.» | **Tres causas distintas**, ver §3. Dos ya estaban cerradas; la tercera **seguía abierta hasta esta rama**. | (a) caché `pos_cuenta_*` limpiada al cobrar — `18eff681` (09-06) · (b) la orden madre de un split se marca `dividida` — `e2e8f621` (09-08) · (c) **aviso de cierre durable — esta rama** | Lab «Video 3» ×4 incluido el adversarial. Ver §3 |
| **4** | «Las cuentas nueve y ocho... traen montos de 90 por unos chilaquiles, pero al abrirlas no aparece nada» | El editor sólo miraba Supabase y su `localStorage`: una terminal que nunca abrió esa mesa la veía ocupada y la abría vacía. | `leerOrdenDeMesa()` consulta a Caja **antes** del caché local — `a040a2f0` (09-04). Pedro ya mandaba los platillos; el cliente los tiraba al traducir. | Lab «Video 4»: POS 2 captura y **envía con el botón real**; POS 3 abre esa mesa y ve el platillo con «Cobrar» encendido. PASS corridas 2-6 |
| **5** | «En punto de venta caja, todas las comandas en ceros. Pero al abrirla sí se pueden ver platillos» | El Pedro de entonces sólo publicaba ocupación (`ocupacionLegacy`, `pedro-cliente.ts:32`): `{id, mesa, status}` sin `total` → el mapa pintaba `$0.00`. | `salon_orders` lleva la orden completa con `total` y `saldo` (`state.js:506`, `a32b484a`). El `ORDER_SENT` real del POS lleva `total`, `subtotal`, `iva`, `order_revision` (`pos/page.tsx:3534-3546`). | Lab «Video 4»: el `ORDER_SENT` que sale del botón real llega a Caja con `total=58`, `saldo=58`, `order_revision=0`; el mapa de las tres terminales pinta `$58.00` y ninguna pinta `$0.00`. PASS corridas 2-6 |

**Los cinco tienen la misma forma:** cada pantalla leía de una fuente distinta y la LAN no
llevaba los hechos que importan. Los arreglos posteriores al 24-ago pusieron a todas las
pantallas a leer del mismo Pedro. Lo que faltaba —y es lo que esta rama cierra— es que el
hecho «esta mesa ya se cobró» **llegue siempre**, no sólo cuando la LAN contesta en 1.2 s.

## 3. El doble cobro: las tres puertas

«Se puede volver a cobrar» tiene tres puertas. Las dos primeras estaban cerradas antes de
esta rama; la tercera no.

### 3a. La caché de la mesa sobrevivía al cobro — cerrada en `18eff681`

`pos_cuenta_<tenant>_mesa:N` guardaba `confirmed.id` de la orden liquidada. Al reabrir, el
editor readoptaba esa identidad, pintaba sus platillos, y la lectura devolvía «cerrada» para
siempre. Cerrado con `lib/cache-de-cuenta.ts` y `mesa-cobrada-se-libera.test.ts` (6/6).

### 3b. La orden madre de un split quedaba `enviada` con el total completo — cerrada en `e2e8f621`

Cobrar la última cuenta de una división no le escribía nada a la madre; el mapa la seguía
pidiendo por `status=in.(enviada,...)` y quien la tocara la cobraba otra vez. Cerrado
marcándola `dividida` por `saveOrder` (idempotencia y OCC heredadas).

### 3c. El aviso de cierre se perdía para siempre — **cerrada en esta rama**

Lo que quedaba, dicho con el código en la mano:

| Eslabón | Cita | Consecuencia |
|---|---|---|
| El aviso es «dispara y olvida» con 1.2 s de tope | `lib/aviso-lan.ts` `TIMEOUT_MS = 1_200`; `pos/page.tsx:3906` y `:4007` hacen `void avisarCierreDeOrden(...)` | Un solo intento. Si falla, se pierde |
| El reenvío de una terminal secundaria a la caja es de paso | `local-server/index.js:403-417`: `forwardPost` → si falla, `502` y nada guardado | Si la caja no contesta en ese instante, el aviso muere ahí |
| La nube no rescata | `core/state.js` `_applyStateSync`: `:349` `if (!o._from_cloud) return !cancelled(o)` y `:405` `if (existing && !existing._from_cloud) continue` | Una orden que nació en una terminal (todas las de `ORDER_SENT`) es invisible al poll: ni la ausencia ni una fila `cerrada` en nube la tocan |
| Pedro sigue creyendo que la mesa debe dinero | `toSnapshot`: `salon_orders = ... !settled(o)` | El mapa la pinta ocupada con su total; el lector de un segundo readopta la orden; «Cobrar» se enciende |

Cuándo se pierde ese aviso en un restaurante: la caja acaba de cambiar de IP (T-09 — la
terminal tarda ~18 s en encontrarla), el WiFi parpadea, Pedro de la caja se está reiniciando.
Nada exótico. Y el dinero:

- **Con internet**, el segundo cobro lo rechaza `r1_save_order` por revisión — pero el
  cajero ve «Orden modificada por otra terminal» con el cliente enfrente y el efectivo ya
  en la mano.
- **Sin internet**, el segundo cobro entra a la cola como `OFFLINE_QUEUED`: imprime ticket,
  abre cajón, «cobro guardado localmente». Al reconectar, la revisión lo rechaza y ese
  segundo cobro desaparece de la nube. El cliente pagó dos veces; el arqueo sale con
  sobrante y nadie sabe de dónde.

**El arreglo** (`lib/aviso-lan.ts`, capa web, viaja por Vercel): el aviso se guarda en
`localStorage.pos_avisos_lan_pendientes` **antes** de mandarse; si Pedro lo acepta se olvida,
si no, un temporizador lo reintenta cada 3 s con el **mismo `command_id`** (Pedro deduplica).
`pos/layout.tsx` enciende ese temporizador al montar, porque el cobro navega al mapa con una
navegación completa y el módulo que falló muere con la página. La regla original se
conserva: un aviso jamás frena un cobro.

### 3d. La pantalla que cobró seguía pintando el platillo — encontrada por el adversarial, cerrada en esta rama

Al arreglar 3c apareció la otra mitad (corrida 6): cuando el aviso llega tarde y Caja libera
la mesa, el lector de un segundo detecta «cerrada» y `olvidarCuentaCerrada('cerrada-en-caja')`
limpia la **caché** correctamente (`lib/cache-de-cuenta.ts` conserva sólo lo tecleado aquí
que no estaba en la cuenta cerrada) — pero la **pantalla** conservaba los platillos de la
cuenta liquidada con «Cobrar» a la vista (apagado por `cuentaCajaBloqueada`, pero a la
vista) hasta que alguien saliera al salón. Ahora la rama «cerrada» pinta exactamente lo que
la caché conserva (`pos/page.tsx`, `setOrderItems(propios)`), y el aviso distingue «vuelve al
salón» de «conservamos lo que tecleaste».

**Lo que NO se cambió, a propósito:** Pedro. Que `_applyStateSync` acepte una fila `cerrada`
en nube como recibo de una orden local sería la segunda cerradura (una fila presente que
dice `cerrada` no es «ausencia»), pero es cambio de instalador y de contrato
([`CONTRATO-LECTURA-CUENTAS.md`](CONTRATO-LECTURA-CUENTAS.md)); va en su propio PR con el
lote de `local-server` que ya exige instalador (T-09).

## 4. Cómo se probó

`laboratorio-ui-multiterminal.cjs` en modo legacy: Next sirve el POS real; Caja, POS 2, POS 3
y Cocina son cuatro procesos Electron con su Pedro cada uno; la «nube» es un stub local y se
corta (`wan = false`) antes de los escenarios de Eduardo. Los escenarios nuevos aprietan los
botones que apretó él —Bebidas → Café → Caliente → Agregar → **Enviar**; **Cobrar** → Confirmar
y cobrar → **Efectivo** → Exacto → Cobrar— y miran el mapa de las tres pantallas y el `/state`
de Caja.

| Escenario | Qué exige |
|---|---|
| Video 1 — mapa | Mesa 1 `$116.00`, mesa 2 `$20.00`, mesa 3 libre, en Caja, POS 2 y POS 3; ningún tile pinta `$0.00` |
| Video 1 — por dentro | POS 3 abre la mesa 1 y ve `Café de laboratorio` y `116.00` |
| Video 4 — Enviar real | POS 2 captura y envía la mesa 3 sin internet; Caja la recibe con `total=58`, `saldo=58`, `order_revision=0`, 1 platillo |
| Video 4 — mapa y cocina | `$58.00` en las tres pantallas, nunca `$0.00`; dos comandas de café en cocina |
| Video 4 — otra terminal | POS 3 abre la mesa 3 que capturó POS 2: ve el platillo, `58.00`, y «Cobrar» encendido |
| Video 3 — cobrar | POS 3 cobra la mesa 1 en efectivo sin internet; Caja la libera (`mesas['1'].status === 'libre'`, fuera de `salon_orders`); la pantalla no deja platillos |
| Video 2 — desaparece | Mesa 1 libre («4 lug.», sin `$`) en las tres pantallas; mesas 2 y 3 siguen con su total |
| Video 3 — reabrir | POS 3 y POS 2 reabren la mesa 1: vacía («Toca un producto para agregar»), sin `Café`, sin `116`, sin forma de cobrar; la caché no conserva la identidad liquidada |
| Video 3 — cola | La `sync_queue` de POS 3 tiene **un** solo `cerrada` de esa orden; Caja conserva la comanda como `pagada`, `saldo 0` (D2, ADR-005) |
| Video 3 — adversarial | Se pierde SÓLO el `ORDER_CLOSED` de POS 3 al cobrar la mesa 3. Premisa: Caja la sigue viendo ocupada y la pantalla vuelve a pintar el platillo (la puerta). Al volver la LAN, **sin tocar nada**, Caja libera la mesa 3 en ≤ 30 s y las tres pantallas la ven libre |

### Corridas del 2026-09-10 (máquina de Daniel, Next dev, 4 Electron)

| Corrida | Código | Resultado | Qué se aprendió |
|---|---|---|---|
| 1 | main + escenarios | 8/9 | Video 1 (mapa) PASS. Falló «por dentro» porque POS 3 mostraba «Ingresa tu PIN para abrir» |
| 2 | + diagnóstico del escondite | 12/13 | Videos 1 y 4 PASS. Falló «Efectivo»: hay dos botones con ese nombre (esmeralda = flujo con cambio; morado = forma de pago del catálogo) |
| 3 | + botón correcto | 12/13 | Falló abrir la mesa: el clic cayó antes de la hidratación (32 lecturas de URL sin cambio) |
| 4 | + espera de hidratación, + adversarial, **sin arreglo** | 2/3 | Falló un escenario **preexistente** («POS 3 abre los productos») por el mismo escondite falso: Next sirve el layout con `unlocked=false` y la sesión sembrada la restaura un efecto tras hidratar; con la máquina cargada eso tarda > 20 s |
| 5 | + `esperarHidratacion` tras cada `goto`, **con arreglo** | 14/15 | Videos 1, 4, 3 (cobrar) y 2 (desaparece) PASS. Falló «reabrir» por la aserción, no por el producto: con la cuenta vacía el POS no pinta el botón «Cobrar» (es mejor que apagado) |
| 6 | + aserción corregida, **con arreglo** | 16/17 | Reabrir y cola PASS. **El adversarial demostró las dos mitades**: el aviso perdido se reintentó solo y Caja liberó la mesa 3 (la `until` pasó) — pero la pantalla de POS 3 seguía pintando el café cobrado con «Cobrar» a la vista (apagado) y el aviso «Esta cuenta ya se cerró en Caja». La caché se limpiaba (18eff681); la pantalla no |
| 7 | + al detectar «cerrada», la pantalla pinta sólo lo que la caché conserva | 17/18 | **Los diez escenarios de Eduardo PASS**, incluido el adversarial completo: el aviso perdido se reintentó solo, Caja liberó la mesa 3 en < 30 s, la pantalla quedó limpia y las tres pantallas la vieron libre. Falló un escenario preexistente posterior («Al apagarse Caja, POS 2 muestra...») por el escondite falso otra vez: era el único `goto` que todavía no esperaba hidratación |
| 8 | + hidratación esperada en ese `goto` | **19/19** | Los 9 escenarios originales del laboratorio y los 10 de Eduardo, en verde, en una sola corrida |

**A/B de las unitarias contra el `aviso-lan.ts` anterior** (stash del archivo, misma prueba):
18 de 18 en rojo — el módulo viejo no tiene almacén ni reintentos, y la primera («sin LAN el
aviso queda pendiente en disco») falla por comportamiento, no por importación. Restaurado y
verificado contra el diff de respaldo.

El «escondite falso» de las corridas 1 y 4 **no es un defecto del producto**: es el HTML de
servidor del layout antes de hidratar. En una terminal real con el paquete instalado no hay
Next dev compilando. Pero era un defecto del instrumento: una aserción de 20 s sobre el
cuerpo de la página leía la pantalla del PIN y concluía «la terminal se bloqueó». Ahora todo
`goto` espera a que algún botón tenga su `onClick` colgado.

### Pruebas unitarias

`src/__tests__/el-aviso-de-cierre-se-reintenta.test.ts`, 17/17: sin LAN queda pendiente; un
502 del reenvío también; entregado no queda nada; se guarda ANTES de mandar; el reintento
entrega y olvida con el mismo `command_id`; si vuelve a fallar sigue pendiente; dos taps una
entrada; varios en orden; pasadas solapadas no duplican; tope de 200 conserva los recientes;
el temporizador arranca al fallar, entrega al siguiente tic y se apaga al vaciarse; sigue
mientras falle; sin pendientes no arranca; con pendientes de una sesión anterior los reintenta;
almacén corrupto = vacío; entrada sin `order_id` se ignora; el layout enciende los reintentos.

Las 25 pruebas previas de `aviso-cierre-a-la-lan.test.ts` y `el-aviso-de-huerfanas-se-apaga-solo.test.ts`
siguen verdes: la regla «un aviso jamás frena un cobro» no se tocó.

## 5. Estado, con el vocabulario del protocolo

| Capacidad | Estado | Falta para el siguiente escalón |
|---|---|---|
| Mapa y editor leen la misma verdad (1, 4, 5) | **probado localmente** (lab, 3 terminales, sin internet) | Validar en AMALAY con las tres máquinas reales |
| La mesa cobrada se libera en todas las pantallas (2) | **probado localmente** | Igual |
| Doble cobro por caché (3a) y por split (3b) | **probado localmente** (pruebas unitarias + lab) | Igual; el split offline sigue siendo limitación documentada (`pos/page.tsx:3900`) |
| Doble cobro por aviso perdido (3c) | **implementado + probado localmente** (17 unitarias + lab adversarial) | Deploy a Vercel; en AMALAY, cobrar con la caja desconectada 10 s y ver que la mesa se libera sola al reconectar |
| Segunda cerradura en Pedro (nube `cerrada` → orden local) | **no implementado** | PR propio en `local-server`, con instalador |
| Certificación física (matriz) | **0 de 26** | Un turno en AMALAY con huella, impresora y router |

## 6. Lo que sigue abierto y no se toca aquí

- **Pedro ignora una fila `cerrada` en nube para órdenes locales** (§3c, segunda cerradura).
- **Split sin internet**: la salida `OFFLINE_QUEUED` resetea la división completa
  (`pos/page.tsx:3900-3906`, «LIMITACIÓN CONOCIDA»). No es el video de Eduardo, pero es la
  misma familia y sigue documentado como muro 2.
- **El ticket sin impresora** aparece como «1 comanda sin imprimir · Reintentar» en el lab
  (esperado: no hay impresora). En AMALAY hay que ver que sí imprime — matriz T-17/T-18.
- **`ocupacionLegacy`** (`pedro-cliente.ts:32`) sigue existiendo para un Pedro viejo que no
  publica `salon_orders`; con ese Pedro el mapa VUELVE a pintar `$0.00`. Es exactamente por
  lo que el instalador nuevo tiene que llegar a las tres máquinas, no sólo a la caja.
