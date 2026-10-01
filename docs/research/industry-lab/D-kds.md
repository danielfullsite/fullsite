> ⚠️ **ADVERTENCIA DE FIABILIDAD (añadida 2026-09-18).** Este documento lo produjo un agente del
> intento de research en paralelo del 2026-09-17, que **terminó abortado por límite de uso**; varios
> de esos agentes agotaron el presupuesto de búsqueda y degradaron sus fuentes a mitad del trabajo.
> Además, **toda referencia a código de este repo se leyó del working tree `feat/pos-ui-kit`, que
> está 663 commits atrás de `origin/main`** — el mismo error que invalidó un hallazgo del Track A
> (ver `P0B-COMMAND-RECEIPTS.md`). **No fue revisado.** Úsalo como pista, no como fuente. Antes de
> citar cualquier cosa de aquí: verifica la URL, y verifica el código con `git show origin/main:<ruta>`.

# Track D — KDS / Kitchen Operating System

> Sprint de investigación (solo lectura). Fecha: 2026-09-17. Sin código, sin commits.
> Pregunta: ¿qué es "estándar" en un KDS hoy, cuál es la máquina de estados canónica del ticket, cómo
> modelan los vendors el ruteo por estación, y qué le falta a Fullsite para ser estándar — y dónde
> está el diferenciador real?
>
> Método: fuentes primarias (help centers de Toast/Square/Oracle/NCR/Olo/Lightspeed/DoorDash/Uber, una
> patente de QSR Automations, docs de Odoo) + lectura del código propio (`dashboard-app/src/app/pos/cocina/page.tsx`,
> `dashboard-app/src/hooks/useKdsWsClient.ts`, `electron-app/local-server/index.js`). Cada hallazgo va
> marcado **FACT / INFERENCE / RECOMMENDATION**. Nota de alcance: el presupuesto de búsqueda web se
> agotó al final de la sesión; QSR ConnectSmart, PAR Brink y Deliverect quedaron cubiertos sólo por
> páginas de marketing o resúmenes de búsqueda, no por documentación técnica (se marca dónde aplica).

---

## 0. Resumen ejecutivo

1. **El KDS "estándar" en 2026 es bastante uniforme**: tarjeta por envío, ruteo por estación derivado
   del ítem (categoría o etiqueta de estación), pantalla de expo que consolida las estaciones, bump por
   ítem y por ticket, recall, colores por edad del ticket (dos umbrales, típicamente amarillo/rojo),
   conteo "all day", sonido en ticket nuevo/editado/anulado, bump bar USB. Todo eso lo tienen Toast,
   Square, Oracle Simphony, Lightspeed y Fresh; ninguno lo vende como diferenciador.
2. **Lo diferenciador es el tiempo**: cursos con hold & fire, "fire by prep time" (los ítems largos
   salen primero para que todo termine junto), capacidad por estación y **quote times alimentados por
   la carga real de la cocina** (NCR Aloha Kitchen → Aloha Takeout; Olo "Orders-in-Progress"; QSR
   Automations con una patente de 2008 que ya describe el algoritmo completo).
3. **Lo raro** es el ruteo dinámico con balanceo de carga entre estaciones (QSR/Oracle "load balanced"),
   SOS por mesa (Oracle), y "Dynamic Order Mode" (el chit se dibuja mientras el mesero captura, para
   drive-thru).
4. **Fullsite ya tiene el esqueleto correcto** (tarjeta por envío, estación por ítem, ítem/ticket bump,
   umbral de alerta configurable, funciona offline por LAN). Le faltan para ser "estándar": recall
   explícito, indicador de ticket editado/anulado, all-day real por estación, expo que consolide
   estaciones con regla "listo sólo cuando todas las estaciones bumpearon", segundo umbral de color, y
   bump bar. **El diferenciador posible y barato** es el que casi nadie de nuestro segmento hace: quote
   times y prioridad delivery/salón calculados desde el event stream de Pedro (ya tenemos los eventos;
   nadie más en el mercado mexicano de $2–5K MXN/mes los tiene).
5. **No construir**: balanceo dinámico de carga entre estaciones, DOM, robótica de make-line,
   forecasting de bins; ni un motor de cursos completo antes de tener un restaurante que lo pida.

---

## 1. Matriz de features y reglas de corrección

