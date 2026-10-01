# P0B — COMMAND RECEIPTS / REPLAY SEMANTICS

> **Sprint:** Architecture & Industry Intelligence Lab — Track P0B (único). **Fecha:** 2026-09-18.
> **Modo:** research read-only. No se tocó código, ni DB, ni P0A. No se implementó nada.
> **Pregunta central:** cómo conseguir *at-least-once delivery* + *exactly-once business effect*
> sin depender de interpretar un HTTP 409, releer la fila y adivinar si el duplicado era nuestro.

**Convención de evidencia:** **[FACT]** = está en la fuente citada o en el `archivo:línea` citado ·
**[INFER]** = deducción mía · **[REC]** = recomendación.

---

## ⚠️ CORRECCIÓN AL TRACK A — leer antes que nada

**El Track A de ayer leyó el working tree, que está 663 commits atrás de `origin/main`.**

```
HEAD  ab38234c  feat/pos-ui-kit
origin/main  10017cf9
git rev-list --left-right --count HEAD...origin/main  →  58   663
```

Consecuencia concreta, y es grande:

| Afirmación del Track A | La verdad en `origin/main` |
|---|---|
| "El inventario deduplica con un `LIKE` sobre texto libre, sin constraint" | **Falso en `main`.** Existe `pos_record_inventory_movement` con tabla de recibos, `movement_operation_key` + índice único parcial, advisory lock, comparación de intent y replay del resultado guardado ([20260910050000_inventory_movement_atomic.sql](../../../supabase/migrations/20260910050000_inventory_movement_atomic.sql)) **[FACT]**. El `LIKE` que cité es código viejo del working tree. La propia migración detecta los movimientos legacy y los rechaza con `LEGACY_MOVEMENT_REQUIRES_RECONCILIATION` (líneas 60-66). |
| "P0D-INVENTORY-DEDUP-RACE" como hallazgo abierto | **Mayormente cerrado en `main`.** Lo que queda abierto es otra cosa, y es más interesante: la puerta trasera REST sigue abierta (§10). |

**Es exactamente el error de [[project_uber_routes_sin_auth]]: leer el working tree y llamarlo
producción.** Lo registro aquí en vez de borrarlo porque la lección vale más que la vergüenza. Todo
este documento se hizo contra `origin/main` vía `git show origin/main:<ruta>`.

**Lo que sigue SIN verificar:** si esas migraciones están **aplicadas en la base de producción**. La
cabecera de la de inventario dice literalmente *"Candidate only"* **[FACT]**. No lo comprobé porque
esta sesión tiene prohibido tocar DB. Estado: `NO VERIFICADO`, no "no aplicado".

---

## 1. EXECUTIVE SUMMARY

**Fullsite no necesita inventar el patrón de command receipts. Ya lo implementó tres veces, de forma
independiente, con tres nombres distintos para la misma cosa.** P0B no es diseño nuevo: es
**unificar, nombrar y extender** lo que ya existe.

Las tres implementaciones en `origin/main`:

| Tabla | Llave de identidad | Fingerprint | Outcome guardado |
|---|---|---|---|
| `pos_save_operations` | `(client_id, order_id, save_operation_id)` | `payload_hash` sha256 canónico | columnas tipadas (`committed_revision`, `rejection_*`) |
| `pos_inventory_movement_operations` | `(client_id, idempotency_key)` | `intent` jsonb completo | `result` jsonb completo |
| `pos_transfer_operations` | `(client_id, operation_id)` | `intent` jsonb | `result` jsonb |

Tres nombres — `save_operation_id`, `idempotency_key`, `operation_id` — para **un solo concepto**.
Eso es lo que P0B tiene que resolver antes de que sean cinco.

**La respuesta a la pregunta central, en una frase:** se sale del bucle
*409 → interpretar → releer → adivinar* **moviendo la semántica del transporte al cuerpo de la
respuesta**. Un RPC que devuelve `{status: COMMITTED, was_duplicate: true, ...outcome}` no necesita
que nadie interprete un código HTTP, porque el servidor ya contestó la única pregunta que importa:
*qué pasó con mi operación*. Fullsite ya hace esto en los tres RPC de arriba. Lo que todavía
interpreta códigos HTTP es el **append directo por REST**, que es justamente lo que no tiene recibo.

**Por qué `r1_save_order_idempotent` tiene semántica fuerte y los append REST no:** el RPC corre
**una transacción de Postgres** que contiene el claim de identidad, el efecto y el registro del
outcome. El append REST es un `INSERT` suelto cuyo único mecanismo de identidad es el PK de la fila
— y el cliente no puede distinguir "yo lo inserté antes" de "alguien más insertó algo parecido".
El detalle completo en §2.

**El veredicto entre los dos diseños que pediste comparar: DESIGN A (operation receipts), no
DESIGN B (terminal watermark).** El argumento decisivo no es mío, es de TigerBeetle: los reintentos
de *la misma sesión de cliente* reciben réplicas idénticas, pero **"los requests reintentados por un
cliente distinto (mismo cuerpo, sesión distinta) pueden recibir réplicas distintas"** **[FACT]**. Un
watermark es identidad *de sesión*; Fullsite necesita identidad *del evento lógico*, porque tiene
casos donde dos terminales pueden originar el mismo evento. Detalle en §4.

**Arquitectura nueva mínima:** una tabla de recibos genérica y un contrato de outcome. Cero
frameworks, cero dependencias, cero cambios al modelo de datos de negocio.

---

## 2. FULLSITE CURRENT PATTERN (archivo:línea)

Todo verificado contra `origin/main` (`10017cf9`).

### 2.1 El patrón fuerte — `r1_save_order_idempotent`

Archivo: [`dashboard-app/sql/r2d_save_operation_idempotency.sql`](../../../dashboard-app/sql/r2d_save_operation_idempotency.sql)

