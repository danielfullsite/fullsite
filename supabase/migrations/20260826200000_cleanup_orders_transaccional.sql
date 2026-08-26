-- Limpieza total de órdenes: transaccional, idempotente y con respaldo recuperable.
--
-- POR QUÉ EXISTE
--
-- El 2026-08-25 a las 20:49:03 (Monterrey) un DELETE se llevó las órdenes de AMALAY. Todo
-- apunta a /api/pos/admin/cleanup-orders —es la única ruta que produce esa firma— aunque no
-- se pudo correlacionar con una petición concreta. La ruta hacía lo que debía —confirmación
-- literal, digest contra respaldo, guardián por tenant y nombre— pero **no dejó rastro**, y
-- el resultado fue
-- indistinguible de una pérdida de datos: `pos_orders` vacío contra 303 operaciones
-- `COMMITTED` en `pos_save_operations`. Sólo se pudo reconstruir por los registros de
-- Supabase, que caducan a las 24 h.
--
-- El primer arreglo escribía la auditoría DESPUÉS del borrado, con `try/catch`. Eso
-- reproduce el defecto: si la escritura falla, el borrado vuelve a ser invisible. Un
-- registro *best-effort* de una acción destructiva no es un registro.
--
-- QUÉ CAMBIA
--
-- El borrado y su constancia ocurren en **la misma transacción**. O quedan los dos, o no
-- queda ninguno. Y la operación lleva `operation_id`, así que un reintento devuelve el
-- resultado anterior en vez de volver a borrar.
--
-- Reversión: DROP FUNCTION public.r1_cleanup_orders(...);  DROP TABLE pos_cleanup_operations;
-- La tabla es aditiva y nada existente depende de ella.

-- ─────────────────────────────────────────────────────────────────────────────
-- Libro de operaciones destructivas
--
-- Mismo patrón que `pos_save_operations`, que ya resolvió este problema para el guardado
-- de órdenes. La diferencia: aquí el respaldo se guarda COMPLETO, porque el objetivo es
-- poder restaurar sin depender de que alguien conservara el archivo que descargó.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pos_cleanup_operations (
  operation_id     text PRIMARY KEY,
  client_id        text NOT NULL,
  state            text NOT NULL CHECK (state IN ('STARTED','COMMITTED','FAILED')),

  -- quién y por qué
  actor            text NOT NULL,
  staff_id         text,
  role             text,
  reason           text,

  -- qué se esperaba borrar
  backup_digest    text NOT NULL,
  expected_count   integer NOT NULL,

  -- qué se borró, y el respaldo para poder devolverlo
  deleted_count    integer,
  backup           jsonb,
  failure_detail   text,

  started_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);

CREATE INDEX IF NOT EXISTS pos_cleanup_operations_cliente_idx
  ON public.pos_cleanup_operations (client_id, started_at DESC);

-- Un STARTED sin resolver significa que la transacción murió a media operación.
-- No debería existir nunca; si aparece, hay que mirarlo.
CREATE INDEX IF NOT EXISTS pos_cleanup_operations_atoradas_idx
  ON public.pos_cleanup_operations (started_at) WHERE state = 'STARTED';

ALTER TABLE public.pos_cleanup_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_cleanup_operations FROM PUBLIC, anon;
GRANT SELECT ON public.pos_cleanup_operations TO authenticated, service_role;

COMMENT ON TABLE public.pos_cleanup_operations IS
  'Libro de borrados totales de órdenes. Cada fila es atómica con su borrado: si existe COMMITTED, el borrado ocurrió; si no existe fila, no ocurrió.';