Leyenda: **STD** = lo tienen todos los vendors consultados · **DIF** = lo tienen 2–3, se vende como
ventaja · **RARE** = uno o dos, enterprise. "Fullsite" = estado en `pos/cocina/page.tsx` y `kds/page.tsx`
al 2026-09-17 (working tree `feat/pos-ui-kit`; verificar contra `origin/main` antes de afirmar en prod).

| Capacidad | Clase | Evidencia | Fullsite hoy |
|---|---|---|---|
| Tarjeta por envío (no por mesa) | STD | Toast "ticket time starts at 0:00 when a server sends an order" ([1]); Lightspeed manda un ticket por curso ([12]) | SÍ (`batchSeq`, "tarjeta del envío", KDS-BUILD-JUEVES:51) |
| Ruteo por estación derivado del ítem | STD | Toast prep stations ([2]); Square "kitchen routing categories" ([8]); Odoo "Product categories sent to this display" ([13]); Lightspeed "production centers" ([12]) | PARCIAL: `station: 'cocina'\|'barra'\|'caja'` + fallback por keyword (`resolveItemStation`, línea 41–48) |
| Pantalla de expo que consolida estaciones | STD | Toast "consolidated view of all tickets for the supervised prep station screens" ([3]); Oracle "Expo Display shows all orders for the kitchen" ([5]); Square Expo con "green checkmark" ([9]) | NO (filtro "todo" es un filtro, no un rollup con estado por estación) |
| Bump por ítem y por ticket | STD | Square "Tap an item… / Tap the top banner" ([9]); Toast "Enable individual item fulfillment" ([1]); Odoo "cross them off individually" ([13]) | SÍ (`itemStatus` por ítem + botón de estado por orden) |
| Recall del último bump | STD | Toast bump bar "RECALL LAST" ([4]); Square "Recall at the bottom of the ticket in the completed view" ([9]); Oracle "recalling the last item marked as complete" ([5]) | NO explícito (sólo el tab "Listas" mantiene visibles 4 h) |
| Colores por edad del ticket, ≥2 umbrales | STD | Toast "after 5 minutes… yellow, after 10… orange, after 15… pink" ([1]); Square "Yellow timer and Red timer" ([8]); Oracle "first alert… yellow… second alert… red" en segundos ([6]); Fresh "On-Time/Caution/Late" ([10]) | PARCIAL: un umbral (`alertMinutes`, línea 424) |
| Sonido/flash en ticket nuevo, ítem cambiado, ítem anulado | STD | Toast "Sound notifications when there is a new ticket… an item is changed, and an item is voided" ([1]) | PARCIAL: sonido sólo en nuevas (`newEnviadas`, línea 224–225) |
| "All day" (conteo agregado por ítem pendiente) | STD | Toast "show the all day view" ([1]); Oracle "production item counters" ([5]) | PARCIAL: contador por lote filtrado por estación (línea 518–530); bug cross-station #15 reportado en campo (DEBRIEF-JUL12:184) |
| Ítems idénticos consolidados o no (config) | STD | Toast "Panini with a quantity of two" vs dos líneas ([7]); Square "Combine identical items" ([14]) | NO configurable |
| Modificadores con color / orden configurable | STD | Toast "Modifier display mode / Sort Order / custom background colors… allergen alerts" ([7]); Square "color-coded modifier text" ([8]) | NO |
| Bump bar USB | STD | Toast (KRS bump bars, mapa FULFILL/RECALL LAST/1-10) ([4]); Aloha "StartBin" en bump bar ([11]); PAR "programmable bump bar" | NO |
| Impresora de respaldo cuando el KDS/controlador cae | STD | Oracle "Backup Device… only works when the KDS Controller or Service Host is down" ([6]); Toast "at least one kitchen printer is required" en offline ([15]) | SÍ de facto: comanda impresa por Pedro a fría/caliente sigue viva aunque el KDS muera (DEBRIEF-JUL12:97–104) |
| Runner chit al bumpear (expo → impresora) | DIF | Oracle "Primary Runner Chit Printer… Print on All Prep Done" ([6]) | NO (existe `reprint_comanda` manual, línea 104) |
| Funciona sin internet (hub local) | DIF | Toast "Offline mode with local sync… local hub device… only communicates with devices on its subnet" ([15]); Oracle KDS Controller local; Square: **no documentado** en los artículos leídos | SÍ (Pedro ORDER_SENT por LAN, probado en campo) |
| Cursos: hold & fire, HELD sólo en expo | DIF | Toast "Tickets marked with HELD only appear on the expediter KDS device… fired as soon as the previous course is fulfilled by the expediter" ([16]); Fresh "Hold & Fire status updates in real time across all KDS screens" ([10]); Lightspeed ticket por curso ([12]) | NO (hay `__tiempo__` como marcador de tiempo dentro del envío, línea 764) |
| Fire por prep time (los largos salen primero) | DIF | Toast "a 12-minute steak fires 8 minutes after a 20-minute lobster tail" ([17]); Oracle "items which take longer to prepare should appear… before items with lesser prep times" ([18]); QSR patente ([19]) | NO |
| Timer de "fire" separado del timer de "sent" | DIF | Toast ticket time vs fire time ([20]) | NO |
| Quote time alimentado por carga de cocina | DIF | Aloha "based on the number of items currently cooking… 10 items → 10 min, 50 → 25 min" ([21]); Olo Orders-in-Progress ([22]) | NO |
| Señal "orden lista" a plataformas de delivery | DIF | DoorDash `PATCH …/events/order_ready_for_pickup` ([23]); Uber `pickup_time` en `accept_pos_order` ([24]); Square "Automatic Order Update… Ready status on third-party platforms" ([9]) | NO (bridge Rappi→KDS existe, b5c72c25; no hay ready-back) |
| Capacidad por estación → secuenciación | RARE | Oracle "KDS Capacity Scheduling… items may have to wait to appear on the display if the capacity is currently unavailable" ([18]) | NO |
| Balanceo de carga dinámico entre estaciones | RARE | QSR "Load balancing can be added to any established routing scheme… check box" (marketing) ([25]); Oracle menciona "KDS load balanced systems" ([18]) | NO |
| SOS por mesa (grid de mesas con edad) | RARE | Oracle "SOS Display is divided into a grid, with each cell representing a different table" ([5]) | NO (el plano de mesas del POS es cercano) |
| Dynamic Order Mode (chit vivo mientras se captura) | RARE | Oracle "Order chits update as the order is being entered" ([26]) | NO, y no aplica a salón |
| Bins de producción / forecast | RARE | Aloha simple/production/forecast bins ([11]) | NO |
| Links: bump en una prep bumpea las ligadas | RARE | Oracle "bump/done an order at one prep station and have it simultaneously bump… all linked" ([6]) | NO |

