-- ─────────────────────────────────────────────────────────────────────────────
-- OCM · AUTORIDAD DE FUENTE POR INQUILINO Y FECHA
--
-- EL DEFECTO QUE CIERRA
-- ---------------------
-- `ocm_daily` une dos fuentes y desempata así (definición vigente, última cláusula):
--
--     FROM hist h
--     WHERE NOT EXISTS (SELECT 1 FROM live l
--                       WHERE l.client_id = h.client_id AND l.fecha = h.fecha)
--
-- O sea: `live` (pos_orders) SIEMPRE gana, y `hist` (ops_daily) sólo rellena huecos.
-- Para un inquilino que todavía opera en su sistema anterior y sólo tiene órdenes de
-- prueba en el POS, esa precedencia es exactamente al revés de lo correcto.
--
-- Medido contra producción en sólo lectura el 2026-09-18:
--
--   fecha        ocm_daily publicó   ops_daily/wansoft_daily decían   órdenes POS
--   2026-08-30   $682       (1 tkt)  $125,724  (143 tkts)             15 (1 cerrada)
--   2026-08-31   $1,756     (3 tkt)  $56,787   (75 tkts)              9  (3 cerradas)
--   2026-09-02   $3,519     (5 tkt)  $53,716   (84 tkts)              5  (5 cerradas)
--   2026-09-13   $151       (1 tkt)  — sin fila en ninguna fuente —   3  (1 cerrada)
--
-- Total mal publicado: $5,958 donde la fuente autoritativa decía $236,227.
-- `wansoft_daily` y `ops_daily` COINCIDEN EXACTO en los tres días con dato, y también
-- en los 972 días normales ($79,138,465 en ambas). Ninguna fuente está dañada:
--
--     RAW_SOURCE_CORRUPTION       = false
--     OCM_PUBLISHED_VALUE_INVALID = true
--
-- El defecto está en la vista, no en los datos que la alimentan.
--
-- POR QUÉ NO SE INVIERTE LA PRECEDENCIA Y YA
-- ------------------------------------------
-- Porque después del cutover la precedencia correcta es la contraria. Una constante no
-- puede contestar una pregunta que cambia con el tiempo. La autoridad se resuelve POR LA
-- FECHA DEL DATO, de modo que voltear el cutover mañana no reinterprete los 976 días de
-- ayer.
--
-- POR QUÉ UNA TABLA CON VIGENCIA Y NO UNA COLUMNA EN `clients`
-- -----------------------------------------------------------
-- `clients.data_source` ya existe y ya se usa como señal de autoridad
-- (`api/pos/recipe-sync/route.ts`: `isLegacy = data_source !== 'fullsite'`). Tiene la
-- semántica correcta y le falta lo único que importa aquí: FECHA. Es un flag de estado
-- presente; voltearlo el día del cutover reinterpreta toda la historia hacia atrás.
-- `pos_mutation_authority` sí tiene `cutover_at`, pero su `sale_authority` ('r1'/'legacy')
-- gobierna qué ruta descuenta inventario, no qué sistema reporta la venta: AMALAY tiene
-- cutover en julio ahí y sigue operando en Wansoft.
--
-- ALCANCE: POR INQUILINO, NO POR SUCURSAL
-- ---------------------------------------
-- Decidido con evidencia, no por omisión (ver docs/architecture/OCM-SOURCE-AUTHORITY.md):
--   · De 25 filas en client_locations, 21 son de tres demos sembrados en un solo día.
--     El único cliente real, AMALAY, tiene una sucursal.
--   · De 949 órdenes creadas desde el 2026-09-02, CERO traen location_id. El 96.6%
--     histórico venía de un DEFAULT de columna que se eliminó ese día.
--   · `pos_turnos`, `pos_cierres`, `ops_daily` y `ocm_daily` no tienen columna de sucursal.
--     `save-order/route.ts` documenta el incidente del 2026-08-31 por pedir un
--     `location_id` que no existe en `pos_turnos`.
--   · `wansoft_daily.location_id` está poblado al 100% con UN valor distinto en 975 filas.
-- Ampliar después cuesta un ALTER TABLE sobre una tabla chica. Nacer con una columna que
-- nadie puede llenar obliga a inventar una regla de precedencia — que es el defecto que
-- este archivo viene a cerrar.
--
-- ⚠️ REGLA QUE ESTE ARCHIVO NO PUEDE ROMPER
-- ------------------------------------------
-- `CREATE OR REPLACE VIEW` REEMPLAZA los reloptions: lo que no se vuelve a declarar en el
-- WITH se pierde sin aviso. Así se perdió `security_invoker` el 2026-09-09 y la vista
-- volvió a correr como `postgres` (rolbypassrls = true), exponiendo los 9 restaurantes a
-- cualquier `authenticated`. Ver 20260915040000_ocm_daily_security_invoker.sql.
-- Por eso abajo se declaran EXPLÍCITAMENTE `security_invoker = on` y `NOT MATERIALIZED`,
-- y se repite el REVOKE a `anon`. El guardián que lo comprueba es
-- scripts/tenant-isolation/ti07_ocm_daily.mjs y el bloque de verificación del final.
--
-- ROLLBACK
--   Restaurar la definición previa de la vista desde
--   20260915040000_ocm_daily_security_invoker.sql + el baseline, y:
--     drop view if exists public.ocm_source_divergence;
--     drop view if exists public.ocm_source_mismatch;
--     drop table if exists public.tenant_source_authority;
--   La tabla es aditiva: mientras nadie la lea, borrarla no afecta a nadie.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1 · Extensión requerida por la restricción de exclusión ──────────────────
-- btree_gist permite mezclar `=` sobre text con `&&` sobre rango en un EXCLUDE.
create extension if not exists btree_gist;

