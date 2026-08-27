-- Limpieza total de órdenes — protocolo de tres fases.
--
-- POR QUÉ ESTA MIGRACIÓN REEMPLAZA A LA ANTERIOR
--
-- `20260826200000` metió `STARTED`, el `DELETE` y `FAILED` en UNA sola función plpgsql,
-- o sea en UNA sola transacción. El comentario de esa migración presumía que una
-- interrupción "deja huella en vez de silencio".
--
-- **Eso era falso, y es el mismo defecto que venía a corregir.**
--
-- Si la transacción aborta —el `DELETE` truena, se vence el `statement_timeout`, se cae la
-- conexión— Postgres revierte TODO, incluida la fila `STARTED`. No queda constancia de que
-- alguien lo intentó siquiera. Y `FAILED` escrito dentro de la misma transacción se revierte
-- igual, por la misma razón: un estado de fracaso sólo sobrevive si se escribe en una
-- transacción que sí confirma.
--
-- La regla general, que vale para cualquier operación destructiva:
--
--   > La intención se registra en una transacción. El efecto, en otra. El fracaso, en una
--   > tercera. Un registro que comparte transacción con lo que describe no puede describir
--   > el fracaso de esa transacción.
--
-- EL PROTOCOLO
--
--   Fase 1 · r1_cleanup_begin()    transacción propia → INSERT 'STARTED' + respaldo. Confirma.
--   Fase 2 · r1_cleanup_commit()   transacción propia → FOR UPDATE, valida, DELETE, 'COMMITTED'
--   Fase 3 · r1_cleanup_fail()     transacción propia → 'FAILED', sólo si la 2 falló
--
-- La fase 2 es la única atómica-con-el-borrado, y es la única que necesita serlo: o quedan
-- el `DELETE` y el `COMMITTED`, o no queda ninguno de los dos.
--
-- Propiedad que se sigue: **si no se pudo escribir la constancia, no se borra.** La fase 1
-- es un requisito, no un adorno. Es la inversión exacta del diseño *best-effort*, donde el
-- borrado ocurría primero y la constancia era una esperanza.
--
-- REVERSIÓN
--   drop function if exists public.r1_cleanup_begin(text,text,text,text,text,text,text,integer,jsonb);
--   drop function if exists public.r1_cleanup_commit(text,text);
--   drop function if exists public.r1_cleanup_fail(text,text);
--   drop function if exists public.r1_cleanup_restore(text);
--   drop view     if exists public.pos_cleanup_atoradas;
--   drop table    if exists public.pos_cleanup_operations;
-- Nada existente depende de estos objetos.

-- ─────────────────────────────────────────────────────────────────────────────
-- Fuera lo anterior. La tabla se recrea porque cambia de forma; está vacía (verificado
-- antes de correr esto), así que no hay dato que preservar.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.r1_cleanup_orders(text,text,text,text,text,text,integer,text);
drop function if exists public.r1_cleanup_restore(text);
drop table    if exists public.pos_cleanup_operations;

-- ─────────────────────────────────────────────────────────────────────────────
-- Libro de operaciones destructivas
-- ─────────────────────────────────────────────────────────────────────────────
create table public.pos_cleanup_operations (
  operation_id      text primary key,
  client_id         text not null,
  state             text not null check (state in ('STARTED','COMMITTED','FAILED')),

  -- quién, con qué permiso, y por qué
  actor             text not null,
  staff_id          text,
  role              text,
  reason            text,
  confirmation      text not null,

  -- de dónde vino la petición. NO lleva token, cookie, PIN ni IP: sólo lo que hace falta
  -- para correlacionar con el registro de la plataforma. Existe porque el incidente del
  -- 2026-08-25 fue imposible de correlacionar — los registros de ejecución guardaban una
  -- línea en 24 h. Ahora la operación se auto-correlaciona y no depende de esa retención.
  request_metadata  jsonb,

  -- el respaldo, y su huella verificable
  backup            jsonb   not null,
  backup_sha256     text    not null,
  client_digest     text,
  expected_count    integer not null,

  -- el resultado
  deleted_count     integer,
  failure_detail    text,

  started_at        timestamptz not null default now(),
  completed_at      timestamptz,

  -- Un COMMITTED sin conteo, o un STARTED con conteo, serían estados imposibles.
  constraint pos_cleanup_estado_coherente check (
    (state = 'STARTED'   and deleted_count is null and completed_at is null) or
    (state = 'COMMITTED' and deleted_count is not null and completed_at is not null) or
    (state = 'FAILED'    and completed_at is not null)
  )
);

create index pos_cleanup_operations_cliente_idx
  on public.pos_cleanup_operations (client_id, started_at desc);

