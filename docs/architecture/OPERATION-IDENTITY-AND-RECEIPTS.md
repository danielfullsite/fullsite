# IDENTIDAD DE OPERACIÓN Y RECIBOS — contrato canónico

> **Qué es esto:** la definición única de Fullsite para identidad de operación, identidad de hecho de
> negocio, recibo, reintento, replay y procedencia. **Contrato, no investigación.**
> **Fecha:** 2026-09-18 · **Verificado contra:** `origin/main` = `10017cf9` y la base de producción de
> AMALAY (`SELECT` de sólo lectura, mismo día).
> **Estado de implementación:** ninguna parte de este documento autoriza código. Ver §9.
>
> Fuentes, en orden de autoridad: **(1)** repo y runtime · (2) `docs/research/industry-lab/P0B-COMMAND-RECEIPTS.md`
> · (3) `dashboard-app/src/lib/operation-identity.ts` (rama `p0a/append-idempotency`) · (4) `docs/research/operational-brain/IDENTITY-MODEL.md`.
> **Cuando se contradicen, gana el repo.** En §5 gana tres veces.

---

## 1 · PURPOSE

Un append sin identidad no se puede reintentar. Si la petición llegó y la respuesta se perdió, el
replay inserta una fila nueva y el efecto ocurre dos veces. Eso ya pasó en producción: la misma
factura de seis insumos entró dos veces en `pos_inventory_movements` de AMALAY el 2026-07-20, con
1 min 12 s de diferencia, porque la clave de idempotencia llevaba el minuto del reloj
(`dashboard-app/src/lib/clave-de-operacion.ts`).

Este documento existe para que **haya un solo concepto y un solo nombre** antes de que haya un
sexto. Hoy el mismo concepto vive en producción bajo **cinco** nombres distintos (§5).

Lo que este contrato **no** hace: no renombra columnas, no autoriza migraciones, no diseña una cuarta
tabla de recibos, y no promete exactly-once en el transporte.

---

## 2 · DEFINITIONS

**`client_op_id`** — La identidad lógica e inmutable de una operación. La genera el **cliente**, se
persiste **antes del primer intento**, y **nunca** cambia entre reintentos del mismo hecho. Es el
término conceptual canónico de Fullsite. Las columnas históricas que lo implementan con otro nombre
se listan en §5 y **no se renombran** (§8).

**Identidad de hecho de negocio** (*business fact identity*) — Un `client_op_id` **derivado** de
identificadores que el servidor asignó antes del hecho, de modo que dos terminales que observen el
mismo hecho construyan **el mismo valor**. Ejemplo: `po:<order_id>` + el renglón de la orden de
compra.

**Recibo** (*receipt*) — El registro autoritativo del **resultado** de una operación, guardado por el
servidor y reproducible. Un código HTTP no es un recibo. Un `200` con cuerpo vacío no es un recibo.
Un `409` no es un recibo: obliga al cliente a adivinar si el conflicto fue suyo.

**Intent** — El contenido de negocio de la operación: qué se quiere que pase. Es lo que se compara
para decidir si dos peticiones con la misma identidad son la misma operación.

**Fingerprint** — La huella del *intent*, por hash canónico o por comparación de `jsonb`. **Cubre el
intent, nunca la procedencia.**

**Outcome** — Qué pasó: `COMMITTED` · `ALREADY_COMMITTED` · `REJECTED_BUSINESS` ·
`REJECTED_CONFLICT` · `REJECTED_IDENTITY`. Viaja en el **cuerpo** de la respuesta, no en el status.
`COMMITTED` y `ALREADY_COMMITTED` devuelven **el mismo cuerpo**, distinguidos por una bandera.

**Procedencia** (*provenance*) — Quién y desde dónde: `terminal_id`, `actor`, `location_id`, marcas
de tiempo de envío, `build_sha`. Se **registra siempre** y **nunca** entra al fingerprint.

**Reintento** (*retry*) — Reenviar la **misma** operación porque no llegó respuesta. Mismo
`client_op_id`, mismo intent.

**Replay** — Reproducir una operación desde una cola durable tras un reinicio o una reconexión.
Mismo `client_op_id`. Puede ocurrir horas o días después (§4, INV-08).

---

## 3 · IDENTITY DECISION TABLE