-- ── 2 · La tabla ─────────────────────────────────────────────────────────────
create table if not exists public.tenant_source_authority (
  id                   uuid        primary key default gen_random_uuid(),
  client_id            text        not null references public.clients(id),
  authoritative_source text        not null,
  mode                 text        not null,
  effective_from       timestamptz not null,
  effective_to         timestamptz null,
  reason               text        not null,
  changed_by           text        not null,
  created_at           timestamptz not null default now(),

  constraint tsa_source_valida
    check (authoritative_source in ('wansoft','fullsite')),

  constraint tsa_modo_valido
    check (mode in ('legacy','shadow','parallel','cutover','fullsite','rollback')),

  -- El modo describe la situación operativa; la fuente es lo que la vista necesita.
  -- Esta restricción impide que se separen: un `shadow` con autoridad `fullsite`
  -- sería precisamente el defecto que venimos a cerrar, escrito a mano.
  constraint tsa_modo_coherente_con_fuente check (
       (mode in ('legacy','shadow','parallel','rollback') and authoritative_source = 'wansoft')
    or (mode in ('cutover','fullsite')                    and authoritative_source = 'fullsite')
  ),

  constraint tsa_rango_valido
    check (effective_to is null or effective_to > effective_from),

  -- La razón es el único registro de por qué cambió una autoridad. Vacía, el
  -- historial se vuelve una bitácora de fechas.
  constraint tsa_razon_no_vacia
    check (length(btrim(reason)) >= 10),

  -- LA restricción que importa: dos vigencias traslapadas vuelven ambigua la
  -- autoridad de una fecha, y una vista no puede resolver una ambigüedad — elegiría
  -- una en silencio. Ese es el modo de falla que produjo este incidente.
  constraint tsa_sin_traslape exclude using gist (
    client_id with =,
    tstzrange(effective_from, coalesce(effective_to, 'infinity'::timestamptz), '[)') with &&
  )
);

comment on table public.tenant_source_authority is
  'Qué sistema es autoritativo para reportar la operación de un inquilino, con vigencia. '
  'La autoridad se resuelve POR LA FECHA DEL DATO, nunca por el estado de hoy.';

-- Red de seguridad barata sobre la exclusión: a lo más una fila vigente por inquilino.
create unique index if not exists tsa_una_vigente_por_tenant
  on public.tenant_source_authority (client_id)
  where effective_to is null;

create index if not exists tsa_lookup
  on public.tenant_source_authority (client_id, effective_from desc);

-- ── 3 · Permisos ─────────────────────────────────────────────────────────────
-- Misma postura que `pos_save_operations`: RLS encendida y sin políticas = nadie
-- entra salvo `service_role`, que bypassa RLS. No se expone por el proxy REST.
alter table public.tenant_source_authority enable row level security;
revoke all on public.tenant_source_authority from public, anon, authenticated;
grant select on public.tenant_source_authority to service_role;

-- Pero la vista corre con `security_invoker = on`, o sea con los privilegios de
-- quien pregunta. Para que un usuario `authenticated` pueda resolver su propia
-- autoridad necesita SELECT sobre esta tabla; el aislamiento lo da la política de
-- abajo, anclada en el mismo `private.user_has_client_access` que usan las tablas base.
grant select on public.tenant_source_authority to authenticated;