-- Índice parcial: hace barata la consulta de atoradas, que corre seguido y siempre espera 0.
create index pos_cleanup_operations_atoradas_idx
  on public.pos_cleanup_operations (started_at) where state = 'STARTED';

comment on table public.pos_cleanup_operations is
  'Libro de borrados totales de órdenes. STARTED se escribe en su propia transacción (sobrevive a un fallo posterior); el DELETE y COMMITTED comparten la suya; FAILED se escribe en una tercera.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Fase 5 del protocolo: detectar operaciones atoradas.
--
-- Un STARTED que lleva minutos sin resolverse significa que la fase 2 nunca terminó o nunca
-- se llamó. No debería existir nunca; si aparece, hay que mirarlo — puede haber un borrado
-- a medias, o una intención que quedó sin ejecutar.
-- ─────────────────────────────────────────────────────────────────────────────
create view public.pos_cleanup_atoradas as
  select operation_id, client_id, actor, staff_id, role, expected_count,
         started_at,
         now() - started_at as lleva,
         -- Si las órdenes ya no están pero el estado sigue en STARTED, el borrado ocurrió
         -- y la constancia final se perdió: es el caso grave.
         (select count(*) from pos_orders o where o.client_id = op.client_id) as ordenes_ahora
    from public.pos_cleanup_operations op
   where state = 'STARTED'
     and started_at < now() - interval '5 minutes';

comment on view public.pos_cleanup_atoradas is
  'Operaciones de limpieza que llevan más de 5 minutos en STARTED. Lo normal es cero filas. Una fila con ordenes_ahora = 0 significa que el borrado ocurrió y su constancia final se perdió.';

