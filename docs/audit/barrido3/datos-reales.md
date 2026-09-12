# Barrido 3 — Auditoría de datos reales (producción qjiomlvudfmzuvqvhwpk)

Fecha: 2026-09-11. Modo: sólo lectura (`execute_sql` con SELECT/EXPLAIN). Ninguna limpieza ejecutada.
Zona horaria de referencia: `America/Monterrey`; día de venta = hora local − 5 h (`clients.business_day_start_local = 05:00`).

## 1. Volumen y contexto por tenant

| client_id | órdenes | cerrada | cancelada | abiertas (no cerrada/cancelada) | rango created_at |
|---|---|---|---|---|---|
| amalay | 36 | 9 | 27 | 0 | 2026-07-27 → 2026-09-03 |
| boruca | 240 | 240 | 0 | 0 | 2026-07-22 → 2026-08-21 |
| carls-jr | 1 | 0 | 0 | 1 (enviada) | 2026-08-29 |
| chickin-demo | 16 | 16 | 0 | 0 | 2026-09-02 → 09-03 |
| coffee-shop | 627 | 627 | 0 | 0 | 2026-06-24 → 07-24 |
| demo | 1,287 | 1,285 | 0 | 2 (abierta) | 2026-05-25 → 09-11 |
| diezmex-demo | 5,015 | 5,013 | 1 | 1 (enviada) | 2026-05-31 → 09-04 |
| lab-resto | 4,838 | 4,833 | 0 | 5 | 2026-05-17 → 09-11 |
| scyf-demo | 110,790 | 110,788 | 0 | 2 (entregada, enviada) | 2026-08-02 → 09-02 |
| tekila-rg | 5,520 | 5,520 | 0 | 0 | 2026-07-16 → 08-29 |

Tamaños: `pos_orders` 107 MB / 128,370 filas; `pos_audit_log` 1,579 filas / 1,184 kB (2026-07-08 → 09-05); `pos_local_events` 0 filas / 40 kB (nunca se ha usado en prod).

Órdenes por día, últimos 30 días (hora local):

| client_id | días con ventas | órdenes | máx/día | días > 167 |
|---|---|---|---|---|
| amalay | 3 | 29 | 15 | 0 |
| boruca | 10 | 71 | 11 | 0 |
| demo | 4 | 84 | 45 | 0 |
| diezmex-demo | 18 | 892 | 68 | 0 |
| lab-resto | 30 | 3,146 | 238 | **11** |
| scyf-demo | 21 | 68,939 | **4,962** | **19** |
| tekila-rg | 17 | 2,094 | 158 | 0 |

## 2. Conteos de anomalías por tenant

| Chequeo | amalay | boruca | chickin-demo | coffee-shop | demo | diezmex-demo | lab-resto | scyf-demo | tekila-rg |
|---|---|---|---|---|---|---|---|---|---|
| Órdenes abiertas en turno ya cerrado (empalme) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **1** ($124.12) | 0 |
| Cerradas sin `pagos` (null/no-array/vacío) | 0 | 240 | 14 | 627 | 1,202 | 0 | 0 | 110,787 | 0 |
| Cerradas con Σpagos ≠ total | 0 | 0 | 0 | 0 | 69 (todas = total+propina) | 0 | 0 | 0 | 0 |
| `items` que NO es arreglo (jsonb string) | **1** | 0 | 0 | **627** | **1,202** | 0 | 0 | 0 | 0 |
| Órdenes con ids de item duplicados/nulos | 0 | 240 (id null) | 0 | — | 23 | 0 | 4,838 (id null) | 0 | 0 |
| `turno_id` que no existe en `pos_turnos` | 0 | **240** | 0 | 0 | **15** | 0 | **4,838** | 0 | 0 |
| Turnos abiertos simultáneos | 1 | 1 | 1 | 0 | 1 | 1 | 0 | 1 | 1 |
| Turnos cerrados sin `pos_cierres` (60 d) | **31** | 0 | 0 | 11 | 18 | 235 | 0 | 240 | 45 |
| Turnos con `closed_at < opened_at` | **11** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `pos_cierres` con turno inexistente | **1** | — | 0 | — | — | 0 | — | 0 | — |
| `pos_cierres.fecha` ≠ día de venta del `closed_at` | **5/8** | — | 1/3 | — | — | 0/1 | — | 0/2 | — |
| `status='cerrada'` con `closed_at` null | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **5,520** |
| `payment_status` null en cerradas | 9 | 240 | 16 | 627 | 1,285 | 5,013 | 4,833 | 110,788 | 5,520 |
| `pos_inventory.stock < 0` | **38** (mín −690 g) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `pos_recipe_lines` sin fila en `pos_inventory` | 0/708 | — | 0/759 | — | 0/75 | — | — | — | — |
| `pos_recipe_lines.recipe_unit` ≠ `stock_unit` | **103/708** | — | 0 | — | 0 | — | — | — | — |
| ‑ de ellas dimensionalmente incompatibles (kg↔lt/ml, lt↔kg/g) | **12** | — | — | — | — | — | — | — | — |
| `pos_recipes.ingredientes` (JSON legacy) sin fila de inventario | 791/791 | — | 762/762 | — | — | 30/30 | — | — | — |
| Movimientos market duplicados (order_id+item+tipo) | 11 grupos | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Movimientos inventario que apuntan a orden inexistente | **693/693** | — | — | — | — | — | — | — | — |
| Movimientos market que apuntan a orden inexistente | **112/129** | — | — | — | — | — | — | — | — |
| `pos_reconciliation_results` con orden inexistente | **505/586** | — | 4/6 | — | 0/221 | 0/3 | — | 0/4 | — |
| Deducciones de receta duplicadas (mismo recon_id + insumo) | **9** | — | — | — | — | — | — | — | — |
| `pos_orders` sin `client_id` / con `client_id` inexistente | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