| Tipo | Cómo obtiene identidad | Cuándo se genera | Cuándo CAMBIA | Cuándo NO cambia |
|---|---|---|---|---|
| **HUMAN_ACTION** | `client_op_id` **aleatorio** (UUID v4) | En el instante en que la persona **confirma**, y se persiste **antes** del primer intento | Sólo cuando la operación se **confirma** y empieza otra acción distinta | En cada reintento, en cada replay, al recargar la página, tras reiniciar la terminal |
| **BUSINESS_FACT** | `client_op_id` **derivado** de ids que el servidor asignó antes del hecho | Se **calcula**, no se genera: cualquier observador lo reconstruye igual | Nunca, mientras el hecho sea el mismo | Aunque lo reporte otra terminal, otro empleado, u otro día |
| **TRANSPORT_ATTEMPT** | No tiene identidad persistida. Es un contador de diagnóstico | — | En cada intento | — (no participa en la correctitud: §7) |
| **SERVER_ROW** | `id` que asigna Postgres | En el `INSERT` | Nunca | No existe hasta que la fila se escribe, así que **no sirve** como identidad lógica (INV-04) |

**La regla que decide entre las dos familias, y es la única decisión fina de todo el contrato:**

> **Si dos personas en dos terminales pueden reportar el mismo hecho, la identidad se DERIVA del
> hecho. Si sólo una persona en una terminal puede originarlo, la identidad es ALEATORIA.**

Elegir mal rompe justo el caso que se pretendía cubrir, y rompe distinto en cada dirección:

- **Aleatorio donde debía ser derivado** → dos terminales reciben la misma orden de compra, ninguna
  colisiona, el inventario se mueve **dos veces**.
- **Derivado donde debía ser aleatorio** → dos retiros legítimos de $500 en el mismo minuto colapsan
  en uno, y se **borra dinero declarado**.

---

## 4 · INVARIANTS

| # | Invariante | Dónde se sostiene hoy |
|---|---|---|
| **INV-01** | Un reintento **nunca** crea una acción de negocio nueva. Conserva el `client_op_id`. | `clave-de-operacion.ts`, `pedro-comandos.ts` (diario de reintento en `localStorage` antes de enviar), `operation-identity.ts` |
| **INV-02** | Mismo `client_op_id` + intent distinto = **fallo explícito**, nunca un ACK silencioso. | `PAYLOAD_IDENTITY_CORRUPTION` (`r2d_save_operation_idempotency.sql`), `MOVEMENT_KEY_REUSED` (inventario), `IDEMPOTENCY_KEY_REUSED` (Pedro) |
| **INV-03** | Un fallo de transporte **no** es un fallo de negocio. Sin respuesta, el estado es `UNCONFIRMED`, nunca `FAILED`. | `clasificar-fallo.ts`, `veredicto-de-la-autoridad.ts`, `SYNC_UNCONFIRMED` del materializador |
| **INV-04** | El `id` de la fila del servidor **no** es la identidad lógica de la operación. | `claveLogicaDeCaja()` en `operation-identity.ts`: el `id` del servidor no existe hasta que la fila se escribe |
| **INV-05** | La procedencia **no** cambia la identidad de negocio. `actor`, `terminal_id` y las marcas de tiempo quedan fuera del fingerprint. | Decisión ya tomada en la migración de inventario, que excluye `actor` del intent a propósito |
| **INV-06** | Recibo y efecto de negocio son **atómicos** donde la correctitud de dinero o stock lo exige. | `r1_save_order_idempotent` (claim + efecto + outcome en una transacción); `pos_record_inventory_movement` (advisory lock + `FOR UPDATE` + recibo) |
| **INV-07** | Un contrato de recibos **no está completo** mientras exista un camino que se lo salte. | **Hoy NO se cumple** en ningún dominio: §5, columna `BYPASS_EXISTS` |
| **INV-08** | La retención de recibos debe superar la ventana máxima de replay observada. | **Sin definir.** Requiere medición: §10, Q3 |

**INV-07 es el que gobierna a los demás.** Un RPC correcto no protege nada mientras el proxy exponga
la misma tabla. Es el mismo patrón que ya costó caro en este proyecto: el guardián no estaba en la
capa de entrada.

---

## 5 · CURRENT IMPLEMENTATIONS

Mapeo **sin renombrar**. Estado verificado el 2026-09-18 contra `origin/main` y contra la base de
producción de AMALAY. **`ACTIVE_IN_PROD` significa que hay filas, no que exista el SQL.**

### 5.1 Orders — `save_operation_id` → `pos_save_operations`

