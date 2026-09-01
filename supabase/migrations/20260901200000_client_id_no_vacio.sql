-- Ninguna fila operativa puede quedar sin restaurante.
--
-- HALLAZGO 2026-09-01: al hacer el backfill del dia de venta quedaron 7 ordenes sin
-- procesar. Todas tenian `client_id = ''` — cadena vacia. Data huerfana: ordenes que
-- no pertenecen a ningun restaurante. Barriendo el resto de las tablas del POS
-- aparecieron 1 turno, 1 registro de auditoria y 1 de asistencia igual. Diez filas en
-- total, todas historicas.
--
-- ORIGEN
--
-- `getActiveClientSlug()` termina asi:
--
--   return process.env.NEXT_PUBLIC_DEFAULT_CLIENT_ID || ''
--
-- O sea que FALLA ABIERTO: sin mapeo devuelve cadena vacia en vez de negarse. Y
-- `save-order` usa `auth.clientId` —correcto, autoridad del servidor— pero nunca
-- valida que no venga vacio.
--
-- POR QUE VA EN LA BASE Y NO EN CADA LLAMADA
--
-- Hay varios caminos de escritura: el endpoint, el proxy autenticado y el replay de
-- la cola offline. Parchear uno deja los otros abiertos. Aqui se cierra pase lo que
-- pase, sin depender de que el proximo que escriba una ruta se acuerde.
--
-- NOT VALID
--
-- Aplica a escrituras NUEVAS y no revisa la historia. Sin eso, crear la restriccion
-- fallaria por esas diez filas. No se renumera ni se borra nada: no corresponde
-- inventarle restaurante a una orden ajena.
--
-- VERIFICADO EN STAGING ANTES DE PRODUCCION
--
--   cadena vacia   -> rechazada
--   NULL           -> la columna ya era NOT NULL
--   cliente valido -> pasa normal
--
-- (La tercera prueba fallo en el primer intento por `pos_orders_turno_id_check`: la
-- fila de prueba no traia turno_id. No era esta restriccion.)
--
-- DERIVA ENTRE ENTORNOS: `pos_sessions` NO existe en staging pero si en produccion.
-- Es la segunda deriva encontrada hoy; la otra fue el trigger `trg_pos_order_number`,
-- que produccion tenia y staging no. Por eso el bloque atrapa `undefined_table` y
-- sigue en vez de abortar.

do $$
declare t text;
begin
  foreach t in array array['pos_orders','pos_turnos','pos_cierres','pos_cash_movements',
                           'pos_audit_log','pos_sessions','pos_attendance','delivery_orders']
  loop
    begin
      execute format('alter table public.%I drop constraint if exists %I', t, t||'_client_id_no_vacio');
      execute format('alter table public.%I add constraint %I check (coalesce(client_id, '''') <> '''') not valid',
                     t, t||'_client_id_no_vacio');
    exception when undefined_table then
      raise notice 'tabla % no existe en este entorno, se omite', t;
    end;
  end loop;
end $$;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- do $$ declare t text; begin
--   foreach t in array array['pos_orders','pos_turnos','pos_cierres','pos_cash_movements',
--                            'pos_audit_log','pos_sessions','pos_attendance','delivery_orders'] loop
--     execute format('alter table public.%I drop constraint if exists %I', t, t||'_client_id_no_vacio');
--   end loop; end $$;
