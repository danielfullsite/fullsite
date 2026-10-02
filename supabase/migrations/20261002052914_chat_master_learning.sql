-- Aprendizaje maestro: catálogo agregado de patrones operativos reutilizables.
-- No guarda client_id, usuario, conversación, ventas ni correcciones de un restaurante.
-- Las correcciones crudas permanecen aisladas en chat_coaching_feedback. Esta tabla sólo
-- habilita claves de política incluidas en el código y aprobadas para todos los tenants.

create table if not exists public.chat_master_lessons (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null unique
    check (policy_key in (
      'evidence_before_conclusion',
      'distinguish_fact_inference',
      'declare_coverage_gap',
      'intraday_same_hour',
      'ambiguous_reference',
      'recommend_action',
      'source_reconcile'
    )),
  status text not null default 'draft'
    check (status in ('draft', 'approved_for_staging', 'active', 'retired')),
  policy_version integer not null default 1 check (policy_version > 0),
  source_feedback_count integer not null default 0 check (source_feedback_count >= 0),
  source_client_count integer not null default 0 check (source_client_count >= 0),
  evaluation_cases integer not null default 0 check (evaluation_cases >= 0),
  evaluation_accuracy numeric(5,4),
  reviewed_at timestamptz,
  reviewed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Ningún patrón se activa por un solo restaurante, ni sin evaluación y revisión.
  constraint chat_master_lessons_active_reviewed_check check (
    status <> 'active' or (
      source_feedback_count >= 10
      and source_client_count >= 3
      and evaluation_cases >= 20
      and reviewed_at is not null
      and nullif(trim(reviewed_by), '') is not null
    )
  )
);

create index if not exists chat_master_lessons_status_idx
  on public.chat_master_lessons (status, policy_key);

alter table public.chat_master_lessons enable row level security;

-- Es un registro interno de políticas: el navegador no puede leerlo ni alterarlo.
-- El servidor resuelve únicamente las claves activas y las traduce a texto fijo en código.
revoke all on table public.chat_master_lessons from anon, authenticated;
grant all on table public.chat_master_lessons to service_role;
