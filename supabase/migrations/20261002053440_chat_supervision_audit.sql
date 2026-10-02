-- Supervisión por interacción de chat. La conversación sigue en chat_logs y esta tabla
-- guarda únicamente el resultado estructurado de sus controles, para no duplicar texto
-- ni exponer información de un restaurante a otro.

create table if not exists public.chat_supervision_audits (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  chat_log_id uuid not null unique references public.chat_logs(id) on delete cascade,
  checker_version text not null,
  decision text not null check (decision in ('pass', 'needs_review', 'blocked')),
  evidence_status text not null check (evidence_status in ('verified', 'needs_review', 'unavailable')),
  flags text[] not null default '{}'
    check (flags <@ array[
      'authorization_missing',
      'numeric_claims_untraced',
      'numeric_claims_marked',
      'source_read_failed',
      'tool_query_failed',
      'response_unavailable'
    ]::text[]),
  numeric_claims integer not null default 0 check (numeric_claims >= 0),
  untraced_numeric_claims integer not null default 0 check (untraced_numeric_claims >= 0),
  tool_query_count integer not null default 0 check (tool_query_count >= 0),
  tool_query_error_count integer not null default 0 check (tool_query_error_count >= 0),
  response_repaired boolean not null default false,
  review_status text not null default 'queued'
    check (review_status in ('queued', 'reviewed', 'accepted', 'rejected')),
  reviewed_at timestamptz,
  reviewed_by text,
  created_at timestamptz not null default now(),
  constraint chat_supervision_audits_counts_check check (
    untraced_numeric_claims <= numeric_claims
    and tool_query_error_count <= tool_query_count
  )
);

create index if not exists chat_supervision_audits_client_created_idx
  on public.chat_supervision_audits (client_id, created_at desc);

create index if not exists chat_supervision_audits_queue_idx
  on public.chat_supervision_audits (review_status, decision, created_at asc);

alter table public.chat_supervision_audits enable row level security;

-- La cola contiene señales de calidad de conversaciones; el navegador no recibe acceso
-- directo. El servidor ya verifica tenant antes de crear el registro.
revoke all on table public.chat_supervision_audits from anon, authenticated;
grant all on table public.chat_supervision_audits to service_role;
