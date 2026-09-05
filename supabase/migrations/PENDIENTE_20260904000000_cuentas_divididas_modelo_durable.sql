-- ============================================================================
-- CUENTAS DIVIDIDAS — modelo durable de orden madre, cuenta y pago
--
-- ⚠️  ESTA MIGRACION NO SE HA EJECUTADO Y NO DEBE EJECUTARSE TODAVIA.
--     El prefijo `PENDIENTE_` la mantiene fuera del orden de aplicacion. Para
--     aplicarla hay que renombrarla a `20260904000000_...sql` — un acto
--     deliberado, no un descuido.
--
-- ── POR QUE HACE FALTA ──────────────────────────────────────────────────────
--
-- Campo, 2026-09-02 (Eduardo Esquivel, AMALAY): «siguen apareciendo platillos en
-- ordenes que estan ya cerradas». En cuenta dividida el aviso a cocina salia con
-- el id del COBRO y cocina guarda el de la MADRE: no coincidian.
--
-- La regla correcta ya existe y esta probada (dashboard-app/src/lib/
-- liquidacion-de-orden.ts, 32 pruebas): cerrar cocina UNA vez, con el id de la
-- madre, cuando TODAS las cuentas esten liquidadas.
--
-- Lo que NO existe es donde vive ese estado. Hoy:
--   · `pos_orders` no tiene `parent_order_id` ni `account_id`  (verificado)
--   · no hay tabla de pagos — `pagos` es un jsonb dentro de cada orden, y
--     `pos_payment_methods` es un CATALOGO de formas de pago, no pagos
--   · la unica representacion durable de una cuenta es el sufijo `-C{n}` DENTRO
--     del id de la orden
--
-- Ese sufijo NO es un contrato: es una cadena que alguien concatena en el POS
-- (page.tsx:3465). Derivar de ahi seria una heuristica sobre ids, y por eso no
-- se hace. Esta migracion crea el modelo explicito.
--
-- Medido antes de disenarla: 0 filas con sufijo `-C` en 10,038 ordenes de tres
-- tenants. El flujo de cuenta dividida NUNCA se ha usado en produccion. Eso baja
-- el riesgo del backfill casi a cero — y no se toma como permiso para omitirlo.
--
-- ── PRINCIPIOS ──────────────────────────────────────────────────────────────
--
-- ADITIVA. No borra, no renombra, no cambia el tipo de nada. Toda orden
-- existente sigue siendo valida sin tocarla: sin split, `parent_order_id` es
-- NULL y se comporta igual que hoy.
--
-- COMPATIBLE HACIA ATRAS. Una version vieja del POS, que ignora estas columnas,
-- sigue funcionando: nada es NOT NULL sin default, y ningun trigger existente
-- cambia de comportamiento.
-- ============================================================================


-- ── 1. La orden madre ───────────────────────────────────────────────────────
-- NULL = esta orden ES una madre (o no participa en ningun split). No se usa un
-- centinela: NULL significa "no aplica", que es exactamente el caso.
alter table public.pos_orders
  add column if not exists parent_order_id text;

comment on column public.pos_orders.parent_order_id is
  'Orden madre de una cuenta dividida. NULL = esta orden es la madre. Sustituye al sufijo -C{n} en el id, que nunca fue un contrato.';

-- Se declara NOT VALID a proposito: valida lo nuevo sin bloquear la tabla
-- revisando 129k filas historicas. Se puede VALIDATE despues, en frio.
alter table public.pos_orders
  add constraint pos_orders_parent_no_es_si_misma
  check (parent_order_id is null or parent_order_id <> id) not valid;


-- ── 2. Las cuentas de un split ──────────────────────────────────────────────
-- Se conocen DESDE que el split se define, no conforme se cobran. Es la
-- diferencia entre «faltan 2 cuentas» y «no se cuantas faltan» — y sin ella no
-- se puede decidir cuando cerrar cocina.
create table if not exists public.pos_order_accounts (
  account_id      text primary key,
  order_id        text not null,
  client_id       text not null,
  -- 1..n como la ve el mesero. Sin split se crea una sola fila con numero 1.
  numero          integer not null,
  total           numeric(12,2) not null,
  created_at      timestamptz not null default now(),
  constraint pos_order_accounts_numero_positivo check (numero >= 1),
  constraint pos_order_accounts_total_no_negativo check (total >= 0),
  -- No puede haber dos "cuenta 3" de la misma orden.
  constraint pos_order_accounts_numero_unico unique (order_id, numero)
);

comment on table public.pos_order_accounts is
  'Cuentas a cobrar de una orden. Sin split: una sola. Se crean al definir el split, no al cobrar.';

create index if not exists pos_order_accounts_orden_idx
  on public.pos_order_accounts (order_id);
-- El filtro por tenant es obligatorio en toda lectura de negocio (CLAUDE.md §12).
create index if not exists pos_order_accounts_tenant_idx
  on public.pos_order_accounts (client_id, order_id);


