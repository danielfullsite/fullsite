# Las órdenes de AMALAY sí llegaron a la nube — y un `DELETE` las quitó

**2026-08-26.** Investigación adversarial. Diagnóstico en **sólo lectura**; la corrección sí
tocó producción, y está detallada al final.

> ## Dictamen, por grado de evidencia
>
> Esta es la parte que importa leer con cuidado. Los cuatro renglones **no son
> intercambiables**, y un borrador anterior de este documento los mezcló.
>
> **HECHO — hubo un `GET` de todo seguido de un `DELETE` de todo.** Observado en los
> registros de Supabase, con hora, filtro, código de respuesta y rol:
> `2026-08-25 20:49:03.208 (America/Monterrey)` · `DELETE /rest/v1/pos_orders?client_id=eq.amalay` · `204`,
> precedido 26 ms antes por el `GET` equivalente.
>
> **HECHO — `/api/pos/admin/cleanup-orders` genera exactamente esa secuencia, y no la
> auditaba.** Leído en el código: `readOrders()` y después `DELETE` con el mismo filtro. Cero
> escrituras a `pos_audit_log`, verificado por búsqueda.
>
> **INFERENCIA FUERTE — el evento observado provino de esa ruta.** La firma coincide (dos
> peticiones, mismo filtro, 26 ms, `service_role`) y es la única ruta del repositorio que la
> produce. Pero *coincidencia de firma no es correlación causal*: haría falta empatar el
> evento con una petición concreta de Vercel — identificador, despliegue, sesión.
>
> **NO VERIFICABLE — la correlación con Vercel.** Se intentó y no se pudo. La razón exacta,
> reproducida: la retención del plan no alcanza el momento del evento, y pedir esa ventana
> devuelve `400 — ExceedsBillingLimitError`, que es un error, no un resultado vacío. Un
> borrador anterior dio otra razón ("1 línea en 24 h") que era **falsa**; la medición real
> está en *"Lo que no se pudo correlacionar"*.
>
> **NO VERIFICADO — quién lo ejecutó, con qué intención, y de dónde salieron los otros
> borrados.** El guardián de la ruta exige nombre `daniel`, pero eso demuestra *quién puede
> pasar*, no *quién pasó*. `pg_stat_user_tables` acumula **514** filas borradas de
> `pos_orders` desde que se reinició la estadística; de ésas, este evento explica **al menos
> 143**. La cifra exacta que borró no se conoce: la respuesta fue `204` sin conteo. **El resto
> —hasta 371 filas— no tiene explicación en este documento.**
>
> Lo que sí queda cerrado: **no hubo falla de sincronización.** El camino
> `POS → save-order → r1_save_order → pos_orders` funciona — por eso había órdenes que
> borrar.
>
> Y el defecto que sí es nuestro, ya corregido: esa acción destructiva **no dejaba rastro**.

---

## Antes que nada: descartar que el problema sea la consulta

La primera obligación era descartar que yo estuviera mirando la tabla equivocada o viendo
sólo una parte.

### ¿Es `pos_orders` la tabla canónica?

Sí, y no por inferencia: leído del cuerpo de la función que escribe.

```sql
-- r1_save_order
INSERT INTO pos_orders (id, client_id, mesa, customer_name, mesero, personas, status, …)
```

`r1_save_order_idempotent` escribe primero el libro de comandos `pos_save_operations` y
delega en `r1_save_order`. No hay tabla de órdenes alterna con datos: el inventario de tablas
con nombre de orden/evento/comando da `pos_orders` 6,304 · `delivery_orders` 20 ·
`pos_local_events` **0** · `pos_purchase_orders` 0.

### ¿Estoy viendo todas las filas?

```
total real de pos_orders ............ 6,304
suma de los conteos por client_id ... 6,304   ← 100%
dueño de la tabla ................... postgres  (= yo)
RLS activo .......................... sí
RLS forzado ......................... NO  → el dueño la evade
```

**La suma por cliente da exactamente el total.** No hay filas ocultas por RLS.

### ¿Están bajo otro `client_id`?

```sql
select count(*) from pos_orders
 where client_id ilike '%amal%' or client_id ilike '%coffee%market%';  -- → 0
```

`amalay` figura en `clients` con `data_source = 'supabase'`, igual que `boruca`, que sí tiene
sus 240 órdenes. No es una variante de identificador.

**Conclusión de esta sección — HECHO:** `pos_orders` es canónica, la veo completa, y no hay
órdenes de AMALAY bajo ningún identificador.

---

## El rastreo del `command_id`

`pos_save_operations` es el libro de comandos: guarda `save_operation_id`, `order_id`,
`payload_hash`, `state`, `committed_revision` y `rejection_detail`.

Fechas en `America/Monterrey`:

| `client_id` | Estado | Operaciones | Rango |
|---|---|---:|---|
| **amalay** | `COMMITTED` | **303** | 2026-07-14 → **2026-08-25** |
| **amalay** | `REJECTED` | 50 | 2026-07-15 → 2026-08-25 |
| *(vacío)* | `COMMITTED` | 7 | 2026-07-27 |
| *(vacío)* | `REJECTED` | 5 | 2026-07-27 |
| demo | `COMMITTED` | 1 | 2026-08-12 |

