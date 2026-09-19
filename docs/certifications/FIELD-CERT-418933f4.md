# Field Cert AMALAY — F1–F9

> **Pin:** `418933f4ac8bf74a177487bb5c0aef0a45735d7b`
> Congelado el 2026-09-19. Este documento sólo vale para ese SHA. Si producción
> cambia, se regenera: un runbook pineado a un SHA que ya no corre es peor que
> ninguno, porque se ve igual de válido.

---

## 0. Identidad de lo que se va a certificar

| | |
|---|---|
| `PROD_SHA` | `418933f4ac8bf74a177487bb5c0aef0a45735d7b` |
| `VERCEL_DEPLOYMENT_ID` | `dpl_7aHncjNL1JzyDsqo9NqfbDr4i7Br` |
| URL de producción | `https://app.fullsite.mx` (alias del deployment de arriba) |
| Proyecto Supabase | `qjiomlvudfmzuvqvhwpk` |

**Migraciones aplicadas y verificadas por huella contra el archivo de `main`:**

| función | `md5(pg_get_functiondef)` |
|---|---|
| `pos_numero_finito` | `2eb3e40ef7295d070bdc6535fb6ee752` |
| `pos_create_purchase_order` | `20453cf83f43d526fdcc1ff1375cbf65` |
| `pos_create_ingredient` | `4f04f14768ed19fdd08388ca21a4c469` |
| `pos_record_inventory_movement` | `f136ba0aaed320480efa36ccd213fe8b` |

Verificación de identidad antes de empezar — si alguna difiere, **ABORT**:

```sql
select p.proname, md5(pg_get_functiondef(p.oid))
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
  ('pos_numero_finito','pos_create_purchase_order','pos_create_ingredient','pos_record_inventory_movement')
order by 1;
```

---

## 1. Línea base congelada — AMALAY, 2026-09-19

Todo delta de F1–F9 se mide **contra estos números**. No se vuelven a tomar al
empezar: si al arrancar no coinciden, alguien operó en medio y eso hay que saberlo
antes, no descubrirlo al final.

| métrica | valor congelado |
|---|---|
| `pos_turnos` total / **abiertos** | 41 / **1** |
| turno abierto | `mu1qc5zt6y17` · abierto **2026-09-14 21:03:04 UTC** · por Daniel · fondo 500 |
| último turno cerrado | `mu0o364i2erd` · 2026-09-14 17:03:05 UTC |
| `pos_orders` total | 43 — `cancelada=27` `cerrada=10` **`enviada=6`** |
| última orden | 2026-09-14 23:02:39 UTC |
| `pos_cash_movements` | **0** |
| `pos_print_jobs` total | 371 — `cancelled=153` `failed=146` `printed=72` |
| último `pos_print_jobs` | **2026-09-03 02:48:24 UTC** |
| `pos_save_operations` | 430 — `COMMITTED=366` `REJECTED=64` |
| `pos_inventory_movements` | 2,826 |
| `pos_local_events` | **0** |
| `local_server_heartbeats` | **0** |
| `pos_cierres` | 12 — último folio Z **8**, 2026-09-14 17:03:05 UTC |
| `pos_ingredients` / `pos_inventory` | 1,272 / 1,268 |
| ingredientes activos **sin** fila de inventario | **4** |
| `pos_purchase_orders` / renglones | 0 / 0 |
| mesas / staff activo | 33 / 40 |

Consulta para revalidar la línea base:

```sql
select 'turnos_abiertos', count(*)::text from pos_turnos where client_id='amalay' and closed_at is null
union all select 'orders', count(*)::text from pos_orders where client_id='amalay'
union all select 'orders_enviada', count(*)::text from pos_orders where client_id='amalay' and status='enviada'
union all select 'cash', count(*)::text from pos_cash_movements where client_id='amalay'
union all select 'print_jobs', count(*)::text from pos_print_jobs where client_id='amalay'
union all select 'save_ops', count(*)::text from pos_save_operations where client_id='amalay'
union all select 'inv_mov', count(*)::text from pos_inventory_movements where client_id='amalay'
union all select 'local_events', count(*)::text from pos_local_events where restaurant_id='amalay'
union all select 'heartbeats', count(*)::text from local_server_heartbeats where restaurant_id='amalay'
union all select 'cierres', count(*)::text from pos_cierres where client_id='amalay';
```

