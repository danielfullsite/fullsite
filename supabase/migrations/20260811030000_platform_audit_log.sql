-- Control Plane · Fase 4: audit log INMUTABLE de cada acción del super-admin.
-- Registra quién, qué, cuándo, qué tenant y alcance (global/tenant). Append-only:
--   - Sólo se INSERTA vía service_role desde /api/platform/* (RLS sin policies → anon/authenticated denegados).
--   - UPDATE y DELETE bloqueados por trigger para TODOS (incl. service_role) → inmutable.
-- Validar en staging (jkcnxfbb). NO DDL a prod.

create table if not exists public.platform_audit_log (
  id             bigint generated always as identity primary key,
  actor_email    text        not null,
  actor_user_id  uuid,
  action         text        not null,               -- ej. 'flag.update', 'tenant.create', 'announcement.push'
  scope          text        not null default 'tenant' check (scope in ('global','tenant')),
  target_tenant  text,                                -- null en acciones globales
  detail         jsonb       not null default '{}'::jsonb,
  affected_count integer,                             -- N de tenants afectados (acciones globales)
  created_at     timestamptz not null default now()
);

alter table public.platform_audit_log enable row level security;
-- Sin policies: sólo service_role (bypassa RLS) puede insertar desde el servidor.

create or replace function public.platform_audit_log_immutable() returns trigger
  language plpgsql as $$
begin
  raise exception 'platform_audit_log es append-only (inmutable): % no permitido', tg_op;
end $$;

drop trigger if exists platform_audit_log_no_mutate on public.platform_audit_log;
create trigger platform_audit_log_no_mutate
  before update or delete on public.platform_audit_log
  for each row execute function public.platform_audit_log_immutable();

create index if not exists platform_audit_log_created_idx on public.platform_audit_log (created_at desc);
create index if not exists platform_audit_log_tenant_idx  on public.platform_audit_log (target_tenant);
