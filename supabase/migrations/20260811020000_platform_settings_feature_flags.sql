-- Control Plane · Fase 2: capa GLOBAL-PLATAFORMA (cae a TODOS los tenants).
-- platform_settings (key/value versionado) + feature_flags (por-todos / por-cohorte).
-- Modelo de lectura: TODOS los tenants LEEN (config global no sensible) → un cambio del admin
-- se refleja en todos. ESCRITURA: solo service_role (endpoints /api/platform/* server-side).
-- RLS: SELECT abierto (true); sin policies de write → anon/authenticated NO pueden escribir;
-- service_role bypassa RLS. Validar en staging (jkcnxfbb). NO DDL a prod.

create table if not exists public.platform_settings (
  key         text primary key,
  value       jsonb       not null default '{}'::jsonb,
  version     integer     not null default 1,
  description text,
  updated_by  text,
  updated_at  timestamptz not null default now()
);
alter table public.platform_settings enable row level security;
drop policy if exists platform_settings_read on public.platform_settings;
create policy platform_settings_read on public.platform_settings for select using (true);

create table if not exists public.feature_flags (
  key         text primary key,
  enabled     boolean     not null default false,
  description text,
  rollout     jsonb       not null default '{"cohort":"all"}'::jsonb,  -- {"cohort":"all"} | {"client_ids":[...]} | {"percentage":N}
  updated_by  text,
  updated_at  timestamptz not null default now()
);
alter table public.feature_flags enable row level security;
drop policy if exists feature_flags_read on public.feature_flags;
create policy feature_flags_read on public.feature_flags for select using (true);

-- Semillas globales de demostración (idempotentes).
insert into public.feature_flags (key, enabled, description, rollout) values
  ('new_pos_ui',      true,  'Rediseño DS v2 del POS/Dashboard', '{"cohort":"all"}'::jsonb),
  ('online_ordering', false, 'Pedidos en línea (ecommerce)',     '{"cohort":"all"}'::jsonb)
on conflict (key) do nothing;

insert into public.platform_settings (key, value, description) values
  ('announcement', '{"text":"","active":false}'::jsonb, 'Anuncio global mostrado a todos los tenants'),
  ('support_url',  '{"url":"https://fullsite.mx/soporte"}'::jsonb, 'URL de soporte global')
on conflict (key) do nothing;
