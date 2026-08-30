# pos_terminals — endurecimiento de location_id (migración posterior, NO incluida)

La migración `20260827120000_pos_terminals_por_sucursal.sql` deja `location_id` **nullable**
a propósito: las filas legacy (enroladas antes de este cambio) no tienen sucursal y no se
pueden inventar. Este documento define cómo cerrar esa transición **después** del backfill.

No se agrega `NOT NULL` ni `CHECK NOT VALID` todavía porque forzaría un valor sobre filas que
no lo tienen, o dejaría un constraint que la primera inserción legacy volvería a violar.

## 1. Reporte de filas legacy — correr tras aplicar la migración base

```sql
-- Cuántas terminales quedaron sin sucursal, y de qué tenants.
select
  count(*)                                          as total_terminales,
  count(*) filter (where location_id is null)       as sin_location_id,
  count(distinct client_id) filter (where location_id is null) as tenants_afectados
from public.pos_terminals;

-- Detalle por tenant, para decidir el backfill sucursal por sucursal.
select client_id, count(*) as terminales_sin_sucursal
from public.pos_terminals
where location_id is null
group by client_id
order by 2 desc;
```

> Medido en staging (`jkcnxfbbuyyfhwfjizgw`) el 2026-08-27, **antes** de aplicar la migración:
> `pos_terminals` tiene **0 filas**. Es decir, en staging no hay deuda legacy que backfillear.
> En prod el conteo puede diferir — correr el reporte ahí antes de endurecer.

## 2. Backfill (por tenant, con criterio humano)

No hay una "sucursal principal" marcada en `client_locations`, así que el backfill **no puede
ser automático** para tenants con más de una sucursal (Diezmex tiene 5). Procedimiento:

- Tenant con **una sola** sucursal activa → asignar esa.
- Tenant con **varias** → decidir a mano a qué sucursal pertenece cada terminal (por su
  `label`/uso real); no adivinar.

```sql
-- Ejemplo para un tenant de UNA sola sucursal (idempotente: sólo toca las NULL):
update public.pos_terminals t
set location_id = l.id
from public.client_locations l
where t.client_id = l.client_id
  and t.location_id is null
  and l.active
  and (select count(*) from public.client_locations x where x.client_id = t.client_id and x.active) = 1;
```

## 3. Endurecer (sólo cuando el reporte del paso 1 dé 0 sin sucursal)

```sql
-- Validar que no queden legacy y recién entonces exigirlo.
alter table public.pos_terminals
  alter column location_id set not null;
```

El FK compuesto `pos_terminals_client_location_fkey` ya garantiza que, cuando `location_id`
está puesto, pertenece al mismo tenant. Este paso sólo elimina la posibilidad de dejarlo en
blanco.

## 4. Rollback del endurecimiento

```sql
alter table public.pos_terminals
  alter column location_id drop not null;
```
