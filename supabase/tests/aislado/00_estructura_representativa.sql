-- Estructura REPRESENTATIVA de producción para probar ocm_daily en un PostgreSQL aislado y vacío.
--
-- Copiada de lecturas sólo-lectura del catálogo de producción (proyecto AMALAY) el 2026-10-01:
--   * roles y sus atributos (anon, authenticated, service_role BYPASSRLS, fullsite_readonly,
--     fullsite_agent, ia_lector; ninguno de los fullsite_* ni ia_lector tiene BYPASSRLS);
--   * ACL de public.pos_orders, public.ops_daily y public.ocm_daily tal como están en producción;
--   * RLS activada en pos_orders y ops_daily con las MISMAS políticas (pg_policies);
--   * private.user_has_client_access e ia.tenant_sesion con su definición real;
--   * la vista ocm_daily ANTERIOR (pg_get_viewdef) con security_invoker = on.
-- Qué NO replica: triggers (trg_pos_order_number, trg_pos_orders_updated_at), el resto de las
-- ~30 tablas, las políticas reales de client_users (aquí hay dos de relleno; no influyen porque
-- user_has_client_access es SECURITY DEFINER), extensiones y el motor Supabase (PostgREST/JWT):
-- el JWT se simula con request.jwt.claims, que es lo que lee auth.uid().
-- Producción es PostgreSQL 17.6; esta prueba corre en la versión que se indique en el reporte.
--
-- Uso: psql contra una base VACÍA como superusuario. No usar contra producción.

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS ia;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='fullsite_readonly') THEN CREATE ROLE fullsite_readonly NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='fullsite_agent') THEN CREATE ROLE fullsite_agent NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ia_lector') THEN CREATE ROLE ia_lector NOLOGIN NOINHERIT; END IF;
END $$;

-- Uso de esquemas como en producción: auth para anon/authenticated/service_role; private sin USAGE
-- para nadie (las políticas guardan el OID de la función; el USAGE se comprueba al resolver el nombre).
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, fullsite_readonly, fullsite_agent, ia_lector;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.client_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, client_id text, role text,
  created_at timestamptz DEFAULT now());
GRANT SELECT ON public.client_users TO authenticated, service_role, fullsite_readonly, fullsite_agent;

CREATE OR REPLACE FUNCTION private.user_has_client_access(target_client_id text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'private'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NULL                 THEN false
    WHEN target_client_id IS NULL           THEN false
    WHEN target_client_id = ''              THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.user_id = auth.uid() AND cu.client_id = target_client_id
    )
  END;