---

## 2. Lo que YA está roto antes de empezar

Esto no son riesgos hipotéticos: son hechos medidos el 2026-09-19. Se listan
aquí porque cada uno **apaga un oráculo**, y un oráculo apagado que nadie declaró
es exactamente como se fabrica un PASS falso.

### 2.1 No hay tabla de KDS en la nube

Medido: `information_schema.tables` no tiene **ninguna** tabla `%kds%`,
`%kitchen%` ni `%cocina%`. El KDS vive entero en el servidor local.

→ **F3 no tiene oráculo remoto.** Su evidencia es local + confirmación física.
Nadie debe buscar una fila en Supabase para dar F3 por bueno.

### 2.2 El reporte de impresión está muerto desde el 3-sep

| día | órdenes | print_jobs |
|---|---|---|
| 2026-08-31 | 16 | 15 |
| 2026-09-01 | 8 | 8 |
| 2026-09-03 | 5 | 10 |
| **2026-09-14** | **7** | **0** |

Las 7 órdenes del 14-sep no tienen **ni un** `pos_print_jobs`. Y el POS sí estaba
vivo ese día: escribió 18 `pos_save_operations` y 58 movimientos de inventario.
O sea que lo que se cayó es el reporte de impresión en particular, no la terminal.

→ **F4 arranca con su oráculo remoto en duda.** El pre-flight decide si sirve;
si no escribe, F4 es `NOT_OBSERVED` en software y sólo cuenta el papel.

### 2.3 Telemetría de flota en cero

`pos_local_events = 0` y `local_server_heartbeats = 0`. Cero filas desde que las
tablas existen.

→ **No usar heartbeats ni local_events como oráculo de nada** salvo que el
pre-flight los vea escribir. Un cero aquí no dice «sano», dice «mudo».

### 2.4 El turno lleva 5 días abierto y arrastra 6 cuentas

Turno `mu1qc5zt6y17` abierto desde el 14-sep. Seis órdenes en `enviada`:

| orden | mesa | creada (UTC) | total |
|---|---|---|---|
| `5f405f53` | 1 | 2026-09-14 03:15 | $197.20 |
| `ea426383` | 2 | 2026-09-14 03:21 | $232.00 |
| `b34d3470` | 7 | 2026-09-14 22:43 | $394.40 |
| `45ee27ee` | 9 | 2026-09-14 22:47 | $197.20 |
| `2713bd03` | 10 | 2026-09-14 22:48 | $197.20 |
| `9bb59074` | 11 | 2026-09-14 23:02 | $197.20 |

→ **F1 no es «cerrar un turno»: es resolver seis cuentas abiertas de hace cinco
días.**

Y es más que eso. El **14-sep**, el Corte Z folio 8 se cerró así:

```
folio_z=8 · cierre_con_ordenes_abiertas=false · ordenes_pendientes=[]
```

con las órdenes de mesa 1 ($197.20) y mesa 2 ($232.00) ya abiertas. O sea:
$429.20 colgando en el salón y el cierre diciendo que no había nada. Ése es el
defecto que documenta el commit de #423:

> `leerCuentasAbiertas` preguntaba si Pedro **contestaba**, no si lo que contestó
> **alcanzaba**. Pedro decía `authoritative: true` con `order_snapshot_complete:
> false` y `salon_orders: []`, y el wizard abría directo en «¿Cuánto efectivo hay
> en caja?».

**El arreglo está vivo en producción desde el 2026-09-19 01:38 UTC** (`427af68c`,
ancestro del pin). Nunca se ha ejercido en campo.

→ **F1 es la primera prueba real de ese arreglo, y las seis órdenes son el
fixture.** Las dos de mesa 1 y 2 son literalmente las que aparecen en el commit.

### 2.5 Cuatro insumos de AMALAY sin fila de inventario

Se curan solos en su primer movimiento con el cambio de #426. No hay backfill
pendiente; sólo hay que no asustarse si aparecen filas nuevas de `pos_inventory`
sin que nadie las haya creado a mano.

---

