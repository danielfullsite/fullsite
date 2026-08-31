-- Close the temporary JSONB migration backup from PostgREST.
--
-- This table contains cross-tenant agent output and is a recovery artifact, not an
-- application surface. Keep it for rollback, but only service_role/database owners may
-- read it. Idempotent and reversible by adding an explicit tenant-scoped policy later.

begin;

alter table if exists public.agent_results_respaldo_jsonb enable row level security;
alter table if exists public.agent_results_respaldo_jsonb force row level security;

revoke all on table public.agent_results_respaldo_jsonb from anon;
revoke all on table public.agent_results_respaldo_jsonb from authenticated;
grant all on table public.agent_results_respaldo_jsonb to service_role;

commit;
