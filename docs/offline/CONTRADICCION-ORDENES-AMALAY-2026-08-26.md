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
> evento con una petición concreta de Vercel — identificador, despliegue, sesión. Se intentó.
> **No se pudo** (ver *"Lo que no se pudo correlacionar"*).
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

### El control que valida el método

El `client_id` vacío tiene **7 operaciones `COMMITTED`** y `pos_orders` tiene **7 filas** con
ese mismo `client_id`. **Cuadran 1:1.**

Eso importa: demuestra que el mecanismo *puede* funcionar y que el libro *sí* refleja la
realidad cuando la inserción ocurre. El problema es específico de AMALAY, no del diseño del
libro ni de mi forma de consultarlo.

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

### Lo que NO se pudo correlacionar

Se intentó empatar el evento con Vercel. **No fue posible, y la razón es concreta:**

```
Consulta de registros de ejecución, ventana de 24 h → 1 (una) línea en total
```

Reproducido con dos consultas distintas. El plan actual conserva registros de ejecución de
forma tan limitada que el `DELETE` no tiene contraparte consultable. **Estado: NO VERIFICABLE
con la instrumentación de hoy** — no "verificado como negativo".

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

## Los identificadores — qué órdenes, exactamente

Daniel pidió los identificadores que ligan las 303 operaciones `COMMITTED` con las órdenes
afectadas, en vez de un número suelto. Consultado directamente:

| | |
|---|---|
| Operaciones `COMMITTED` | **303** |
| Órdenes distintas que representan | **143** (varias operaciones por orden: guardar, agregar, cobrar) |
| Primera | 2026-07-14 20:53:51 `America/Monterrey` |
| Última | **2026-08-25 20:47:36** — 87 s antes del `DELETE` |
| Cuántas sobreviven hoy | **0** |
| ¿Alguna es posterior al `DELETE`? | **Ninguna.** Todas caen antes de las 20:49:03 |

Ese último renglón importa más de lo que parece: **el borrado explica el 100 % de las
ausencias.** No queda ni una orden `COMMITTED` cuya desaparición haya que atribuir a otra
cosa. Si alguna fuera posterior al `DELETE` y aun así faltara, habría un segundo problema —
no lo hay.

Muestra de `order_id` afectados (los mismos que la tabla de trazado, más uno con tres
guardados y revisión 3, que confirma que el ciclo de vida completo funcionaba):

```
2381109f…   0bfe7a43…   c3130c56…   f1841449…   f1ff74d6…
85144b39…   ← 3 operaciones COMMITTED, committed_revision = 3
```

La lista completa de los 143 vive en el respaldo que ahora guarda la propia operación
(`pos_cleanup_operations.backup`); para este evento **no existe**, porque el respaldo se
descargó al navegador del operador y la ruta de entonces no conservaba copia. Es
exactamente el agujero que cierra el rediseño.

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

## Por qué el primer arreglo no servía

El primer intento escribía la auditoría **después** del `DELETE`, envuelta en `try/catch`
para no convertir un borrado exitoso en un `500`. Daniel lo rechazó con el argumento correcto:

> *"Si el borrado termina y la auditoría falla, vuelve a quedar invisible exactamente como
> ahora."*

Es exacto. Un registro *best-effort* de una acción destructiva **no es un registro**: es una
esperanza. El modo de falla que hay que cubrir no es "la ruta se le olvidó auditar" —es "la
auditoría no llegó"— y `try/catch` lo garantiza en vez de impedirlo.

## Qué se construyó

`supabase/migrations/20260826200000_cleanup_orders_transaccional.sql` — el borrado se movió
adentro de la base, donde puede ser atómico con su constancia.

| Propiedad | Cómo se logra |
|---|---|
| **Idempotente** | `operation_id` es la llave primaria del libro. Repetirlo devuelve el resultado anterior, sin volver a borrar |
| **Registro duradero de inicio** | Se inserta `STARTED` **antes** de leer o borrar nada |
| **Actor, tenant, motivo, digest, cantidad esperada** | Columnas de `pos_cleanup_operations`, obligatorias al iniciar |
| **Borrado y constancia atómicos** | `DELETE` y `UPDATE … 'COMMITTED'` en la misma función plpgsql ⇒ misma transacción. O quedan los dos, o ninguno |
| **`STARTED` / `COMMITTED` / `FAILED`** | Restricción `CHECK` en la columna `state` |
| **Reintento seguro** | Consulta por `operation_id` antes de actuar; responde `replay: true` |
| **Respaldo con restauración probada** | El respaldo completo se guarda en la propia fila; `r1_cleanup_restore()` lo repone sin pisar órdenes que ya existan |
| **Alerta de `STARTED` sin resolver** | Índice parcial `WHERE state = 'STARTED'` — ver más abajo |