drop policy if exists tsa_lectura_por_tenant on public.tenant_source_authority;
create policy tsa_lectura_por_tenant
  on public.tenant_source_authority
  for select
  to authenticated
  using (private.user_has_client_access(client_id));

-- ── 4 · Siembra ──────────────────────────────────────────────────────────────
-- AMALAY en `shadow`: el POS escribe (43 órdenes de prueba) y lo que se reporta es
-- Wansoft. Es su estado real hoy, y sembrarlo retroactivo al inicio de la serie es
-- lo que corrige los cuatro días SIN TOCAR UN SOLO DATO DE NEGOCIO.
insert into public.tenant_source_authority
  (client_id, authoritative_source, mode, effective_from, reason, changed_by)
select 'amalay', 'wansoft', 'shadow', timestamptz '2024-01-01 00:00:00-06',
       'Estado real al 2026-09-18: el POS escribe en pruebas y la operacion se reporta desde Wansoft. Retroactivo al inicio de la serie para no reinterpretar historia.',
       'migracion_20260918210000'
where not exists (select 1 from public.tenant_source_authority where client_id = 'amalay');

-- El resto de los inquilinos activos son nativos de Fullsite: ninguno tiene filas
-- de cierre marcadas `wansoft` en ops_daily (verificado en prod: sólo amalay las tiene;
-- lab-resto tiene 365 filas de cierre, todas marcadas `fullsite`).
-- Sin esta siembra, la regla de "sin autoridad declarada -> hueco" los apagaría a todos.
insert into public.tenant_source_authority
  (client_id, authoritative_source, mode, effective_from, reason, changed_by)
select c.id, 'fullsite', 'fullsite', timestamptz '2020-01-01 00:00:00-06',
       'Inquilino nativo de Fullsite: no tiene cierres marcados wansoft en ops_daily. Sembrado con la migracion de autoridad de fuente.',
       'migracion_20260918210000'
from public.clients c
where c.id <> 'amalay'
  and not exists (select 1 from public.tenant_source_authority t where t.client_id = c.id);

-- ── 5 · La vista ─────────────────────────────────────────────────────────────
-- `security_invoker` y `NOT MATERIALIZED` van declarados A PROPÓSITO: un
-- CREATE OR REPLACE los borra si no se repiten. No quitar.
create or replace view public.ocm_daily
with (security_invoker = on) as

with live as not materialized (
  select
    o.client_id,
    ((o.created_at at time zone 'America/Monterrey'))::date as fecha,
    'fullsite'::text as source_system,
    sum(o.total)                                                             as ventas_dia,
    sum(coalesce(o.subtotal,0::numeric) + coalesce(o.iva,0::numeric))        as ventas_brutas,
    sum(coalesce(o.descuento,0::numeric))                                    as descuentos,
    sum(case when o.metodo_pago ilike '%efec%' and o.metodo_pago not ilike '%tarj%'
             then o.total else 0::numeric end)                               as efectivo,
    sum(case when o.metodo_pago ilike '%tarj%' and o.metodo_pago not ilike '%efec%'
             then o.total else 0::numeric end)                               as tarjeta,
    (count(*))::integer                                                      as tickets_count,
    (count(distinct o.mesa))::integer                                        as mesas_atendidas,
    (sum(coalesce(o.personas,0)))::integer                                   as personas_restaurant,
    round(sum(o.total) / (nullif(count(*),0))::numeric, 2)                   as ticket_promedio_restaurant,
    sum(coalesce(o.propina,0::numeric))                                      as propinas_total,
    max(o.updated_at)                                                        as generated_at
  from public.pos_orders o
  where o.status = any (array['cerrada'::text,'completada'::text])
  group by o.client_id, (((o.created_at at time zone 'America/Monterrey'))::date)
),

hist as not materialized (
  select distinct on (d.client_id, d.fecha)
    d.client_id,
    d.fecha,
    coalesce(d.source_system,'wansoft'::text) as source_system,
    d.ventas_dia, d.ventas_brutas, d.descuentos, d.efectivo, d.tarjeta,
    d.tickets_count, d.mesas_atendidas, d.personas_restaurant,
    d.ticket_promedio_restaurant, d.propinas_total, d.generated_at
  from public.ops_daily d
  where d.record_type = any (array['cierre'::text,'cierre_wansoft'::text])
  order by d.client_id, d.fecha, d.generated_at desc
),