`pos_reconciliation_results` por tipo:

| client_id | RECONCILED | BLOCKED_UNCLASSIFIED | NO_MUTATION_APPROVED |
|---|---|---|---|
| **`''` (vacío)** | 0 | **13** (2026-07-27) | 0 |
| amalay | 440 | **143** (92 órdenes, 42 ítems; todos > 7 días) | 3 |
| carls-jr | 0 | 0 | 1 |
| chickin-demo | 6 | 0 | 0 |
| demo | 220 | 1 | 0 |
| diezmex-demo | 0 | 0 | 3 |
| scyf-demo | 0 | 0 | 4 |

Índices (EXPLAIN ANALYZE sobre scyf-demo, el tenant más grande):
- `where client_id=$1 and turno_id=$2` → Index Scan `idx_pos_orders_turno (client_id, turno_id, order_number desc)`, 5.1 ms, 19 buffers. **OK**.
- `where client_id=$1 and created_at >= .. < ..` → Index Scan `idx_pos_orders_status (client_id, status, created_at desc)` con `status` saltado (skip-scan), 952 filas en 6.9 ms, 285 buffers. Funciona porque hay pocos valores de status; no hay índice `(client_id, created_at)` puro. **P2**, ver abajo.
- Existe `pos_orders_dia_venta_idx (client_id, dia_venta)` y el índice único de folio `pos_orders_folio_unico_por_dia` sólo desde `dia_venta >= 2026-09-02`.

## 3. Hallazgos

### [P0] Registros de inventario/reconciliación huérfanos: las órdenes de AMALAY se borraron y sus movimientos no
**Evidencia.** `pos_orders` tiene sólo 36 filas de `amalay` (la más antigua 2026-07-27), pero `pos_inventory_movements` tiene 693 filas con `order_id` que ya no existe (100 %), `pos_market_movements` 112/129 y `pos_reconciliation_results` 505/586. Los `deduction`/`recipe_deduction` de julio–agosto siguen restados del stock (`pos_inventory.stock` negativo en 38 insumos, mín −690 g de pepino, actualizado 2026-09-03).
```sql
select 'inventory' t, m.client_id, count(*) n, count(*) filter (where o.id is null) orden_inexistente
from pos_inventory_movements m left join pos_orders o on o.id=m.order_id::text where m.order_id is not null group by 1,2
union all select 'market', m.client_id, count(*), count(*) filter (where o.id is null)
from pos_market_movements m left join pos_orders o on o.id=m.order_id where m.order_id is not null group by 1,2
union all select 'recon', r.client_id, count(*), count(*) filter (where o.id is null)
from pos_reconciliation_results r left join pos_orders o on o.id=r.order_id group by 1,2;
```
**Defecto.** Alguien borra `pos_orders` (limpieza de pruebas en AMALAY) sin FK ni cascada hacia las tres tablas hijas: el stock queda descontado por ventas que "no existieron", y `pos_market_movements` conserva ventas con `order_id` como `6269155b-...-C4` (sufijo de cuenta dividida) que ya no se pueden auditar. Riesgo de dinero: el food-cost e inventario de AMALAY hoy están contaminados por datos borrados.
**Fix.** (a) Un procedimiento único de "reset de tenant" (`provisionTenant`/cleanup) que borre en orden `pos_reconciliation_results → pos_inventory_movements → pos_market_movements → pos_orders` y recalcule `pos_inventory.stock`; (b) FK `pos_inventory_movements.order_id → pos_orders(id)` con `ON DELETE RESTRICT` (nota: `order_id` es `uuid` en inventory y `text` en orders/market — otro defecto de tipo); (c) guardián CI que corra la consulta de arriba y falle si `orden_inexistente > 0`. Limpieza sugerida (no ejecutada): backup de las tres tablas, borrar filas huérfanas, y reconstruir `pos_inventory.stock` desde entradas/ajustes válidos + un conteo físico.