```
:9-28    CREATE TABLE pos_save_operations
         PK (client_id, order_id, save_operation_id)
         payload_hash · state {EXECUTING|COMMITTED|REJECTED}
         committed_revision · rejection_detail/expected/current
         CHECK que amarra estado↔columnas (:23-27)
:100-134 hash canónico: items ordenados por id, modificadores ordenados,
         claves fijas, sha256
:137-141 INSERT ... ON CONFLICT DO NOTHING   ← el claim
:145-188 si row_count=0 → leer el recibo existente y devolver su outcome
:159-162 payload_hash distinto → PAYLOAD_IDENTITY_CORRUPTION
:191-223 primer ejecutor: ejecuta r1_save_order y ACTUALIZA el recibo
         a COMMITTED o REJECTED en la MISMA transacción
```

**Las cinco propiedades que lo hacen fuerte** — y que son exactamente las que la industria pide:

1. **Claim por `INSERT ... ON CONFLICT DO NOTHING`** (:141). No es *check-then-act*. Bajo READ
   COMMITTED, dos ejecutores concurrentes con la misma llave se serializan en el índice único: el
   segundo **bloquea** hasta que el primero comitea o aborta (comentario :41-44) **[FACT, según el
   comentario y el comportamiento documentado de Postgres; no lo ejercí en runtime]**.
2. **Fingerprint del payload** (:134). Misma llave + payload distinto = error explícito, no un ACK
   silencioso.
3. **Outcome persistido y reproducible** (:165-182). Devuelve `revision` si comiteó, o el detalle de
   rechazo con `expected_revision`/`current_revision` si fue rechazado.
4. **Discriminador explícito**: `first_execution` / `idempotent_replay` en cada respuesta. El cliente
   nunca adivina.
5. **Atomicidad recibo↔efecto**: el `EXECUTING` es transitorio dentro de la transacción del ejecutor
   (:46-48). Si la transacción muere, **el recibo desaparece con ella**. No quedan recibos huérfanos.

La API lo consume correctamente y ya propaga el discriminador al cliente
([`save-order/route.ts:77-103,141-143`](../../../dashboard-app/src/app/api/pos/save-order/route.ts))
**[FACT]**.

### 2.2 El segundo patrón fuerte — inventario (y es más avanzado)

[`supabase/migrations/20260910050000_inventory_movement_atomic.sql`](../../../supabase/migrations/20260910050000_inventory_movement_atomic.sql)

```
:3-7    pos_inventory_movement_operations (client_id, idempotency_key, intent, result)
:10-14  movement_operation_key + movement_operation_line en la tabla de movimientos
        + índice único parcial (client_id, key, line)
:50     pg_advisory_xact_lock sobre (client_id, key)
        "El lock también cubre el primer uso concurrente de la llave antes de que exista su recibo"
:53-59  si ya existe: comparar intent (menos 'actor') → MOVEMENT_KEY_REUSED
        si coincide → return previous.result || {was_duplicate: true}
:60-66  detección de movimientos legacy por notas → LEGACY_MOVEMENT_REQUIRES_RECONCILIATION
:68-69  locks de ingredientes e inventario en orden de identidad (anti-deadlock)
:102-109 movimiento + stock + costo, todo en el mismo loop transaccional
:115    recibo insertado al final, misma transacción
```

Tiene dos cosas que `pos_save_operations` **no** tiene y que son mejores **[INFER]**:

- **Doble anclaje**: recibo (grano operación) **más** índice único `(key, line)` en la tabla de
  efectos (grano línea). Si el recibo fallara, el índice todavía impide el doble movimiento.
- **Intent comparado por contenido**, no por hash, y con exclusión deliberada del campo `actor`
  (:55-57): *"Un gerente autorizado distinto puede recuperar el recibo original. Su actor original
  permanece como procedencia inmutable, no como parte de la intención de negocio."* Eso es una
  decisión de diseño fina: **la identidad de la operación es el negocio, no quién la mandó.** Es
  justamente lo que hace falta para el caso de dos terminales (§4).

### 2.3 El tercer patrón — transferencias

[`supabase/migrations/20260910010000_transfer_item_atomico.sql:7-9,34,116-117`](../../../supabase/migrations/20260910010000_transfer_item_atomico.sql):
`pos_transfer_operations (client_id, operation_id, intent, result)`, PK `(client_id, operation_id)`,
mismo patrón de lectura previa y guardado de `result`. **[FACT]**

### 2.4 Los appends débiles — REST directo

El proxy [`api/pos/db/[...path]/route.ts`](../../../dashboard-app/src/app/api/pos/db/[...path]/route.ts)
expone PostgREST con service key, filtrado por tabla:

```
:92   sólo tablas pos_*
:100  if (!ALLOW.has(table)) → forbidden
:103  if (método ≠ GET/HEAD && !puedeEscribirEn(table, role)) → forbidden
:158-159 export const POST = handle; export const PATCH = handle
```

`ALLOW` ([`pos-db-policy.ts:22`](../../../dashboard-app/src/lib/pos-db-policy.ts)) incluye
`pos_cash_movements`, `pos_cierres`, `pos_turnos`, `pos_audit_log`, `pos_inventory_movements`,
`pos_inventory` — y también **`pos_save_operations`** **[FACT]**.

**Por qué estos appends NO tienen semántica fuerte, con precisión:**

| Propiedad | RPC con recibo | Append REST |
|---|---|---|
| Identidad de la operación | llave propia, explícita | sólo el PK de la fila |
| Claim atómico | `INSERT…ON CONFLICT` / advisory lock | ninguno |
| Fingerprint del payload | sí | ninguno |
| Outcome persistido | sí, reproducible | **ninguno** |
| Respuesta a un reintento | `was_duplicate` + resultado original | **código HTTP que hay que interpretar** |
| Efecto + registro en 1 txn | sí | sólo si el efecto *es* la fila |

La última fila es la clave y es sutil: **para una tabla puramente append-only (auditoría), el
`INSERT` con PK del cliente sí es idempotente por sí mismo** — el efecto y el registro son la misma
fila. El problema no es el doble insert; es que **el cliente no puede saber el resultado**: recibe
un 409 y tiene que decidir si ese conflicto fue suyo o de otro. Ése es el bucle exacto que la
pregunta central quiere eliminar.

