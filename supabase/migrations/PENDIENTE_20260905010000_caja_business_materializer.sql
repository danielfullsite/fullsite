-- Candidato, NO aplicado. Ejecutar sólo después de la migración pendiente de
-- cuentas de 20260904 y de revisar el cutover de cada sucursal. No activa ninguna.
-- Una copia shadow no es un recibo de negocio. Esta función confirma ambos
-- (proyección + recibo) en una transacción y rechaza cualquier otro escritor.

alter table public.pos_orders
  add column if not exists payment_status text,
  add column if not exists preparation_status text,
  add column if not exists saldo numeric,
  add column if not exists kitchen_items jsonb,
  add column if not exists kitchen_revision bigint not null default 0,
  add column if not exists financial_revision bigint not null default 0,
  add column if not exists caja_operational_snapshot jsonb,
  add column if not exists caja_financial_snapshot jsonb,
  add column if not exists caja_stream_id uuid;
alter table public.pos_turnos
  add column if not exists location_id text,
  add column if not exists caja_snapshot jsonb,
  add column if not exists caja_stream_id uuid;
alter table public.pos_order_accounts
  add column if not exists location_id text,
  add column if not exists snapshot jsonb,
  add column if not exists caja_stream_id uuid;
alter table public.pos_payment_attempts
  add column if not exists location_id text,
  add column if not exists snapshot jsonb,
  add column if not exists caja_stream_id uuid;
alter table public.pos_order_closures
  add column if not exists location_id text,
  add column if not exists caja_stream_id uuid;
alter table public.pos_cash_movements
  add column if not exists location_id text,
  add column if not exists caja_stream_id uuid,
  add column if not exists caja_movement_id text;
create unique index if not exists pos_cash_movement_identity
  on public.pos_cash_movements(client_id, location_id, caja_movement_id);
alter table public.pos_payment_attempts drop constraint if exists pos_payment_attempts_estado_valido;
alter table public.pos_payment_attempts add constraint pos_payment_attempts_estado_valido
  check (estado in ('pendiente', 'aceptado', 'rechazado', 'desconocido'));

-- Provisioning is administrative: the raw 32-byte random credential lives only
-- in Caja main config; cloud stores SHA256, never the LAN/employee credential.
create table if not exists public.pos_caja_streams (
  stream_id uuid primary key,
  client_id text not null,
  location_id text not null check (length(location_id) > 0),
  caja_terminal_id text not null,
  credential_hash text not null check (credential_hash ~ '^[a-f0-9]{64}$'),
  active boolean not null default false,
  writer_authority boolean not null default false,
  baseline_sequence bigint not null check (baseline_sequence >= 0),
  baseline_history_hash text not null check (baseline_history_hash ~ '^[a-f0-9]{64}$'),
  last_sequence bigint not null check (last_sequence >= baseline_sequence),
  last_history_hash text not null check (last_history_hash ~ '^[a-f0-9]{64}$'),
  activated_at timestamptz,
  reconciliation_reference text not null check (length(reconciliation_reference) > 0)
);
alter table public.pos_caja_streams add column if not exists writer_authority boolean not null default false;
create unique index if not exists pos_caja_one_active_stream on public.pos_caja_streams(client_id, location_id) where active;
create unique index if not exists pos_caja_one_writer on public.pos_caja_streams(client_id, location_id) where writer_authority;
create table if not exists public.pos_caja_business_receipts (
  stream_id uuid not null references public.pos_caja_streams(stream_id),
  sequence bigint not null,
  event_id text not null,
  client_id text not null,
  location_id text not null,
  event jsonb not null,
  previous_history_hash text not null,
  history_hash text not null,
  transaction_id bigint not null,
  materialized boolean not null,
  committed_at timestamptz not null default now(),
  primary key(stream_id, sequence),
  unique(client_id, location_id, event_id)
);
alter table public.pos_caja_streams enable row level security;
alter table public.pos_caja_business_receipts enable row level security;
revoke all on public.pos_caja_streams, public.pos_caja_business_receipts from public, anon, authenticated, service_role;