### [P0] Cierre de turnos por lote con `closed_at` constante: 33 turnos de AMALAY "cerrados" el 2026-09-01 02:07:00.918 sin `pos_cierres`, 11 con `closed_at < opened_at`
**Evidencia.**
```sql
select client_id, closed_at, count(*) from pos_turnos where closed_at is not null group by 1,2 having count(*)>2 order by 3 desc;
-- amalay | 2026-09-01 02:07:00.918+00 | 33
select count(*) from pos_turnos where closed_at < opened_at;  -- 11, todos amalay con ese timestamp
select t.id, t.opened_at, t.closed_at from pos_turnos t where t.client_id='amalay' and t.closed_at is not null
  and t.closed_at > now()-interval '60 days' and not exists (select 1 from pos_cierres c where c.turno_id=t.id);  -- 31
```
Turnos abiertos a las 02:09, 02:11, 02:22, 02:29, 02:32 UTC del 09-01 tienen `closed_at` 02:07 (antes de abrirse). `efectivo_sistema=0`, `diferencia=0` en todos. Además la migración pisó los `closed_at` de turnos que SÍ tenían cierre real: los cierres `cierre-mrn059e1` (2026-07-16), `cierre-ms2ht48s` (07-27), `00d11078…` (08-04) y `807a8964…` (08-31) apuntan a turnos cuyo `closed_at` es 2026-09-01, así que la fecha del cierre y el día de venta del turno difieren en semanas (5 de 8 cierres de AMALAY no coinciden).
**Defecto.** Una migración/script (probablemente la de "un turno abierto por restaurante", `pos-turnos-migration`) hizo `update pos_turnos set closed_at=now() where closed_at is null` sin `closed_at = greatest(now(), opened_at)`, sin crear `pos_cierres`, y volvió a correr sobre turnos abiertos después de su propio `now()` (carrera: se abrieron turnos mientras corría). Riesgo de dinero: 31 turnos sin corte; cualquier reporte "por turno" de AMALAY de julio–agosto sale con fecha 2026-08-31.
**Fix.** Constraint `check (closed_at is null or closed_at >= opened_at)`; el cierre masivo debe insertar un `pos_cierres` sintético (`notas='cierre administrativo'`, `folio_z`) y usar `closed_at = greatest(opened_at, ultima_orden.closed_at)`. Limpieza sugerida: para los 11 con `closed_at < opened_at`, poner `closed_at = opened_at`; para los 4 con cierre real, `closed_at = pos_cierres.created_at`.

### [P0] Doble descuento de inventario: la misma reconciliación descontó dos veces el mismo insumo (9 casos AMALAY, 2026-07-14 → 07-22)
```sql
select client_id, reconciliation_result_id, ingredient_id, count(*) n, sum(quantity) q, min(created_at), max(created_at)
from pos_inventory_movements where movement_type='recipe_deduction' group by 1,2,3 having count(*)>1;
-- recon 767: cebolla_cambray, sal_de_mesa, papa_de_galeana, mostaza_dijon x2 (02:02 y 02:31 UTC); recon 126: cafe_en_grano x2 (41 s de diferencia)
```
Más 111 grupos (`order_id`+`ingredient_id`) con reconciliaciones distintas (1,823 filas extra en amalay, 556 en demo) y el caso `6269155b…` con 6 deducciones tipo `deduction` (legacy, sin recon) por insumo entre 07-22 y 07-23 — la orden ya no existe (ver P0 anterior), así que no se puede verificar si eran 6 ítems reales.
**Defecto.** El índice único `pos_inventory_movement_operation_line (client_id, movement_operation_key, movement_operation_line)` sólo aplica `where movement_operation_key is not null`, y **el 100 % de las 1,948 `recipe_deduction` tienen `movement_operation_key = null`**: el candado de idempotencia existe pero nadie lo usa. Fechas de los duplicados coinciden con el rango pre-fix de la memoria "el-inventario-se-descuenta-una-vez" — confirmar que el fix escribe `movement_operation_key`; en prod no hay ni una fila que lo haga.
**Fix.** Que `r1_save_order`/el reconciliador escriba `movement_operation_key = reconciliation_result_id||':'||mutation_revision` y `movement_operation_line`; agregar índice único parcial `(reconciliation_result_id, ingredient_id, mutation_revision)`. Limpieza: revertir las 9 filas extra con un `recipe_reversal` ligado al mismo recon.

