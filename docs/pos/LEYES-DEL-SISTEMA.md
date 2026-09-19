# Las leyes del sistema

> Creado el 2026-09-14, después de una sesión de campo en AMALAY donde cinco
> defectos reales salieron a la luz y **ninguno era un botón roto**. Los cinco
> eran violaciones de una ley del sistema.

## Para qué existe este documento

Una ley es una verdad que debe cumplirse **pinte como pinte la pantalla**. No
dice dónde va un botón ni cómo se ve: dice qué tiene que ser cierto de los datos.

Eso las hace útiles para dos cosas a la vez:

1. **Sobreviven al rediseño.** Se comprueban en Supabase, en Pedro y en
   IndexedDB. La piel puede cambiar entera y siguen valiendo.
2. **Cazan lo que un clic no caza.** Los cinco defectos del 2026-09-14 pasaron
   con todos los botones funcionando:

   | Defecto | El botón | La ley violada |
   |---|---|---|
   | Corte Z con $429.20 abiertos y `cierre_con_ordenes_abiertas: false` | funcionó | L-07 |
   | 14 tablas con 403 mudo en el proxy | la pantalla cargó | L-12 |
   | `usePosOffline` escrito y sin montar | no hay botón | L-09 |
   | Turno activo en una pantalla y ausente en otra | las dos "funcionaban" | L-06 |
   | `PATCH` sin filtro rechazado en silencio para siempre | invisible | L-10 |

## Cómo leer una ley