Trazando cinco operaciones `COMMITTED` recientes de AMALAY de punta a punta
(`completed_at` en `America/Monterrey`, todas del **lunes 25 de agosto**):

| `save_operation_id` | `order_id` | `committed_revision` | `completed_at` | ¿la orden existe? |
|---|---|---:|---|---|
| `9fa0615c…` | `2381109f…` | 1 | 20:47:36 | **no** |
| `b2a98216…` | `0bfe7a43…` | 1 | 20:47:32 | **no** |
| `f0a5a0ff…` | `c3130c56…` | 1 | 20:46:36 | **no** |
| `e97335e2…` | `f1841449…` | 1 | 20:46:35 | **no** |
| `33258a1f…` | `f1ff74d6…` | 1 | 20:24:09 | **no** |

**HECHO:** el libro dice `COMMITTED`, con revisión asignada y hora de término, y la fila no
está. La última se confirmó **87 segundos antes** del `DELETE` de las 20:49:03.

### El control que valida el método — y lo que escondía

El `client_id` vacío tiene **7 operaciones `COMMITTED`** y `pos_orders` tiene **7 filas** con
ese mismo `client_id`. **Cuadran 1:1.**

Como control sirve: demuestra que el mecanismo *puede* funcionar y que el libro *sí* refleja
la realidad cuando la inserción ocurre. El problema es específico de AMALAY, no del diseño
del libro ni de mi forma de consultarlo.

> **Pero un borrador de este documento lo dejó ahí, como una curiosidad benigna. No lo es.**
>
> Al verificar de quién son esas 7 filas, `pos_audit_log` y `pos_print_jobs` responden
> `client_id = 'amalay'`, y el actor registrado es un mesero real de AMALAY. **Son órdenes de
> AMALAY que perdieron su tenant al guardarse**, en una ventana de 5 horas del 26–27 de julio.
> Sobrevivieron a la limpieza del 25-ago precisamente por eso: el `DELETE` filtró
> `client_id=eq.amalay` y ellas no lo tienen.
>
> Es un hallazgo aparte, con su propia causa raíz y su propio fix pendiente:
> [`TENANT-ATRIBUCION-2026-08-26.md`](../audit/TENANT-ATRIBUCION-2026-08-26.md).
>
> La lección de método: **"cuadra 1:1" contesta si el mecanismo funciona, no si el dato es
> correcto.** Dos columnas pueden coincidir perfectamente y ambas estar mal.

---

## Por qué la cola llegó a cero sin que llegara el dato

Las 50 rechazadas de AMALAY se reparten en exactamente dos motivos:

| `rejection_detail` | n | Rango (`America/Monterrey`) |
|---|---:|---|
| `ORDER_NOT_FOUND` | 26 | 2026-07-16 → 2026-08-25 |
| `STALE_WRITE_REJECTED` | 24 | 2026-07-15 → 2026-08-24 |

Son **las mismas dos** que el acta del 24-ago registra como hallazgo, y su resolución está
escrita ahí, textual:

> *"Conservar nube **descarta** solo la operación local conflictiva."*

Encadenado:

```
la orden no está en pos_orders
        ↓
el siguiente guardado falla con ORDER_NOT_FOUND
        ↓
el POS lo presenta como conflicto
        ↓
el gerente elige "conservar nube" → la operación local se DESCARTA
        ↓
la cola baja … hasta 0
```

**INFERENCIA:** parte de la cola se vació por descarte. Ver la sección de clasificación más
abajo — no fue todo descarte: 303 sí se entregaron.

---

## La causa raíz, cerrada por deducción

Al leer los cuerpos completos, dos de las tres hipótesis quedaron **descartadas** y la
conclusión se invirtió.

### El `COMMITTED` y el `INSERT` son atómicos

`r1_save_order_idempotent`, textual:

```sql
v_save_result := r1_save_order( … );

IF (v_save_result->>'ok')::boolean THEN
  UPDATE pos_save_operations SET
    state = 'COMMITTED',
    committed_revision = (v_save_result->>'revision')::bigint,
    completed_at = now()
  WHERE …
```

`r1_save_order` es una función plpgsql llamada desde otra: **corre en la misma transacción.**
El libro sólo pasa a `COMMITTED` si esa función devolvió `ok:true` con revisión.

Por lo tanto: **si existe una fila `COMMITTED`, la transacción se confirmó — y con ella el
`INSERT INTO pos_orders`.** No hay forma de tener una sin la otra.

### ~~H1 — el envoltorio marca COMMITTED sin insertar~~ · DESCARTADA

Sería posible si algún `EXCEPTION` se tragara el fallo y devolviera `ok:true`. Se leyó el
único bloque `EXCEPTION` que existe (en la sobrecarga `text`, oid 28460):

```sql
EXCEPTION WHEN unique_violation THEN
  SELECT order_revision INTO v_current_revision FROM pos_orders WHERE …
  RETURN jsonb_build_object('ok', false, …, 'error', 'STALE_WRITE_REJECTED', …);
```

Atrapa **sólo** `unique_violation` y devuelve `ok:false`. **No se traga nada.**

### ~~H2 — sobrecarga de función~~ · DESCARTADA como causa

Hay dos `r1_save_order` (`p_mesa integer` oid 27937 · `p_mesa text` oid 28460). Es deuda real
—dos cuerpos para un nombre— y hay que resolverla. **Pero no explica esto:** ninguna de las
dos puede devolver `ok:true` sin insertar.

