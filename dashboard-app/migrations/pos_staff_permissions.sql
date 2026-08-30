-- Permisos por empleado (estilo Square/Toast). Override OPCIONAL sobre el rol:
-- si un empleado tiene fila aquí, sections manda; si no, canAccessPage cae al rol.
-- Aditivo: nace vacío → nadie pierde acceso al desplegar.
-- Diseño: docs/product/PERMISOS-POR-EMPLEADO-DESIGN.md
-- Estado: APLICADA EN STAGING 2026-08-30. PROD pendiente de OK de Daniel.
--         El código es tolerante: sin la tabla, permissions queda undefined y
--         canAccessPage usa el rol (comportamiento actual).

create table if not exists pos_staff_permissions (
  client_id  text not null,
  staff_id   text not null,
  sections   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (client_id, staff_id)
);

alter table pos_staff_permissions enable row level security;

-- Lectura: miembros del tenant. Escritura: solo service_role (endpoint gateado).
drop policy if exists staff_perms_read on pos_staff_permissions;
create policy staff_perms_read on pos_staff_permissions for select
  using (private.user_has_client_access(client_id));