### Reglas de corrección que los vendors hacen explícitas

| Regla | Fuente | Fullsite |
|---|---|---|
| **Un ticket sólo está "listo" cuando todas sus estaciones lo marcaron**; el expo decide, no el cocinero: "the expediter determines when an order is completely fulfilled and ready for service, rather than the cooks" | Toast [3]; Square "tickets move to the front of the Expo queue when all assigned prep stations mark them as complete" [14]; Oracle "Print on All Prep Done" [6] | NO: `status` es por orden, cualquier pantalla puede pasarla a `lista` |
| **Ventana de undo/recall**: Square da 3 s de undo y recall ilimitado desde "completed"; Toast "RECALL LAST"; Oracle "recall last item" | [9], [4], [5] | NO: 4 h visibles en "Listas" no equivale a recall |
| **Bump idempotente bajo doble toque**: Toast tiene ajuste explícito de "double-tap" para evitar bumps accidentales (KDS FAQ menciona "Double-tap settings") | [27] | INFERENCE: `updateOrderStatus` avanza de estado en cada toque (línea 381–383) → un doble toque pasa `enviada→preparando→lista`. Falta guarda |
| **Ticket editado/anulado se señala, no se reemplaza en silencio**: Toast suena y anima en "item is changed / item is voided"; Oracle en DOM tiene "Do Not Display Voids" como opción — o sea, por default los voids **sí** se muestran | [1], [6] | PARCIAL: `ORDER_UPSERTED` reemplaza la orden en el cliente (`useKdsWsClient.ts:157`); no hay marca visual de "editado" |
| **HELD nunca llega a la prep station** | Toast [16] | n/a |
| **El timer arranca al enviar, no al capturar**: "starts counting at 0:00 when a server sends an order to the kitchen" | Toast [20] | SÍ (`sentAt`) |
| **Impresora de respaldo sólo cubre caída del controlador, no de la pantalla apagada** | Oracle [6] | Hoy Fullsite imprime SIEMPRE además del KDS (a fría y caliente): más robusto, más papel |
| **Cocina no cancela** | Spec Eduardo (KDS-BUILD-JUEVES) y coincide con todos los vendors: el KDS no tiene "void"; el void viene del POS | SÍ |

---

## 2. Máquina de estados canónica (síntesis entre vendors)

