-- Client #2 synthetic restaurant "La Costa Verde" (id: lacosta) — DATA provisioning.
-- Target: STAGING Supabase jkcnxfbbuyyfhwfjizgw ONLY (sandbox.app.fullsite.mx). NEVER prod.
-- Idempotent. Mirrors the vantara sandbox recipe (features all-on, staff PIN, pay methods, menu, mesas).
-- Applied via the supabase-fullsite-staging MCP (migration: client2_lacosta_provision).
do $$
declare cid text := 'lacosta';
begin
  delete from pos_menu_items where client_id=cid;
  delete from pos_menu_categories where client_id=cid;
  delete from pos_mesas where client_id=cid;
  delete from pos_payment_methods where client_id=cid;
  delete from pos_staff where client_id=cid;
  delete from client_locations where client_id=cid;

  insert into clients (id, display_name, city, type, mesas, active, features, iva_rate, timezone,
                       data_source, accent_color, default_theme, receipt_footer, pos_write_authority)
  values (cid, 'La Costa Verde — Cliente #2 (sintético)', 'Monterrey', 'restaurant', 6, true,
          '{"kds":true,"pos":true,"cfdi":true,"staff":true,"agents":true,"recipes":true,"reports":true,
            "customers":true,"dashboard":true,"inventory":true,"suppliers":true,"reservaciones":true}'::jsonb,
          0.16, 'America/Monterrey', 'fullsite', 'sky', 'dark',
          'Gracias por su visita — La Costa Verde', 'supabase')
  on conflict (id) do update set display_name=excluded.display_name, active=true,
          features=excluded.features, accent_color=excluded.accent_color, default_theme=excluded.default_theme,
          receipt_footer=excluded.receipt_footer, data_source='fullsite', pos_write_authority='supabase';

  insert into client_locations (id, name, active, address, client_id)
  values ('lacosta-centro','Sucursal Centro', true, 'Av. Sintética 100, Centro, Monterrey, NL', cid)
  on conflict (id) do nothing;

  insert into pos_payment_methods (id, name, type, active, client_id, fiscal_code, commission_pct) values
    ('lacosta-pm-efectivo','Efectivo','cash',true,cid,'01',0),
    ('lacosta-pm-tdc','Tarjeta de crédito','card',true,cid,'04',0),
    ('lacosta-pm-tdd','Tarjeta de débito','card',true,cid,'28',0),
    ('lacosta-pm-transfer','Transferencia','transfer',true,cid,'03',0);

  insert into pos_staff (id, pin, name, role, active, client_id, hourly_rate, role_display, weekly_salary) values
    ('lacosta-staff-owner','1001','Ana Dueña','dueño',true,cid,0,'Dueño',0),
    ('lacosta-staff-gerente','1002','Beto Gerente','gerente',true,cid,0,'Gerente',0),
    ('lacosta-staff-cajero','1003','Carla Cajera','cajero',true,cid,0,'Cajero',0),
    ('lacosta-staff-mesero','1004','Diego Mesero','mesero',true,cid,0,'Mesero',0);

  insert into pos_menu_categories (id, name, color, active, client_id, sort_order) values
    ('lacosta-cat-entradas','Entradas','bg-sky-600',true,cid,1),
    ('lacosta-cat-fuertes','Platos Fuertes','bg-sky-700',true,cid,2),
    ('lacosta-cat-bebidas','Bebidas','bg-cyan-600',true,cid,3);

  insert into pos_menu_items (id, name, price, active, client_id, aplica_2x1, sort_order, category_id, aplica_cortesia, aplica_descuento) values
    ('lacosta-item-ceviche','Ceviche de la casa',145,true,cid,false,1,'lacosta-cat-entradas',true,true),
    ('lacosta-item-guacamole','Guacamole tradicional',110,true,cid,false,2,'lacosta-cat-entradas',true,true),
    ('lacosta-item-pescado','Pescado a la talla',285,true,cid,false,1,'lacosta-cat-fuertes',true,true),
    ('lacosta-item-camarones','Camarones al ajillo',265,true,cid,false,2,'lacosta-cat-fuertes',true,true),
    ('lacosta-item-tacos','Tacos de pescado (3)',135,true,cid,false,3,'lacosta-cat-fuertes',true,true),
    ('lacosta-item-limonada','Limonada natural',55,true,cid,false,1,'lacosta-cat-bebidas',true,true),
    ('lacosta-item-agua','Agua de horchata',50,true,cid,false,2,'lacosta-cat-bebidas',true,true);

  insert into pos_mesas (id, number, capacity, active, client_id, sort_order, shape, x_pct, y_pct, location_id, public_token, token_active)
  select gen_random_uuid(), n, 4, true, cid, n-1, 'round', (10+n*12)%90, 20+((n*15)%60), 'lacosta-centro',
         encode(gen_random_bytes(24),'hex'), true
  from generate_series(1,6) as n;
end $$;
