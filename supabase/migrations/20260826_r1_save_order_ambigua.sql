-- r1_save_order: quitar la sobrecarga ambigua y versionar la función buena.
--
-- EL PROBLEMA
-- Producción tenía DOS r1_save_order con los MISMOS nombres de parámetro,
-- diferenciadas sólo en el tipo de p_mesa (integer vs text). PostgREST resuelve
-- las sobrecargas por el conjunto de NOMBRES del payload, no por tipos, así que
-- no podía elegir y devolvía PGRST203 en TODA llamada. La ruta
-- /api/pos/save-order autenticaba, escribía la auditoría, llamaba al RPC, y ahí
-- moría: 232 órdenes de AMALAY en pos_audit_log, 7 en pos_orders.
--
-- Staging tenía una sola (la de integer) y por eso las pruebas nunca lo vieron.
-- Ninguna migración del repo definía la función: se creó a mano en la base.
--
-- LA TRAMPA, para que nadie la repita
-- La sobrecarga de `text` NO era una copia vieja: era la MÁS NUEVA. Traía un
-- manejador de unique_violation que la de integer no tiene, y las banderas
-- first_execution / idempotent_replay. Borrarla sin más habría perdido el
-- arreglo de concurrencia (escenario T-19: tres POS sobre la misma mesa).
--
-- Pero su p_mesa era `text` contra una columna `pos_orders.mesa` que es
-- `integer`, así que aunque PostgREST la hubiera elegido, el INSERT tronaba.
--
-- LA SOLUCIÓN
-- Una sola función, con el tipo correcto (integer, como la columna) y la lógica
-- buena de la otra. Los tres pasos juntos: portar, borrar, versionar.

-- 1) Fuera la ambigua. `if exists` para que sea idempotente y corra igual en
--    staging (que nunca la tuvo) y en producción.
drop function if exists public.r1_save_order(
  text, text, bigint, text, text, text, integer, text,
  numeric, numeric, numeric, numeric, numeric, text, jsonb,
  text, text, jsonb, timestamptz
);

-- 2) La buena: tipo correcto + lógica portada.
create or replace function public.r1_save_order(
  p_client_id        text,
  p_order_id         text,
  p_expected_revision bigint,
  p_mesa             integer     default null,
  p_customer_name    text        default null,
  p_mesero           text        default null,
  p_personas         integer     default null,
  p_status           text        default null,
  p_subtotal         numeric     default null,
  p_iva              numeric     default null,
  p_total            numeric     default null,
  p_descuento        numeric     default null,
  p_propina          numeric     default null,
  p_metodo_pago      text        default null,
  p_pagos            jsonb       default null,
  p_turno_id         text        default null,
  p_notas            text        default null,
  p_items            jsonb       default null,
  p_closed_at        timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_new_revision     bigint;
  v_current_revision bigint;
  v_exists           boolean;
begin
  -- Guardián de tenant. Sin esto una terminal podría escribir en otro restaurante.
  if not private.can_write_client(p_client_id) then
    return jsonb_build_object('ok', false, 'revision', null, 'conflict', false,
      'error', 'FORBIDDEN_CLIENT');
  end if;

  select exists(select 1 from pos_orders where id = p_order_id and client_id = p_client_id)
  into v_exists;

  if not v_exists and p_expected_revision = 0 then
    begin
      insert into pos_orders (
        id, client_id, mesa, customer_name, mesero, personas, status,
        subtotal, iva, total, descuento, propina, metodo_pago, pagos,
        turno_id, notas, items, closed_at, order_revision
      ) values (
        p_order_id, p_client_id, p_mesa, p_customer_name, p_mesero, p_personas,
        coalesce(p_status, 'abierta'), coalesce(p_subtotal, 0), coalesce(p_iva, 0),
        coalesce(p_total, 0), coalesce(p_descuento, 0), coalesce(p_propina, 0),
        p_metodo_pago, p_pagos, p_turno_id, p_notas, p_items, p_closed_at, 1
      );
      return jsonb_build_object('ok', true, 'revision', 1, 'conflict', false,
        'first_execution', true, 'idempotent_replay', false);

    -- Dos terminales offline insertando la misma orden a la vez. Sin este bloque
    -- la segunda revienta con un error de Postgres en vez de devolver el
    -- conflicto que la UI sabe resolver. Es el escenario T-19 de la matriz.
    exception when unique_violation then
      select order_revision into v_current_revision
      from pos_orders where id = p_order_id and client_id = p_client_id;
      return jsonb_build_object('ok', false, 'revision', v_current_revision, 'conflict', true,
        'error', 'STALE_WRITE_REJECTED',
        'expected_revision', 0,
        'current_revision', v_current_revision);
    end;
  end if;

  if not v_exists then
    return jsonb_build_object('ok', false, 'revision', null, 'conflict', false,
      'error', 'ORDER_NOT_FOUND');
  end if;

  update pos_orders set
    mesa           = coalesce(p_mesa, mesa),
    customer_name  = coalesce(p_customer_name, customer_name),
    mesero         = coalesce(p_mesero, mesero),
    personas       = coalesce(p_personas, personas),
    status         = coalesce(p_status, status),
    subtotal       = coalesce(p_subtotal, subtotal),
    iva            = coalesce(p_iva, iva),
    total          = coalesce(p_total, total),
    descuento      = coalesce(p_descuento, descuento),
    propina        = coalesce(p_propina, propina),
    metodo_pago    = coalesce(p_metodo_pago, metodo_pago),
    pagos          = coalesce(p_pagos, pagos),
    turno_id       = coalesce(p_turno_id, turno_id),
    notas          = coalesce(p_notas, notas),
    items          = coalesce(p_items, items),
    closed_at      = coalesce(p_closed_at, closed_at),
    order_revision = order_revision + 1
  where id = p_order_id
    and client_id = p_client_id
    and order_revision = p_expected_revision
  returning order_revision into v_new_revision;

  if v_new_revision is not null then
    return jsonb_build_object('ok', true, 'revision', v_new_revision, 'conflict', false,
      'first_execution', true, 'idempotent_replay', false);
  end if;

  select order_revision into v_current_revision
  from pos_orders where id = p_order_id and client_id = p_client_id;

  return jsonb_build_object('ok', false, 'revision', v_current_revision, 'conflict', true,
    'error', 'STALE_WRITE_REJECTED',
    'expected_revision', p_expected_revision,
    'current_revision', v_current_revision);
end;
$function$;