### H3 — las filas se insertaron y se borraron · **ÚNICA QUE SOBREVIVE**

Es lo que queda cuando las otras dos caen, y tiene respaldo propio:

```
pg_stat_user_tables · pos_orders
  insertadas .... 6,869
  borradas ......   514      ← acumulado, sin distinguir cliente
  vivas ......... 6,304
```

**Y no fue nada de dentro de la base.** Se descartó, con consulta, cada mecanismo interno:

| Mecanismo | Resultado |
|---|---|
| Llaves foráneas hacia/desde `pos_orders` | **ninguna** — no hay cascada posible |
| Disparadores | 2, y son `set_pos_order_number` y `set_updated_at`. Ninguno borra |
| Funciones con `DELETE FROM pos_orders` | **0** en `public` y `private` |
| Trabajos de `pg_cron` | 3 activos: `cancel-stale-pending`, `r1-obs-hourly`, `r1-obs-final`. Ninguno borra |
| `DELETE` en el repositorio | Sólo datos de prueba, *teardown* de `nomada` y *seed* de `boruca` |

### HECHO — el borrado, con firma completa

Los registros de Supabase lo resuelven. Único `DELETE` a `pos_orders` en la ventana de
retención (24 h):

| | |
|---|---|
| Momento | **2026-08-25 20:49:03.208 · `America/Monterrey`** |
| El mismo, en UTC | `2026-08-26T02:49:03.208Z` |
| Petición | `DELETE /rest/v1/pos_orders?client_id=eq.amalay` |
| Respuesta | **204** — exitoso |
| Rol | `service_role` · agente `node` · IP `44.211.69.215` (AWS `us-east-1`) |

> **Sobre la fecha.** Los registros de Supabase vienen en UTC, y un borrador anterior de este
> documento copió `2026-08-26T02:49` como si fuera hora local. **No lo es.** En Monterrey
> (UTC−6) fue **la noche del lunes 25**, 87 segundos después del último `COMMITTED`
> (20:47:36). Esto tampoco tiene que ver con la sesión de campo del 23–24 de agosto, que es
> un evento distinto y anterior.

Y 26 milisegundos antes del borrado:

```
02:49:03.182 Z  GET    /rest/v1/pos_orders?client_id=eq.amalay&select=*&order=created_at.asc  200
02:49:03.208 Z  DELETE /rest/v1/pos_orders?client_id=eq.amalay                                204
```

**Leer todo, luego borrar todo.**

### INFERENCIA FUERTE — de dónde vino esa secuencia

`dashboard-app/src/app/api/pos/admin/cleanup-orders/route.ts` hace exactamente eso:
`readOrders()` con `select=*&order=created_at.asc`, y después el `DELETE` con el mismo
filtro. Es la **única** ruta del repositorio que produce esa firma —
`grep -rn "DELETE.*pos_orders"` no devuelve otra fuera de datos de prueba.

**Por qué esto es inferencia y no hecho:** coincidencia de firma ≠ correlación causal. Para
afirmarlo como hecho haría falta empatar el evento con una petición concreta del lado de la
aplicación: identificador de petición, despliegue, registro de la función, sesión. Eso es lo
que no se pudo obtener.

### Lo que NO se pudo correlacionar — `NO VERIFICABLE`

Se intentó empatar el evento con Vercel. **No fue posible.** El veredicto se sostiene, pero
la razón que dio un borrador anterior de este documento **era falsa** y hay que corregirla.

> **Corrección.** Se afirmó *"los registros de ejecución guardan 1 línea en 24 horas"*.
> **No es cierto.** Vueltos a medir el 2026-08-27 01:33 UTC:
>
> | Medición | Resultado |
> |---|---|
> | Líneas en las últimas 6 h | **378**, de un solo despliegue |
> | Rutas distintas en 24 h | **40** |
> | ¿Se registran las rutas de API? | **Sí** — p. ej. `GET /api/health 200`, con método, ruta, estado, despliegue y rama |
>
> La instrumentación funciona bien. Lo que falla es otra cosa.

**Las dos razones reales, ambas reproducidas:**

1. **La retención no llega hasta el evento.** `since: 24h` y `since: 12h` devuelven
   prácticamente el mismo conjunto — no hay nada más viejo que ~12 h. Pedir explícitamente la
   ventana que contiene el `DELETE` (2026-08-26 01:00–12:00 UTC) **falla**:

   ```
   400 Bad Request — {"name":"ExceedsBillingLimitError"}
   ```

   Es un límite del plan, no una ausencia de datos. Y es un error, no un resultado vacío: la
   diferencia importa, porque un resultado vacío se podría leer como "no pasó nada".

2. **Aun dentro de la ventana consultable, `cleanup-orders` no aparece.** Buscar esa cadena
   en las últimas 24 h devuelve cero — pero eso sólo cubre las ~12 h que sí se conservan, no
   el momento del evento.

**Estado: NO VERIFICABLE con la retención contratada hoy** — no "verificado como negativo".
Y es corregible: subir la retención del plan volvería consultable este tipo de evento.
Mientras tanto, la operación nueva se auto-correlaciona (guarda `x-vercel-id` y el
despliegue en su propia fila), así que el próximo evento no dependerá de esto.