Y para cualquier operación cuyo efecto **no** sea la propia fila (mover stock, cerrar turno,
materializar un corte), el append REST no ofrece nada: el índice único protege el registro, **no el
efecto**. §10.

### 2.5 Hallazgo estático a verificar — la tabla de recibos es escribible por el proxy

`pos_save_operations` está en `ALLOW` (:22-57), **no** está en `MANAGER_ONLY_WRITE` (:71-84) y **no**
tiene mínimo en `NIVEL_MINIMO_DE_ESCRITURA` (:120-123). Por lectura de
`puedeEscribirEn` (:125-130), cualquier rol devuelve `true`. El proxy usa service key, que **pasa
por encima de RLS**, así que el `ENABLE ROW LEVEL SECURITY` sin políticas de la migración (:31-32)
no lo cubre. **[FACT sobre lo que dice el código.]**

**[INFER, NO VERIFICADO EN RUNTIME]** Si eso es explotable, un shift token podría pre-insertar un
recibo con `state='COMMITTED'` para un `save_operation_id`, y la orden real se contestaría como
*idempotent replay* sin haberse guardado nunca. Sería una orden suprimida en silencio.

**No lo declaro defecto** — es exactamente el caso de
[[feedback_hallazgo_estatico_no_es_defecto]]. Va a §14 como prueba de runtime obligatoria. Pero
la regla de diseño que se desprende es independiente y sí se puede fijar hoy: **un libro de recibos
nunca es escribible por el cliente** (§6, R7).

---

## 3. INDUSTRY PATTERNS

### TigerBeetle — el id lo genera el cliente y se persiste ANTES de enviar

De [`docs/coding/reliable-transaction-submission.md`](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/coding/reliable-transaction-submission.md) **[FACT]**:

- *"la respuesta puede perderse de regreso desde TigerBeetle"* — el problema se enuncia primero.
- *"El software cliente, como tu app o página web, con el que el usuario interactúa debería generar
  el `id` (no tu API)."*
- *"el software cliente **persiste el `id` en el almacenamiento local de la app o el navegador**"*
  antes de enviar, de modo que las transferencias *"se registren una y sólo una vez"*.
- Al reintentar: `created` si es nueva, **`exists`** si ya existía.

De [`docs/coding/requests.md`](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/coding/requests.md) **[FACT]**:

- *"Los eventos que crean objetos son idempotentes. El primer evento que crea un objeto con un `id`
  dado recibe el resultado `ok`. Los eventos subsecuentes que intenten crear el mismo objeto reciben
  el resultado `exists`."*
- *"Los requests reintentados por su sesión de cliente original reciben réplicas idénticas."*
- *"Los requests reintentados por un cliente distinto (mismo cuerpo, sesión distinta) **pueden
  recibir réplicas distintas**."*  ← **la frase más importante de todo este documento**
- *"Todos los eventos de un batch se comitean, o ninguno"*, pero *"los eventos tienen éxito o fallan
  independientemente salvo que estén explícitamente ligados"*.

De [`docs/concepts/safety.md`](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/concepts/safety.md) **[FACT]**:
*"Sin Durabilidad, las garantías de Atomicidad, Consistencia y Aislamiento colapsan — la única letra
de ACID cuya pérdida deshace a las otras."* Liga P0B con P0C: **un recibo que no sobrevive al corte
no es un recibo.**

**Qué aplica a Fullsite:** el id generado y persistido por el cliente antes de enviar; `created` vs
`exists` como outcome explícito. **Qué NO aplica:** el modelo de doble partida de TigerBeetle, su
almacenamiento con `O_DIRECT`, y su cache de réplicas por sesión — Fullsite no tiene sesiones
persistentes de cliente ni las quiere.

### Replicache — watermark monotónico por cliente