$function$;
REVOKE ALL ON FUNCTION private.user_has_client_access(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.user_has_client_access(text) TO authenticated;

CREATE TABLE ia._sesion (pid int, client_id text, inicio timestamptz);
CREATE OR REPLACE FUNCTION ia.tenant_sesion() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog' AS $function$
  select client_id from ia._sesion where pid = pg_backend_pid() and inicio = now()
$function$;

CREATE TABLE public.pos_orders (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  client_id text, mesa integer, mesero text, personas integer, status text DEFAULT 'abierta',
  subtotal numeric, iva numeric, total numeric DEFAULT 0, descuento numeric, metodo_pago text,
  notas text, items jsonb, created_at timestamptz DEFAULT now(), closed_at timestamptz,
  propina numeric DEFAULT 0, updated_at timestamptz DEFAULT now(), location_id text,
  customer_name text, order_number integer, pagos jsonb, turno_id text, kds_item_status jsonb,
  order_revision bigint DEFAULT 0, last_inventory_processed_revision bigint DEFAULT 0,
  last_inventory_complete_revision bigint DEFAULT 0, comanda_batches jsonb,
  captured_at timestamptz, dia_venta date, payment_status text,
  CONSTRAINT orders_require_turno CHECK (turno_id IS NOT NULL),
  CONSTRAINT pos_orders_client_id_no_vacio CHECK (COALESCE(client_id, '') <> '') NOT VALID
);
CREATE TABLE public.ops_daily (
  client_id text, fecha date, record_type text, source_system text, ventas_dia numeric,
  ventas_brutas numeric, descuentos numeric, efectivo numeric, tarjeta numeric, tickets_count int,
  mesas_atendidas int, personas_restaurant int, ticket_promedio_restaurant numeric,
  propinas_total numeric, generated_at timestamptz);

-- ACL como producción (relacl leída el 2026-10-01)
REVOKE ALL ON public.pos_orders, public.ops_daily FROM PUBLIC;
GRANT ALL ON public.pos_orders, public.ops_daily TO authenticated, service_role;
GRANT SELECT, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.pos_orders TO anon;   -- anon = rDxtm
GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.ops_daily TO anon;            -- anon = Dxtm (sin SELECT)
GRANT SELECT ON public.pos_orders, public.ops_daily TO fullsite_readonly, fullsite_agent;

ALTER TABLE public.pos_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY cu_svc ON public.client_users FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY cu_self ON public.client_users FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY authread_ops_daily ON public.ops_daily FOR SELECT TO authenticated USING (private.user_has_client_access(client_id));
CREATE POLICY ia_lector_por_restaurante ON public.ops_daily FOR SELECT TO ia_lector USING (client_id = (SELECT ia.tenant_sesion()));
CREATE POLICY svc_ops_daily ON public.ops_daily FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY ia_lector_por_restaurante ON public.pos_orders FOR SELECT TO ia_lector USING (client_id = (SELECT ia.tenant_sesion()));
CREATE POLICY pos_orders_del ON public.pos_orders FOR DELETE TO authenticated USING (private.user_has_client_access(client_id));
CREATE POLICY pos_orders_ins ON public.pos_orders FOR INSERT TO authenticated WITH CHECK (private.user_has_client_access(client_id) AND (turno_id IS NOT NULL));
CREATE POLICY pos_orders_sel ON public.pos_orders FOR SELECT TO authenticated USING (private.user_has_client_access(client_id));
CREATE POLICY pos_orders_svc ON public.pos_orders FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY pos_orders_upd ON public.pos_orders FOR UPDATE TO authenticated USING (private.user_has_client_access(client_id)) WITH CHECK (private.user_has_client_access(client_id) AND (turno_id IS NOT NULL));

-- Vista ANTERIOR (pg_get_viewdef de producción, 2026-10-01)
CREATE VIEW public.ocm_daily AS
 WITH live AS NOT MATERIALIZED (
         SELECT o.client_id,
            (o.created_at AT TIME ZONE 'America/Monterrey'::text)::date AS fecha,
            'fullsite'::text AS source_system,
            sum(o.total) AS ventas_dia,
            sum(COALESCE(o.subtotal, 0::numeric) + COALESCE(o.iva, 0::numeric)) AS ventas_brutas,
            sum(COALESCE(o.descuento, 0::numeric)) AS descuentos,
            sum(CASE WHEN o.metodo_pago ~~* '%efec%'::text AND o.metodo_pago !~~* '%tarj%'::text THEN o.total ELSE 0::numeric END) AS efectivo,
            sum(CASE WHEN o.metodo_pago ~~* '%tarj%'::text AND o.metodo_pago !~~* '%efec%'::text THEN o.total ELSE 0::numeric END) AS tarjeta,
            count(*)::integer AS tickets_count,
            count(DISTINCT o.mesa)::integer AS mesas_atendidas,
            sum(COALESCE(o.personas, 0))::integer AS personas_restaurant,
            round(sum(o.total) / NULLIF(count(*), 0)::numeric, 2) AS ticket_promedio_restaurant,
            sum(COALESCE(o.propina, 0::numeric)) AS propinas_total,
            max(o.updated_at) AS generated_at
           FROM pos_orders o
          WHERE o.status = ANY (ARRAY['cerrada'::text, 'completada'::text])
          GROUP BY o.client_id, ((o.created_at AT TIME ZONE 'America/Monterrey'::text)::date)
        ), hist AS (
         SELECT DISTINCT ON (d.client_id, d.fecha) d.client_id, d.fecha,
            COALESCE(d.source_system, 'wansoft'::text) AS source_system,
            d.ventas_dia, d.ventas_brutas, d.descuentos, d.efectivo, d.tarjeta, d.tickets_count,
            d.mesas_atendidas, d.personas_restaurant, d.ticket_promedio_restaurant, d.propinas_total, d.generated_at
           FROM ops_daily d
          WHERE d.record_type = ANY (ARRAY['cierre'::text, 'cierre_wansoft'::text])
          ORDER BY d.client_id, d.fecha, d.generated_at DESC
        )
 SELECT live.client_id, live.fecha, live.source_system, live.ventas_dia, live.ventas_brutas, live.descuentos,
    live.efectivo, live.tarjeta, live.tickets_count, live.mesas_atendidas, live.personas_restaurant,
    live.ticket_promedio_restaurant, live.propinas_total, live.generated_at
   FROM live
UNION ALL
 SELECT h.client_id, h.fecha, h.source_system, h.ventas_dia, h.ventas_brutas, h.descuentos, h.efectivo,
    h.tarjeta, h.tickets_count, h.mesas_atendidas, h.personas_restaurant, h.ticket_promedio_restaurant,
    h.propinas_total, h.generated_at
   FROM hist h
  WHERE NOT (EXISTS ( SELECT 1 FROM live l WHERE l.client_id = h.client_id AND l.fecha = h.fecha));
ALTER VIEW public.ocm_daily SET (security_invoker = on);
REVOKE ALL ON public.ocm_daily FROM PUBLIC;
GRANT ALL ON public.ocm_daily TO authenticated, service_role;                                   -- arwdDxtm
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.ocm_daily TO anon; -- awdDxtm (sin SELECT)
GRANT SELECT ON public.ocm_daily TO fullsite_readonly, fullsite_agent;