-- The earlier pending migration deliberately had no RLS. Do not expose these
-- financial tables to browsers during cutover; reporting policies are separate.
alter table public.pos_order_accounts enable row level security;
alter table public.pos_payment_attempts enable row level security;
alter table public.pos_order_closures enable row level security;
revoke all on public.pos_order_accounts, public.pos_payment_attempts, public.pos_order_closures from anon, authenticated;

create or replace function public.pos_caja_write_fence() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  old_row jsonb; new_row jsonb; scope jsonb; receipt public.pos_caja_business_receipts%rowtype;
  protected boolean := false;
begin
  if TG_OP <> 'INSERT' then old_row := to_jsonb(OLD); end if;
  if TG_OP <> 'DELETE' then new_row := to_jsonb(NEW); end if;
  for scope in select x from jsonb_array_elements(jsonb_build_array(old_row, new_row)) x where x <> 'null'::jsonb loop
    if exists(select 1 from public.pos_caja_streams s where s.writer_authority and s.client_id = scope->>'client_id'
      and (scope->>'location_id' is null or s.location_id = scope->>'location_id')) then protected := true; end if;
  end loop;
  if protected then
    select * into receipt from public.pos_caja_business_receipts r
      where r.stream_id::text = current_setting('fullsite.caja_stream', true)
        and r.sequence::text = current_setting('fullsite.caja_sequence', true)
        and r.transaction_id = txid_current();
    if not found then raise exception 'CAJA_WRITE_FENCE: esta sucursal tiene un único escritor local'; end if;
    for scope in select x from jsonb_array_elements(jsonb_build_array(old_row, new_row)) x where x <> 'null'::jsonb loop
      if scope->>'client_id' is distinct from receipt.client_id or scope->>'location_id' is distinct from receipt.location_id
        or scope->>'caja_stream_id' is distinct from receipt.stream_id::text then
        raise exception 'CAJA_SCOPE_CONFLICT: no se puede adoptar o mover una fila legacy';
      end if;
    end loop;
  end if;
  if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
end $$;
revoke all on function public.pos_caja_write_fence() from public;
drop trigger if exists caja_write_fence on public.pos_orders;
create trigger caja_write_fence before insert or update or delete on public.pos_orders for each row execute function public.pos_caja_write_fence();
drop trigger if exists caja_write_fence on public.pos_turnos;
create trigger caja_write_fence before insert or update or delete on public.pos_turnos for each row execute function public.pos_caja_write_fence();
drop trigger if exists caja_write_fence on public.pos_order_accounts;
create trigger caja_write_fence before insert or update or delete on public.pos_order_accounts for each row execute function public.pos_caja_write_fence();
drop trigger if exists caja_write_fence on public.pos_payment_attempts;
create trigger caja_write_fence before insert or update or delete on public.pos_payment_attempts for each row execute function public.pos_caja_write_fence();
drop trigger if exists caja_write_fence on public.pos_order_closures;
create trigger caja_write_fence before insert or update or delete on public.pos_order_closures for each row execute function public.pos_caja_write_fence();
drop trigger if exists caja_write_fence on public.pos_cash_movements;
create trigger caja_write_fence before insert or update or delete on public.pos_cash_movements for each row execute function public.pos_caja_write_fence();