Dos objetos, no uno. **Ítem** y **ticket** (envío). El ticket deriva su estado de sus ítems y del expo.
Los nombres cambian por vendor (Toast: unfired/fired/fulfilled; Square: open/completed; Oracle:
pending/done/all-prep-done/bumped; Odoo: etapas configurables), la forma no.

```
ÍTEM (por estación)
                       (fire por curso / prep time)
  HELD ──────────────────────────▶ FIRED ────▶ STARTED ────▶ DONE@station
   │  sólo visible en expo,        │  visible   (opcional;    │  bump por ítem
   │  gris/itálica (Toast)         │  en prep   Aloha "Start" │  o por ticket
   │                               │            en bump bar)  │
   │                               ▼                          ▼
   │                            VOIDED ◀── (void desde POS; se muestra tachado / suena)
   │                                                          │
   └── (si el POS nunca lo fira: desaparece)      RECALL ◀────┘  (ventana corta: 3 s undo Square;
                                                                    "recall last" sin límite en Toast/Oracle)

TICKET (envío) — estado DERIVADO
  SENT ──▶ (algún ítem STARTED) IN_PROGRESS ──▶ ALL_PREP_DONE ──▶ EXPO_BUMPED ──▶ SERVED/CLOSED
   │ timer "ticket"  arranca                     │ = todas las estaciones          (runner chit,
   │ timer "fire"    arranca al firear curso     │   asignadas bumpearon           order_ready → delivery)
   ▼                                             │
  EDITED (re-envío sobre el mismo ticket:         └── recall → vuelve a IN_PROGRESS
          Toast suena + animación; Oracle
          muestra voids; ítems nuevos se
          agregan a la MISMA tarjeta o crean
          una segunda según config)

Invariantes:
  I1  ticket.ALL_PREP_DONE  ⇔  ∀ estación asignada: ítems de esa estación DONE
  I2  sólo el expo (o config "complete for all devices") pasa a EXPO_BUMPED
  I3  bump es idempotente: bump(bump(x)) = bump(x); doble toque no salta estados
  I4  recall reabre el ticket en la MISMA posición de edad (el timer no se reinicia)
  I5  void nunca lo inicia el KDS
  I6  un curso N+1 en HELD se firea cuando el expo bumpea el curso N (Toast) o cuando
      el POS lo firea (Fresh/Lightspeed) — dos modelos, ambos válidos
```

**Contradicción registrada.** Square permite configurar "Complete only on this device" ([9]): en ese
modo el invariante I1 no se cumple (cada pantalla tiene su propia verdad del ticket). Toast y Oracle
no ofrecen ese modo; el estado es compartido. Para Fullsite conviene el modelo compartido (Toast/Oracle):
un solo `kds_item_status` por ítem-estación en Pedro, no por pantalla.

---

## 3. Modelo de ruteo (ítem → estación → expo)

Como lo documentan los vendors, en orden de abstracción:

1. **Etiqueta en el ítem, no en la pantalla.** Toast: el ítem o su grupo de menú tiene prep station;
   la pantalla se *asigna* a la prep station ("Assigning a KDS device to a prep station" [2]).
   Square y Odoo: categoría del producto → pantalla ([8], [13]). Lightspeed: *production center* como
   destino abstracto que puede ser impresora o KDS ([12]). **Consecuencia: el mismo ruteo alimenta
   impresora y pantalla** — exactamente lo que Fullsite ya hace con estaciones de impresora
   (`printer.getStations()`), sólo falta que la misma tabla gobierne el KDS.
2. **Un ítem puede ir a varias estaciones** ("burger + fries" → grill y fry). Toast lo modela con
   ítems separados o con "Send to: Prep station and Expediter"; Oracle lo modela por *order device*
   con filtro "All Items / Only Items with Condiments / Only Items without Condiments" ([6]). Ningún
   vendor consultado hace *split* automático de un ítem en sub-tareas por estación; lo que hacen es
   **duplicar la línea** en cada estación y dejar que el expo la reconcilie.
3. **Reglas de re-ruteo por contexto**: Toast "item routing rules… by dining option or service area…
   redirect or duplicate its ticket" ([2]). Ejemplo AMALAY: "Market/Caja: ticket USB, NO KDS"
   (DEBRIEF-JUL12:269 según memoria) es exactamente una regla por dining option.
4. **Tres destinos**: prep only · expo only · prep + expo (Toast [2]). "Bar" típicamente es prep only
   (no pasa por expo); "salsas y cubiertos de para llevar" son expo only.