Lo que eso implica, dicho sin adornos:

- **No se puede nombrar al actor.** El guardián exige nombre `daniel`, pero eso demuestra
  *quién tiene permiso*, no *quién ejecutó*. Afirmar lo segundo desde lo primero es el mismo
  error de método que este documento ya cometió una vez.
- **No se puede afirmar la intención.** Ni "fueron órdenes de prueba" ni "fue deliberado".
  Que la ruta *exija* confirmación literal demuestra que **alguien la escribió**, no qué
  pensaba quien la escribió.
- **No se puede explicar el resto.** `pg_stat_user_tables` acumula 514 filas borradas. Este
  evento explica **al menos 143** —las órdenes que el libro documenta y que hoy no están—,
  pero **no se sabe cuántas borró en realidad**: `DELETE … client_id=eq.amalay` responde `204`
  sin conteo, y pudo llevarse órdenes que nunca pasaron por el libro. Quedan **hasta 371 sin
  explicación**: podrían ser limpiezas anteriores del mismo tipo, datos de prueba, o algo más.
  Fuera de la ventana de 24 h **no hay forma de saberlo hoy**. Es justo el conteo que la
  operación nueva sí deja escrito (`deleted_count`).

### Qué protecciones sí tenía la ruta — HECHO, leído en el código

- `withPOSAuth` + rol ≥ `gerente` + `canCleanupAllOrders()`, que exige tenant `amalay`,
  nombre `daniel`/`daniel ramonfaur`, y opcionalmente un `staff_id` de una lista por entorno
- El `DELETE` exige el texto literal **`"BORRAR TODAS LAS ORDENES"`** en el cuerpo
- Y un **`digest`** que debe coincidir con el respaldo recién descargado por `GET` — si las
  órdenes cambiaron entre el respaldo y el borrado, responde `409` y no borra

Hubo respaldo, confirmación explícita y control de concurrencia. Eso es lo que el código
garantiza. **No garantiza quién estaba del otro lado.**

### El defecto que sí es nuestro

La ruta **no escribía nada en `pos_audit_log`**. Cero referencias, verificado por búsqueda.

Sin ese renglón, el resultado quedó indistinguible de una catástrofe: `pos_orders` vacío
contra 303 `COMMITTED`, sin nada que explicara la diferencia. Reconstruirlo tomó una
investigación completa y **sólo se resolvió leyendo los registros de Supabase, que caducan a
las 24 horas.** Un día más tarde habría sido irreconstruible.

> **La regla que sale de aquí:** una acción destructiva que no se registra es
> **indistinguible de una pérdida de datos**. No basta con que sea correcta: tiene que ser
> demostrable después.

---

## Los identificadores — el desglose completo

Daniel puso una condición explícita: **no cerrar causa raíz hasta terminar esta tabla**, y no
confundir *operaciones* con *órdenes*. Tenía razón en que no son lo mismo: 303 operaciones
`COMMITTED` **no** son 303 órdenes.

### Operaciones vs. identificadores

| Medida | n |
|---|---:|
| Filas de `pos_save_operations` para `amalay` | **353** |
| — de ellas `COMMITTED` | **303** |
| — de ellas `REJECTED` | **50** |
| `save_operation_id` únicos entre las `COMMITTED` | **303** |
| **`order_id` únicos entre las `COMMITTED`** | **143** |
| `save_operation_id` únicos entre las `REJECTED` | **50** |
| `order_id` únicos entre las `REJECTED` | **25** |
| `order_id` únicos en todo el libro | **145** |

**Sobre reintentos e idempotencia:** los 303 `save_operation_id` son **todos distintos**. No
hay una sola llave repetida, así que **ninguna fila del libro es un reintento del mismo
comando**. La razón de que 303 operaciones den 143 órdenes es otra y es normal: **una orden
recibe varias operaciones a lo largo de su vida** — abrirla, agregar platillos, cobrarla. El
promedio es 2.1 operaciones por orden, y hay al menos una con `committed_revision = 3`.

### Evidencia histórica de inserción — el punto clave

Hasta aquí, todo se apoyaba en un solo libro. La pregunta adversarial es: **¿existe evidencia
independiente de que esas órdenes se insertaron de verdad?**

Sí, y sobrevivió al borrado — porque `pos_orders` **no tiene llaves foráneas** hacia esas
tablas (verificado), así que el `DELETE` no las arrastró:

| Fuente independiente | Cuántas de las 143 corrobora |
|---|---:|
| `pos_reconciliation_results` | **143 / 143** |
| `pos_audit_log` | **143 / 143** |
| `pos_market_movements` | 59 |
| `pos_print_jobs` | 58 |
| `pos_inventory_movements` | 21 |
| `pos_customer_visits` | 0 |
| **Con al menos una corroboración** | **143 / 143** |
| **Sin ninguna corroboración** | **0** |

**Dos fuentes distintas del libro corroboran las 143.** Eso saca la afirmación *"las órdenes
sí se insertaron"* del terreno de "lo dice el libro" y la pone en "lo dicen tres sistemas
que no se escriben entre sí".

### Clasificación de cada identificador