### [P1] `items` guardado como string JSON (doble serialización) — 1,830 órdenes en 3 tenants, incluida 1 de AMALAY
```sql
select client_id, jsonb_typeof(items), count(*) from pos_orders group by 1,2;  -- string: amalay 1, coffee-shop 627, demo 1202
select id, left(items::text,80) from pos_orders where client_id='amalay' and jsonb_typeof(items)='string';
```
La de AMALAY tiene ids/`silla`/`nombre` (formato actual, no seed): hay un camino de escritura vivo que hace `JSON.stringify(items)` antes de mandar a PostgREST. Cualquier `jsonb_array_elements(items)` (reportes, descuento de inventario, `ocm_menu_items`) omite estas órdenes en silencio o truena.
**Fix.** `check (jsonb_typeof(items)='array')` en `pos_orders` (NOT VALID hasta limpiar) y quitar la serialización en el cliente/SW (buscar `JSON.stringify(` sobre `items` en `pos-offline-db.ts`/`offline-sync.ts`). Limpieza: `update … set items = (items #>> '{}')::jsonb where jsonb_typeof(items)='string'`.

### [P1] 5,093 órdenes apuntan a `turno_id` inexistente (lab-resto 4,838, boruca 240, demo 15) pese al check `orders_require_turno`
```sql
select client_id, count(*) from pos_orders o where turno_id is not null and not exists (select 1 from pos_turnos t where t.id=o.turno_id) group by 1;
```
El check sólo exige `not null`; no hay FK. El generador de lab-resto y el seed de boruca inventan `turno_id`. Consecuencia: `pos_cierres` nunca podrá cuadrar esos tenants y el corte por turno devuelve vacío. Igualmente `pos_orders.items[].id` es `null` en las 4,838 de lab-resto y las 240 de boruca — el descuento de inventario R1 los salta como `SKIPPED` silencioso (memoria `project_descuento_inventario_r1`).
**Fix.** FK `pos_orders(turno_id) → pos_turnos(id)` (NOT VALID + validar por tenant); el lab/seed debe abrir turno real. Demo (15) sí es sospechoso de camino real: revisar.

### [P1] 143 `BLOCKED_UNCLASSIFIED` acumulados en AMALAY (42 ítems, el más reciente 2026-09-03) y 13 con `client_id = ''`
```sql
select r.menu_item_id, count(*), max(r.created_at)::date, p.inventory_mode from pos_reconciliation_results r
 left join pos_item_inventory_policy p using (client_id, menu_item_id)
 where r.client_id='amalay' and r.result='BLOCKED_UNCLASSIFIED' group by 1,4 order by 2 desc;
select count(*) from pos_reconciliation_results where client_id='';  -- 13 (2026-07-27)
```
Ninguno se ha reprocesado (todos > 7 días); `ws-pc007` lleva 26 bloqueos hasta el 09-03. Cada bloqueo = venta sin descuento de inventario. Las 13 filas con `client_id=''` pasaron porque la tabla no tiene el check `client_id_no_vacio` que sí tienen `pos_orders/turnos/cierres`, y `pos_audit_log` tiene 1 fila igual.
**Fix.** Pantalla/alerta de "ítems sin clasificar" con los 42; job que re-reconcilie al clasificar; agregar `check (coalesce(client_id,'')<>'')` a `pos_reconciliation_results`, `pos_inventory_movements`, `pos_market_movements`, `pos_audit_log`.

### [P1] Unidades receta↔stock incompatibles: 103 líneas AMALAY con unidad distinta, 12 de ellas sin conversión posible (kg→lt/ml, lt→kg/g)
```sql
select lower(rl.recipe_unit) ru, lower(inv.stock_unit) su, count(*) from pos_recipe_lines rl
 join pos_inventory inv on inv.ingredient_id=rl.ingredient_id and inv.client_id=rl.client_id
 where lower(rl.recipe_unit)<>lower(inv.stock_unit) group by 1,2 order by 3 desc;
-- g→kg 52, ml→lt 28, kg→lt 7, lt→ml 6, kg→g 5, kg→ml 3, lt→kg 2
```
`pos_unit_conversions` sólo tiene KG↔GR, LT↔ML, GL, OZ — y usa `GR` mientras las líneas usan `g`. kg→lt (7), kg→ml (3), lt→kg (2) no tienen factor: el reconciliador o descuenta 1:1 (explica stocks −690 g de pepino) o bloquea. Ítems afectados: `cr1, pz3, ws-actama27042601, ws-boh023, ws-fra22042501, ws-ma0075, ws-mar436, ws-mun001, ws-pzz002, ws-pzz004, ws-sou004`.
**Fix.** Validar en el editor de recetas que `recipe_unit` sea convertible a `stock_unit` (misma dimensión); normalizar `GR`→`g`; test que recorra `pos_recipe_lines` y falle si no hay factor.

