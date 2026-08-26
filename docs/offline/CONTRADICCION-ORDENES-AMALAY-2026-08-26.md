# Contradicción: 303 guardados `COMMITTED` de AMALAY, cero órdenes en la nube

**2026-08-26.** Investigación adversarial, **sólo lectura**, sin tocar producción.

> **Advertencia de alcance.** Esto **no** declara pérdida de datos. Declara una contradicción
> interna de la base que está probada, y una causa raíz que **no** está probada. Las
> hipótesis van marcadas como tales.

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

**INFERENCIA (bien soportada, no probada):** así es como `0 pendientes` pudo convivir con
cero órdenes en la nube. La cola no se vació porque los datos llegaran, sino porque las
operaciones que no podían escribirse se descartaron.

---

## Lo que NO está probado: por qué no queda la fila

Tres candidatos. Ninguno demostrado; van en orden de lo que la evidencia sugiere.

### H1 — El envoltorio marca `COMMITTED` sin que la inserción quede

`r1_save_order_idempotent` escribe el libro y delega. Si la delegación no persiste y el
envoltorio igual marca `COMMITTED`, se ve exactamente lo observado. **Prueba pendiente:**
leer completos ambos cuerpos y seguir el manejo de excepciones.

### H2 — Sobrecarga de función

Hay **dos** `r1_save_order`, idénticas salvo en un parámetro:

| oid | `p_mesa` | guardián | `SECURITY DEFINER` |
|---|---|---|---|
| 27937 | `integer` | sí | sí |
| 28460 | `text` | sí | sí |

Cuál se ejecuta depende del tipo que mande el llamador. **Debilita esta hipótesis:** los
eventos de AMALAY traen `mesa` numérica en 1,056 de 1,073 casos. Pero dos cuerpos distintos
para el mismo nombre es deuda real y hay que resolverla igual.

### H3 — Algo borra las filas

`pg_stat_user_tables` reporta **514 filas borradas** de `pos_orders` (acumulado, sin
distinguir cliente). **Debilita esta hipótesis:** no hay en el repositorio ningún `DELETE`
sobre órdenes de AMALAY — los que existen son de datos de prueba, del *teardown* de `nomada`
y del *seed* de `boruca`.

---

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
