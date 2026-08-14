-- Increment 3 — Provisioning por código (consola de flota /platform → máquina)
-- Aplicar en PROD (Supabase qjiomlvudfmzuvqvhwpk). El MCP amalay es read-only,
-- así que corre esto en el SQL Editor de Supabase con permisos de admin.
--
-- Flujo: el admin (daniel@fullsite.mx) crea la config de una terminal en
-- /platform/terminals → se genera un CÓDIGO corto. La máquina nueva abre el
-- wizard → "Provisionar con código" → captura el código → jala TODO su config
-- de la nube (client_id, rol, IP del server, estación KDS, local_ui) → se guarda
-- y arranca. Cero JSON a mano. Escala a 10k+.

create table if not exists provisioning_tokens (
  code                  text primary key,           -- código corto legible, ej. ABC3-9XQ2
  client_id             text not null,              -- tenant (restaurant_id)
  terminal_role         text not null,              -- server_pos | pos | kds | admin
  terminal_name         text not null,              -- ej. "Caja Principal", "KDS Cocina"
  pos_server_ip         text,                       -- IP de la CAJA (para pos/kds); null en server_pos
  kds_station           text,                       -- cocina | barra (solo kds)
  local_ui              boolean not null default true,
  created_by            text,                       -- email del admin que lo generó
  created_at            timestamptz not null default now(),
  expires_at            timestamptz,                -- opcional (null = no expira)
  redeemed_at           timestamptz,                -- null = sin usar
  redeemed_by_terminal  text                        -- terminal_id que lo canjeó
);

create index if not exists idx_provisioning_tokens_client on provisioning_tokens (client_id);
create index if not exists idx_provisioning_tokens_unredeemed on provisioning_tokens (redeemed_at) where redeemed_at is null;

-- Seguridad: RLS ON sin políticas → anon/authenticated NO acceden. Solo el
-- service_role (endpoints server: /api/platform/terminals y /api/pos/provision)
-- lo lee/escribe. El código en sí es el secreto de un solo uso.
alter table provisioning_tokens enable row level security;

-- (service_role bypassa RLS por definición; el grant explícito es defensivo.)
grant select, insert, update on provisioning_tokens to service_role;