### [P1] Cierre con `turno_id` inexistente y `diferencia` −1,145 (AMALAY, 2026-07-09)
```sql
select c.id, c.turno_id, c.diferencia from pos_cierres c left join pos_turnos t on t.id=c.turno_id where t.id is null;  -- cierre-mrdxruk5 → mqv6rejzvq0u
```
El turno se borró (o nunca subió) y el cierre quedó. Sin FK `pos_cierres.turno_id → pos_turnos`. Es histórico (julio) pero demuestra que el aviso de cierre puede sobrevivir a su turno.
**Fix.** FK con `ON DELETE RESTRICT`; limpieza: marcar `notas='turno huérfano'` o borrar tras respaldo.

### [P2] tekila-rg: 5,520 órdenes `cerrada` con `closed_at` null
```sql
select count(*) from pos_orders where status='cerrada' and closed_at is null;  -- 5520, todas tekila-rg
```
Cualquier reporte "por hora de cierre" o el cálculo de tiempo de mesa las excluye. Seed defectuoso, pero conviene `check (status<>'cerrada' or closed_at is not null)` NOT VALID.

### [P2] `pagos` ausente en 113,000+ órdenes cerradas y `payment_status` null en el 100 %
Seeds (scyf-demo, coffee-shop, demo, boruca) cierran sin `pagos`; `payment_status` es null en todas las órdenes de prod, incluidas las 9 reales de AMALAY. Si el corte de caja o `skimming_iva` suman `pagos`, esos tenants dan $0 de efectivo con ventas > 0 (patrón "verde en vacío"). Las 69 de demo con Σpagos ≠ total están todas explicadas por `propina` (Σpagos = total + propina): el contrato "pagos incluye propina" debe quedar documentado y el reporte restarla.
**Fix.** Decidir si `payment_status` se rellena (trigger al cerrar) o se elimina; seeds deben generar `pagos`.

### [P2] Volumen supera el tope de 5,000 del dashboard
scyf-demo: 19 de 21 días > 167 órdenes (máx 4,962/día); lab-resto: 11 de 30. Con el `.range(0,4999)` actual el dashboard de esos tenants lee las 5,000 más viejas del rango. Confirmado el patrón de la memoria `project_dashboard_trunca_5000`, ahora con dos tenants en prod.
**Fix.** Paginar o agregar en SQL (`ocm_daily`) en vez de traer filas.

### [P2] Índice por rango de fecha depende de skip-scan
`select * from pos_orders where client_id=$1 and created_at between …` usa `idx_pos_orders_status (client_id, status, created_at)` saltando `status` (952 filas, 285 buffers). Funciona hoy con 5 valores de status; agregar `create index concurrently on pos_orders (client_id, created_at desc)` o consultar por `dia_venta` que ya tiene índice.

### [P2] Turnos "zombi" abiertos
`test_noreste_grill` con turno abierto desde 2026-07-21 (tenant no existe en `clients`); `carls-jr` abierto desde 08-29 con 1 orden `enviada`; scyf-demo 1 orden `entregada` de $124.12 en turno cerrado el 09-02. Ninguno es dinero real, pero muestran que el cierre de turno no bloquea/arrastra órdenes vivas cuando `cierre_con_ordenes_abiertas` no se marca.

## 4. Lo que salió limpio
- 0 `pos_orders` sin `client_id` o con `client_id` fuera de `clients`.
- 0 turnos abiertos duplicados por tenant (máximo 1 abierto en los 9 tenants con turno).
- 0 órdenes reales (amalay, diezmex, chickin, tekila, lab) con Σpagos ≠ total.
- `pos_recipe_lines` (v2) tienen fila de inventario en los 3 tenants; el JSON legacy `pos_recipes.ingredientes` no enlaza por id (usa `nombre`), por eso 100 % "sin fila" — es la tabla vieja, no un defecto nuevo.
- Índice de corte por turno correcto (5 ms).