| Clase | n | Qué significa |
|---|---:|---|
| **Insertadas y borradas** | **143** | `COMMITTED` + corroboración independiente + hoy no están |
| **Descartadas por conflicto, pero la orden existió** | 23 | Tienen `REJECTED` *y* `COMMITTED`: el conflicto fue posterior a una inserción buena |
| **Descartadas por conflicto, nunca entraron** | **2** | Sólo `REJECTED`, todas `ORDER_NOT_FOUND` (3 y 4 intentos). Tienen actividad de mesero en `pos_audit_log` pero **cero** rastro en reconciliación, inventario o impresión |
| **No correlacionables** | **0** | No queda ninguna `COMMITTED` sin explicación |

Los dos que nunca entraron:

```
d3a21c8a-…  ORDER_NOT_FOUND ×3   actor: Mario García Ramírez   2026-07-23
fe2a2d52-…  ORDER_NOT_FOUND ×4   actor: Aldo Ruiz Ramirez      2026-07-16
```

Son el caso que el acta del 24-ago describe: el mesero trabajó la orden, el guardado falló
con `ORDER_NOT_FOUND`, el POS lo presentó como conflicto y *"conservar nube"* descartó la
operación local. **La orden existió en la pantalla, nunca en el servidor.**

### Ninguna es posterior al borrado

| | |
|---|---|
| Primera `COMMITTED` | 2026-07-14 20:53:51 `America/Monterrey` |
| Última `COMMITTED` | **2026-08-25 20:47:36** — 87 s antes del `DELETE` |
| Cuántas de las 143 sobreviven | **0** |
| ¿Alguna `COMMITTED` es posterior a las 20:49:03? | **Ninguna** |

Ese último renglón es el que cierra: **el borrado explica el 100 % de las ausencias.** Si
alguna orden confirmada después del `DELETE` faltara, habría un segundo problema. No lo hay.

### Lo que el libro NO alcanza a ver

Barriendo las tablas corroborantes sin pasar por el libro aparecen **255 `order_id` de
AMALAY con evidencia independiente** — o sea **110 más** de los 145 que el libro conoce.
Probablemente son anteriores al envoltorio idempotente, o entraron por otra ruta.

De esos 255, **247 ya no existen** y **8 siguen vivos** — pero bajo *otro* `client_id`. Eso
resultó ser un hallazgo aparte y serio, documentado en
[`TENANT-ATRIBUCION-2026-08-26.md`](../audit/TENANT-ATRIBUCION-2026-08-26.md).

**Conclusión sobre el conteo:** el evento borró **al menos 143** órdenes; la cifra exacta no
se conoce, porque la respuesta fue `204` sin conteo y pudo llevarse órdenes que nunca pasaron
por el libro. Es justo el número que la operación nueva sí deja escrito (`deleted_count`).

---

## Clasificación de las operaciones de AMALAY

Con la deducción de arriba, cada operación del libro se puede clasificar:

| Estado | n | Qué significa |
|---|---:|---|
| **ENTREGADO** | **303** | `COMMITTED` ⇒ el `INSERT` se confirmó. Llegaron a la nube |
| **DESCARTADO POR CONFLICTO** | 50 | `REJECTED`: 26 `ORDER_NOT_FOUND` + 24 `STALE_WRITE_REJECTED`. Nunca se insertaron, y el POS los presentó como conflicto |
| **IDEMPOTENTE** | 0 observados | La ruta existe (`idempotent_replay`), pero no hay reintentos del mismo `save_operation_id` en la muestra |
| **NO RECIBIDO** | **0** | Ninguna operación quedó sin veredicto del servidor |
| **NO VERIFICABLE** | — | *Qué pasó con las 303 después de insertarse.* El borrado no dejó rastro consultable |

### La ventana exacta de la sesión de campo

Zona horaria `America/Monterrey`, no UTC:

| | |
|---|---|
| Primera operación | **2026-08-23 19:15:56** |
| Última operación | **2026-08-24 00:58:36** |
| `COMMITTED` | **12** (8 el día 23, 4 el 24) |
| `REJECTED` | 3 |

**Doce órdenes se confirmaron esa noche.** Ninguna existe hoy.

## ¿Pudo *"Conservar nube"* vaciar la cola sin insertar nada?

**Sí, y está probado por código, no supuesto.**

Cuando la orden no está en `pos_orders`, `r1_save_order` devuelve:

```sql
IF NOT v_exists THEN
  RETURN jsonb_build_object('ok', false, 'revision', NULL, 'conflict', false,
    'error', 'ORDER_NOT_FOUND');
```

El envoltorio marca `REJECTED`, el POS lo presenta como conflicto, y el acta documenta la
resolución: *"Conservar nube **descarta** solo la operación local conflictiva."*

```
orden ausente → ORDER_NOT_FOUND → REJECTED → conflicto en pantalla
    → el gerente elige "conservar nube" → la operación local se DESCARTA
    → el contador baja … hasta 0
```

**HECHO:** hay 26 `ORDER_NOT_FOUND` de AMALAY. **INFERENCIA:** parte de la cola llegó a cero
por descarte, no por entrega. Ambas cosas pueden coexistir, y de hecho coexisten: 303
entregadas y 50 descartadas.

## Riesgos y qué NO hacer

- **No encender `OFFLINE_OUTBOX_SHADOW`** esperando arreglar esto. Ese worker llena
  `pos_local_events`, no `pos_orders`. Está documentado desde la noche del 23-24.