| Campo | Valor |
|---|---|
| Llave | `(client_id, order_id, save_operation_id)` |
| Fingerprint | `payload_hash` sha256 canónico |
| RPC | `r1_save_order_idempotent` — existe en prod, `SECURITY DEFINER` |
| **Estado** | **IMPLEMENTED · ACTIVE_IN_PROD** — 984 filas, 2026-07-15 → 2026-09-18 |
| **BYPASS_EXISTS** | **Sí, y sobre el libro de recibos mismo.** `pos_save_operations` está en `ALLOW` de `pos-db-policy.ts`, no está en `MANAGER_ONLY_WRITE` y no tiene mínimo en `NIVEL_MINIMO_DE_ESCRITURA` ⇒ `puedeEscribirEn()` devuelve `true` para cualquier rol. El proxy usa service key, que pasa por encima de RLS. **Hallazgo estático, no defecto probado** → §10 Q1 |

### 5.2 Inventory — `idempotency_key` → `pos_inventory_movement_operations`

| Campo | Valor |
|---|---|
| Llave | `(client_id, idempotency_key)`; además índice único parcial `(client_id, movement_operation_key, movement_operation_line)` sobre la tabla de efectos |
| Fingerprint | `intent` jsonb comparado por contenido, **excluyendo `actor`** |
| RPC | `pos_record_inventory_movement` — existe en prod, `SECURITY DEFINER`, con advisory lock y `FOR UPDATE` |
| **Estado** | **IMPLEMENTED · PARTIAL** — el RPC y el índice único existen en producción; la tabla de recibos tiene **0 filas** y sólo **2 de 4,179** movimientos llevan `movement_operation_key`. El mecanismo está construido y prácticamente sin usar |
| **BYPASS_EXISTS** | **Sí.** `pos_inventory` y `pos_inventory_movements` están en `ALLOW`. Están en `MANAGER_ONLY_WRITE`, así que un mesero no pasa — **un gerente sí**, con `PATCH` directo, saltándose RPC, lock y recibo |

### 5.3 Transfers — `operation_id` → `pos_transfer_operations`

| Campo | Valor |
|---|---|
| Llave | `(client_id, operation_id)` · `intent` + `result` jsonb |
| RPC | `r1_transfer_item_atomic` — existe en prod |
| **Estado** | **IMPLEMENTED · NOT_ACTIVE** — 0 filas |
| **BYPASS_EXISTS** | **UNKNOWN** — no se auditó el camino de traslado en esta sesión |

### 5.4 Cash / audit / market — `client_op_id` (P0A)

| Campo | Valor |
|---|---|
| Llave | `(client_id, client_op_id)`, índice único **parcial** (`WHERE client_op_id IS NOT NULL`), en `pos_cash_movements`, `pos_audit_log` y `pos_market_movements` |
| Código | `dashboard-app/src/lib/operation-identity.ts` — **sólo en la rama `p0a/append-idempotency`**, no en `origin/main` |
| **Estado del DDL** | **ACTIVE_IN_PROD · UNTRACKED.** Las tres columnas y los tres índices **existen en la base de AMALAY**, exactamente como los define `supabase/migrations/PENDIENTE_20260917200000_append_idempotency.sql` — pero la migración **no aparece** en `supabase_migrations.schema_migrations`. El esquema va por delante de `main` y por fuera del mecanismo de migraciones |
| **Estado de la escritura** | `pos_cash_movements`: 9 de 9 filas con `client_op_id`. `pos_audit_log`: 16 de 1,690. `pos_market_movements`: 0 de 238. **Todas las filas con identidad son del tenant `fullsite-cert-lab-v2`, del 2026-09-18** — es la corrida de certificación, no operación real |
| **BYPASS_EXISTS** | **Sí.** `pos_cash_movements` está en `ALLOW` con mínimo `cajero`; `pos_audit_log` está en `ALLOW` sin mínimo |

### 5.5 El sexto nombre, ya en la base

`pos_cleanup_operations` y `pos_cleanup_atoradas` tienen columna `operation_id` (0 filas cada una).
Es el mismo concepto con el mismo nombre que transfers, en otro dominio. **Se registra aquí para que
la cuenta sea honesta: hay cinco nombres para un concepto** — `save_operation_id`,
`idempotency_key`, `operation_id` (×2 dominios), `movement_operation_key` y `client_op_id`.

### 5.6 Resumen

| Dominio | IMPLEMENTED | ACTIVE_IN_PROD | PARTIAL | BYPASS_EXISTS |
|---|---|---|---|---|
| Orders | sí | **sí** (984 filas) | — | **sí** (sobre el libro de recibos) |
| Inventory | sí | no (0 filas) | **sí** (índice vivo, 2/4,179) | **sí** (nivel gerente) |
| Transfers | sí | no (0 filas) | — | UNKNOWN |
| Cash / audit / market | sí (en rama) | **DDL sí, escritura sólo en lab** | **sí** | **sí** |

