-- Coaching de IA: evidencia humana versionable, no entrenamiento automático en producción.
-- La ruta de servidor valida tenant y actor antes de escribir. No se otorga acceso directo
-- al navegador a las correcciones: contienen conversaciones y criterio del coach.

alter table public.chat_logs
  add column if not exists veredicto text,
  add column if not exists veredicto_nota text,
  add column if not exists veredicto_por text,
  add column if not exists veredicto_at timestamptz;

alter table public.chat_logs
  drop constraint if exists chat_logs_veredicto_check;

alter table public.chat_logs
  add constraint chat_logs_veredicto_check
  check (veredicto is null or veredicto in ('useful', 'not_useful'));

create table if not exists public.chat_coaching_feedback (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  chat_log_id uuid not null references public.chat_logs(id) on delete cascade,
  coach_user_id text not null,
  verdict text not null check (verdict in ('useful', 'not_useful')),
  category text not null default 'general'
    check (category in ('general', 'wrong_fact', 'missing_data', 'not_actionable', 'unsafe')),
  correction text,
  status text not null default 'queued'
    check (status in ('queued', 'reviewed', 'adopted', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  constraint chat_coaching_feedback_correction_length
    check (correction is null or char_length(correction) <= 1200)
);

create index if not exists chat_coaching_feedback_client_created_idx
  on public.chat_coaching_feedback (client_id, created_at desc);

create index if not exists chat_coaching_feedback_status_created_idx
  on public.chat_coaching_feedback (status, created_at asc);

alter table public.chat_coaching_feedback enable row level security;

-- Sólo el servidor puede leer o escribir coaching. service_role se usa únicamente después
-- de requireTenant en la ruta; anon/authenticated no reciben grants para leer correcciones
-- de otros operadores por accidente.
revoke all on table public.chat_coaching_feedback from anon, authenticated;
grant all on table public.chat_coaching_feedback to service_role;
