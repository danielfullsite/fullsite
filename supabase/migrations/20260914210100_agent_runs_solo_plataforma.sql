-- ─────────────────────────────────────────────────────────────────────────────
-- agent_runs: telemetría de la plataforma, no del restaurante
--
-- QUÉ ES
--   `agent_runs` NO tiene columna `client_id` (15 columnas, verificado en
--   information_schema). No es telemetría por inquilino y no se puede aislar por
--   inquilino sin cambiar el esquema. Es el registro de corridas de los 50 agentes
--   de Fullsite: 12,892 filas, de 2026-05-07 a hoy.
--
--   Pero NO es anónima. `output_summary` lleva el slug del restaurante y sus
--   números en texto plano — muestras reales de producción:
--       "amalay: 3 hallazgo(s)"
--       "current: $986, projected: $986"
--       "anomalies: 4, priority: critical, sent: 0"
--   O sea: quién opera, cuándo, cuánto vendió y qué se le detectó.
--
-- EL HUECO
--   policy `agent_runs_read` … for select to authenticated using (true)
--   + GRANT SELECT a `authenticated`
--   = cualquier usuario logueado de CUALQUIER restaurante leía las 12,892 filas.
--   `dashboard-app/src/app/mission-control/page.tsx` lo pide con
--   getDeepTable('agent_runs', 200), y `agent_runs` no está en
--   TENANT_SCOPED_TABLES (`dashboard-app/src/lib/data.ts:314`, que sólo lista
--   'agent_results' y 'agent_insights') → la petición sale sin filtro alguno.
--
-- LA DECISIÓN
--   Telemetría global legítima ⇒ no se aísla por inquilino, se cierra a la
--   plataforma. Hoy hay exactamente 1 platform_admin activo (con user_id y email),
--   así que esto no deja a nadie fuera que hoy deba entrar.
--
--   Se conserva el GRANT y se endurece la POLICY: es donde vive la autoridad real.
--   El gate de página (`proxy.ts`) es fail-open a propósito —"Supabase caído:
--   dejar pasar"— así que la UI nunca puede ser la frontera.
--
-- ROLLBACK
--   drop policy if exists agent_runs_read on public.agent_runs;
--   create policy agent_runs_read on public.agent_runs
--     for select to authenticated using (true);
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper en `private` siguiendo el patrón de `private.user_has_client_access`:
-- SECURITY DEFINER para poder leer platform_admins, y en un esquema sobre el que
-- `authenticated` NO tiene USAGE, de modo que nadie pueda invocarlo directo por
-- RPC para enumerar administradores. Las expresiones de una policy RLS se evalúan
-- con los privilegios del dueño de la tabla, así que la policy sí puede llamarlo.
create or replace function private.is_platform_admin_uid()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'private'
as $function$
  select case
    when auth.uid() is null then false
    else exists (
      select 1 from public.platform_admins pa
      where pa.active and pa.user_id = auth.uid()
    )
  end;
$function$;

revoke all on function private.is_platform_admin_uid() from public;

drop policy if exists agent_runs_read on public.agent_runs;

create policy agent_runs_read on public.agent_runs
  for select to authenticated
  using (private.is_platform_admin_uid());
