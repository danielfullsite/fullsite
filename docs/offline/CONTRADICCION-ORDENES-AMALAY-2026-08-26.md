# Las órdenes de AMALAY sí llegaron a la nube — y algo las borró después

**2026-08-26.** Investigación adversarial, **sólo lectura**, sin tocar producción.

> **Advertencia de alcance.** La conclusión de este documento **se invirtió** durante la
> investigación. La lectura inicial fue *"las órdenes nunca llegaron"*; leer los cuerpos de
> las funciones demuestra lo contrario. Todo va marcado como **HECHO**, **INFERENCIA** o
> **NO VERIFICADO**, y no se declara pérdida de datos: se declara borrado posterior de origen
> no identificado.

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

| `client_id` | Estado | Operaciones | Rango |
|---|---|---:|---|
| **amalay** | `COMMITTED` | **303** | 2026-07-15 → **2026-08-26** |
| **amalay** | `REJECTED` | 50 | 2026-07-15 → 2026-08-26 |
| *(vacío)* | `COMMITTED` | 7 | 2026-07-27 |
| *(vacío)* | `REJECTED` | 5 | 2026-07-27 |
| demo | `COMMITTED` | 1 | 2026-08-12 |

Trazando cinco operaciones `COMMITTED` recientes de AMALAY de punta a punta:

| `save_operation_id` | `order_id` | `committed_revision` | `completed_at` | ¿la orden existe? |
|---|---|---:|---|---|
| `9fa0615c…` | `2381109f…` | 1 | 02:47:36 | **no** |
| `b2a98216…` | `0bfe7a43…` | 1 | 02:47:32 | **no** |
| `f0a5a0ff…` | `c3130c56…` | 1 | 02:46:36 | **no** |
| `e97335e2…` | `f1841449…` | 1 | 02:46:35 | **no** |
| `33258a1f…` | `f1ff74d6…` | 1 | 02:24:09 | **no** |

**HECHO:** el libro dice `COMMITTED`, con revisión asignada y hora de término, y la fila no
está.

### El control que valida el método

El `client_id` vacío tiene **7 operaciones `COMMITTED`** y `pos_orders` tiene **7 filas** con
ese mismo `client_id`. **Cuadran 1:1.**

Eso importa: demuestra que el mecanismo *puede* funcionar y que el libro *sí* refleja la
realidad cuando la inserción ocurre. El problema es específico de AMALAY, no del diseño del
libro ni de mi forma de consultarlo.

---

## Por qué la cola llegó a cero sin que llegara el dato

Las 50 rechazadas de AMALAY se reparten en exactamente dos motivos:

| `rejection_detail` | n | Rango |
|---|---:|---|
| `ORDER_NOT_FOUND` | 26 | 2026-07-16 → 2026-08-26 |
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

**INFERENCIA (fuerte):** las órdenes de AMALAY **llegaron a la nube y se borraron después**,
desde fuera de la base — un cliente con `service_role`, el panel de Supabase, o una acción
manual.

**NO VERIFICADO:** quién, cuándo y con qué alcance. Eso no se puede reconstruir desde las
tablas actuales; requeriría registros de auditoría del proyecto Supabase.

> **Esto invierte la conclusión inicial.** No es *"las órdenes nunca llegaron"* — el camino de
> sincronización **sí funciona**. Es que algo las está quitando después.

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
  servicio. Lo que hay es un camino roto, no dinero perdido.
- **No tocar producción para diagnosticar.** Todo lo de arriba se obtuvo en lectura.

## Impacto real

**Bloqueador duro del cutover.** Cambiar a AMALAY a Fullsite con este camino roto sí
significaría perder órdenes de verdad.

Y hacia atrás: invalida `Cola final = PASÓ` como evidencia de sincronización, y debilita el
`CERTIFICADO` que el acta otorga a Caja, Entrada y Escondite — porque ese certificado incluye
*"reconexión y cola 0"*.

## Siguiente paso decisivo

Leer completos los cuerpos de `r1_save_order_idempotent` y de las dos `r1_save_order`, y
seguir qué ocurre entre la inserción y el `COMMITTED`. Es lectura, no requiere campo, y
distingue H1 de H2 de una vez.