## 3. Reglas de la corrida

**Vocabulario de veredicto.** No hay otros, y no son intercambiables:

| veredicto | qué exige |
|---|---|
| `PASS` | efecto esperado observado en software **y** confirmado en físico cuando el paso lo pide |
| `FAIL` | efecto contrario al esperado, observado |
| `NOT_OBSERVED` | no se pudo mirar. **Nunca es PASS**, aunque «seguramente funcionó» |
| `ABORT` | se cumplió una condición de aborto: se detiene la corrida, no se sigue al paso siguiente |

**Contrato de esfuerzo:**

- **Nadie apunta horas a mano.** Cada paso se correlaciona por su delta contra la
  línea base y por los ids que el propio paso devuelve.
- **Daniel confirma sólo lo físico:** papel que salió, pantalla de cocina, cajón
  que abrió, monto contado. Nada más.
- Si un paso no se puede observar en software, se marca `NOT_OBSERVED` y se sigue
  **sólo si el paso siguiente no depende de él**.

**Antes de cada F:** se toma el conteo de la tabla que ese paso debe mover.
**Después:** se vuelve a tomar. El delta es la evidencia. Un paso cuyo delta sea 0
donde se esperaba 1 es `FAIL`, no «a lo mejor tardó».

---

## 4. Pre-flight — antes de F1

Sin esto, F1–F9 miden el aire.

| # | Comprobación | Cómo | ABORT si |
|---|---|---|---|
| P1 | Las 4 huellas de funciones coinciden con §0 | SQL de §0 | alguna difiere |
| P2 | La línea base de §1 sigue igual | SQL de §1 | difiere sin explicación |
| P3 | La terminal sirve `418933f4` | en la caja: DevTools → Network → cualquier `/_next/` | sirve otro build |
| P4 | Pedro responde en la caja | `http://127.0.0.1:7717/health` → 200 | no responde |
| P5 | Identidad de la terminal es AMALAY | `http://127.0.0.1:7717/identity` → `fullsite_client_id = amalay` | otro tenant |
| P6 | **¿`pos_print_jobs` escribe?** Imprimir cualquier cosa de prueba y ver si aparece fila | contar antes/después | — (no aborta; define si F4 tiene oráculo) |
| P7 | Estado de las 4 terminales | `scripts/campo/recoger-estado-terminal.ps1` en Caja, Entrada, Escondite y Cocina | — |

`P6 = false` ⇒ en F4, `SOFTWARE_OBSERVABLE = NOT_OBSERVED` desde el principio y se
dice así en el reporte.

---

## 5. F1 — resolver el turno viejo y abrir uno nuevo

> **Antes de tocar nada**, preguntarle a Pedro qué ve. Es el dato que decide si
> el arreglo funcionó, y sólo existe **antes** del cierre:
>
> ```
> GET http://127.0.0.1:7717/state   (con credencial LAN)
>   → authoritative
>   → order_snapshot_complete      ← el campo del arreglo
>   → salon_orders                 ← cuántas trae
> ```
>
> El wizard **debe** bloquear si `order_snapshot_complete = false`, aunque
> `salon_orders` venga vacío. Ése es el arreglo. Anotar los tres valores.

**SOFTWARE_OBSERVABLE**
- El wizard **no** abre en «¿Cuánto efectivo hay en caja?»: primero enseña las cuentas abiertas o exige autorización.
- `pos_turnos`: el abierto `mu1qc5zt6y17` pasa a `closed_at not null`; aparece exactamente **1** turno nuevo con `closed_at is null`.
- `pos_cierres`: **+1** fila, `folio_z = 9` (el último fue 8), y —esto es lo importante— `cierre_con_ordenes_abiertas` y `ordenes_pendientes` **reflejando las 6**.

```sql
select (select count(*) from pos_turnos where client_id='amalay' and closed_at is null) as turnos_abiertos,
       (select count(*) from pos_orders where client_id='amalay' and status='enviada') as ordenes_enviada,
       c.folio_z, c.cierre_con_ordenes_abiertas, c.ordenes_pendientes,
       c.cola_pendiente_al_cerrar, c.total_ventas, c.efectivo_sistema, c.diferencia
from pos_cierres c where c.client_id='amalay' order by c.created_at desc limit 1;
```