-- ═════════════════════════════════════════════════════════════════════════════
-- FASE 1 — la intención, en su propia transacción
-- ═════════════════════════════════════════════════════════════════════════════
create function public.r1_cleanup_begin(
  p_operation_id     text,
  p_client_id        text,
  p_actor            text,
  p_staff_id         text,
  p_role             text,
  p_reason           text,
  p_confirmation     text,
  p_expected_count   integer,
  p_request_metadata jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_previa    record;
  v_respaldo  jsonb;
  v_sha       text;
  v_actual    integer;
begin
  if coalesce(p_operation_id,'') = '' then
    return jsonb_build_object('ok', false, 'error', 'OPERATION_ID_REQUERIDO');
  end if;
  if coalesce(p_client_id,'') = '' then
    return jsonb_build_object('ok', false, 'error', 'CLIENT_ID_REQUERIDO');
  end if;
  if p_confirmation is distinct from 'BORRAR TODAS LAS ORDENES' then
    return jsonb_build_object('ok', false, 'error', 'CONFIRMACION_INVALIDA');
  end if;

  -- Begin idempotente: repetir la fase 1 con la misma llave no duplica ni reinicia nada.
  select * into v_previa from pos_cleanup_operations where operation_id = p_operation_id;
  if found then
    if v_previa.client_id is distinct from p_client_id then
      return jsonb_build_object('ok', false, 'error', 'OPERATION_ID_DE_OTRO_TENANT');
    end if;
    return jsonb_build_object('ok', v_previa.state <> 'FAILED', 'replay', true,
      'state', v_previa.state, 'expected_count', v_previa.expected_count,
      'backup_sha256', v_previa.backup_sha256, 'deleted', v_previa.deleted_count,
      'operation_id', p_operation_id);
  end if;

  -- El respaldo se toma AQUÍ, del lado del servidor, y queda en esta misma fila. Cuando esta
  -- transacción confirme, el respaldo es durable y todavía no se ha borrado nada. Tomarlo
  -- aquí en vez de aceptarlo del cliente también evita que alguien mande uno recortado.
  select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb), count(*)
    into v_respaldo, v_actual
  from pos_orders o where o.client_id = p_client_id;

  -- Huella canónica: `jsonb` normaliza el orden de llaves y el `order by o.id` fija el de las
  -- filas, así que este hash es reproducible — se recalcula igual en la fase 2 y cualquiera
  -- puede recalcularlo sobre el respaldo guardado.
  v_sha := encode(digest(convert_to(v_respaldo::text, 'UTF8'), 'sha256'), 'hex');

  if v_actual <> p_expected_count then
    -- Ni siquiera se abre la operación: lo que el operador vio ya no es lo que hay.
    return jsonb_build_object('ok', false, 'error', 'CONTEO_CAMBIO',
      'expected', p_expected_count, 'current', v_actual);
  end if;

  insert into pos_cleanup_operations (
    operation_id, client_id, state, actor, staff_id, role, reason, confirmation,
    request_metadata, backup, backup_sha256, expected_count
  ) values (
    p_operation_id, p_client_id, 'STARTED', p_actor, p_staff_id, p_role, p_reason,
    p_confirmation, p_request_metadata, v_respaldo, v_sha, p_expected_count
  );

  return jsonb_build_object('ok', true, 'state', 'STARTED', 'replay', false,
    'operation_id', p_operation_id, 'backup_sha256', v_sha,
    'backup_count', jsonb_array_length(v_respaldo));
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- FASE 2 — el efecto: bloquear, validar, borrar y dejar constancia. Todo o nada.
-- ═════════════════════════════════════════════════════════════════════════════
create function public.r1_cleanup_commit(
  p_operation_id text,
  p_client_id    text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_op       record;
  v_ahora    jsonb;
  v_sha      text;
  v_actual   integer;
  v_borradas integer;
begin
  -- FOR UPDATE: serializa la operación. Dos peticiones con la misma llave —doble clic, un
  -- reintento que se cruza con el original— hacen fila aquí. La segunda entra cuando la
  -- primera ya confirmó, ve 'COMMITTED', y devuelve ese resultado sin volver a borrar.
  select * into v_op from pos_cleanup_operations
   where operation_id = p_operation_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'SIN_FASE_1',
      'detalle', 'No existe la operación. La fase 1 debe confirmar antes de borrar.');
  end if;

  -- El tenant se valida contra lo que la fase 1 dejó escrito, no contra lo que dice quien
  -- llama ahora. Una llave de un tenant no puede usarse para borrar otro.
  if v_op.client_id is distinct from p_client_id then
    return jsonb_build_object('ok', false, 'error', 'TENANT_NO_COINCIDE');
  end if;

  -- Estados terminales: se responden, no se re-ejecutan.
  if v_op.state = 'COMMITTED' then
    return jsonb_build_object('ok', true, 'replay', true, 'state', 'COMMITTED',
      'deleted', v_op.deleted_count, 'operation_id', p_operation_id);
  end if;
  if v_op.state = 'FAILED' then
    return jsonb_build_object('ok', false, 'replay', true, 'state', 'FAILED',
      'error', v_op.failure_detail, 'operation_id', p_operation_id);
  end if;

  -- Releer el estado actual y comparar contra la huella de la fase 1. Esto cubre la ventana
  -- entre fase 1 y fase 2: si entró o cambió una orden, el hash difiere y no se borra.
  select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb), count(*)
    into v_ahora, v_actual
  from pos_orders o where o.client_id = p_client_id;

  v_sha := encode(digest(convert_to(v_ahora::text, 'UTF8'), 'sha256'), 'hex');

  if v_sha is distinct from v_op.backup_sha256 then
    return jsonb_build_object('ok', false, 'error', 'DIGEST_NO_COINCIDE',
      'esperado', v_op.backup_sha256, 'actual', v_sha,
      'conteo_fase1', v_op.expected_count, 'conteo_ahora', v_actual);
  end if;

  if v_actual <> v_op.expected_count then
    return jsonb_build_object('ok', false, 'error', 'CONTEO_CAMBIO',
      'expected', v_op.expected_count, 'current', v_actual);
  end if;

  -- Sólo el tenant de la operación. Nunca sin `where`.
  delete from pos_orders where client_id = v_op.client_id;
  get diagnostics v_borradas = row_count;

  -- Misma transacción que el DELETE. Ésta es la única atomicidad que hace falta.
  update pos_cleanup_operations set
    state = 'COMMITTED', deleted_count = v_borradas, completed_at = now()
  where operation_id = p_operation_id;

  return jsonb_build_object('ok', true, 'replay', false, 'state', 'COMMITTED',
    'deleted', v_borradas, 'operation_id', p_operation_id,
    'backup_sha256', v_op.backup_sha256);
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- FASE 3 — el fracaso, en una transacción posterior e independiente
-- ═════════════════════════════════════════════════════════════════════════════
create function public.r1_cleanup_fail(
  p_operation_id text,
  p_detail       text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_op record;
begin
  select * into v_op from pos_cleanup_operations
   where operation_id = p_operation_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'OPERACION_NO_ENCONTRADA');
  end if;

  -- Un COMMITTED no se degrada a FAILED. Si el borrado ocurrió, ocurrió — aunque el cliente
  -- no haya visto la respuesta. Marcarlo como fallido aquí sería mentir sobre el efecto.
  if v_op.state = 'COMMITTED' then
    return jsonb_build_object('ok', false, 'error', 'YA_ESTABA_COMMITTED',
      'state', 'COMMITTED', 'deleted', v_op.deleted_count);
  end if;
  if v_op.state = 'FAILED' then
    return jsonb_build_object('ok', true, 'replay', true, 'state', 'FAILED');
  end if;

  update pos_cleanup_operations set
    state = 'FAILED', completed_at = now(),
    failure_detail = coalesce(p_detail, 'sin detalle')
  where operation_id = p_operation_id;

  return jsonb_build_object('ok', true, 'replay', false, 'state', 'FAILED',
    'operation_id', p_operation_id);
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Restauración desde el respaldo guardado
-- ═════════════════════════════════════════════════════════════════════════════
create function public.r1_cleanup_restore(p_operation_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_op        record;
  v_sha       text;
  v_repuestas integer;
begin
  select * into v_op from pos_cleanup_operations where operation_id = p_operation_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'OPERACION_NO_ENCONTRADA');
  end if;
  if v_op.state <> 'COMMITTED' then
    return jsonb_build_object('ok', false, 'error', 'SIN_RESPALDO_UTILIZABLE', 'state', v_op.state);
  end if;

  -- Verificar la huella antes de reponer: si el respaldo guardado no corresponde a su propio
  -- hash, algo lo alteró y no se restaura a ciegas.
  v_sha := encode(digest(convert_to(v_op.backup::text, 'UTF8'), 'sha256'), 'hex');
  if v_sha is distinct from v_op.backup_sha256 then
    return jsonb_build_object('ok', false, 'error', 'RESPALDO_CORRUPTO',
      'esperado', v_op.backup_sha256, 'actual', v_sha);
  end if;

  -- Sólo repone lo que falta. Si una orden volvió a existir, no se pisa.
  insert into pos_orders
  select * from jsonb_populate_recordset(null::pos_orders, v_op.backup) as r
   where not exists (select 1 from pos_orders o where o.id = r.id);
  get diagnostics v_repuestas = row_count;

  return jsonb_build_object('ok', true, 'restored', v_repuestas,
    'del_respaldo', jsonb_array_length(v_op.backup),
    'backup_sha256', v_op.backup_sha256, 'operation_id', p_operation_id);
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Permisos — fase 7 del protocolo
--
-- Ningún cliente POS puede falsificar auditoría ni ejecutar el borrado. El POS escribe con
-- la llave `anon` desde el navegador (ver print-queue.ts, pos-data.ts): esa llave no debe
-- llegar ni a la tabla ni a las funciones.
--
-- `REVOKE ... FROM PUBLIC, anon` NO ALCANZA: Supabase otorga EXECUTE a `authenticated` sobre
-- las funciones nuevas de `public` mediante ALTER DEFAULT PRIVILEGES, como grant DIRECTO, y
-- un REVOKE a PUBLIC no lo toca. Ese error ya se cometió en `20260826200000` y dejó abierta
-- una vía para que cualquier usuario con sesión borrara las órdenes de otro restaurante.
-- Por eso aquí se revoca explícitamente a `authenticated`, y se comprueba con
-- `has_function_privilege` en vez de suponerlo.
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.pos_cleanup_operations enable row level security;
-- Sin políticas: `anon` y `authenticated` obtienen cero filas. `service_role` tiene
-- rolbypassrls, así que la ruta sigue funcionando.
revoke all on table public.pos_cleanup_operations from public, anon, authenticated;
grant select on table public.pos_cleanup_operations to service_role;