- **No declarar pérdida de datos.** AMALAY factura en Wansoft; el POS de Fullsite no está en
  servicio. Y las órdenes no se perdieron: un `DELETE` las quitó después de haberse guardado
  bien. No es dinero perdido ni sincronización rota.
- **No tocar producción para diagnosticar.** Todo el diagnóstico de arriba se obtuvo en
  lectura. La corrección sí escribió en producción — migración aditiva, con rollback al
  final de este documento — y sus pruebas corrieron sobre un tenant sintético.

## Impacto real — corregido respecto al borrador anterior

Un borrador de este documento decía *"bloqueador duro del cutover: el camino está roto"*.
**Eso era falso**, y se escribió cuando la hipótesis vigente era que las órdenes nunca habían
llegado. Los hechos lo desmienten: 303 operaciones `COMMITTED` sobre 143 órdenes demuestran
que `POS → save-order → r1_save_order → pos_orders` **funciona de punta a punta**.

Lo que sí queda tocado:

- **`Cola final = PASÓ` no sirve como evidencia de sincronización.** La cola llega a cero
  tanto por entrega como por descarte de conflictos (26 `ORDER_NOT_FOUND` + 24
  `STALE_WRITE_REJECTED`). Ambas cosas se ven igual en pantalla. La evidencia buena es el
  libro de operaciones, no el contador.
- **El certificado de la sesión del 23–24 se debilita en un punto**, no en su conjunto: la
  frase *"reconexión y cola 0"* no distingue esos dos caminos.
- **La instrumentación del lado de la aplicación no alcanza para una investigación
  forense.** Un evento con consecuencia total sobre un tenant no tuvo contraparte en los
  registros de ejecución. Eso es un hallazgo por derecho propio.

---

# La corrección

## Los dos intentos que no servían

**Primero:** escribir la auditoría *después* del `DELETE`, envuelta en `try/catch` para no
convertir un borrado exitoso en un `500`. Daniel lo rechazó:

> *"Si el borrado termina y la auditoría falla, vuelve a quedar invisible exactamente como
> ahora."*

Correcto. Un registro *best-effort* de una acción destructiva **no es un registro**: es una
esperanza. El modo de falla a cubrir no es "se me olvidó auditar" — es "la auditoría no
llegó" — y `try/catch` lo garantiza en vez de impedirlo.

**Segundo:** meter `STARTED`, el `DELETE` y `FAILED` en una sola función plpgsql. Se ve
atómico y correcto. Daniel también lo rechazó, y también tenía razón:

> *"No metas ingenuamente `STARTED`, DELETE y `FAILED` en una sola transacción: si la
> transacción falla, el estado `FAILED` también se revierte."*

Y con él se revierte el `STARTED`. **La migración anterior presumía en su comentario que
"una interrupción deja huella en vez de silencio". Era falso**, y era el mismo defecto que
venía a corregir.

### Demostrado, no argumentado

Se ejecutaron los dos diseños contra la misma caída — una excepción justo después del
`DELETE`, que es lo que pasa cuando revienta el `statement_timeout` o se cae la conexión:

| Diseño | Filas en el libro tras la caída |
|---|---:|
| Una sola transacción (el anterior) | **0** |
| Tres fases (el actual) | **1**, en estado `STARTED` |

```
-- El contrafactual, corrido en producción sobre un tenant sintético:
do $$ begin
  insert into pos_cleanup_operations (...) values (..., 'STARTED', ...);
  delete from pos_orders where client_id='__t_alfa__';
  raise exception 'misma caida, diseno viejo (habia borrado % filas)', v_n;
end $$;
--  → rastro_del_diseno_viejo: 0
--  → rastro_del_diseno_nuevo: 1
```

> **La regla que sale de aquí**, y que vale para cualquier operación destructiva:
>
> La intención se registra en una transacción. El efecto, en otra. El fracaso, en una
> tercera. **Un registro que comparte transacción con lo que describe no puede describir el
> fracaso de esa transacción.**

## El protocolo

`supabase/migrations/20260826230000_cleanup_orders_protocolo_tres_fases.sql`

```
Fase 1 · r1_cleanup_begin()    transacción propia → respaldo + 'STARTED'. Confirma.
Fase 2 · r1_cleanup_commit()   transacción propia → FOR UPDATE, valida, DELETE, 'COMMITTED'
Fase 3 · r1_cleanup_fail()     transacción propia → 'FAILED', sólo si la 2 falló
```

La fase 2 es la única que necesita ser atómica, y lo es: o quedan el `DELETE` y el
`COMMITTED`, o no queda ninguno de los dos.

**La propiedad que se sigue: si no se pudo escribir la constancia, no se borra.** La fase 1
es un requisito, no un adorno — la inversión exacta del diseño *best-effort*, donde el
borrado iba primero y la constancia era una esperanza.