**PHYSICAL_CONFIRMATION_REQUIRED**
- ¿Salió el ticket de Corte Z en papel?
- ¿La pantalla avisó de las cuentas abiertas ANTES de pedir el efectivo?
- ¿El efectivo contado cuadra con lo que dice la pantalla?

**EXPECTED_DB_EFFECT** — `turnos_abiertos = 1` (el nuevo) · `folio_z = 9` · `pos_cierres` +1 · **`cierre_con_ordenes_abiertas = true`** y `ordenes_pendientes` con las 6 (o las que queden sin cobrar), porque las hay.

**EXPECTED_LOCAL_EFFECT** — el turno nuevo queda en el almacenamiento local de la caja; al recargar la pantalla sigue abierto.

**ABORT_CONDITION**
- El cierre queda con **`cierre_con_ordenes_abiertas = false`** y `ordenes_pendientes = []` teniendo 6 en `enviada`. Es exactamente lo que pasó en el folio 8 el 14-sep. Significa que el arreglo de `427af68c` no agarró en campo. **ABORT** y no seguir a F2.
- El wizard abre directo en el paso del efectivo sin mencionar cuentas abiertas.
- Se crea más de un turno abierto.
- El folio Z no avanza o se repite.

> **Ojo con el `TURNO_CLOSED`.** Si el cierre pasa sin ver las cuentas, además de
> cuadrar mal se las lleva del KDS. El daño no es sólo contable.

---

## 6. F2 — crear orden

**SOFTWARE_OBSERVABLE** — `pos_orders` +1 con `client_id='amalay'`, ligada al turno nuevo. `pos_save_operations` +1 en `COMMITTED`.

```sql
select id, mesa, status, total, created_at from pos_orders
where client_id='amalay' order by created_at desc limit 3;
```

**PHYSICAL_CONFIRMATION_REQUIRED** — ninguna. Este paso es puro software.

**EXPECTED_DB_EFFECT** — +1 `pos_orders` · +1 `pos_save_operations` en `COMMITTED`

**EXPECTED_LOCAL_EFFECT** — la mesa se pinta ocupada en el plano y sigue ocupada al recargar.

**ABORT_CONDITION** — `pos_save_operations` suma una fila en `REJECTED` (`STALE_WRITE_REJECTED` u `ORDER_NOT_FOUND`): la orden no quedó guardada y seguir mide humo.

---

## 7. F3 — enviar a KDS

> **No hay tabla de KDS en la nube.** Ver §2.1. Este paso se certifica con el
> servidor local y con los ojos.

**SOFTWARE_OBSERVABLE** — el registro de eventos del servidor local crece (`recoger-estado-terminal.ps1` paso 6 mide su tamaño). La orden queda `enviada`.

**PHYSICAL_CONFIRMATION_REQUIRED**
- ¿Apareció la comanda en la pantalla de cocina?
- ¿Con los tiempos y modificadores correctos?
- ¿Cuántos segundos tardó desde que se pulsó «Enviar»?

**EXPECTED_DB_EFFECT** — `pos_orders.status = 'enviada'`. Nada más: no busques fila de KDS, no existe.

**EXPECTED_LOCAL_EFFECT** — evento `ORDER_SENT` por HTTP (no `ws://`) en el servidor local; la comanda sobrevive a recargar el KDS.

**ABORT_CONDITION** — la comanda no llega al KDS y tampoco hay evento local: el camino está roto y F4–F5 medirían sobre una orden que cocina nunca vio.

---

## 8. F4 — imprimir

> Oráculo remoto **en duda** (§2.2). P6 decide.

**SOFTWARE_OBSERVABLE** — `pos_print_jobs` +1 con `status='printed'` — **sólo si P6 salió verdadero**. Si no: `NOT_OBSERVED`.

```sql
select id, station, type, status, retries, left(coalesce(error,''),60) as error, created_at
from pos_print_jobs where client_id='amalay' order by created_at desc limit 5;
```

**PHYSICAL_CONFIRMATION_REQUIRED**
- ¿Salió el papel?
- ¿En qué impresora? (Caja / cocina / barra / tickets)
- ¿Legible y completo, o cortado?