create or replace function public.pos_caja_json(value jsonb) returns jsonb
language sql immutable set search_path = pg_catalog as $$
  select case when jsonb_typeof(value) = 'string' then (value #>> '{}')::jsonb else value end
$$;
revoke all on function public.pos_caja_json(jsonb) from public;
create or replace function public.pos_caja_cents(value jsonb) returns bigint
language plpgsql immutable set search_path = pg_catalog as $$
declare n numeric;
begin
  if jsonb_typeof(value) is distinct from 'number' then raise exception 'INVALID_CENTS'; end if;
  n := (value #>> '{}')::numeric;
  if n < 0 or n > 9007199254740991 or n <> trunc(n) then raise exception 'INVALID_CENTS'; end if;
  return n::bigint;
end $$;
revoke all on function public.pos_caja_cents(jsonb) from public;

create or replace function public.apply_pos_caja_event(
  p_stream_id uuid, p_credential text, p_previous_history_hash text, p_history_hash text, p_event jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  stream public.pos_caja_streams%rowtype; receipt public.pos_caja_business_receipts%rowtype;
  event_seq bigint; event_type text; event_id text; result jsonb; op jsonb; fin jsonb; turno jsonb;
  existing public.pos_orders%rowtype; existing_turno public.pos_turnos%rowtype;
  old_fin jsonb; old_account jsonb; chosen_account text; dual boolean := false; delta bigint;
  account jsonb; payment jsonb; movement jsonb; account_number integer := 0; affected integer;
  paid bigint := 0; reserved bigint := 0; total bigint; account_total bigint := 0;
  account_paid bigint; account_reserved bigint; materialized boolean := false;
begin
  if p_credential is null or length(p_credential) < 32 or length(p_credential) > 256 then raise exception 'SYNC_UNAUTHORIZED'; end if;
  select * into stream from public.pos_caja_streams where stream_id = p_stream_id for update;
  if not found or not stream.active or not stream.writer_authority or stream.activated_at is null or
    stream.credential_hash <> encode(sha256(convert_to(p_credential, 'UTF8')), 'hex') then raise exception 'SYNC_UNAUTHORIZED'; end if;
  if jsonb_typeof(p_event) is distinct from 'object' or octet_length(p_event::text) > 4194304 or
     p_event->>'restaurant_id' is distinct from stream.client_id or
     p_previous_history_hash is null or p_previous_history_hash !~ '^[a-f0-9]{64}$' or
     p_history_hash is null or p_history_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_SYNC_ENVELOPE'; end if;
  event_seq := public.pos_caja_cents(p_event->'sequence');
  event_type := p_event->>'type'; event_id := p_event->>'id'; result := p_event->'result';
  if event_id is null or length(event_id) not between 1 and 200 or event_type is null then raise exception 'INVALID_SYNC_ENVELOPE'; end if;
  -- Retry is a receipt lookup plus immutable comparison, never another write.
  select * into receipt from public.pos_caja_business_receipts where stream_id = p_stream_id and sequence = event_seq;
  if found then
    if receipt.event <> p_event or receipt.previous_history_hash <> p_previous_history_hash or receipt.history_hash <> p_history_hash then
      raise exception 'STREAM_HISTORY_CONFLICT'; end if;
    return jsonb_build_object('stream_id', p_stream_id, 'sequence', event_seq, 'event_id', event_id,
      'history_hash', receipt.history_hash, 'materialized', receipt.materialized, 'duplicate', true);
  end if;
  if event_seq <> stream.last_sequence + 1 or p_previous_history_hash <> stream.last_history_hash then raise exception 'STREAM_SEQUENCE_GAP'; end if;
  materialized := event_type in ('TURN_OPEN', 'TURN_CLOSE', 'CASH_MOVEMENT', 'ORDER_SAVE', 'ORDER_SEND', 'ORDER_MOVE', 'ORDER_VOID', 'KITCHEN_SET',
    'FINANCIAL_OPEN', 'FINANCIAL_SPLIT', 'FINANCIAL_PAYMENT_START', 'FINANCIAL_PAYMENT_RESULT');
  if not materialized and event_type not in ('STATE_SYNC', 'MESA_LOCK', 'MESA_UNLOCK', 'PRINT_COMMAND') then
    raise exception 'UNSUPPORTED_BUSINESS_EVENT: %', event_type;
  end if;
  insert into public.pos_caja_business_receipts(stream_id, sequence, event_id, client_id, location_id, event,
    previous_history_hash, history_hash, transaction_id, materialized)
    values(p_stream_id, event_seq, event_id, stream.client_id, stream.location_id, p_event,
      p_previous_history_hash, p_history_hash, txid_current(), materialized);
  perform set_config('fullsite.caja_stream', p_stream_id::text, true);
  perform set_config('fullsite.caja_sequence', event_seq::text, true);

  if event_type in ('TURN_OPEN', 'TURN_CLOSE') then
    turno := case when event_type = 'TURN_OPEN' then result->'turno' else result->'closed_turno' end;
    if turno->>'id' is null or turno->>'authority' is distinct from 'caja' or turno->>'opened_by' is null then raise exception 'INVALID_TURNO_RESULT'; end if;
    select * into existing_turno from public.pos_turnos where id = turno->>'id' for update;
    if found and (existing_turno.client_id is distinct from stream.client_id or existing_turno.location_id is distinct from stream.location_id or existing_turno.caja_stream_id is distinct from p_stream_id) then raise exception 'TURNO_SCOPE_CONFLICT'; end if;
    if event_type = 'TURN_OPEN' then
      if found then raise exception 'TURNO_ID_REUSED'; end if;
      if exists(select 1 from public.pos_turnos where client_id = stream.client_id and closed_at is null and (location_id = stream.location_id or location_id is null)) then raise exception 'CLOUD_OPEN_TURN_CONFLICT'; end if;
      insert into public.pos_turnos(id, client_id, location_id, opened_by, opened_at, fondo_inicial, caja_stream_id, caja_snapshot)
        values(turno->>'id', stream.client_id, stream.location_id, turno->>'opened_by', (turno->>'opened_at')::timestamptz,
          public.pos_caja_cents(turno->'opening_cash_cents')::numeric / 100, p_stream_id, turno);
    else
      if not found or existing_turno.closed_at is not null or turno->>'closed_at' is null then raise exception 'TURNO_STATE_CONFLICT'; end if;
      if exists(select 1 from public.pos_orders where turno_id = turno->>'id' and client_id = stream.client_id and status <> 'cancelada'
        and (payment_status is distinct from 'pagada' or preparation_status not in ('entregada') and jsonb_array_length(coalesce(kitchen_items, '[]'::jsonb)) > 0)) then raise exception 'UNCLOSED_BUSINESS_WORK'; end if;
      update public.pos_turnos set closed_by = turno->>'closed_by', closed_at = (turno->>'closed_at')::timestamptz, caja_snapshot = turno,
        fondo_final = case when turno ? 'counted_cash_cents' then public.pos_caja_cents(turno->'counted_cash_cents')::numeric / 100 else null end,
        efectivo_sistema = case when turno ? 'expected_cash_cents' then public.pos_caja_cents(turno->'expected_cash_cents')::numeric / 100 else null end,
        diferencia = case when turno ? 'difference_cents' then (turno->>'difference_cents')::numeric / 100 else null end,
        notas = turno->>'notes' where id = turno->>'id';
    end if;
  elsif event_type = 'CASH_MOVEMENT' then
    movement := result->'cash_movement';
    if nullif(movement->>'id','') is null or movement->>'type' not in ('retiro','deposito') or
      nullif(movement->>'reason','') is null or nullif(movement->>'actor','') is null or
      nullif(movement->>'approved_by','') is null or public.pos_caja_cents(movement->'amount_cents') <= 0
      then raise exception 'INVALID_CASH_MOVEMENT'; end if;
    if not exists(select 1 from public.pos_turnos where id=movement->>'turno_id' and client_id=stream.client_id
      and location_id=stream.location_id and caja_stream_id=p_stream_id and closed_at is null)
      then raise exception 'CASH_MOVEMENT_TURN_MISMATCH'; end if;
    insert into public.pos_cash_movements(client_id,location_id,caja_stream_id,caja_movement_id,turno_id,type,amount,reason,actor,approved_by,created_at)
      values(stream.client_id,stream.location_id,p_stream_id,movement->>'id',movement->>'turno_id',movement->>'type',
        public.pos_caja_cents(movement->'amount_cents')::numeric/100,movement->>'reason',movement->>'actor',movement->>'approved_by',
        (movement->>'created_at')::timestamptz)
      on conflict(client_id,location_id,caja_movement_id) do nothing;
    if not exists(select 1 from public.pos_cash_movements where client_id=stream.client_id and location_id=stream.location_id
      and caja_movement_id=movement->>'id' and turno_id=movement->>'turno_id' and type=movement->>'type'
      and amount=public.pos_caja_cents(movement->'amount_cents')::numeric/100 and reason=movement->>'reason'
      and actor=movement->>'actor' and approved_by=movement->>'approved_by' and caja_stream_id=p_stream_id)
      then raise exception 'CASH_MOVEMENT_ID_CONFLICT'; end if;
  elsif event_type in ('ORDER_SAVE', 'ORDER_SEND', 'ORDER_MOVE', 'ORDER_VOID', 'KITCHEN_SET') then
    op := result->'operational_order';
    if op->>'authority' is distinct from 'caja' or op->>'order_id' is null or op->>'turno_id' is null then raise exception 'INVALID_ORDER_RESULT'; end if;
    if not exists(select 1 from public.pos_turnos where id = op->>'turno_id' and client_id = stream.client_id and location_id = stream.location_id and caja_stream_id = p_stream_id and closed_at is null) then raise exception 'TURNO_NOT_MATERIALIZED'; end if;
    select * into existing from public.pos_orders where id = op->>'order_id' for update;
    if found and (existing.client_id is distinct from stream.client_id or existing.location_id is distinct from stream.location_id or existing.caja_stream_id is distinct from p_stream_id) then raise exception 'ORDER_SCOPE_CONFLICT'; end if;
    if event_type = 'KITCHEN_SET' then
      if not found or public.pos_caja_cents(op->'kitchen_revision') <> existing.kitchen_revision + 1 or
        public.pos_caja_cents(op->'order_revision') <> existing.order_revision then raise exception 'KITCHEN_PROJECTION_GAP'; end if;
    elsif public.pos_caja_cents(op->'order_revision') <> coalesce(existing.order_revision, 0) + 1 then raise exception 'ORDER_PROJECTION_GAP'; end if;
    total := public.pos_caja_cents(op->'total_cents');
    if total <> public.pos_caja_cents(op->'subtotal_cents') + public.pos_caja_cents(op->'iva_cents') then raise exception 'ORDER_TOTAL_MISMATCH'; end if;
    dual := event_type in ('ORDER_SAVE', 'ORDER_SEND') and existing.financial_revision > 0;
    if dual then
      fin := result->'financial_order'; old_fin := existing.caja_financial_snapshot;
      if jsonb_typeof(fin) is distinct from 'object' or old_fin->>'status' is distinct from 'open' or
        existing.payment_status = 'pagada' or fin->>'status' is distinct from 'open' then raise exception 'DUAL_FINANCIAL_REQUIRED'; end if;
      if fin->>'order_id' is distinct from op->>'order_id' or fin->>'order_id' is distinct from existing.id or
        fin->>'turno_id' is distinct from old_fin->>'turno_id' or fin->>'turno_id' is distinct from op->>'turno_id' then raise exception 'DUAL_ORDER_SCOPE'; end if;
      if (fin - 'revision' - 'order_revision' - 'total_cents' - 'balance_cents' - 'accounts' - 'payments') is distinct from
        (old_fin - 'revision' - 'order_revision' - 'total_cents' - 'balance_cents' - 'accounts' - 'payments') then raise exception 'DUAL_METADATA_CHANGED'; end if;
      if public.pos_caja_cents(p_event->'payload'->'expected_financial_revision') <> existing.financial_revision or
        public.pos_caja_cents(fin->'revision') <> existing.financial_revision + 1 or
        public.pos_caja_cents(fin->'order_revision') <> public.pos_caja_cents(op->'order_revision') then raise exception 'DUAL_REVISION_CONFLICT'; end if;
      if fin->'payments' is distinct from old_fin->'payments' then raise exception 'DUAL_PAYMENT_CHANGED'; end if;
      delta := total - public.pos_caja_cents(old_fin->'total_cents');
      if delta < 0 or (event_type = 'ORDER_SEND' and delta <> 0) then raise exception 'DUAL_TOTAL_DECREASE'; end if;
      chosen_account := p_event->'payload'->>'account_id';
      if event_type = 'ORDER_SAVE' and (nullif(chosen_account,'') is null or not exists(
        select 1 from jsonb_array_elements(old_fin->'accounts') x where x->>'account_id'=chosen_account)) then raise exception 'DUAL_ACCOUNT_REQUIRED'; end if;
      if event_type = 'ORDER_SAVE' and (result->'financial_allocation'->>'account_id' is distinct from chosen_account or
        public.pos_caja_cents(result->'financial_allocation'->'amount_cents') <> delta) then raise exception 'DUAL_ALLOCATION_MISMATCH'; end if;
      if jsonb_typeof(fin->'accounts') is distinct from 'array' or jsonb_array_length(fin->'accounts') <> jsonb_array_length(old_fin->'accounts') then raise exception 'DUAL_ACCOUNT_CHANGED'; end if;
      for old_account in select x from jsonb_array_elements(old_fin->'accounts') x loop
        select x into account from jsonb_array_elements(fin->'accounts') x where x->>'account_id'=old_account->>'account_id';
        if not found or (account - 'total_cents' - 'balance_cents') is distinct from (old_account - 'total_cents' - 'balance_cents') or
          public.pos_caja_cents(account->'total_cents') <> public.pos_caja_cents(old_account->'total_cents') + (case when old_account->>'account_id'=chosen_account then delta else 0 end) or
          public.pos_caja_cents(account->'balance_cents') <> public.pos_caja_cents(old_account->'balance_cents') + (case when old_account->>'account_id'=chosen_account then delta else 0 end)
          then raise exception 'DUAL_ACCOUNT_CHANGED'; end if;
      end loop;
    elsif event_type in ('ORDER_SAVE','ORDER_SEND') and result ? 'financial_order' then raise exception 'UNEXPECTED_FINANCIAL_RESULT';
    elsif existing.financial_revision > 0 and total::numeric <> existing.total * 100 then raise exception 'FINANCIAL_ORDER_MISMATCH'; end if;
    insert into public.pos_orders(id, client_id, location_id, turno_id, mesa, mesero, personas, customer_name, notas, status,
      subtotal, iva, total, items, created_at, updated_at, order_revision, preparation_status, payment_status, saldo,
      comanda_batches, kitchen_items, kitchen_revision, caja_stream_id, caja_operational_snapshot)
    values(op->>'order_id', stream.client_id, stream.location_id, op->>'turno_id', (op->>'mesa')::integer, op->>'mesero',
      (op->>'personas')::integer, op->>'customer_name', op->>'notas', op->>'status',
      public.pos_caja_cents(op->'subtotal_cents')::numeric / 100, public.pos_caja_cents(op->'iva_cents')::numeric / 100,
      total::numeric / 100, public.pos_caja_json(op->'items'), (op->>'created_at')::timestamptz, (op->>'updated_at')::timestamptz,
      public.pos_caja_cents(op->'order_revision'), op->>'preparation_status', coalesce(existing.payment_status, 'pendiente'),
      case when existing.financial_revision > 0 then existing.saldo else total::numeric / 100 end, public.pos_caja_json(op->'comanda_batches'), op->'kitchen_items',
      public.pos_caja_cents(op->'kitchen_revision'), p_stream_id, op)
    on conflict (id) do update set mesa = excluded.mesa, mesero = excluded.mesero, personas = excluded.personas,
      customer_name = excluded.customer_name, notas = excluded.notas, status = excluded.status, subtotal = excluded.subtotal,
      iva = excluded.iva, total = excluded.total, saldo = excluded.saldo, items = excluded.items, updated_at = excluded.updated_at,
      order_revision = excluded.order_revision, preparation_status = excluded.preparation_status,
      comanda_batches = excluded.comanda_batches, kitchen_items = excluded.kitchen_items,
      kitchen_revision = excluded.kitchen_revision, caja_operational_snapshot = excluded.caja_operational_snapshot;
  end if;
  if event_type like 'FINANCIAL_%' or dual then
    fin := result->'financial_order';
    if fin->>'order_id' is null or fin->>'currency' is distinct from 'MXN' or jsonb_typeof(fin->'accounts') is distinct from 'array'
      or jsonb_array_length(fin->'accounts') = 0 or jsonb_typeof(fin->'payments') is distinct from 'array' then raise exception 'INVALID_FINANCIAL_RESULT'; end if;
    select * into existing from public.pos_orders where id = fin->>'order_id' for update;
    if not found or existing.client_id is distinct from stream.client_id or existing.location_id is distinct from stream.location_id or existing.caja_stream_id is distinct from p_stream_id or existing.turno_id is distinct from fin->>'turno_id' then raise exception 'FINANCIAL_ORDER_SCOPE'; end if;
    total := public.pos_caja_cents(fin->'total_cents');
    if total::numeric <> existing.total * 100 or public.pos_caja_cents(fin->'order_revision') <> existing.order_revision then raise exception 'FINANCIAL_ORDER_MISMATCH'; end if;
    if fin = existing.caja_financial_snapshot then null;
    elsif public.pos_caja_cents(fin->'revision') <> existing.financial_revision + 1 then raise exception 'FINANCIAL_PROJECTION_GAP'; end if;
    if (select count(*) <> count(distinct x->>'account_id') from jsonb_array_elements(fin->'accounts') x) or
       (select count(*) <> count(distinct x->>'payment_id') from jsonb_array_elements(fin->'payments') x) then raise exception 'DUPLICATE_FINANCIAL_ID'; end if;
    if exists(select 1 from public.pos_payment_attempts p where p.client_id = stream.client_id and p.order_id = fin->>'order_id'
      and not exists(select 1 from jsonb_array_elements(fin->'payments') x where x->>'payment_id' = p.payment_id)) then raise exception 'PAYMENT_HISTORY_REMOVED'; end if;
    for account in select x from jsonb_array_elements(fin->'accounts') x loop
      account_number := account_number + 1;
      account_total := account_total + public.pos_caja_cents(account->'total_cents'); account_paid := 0; account_reserved := 0;
      if account->>'account_id' is null then raise exception 'ACCOUNT_ID_MISSING'; end if;
      for payment in select x from jsonb_array_elements(fin->'payments') x where x->>'account_id' = account->>'account_id' loop
        if payment->>'status' = 'accepted' then account_paid := account_paid + public.pos_caja_cents(payment->'amount_cents');
        elsif payment->>'status' in ('pending', 'unknown') then account_reserved := account_reserved + public.pos_caja_cents(payment->'amount_cents');
        elsif payment->>'status' is distinct from 'rejected' then raise exception 'INVALID_PAYMENT_STATUS'; end if;
      end loop;
      if public.pos_caja_cents(account->'paid_cents') <> account_paid or public.pos_caja_cents(account->'reserved_cents') <> account_reserved or
        public.pos_caja_cents(account->'balance_cents') <> public.pos_caja_cents(account->'total_cents') - account_paid or
        account_paid + account_reserved > public.pos_caja_cents(account->'total_cents') then raise exception 'ACCOUNT_SUM_MISMATCH'; end if;
      paid := paid + account_paid; reserved := reserved + account_reserved;
    end loop;
    if account_total <> total or public.pos_caja_cents(fin->'paid_cents') <> paid or public.pos_caja_cents(fin->'reserved_cents') <> reserved or
      public.pos_caja_cents(fin->'balance_cents') <> total - paid or fin->>'status' is distinct from (case when total = paid then 'settled' else 'open' end) then raise exception 'FINANCIAL_SUM_MISMATCH'; end if;
    -- Split defines the complete set before any attempt, including a legitimate
    -- reuse/reorder of an existing account ID with a different allocation.
    -- Its earlier definition remains in immutable event receipts.
    if event_type = 'FINANCIAL_SPLIT' then
      if exists(select 1 from public.pos_payment_attempts where client_id = stream.client_id and order_id = fin->>'order_id') then raise exception 'SPLIT_HAS_PAYMENT_HISTORY'; end if;
      delete from public.pos_order_accounts a where a.order_id = fin->>'order_id' and a.client_id = stream.client_id;
    else
      delete from public.pos_order_accounts a where a.order_id = fin->>'order_id' and a.client_id = stream.client_id
        and not exists(select 1 from jsonb_array_elements(fin->'accounts') x where x->>'account_id' = a.account_id);
    end if;
    account_number := 0;
    for account in select x from jsonb_array_elements(fin->'accounts') x loop
      account_number := account_number + 1;
      insert into public.pos_order_accounts(account_id, order_id, client_id, location_id, numero, total, snapshot, caja_stream_id)
        values(account->>'account_id', fin->>'order_id', stream.client_id, stream.location_id, account_number,
          public.pos_caja_cents(account->'total_cents')::numeric / 100, account, p_stream_id)
      on conflict(account_id) do update set snapshot = excluded.snapshot, total = excluded.total
        where pos_order_accounts.client_id = excluded.client_id and pos_order_accounts.location_id = excluded.location_id and
          pos_order_accounts.order_id = excluded.order_id and pos_order_accounts.caja_stream_id = excluded.caja_stream_id and (pos_order_accounts.total = excluded.total or dual);
      get diagnostics affected = row_count; if affected <> 1 then raise exception 'ACCOUNT_ID_CONFLICT'; end if;
    end loop;
    if not dual then
    for payment in select x from jsonb_array_elements(fin->'payments') x loop
      if payment->>'payment_id' is null or not exists(select 1 from jsonb_array_elements(fin->'accounts') x where x->>'account_id' = payment->>'account_id') then raise exception 'PAYMENT_ACCOUNT_MISSING'; end if;
      insert into public.pos_payment_attempts(payment_id, account_id, order_id, client_id, location_id, terminal_id, monto, metodo, estado, snapshot, caja_stream_id)
        values(payment->>'payment_id', payment->>'account_id', fin->>'order_id', stream.client_id, stream.location_id, stream.caja_terminal_id,
          public.pos_caja_cents(payment->'amount_cents')::numeric / 100, payment->>'method',
          case payment->>'status' when 'accepted' then 'aceptado' when 'pending' then 'pendiente' when 'unknown' then 'desconocido' when 'rejected' then 'rechazado' end, payment, p_stream_id)
      on conflict(payment_id) do update set estado = excluded.estado, snapshot = excluded.snapshot, updated_at = now()
        where pos_payment_attempts.client_id = excluded.client_id and pos_payment_attempts.location_id = excluded.location_id and
          pos_payment_attempts.order_id = excluded.order_id and pos_payment_attempts.account_id = excluded.account_id and
          pos_payment_attempts.caja_stream_id = excluded.caja_stream_id and pos_payment_attempts.monto = excluded.monto and
          (pos_payment_attempts.estado in ('pendiente', 'desconocido') or pos_payment_attempts.snapshot = excluded.snapshot);
      get diagnostics affected = row_count; if affected <> 1 then raise exception 'PAYMENT_ID_CONFLICT'; end if;
    end loop;
    end if;
    update public.pos_orders set financial_revision = public.pos_caja_cents(fin->'revision'), caja_financial_snapshot = fin,
      saldo = public.pos_caja_cents(fin->'balance_cents')::numeric / 100, payment_status = case when fin->>'status' = 'settled' then 'pagada' else 'pendiente' end,
      pagos = coalesce((select jsonb_agg(jsonb_build_object('payment_id', x->>'payment_id', 'account_id', x->>'account_id',
        'monto', public.pos_caja_cents(x->'amount_cents')::numeric / 100, 'metodo', x->>'method')) from jsonb_array_elements(fin->'payments') x where x->>'status' = 'accepted'), '[]'::jsonb)
      where id = fin->>'order_id';
    -- Deliberately no status/closed_at/preparation update: settled is not served.
  end if;
  update public.pos_caja_streams set last_sequence = event_seq, last_history_hash = p_history_hash where stream_id = p_stream_id;
  return jsonb_build_object('stream_id', p_stream_id, 'sequence', event_seq, 'event_id', event_id,
    'history_hash', p_history_hash, 'materialized', materialized, 'duplicate', false);
end $$;
revoke all on function public.apply_pos_caja_event(uuid, text, text, text, jsonb) from public;
-- `anon` es el rol de la LLAVE PUBLICA. Este mismo archivo revoca arriba (L75) todo
-- acceso de `anon` a las tablas de caja; otorgarle EXECUTE sobre el materializador
-- que las escribe lo contradice. No hay un solo llamador de esta funcion en el
-- cliente: el POS llega por /api/pos/db con service_role. Se queda fuera.
grant execute on function public.apply_pos_caja_event(uuid, text, text, text, jsonb) to authenticated, service_role;