revoke all on public.pos_cleanup_atoradas from public, anon, authenticated;
grant select on public.pos_cleanup_atoradas to service_role;

revoke all on function public.r1_cleanup_begin(text,text,text,text,text,text,text,integer,jsonb) from public, anon, authenticated;
revoke all on function public.r1_cleanup_commit(text,text)  from public, anon, authenticated;
revoke all on function public.r1_cleanup_fail(text,text)    from public, anon, authenticated;
revoke all on function public.r1_cleanup_restore(text)      from public, anon, authenticated;

grant execute on function public.r1_cleanup_begin(text,text,text,text,text,text,text,integer,jsonb) to service_role;
grant execute on function public.r1_cleanup_commit(text,text)  to service_role;
grant execute on function public.r1_cleanup_fail(text,text)    to service_role;
grant execute on function public.r1_cleanup_restore(text)      to service_role;

comment on function public.r1_cleanup_begin   is 'Fase 1: registra la intención y el respaldo en su propia transacción. Sin esto no se puede borrar.';
comment on function public.r1_cleanup_commit  is 'Fase 2: bloquea por operation_id, valida tenant/digest/conteo, borra sólo ese tenant y deja COMMITTED en la misma transacción.';
comment on function public.r1_cleanup_fail    is 'Fase 3: marca FAILED en una transacción posterior. Nunca degrada un COMMITTED.';
comment on function public.r1_cleanup_restore is 'Repone las órdenes desde el respaldo de una operación COMMITTED, verificando su SHA-256 antes.';