**Ningún dominio cumple INV-07 hoy.**

---

## 6 · IDENTITY EXAMPLES

| Operación | Familia | `client_op_id` | Por qué |
|---|---|---|---|
| **Retiro de caja** | HUMAN_ACTION | UUID v4, generado al confirmar y persistido antes de enviar | Dos retiros de $500 en el mismo minuto son **dos hechos**. Derivar del contenido los colapsaría y borraría dinero declarado |
| **Recepción de orden de compra** | BUSINESS_FACT | `po:<order_id>` + el id del renglón (**no** el índice del arreglo: el orden de una lista depende de cómo se cargó) | Caja y almacén pueden recibir la misma OC sin saberlo. Los dos deben construir la misma identidad |
| **Guardado de orden** | HUMAN_ACTION | `save_operation_id` aleatorio, estable entre reintentos, con OCC por `order_revision` encima | Una sola terminal la origina. La revisión resuelve la concurrencia; la identidad resuelve el replay |
| **Ajuste manual de inventario** | HUMAN_ACTION | UUID v4 | Es un juicio de una persona en una pantalla. Dos conteos idénticos en el mismo día son dos ajustes reales |
| **Intento de pago con terminal bancaria** | HUMAN_ACTION, con matiz | UUID v4 generado **antes** de llamar al adquirente, persistido antes de la llamada | El efecto externo ocurre fuera de nuestra transacción. Es el caso de `recoverable-operation.ts`: identidad estable, persistencia pre-llamada, estado bloqueado al montar. El `id` del adquirente es **procedencia**, no nuestra identidad |

---

## 7 · WHAT NOT TO BUILD

| No construir | Por qué |
|---|---|
| **`attempt_id` / `request_id` genéricos como requisito de correctitud** | La correctitud sale entera de `client_op_id` + llave única + recibo. El número de intento es diagnóstico. Hoy `request_id` aparece **una vez** en todo `origin/main`, y es el id del pinpad de Clip, no nuestro |
| **Orden total por terminal (watermark como mecanismo de correctitud)** | Un watermark responde *"¿procesé todo lo de este dispositivo?"*; el problema es *"¿ya ocurrió este hecho?"*. Y un orden estricto convierte una operación atorada en un bloqueo de todas las siguientes. Como telemetría de huecos sí sirve; como aceptación de escrituras, no |
| **Una cuarta tabla de recibos** | Ya hay tres, y ése es el problema, no la solución |
| **Un resolvedor genérico de conflictos (CRDT o similar)** | Los conflictos de Fullsite son de negocio —el turno cerró antes del replay— y los resuelve una persona, no un algoritmo de merge |
| **Prometer exactly-once en el transporte** | El contrato es *at-least-once delivery* + *efecto de negocio idempotente* + *recibo autoritativo*. Prometer lo otro obliga a mentir en algún punto de la cadena |
| **Estado `EXECUTING` observable, con expiración y recuperación de huérfanos** | No hace falta mientras el recibo viva en la misma transacción que el efecto: un crash se lleva los dos. Sólo se necesita el día que el efecto salga de la transacción |
| **Guardar saldos absolutos en el outcome** | Un `stock_after` congelado hace dos días **miente** cuando se reproduce hoy. Sirve como procedencia histórica, nunca como saldo vigente |

---

## 8 · MIGRATION PRINCIPLE

> **`client_op_id` es el lenguaje conceptual. Las columnas legacy no se renombran ahora.**

`save_operation_id`, `idempotency_key`, `operation_id` y `movement_operation_key` se documentan como
**implementaciones específicas del mismo concepto**, y así se citan en código, PRs y documentos. Una
columna se renombra sólo cuando exista una razón concreta —un dominio nuevo que las mezcle, o una
consulta que las tenga que unir— y nunca como trabajo cosmético.

La razón no es pereza: renombrar una columna con 984 filas vivas y un RPC `SECURITY DEFINER` encima
es riesgo de producción a cambio de cero capacidad nueva. El costo real de los cinco nombres no está
en la base: está en que cada sesión inventa el sexto. Eso lo arregla este documento, no una migración.

---

## 9 · P0B ENTRY GATE

```
P0B_IMPLEMENTATION_ALLOWED = false
```

Condición de entrada, y no hay otras:

```
P0A_STATUS = PASS
```

