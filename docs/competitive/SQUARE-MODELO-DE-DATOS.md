# Square — modelo de datos y lógica de diseño

> **Investigado el 2026-08-29.** Fuentes: documentación de desarrollador y centro de
> ayuda de Square (públicas, citadas una por una). **No se pudieron usar videos:**
> las pistas de subtítulos de YouTube existen pero su API exige un token que no se
> puede generar desde aquí, y el panel de transcripción no se renderiza en un
> navegador automatizado. Se intentó por las dos vías antes de descartarlo.
>
> Documento vivo. Cada afirmación trae su URL; lo que no se pudo verificar está
> marcado como tal en vez de rellenarse.

---

## 1. La tesis: un núcleo, varias pieles

Square **no** es un POS de restaurantes que después creció a tiendas. En 2018 lanzó
**Square for Restaurants y Square for Retail al mismo tiempo**, como verticales sobre
la misma plataforma, más Square Appointments para servicios. En 2023 unificó el
dashboard de retail y restaurantes.

Fuente: [Square press — Introducing Square for Restaurants](https://squareup.com/us/en/press/introducing-square-for-restaurants-a-dedicated-point-of-sale-and-complete-set-of-tools-built-for-today-s-restaurants-featuring-caviar-integration)

**La consecuencia de diseño:** catálogo, órdenes, ubicaciones, pagos e inventario son
**uno solo**. Lo vertical es la piel — qué pantallas ves, qué features se encienden —
no el modelo de datos.

Esto valida la dirección de `dashboard-app/src/lib/vertical-presets.ts`, que ya define
ocho verticales (`fast_food`, `fast_casual`, `casual_dining`, `fine_dining`,
`bar_cantina`, `cafeteria_panaderia`, `hibrido_restaurante_tienda`, `dark_kitchen`)
como un patch de `features` sobre los defaults, aplicado al aprovisionar. Es el mismo
patrón.

**Corrección del 2026-08-29:** una versión anterior de este documento decía que ese
archivo seguía sin commitear. Ya está en `main` **y ya lo consume `provisionTenant()`**
(6 referencias). Se verificó comparando disco contra `origin/main`: idénticos.

---

## 2. Catálogo y multi-sucursal — el hallazgo principal

Square **no tiene un árbol de configuración heredada**. Tiene un arreglo de excepciones
en el propio objeto.

`CatalogItemVariation.location_overrides[]` es de tipo `ItemVariationLocationOverrides`,
y cada elemento trae:

| Campo | Tipo | Qué permite por sucursal |
|---|---|---|
| `location_id` | string | a cuál aplica el override |
| `price_money` | Money | **precio distinto por sucursal** |
| `pricing_type` | string | fijo o variable |
| `track_inventory` | boolean | si esa sucursal lleva inventario |
| `inventory_alert_type` | string | tipo de alerta de stock |
| `inventory_alert_threshold` | integer | umbral propio |
| `sold_out` | boolean (read-only) | agotado ahora |
| `sold_out_valid_until` | string (read-only) | hasta cuándo |

Fuente: [ItemVariationLocationOverrides](https://developer.squareup.com/reference/square/objects/ItemVariationLocationOverrides)

Y para la **existencia** del ítem, no su precio, hay dos campos aparte:
`present_at_all_locations` y `present_at_location_ids`. Un platillo puede existir en
todas menos en dos, **sin duplicar el objeto**.

Fuente: [CatalogItemVariation](https://developer.squareup.com/reference/square/objects/CatalogItemVariation)

### Por qué importa

El punto 7 del spec de Fullsite Factory pide herencia con alcances
(plataforma → grupo → marca → sucursal → dispositivo) y una UI que diga si un valor es
heredado. Square resuelve el 90% de eso con **un arreglo de overrides y dos banderas de
presencia**. Sin árbol, sin resolución de alcances, sin cascada.

**Recomendación:** copiar esta forma antes de construir el árbol. Un `location_overrides`
en el ítem es un `jsonb` o una tabla puente; el árbol de cinco niveles es un motor de
resolución que hay que mantener, depurar y explicar.

### Otros campos del catálogo que Fullsite no tiene

- **`kitchen_name`** — nombre alterno del ítem **para la cocina**. "Bowl mediterráneo"
  en el menú, "BOWL MED" en el KDS. Barato de agregar, y resuelve el problema real de
  que los nombres de venta no caben ni sirven en una pantalla de cocina.
- **`vendor_information[]`** — proveedor a nivel variación, no sólo a nivel insumo.
- **`stockable_conversion`** — conversión de unidad entre lo que se compra y lo que se
  vende (caja → pieza).
- **`measurement_unit_id`**, **`sellable`**, **`stockable`** — separan "se puede vender"
  de "se lleva inventario", que hoy en Fullsite es una sola idea.

---

## 3. Órdenes — concurrencia e idempotencia

### Versionado optimista

El objeto `Order` trae `version` (integer 32-bit), *"incremented each time an update is
committed to the order"*. En `UpdateOrder`:

> *"Your request must include the `order.version` property. `version` must be set to the
> current version of the order or your request returns an error."*

Fuentes: [Order](https://developer.squareup.com/reference/square/objects/Order) ·
[Update orders](https://developer.squareup.com/docs/orders-api/manage-orders/update-orders)

**Es exactamente el `order_revision` de Fullsite** y su `STALE_WRITE_REJECTED`. La
diferencia: Square incrementa la versión **incluso si todos los cambios se ignoran**.

### Dos mecanismos que Fullsite no tiene

- **Sparse update:** se manda sólo lo que cambia; lo ausente no se toca. Fullsite hoy
  manda el objeto completo y usa `coalesce(p_campo, campo)` en el RPC — funciona, pero
  no distingue "no lo mandes" de "ponlo en null".
- **`fields_to_clear[]` con notación de punto:**
  `line_items[coffee_uid].applied_discounts[discount_uid]` borra **ese** descuento de
  **ese** ítem. Es la forma de expresar "quita esto" sin mandar el objeto entero.

### Idempotencia

`idempotency_key` en las operaciones de escritura:

- **misma llave + mismo cuerpo** → devuelve la respuesta original sin reprocesar
- **misma llave + cuerpo distinto** → **error**, no sobreescritura silenciosa

Fuente: [Idempotency](https://developer.squareup.com/docs/build-basics/common-api-patterns/idempotency)

Ese segundo caso es el que Fullsite debería revisar: hoy `save_operation_id` deduplica,
pero **no está verificado qué pasa si llega la misma llave con un cuerpo distinto**.
Square lo trata como error del cliente. Pendiente de comprobar en Fullsite.

### Dos máquinas de estado, no una

Éste es probablemente el hallazgo estructural más importante del documento.

**`Order.state`** — el ciclo **comercial**, cuatro valores:

| Estado | Significado |
|---|---|
| `DRAFT` | se puede editar, **no se puede pagar ni entregar** |
| `OPEN` | abierta, editable |
| `COMPLETED` | pagada por completo — **terminal** |
| `CANCELED` | no pagada — **terminal** |

Fuente: [OrderState](https://developer.squareup.com/reference/square/enums/OrderState)

**`Fulfillment.state`** — el ciclo **operativo**, seis valores:

`PROPOSED` → `RESERVED` → `PREPARED` → `COMPLETED`, más `CANCELED` (se detuvo a
propósito) y `FAILED` (se detuvo por un problema, sin que nadie lo cancelara).

Fuente: [FulfillmentState](https://developer.squareup.com/reference/square/enums/FulfillmentState)

Que `CANCELED` y `FAILED` sean estados distintos importa: "el mesero canceló" y "la
comanda nunca llegó a la cocina" son incidentes diferentes y se investigan diferente.

**Fullsite las mezcla en una sola columna.** `pos_orders.status` tiene `abierta`,
`enviada`, `cerrada`, `cancelada`, `void` — comercial y operativo revueltos. Por eso
"enviada" (que es de cocina) convive con "cerrada" (que es de caja), y no hay forma de
expresar "pagada pero la cocina todavía no la termina".

**Recomendación:** separar en dos campos antes de meterle más estados. Con delivery,
pickup y dine-in conviviendo, una sola columna se vuelve inmanejable — y ése es
justamente el camino en el que ya está Fullsite con Rappi y Uber.

### Campos del Order que vale la pena mirar

`ticket_name` (*"short identifier like table number"*) es la mesa. `reference_id`
(máx 40 chars) es el id del sistema externo — el hueco natural para el id de Rappi o
Uber. `source` (`OrderSource`) dice de dónde vino la orden. `fulfillments[]` separa
**cómo se entrega** de **qué se compró**, que es lo que permite que dine-in, pickup y
delivery convivan en el mismo objeto.

---

## 4. Offline — donde Fullsite puede ganar de verdad

Los límites de Square, con números exactos:

| Regla | Valor |
|---|---|
| Tiempo máximo sin reconectar | **24 horas**; pasado eso el pago **expira y no se cobra** |
| Pagos encolados por dispositivo | **máximo 1,000** |
| Tope por transacción (default) | **$100 USD**, configurable hasta $50,000 |
| Tope total almacenado | `offlineTotalStoredAmountLimit` |
| Cancelar o reembolsar un pago offline pendiente | **no se puede** |
| Requisito del lector | haber estado en línea en las últimas 24 h |

Fuentes: [Process offline payments](https://squareup.com/help/us/en/article/7777-process-card-payments-with-offline-mode) ·
[Mobile Payments SDK — Offline Payments](https://developer.squareup.com/docs/mobile-payments-sdk/ios/offline-payments)

Y el estado que más duele:

> `FAILED_TO_PROCESS` — *"An offline payment with this status cannot be recovered, and
> the seller doesn't receive funds from the transaction."*

El SDK expone `paymentSettings.isOfflineProcessingAllowed`,
`offlineTransactionAmountLimit`, `offlineTotalStoredAmountLimit`, y un `processingMode`
con tres valores: `onlineOnly`, `offlineOnly`, `autoDetect`.

### La lectura honesta

**No es la misma comparación.** Square offline es sobre **cobrar tarjetas sin red** — un
problema financiero, con riesgo de perder el dinero. Fullsite local-first es sobre
**seguir operando sin red** — tomar comandas, imprimir, mandar al KDS — y sincronizar
después.

Pero el argumento de venta sí es legítimo, y es específico:

> *"Con Square, si tu internet se cae más de 24 horas, los cobros que tomaste se pierden
> y no puedes ni cancelarlos. Y el tope viene en $100 por ticket."*

Eso es verificable y está en su propia documentación. **No hay que exagerarlo:** Square
no pretende operar offline indefinidamente; toma el riesgo a propósito y acotado.

---

## 5. KDS — ruteo por estación

### La decisión de diseño

Square tiene una **taxonomía de cocina separada de la del menú**. Se llaman *kitchen
routing categories* y se crean en
**Dashboard → Settings → Device management → Kitchen settings → Kitchen routing**, donde
se les asignan ítems.

Fuente: [Filter orders by category with Square KDS](https://squareup.com/help/us/en/article/8170-filter-orders-by-category-with-square-kds)

Cada pantalla enciende o apaga las categorías que le tocan. El menú es para el cliente;
el ruteo es para la cocina. **Son dos árboles distintos sobre los mismos ítems.**

### Dos tipos de estación

| | Puede |
|---|---|
| **Prep** | ver órdenes, limpiar ítems/tickets, recuperar tickets, ver conteos "All Day" |
| **Expo / Expeditor** | todo lo de Prep **más** ver lo que otras estaciones marcaron completo, y recuperar tickets ya completados |

Fuente: [Route orders with your KDS](https://squareup.com/help/us/en/article/7959-route-orders-with-your-kds) y comunidad de Square

**Expo es una estación que ve el trabajo de las demás.** Fullsite hoy no tiene esa
distinción: todas las pantallas son iguales.

### Segundo eje de filtrado

Aparte de la categoría, se filtra por **dining option** (Dine-In, To-Go, Pickup,
Delivery), desde **Settings → Routing → Source & Fulfillment** en la app del KDS. Sirve
para que una pantalla vea sólo lo que se empaca para llevar.

### "All Day"

Conteo agregado de cuántas unidades de cada ítem hay pendientes **en todos los tickets
abiertos**. Es como la cocina piensa: no "mesa 4 pide 2 tacos", sino "hay 14 tacos
pendientes en total". Fullsite no lo tiene.

**No verificado:** límite de categorías, límite de estaciones, y si un ítem puede ir a
más de una estación a la vez. La documentación pública no lo dice.

---

## 5-bis. Menús por horario — otra capa que Fullsite no tiene

Square resuelve desayuno/comida/happy hour **sin inventar una entidad nueva**.

Un menú **es una categoría**: `CatalogCategory` con `category_type = "MENU_CATEGORY"`.
Las categorías se anidan con `parent_category_id`, la raíz se marca con
`is_top_level = true`, y todas las descendientes apuntan a su ancestro con
`root_category_id`.

Fuente: [Manage Menus](https://developer.squareup.com/docs/catalog-api/manage-menus)

La disponibilidad por horario es `CatalogAvailabilityPeriod`, con tres campos:

| Campo | Ejemplo |
|---|---|
| `start_local_time` | `8:30:00` |
| `end_local_time` | `21:00:00` |
| `day_of_week` | día al que aplica |

Fuente: [CatalogAvailabilityPeriod](https://developer.squareup.com/reference/square/objects/CatalogAvailabilityPeriod)

El POS **elige solo** qué menú mostrar según la hora, y las subcategorías **heredan el
horario del padre**: una categoría "Desayuno" de 9:30 a 13:00 arrastra a "Bebidas de
desayuno" sin configurarla aparte.

Fuente: [Create menus with Square for Restaurants](https://squareup.com/help/us/en/article/6424-create-menus-with-square-for-restaurants)

**La lección de diseño:** menú = árbol de categorías con un discriminador de tipo, más
un objeto de horario de tres campos. No una entidad nueva, no una tabla de menús, no un
motor de reglas.

Fullsite hoy tiene categorías planas sin horario. Un restaurante con desayuno y cena
tiene que apagar y prender platillos a mano.

---

## 5-ter. Turnos — `location_id` es obligatorio

El objeto `Shift` (hoy en transición hacia `Timecard`) exige `location_id`, y
**un turno no puede abarcar dos sucursales**: *"The location should be based on where
the employee clocked in."* La zona horaria del turno sale de la ubicación.

Campos que importan: `team_member_id`, `start_at` / `end_at` (RFC 3339 en hora local de
la ubicación), `wage`, `breaks[]`, `status`, `version` (mismo versionado optimista que
las órdenes) y `declared_cash_tip_money` — las propinas en efectivo que el empleado
declara para ese turno.

Fuente: [Shift](https://developer.squareup.com/reference/square/objects/Shift)

**Esto es exactamente el punto 5 del spec de Fullsite Factory.** Verificado en la base
de AMALAY el 2026-08-28: `pos_turnos` **no tiene `location_id`** — sus columnas son
`id, client_id, opened_by, fondo_inicial, opened_at, closed_by, fondo_final,
efectivo_sistema, diferencia, closed_at, notas`. Un grupo con cinco sucursales no puede
tener cortes independientes hoy.

Dos cosas más que Square trae y Fullsite no: `breaks[]` (descansos pagados y no pagados
dentro del turno) y `declared_cash_tip_money` (propina declarada por turno, que es como
se reparte de verdad).

---

## 6. Inventario — la brecha que Square no cerró sola

> *"Square's basic inventory only tracks **finished goods**."*

Para inventario a nivel **ingrediente, receta y ciclo de producción**, Square **no lo
construyó**: se integró con **MarketMan** en abril de 2026.

Fuentes: [Square Restaurant Inventory by MarketMan](https://squareup.com/us/en/inventory-management/restaurants) ·
[Press — abril 2026](https://squareup.com/us/en/press/square-restaurant-inventory-marketman)

### Por qué esto importa mucho

**Fullsite ya tiene recetas con ingredientes y costo calculado.** `pos_recipes` guarda
`precio_venta`, `costo_total`, `pct_costo` e `ingredientes`, y hay agentes que leen
`pos_ingredients` para variación de costo, predicción de compra y mermas.

Eso significa que **el food cost a nivel receta es terreno donde Square tuvo que traer a
un tercero después de ocho años**. Es la única área encontrada en esta investigación
donde Fullsite tiene profundidad nativa que Square no.

**Ojo con no exagerarlo:** que Square lo resuelva con un socio no lo hace peor para el
cliente final — lo hace *menos integrado*. El argumento es de integración, no de
existencia.

---

## 7. Retail vs Restaurants — qué cambia de verdad

Mismo catálogo, mismas órdenes, mismas ubicaciones. Lo que cambia:

| | Retail | Restaurants |
|---|---|---|
| Inventario | profundo: transferencias entre sucursales, COGS, utilidad proyectada, SKUs ilimitados | sólo producto terminado (ingredientes vía MarketMan) |
| Códigos de barras | sí — impresión de etiquetas, escaneo en recepción de mercancía | no aplica |
| Proveedores y órdenes de compra | sí, con códigos de proveedor y filtro "sólo este proveedor" | no nativo |
| Matriz de producto | sí (talla × color) | no |
| KDS | no | sí |
| Mesas y coursing | no | sí |

Fuentes: [Inventory management](https://squareup.com/us/en/point-of-sale/features/inventory-management) ·
[Purchase orders](https://squareup.com/help/us/en/article/8258-create-purchase-orders-with-square-for-retail) ·
[Vendor management](https://squareup.com/help/us/en/article/5958-vendor-management) ·
[Barcode labels](https://squareup.com/help/us/en/article/6093-create-and-print-bar-code-labels-with-square-for-retail)

**La lectura:** la diferencia vertical es sobre todo **profundidad de inventario y
herramientas de compra** para retail, contra **KDS y manejo de mesas** para restaurantes.
El núcleo no se toca. Que es exactamente la apuesta de `vertical-presets.ts`.

Y valida la intuición de `hibrido_restaurante_tienda`: AMALAY es cafetería **y** market.
Square trataría eso como un solo catálogo con features de los dos lados encendidas.

---

## 7-bis. Impresión — perfiles, no impresoras

Square no asigna categorías a una impresora. Asigna categorías a un **perfil de
impresión**, y el perfil a uno o varios dispositivos. *"A collection of settings used to
configure one or more devices with preset printer settings."*

**Varios perfiles pueden apuntar a la misma impresora física.** El ejemplo de su propia
documentación: un perfil "Hot" con las categorías de cocina caliente y otro "Cold" con
las frías, ambos imprimiendo en el mismo aparato. El perfil es la unidad lógica; la
impresora es sólo el destino.

Tipos de trabajo de impresión: **recibos**, **tickets de orden en persona**, **tickets
de orden en línea y de kiosko**, **tickets de cancelación** y **etiquetas de código de
barras**.

Fuentes: [Set up printer profiles](https://squareup.com/help/us/en/article/8245-set-up-printer-profiles) ·
[Assign item categories to printers](https://squareup.com/help/us/en/article/8148-create-and-assign-item-categories-with-square-for-restaurants) ·
[Connect printers](https://squareup.com/help/us/en/article/5771-create-and-manage-printer-stations)

### El detalle que evita el bug clásico

Cada perfil tiene una **política para las categorías nuevas**:

- **"Print all new categories automatically"** (por omisión) — toda categoría nueva se
  rutea sola
- **"Don't print new categories"** — hay que asignarla a mano

Ése es el bug que rompe restaurantes: alguien agrega un platillo, nadie lo asigna a una
impresora, y **no sale en cocina hasta que un cliente reclama**. Square lo convierte en
una decisión explícita del dueño, con un default seguro.

Y los tickets imprimen con el **`kitchen_name`** del §2, no con el nombre de venta.

**Fullsite hoy:** ruteo por estación en `printers.json`, sin concepto de perfil ni
política para categorías nuevas. El punto 4 del spec pide "categoría → estación →
impresora"; el modelo de Square sugiere meter el perfil como capa intermedia, que es lo
que permite dos ruteos distintos sobre un mismo aparato.

---

## 7-ter. Personal y permisos — el mismo patrón que el catálogo

`TeamMember.assigned_locations` usa `TeamMemberAssignedLocations`, con dos modos:

| Modo | Qué hace |
|---|---|
| `ALL_CURRENT_AND_FUTURE_LOCATIONS` | acceso a todas, **incluidas las que se abran después** |
| `EXPLICIT_LOCATIONS` | sólo a la lista dada |

Fuente: [TeamMember](https://developer.squareup.com/reference/square/objects/TeamMember)

**Es exactamente la misma forma que `present_at_all_locations` / `present_at_location_ids`
del catálogo.** Square usa el patrón "todas o lista explícita" en el catálogo, en el
personal, y en los perfiles de impresión.

Esa consistencia es la lección: **un solo idioma para expresar alcance**, reusado en
cada entidad. No tres mecanismos distintos según el módulo.

Y `wage_setting` cuelga del miembro, con el puesto asociado — el sueldo es por
combinación de persona y puesto, no un campo suelto.

---

## 7-quater. Inventario — un libro mayor, no un número

Éste es el diseño más elegante que se encontró, y el que más lejos está de Fullsite.

**El inventario de Square no es una cantidad que se muta. Es la suma de transiciones de
estado.**

| Objeto | Qué es |
|---|---|
| `InventoryAdjustment` | *"the quantity of an item variation transitioning from one inventory state to another"* |
| `InventoryPhysicalCount` | conteo verificado a mano que **sobreescribe** lo calculado |
| `InventoryCount` | la cantidad **calculada**, recomputada tras cada ajuste |

Estados: `IN_STOCK`, `SOLD`, `WASTE`, entre otros.

Fuente: [Inventory API](https://developer.squareup.com/docs/inventory-api/what-it-does)

Así, **vender, mermar, recibir y transferir son la misma operación** con distinto par
origen→destino. Y lo mejor:

> Las transferencias entre sucursales son ajustes *"where `from_location_id` and
> `to_location_id` differ"* — **no existe un objeto de transferencia**.

### Por qué importa para Fullsite

Un stock mutable no puede contestar "¿por qué tengo 3 y no 7?". Un libro mayor sí:
cada unidad tiene un renglón que dice de qué estado a cuál se movió, cuándo y por qué.

Es la diferencia entre un inventario que cuadra y uno que se audita. Y para los agentes
de merma y variación de costo, es la diferencia entre adivinar y demostrar.

**Recomendación:** cuando toque inventario multi-sucursal, no construir "stock por
sucursal" como número. Construir el libro y derivar el número. Es más trabajo la primera
vez y menos para siempre.

---

## 8. Qué copiar, en orden

1. **`location_overrides` en vez de árbol de herencia.** Un arreglo de excepciones sobre
   el objeto, más `present_at_all_locations` / `present_at_location_ids`. Resuelve el
   punto 7 del spec sin construir un motor de resolución de alcances.
2. **Taxonomía de cocina separada del menú.** Es el punto 3 del spec, y Square confirma
   que son dos árboles distintos, no uno.
3. **Estación Expo.** Una pantalla que ve lo que las demás completaron. Barato y es como
   opera una cocina real.
4. **`kitchen_name`.** Una columna. Resuelve nombres que no caben en el KDS.
5. **Conteos "All Day".** Agregado por ítem sobre tickets abiertos.
6. **Idempotencia estricta:** misma llave + cuerpo distinto = error, no sobreescritura.
   Verificar qué hace Fullsite hoy.
7. **Sparse update con `fields_to_clear`.** Distinguir "no lo mandes" de "ponlo en null".

## Qué NO copiar

- **Su modelo offline.** Es un compromiso financiero acotado (24 h, $100, sin
  reembolso), no operación local-first. Fullsite apunta a otra cosa y debe seguir así.
- **Separar inventario en un tercero.** Es su deuda, no su diseño.

---

## 9. Lo que falta investigar

Marcado honestamente, no rellenado:

- Valores de `Location.type`
- Límite de categorías de cocina y de estaciones; si un ítem puede ir a dos estaciones
- El objeto **`Timecard`**, que está reemplazando a `Shift`
- Qué pasa con **`idempotency_key` repetida con cuerpo distinto** en Orders
  específicamente (la regla general está documentada, la de Orders no se confirmó)
- El **catálogo completo de estados de inventario** (se confirmaron `IN_STOCK`, `SOLD`,
  `WASTE`; la documentación sugiere que hay más)
- Cómo modela Square los **cursos / coursing** en servicio completo

---

## Cambios sugeridos a Fullsite que salen de aquí

| Origen | Cambio | Esfuerzo |
|---|---|---|
| §2 | `location_overrides` para precio y disponibilidad por sucursal | medio |
| §2 | `kitchen_name` en `pos_menu_items` | trivial |
| §2 | separar `sellable` de `stockable` | bajo |
| §5 | categorías de ruteo de cocina, independientes del menú | medio |
| §5 | tipo de estación Prep vs Expo | bajo |
| §5 | conteos "All Day" en el KDS | bajo |
| §3 | verificar idempotencia con cuerpo distinto | bajo (investigación) |
| §1 | ~~commitear `vertical-presets.ts` y conectarlo a `provisionTenant()`~~ **YA HECHO** | — |
| §3 | **separar `status` en dos campos**: comercial y operativo | medio-alto |
| §5-bis | menús como árbol de categorías + `CatalogAvailabilityPeriod` | medio |
| §5-ter | **`location_id` en `pos_turnos`** — hoy no existe | medio |
| §5-ter | `breaks[]` y propina en efectivo declarada por turno | bajo |
| §7-bis | **perfil de impresión** como capa entre categoría e impresora | medio |
| §7-bis | política de categorías nuevas: rutear solas o exigir asignación | trivial |
| §7-bis | ticket de **cancelación** como tipo de impresión propio | bajo |
| §7-ter | un solo idioma de alcance: `TODAS` vs `LISTA_EXPLÍCITA`, reusado | medio |
| §7-quater | **inventario como libro mayor**, no como número mutable | alto |

---

## 10. La lección que atraviesa todo

Square repite **el mismo patrón** en cada entidad, y ahí está su verdadera ventaja:

1. **Un objeto base + un arreglo de excepciones.** Catálogo con `location_overrides`,
   nada de árboles de herencia.
2. **Un solo idioma de alcance.** `ALL_CURRENT_AND_FUTURE` vs `EXPLICIT_LIST`, igual en
   catálogo, en personal y en impresión.
3. **Discriminador de tipo antes que entidad nueva.** Los menús son categorías con
   `category_type`. Las transferencias son ajustes con distinto origen y destino.
4. **Libro mayor antes que número mutable.** El inventario se deriva, no se guarda.
5. **Dos máquinas de estado cuando hay dos ciclos.** Comercial y operativo separados.
6. **Defaults explícitos en los bordes.** La política de categorías nuevas es una
   decisión del dueño, no un accidente.

Ninguno es una feature. Los seis son **decisiones de forma**, y por eso pueden vender a
restaurantes, tiendas y servicios sobre el mismo núcleo.

**Si Fullsite quiere ser clonable a mil restaurantes —y a tiendas— el trabajo no es
agregar features: es adoptar estas seis formas antes de que el modelo se endurezca.**