-- ─────────────────────────────────────────────────────────────────────────────
-- La operación
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.r1_cleanup_orders(
  p_client_id      text,
  p_operation_id   text,
  p_actor          text,
  p_staff_id       text,
  p_role           text,
  p_backup_digest  text,
  p_expected_count integer,
  p_reason         text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_previa    record;
  v_respaldo  jsonb;
  v_actual    integer;
  v_borradas  integer;
BEGIN
  IF p_operation_id IS NULL OR p_operation_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OPERATION_ID_REQUERIDO');
  END IF;

  -- ── Reintento seguro ──────────────────────────────────────────────────────
  -- Misma operación = mismo resultado, sin volver a borrar. Esto es lo que hace
  -- innecesario interpretar un 500: reintentar es gratis y no destruye nada.
  SELECT * INTO v_previa FROM pos_cleanup_operations WHERE operation_id = p_operation_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', v_previa.state = 'COMMITTED',
      'replay', true,
      'state', v_previa.state,
      'deleted', v_previa.deleted_count,
      'error', v_previa.failure_detail,
      'operation_id', p_operation_id
    );
  END IF;

  -- ── Constancia de inicio ──────────────────────────────────────────────────
  -- Va antes de tocar nada. Si algo revienta después, queda un STARTED que delata
  -- la interrupción en vez de un silencio.
  INSERT INTO pos_cleanup_operations (
    operation_id, client_id, state, actor, staff_id, role, reason,
    backup_digest, expected_count
  ) VALUES (
    p_operation_id, p_client_id, 'STARTED', p_actor, p_staff_id, p_role, p_reason,
    p_backup_digest, p_expected_count
  );

  -- ── Respaldo dentro de la transacción ─────────────────────────────────────
  -- El respaldo se toma aquí, no en el cliente: así lo que se guarda es exactamente
  -- lo que se borra, sin ventana entre una cosa y la otra.
  SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY o.created_at), '[]'::jsonb), count(*)
    INTO v_respaldo, v_actual
  FROM pos_orders o WHERE o.client_id = p_client_id;

  -- ── Control de concurrencia ───────────────────────────────────────────────
  IF v_actual <> p_expected_count THEN
    UPDATE pos_cleanup_operations SET
      state = 'FAILED', completed_at = now(),
      failure_detail = format('CONTEO_CAMBIO: esperado %s, actual %s', p_expected_count, v_actual)
    WHERE operation_id = p_operation_id;
    RETURN jsonb_build_object('ok', false, 'state', 'FAILED',
      'error', 'CONTEO_CAMBIO', 'expected', p_expected_count, 'current', v_actual,
      'operation_id', p_operation_id);
  END IF;

  -- ── El borrado ────────────────────────────────────────────────────────────
  DELETE FROM pos_orders WHERE client_id = p_client_id;
  GET DIAGNOSTICS v_borradas = ROW_COUNT;

  -- ── Constancia final, en la MISMA transacción que el borrado ──────────────
  -- Ésta es la propiedad que el arreglo anterior no tenía: no hay forma de que el
  -- borrado quede y el registro no. O ambos, o ninguno.
  UPDATE pos_cleanup_operations SET
    state = 'COMMITTED', deleted_count = v_borradas,
    backup = v_respaldo, completed_at = now()
  WHERE operation_id = p_operation_id;

  RETURN jsonb_build_object('ok', true, 'state', 'COMMITTED',
    'deleted', v_borradas, 'replay', false, 'operation_id', p_operation_id);
END;
$$;

REVOKE ALL ON FUNCTION public.r1_cleanup_orders(text,text,text,text,text,text,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.r1_cleanup_orders(text,text,text,text,text,text,integer,text) TO service_role;

COMMENT ON FUNCTION public.r1_cleanup_orders IS
  'Borrado total de órdenes de un tenant. Atómico con su registro, idempotente por operation_id, con respaldo completo en la propia fila.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Restauración desde el respaldo guardado
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.r1_cleanup_restore(p_operation_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_op        record;
  v_repuestas integer;
BEGIN
  SELECT * INTO v_op FROM pos_cleanup_operations WHERE operation_id = p_operation_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OPERACION_NO_ENCONTRADA');
  END IF;
  IF v_op.state <> 'COMMITTED' OR v_op.backup IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SIN_RESPALDO_UTILIZABLE', 'state', v_op.state);
  END IF;

  -- Sólo repone lo que falta. Si una orden volvió a existir, no se pisa.
  INSERT INTO pos_orders
  SELECT * FROM jsonb_populate_recordset(NULL::pos_orders, v_op.backup) AS r
  WHERE NOT EXISTS (SELECT 1 FROM pos_orders o WHERE o.id = r.id);
  GET DIAGNOSTICS v_repuestas = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'restored', v_repuestas,
    'del_respaldo', jsonb_array_length(v_op.backup), 'operation_id', p_operation_id);
END;
$$;

REVOKE ALL ON FUNCTION public.r1_cleanup_restore(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.r1_cleanup_restore(text) TO service_role;

COMMENT ON FUNCTION public.r1_cleanup_restore IS
  'Repone las órdenes de un borrado COMMITTED desde su propio respaldo. No pisa órdenes que ya existan.';
