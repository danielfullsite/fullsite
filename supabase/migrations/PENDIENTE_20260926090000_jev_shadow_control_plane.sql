-- JEV shadow control plane. PENDIENTE: revisar y aplicar sólo en staging antes de producción.
-- Nunca almacena reportes crudos, secretos, PINs, PII, URLs ni texto libre: guarda una entrada
-- JEV ya validada, su hash de fuente y decisiones/revisiones append-only.

create table if not exists public.platform_jev_evidence (
  id uuid primary key default gen_random_uuid(),
  source_ref text not null unique check (source_ref ~ '^[a-z0-9][a-z0-9._-]{2,119}$'),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  decision_input jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_jev_decisions (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references public.platform_jev_evidence(id),
  recommendation jsonb not null,
  audit_record jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_jev_reviews (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.platform_jev_decisions(id),
  disposition text not null check (disposition in ('accepted', 'rejected')),
  reviewed_by uuid not null,
  created_at timestamptz not null default now()
);

alter table public.platform_jev_evidence enable row level security;
alter table public.platform_jev_decisions enable row level security;
alter table public.platform_jev_reviews enable row level security;

create or replace function public.platform_jev_immutable() returns trigger
  language plpgsql as $$
begin
  raise exception 'JEV evidence, decisions and reviews are append-only: % no permitido', tg_op;
end $$;

drop trigger if exists platform_jev_evidence_no_mutate on public.platform_jev_evidence;
create trigger platform_jev_evidence_no_mutate before update or delete on public.platform_jev_evidence
  for each row execute function public.platform_jev_immutable();
drop trigger if exists platform_jev_decisions_no_mutate on public.platform_jev_decisions;
create trigger platform_jev_decisions_no_mutate before update or delete on public.platform_jev_decisions
  for each row execute function public.platform_jev_immutable();
drop trigger if exists platform_jev_reviews_no_mutate on public.platform_jev_reviews;
create trigger platform_jev_reviews_no_mutate before update or delete on public.platform_jev_reviews
  for each row execute function public.platform_jev_immutable();

create index if not exists platform_jev_evidence_created_idx on public.platform_jev_evidence (created_at desc);
create index if not exists platform_jev_decisions_evidence_idx on public.platform_jev_decisions (evidence_id, created_at desc);
create index if not exists platform_jev_reviews_decision_idx on public.platform_jev_reviews (decision_id, created_at desc);