-- Universo de días: todo (inquilino, fecha) que exista en CUALQUIER alimentador.
-- No es un calendario completo a propósito: un día que ninguna fuente conoce no es
-- un hueco de la fuente autoritativa, es un día del que nadie dijo nada.
universo as not materialized (
  select client_id, fecha from live
  union
  select client_id, fecha from hist
),

-- Un candidato por alimentador, cada uno con el sistema que lo originó.
-- `prioridad` desempata DENTRO del mismo sistema (live antes que hist), que es el
-- comportamiento de hoy. NUNCA desempata ENTRE sistemas: eso lo decide la autoridad.
candidatos as not materialized (
  select l.*, 1 as prioridad from live l
  union all
  select h.*, 2 as prioridad from hist h
)

select
  u.client_id,
  u.fecha,
  -- La fuente publicada es la autoritativa, exista o no el dato. Así un consumidor
  -- sabe a quién reclamarle el hueco.
  a.authoritative_source as source_system,
  c.ventas_dia,
  c.ventas_brutas,
  c.descuentos,
  c.efectivo,
  c.tarjeta,
  c.tickets_count,
  c.mesas_atendidas,
  c.personas_restaurant,
  c.ticket_promedio_restaurant,
  c.propinas_total,
  c.generated_at,
  -- Explícito, no inferido. Un consumidor que recibe NULL sin motivo acaba
  -- inventando su propio respaldo, y el problema reaparece un nivel más arriba.
  case
    when a.authoritative_source is null then 'SIN_AUTORIDAD'
    when c.client_id          is null then 'SIN_DATO_EN_FUENTE_AUTORITATIVA'
    else 'OK'
  end as data_status,
  a.mode as authority_mode
from universo u
left join lateral (
  select t.authoritative_source, t.mode
  from public.tenant_source_authority t
  where t.client_id = u.client_id
    and t.effective_from <= (u.fecha::timestamp at time zone 'America/Monterrey')
    and (t.effective_to is null
         or t.effective_to > (u.fecha::timestamp at time zone 'America/Monterrey'))
  limit 1                -- la exclusión garantiza a lo más una; esto es defensa, no lógica
) a on true
left join lateral (
  select x.*
  from candidatos x
  where x.client_id = u.client_id
    and x.fecha     = u.fecha
    and x.source_system = a.authoritative_source   -- ← SÓLO la fuente autoritativa
  order by x.prioridad
  limit 1
) c on true;

comment on view public.ocm_daily is
  'Modelo canónico diario. Lee UNA sola fuente por inquilino y fecha, la que '
  'tenant_source_authority declara autoritativa para esa fecha. Nunca cae a la otra '
  'fuente: la ausencia se publica como hueco con data_status.';

-- Los ACL no viajan en los reloptions, pero el REVOKE se repite para que este archivo
-- deje la vista correcta por sí solo, aunque se aplique sobre una base sin el lote de 08-26.
revoke select on public.ocm_daily from anon;

-- ── 6 · G1 · La fuente publicada no es la autoritativa ───────────────────────
-- Condición de una línea, sin umbrales. Habría disparado el 2026-09-03, el día en que
-- se publicó el primer valor malo, en vez de aparecer quince días después.
create or replace view public.ocm_source_mismatch
with (security_invoker = on) as
select
  u.client_id,
  u.fecha,
  a.authoritative_source,
  a.mode,
  x.source_system as fuente_con_dato,
  x.ventas_dia    as ventas_de_la_fuente_no_autoritativa
from (
  select client_id, fecha from public.ocm_daily
) u
join lateral (
  select t.authoritative_source, t.mode
  from public.tenant_source_authority t
  where t.client_id = u.client_id
    and t.effective_from <= (u.fecha::timestamp at time zone 'America/Monterrey')
    and (t.effective_to is null
         or t.effective_to > (u.fecha::timestamp at time zone 'America/Monterrey'))
  limit 1
) a on true
join lateral (
  select d.source_system, d.ventas_dia
  from public.ops_daily d
  where d.client_id = u.client_id and d.fecha = u.fecha
    and d.record_type = any (array['cierre'::text,'cierre_wansoft'::text])
    and coalesce(d.source_system,'wansoft') <> a.authoritative_source
  limit 1
) x on true;

comment on view public.ocm_source_mismatch is
  'G1 — dias donde existe dato de una fuente que NO es la autoritativa. Severidad ALTA: '
  'indica que el inquilino esta operando en un sistema distinto al declarado.';