-- ── 3. Los INTENTOS de pago ─────────────────────────────────────────────────
-- Intentos, no pagos: un rechazo tambien es una fila. Sin registrar el rechazo
-- no se puede distinguir «no se ha cobrado» de «se intento y no paso», y esa
-- diferencia es la que decide si se vuelve a pasar la tarjeta.
create table if not exists public.pos_payment_attempts (
  -- LA CLAVE DE LA IDEMPOTENCIA. `{account_id}#{opId}`, derivado del opId que el
  -- POS ya genera una vez por accion de cobro: un doble tap produce el MISMO
  -- payment_id y se detecta como repeticion, no como cobro nuevo.
  payment_id      text primary key,
  account_id      text not null references public.pos_order_accounts(account_id),
  order_id        text not null,
  client_id       text not null,
  terminal_id     text,
  monto           numeric(12,2) not null,
  metodo          text,
  estado          text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint pos_payment_attempts_estado_valido
    check (estado in ('pendiente', 'aceptado', 'rechazado')),
  -- Un pago aceptado de cero o negativo no existe. Un intento pendiente o
  -- rechazado puede traer cualquier monto: es lo que se intento.
  constraint pos_payment_attempts_monto_valido
    check (estado <> 'aceptado' or monto > 0)
);

comment on table public.pos_payment_attempts is
  'INTENTOS de pago, no pagos: un rechazo tambien es una fila. payment_id = {account_id}#{opId}, derivado del opId idempotente del POS.';
comment on column public.pos_payment_attempts.payment_id is
  'Idempotencia: el mismo intento reenviado colisiona con la PK y se detecta como repeticion, no como cobro nuevo.';

create index if not exists pos_payment_attempts_cuenta_idx
  on public.pos_payment_attempts (account_id);
-- El indice que sostiene la decision de cierre: "cuanto se ha ACEPTADO de esta
-- orden". Parcial porque un rechazo no suma y no hace falta indexarlo.
create index if not exists pos_payment_attempts_aceptados_idx
  on public.pos_payment_attempts (order_id, account_id)
  where estado = 'aceptado';
create index if not exists pos_payment_attempts_tenant_idx
  on public.pos_payment_attempts (client_id, order_id);


-- ── 4. Marca de cierre, para emitirlo EXACTAMENTE una vez ───────────────────
-- Sin esto, dos terminales que evaluan la liquidacion al mismo tiempo emiten dos
-- ORDER_CLOSED. El unique index es lo que lo hace atomico: gana quien inserte
-- primero, el segundo choca y no emite.
create table if not exists public.pos_order_closures (
  order_id        text primary key,
  client_id       text not null,
  closed_at       timestamptz not null default now(),
  closed_by       text,
  terminal_id     text
);

comment on table public.pos_order_closures is
  'Una fila por orden liquidada. La PK garantiza que ORDER_CLOSED se emita una sola vez aunque dos terminales lo decidan a la vez.';


-- ── 5. Backfill SEGURO ──────────────────────────────────────────────────────
-- Se le crea su cuenta unica a las ordenes existentes, para que el modelo nuevo
-- las describa sin cambiarlas.
--
-- NO se inventa historia de pagos: no se insertan `pos_payment_attempts` para
-- ordenes viejas. El jsonb `pagos` no tiene identificadores de intento, y
-- fabricarlos produciria idempotencia falsa — dos filas distintas para el mismo
-- cobro real. Las ordenes anteriores se quedan descritas por su propio `pagos`,
-- que es donde siempre estuvieron.
--
-- Idempotente: `on conflict do nothing`. Correrlo dos veces no duplica.
insert into public.pos_order_accounts (account_id, order_id, client_id, numero, total, created_at)
select o.id || ':full', o.id, o.client_id, 1, coalesce(o.total, 0), coalesce(o.created_at, now())
  from public.pos_orders o
 where o.client_id is not null and o.client_id <> ''
   and o.parent_order_id is null
on conflict (account_id) do nothing;

-- Las 7 huerfanas con client_id vacio (documentadas en la migracion del folio)
-- se dejan fuera a proposito: no se les inventa restaurante.


-- ── 6. Lo que NO trae esta migracion, y por que ─────────────────────────────
--
-- · Sin RLS. Las politicas de este proyecto se definen aparte y aplicarlas aqui
--   mezclaria dos cambios. Antes de usar estas tablas desde el cliente hay que
--   agregarlas al mismo regimen que `pos_orders`.
-- · Sin trigger que emita el cierre. La decision vive en `liquidacion-de-orden.ts`
--   y esta probada ahi. Duplicarla en SQL crearia dos autoridades que pueden
--   discrepar — el error que este trabajo entero existe para evitar.
-- · Sin FK de `parent_order_id` a `pos_orders(id)`. Una orden creada offline
--   puede subir DESPUES que su hija; una FK dura rechazaria la hija y perderia
--   un cobro. Lo cubre el CHECK de arriba y la validacion en la aplicacion.


-- ============================================================================
-- ROLLBACK — probado en local, no en produccion
--
-- Revierte por completo. Las tres tablas son nuevas: no hay dato previo que
-- perder. La columna se puede dejar (es aditiva y no estorba) o quitar.
--
--   drop table if exists public.pos_order_closures;
--   drop table if exists public.pos_payment_attempts;
--   drop table if exists public.pos_order_accounts;
--   alter table public.pos_orders drop constraint if exists pos_orders_parent_no_es_si_misma;
--   alter table public.pos_orders drop column if exists parent_order_id;
--
-- El backfill del paso 5 se va con el `drop table` de pos_order_accounts.
-- ============================================================================