Cada una trae **de dónde salió**. Eso no es adorno: el 2026-09-14, escribiendo
este mismo catálogo, se redactó una ley de memoria —`efectivo + tarjeta +
transferencias = total_ventas`— dos mensajes después de haber leído la fórmula
real. Produjo **dos violaciones falsas** (Z#7 y Z#4) que no existían: el campo
`efectivo_sistema` no es «ventas en efectivo», es el efectivo **esperado en el
cajón** e incluye el fondo inicial.

> **Una ley sin `archivo:línea` no es una ley: es un recuerdo.**

Estados de verificación, y no son intercambiables:

| Estado | Qué significa |
|---|---|
| `VERIFICADA` | Derivada del código Y comprobada contra datos reales. Se dice contra qué. |
| `DERIVADA` | Leída del código, todavía sin comprobar contra datos. |
| `PENDIENTE` | Se cree cierta y falta leer la fuente. No se usa para decidir nada. |

---

## I. El dinero

### L-01 · El efectivo esperado en el cajón `VERIFICADA`

```
efectivoEsperado = fondoInicial + ventasEfectivo + propinaEfectivo
                 + depositos − retiros − propinasNoEfectivo
```

**Fuente:** `dashboard-app/src/lib/pos-arqueo.ts:38` (`calcEfectivoEsperado`),
declarada ahí como *«single source of truth… Never inline this formula again»*.

**Por qué cada signo:** las propinas cobradas **en efectivo se quedan** en el
cajón, así que suman. Las cobradas con tarjeta o transferencia **se le pagan al
mesero en billetes**, así que salen del cajón y restan.

**Comprobada contra:** los 12 cierres de AMALAY en `pos_cierres`.
**Resultado: 12 de 12 cuadran, desvío $0.00**, incluido el de $5,957.76.

### L-02 · La aritmética del ticket `VERIFICADA`

```
total = subtotal + iva
iva   = iva_rate del restaurante × subtotal
```

**Fuente:** `iva_rate` sale de la tabla `clients` vía
`dashboard-app/src/lib/client-config.ts:142` y llega al POS por
`pos-config.ts:41`. **Nunca se escribe 0.16 a mano**: dos de los tres tenants de
la base tienen `iva_rate = 0`, y usar `||` en vez de `??` sobre ese campo ya
convirtió un 0 legítimo en 16% una vez (`client-config.ts:135`).

**Comprobada contra:** las 8 órdenes cerradas con importe de AMALAY.
**Resultado: 8 de 8 con `tasa_efectiva = 0.1600` exacta y `subtotal + iva − total = 0.00`.**

> **Pregunta abierta, y es de 16% en cada ticket:** `pos-config.ts:13` trae el
> comentario `ivaRate: number // 0 (AMALAY: precios incluyen IVA)`. El comentario
> está viejo —el código lee de la base, y AMALAY tiene 0.16— pero deja una duda
> que **no vive en el código**: si el precio de la carta de AMALAY ya incluye
> IVA, sumarle 16% encima cobra el impuesto dos veces. Sólo Daniel puede
> contestarla. Hasta entonces, la ley dice que la aritmética es consistente, no
> que la configuración sea la correcta.

### L-03 · Sólo lo cerrado es venta `VERIFICADA`

```
total_ventas   = Σ total de las órdenes con status 'cerrada' del turno
cancelaciones  = conteo de las 'cancelada'   (NO suman a la venta)
```

**Fuente:** `pos-arqueo.ts:158` (`computeOrderSummary`) — descarta `'cancelada'`
y salta todo lo que no sea `'cerrada'`.

**Comprobada contra:** los 12 cierres. **10 de 12 cuadran.** Las dos excepciones
son del 9 y 16 de julio, ambas sin folio Z: el cierre dice $375 (4 tickets) y
$155 (1 ticket) y **no existe ni una orden cerrada de esos turnos**. El cierre es
internamente consistente, así que el número no se inventó — **desaparecieron las
órdenes**. Consecuencia: esos dos días no se pueden reconstruir.

### L-04 · El reparto por forma de pago no pierde dinero `DERIVADA`

```
efectivo + tarjeta + transferencias + otros = total_ventas
```

**Fuente:** `pos-arqueo.ts:186-205`. Cada orden reparte su total **completo**
entre sus formas de pago en fracciones proporcionales al monto, así que la suma
de las partes es el total por construcción.

**Trampa documentada:** el tipo de cada forma sale de `pos_payment_methods`, no
del nombre. Sin ese mapa, «Dólares» —efectivo físico— caía como tarjeta y la
caja cerraba mal (`pos-arqueo.ts:70`).

### L-05 · La propina de lo no-efectivo sale del cajón `DERIVADA`

**Fuente:** `pos-arqueo.ts:200` — *«La propina de todo lo que NO es efectivo sale
del cajón igual: se le paga al mesero en billetes.»*

---

## II. El turno y las cuentas

### L-06 · Un solo turno, una sola verdad `VIOLADA — arreglada en PR #409`

> El turno que ve `/pos/turno` es el mismo que ve `/pos/mesas`.

**Violación medida el 2026-09-14, dos veces:** `/pos/turno` mostraba «Turno
activo · 01:13 p.m.», Supabase no tenía ningún turno abierto y `/pos/mesas` decía
«No hay turno abierto» — y mesas tenía razón. El turno vivía sólo en IndexedDB.

**Causa:** abrir turno encolaba un `PATCH` sin filtro que la guarda rechazaba
para siempre. Ver L-10.

### L-07 · El cierre no puede mentir sobre lo que deja abierto `VIOLADA — arreglada en PR #403`

```
cierre_con_ordenes_abiertas  =  (existen órdenes con status ∈ {enviada, preparando, lista})
ordenes_pendientes           =  los ids de esas órdenes
```

**Fuente de los estados:** `pos-cierre-guard.ts:4` (`OPEN_ORDER_STATUSES`).

**Violación medida el 2026-09-14:** el Corte Z #8 quedó guardado con
`cierre_con_ordenes_abiertas: false` y `ordenes_pendientes: []` mientras la mesa
1 ($197.20) y la mesa 2 ($232.00) seguían en `enviada`. El corte del día quedó
corto por **$429.20 de comida que salió de la cocina y no se cobró**, y el campo
que existe para delatarlo dijo que no había nada que delatar.

### L-08 · No se abre turno sobre cuentas del turno anterior `DERIVADA`

**Fuente:** `pos-cierre-guard.ts:125` (`evaluarAperturaDeTurno`), y la regla de
Eduardo Esquivel citada ahí: *«No puedes abrir un turno si sigues teniendo
cuentas abiertas del turno anterior… No puede haber cuentas abiertas de un día
para otro.»*

**Matiz que ya está escrito y hay que respetar:** se bloquea cuando la consulta
**sí se pudo hacer** y hay cuentas. Si la consulta falló, **se abre igual con
aviso** — bloquear el arranque del día por un fetch fallido sería repetir el
incidente del 2026-08-31.

---

## III. Lo que viaja: cola, red y autoridad

### L-09 · Una operación encolada sube, o es accionable `VIOLADA — parcialmente arreglada`

> Ninguna operación puede quedarse en la cola para siempre sin que nadie pueda
> hacer nada con ella.

**Violación medida el 2026-09-14:** dos `pos_turnos` en `sync_queue` con
`retries: 0`, sin error, marcadas `TERMINAL_NON_RETRYABLE`. `getPendingQueue(true)`
descarta todo lo que traiga `error_class`
(`pos-offline-db.ts:585`), así que son **invisibles para siempre**. La barra del
POS dice `2 pendientes` y ese contador **nunca va a bajar**.

Un aviso que no se puede resolver enseña a ignorar los avisos. El día que sean 3
porque se atoró un cobro real, nadie va a voltear.

**Estado:** PR #405 monta el drenado que faltaba; PR #409 arregla la causa de
esos dos. **Falta la vía de recuperación para los renglones ya marcados.**

### L-10 · Nunca se manda una mutación sin filtro `VIVA Y CORRECTA`

```
PATCH o DELETE sin '?' en la ruta  ⟹  no se envía
```

**Fuente:** `pos-offline-db.ts:1035` (`esMutacionSinFiltro`).

**Por qué existe:** el 2026-08-31 un `PATCH pos_turnos` sin filtro **cerró once
turnos de un golpe**.

**Comprobada:** esta guarda está funcionando — es la que detuvo el defecto de
L-06 en vez de dejarlo corromper la tabla. **Aflojarla para "arreglar" un
síntoma sería deshacer el arreglo de aquel incidente.**

### L-11 · Una foto incompleta no es un «no hay nada» `ARREGLADA en PR #403`

```
Pedro puede afirmar el estado del salón  ⟺  authoritative Y order_snapshot_complete
```

**Fuente:** `pedro-cliente.ts:56-57` calcula las dos; `pos-cierre-guard.ts`
(`pedroPuedeAfirmarElSalon`) exige las dos.

**Medido el 2026-09-14:** Pedro contestó `authoritative: true` con
`order_snapshot_complete: false` y `salon_orders: []`, y el cierre tomó esa lista
vacía como verdad.

---

## IV. Multi-tenant y acceso

### L-12 · El POS sólo lee por su propia puerta `PARCIALMENTE ARREGLADA en PR #404`

> Toda tabla que el POS pide por `/rest/v1/` tiene que estar declarada en el
> proxy, o da 403 y la pantalla sale vacía **sin decir por qué**.

**Fuente:** `supabase-fetch-patch.ts:52` reencamina todo `/rest/v1/` de una
terminal POS a `/api/pos/db`; `pos-db-policy.ts:22` (`ALLOW`) decide qué pasa.

**Medido el 2026-09-14:** 14 tablas que el POS pide y el proxy rechaza. Dos
rastreadas hasta su consecuencia — el gate de inventario corriendo fail-open para
siempre, y el POS operando con configuración inventada. **Quedan 12 pendientes de
decidir su nivel de escritura.**

### L-13 · Ninguna lectura de negocio cruza de restaurante `DERIVADA`

**Fuente:** `app/api/pos/db/route.ts` fuerza `client_id = eq.<del token>` en cada
consulta, y `SCOPED_BY_OWN_ID` acota por `id` las tablas que no tienen
`client_id` (como `clients`).

---

## V. Lo que falta escribir

Estas se sospechan y **todavía no se han leído de la fuente**. No se usan para
decidir nada hasta que tengan su `archivo:línea`:

- `PENDIENTE` — La orden que se envía al KDS trae los mismos renglones que la comanda.
- `PENDIENTE` — Una orden cobrada libera la mesa, y el plano lo refleja en las tres vistas.
- `PENDIENTE` — `Disponible + Ocupada + Lista = total de mesas`, y `MESAS OCUPADAS n/N` deriva de ahí.
- `PENDIENTE` — Un producto sin estación de ruteo no se puede enviar (o se rutea a un destino declarado).
- `PENDIENTE` — El descuento de inventario ocurre una sola vez por orden.
- `PENDIENTE` — Una orden reenviada no duplica: la idempotencia es por `save_operation_id`.

---

## Cómo se usa esto

1. **Antes de tocar dinero**, leer la ley que aplica y su fuente.
2. **Al encontrar un defecto en campo**, preguntarse qué ley se violó. Si no hay
   ninguna, probablemente falta escribirla.
3. **Al arreglar**, el guardián comprueba **la ley**, no el botón. Un guardián
   anclado a una etiqueta muere con el rediseño; uno anclado a la ley no.
4. **Al rediseñar**, estas leyes no cambian. Lo que no se puede perder en el
   camino está en `scratchpad/validacion-amalay/linea-base/` — la foto de las 33
   pantallas del POS con sus 257 acciones, capturada el 2026-09-14 antes del
   cambio visual.