| Lo que pediste | Cómo se cumple |
|---|---|
| `STARTED` durable antes del borrado | Fase 1, transacción propia. Sobrevive a que la 2 aborte — demostrado arriba |
| `operation_id` único, actor, `staff_id`, tenant, rol, motivo, confirmación, digest, cantidad esperada, timestamp | Columnas obligatorias de `pos_cleanup_operations` |
| Metadata de petición no sensible | `request_metadata`: `x-vercel-id`, despliegue, user-agent. **Sin** token, cookie, PIN ni IP |
| Una sola RPC transaccional que bloquee el `operation_id` | Fase 2 abre con `SELECT … FOR UPDATE` |
| Valide tenant / digest / conteo | El tenant se compara contra lo que dejó la fase 1, no contra lo que dice quien llama. El digest es SHA-256 sobre las filas. El conteo se revalida dentro |
| Impida doble ejecución | Estados terminales se responden, no se re-ejecutan |
| Borre únicamente el tenant objetivo | `delete … where client_id = v_op.client_id`, tomado de la fila, nunca del parámetro |
| `FAILED` en operación posterior independiente | Fase 3, y se niega a degradar un `COMMITTED` |
| Reintento tras timeout devuelve `COMMITTED` | Fase 2 y fase 3 lo devuelven; la ruta lo traduce a éxito |
| Detectar y alertar `STARTED` estancadas | Vista `pos_cleanup_atoradas` + índice parcial; el `GET` de la ruta la expone al operador antes de arrancar otra limpieza |
| Respaldo antes de `STARTED`, con SHA-256 y restauración probada | El respaldo se toma del lado del servidor y queda en la misma fila que se confirma; su hash se verifica antes de restaurar |
| Permisos: ningún cliente POS puede falsificar auditoría ni borrar | Ver abajo |

### El caso ambiguo se resuelve solo

Si la fase 2 se corta por red, no se sabe si borró. **La fase 3 lo resuelve sin adivinar:**
`r1_cleanup_fail` se niega a degradar un `COMMITTED`, así que su respuesta *es* el veredicto.
Si contesta `YA_ESTABA_COMMITTED`, el borrado ocurrió y la ruta reporta éxito; si marca
`FAILED`, no ocurrió. En ningún punto hay que suponer.

### Permisos — comprobados, no supuestos

```
r1_cleanup_begin     anon:false  authenticated:false  service_role:true
r1_cleanup_commit    anon:false  authenticated:false  service_role:true
r1_cleanup_fail      anon:false  authenticated:false  service_role:true
r1_cleanup_restore   anon:false  authenticated:false  service_role:true

pos_cleanup_operations   anon: sin lectura ni escritura · authenticated: igual · RLS activo, 0 políticas
pos_cleanup_atoradas     igual
```

El POS escribe desde el navegador con la llave `anon` (ver `print-queue.ts`, `pos-data.ts`).
Esa llave no llega ni a la tabla ni a las funciones, así que **no puede falsificar una
auditoría ni ejecutar un borrado.**

## Evidencia — trece escenarios contra las funciones reales en producción

Sobre tenants sintéticos `__t_alfa__` (3 órdenes) y `__t_beta__` (1), nunca sobre datos de
AMALAY:

| # | Escenario | Esperado | Observado |
|---|---|---|---|
| **P0** | **Caída después del `DELETE`** | `STARTED` sobrevive, órdenes vuelven | `STARTED` · 3 órdenes · respaldo intacto ✓ |
| **P0b** | **Contrafactual: el diseño de una transacción** | pierde todo | **0 filas en el libro** ✓ |
| P1 | Fase 3 tras el fallo | `FAILED` | `FAILED` ✓ |
| P2 | Commit sin fase 1 *(auditoría inaccesible)* | no borra | `SIN_FASE_1` ✓ |
| P3 | Tenant cruzado: llave de alfa para borrar beta | rechazo | `TENANT_NO_COINCIDE` · ambos intactos ✓ |
| **P4** | **Digest viejo con el MISMO conteo** | rechazo | `DIGEST_NO_COINCIDE` · `conteo_fase1: 3`, `conteo_ahora: 3` ✓ |
| P5 | Conteo equivocado en la fase 1 | ni se abre | `CONTEO_CAMBIO` · **0 filas creadas** ✓ |
| P6 | Confirmación inválida | rechazo | `CONFIRMACION_INVALIDA` ✓ |
| P7 | Camino feliz | `COMMITTED` | `deleted: 3` ✓ |
| P8 | Reintento con la misma llave | replay | `replay: true, deleted: 3` ✓ |
| P9 | Fase 3 sobre un `COMMITTED` | se niega | `YA_ESTABA_COMMITTED` ✓ |
| P10 | Fase 1 repetida tras `COMMITTED` | replay | `replay: true` ✓ |
| **P11** | **Restauración** | fiel | `restored: 3` · **hash de lo restaurado == hash del respaldo** ✓ |
| P12 | Respaldo manipulado | se niega | `RESPALDO_CORRUPTO` ✓ |
| **P13** | **Concurrencia real, dos conexiones** | se serializa | ver abajo |

**P4 merece atención:** el conteo era idéntico (3 y 3) y aun así lo detuvo el hash. Un
control por conteo —el que tenía el diseño anterior— **habría borrado**.

**P11 no se conformó con "aparecieron 3 filas".** Se recalculó el SHA-256 sobre las filas
repuestas y se comparó con el del respaldo:

```
hash_de_lo_restaurado : 55bfe7e0…390e260
hash_del_respaldo     : 55bfe7e0…390e260
restauracion_fiel     : true
```

**P13 — concurrencia real, no simulada.** Se usó `pg_cron` para tener una segunda conexión
de verdad: un job ejecutó la fase 2 y retuvo la transacción abierta. Desde otra sesión se
llamó la misma operación:

```
jobs_corriendo: 1 · bloqueos_exclusivos: 1 · estado visible desde mi sesión: STARTED
→ segunda petición: BLOQUEADA 2.32 s
→ al liberarse: { ok: true, state: 'COMMITTED', replay: true, deleted: 3 }
```

Se serializó, esperó, y **devolvió el resultado anterior en vez de volver a borrar.** El job
se desprogramó de inmediato (`cron.unschedule`), verificado: quedan los 3 jobs preexistentes.

**Estado tras limpiar las pruebas:** `residuo_mio: 0` · `filas_en_el_libro: 0` ·
`amalay: 0` · los 3 `cron.job` de siempre. El total global subió de 6,309 a 6,316 por 12
órdenes de `lab-resto` creadas por otro proceso en paralelo — verificado, no mío.

## Evidencia — la capa web

`dashboard-app/src/__tests__/cleanup-orders-transaccional.test.ts` · **14 pruebas**.

Incluye auditoría inaccesible, timeout después del commit, doble clic, replay, digest viejo,
conteo cambiado a media operación, tenant cruzado, fase 3 caída, y **que la metadata no lleve
credenciales**.

Prueba de mutantes — lo que separa una prueba real de una decorativa:

| Mutación | Pruebas que fallan |
|---|---:|
| Saltarse la fase 1 e ir directo al `commit` | **9 de 14** |
| No llamar la fase 3 ante un corte | **10 de 14** |
| Permitir que la fase 3 degrade un `COMMITTED` | 1 de 14 |

Suite completa: **2,419 / 2,419** en 99 archivos · `tsc --noEmit` limpio · `eslint` limpio en
los archivos tocados.

## Lo que falta, dicho como pendiente

- **La alerta de `STARTED` atorado es pasiva.** La vista existe y el `GET` de la ruta la
  muestra al operador antes de que arranque otra limpieza. **No hay aviso automático** — no
  llega a Telegram ni a ningún lado. Un `STARTED` atorado a las 3 a.m. no despierta a nadie.
- **La correlación con el lado de la aplicación queda resuelta hacia adelante, no hacia
  atrás.** La operación guarda ahora `x-vercel-id` y el despliegue, así que el próximo evento
  sí será correlacionable. El del 2026-08-25 no lo será nunca.
- **Hasta 371 filas borradas siguen sin explicación**, y fuera de la retención de registros
  no hay forma de investigarlas hoy.
- **La carrera entre el `SELECT` y el `INSERT` de la fase 1** se cerró con un manejador de
  `unique_violation` — pero **forzar ese entrelazado exacto no se probó**: requiere dos
  conexiones colisionando en una ventana de microsegundos. Es correcto por construcción y es
  el mismo patrón que ya usa `r1_save_order`; no está verificado por ejecución.

## Un agujero que abrí, y cerré, la misma noche

Antes de este rediseño, la migración `20260826200000` hacía `REVOKE ALL … FROM PUBLIC, anon`
y yo **di por hecho** que con eso la función quedaba sólo para `service_role`. Falso: Supabase
otorga `EXECUTE` a `authenticated` por `ALTER DEFAULT PRIVILEGES`, como grant **directo**, que
un `REVOKE` a `PUBLIC` no toca.

Permitía que cualquier usuario con sesión iniciada, de cualquier restaurante, borrara las
órdenes de otro tenant llamando el RPC directo. Lo detectó el linter de Supabase, no yo.

Detalle y barrido del patrón en
[`SECDEF-GRANTS-AUTHENTICATED-2026-08-26.md`](../audit/SECDEF-GRANTS-AUTHENTICATED-2026-08-26.md).

> **Corrección del 2026-08-27.** Ese documento afirmaba que `r1_save_order` tampoco validaba
> tenant y que su grant a `authenticated` permitía escritura cruzada. **Era falso** — la
> función abre con `IF NOT private.can_write_client(p_client_id) THEN … FORBIDDEN_CLIENT`, y
> ejecutarlo lo confirma: un llamador `authenticated` es rechazado. El error fue buscar
> cuatro cadenas en el cuerpo en vez de leerlo; la comprobación entra por una indirección
> que no busqué.
>
> Al verificarlo apareció el camino que sí estaba abierto, y es peor: el proxy
> `/api/pos/db/[...path]` prestaba `service_role` a cualquier RPC, y el guardián deja pasar
> a `service_role` por diseño. Cerrado en
> [PR #169](https://github.com/danielfullsite/fullsite/pull/169).
>
> **Un `REVOKE` a `authenticated` no protege de quien llega como `service_role`.**

## Rollback

```sql
drop function if exists public.r1_cleanup_begin(text,text,text,text,text,text,text,integer,jsonb);
drop function if exists public.r1_cleanup_commit(text,text);
drop function if exists public.r1_cleanup_fail(text,text);
drop function if exists public.r1_cleanup_restore(text);
drop view     if exists public.pos_cleanup_atoradas;
drop table    if exists public.pos_cleanup_operations;
```

Todo es aditivo y nada existente depende de ello. Revertir la ruta y el cliente devuelve el
comportamiento anterior — que es exactamente el defecto, así que revertir sólo tiene sentido
si el protocolo resulta estar roto.