**EXPECTED_DB_EFFECT** — +1 `printed`, `retries = 0`. Una fila `failed` con
`Failed after 5 attempts` es el error histórico más común (106 de 146): si
reaparece, es el mismo problema de siempre, no uno nuevo.

**EXPECTED_LOCAL_EFFECT** — el trabajo sale por `FULLSITE_BRIDGE_URL`, no por la nube.

**ABORT_CONDITION** — no sale papel **y** no hay fila: F5 (cobrar) imprime también, así que se arrastraría el fallo.

---

## 9. F5 — cobrar

**SOFTWARE_OBSERVABLE** — la orden pasa a `cerrada` con `closed_at`. `pos_save_operations` +1 `COMMITTED`.

```sql
select id, status, total, closed_at from pos_orders
where client_id='amalay' and id = '<id de F2>';
```

**PHYSICAL_CONFIRMATION_REQUIRED**
- ¿Salió el ticket de cobro?
- ¿Abrió el cajón?
- ¿El monto impreso es el mismo que el de la pantalla?

**EXPECTED_DB_EFFECT** — `status='cerrada'`, `closed_at` poblado, total sin cambio respecto de F2.

**EXPECTED_LOCAL_EFFECT** — la mesa vuelve a disponible en el plano.

**ABORT_CONDITION** — el total cobrado difiere del total de la orden, o la orden queda en `enviada` con ticket impreso — cobrado sin cerrar es doble cobro esperando a pasar.

---

## 10. F6 — retiro de caja

> **AMALAY tiene 0 `pos_cash_movements` históricos.** Este paso escribe el primero
> de la historia del restaurante. Si falla, no hay precedente que consultar.

**SOFTWARE_OBSERVABLE** — `pos_cash_movements` **0 → 1**, con `client_op_id` presente y `id` generado por el servidor (bigint, no UUID del cliente).

```sql
select id, client_op_id, movement_type, amount, reason, actor, created_at
from pos_cash_movements where client_id='amalay' order by created_at desc limit 5;
```

**PHYSICAL_CONFIRMATION_REQUIRED**
- ¿Abrió el cajón?
- ¿El monto retirado físicamente es el que se capturó?
- ¿Salió comprobante?

**EXPECTED_DB_EFFECT** — exactamente **1** fila nueva. Dos filas con el mismo `client_op_id` = fallo de idempotencia.

**EXPECTED_LOCAL_EFFECT** — el movimiento queda durable en la caja antes de confirmarse en pantalla.

**ABORT_CONDITION** — se escriben 2 filas para un retiro, o la fila llega sin `client_op_id` (sin él, el reintento de F9 duplicaría).

---

## 11. F7 — Corte Z

**SOFTWARE_OBSERVABLE** — `pos_cierres` +1, `folio_z = 10` (tras el 9 de F1). El turno abierto en F1 queda cerrado. El corte incluye la venta de F5 y el retiro de F6.

```sql
select folio_z, total_ventas, efectivo_sistema, diferencia, tickets_count,
       cierre_con_ordenes_abiertas, ordenes_pendientes, cola_pendiente_al_cerrar, created_at
from pos_cierres where client_id='amalay' order by created_at desc limit 2;
```

Aquí **sí** se espera `cierre_con_ordenes_abiertas = false` y `ordenes_pendientes
= []`: a diferencia de F1, el salón quedó limpio porque F5 cobró la única cuenta.
Si sale `true`, hay algo abierto que nadie cobró — averiguar qué antes de seguir.

`cola_pendiente_al_cerrar` debe ser **0**. Los folios 5, 6 y 7 cerraron con 4, 8
y 10 pendientes en cola; cerrar con cola pendiente es cerrar sobre datos que aún
no llegaron.

**PHYSICAL_CONFIRMATION_REQUIRED**
- ¿Salió el Z en papel?
- ¿El efectivo contado coincide con `efectivo_sistema`?
- Si hay diferencia, ¿cuánta y en qué dirección?

**EXPECTED_DB_EFFECT** — `folio_z` consecutivo sin huecos · `turnos_abiertos = 0` · el retiro de F6 refleja en el efectivo esperado.