De [Push Endpoint Reference](https://doc.replicache.dev/reference/server-push) **[FACT]**:

- *"Todas las mutaciones con `id` menor o igual al `lastMutationID` actual del cliente deben
  ignorarse."* / *"Todas las mutaciones con `id` mayor que `lastMutationID+1` deben ignorarse."*
- *"El `lastMutationID` debe actualizarse transaccionalmente junto con los efectos de las mutaciones
  … ambos cambios comitidos como parte de la misma transacción."*
- *"Si una mutación es inválida o no puede manejarse, el servidor debe de todos modos marcarla como
  procesada"*, o el cliente reintenta para siempre.

### Temporal — la responsabilidad de la idempotencia es de quien ejecuta

De la documentación de Activities **[FACT]**:

- Ejecución **at-least-once**: si un worker ejecuta bien y muere antes de avisar, se reintenta.
- *"Las Activities no se graban en el Event History hasta que retornan o producen un error. Esto
  significa que tú tienes la responsabilidad de garantizar la idempotencia antes de que el resultado
  se grabe."*
- Y la receta que más le sirve a Fullsite: **construir la llave de idempotencia combinando
  identificadores del trabajo, no generando una nueva por intento** — *"este valor permanece
  constante entre reintentos de la Activity y es único entre todas las ejecuciones"*.

**No se propone adoptar Temporal.** Se toma la regla.

### Stripe — el contrato de llave de idempotencia

De [Idempotent requests](https://docs.stripe.com/api/idempotent_requests) **[FACT]**:
guarda status y body de la primera ejecución y los reproduce, **incluidos los 500**; compara los
parámetros entrantes contra los originales y da error si difieren; poda a las 24 h y entonces una
llave reusada genera una petición nueva; si la validación falla antes de empezar la ejecución **no**
se guarda resultado, y el request es reintentable.

---

## 4. OPERATION RECEIPT VS WATERMARK

**Veredicto: DESIGN A (per-operation receipt). El watermark no sustituye, y en Fullsite ni siquiera
complementa mucho.**

### El argumento decisivo

Un watermark `(terminal_id, last_seq)` responde: *"¿ya procesé todo lo que este dispositivo me
mandó?"*. Un recibo responde: *"¿ya ocurrió este evento de negocio?"*. **Son preguntas distintas y
Fullsite necesita la segunda.**

TigerBeetle documenta la frontera exacta: los reintentos de la sesión original reciben réplicas
idénticas —eso es lo que un watermark logra— pero **"los requests reintentados por un cliente
distinto (mismo cuerpo, sesión distinta) pueden recibir réplicas distintas"** **[FACT]**. Lo que
deduplica entre sesiones no es el watermark: es la **identidad del objeto**, el `id`. **[INFER]** En
la traducción a Fullsite: si dos terminales pueden originar el mismo evento lógico, el watermark no
lo ve, porque cada terminal tiene su propia secuencia y ninguna colisiona con la otra.

### El caso que rompe el watermark, concreto

Recepción de una orden de compra. La caja captura la recepción; el almacén, sin saberlo, también.
Son **dos `terminal_id` distintos**, cada uno con su propia secuencia monotónica. Los dos watermarks
avanzan sin conflicto y el inventario se mueve **dos veces**. El recibo, en cambio, se puede anclar a
la identidad del evento de negocio —*recepción de la OC #123, línea 4*— y el segundo intento choca
contra la llave única, venga de donde venga. Es la razón por la que la migración de inventario
excluye `actor` del intent (:55-57): **la identidad es el hecho, no quién lo reportó** **[FACT]**.

### Por dominio

| Dominio | Watermark | Receipt | Por qué |
|---|---|---|---|
| Orders | insuficiente | **sí** | Ya implementado así. Hay OCC por revisión encima. |
| Cash movement | insuficiente | **sí** | Dos terminales pueden registrar el mismo retiro físico. |
| Audit | no necesario | **sí, barato** | El PK del evento ya deduplica; falta el outcome. |
| Inventory | **rompe** | **sí, + índice por línea** | El caso de arriba. Ya resuelto en `main`. |
| Purchase-order receiving | **rompe** | **sí, anclado a la OC** | El caso canónico de dos originadores. |
| Market adjustments | insuficiente | **sí** | Mismo ajuste desde dos pantallas. |

**Dónde sí sirve un watermark:** para detectar **huecos** — "recibí 1,2,3,5: falta el 4". Eso un
recibo no lo ve, porque un recibo sólo sabe de operaciones que llegaron. Es diagnóstico, no
corrección. §5.

---

## 5. FULLSITE IDENTITY MODEL

Los cuatro identificadores, separados y no intercambiables:

| Identificador | Qué es | Quién lo genera | Cuándo cambia | Para qué sirve |
|---|---|---|---|---|
| `client_op_id` | **Identidad lógica inmutable de la acción/evento** | el cliente, **antes** del primer intento | **nunca** entre reintentos | Correctitud: dedup y replay |
| `terminal_id` | Dispositivo que la originó | provisionado al instalar | nunca | Procedencia, auditoría, soporte |
| `terminal_seq` | Orden monotónico de acciones del dispositivo | el cliente | +1 por acción nueva | **Sólo diagnóstico** |
| server row id | Identidad física de la fila | la base | nunca | Referencia interna |

### ¿`terminal_seq` es necesario para CORRECTNESS?

**No. [REC firme.]**

La correctitud sale entera de `client_op_id` + llave única + recibo. `terminal_seq` aportaría
correctitud sólo bajo la semántica de Replicache —rechazar toda mutación fuera de orden— y eso
exige un orden total **por cliente**, que Fullsite no tiene ni quiere: sus operaciones son
mayormente conmutativas (dos retiros de caja distintos no tienen orden obligatorio entre sí) y un
orden estricto convertiría cualquier operación atorada en un bloqueo de todas las siguientes. La
regla de Replicache de avanzar el marcador ante error permanente existe precisamente para escapar de
ese bloqueo **[FACT]**; no tiene sentido adoptar el problema para luego adoptar su parche.

**Para qué sí vale [REC]:** detectar pérdida silenciosa. Con `terminal_seq` el servidor puede decir
*"de la terminal 3 tengo 1..40 y 42: falta la 41"* — que es la única forma de descubrir una operación
que **nunca salió** (F1 en §8), el único fallo que ningún recibo puede ver. Es observabilidad
valiosa y barata, y encaja con el patrón del guardián que alerta por **ausencia**
([[project_guardian_mudo_patron]]). **No lo hagas requisito de aceptación de escrituras.**

### Cómo se deriva `client_op_id` — la decisión fina

Dos modos, y Fullsite necesita **los dos**:

- **Aleatorio persistido** (UUID v4 guardado antes de enviar). Para acciones originadas por una
  persona en una terminal: cobrar, retirar efectivo, enviar comanda. Es el consejo literal de
  TigerBeetle **[FACT]**.
- **Derivado determinísticamente del evento de negocio**, p. ej. `po_receipt:{po_id}:{line_id}`.
  Para eventos que **dos terminales pueden originar**. Es la receta de Temporal: componer la llave de
  identificadores del trabajo para que sea constante entre reintentos y única entre ejecuciones
  **[FACT]**. Un UUID aleatorio aquí **no sirve**: cada terminal generaría el suyo y no colisionarían.

> **[REC] La regla:** si dos personas en dos terminales pueden reportar el mismo hecho, la llave se
> **deriva del hecho**. Si sólo una persona en una terminal puede originarlo, la llave es aleatoria y
> se persiste antes de enviar. Elegir mal el modo es el único error de diseño de P0B que no se
> detecta con pruebas de una sola terminal.

---

## 6. COMMAND RECEIPT CONTRACT

**[REC]** Contrato conceptual. No es un esquema para aplicar: es lo que P0B debe decidir.

```
command_receipts
  client_id         text     -- tenant. Siempre primero en la llave.
  operation_type    text     -- 'cash_movement' | 'inventory_movement' | ...
  client_op_id      text     -- identidad lógica inmutable
  terminal_id       text     -- procedencia; NO parte de la llave
  terminal_seq      bigint   -- diagnóstico; nullable; NO parte de la llave
  request_fingerprint text   -- hash canónico del intent de negocio
  state             text     -- COMMITTED | REJECTED   (ver nota sobre EXECUTING)
  outcome           jsonb    -- §7
  created_at        timestamptz
  committed_at      timestamptz

  UNIQUE (client_id, operation_type, client_op_id)
```

### Las ocho reglas

- **R1 — La llave lleva `operation_type`.** Sin él, un `client_op_id` reusado entre dominios colisiona.
  Es la diferencia con `pos_save_operations`, cuya llave usa `order_id` porque sólo sirve a un tipo.
- **R2 — Una sola transacción.** Claim, efecto y outcome comitean juntos, o nada. Es el requisito
  común de Replicache y del outbox transaccional **[FACT]**.
- **R3 — Claim por inserción, nunca por lectura previa.** `INSERT … ON CONFLICT DO NOTHING`
  (como `pos_save_operations:141`) o advisory lock antes de leer (como inventario `:50`). Un
  `SELECT` y luego `INSERT` es *check-then-act* y no serializa.
- **R4 — Fingerprint obligatorio; misma llave + intent distinto = error explícito**, nunca un ACK
  silencioso. Los tres RPC de `main` ya lo hacen, con dos técnicas distintas (hash vs comparación de
  jsonb). **[REC]** unificar en comparación de `intent` jsonb: es diagnosticable, el hash no.
- **R5 — El fingerprint cubre el intent de negocio, no la procedencia.** `actor`, `terminal_id`,
  timestamps de envío y reintento quedan **fuera**. Es la decisión ya tomada en inventario `:55-57`
  **[FACT]** y es la que hace funcionar el caso de dos terminales.
- **R6 — `EXECUTING` no debe ser observable.** Si el recibo vive en la misma transacción que el
  efecto, un crash lo borra y no hay recibos huérfanos. Sólo hace falta un estado `EXECUTING` si
  algún día el efecto sale de la transacción (una llamada externa) — y ese día también hace falta
  expiración y recuperación. **[REC] no introducirlo hasta que exista ese caso.**
- **R7 — El libro de recibos jamás es escribible por el cliente.** Sólo `SECURITY DEFINER` lo toca.
  Ver §2.5.
- **R8 — Los recibos no se podan mientras la cola offline pueda contenerlos.** Stripe poda a 24 h
  **[FACT]**, pero Stripe no tiene terminales que reconectan después de un puente. **[REC]** retención
  ≥ 90 días, y en todo caso mayor que la ventana máxima de replay observada.

---

## 7. OUTCOME CONTRACT

`duplicate: true` no basta porque no contesta *qué pasó*. El recibo debe permitir responder cinco
preguntas sin releer nada de negocio:

| Estado | Significado | Qué debe traer |
|---|---|---|
| `COMMITTED` | Aplicada ahora | refs server-generated + efecto resumido |
| `ALREADY_COMMITTED` | Ya estaba aplicada (replay) | **el mismo cuerpo que la primera vez** + `was_duplicate: true` |
| `REJECTED_BUSINESS` | Rechazo de negocio determinista (stock insuficiente, turno cerrado) | código + detalle. **Reintentar no cambia nada.** |
| `REJECTED_CONFLICT` | Conflicto de concurrencia (revisión rancia) | revisión esperada y actual, para que el cliente decida |
| `REJECTED_IDENTITY` | Misma llave, intent distinto | el intent original, para diagnóstico |

`ALREADY_COMMITTED` y `COMMITTED` **deben traer el mismo cuerpo**, distinguidos sólo por la bandera.
Es la regla de Stripe **[FACT]** y es lo que permite al cliente tener **un solo camino de código**.

### ¿Outcome completo, o referencia + hash?

**[REC] Completo, pero sólo del contrato público del RPC — no del estado del mundo.**

- **Guardar:** los identificadores generados por el servidor (`cash_movement_id`, `movement_ids`,
  `revision`, `turno_id`), el estado, y el resumen del efecto que el cliente necesita para cerrar su
  UI sin releer.
- **No guardar:** saldos absolutos ni totales del mundo. Un `stock_after` congelado en un recibo de
  hace dos días **miente** cuando se reproduce hoy. El recibo de inventario de `main` sí guarda
  `stock_before/stock_after` en `details` (`:110-111`) **[FACT]** — y eso está bien **como
  procedencia histórica** ("cuánto había cuando esto se aplicó"), pero **[REC]** el cliente no debe
  tratarlo como saldo vigente al reproducirlo. Vale la pena que el contrato lo diga.

**El mínimo que permite recuperación sin reconstrucción insegura:** estado + `client_op_id` + las
referencias server-generated. Con eso el cliente cierra la operación, marca su cola y, si necesita
saldos, los **lee frescos**. Todo lo demás es conveniencia.

Ejemplos, en el formato que pediste:

```
cash:       { status: COMMITTED, was_duplicate: false,
              client_op_id: "...", cash_movement_id: 123, turno_id: "..." }

inventory:  { status: ALREADY_COMMITTED, was_duplicate: true,
              client_op_id: "...", movement_ids: [...], lines_applied: 4,
              details: [...]  ← procedencia del momento de aplicación, no saldo vigente }
```

---

## 8. FAILURE MATRIX F1–F12

Supuesto: existe `command_receipts` con el contrato de §6. "Identidad necesaria" = lo mínimo que
debe viajar para resolver el caso.

| # | Caso | SERVER STATE | CLIENT STATE | RETRY SAFE? | EXPECTED RESPONSE | NEEDED IDENTITY |
|---|---|---|---|---|---|---|
| **F1** | El request nunca salió | sin recibo, sin efecto | operación en cola | **Sí** | `COMMITTED` al primer envío real | `client_op_id` persistido **antes** de intentar. **Si el id se genera al enviar, esta operación se pierde sin rastro** |
| **F2** | Salió, nunca llegó | sin recibo, sin efecto | cree que envió | **Sí** | `COMMITTED` | `client_op_id` |
| **F3** | Llegó, servidor falló antes del commit | **nada**: la txn abortó, recibo y efecto se fueron juntos | error o timeout | **Sí** | `COMMITTED` | `client_op_id` |
| **F4** | Efecto + recibo comiteados, **ACK perdido** | recibo `COMMITTED`, efecto aplicado | no sabe | **Sí** | `ALREADY_COMMITTED` **con el cuerpo original** | `client_op_id`. **Éste es el caso que hoy contesta `duplicate:true` y por el que existe P0B** |
| **F5** | ACK recibido, cliente muere antes de `markSynced` | recibo `COMMITTED` | reintentará | **Sí** | `ALREADY_COMMITTED` | `client_op_id` |
| **F6** | Reintento de la misma operación | recibo existe | reintentando | **Sí** | `ALREADY_COMMITTED` | `client_op_id` |
| **F7** | Misma llave, payload distinto | recibo con otro fingerprint | bug del cliente | **No** | `REJECTED_IDENTITY` + intent original. **Alerta, no se absorbe** | `client_op_id` + fingerprint |
| **F8** | **Dos terminales, mismo evento lógico** | un recibo | dos clientes esperando | **Sí** | primero `COMMITTED`, segundo `ALREADY_COMMITTED` | **`client_op_id` derivado del hecho.** Con id aleatorio por terminal → **doble efecto**. Un watermark **no lo ve** (§4) |
| **F9** | Dos acciones legítimas idénticas (dos retiros de $500 iguales) | dos recibos | dos operaciones | **Sí** | dos `COMMITTED` | **dos `client_op_id` distintos.** Es el espejo de F8: aquí derivar la llave del contenido sería un **bug**, colapsaría dos hechos reales en uno |
| **F10** | Replay después de horas/días | recibo `COMMITTED` si no se podó | cola vieja | **Sí, si no se podó** | `ALREADY_COMMITTED` | `client_op_id` + **retención > ventana de replay (R8)**. Podado → se re-ejecuta como nueva: **doble efecto** |
| **F11** | Auth expiró al reproducir | sin cambio | cola bloqueada | **Sí, tras re-auth** | `401` **transitorio**, no terminal | independiente de la identidad. El código web ya distingue este caso ([`pos-offline-db.ts:579`](../../../dashboard-app/src/lib/pos-offline-db.ts)) **[FACT]** |
| **F12** | El turno cerró antes del replay | rechazo de negocio | cola con la operación | **No** (reintentar no ayuda) | `REJECTED_BUSINESS` + código de turno cerrado | `client_op_id` + `turno_id` en el intent. **Requiere resolución humana**, no reintento |

**Las tres lecciones que salen de la matriz:**

1. **F1 obliga a persistir el id antes del primer intento.** Es la única diferencia entre una
   operación perdida y una recuperable, y es literalmente lo que TigerBeetle pide **[FACT]**.
2. **F8 vs F9 es la decisión de diseño más delicada de P0B** y no se puede resolver
   genéricamente: depende del dominio. Mal resuelta, o duplicas dinero (F8) o borras un movimiento
   legítimo (F9).
3. **F12 no es un fallo de sync, es un fallo de negocio**, y no tiene arreglo técnico: necesita una
   bandeja de resolución humana. Toda cola offline larga acaba produciendo F12.

---

## 9. APPEND CLASSIFICATION MATRIX

Clasificación contra `origin/main`. **No se cambia código.**

| Tabla | Clasificación | Evidencia y razón |
|---|---|---|
| `pos_inventory_movements` | **MOVE_TO_COMMAND_RPC** (parcialmente hecho) | El RPC `pos_record_inventory_movement` existe y es correcto **[FACT]**, pero la tabla **sigue en `ALLOW`** ([`pos-db-policy.ts:22`](../../../dashboard-app/src/lib/pos-db-policy.ts)) junto con `pos_inventory`, así que la puerta REST que salta el RPC sigue abierta para roles gerente. §10 |
| `pos_cash_movements` | **MOVE_TO_COMMAND_RPC** | Es dinero, no tiene recibo, y escribible desde nivel `cajero` (`NIVEL_MINIMO_DE_ESCRITURA`, :120-123) **[FACT]**. F4 y F8 aplican directo. **Prioridad más alta de los pendientes** |
| `pos_cierres` | **MOVE_TO_COMMAND_RPC** | Corte de caja: efecto compuesto, no una fila. Existe además una migración `PENDIENTE_20260905010000_caja_business_materializer.sql` **[FACT]** — hay trabajo en vuelo aquí, hay que leerlo antes de diseñar nada |
| `pos_turnos` | **NEEDS_MORE_EVIDENCE** | El comentario de `pos-db-policy.ts:176` dice que no puede estar en `MANAGER_ONLY_WRITE` porque el cierre de caja depende de ello **[FACT]**. Hay una restricción de diseño que no leí completa |
| `pos_audit_log` | **ALREADY_SAFE (como append) / NEEDS_MORE_EVIDENCE (como outcome)** | El efecto **es** la fila: PK del cliente ⇒ insert idempotente. Lo que falta no es dedup, es que el cliente sepa el resultado sin interpretar un 409. Riesgo real distinto: la cola descarta al llegar a 1,000 ([`events.ts:59-67`](../../../dashboard-app/src/lib/events.ts), working tree) — **verificar contra `main`** |
| `pos_market_movements` | **DEAD_PATH / NEEDS_MORE_EVIDENCE** | **No está en `ALLOW`** **[FACT]**. Aparece en rutas `adjust-market` / `deduct-market` y en migraciones. No pude determinar si el camino vivo pasa por RPC o está muerto. Requiere lectura dirigida de esas dos rutas |
| `pos_market_stock` | **NEEDS_MORE_EVIDENCE** | Tampoco está en `ALLOW`. Mismo caso |
| `pos_save_operations` | **KEEP_DIRECT_REST → NO.** Debe salir de `ALLOW` | Es el libro de recibos y está en la lista de tablas escribibles por el proxy. §2.5 y §6 R7 |
| `pos_orders` | **ALREADY_SAFE** | Vía `r1_save_order_idempotent`, con OCC y recibo **[FACT]** |

**Ninguna tabla califica como `KEEP_DIRECT_REST` para escrituras de negocio.** **[INFER]** El patrón
general: el REST directo es aceptable para **lecturas** y para catálogos editados por un humano en
una pantalla de gerente, y no lo es para nada que mueva dinero, stock o turnos.

---

## 10. INVENTORY EXACTLY-ONCE EFFECT

**La pregunta que planteaste —*"un índice único en el log de movimientos no necesariamente protege el
efecto de stock"*— es exactamente correcta, y `main` ya la contesta bien.**

El anti-patrón que describes —`read stock → calcular newStock → PATCH stock → log movement`— tiene
dos fallos independientes: no es atómico (el efecto y el registro pueden divergir) y no es
serializable (dos lectores concurrentes calculan desde el mismo saldo y el último gana, perdiendo
una cantidad). **Un índice único sobre el log no arregla ninguno de los dos**: impide el segundo
*registro*, no el segundo *PATCH*.

**La regla correcta es la que preguntas: efecto + recibo en una transacción del lado servidor.** Y
el patrón SQL que mejor encaja —el que `main` ya usa— tiene cuatro piezas
([20260910050000](../../../supabase/migrations/20260910050000_inventory_movement_atomic.sql)) **[FACT]**:

1. **Advisory lock transaccional sobre `(client_id, idempotency_key)`** (:50). Cubre la ventana que
   ningún índice cubre: **el primer uso concurrente de la llave, antes de que exista su recibo**. El
   comentario del código lo dice explícitamente.
2. **`SELECT … FOR UPDATE` sobre ingredientes e inventario, en orden de identidad** (:68-69). Bloquea
   las filas del efecto y el orden determinista evita deadlocks entre lotes que se cruzan.
3. **Lectura del saldo bloqueado, cálculo y escritura dentro del mismo loop** (:80-109). No hay
   ventana entre leer y escribir.
4. **Doble anclaje**: el recibo (:115) **y** el índice único parcial `(client_id, key, line)`
   (:12-14). Defensa en profundidad: si una pieza falla, la otra impide el doble movimiento.

Hay un detalle que me parece la mejor decisión de todo el archivo: el loop preserva el orden original
de las líneas con `WITH ORDINALITY` (:72) *"para que las líneas repetidas de una factura lean el saldo
actualizado por la línea anterior"* **[FACT]**. Esto es lo que impide que dos líneas del mismo
insumo en una misma factura se calculen ambas desde el saldo inicial.

**Lo que queda abierto, y es el hallazgo real de esta sección:**

> **La puerta trasera sigue abierta.** `pos_inventory_movements` y `pos_inventory` siguen en `ALLOW`
> **[FACT]**. Un rol gerente puede hacer `PATCH` directo a `pos_inventory.stock` por el proxy,
> saltándose el RPC, el lock y el recibo. El RPC correcto no protege nada mientras exista otro camino
> al mismo efecto.

**[REC]** El cierre de P0D no es escribir el RPC —ya está escrito— sino **cerrar los caminos
alternativos al efecto**. Un contrato se cumple cuando es el único camino, no cuando es el camino
recomendado. **[INFER]** Es el mismo patrón que ya mordió a Fullsite en
[[project_blindaje_security_audit]]: el guardián no estaba en la capa de entrada.

---

## 11. MIGRATION PATH FROM CURRENT P0A

**Sin implementación. Orden conceptual, cada paso verificable por separado.**

**Paso 0 — Reconciliar la verdad.** Confirmar qué migraciones están **aplicadas en producción**
(la de inventario se declara *"Candidate only"*). Todo lo demás depende de esto y hoy está
`NO VERIFICADO`. Es lectura, no cambio.

**Paso 1 — Nombrar el concepto.** Un solo término en todo el código y los docs para
`save_operation_id` / `idempotency_key` / `operation_id`. **[REC]** `client_op_id`. Es renombrado
conceptual: los tres recibos existentes **no se migran**, se documentan como instancias del mismo
contrato. Ninguna tabla se toca.

**Paso 2 — Escribir el contrato** (§6 + §7) como documento de dominio, al nivel de
`dashboard-app/AGENTS.md`, con la regla F8/F9 de §5 explícita. Es el entregable real de P0B.

**Paso 3 — Cerrar el libro de recibos.** Sacar `pos_save_operations` de `ALLOW`, previa prueba de
runtime de §14. Es de una línea y de riesgo acotado.

**Paso 4 — Cash primero.** Es el dominio de mayor valor sin recibo. Aplicar el contrato copiando la
forma del RPC de inventario, que es la más madura de las tres.

**Paso 5 — Cerrar las puertas traseras** de inventario (§10). Después de cash, porque toca un camino
que hoy usa gente real y necesita su propia validación.

**Paso 6 — `terminal_seq` como telemetría**, no como requisito de aceptación. Detección de huecos y
alerta por ausencia. Opcional y último.

**Lo que este camino NO toca:** P0A, Pedro, el event store local, y el modelo de datos de negocio.
P0B vive entero en la frontera servidor.

---

## 12. WHAT NOT TO BUILD

1. **Una tabla de recibos por dominio.** Ya hay tres y ése es el problema, no la solución.
2. **Watermark por terminal como mecanismo de correctitud.** §4. Como telemetría, sí.
3. **Orden total por terminal.** Convierte una operación atorada en un bloqueo de todas las
   siguientes, y obliga a adoptar el parche de Replicache para un problema que Fullsite no tiene.
4. **Estado `EXECUTING` observable, con expiración y recuperación de recibos huérfanos.** No hace
   falta mientras el efecto viva en la misma transacción (§6 R6). Es maquinaria para un problema que
   no existe todavía.
5. **Guardar el estado del mundo en el outcome.** Saldos absolutos congelados mienten al
   reproducirse (§7).
6. **Un mecanismo genérico de "resolución de conflictos".** Los conflictos de Fullsite son de
   negocio (F12), no de datos, y los resuelve una persona.
7. **Reescribir `r1_save_order_idempotent`.** Funciona. Se documenta como instancia del contrato.

---

## 13. WHAT NOT TO ADOPT

| Tecnología | Por qué no |
|---|---|
| **Temporal** | Excluido por instrucción, y coincido: resuelve orquestación de workflows de larga duración. Fullsite necesita **una transacción de Postgres**, que ya tiene. Se toma la regla de derivación de llave, no el runtime. |
| **TigerBeetle** | Base de datos de doble partida con su propio motor de almacenamiento. Adoptarla sería reemplazar Postgres. Se toman sus **docs**, que son el mejor material público sobre este problema exacto. |
| **Replicache / Zero** | Impone orden total por cliente y un modelo de mutaciones que Fullsite no tiene. Su **especificación** es la referencia; su runtime, no. |
| **Una librería de idempotencia de Node** | El claim tiene que ocurrir **dentro de la transacción del efecto**. Una librería en la capa de aplicación queda fuera de esa transacción, que es precisamente donde no sirve. |
| **Cambiar el nivel de aislamiento a SERIALIZABLE** | Tentador, pero convierte el problema en errores de serialización que hay que reintentar, y no da identidad ni outcome. El claim por inserción es más barato y más explícito. |

---

## 14. QUESTIONS THAT MUST BE ANSWERED BY RUNTIME TESTS

Aplicando [[feedback_hallazgo_estatico_no_es_defecto]]: **nada de esto es defecto hasta reproducirlo.**

| # | Pregunta | Cómo se contesta | Si sale mal |
|---|---|---|---|
| **T1** | ¿Se puede insertar en `pos_save_operations` por el proxy con un shift token de mesero? | Un POST autenticado a `/api/pos/db/rest/v1/pos_save_operations` en **staging** | Supresión silenciosa de órdenes. Sube a P0 |
| **T2** | ¿Un recibo pre-insertado con `state='COMMITTED'` hace que un save legítimo se conteste como replay? | Insertar el recibo y luego guardar la orden, en staging | Confirma que T1 es explotable |
| **T3** | ¿Dos `INSERT … ON CONFLICT DO NOTHING` concurrentes con la misma llave se serializan como dice el comentario (:41-44)? | Dos sesiones concurrentes contra la misma llave | El claim no serializa y todo el patrón se cae |
| **T4** | ¿Dos llamadas concurrentes a `pos_record_inventory_movement` con la misma llave producen un solo efecto? | Dos clientes en paralelo, comparar stock antes/después | El advisory lock no cubre lo que dice |
| **T5** | ¿Se puede mover stock por `PATCH` REST saltándose el RPC? | PATCH a `pos_inventory` con rol gerente | §10 confirmado: la puerta trasera es real |
| **T6** | ¿Las migraciones de inventario y transfer están **aplicadas en prod**? | Lista de migraciones aplicadas | Todo §2.2 y §10 describen código que no corre |
| **T7** | ¿Cuál es la ventana máxima real de replay observada en AMALAY? | Antigüedad de los ítems de la cola | Fija la retención de R8. Si supera la poda, F10 duplica |
| **T8** | ¿Existe hoy algún evento lógico que dos terminales puedan originar? | Recorrer los flujos reales con Eduardo | Si sí, F8 es real y urge derivar llaves del hecho |

**T8 no es una prueba técnica: es una pregunta para el restaurante.** Y es la que más cambia el
diseño.

---

## 15. DECISIONS SAFE TO MAKE NOW

Ninguna requiere código ni más investigación.

| # | Decisión | Por qué es segura |
|---|---|---|
| **D1** | **Un solo nombre para la identidad de operación** en todo Fullsite. Tres nombres para un concepto ya existen. | Renombrado conceptual, cero riesgo |
| **D2** | **`client_op_id` se persiste ANTES del primer intento.** Nunca se genera al enviar. | TigerBeetle **[FACT]**. Es lo único que separa F1 de una pérdida silenciosa |
| **D3** | **El outcome es parte del contrato, no el código HTTP.** Toda operación de negocio contesta con estado + outcome en el cuerpo. | Elimina el bucle 409→releer→adivinar, que es la pregunta central |
| **D4** | **Misma llave + intent distinto = error explícito**, nunca ACK silencioso. | Stripe **[FACT]**; los tres RPC de `main` ya lo hacen |
| **D5** | **El fingerprint cubre el intent de negocio, no la procedencia** (fuera `actor`, `terminal_id`, timestamps). | Ya decidido en inventario `:55-57` **[FACT]** |
| **D6** | **Receipt, no watermark**, para correctitud. `terminal_seq` es telemetría opcional. | §4, §5 |
| **D7** | **El libro de recibos nunca es escribible por el cliente.** | Regla de diseño independiente de si T1 resulta explotable |
| **D8** | **Efecto + recibo en una transacción servidor.** Ningún efecto de negocio se compone desde el cliente con read-modify-write. | §10; Replicache y outbox **[FACT]** |
| **D9** | **Retención de recibos > ventana máxima de replay.** No se poda a 24 h como Stripe. | F10. Stripe no tiene terminales que reconectan tras un puente |
| **D10** | **Un contrato se cumple cuando es el único camino.** Todo RPC nuevo se acompaña del cierre de sus caminos alternativos. | §10. El RPC de inventario ya existe y la puerta sigue abierta |

**La única que haría hoy, si sólo se puede una:** D10. No porque sea la más urgente, sino porque es
la que evita que las otras nueve se conviertan en documentación de algo que el sistema permite saltarse.

---

## Cierre

**Este documento cierra el sprint P0B.** No se tocó P0A, no se implementó P0B, no se inició P0C, no
se usaron subagentes, no se tocó código ni base de datos.

**Lo que este sprint cambió respecto de lo que creíamos ayer:** Fullsite está bastante más adelante
de lo que decía el Track A. El patrón correcto ya existe tres veces en producción-candidata. El
trabajo de P0B es de **unificación y clausura**, no de invención — y el riesgo mayor ya no es la
falta de idempotencia, sino que **existan caminos alternativos al mismo efecto**.
</content>
