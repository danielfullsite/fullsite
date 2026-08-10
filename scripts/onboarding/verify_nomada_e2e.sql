-- Client #2 (Café Nómada) — verificación E2E + aislamiento en staging. Read-only.
-- Uso: correr contra supabase-fullsite-staging. Exit rows = 1 objeto JSON con todo el estado.
select json_build_object(
 'tenant', (select json_build_object('id',id,'name',display_name,'mesas',mesas) from clients where id='nomada'),
 'provisioning', json_build_object(
   'staff',(select count(*) from pos_staff where client_id='nomada'),
   'payment_methods',(select count(*) from pos_payment_methods where client_id='nomada'),
   'menu_categories',(select count(*) from pos_menu_categories where client_id='nomada'),
   'menu_items',(select count(*) from pos_menu_items where client_id='nomada'),
   'ingredients',(select count(*) from pos_ingredients where client_id='nomada'),
   'mesas',(select count(*) from pos_mesas where client_id='nomada'),
   'login_user',(select email from auth.users where email='owner@nomada.staging')),
 'e2e_flow', json_build_object(
   'turno_abierto_por',(select opened_by from pos_turnos where client_id='nomada' order by opened_at desc limit 1),
   'fondo_inicial',(select fondo_inicial from pos_turnos where client_id='nomada' order by opened_at desc limit 1),
   'ordenes_cobradas',(select count(*) from pos_orders where client_id='nomada' and status='cobrada'),
   'items_cocina_listos',(select count(*) from pos_orders o, jsonb_each_text(o.kds_item_status) k where o.client_id='nomada' and k.value='listo'),
   'ventas_efectivo',(select coalesce(sum(total),0) from pos_orders where client_id='nomada' and metodo_pago='efectivo'),
   'ventas_tarjeta',(select coalesce(sum(total),0) from pos_orders where client_id='nomada' and metodo_pago='tarjeta'),
   'ventas_total',(select coalesce(sum(total),0) from pos_orders where client_id='nomada'),
   'corte_efectivo_esperado',(select efectivo_sistema from pos_turnos where client_id='nomada' order by opened_at desc limit 1),
   'corte_diferencia',(select diferencia from pos_turnos where client_id='nomada' order by opened_at desc limit 1)),
 'isolation', json_build_object(
   'amalay_en_staging',(select count(*) from clients where id='amalay'),
   'amalay_waiters',(select count(*) from pos_orders where mesero in ('Omar Aguilera','Hector Enrique Rodriguez Lopez')),
   'otros_tenants',(select count(distinct client_id) from pos_orders where client_id<>'nomada'))
) as client2_evidence;