**EXPECTED_LOCAL_EFFECT** — la caja queda sin turno y pide abrir uno nuevo.

**ABORT_CONDITION** — el folio se repite o se salta · el Z no incluye la orden de F5 · `diferencia` no explicable por el retiro de F6.

---

## 12. F8 — repetir el flujo crítico SIN WAN

> Cortar **sólo** la salida a internet. La LAN debe seguir viva: el POS habla con
> Pedro por `127.0.0.1:7717` y con el KDS por LAN. Si se corta la LAN no se está
> probando offline, se está probando una terminal desconectada de sí misma.
>
> `navigator.onLine` **no** es evidencia de conectividad. Lo que cuenta es si las
> peticiones a la nube fallan y las locales no.

**SOFTWARE_OBSERVABLE** — durante el corte: **cero** filas nuevas en `pos_orders`, `pos_save_operations` y `pos_cash_movements` en la nube. La cola local crece.

**PHYSICAL_CONFIRMATION_REQUIRED**
- ¿Se pudo abrir mesa, mandar a cocina, imprimir y cobrar **sin internet**?
- ¿La comanda llegó al KDS?
- ¿Salió papel?
- ¿La pantalla avisó que está sin conexión, o fingió normalidad?

**EXPECTED_DB_EFFECT** — **ninguno mientras dure el corte.** Cualquier fila nueva en la nube durante el corte significa que el corte no fue real: **ABORT** y repetir.

**EXPECTED_LOCAL_EFFECT** — la operación completa vive en la caja: orden, comanda, impresión y cobro. La cola de sincronización acumula pendientes con su identidad durable.

**ABORT_CONDITION**
- El POS cae a error de API en vez de encolar. La regla dura es que ante `navigator.onLine === false`, status 0/5xx o timeout, se cae a `OFFLINE_QUEUED` — **nunca** a `API_ERROR`, porque eso pierde la orden y no imprime.
- No imprime estando offline.
- Aparecen filas en la nube durante el corte.

---

## 13. F9 — reconectar y verificar drenado exactly-once

**SOFTWARE_OBSERVABLE** — al volver el WAN, la nube recibe **exactamente** lo que se hizo offline: ni una fila de más, ni una de menos.

```sql
-- Duplicados por identidad lógica. Debe devolver 0 filas.
select client_op_id, count(*) from pos_cash_movements
where client_id='amalay' and client_op_id is not null
group by 1 having count(*) > 1;

select save_operation_id, count(*) from pos_save_operations
where client_id='amalay' group by 1 having count(*) > 1;
```

**PHYSICAL_CONFIRMATION_REQUIRED**
- ¿El total del día en pantalla coincide con la suma de los tickets en papel?
- ¿Alguna comanda se imprimió dos veces al reconectar?

**EXPECTED_DB_EFFECT**
- Órdenes creadas offline: +N, **N exacto**.
- `pos_cash_movements`: sin `client_op_id` repetido.
- `pos_save_operations`: sin `save_operation_id` repetido.
- Un `409` durante el drenado **no** es éxito por sí solo: sólo cuenta como
  idempotente si el contrato de ese endpoint lo define así. Un `409` desconocido
  no se marca sincronizado en silencio.

**EXPECTED_LOCAL_EFFECT** — la cola queda vacía. Ningún pendiente que se reintente para siempre.

**ABORT_CONDITION** — cualquier duplicado en las dos consultas de arriba · la cola no drena · un pendiente se marca sincronizado sin respuesta 2xx que lo respalde.

---

## 14. Al terminar

Reportar, por paso: `PASS` / `FAIL` / `NOT_OBSERVED` / `ABORT`, con el delta medido
y la confirmación física de Daniel textual.

Cerrar con:

```
FIELD_CERT_RESULT      =
TARGET_SHA             = 418933f4ac8bf74a177487bb5c0aef0a45735d7b
PASOS                  = x/9
NOT_OBSERVED           = (cuáles y por qué)
DEFECTOS               =
AMALAY_BASELINE_DELTA  =
```

Y volver a tomar la línea base de §1 para dejar constancia de qué movió la corrida.

`OCM_MIGRATION_UNBLOCKED` sigue en `false` hasta que este field cert salga `PASS`.