Al 2026-09-18, P0A está en corrección tras un **FAIL de D2-E**. Mientras eso siga abierto:

- no se implementa ninguna sección de este documento,
- no se amplía el alcance de P0A para meterle nada de aquí,
- no se abre P0C,
- y **un hallazgo estático de §5 no se promueve a defecto** sin reproducirlo en runtime.

Este documento es el **entregable** de la fase de contrato. Su valor es que exista antes de la
implementación, no que la adelante.

---

## 10 · OPEN QUESTIONS

Sólo las que el runtime todavía debe contestar. Ninguna se resuelve leyendo más código.

| # | Pregunta | Cómo se contesta | Qué cambia |
|---|---|---|---|
| **Q1** | ¿Se puede insertar en `pos_save_operations` por el proxy con un shift token, y pre-insertar un recibo `COMMITTED` hace que un guardado legítimo se conteste como replay? | Un POST autenticado en **staging**, nunca en AMALAY | Si sí: supresión silenciosa de órdenes. Sube a P0 y cambia la prioridad de todo |
| **Q2** | ¿Se puede mover stock con `PATCH` REST saltándose `pos_record_inventory_movement`? | `PATCH` a `pos_inventory` con rol gerente, en staging | Confirma que INV-07 está roto en inventario y define el orden de cierre |
| **Q3** | ¿Cuál es la ventana máxima real de replay observada en campo? | Antigüedad de los ítems más viejos de la cola offline en una terminal real | Fija el número de INV-08. Sin él, la retención es una opinión |
| **Q4** | ¿Existe hoy algún hecho que **dos terminales** puedan originar en AMALAY? | Recorrer los flujos reales con Eduardo. **No es una prueba técnica** | Si sí, la familia BUSINESS_FACT es urgente. Si no, es diseño preventivo |
| **Q5** | ¿Por qué el DDL de P0A está aplicado en AMALAY y no registrado en `schema_migrations`? | Preguntar a quien lo aplicó | Si el esquema puede adelantarse a `main` sin rastro, ninguna auditoría de migraciones vale. Es un problema de proceso, no de diseño |

---

## Apéndice · frontera público/privado

`danielfullsite/fullsite` es un repositorio **público**. Esta tabla es una **recomendación**: no mueve
archivos, no borra ramas y no reescribe los PR #420 ni #421.

| DOC_CATEGORY | PUBLIC_OK | PRIVATE_REQUIRED | WHY |
|---|---|---|---|
| **Contratos de arquitectura** (este documento, `envelope.ts`, el modelo de identidad) | **sí** | no | Describen *cómo* se construye, no *qué* se puede romper. Publicarlos ayuda a contratar y no le da nada a un atacante |
| **Inteligencia competitiva** (análisis de POS rivales, caídas de la competencia) | no | **sí** | No hay riesgo de seguridad; hay riesgo comercial. Una comparación publicada es munición gratis para el rival que la lea |
| **Comisiones de adquirente / precios de comerciante** | no | **sí** | Son términos negociados. Publicarlos afecta la posición de Fullsite frente al adquirente y frente al cliente |
| **Topología de un cliente con nombre** (AMALAY: qué terminal, qué hardware, qué impresora) | no | **sí** | Es un mapa de la instalación física de un tercero. No es nuestro para publicar, aunque no contenga datos personales |
| **Detalle de incidentes** (postmortems con rutas, horas y modo de fallo) | parcial | **sí** mientras el fallo siga abierto | Un postmortem con la vulnerabilidad aún viva es una guía de explotación. Una vez cerrado, publicarlo es valioso |
| **Diseño de seguridad** (políticas, SAQ-A, modelo de amenazas) | **ya es público** | revisar | Las 13 políticas ya están en `main`. La decisión ya se tomó de hecho; conviene que sea explícita en vez de por inercia |
| **Runbooks operativos** (cómo reiniciar Pedro, cómo forzar conciliación) | no | **sí** | Describen cómo intervenir un sistema en producción. Poco valor externo, alto valor para quien quiera interferir |
| **Evidencia de certificación** (actas, SHAs objetivo, matrices de prueba) | **sí** | no | Es prueba de rigor y no expone credenciales: el rig lee sus tokens del entorno y tiene lista de tenants prohibidos |

**La recomendación en una línea:** si el problema es *comercial o de un tercero*, va a privado; si el
problema sería *de seguridad*, casi todo ya está publicado y lo que corresponde es cerrar el fallo,
no esconder el documento.

---

> **Este documento no autoriza implementación.** Ver §9.