-- ── 7 · G2 · Las dos fuentes existen y no se parecen ─────────────────────────
-- No es un detector de errores: es el instrumento del cutover. Durante `parallel`,
-- la serie de `delta_pct` es la evidencia de que el POS ya reproduce la realidad.
create or replace view public.ocm_source_divergence
with (security_invoker = on) as
select
  l.client_id,
  l.fecha,
  l.ventas_dia  as ventas_fullsite,
  h.ventas_dia  as ventas_wansoft,
  round(abs(l.ventas_dia - h.ventas_dia) / nullif(greatest(abs(h.ventas_dia),1),0) * 100, 2) as delta_pct,
  case
    when abs(l.ventas_dia - h.ventas_dia) / nullif(greatest(abs(h.ventas_dia),1),0) > 0.25 then 'ALTA'
    when abs(l.ventas_dia - h.ventas_dia) / nullif(greatest(abs(h.ventas_dia),1),0) > 0.05 then 'MEDIA'
    else 'OK'
  end as severidad
from (
  select o.client_id,
         ((o.created_at at time zone 'America/Monterrey'))::date as fecha,
         sum(o.total) as ventas_dia
  from public.pos_orders o
  where o.status = any (array['cerrada'::text,'completada'::text])
  group by 1,2
) l
join (
  select distinct on (d.client_id, d.fecha) d.client_id, d.fecha, d.ventas_dia
  from public.ops_daily d
  where d.record_type = any (array['cierre'::text,'cierre_wansoft'::text])
    and coalesce(d.source_system,'wansoft') = 'wansoft'
  order by d.client_id, d.fecha, d.generated_at desc
) h on h.client_id = l.client_id and h.fecha = l.fecha;

comment on view public.ocm_source_divergence is
  'G2 — dias con dato en AMBAS fuentes y su diferencia. Durante `parallel` es la '
  'evidencia que justifica el cutover con datos en vez de con una corazonada.';

revoke select on public.ocm_source_mismatch    from anon;
revoke select on public.ocm_source_divergence  from anon;

commit;

-- ── Verificación (sólo lectura, esperado en cada bloque) ─────────────────────

-- V1 · El candado de la vista NO se perdió. Esperado: security_invoker = 'on'
--      y anon_puede_leer = false. Es la comprobación que faltó el 2026-09-09.
select c.relname,
       coalesce((select option_value from pg_options_to_table(c.reloptions)
                 where option_name = 'security_invoker'), 'SIN SETEAR') as security_invoker,
       has_table_privilege('anon', c.oid, 'SELECT')                     as anon_puede_leer
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
where c.relname in ('ocm_daily','ocm_source_mismatch','ocm_source_divergence');

-- V2 · Los cuatro días de AMALAY. Esperado: 2026-08-30 = 125724, 08-31 = 56787,
--      09-02 = 53716 (todos data_status OK, source_system wansoft)
--      y 2026-09-13 con ventas_dia NULL y data_status SIN_DATO_EN_FUENTE_AUTORITATIVA.
select fecha, source_system, ventas_dia, tickets_count, data_status, authority_mode
from public.ocm_daily
where client_id = 'amalay'
  and fecha in (date '2026-08-30', date '2026-08-31', date '2026-09-02', date '2026-09-13')
order by fecha;

-- V3 · Totales de AMALAY. Esperado: 976 filas, 975 con dato, 1 hueco,
--      suma = 79,374,692 (antes 79,144,574; delta +230,269).
select count(*)                                              as dias,
       count(*) filter (where data_status = 'OK')            as con_dato,
       count(*) filter (where data_status <> 'OK')           as huecos,
       round(sum(ventas_dia))                                as venta_total
from public.ocm_daily where client_id = 'amalay';

-- V4 · Nadie más cambió. Esperado: cero filas.
--      (lab-resto conserva sus 365 cierres marcados `fullsite`.)
select client_id, count(*) filter (where data_status <> 'OK') as huecos_inesperados
from public.ocm_daily
where client_id <> 'amalay'
group by client_id
having count(*) filter (where data_status <> 'OK') > 0;

-- V5 · G1. Esperado hoy: los días en que el POS de AMALAY escribió mientras Wansoft
--      era la autoridad. Son la alerta que debió sonar el 2026-09-03.
select client_id, count(*) as dias_con_fuente_no_autoritativa
from public.ocm_source_mismatch group by client_id order by 2 desc;
</content>