5. **Expo = rollup.** El expo ve todos los tickets con una señal por estación
   (Toast "visual cues when each prep station cook marks an order or item fulfilled" [3]; Square
   checkmark verde [9]). Oracle añade *Links* (bump en una prep bumpea las ligadas) y *Associations*
   por carril (drive-thru) ([6]).
6. **Capacidad y balanceo (enterprise).** Oracle Capacity Scheduling retiene ítems fuera de pantalla
   hasta que la estación tenga capacidad; excluye expo/SOS y no funciona con DOM ni con balanceo
   ([18]). QSR: la patente US20080319864A1 describe "Forecasted Cook Time + Average Cook Delay Time +
   Trend", verificación de capacidad de la estación antes de arrancar cada ítem con re-chequeo cada
   ~30 s, y objetivo "all items on the order will be targeted to complete… at the same time" ([19]).
   La patente está **abandonada** — el algoritmo es de dominio público en lo que describe.

**Modelo mínimo recomendado para Fullsite (RECOMMENDATION):**

```
menu_item.station_tags   : text[]      -- ['grill','fry']  (hoy: station 'cocina'|'barra'|'caja')
station                  : {id, kind: 'prep'|'expo'|'bar', printer_id?, display_ids[]}
routing_rule (opcional)  : {when: {dining_option|service_area}, then: {add|replace|suppress station}}
kds_item_status          : (order_id, item_id, station_id) → {state, ts, actor}   -- clave TRIPLE
```

La clave triple es el cambio de fondo: hoy `kds_item_status` es `Record<string, boolean>` por orden
(`pos-data.ts:1504`), sin estación. Con estación en la clave, I1 se vuelve una consulta trivial y el
expo se vuelve una vista, no una pantalla nueva.

---

## 4. Fullsite: qué tiene, qué falta para "estándar", dónde está el diferenciador

### 4.1 Confirmado en código (working tree, 2026-09-17)

- Tarjeta por envío con `batchSeq`/`sentAt`; filtro por estación con tres valores fijos + panadería
  por keyword (`pos/cocina/page.tsx:33–48, 85–100`).
- Estados de orden: `enviada → preparando → lista → entregada`, avance lineal por toque (`:381–383`);
  auto-cierre a `entregada` a las 4 h (`:184–186`).
- Estado por ítem `preparando|listo` en `localStorage` + `kds_item_status` JSON en la orden
  (`:438–459`; `pos-data.ts:1504`).
- Un umbral de alerta configurable en minutos, rojo (`:424–431, 704`).
- Sonido sólo en nuevas (`:224–225`). Reimpresión manual de comanda por estación (`:104`).
- Transporte: `ORDER_SENT` durable desde Pedro ("consumed by Electron KDS and printer queues",
  `local-server/index.js:157`), `ORDER_UPSERTED/CLOSED/CANCELLED` por WS (`useKdsWsClient.ts:144–174`),
  fallback a polling cada 2 s (`:724`). Probado sin WAN en campo (KDS-BUILD-JUEVES:54).
- Impresión paralela a fría y caliente como respaldo físico (DEBRIEF-JUL12:97–104).

### 4.2 Faltantes para ser "estándar" (en orden de esfuerzo/valor)