La capa web ya no borra: valida el digest (que el operador vio esas órdenes) y delega. El
control que de verdad protege —el conteo— vive **dentro** de la transacción, porque entre la
lectura de la ruta y el borrado cabe una orden nueva.

## Evidencia — seis modos de falla, contra la función real en producción

Ejecutados sobre un tenant sintético `__cleanup_test__`, nunca sobre datos de AMALAY:

| # | Escenario | Resultado esperado | Observado |
|---|---|---|---|
| P1 | Conteo equivocado (esperaba 5, había 3) | No borra, queda `FAILED` | `FAILED` · 3 órdenes intactas ✓ |
| P2 | Conteo correcto | `COMMITTED`, borra, guarda respaldo | `COMMITTED` · `deleted:3` · respaldo de 3 ✓ |
| P3 | Mismo `operation_id` otra vez | `replay`, sin volver a borrar | `replay:true` · sin segundo borrado ✓ |
| P4 | Restaurar desde el respaldo | Reponer las 3 | `restored:3, del_respaldo:3` ✓ |
| P5 | Nueva llave después de restaurar | `COMMITTED` normal | `COMMITTED` ✓ |
| P6 | Carrera tardía: tabla ya vacía, esperaba 3 | `CONTEO_CAMBIO` | `CONTEO_CAMBIO/FAILED` ✓ |

Estado tras la limpieza de las pruebas — verificado en consulta aparte, porque una subconsulta
en el mismo `SELECT` que el RPC lee la instantánea previa y da un número falso (ese error se
cometió y se corrigió):

```
sobra_prueba: 0 · filas_en_libro: 0 · total_global: 6,309 · amalay: 0
```

Idéntico al estado previo a aplicar la migración.

## Evidencia — la capa web

`dashboard-app/src/__tests__/cleanup-orders-transaccional.test.ts` · **10 pruebas**, incluidas
doble petición, timeout **después** del commit, digest vencido, tenant cruzado y RPC caído.

Prueba de mutantes, que es lo que distingue una prueba real de una decorativa:

| Mutación | Pruebas que fallan |
|---|---:|
| Quitar la exigencia de `operation_id` | 1 |
| **Volver al `DELETE` directo + auditoría best-effort** | **6** |

Suite completa del tablero: **2,415 pruebas en 99 archivos, todas verdes.** `tsc --noEmit`
limpio. `eslint` limpio en los archivos tocados (los 7 avisos de `monitor/page.tsx` son
preexistentes e idénticos en `HEAD`).

## Lo que falta, dicho como pendiente y no como hecho

- **La alerta de `STARTED` atorado no existe todavía.** El índice parcial que la hace barata
  sí está; falta quien la consulte y avise. Hoy la consulta es esta, y hay que correrla a
  mano:

  ```sql
  select operation_id, client_id, actor, started_at, now() - started_at as lleva
    from pos_cleanup_operations
   where state = 'STARTED' and started_at < now() - interval '5 minutes';
  ```

- **La correlación con el lado de la aplicación sigue sin resolverse.** Mientras los
  registros de ejecución conserven una línea por día, el próximo evento tampoco será
  correlacionable. Es un pendiente de plataforma, no de esta ruta.
- **Las 371 filas borradas restantes siguen sin explicación**, y fuera de la ventana de 24 h
  no hay forma de investigarlas con lo que existe hoy.

## Rollback

```sql
DROP FUNCTION IF EXISTS public.r1_cleanup_orders(text,text,text,text,text,text,integer,text);
DROP FUNCTION IF EXISTS public.r1_cleanup_restore(text);
DROP TABLE IF EXISTS public.pos_cleanup_operations;
```

La tabla es aditiva y nada existente depende de ella. Revertir la ruta y el cliente devuelve
el comportamiento anterior — que es exactamente el defecto, así que revertir sólo tiene
sentido si el RPC resulta estar roto.
