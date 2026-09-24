-- Datos SINTÉTICOS. Ningún PIN, nombre, usuario ni restaurante real.
-- Dos restaurantes (tenant-a, tenant-b) y los actores de la matriz:
--   0…0a1  sin membresía
--   0…0a2  miembro básico de tenant-a (rol viewer del dashboard)
--   0…0a3  gerente de tenant-a
--   0…0a4  dueño de tenant-a
--   0…0b5  act-as vigente sobre tenant-b (10 min)
--   0…0b6  act-as vencido sobre tenant-b (61 min)
--   0…0b7  act-as con fecha futura sobre tenant-b

insert into public.client_users (user_id, client_id, role, created_at) values
  ('00000000-0000-0000-0000-0000000000a2', 'tenant-a', 'viewer',         now() - interval '300 days'),
  ('00000000-0000-0000-0000-0000000000a3', 'tenant-a', 'gerente',        now() - interval '300 days'),
  ('00000000-0000-0000-0000-0000000000a4', 'tenant-a', 'dueño',          now() - interval '300 days'),
  ('00000000-0000-0000-0000-0000000000b5', 'tenant-b', 'platform_actas', now() - interval '10 minutes'),
  ('00000000-0000-0000-0000-0000000000b6', 'tenant-b', 'platform_actas', now() - interval '61 minutes'),
  ('00000000-0000-0000-0000-0000000000b7', 'tenant-b', 'platform_actas', now() + interval '5 minutes');

insert into public.pos_staff (id, client_id, name, pin, role) values
  ('a-mesero',  'tenant-a', 'Mesero sintetico A',  '4101', 'mesero'),
  ('a-gerente', 'tenant-a', 'Gerente sintetico A', '4102', 'gerente'),
  ('b-mesero',  'tenant-b', 'Mesero sintetico B',  '4201', 'mesero'),
  ('b-admin',   'tenant-b', 'Admin sintetico B',   '4202', 'admin');

insert into public.ventas_sinteticas (client_id, total) values ('tenant-a', 100), ('tenant-b', 200);