| # | Faltante | Por qué es estándar | Esfuerzo (INFERENCE) |
|---|---|---|---|
| 1 | **Guarda de idempotencia en bump** (doble toque no salta estados) | Toast double-tap setting [27] | Trivial |
| 2 | **Recall explícito** ("regresar última") + undo 3 s | Toast/Square/Oracle | Bajo |
| 3 | **Segundo umbral de color** (amarillo/rojo, defaults 5/10 min, config por estación) | Toast/Square/Oracle/Fresh | Trivial |
| 4 | **Marca "EDITADO"/"CANCELADO" en tarjeta + sonido distinto** cuando llega `ORDER_UPSERTED` con diff | Toast [1] | Bajo |
| 5 | **All-day por estación correcto** (bug #15 de campo) | Toast/Oracle | Bajo |
| 6 | **Estación en la clave de `kds_item_status`** y regla I1 en Pedro | Toast/Square/Oracle | Medio — es el cambio estructural |
| 7 | **Vista expo** = tickets con chip por estación, "listo" sólo por I1, runner chit opcional | Toast/Square/Oracle | Medio (depende de 6) |
| 8 | **Estaciones como datos, no como enum** (`'cocina'\|'barra'\|'caja'` → tabla por tenant) | Multi-tenant §12 | Medio |
| 9 | Bump bar USB (mapa de teclas; los bump bars son teclados HID) | Toast/PAR/Aloha | Bajo, requiere hardware |
| 10 | Modificadores con énfasis (NO/EXTRA/ALERGIA en color) | Toast/Square | Bajo |

### 4.3 Dónde está el diferenciador

**FACT:** Aloha Kitchen calcula el quote time desde "the number of items currently cooking in the
kitchen" ([21]); Olo cobra por "Orders-in-Progress Limits" y muestra al comensal "the minutes required
to make their order plus the number of minutes until capacity is available" ([22]); QSR/Crunchtime
vende throttling como producto ([25]). **FACT:** DoorDash acepta `prep_time` y una señal
`order_ready_for_pickup` que "immediately assigns the closest Dasher available" y reportó "6%
reduction in late Dasher Arrivals" ([23]); Uber acepta `pickup_time` en `accept_pos_order` ([24]).

**INFERENCE:** Fullsite ya tiene el insumo que a Aloha le cuesta un módulo: Pedro guarda cada
`ORDER_SENT` y cada cambio de estado con timestamp en el event store local. Con eso se puede calcular
en LAN, sin nube: (a) tiempo real de preparación por ítem y estación (percentil 50/90 por hora del día),
(b) carga actual = ítems FIRED no DONE por estación, (c) quote time = f(carga, p90 del ítem),
(d) prioridad delivery vs salón = ordenar por `promised_at − p90_restante` en vez de FIFO puro.

**RECOMMENDATION:** el diferenciador es **"la cocina le habla al pedido"**: quote time y `pickup_time`
reales hacia Rappi/Uber/DiDi y hacia la app propia, calculados en Pedro desde el event stream, y la
señal "listo" de vuelta al agregador cuando el expo bumpea. Nadie en el segmento de precio de Fullsite
en México lo hace (INFERENCE: no verificado contra Wansoft/Soft Restaurant docs en esta sesión). La
secuenciación por prep time (Toast "fire by prep time") es la segunda apuesta: se implementa con un
`prep_seconds` por ítem y un retraso de aparición en la estación — y la patente de QSR ya explica el
algoritmo completo, abandonada.

Lo que **no** es diferenciador aunque tiente: cursos elaborados (AMALAY no los pidió; Eduardo pidió
tarjeta por envío y personas), balanceo dinámico entre estaciones (requiere estaciones intercambiables,
raro fuera de QSR de cadena), y forecasting de bins.

---

## 5. Open source reutilizable (GitHub, metadatos via `gh api` 2026-09-17)

| REPO | STARS | LICENSE | LAST_ACTIVE | WHAT_TO_REUSE | RISKS |
|---|---|---|---|---|---|
| `ury-erp/mosaic` (URY Mosaic, sobre ERPNext) | 46 | AGPL-3.0 | 2025-11-04 | Modelo multi-cocina + impresión KOT opcional; UX de tarjeta y estación como referencia | **AGPL**: no copiar código a Fullsite; sólo leer patrones. Acoplado a Frappe |
| `NewPointe/KitchenView` | 13 | MPL-2.0 | 2021-04-01 (**archivado**) | Integración Square OAuth → KDS en TypeScript; ejemplo de consumir órdenes externas | Archivado, Square API vieja |
| `BenClementt/OpenKDS` | 11 | GPL-3.0 | 2023-03-23 | Poco; referencia de UI EJS | GPL, muerto |
| `CephandriusMaxtori/dartKDS` | 1 | ninguna | 2026-09-16 | Arquitectura host/cliente en LAN "No cloud, no subscription, no internet" — validación externa del modelo Pedro | Sin licencia = no reutilizable; 1 estrella |
| `oleggud512/kds` | 0 | ninguna | 2024-07-03 | nada | sin licencia |
| Odoo `pos_preparation_display` (doc [13]) | (Odoo ~40k) | LGPL-3 (core Odoo) | activo | El **modelo de etapas configurables** + "card moves to next stage once every item is crossed off" es el mejor diseño OSS de la máquina de estados; ruteo por categoría de producto | LGPL permite leer y adaptar ideas; código Python/OWL no portable a Next/Electron |

**Conclusión (RECOMMENDATION):** no hay un KDS OSS que valga la pena integrar. Lo reutilizable es
*diseño*: las etapas de Odoo y la disciplina expo/prep de Toast. Fullsite ya tiene más offline real
que cualquiera de estos repos.

---

## 6. FACT / INFERENCE / RECOMMENDATION (consolidado)

**FACT**
- Toast: prep station / expediter / ambos como destinos; reglas por dining option y service area
  ([2]); expo decide "ready" ([3]); HELD sólo en expo y cursos que se firean al bumpear el anterior
  ([16]); fire by prep time en segundos, "blank fires right away, 0 fires last", sólo KDS, no online
  ordering ([17]); warning colors por niveles ([1]); offline requiere hub local en el mismo subnet y al
  menos una impresora ([15]); bump bar USB con FULFILL/RECALL LAST/1-10 ([4]).
- Oracle Simphony: Prep/Expo/SOS ([5]); alertas en segundos, amarillo/rojo, por curso ([6]); Backup
  Device sólo cuando KDS Controller/Service Host cae ([6]); runner chits en "All Prep Done" ([6]); Links
  y Associations ([6]); Capacity Scheduling retiene ítems por capacidad e incompatible con DOM y load
  balancing ([18]); DOM para drive-thru ([26]).
- Square: routing por categoría ([8]); complete ítem/ticket, undo 3 s, recall desde completed,
  "complete for all devices" vs "only this device" ([9]); "Move ready tickets to front" cuando todas
  las prep marcaron ([14]); $20/mes por dispositivo (resumen de búsqueda, no verificado en página de
  precios); sólo Android ([28]); **offline no documentado** en los artículos leídos.
- NCR Aloha Kitchen: quote time por tabla ítems-en-cocina → minutos, con override manual temporal
  ([21]); bins simple/production/forecast con "Start" en bump bar ([11]).
- Olo: tres estrategias de throttling — Orders-in-Progress, Make Time Minutes per Period, Orders per
  Window ([22]).
- QSR Automations patente US20080319864A1 "Method of dynamically routing food items through a
  restaurant kitchen", **abandonada**, con la fórmula de forecast y el re-chequeo de capacidad ([19]).
- DoorDash `prep_time` opcional en confirmación y `order_ready_for_pickup` ([23]); Uber `pickup_time`
  unix en `accept_pos_order` ([24]).
- Fullsite: lo listado en §4.1 con archivo:línea.

**INFERENCE**
- El doble toque en Fullsite salta estados (lectura de `:381–383`; no reproducido en dispositivo).
- Square KDS no opera sin nube (ningún artículo lo menciona; contraste con Toast que lo documenta
  explícitamente). Tratar como no verificado.
- El quote time desde el event stream es viable en Pedro sin cambios de transporte.

**RECOMMENDATION**
- Cerrar primero los 5 faltantes triviales/bajos de §4.2 en un solo PR de "KDS estándar" (idempotencia,
  recall, segundo umbral, marca editado, all-day por estación).
- Hacer el cambio estructural (clave triple con estación + I1 en Pedro) antes de cualquier expo.
- Prototipar quote time desde el event store como reporte (sin UI) para medir p50/p90 real de AMALAY
  antes de prometer nada a un agregador.

---

## 7. Top 5 URLs

1. Toast, KDS workflow with course pacing — https://doc.toasttab.com/doc/platformguide/platformKDSWorkflowUsingCoursePacing.html
2. Oracle Simphony, Configuring a KDS Order Device (alertas, backup device, runner chits, links) — https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/kdscu/t_kds_order_device_config.htm
3. Oracle Simphony, KDS Capacity Scheduling — https://docs.oracle.com/en/industries/food-beverage/simphony/19.4/kdscu/c_kds_capacity_scheduling.htm
4. NCR Aloha, Managing ATO quote and prep times — https://docs.ncrvoyix.com/restaurant/aloha-takeout/integrating/integrating_ato_and_ak/managing_ato_quote_and_prep_times
5. QSR Automations, patente US20080319864A1 — https://patents.google.com/patent/US20080319864A1/en

---

## 8. Qué NO construir

- **Balanceo dinámico de carga entre estaciones** (QSR/Oracle): exige estaciones intercambiables y
  cocineros fungibles; en un restaurante de salón como AMALAY cada estación es única.
- **Dynamic Order Mode**: es para drive-thru; en salón produce chits a medio capturar.
- **Motor de cursos completo con timers automáticos**: nadie lo pidió; la marca `__tiempo__` dentro
  del envío cubre "primero/segundo tiempo" tal como opera AMALAY. Si un cliente lo pide, el modelo Toast
  (HELD en expo, fire al bumpear el anterior) está documentado y cabe en la máquina de §2.
- **Bins de producción/forecast** (Aloha): es QSR de alto volumen con producto pre-cocinado.
- **Bump bar propio**: son teclados HID; mapear teclas, no fabricar.
- **Robótica/make-line** (Chipotle-Hyphen, Sweetgreen Infinite Kitchen): otra industria.
- **Un KDS OSS "integrable"**: ninguno de los repos supera lo que ya está en producción.

---

## Referencias

- [1] https://doc.toasttab.com/doc/platformguide/platformKDSOverview.html ; colores 5/10/15 min de https://support.toasttab.com/en/article/Basic-Kitchen-Configuration
- [2] https://doc.toasttab.com/doc/platformguide/platformKitchenRoutingOverview.html ; https://doc.toasttab.com/doc/platformguide/adminAssignPrepStationKDS.html
- [3] https://doc.toasttab.com/doc/platformguide/adminUsingExpo.html
- [4] https://doc.toasttab.com/doc/platformguide/platformKitchenBumpBarIntegrationOverview.html
- [5] https://docs.oracle.com/en/industries/food-beverage/simphony/19.7/kdscu/c_kds_display_types.htm
- [6] https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/kdscu/t_kds_order_device_config.htm
- [7] https://doc.toasttab.com/doc/platformguide/platformKitchenConfiguringTickets.html
- [8] https://squareup.com/help/us/en/article/8170-filter-orders-by-category-with-square-kds
- [9] https://squareup.com/help/us/en/article/8171-complete-orders-with-square-kds
- [10] https://www.fresh.technology/kds-features/hold-fire-courses ; https://www.fresh.technology/kds-features/on-time-caution-late-ticket-headers
- [11] https://docs.ncrvoyix.com/restaurant/aloha-kitchen/implementing/configuring_bins
- [12] https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804658689-Managing-production-centers ; https://k-series-support.lightspeedhq.com/hc/en-us/articles/22708154090267-Using-the-Kitchen-Display-System-2-0
- [13] https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale/preparation.html
- [14] https://squareup.com/help/us/en/article/8168-prioritize-orders-with-square-kds
- [15] https://doc.toasttab.com/doc/platformguide/platformOfflineModeLocalSync.html ; https://support.toasttab.com/en/article/Prepare-to-Operate-in-Offline-Mode-During-Service-Disruptions-or-Outages
- [16] https://doc.toasttab.com/doc/platformguide/platformKDSWorkflowUsingCoursePacing.html ; https://support.toasttab.com/en/article/Course-Firing-Options
- [17] https://support.toasttab.com/en/article/Item-Fire-by-Prep-Time
- [18] https://docs.oracle.com/en/industries/food-beverage/simphony/19.4/kdscu/c_kds_capacity_scheduling.htm
- [19] https://patents.google.com/patent/US20080319864A1/en
- [20] https://doc.toasttab.com/doc/platformguide/adminInterpretingTicketTimes.html
- [21] https://docs.ncrvoyix.com/restaurant/aloha-takeout/integrating/integrating_ato_and_ak/managing_ato_quote_and_prep_times ; https://docs.ncrvoyix.com/restaurant/aloha-kitchen/implementing/field_definitions/quote_time
- [22] https://olosupport.zendesk.com/hc/en-us/articles/115002752386-Order-Throttling-Strategies-Overview ; https://olosupport.zendesk.com/hc/en-us/articles/13294124769179-Orders-in-Progress-Limits-Throttling-Strategy (403 al fetch; contenido tomado del resumen de búsqueda)
- [23] https://developer.doordash.com/en-US/docs/marketplace/how_to/order_ready_signal/
- [24] https://developer.uber.com/docs/eats/references/api/v1/post-eats-order-orderid-acceptposorder
- [25] https://qsrautomations.com/connectsmart-kitchen/ (marketing; redirige a crunchtime.com)
- [26] https://docs.oracle.com/en/industries/food-beverage/simphony/19.7/kdscu/c_kds_dom.htm
- [27] https://support.toasttab.com/en/article/KDS-FAQ
- [28] https://squareup.com/help/us/en/article/7959-route-orders-with-your-kds
- Internos: `dashboard-app/src/app/pos/cocina/page.tsx`, `dashboard-app/src/app/kds/page.tsx`, `dashboard-app/src/hooks/useKdsWsClient.ts`, `electron-app/local-server/index.js`, `docs/customers/amalay/KDS-BUILD-JUEVES.md`, `docs/customers/amalay/DEBRIEF-JUL12.md`.
