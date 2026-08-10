-- BUG-019 · Barrido estructural: cada tabla esperada (client_id) debe quedar
-- correctamente aislada por la migración. Reporta SOLO las que fallan.
with expected as (select name from _sweep_expected),
chk as (
  select e.name,
    -- RLS habilitado
    coalesce((select c.relrowsecurity from pg_class c
              join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
              where c.relname=e.name), false) as rls_on,
    -- anon SIN privilegios de tabla
    not exists (select 1 from information_schema.role_table_grants g
                where g.table_schema='public' and g.table_name=e.name and g.grantee='anon') as anon_revoked,
    -- 4 policies authenticated scoped por user_has_client_access
    (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=e.name
       and p.policyname in (e.name||'_sel', e.name||'_ins', e.name||'_upd', e.name||'_del')
       and (p.qual like '%user_has_client_access%' or p.with_check like '%user_has_client_access%')) as auth_policies,
    -- policy de service_role
    exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=e.name
            and p.policyname=e.name||'_svc') as svc_policy
  from expected e
)
select name, rls_on, anon_revoked, auth_policies, svc_policy
from chk
where not (
  rls_on and anon_revoked and svc_policy and (
    -- Regla general: 4 policies authenticated scoped
    auth_policies=4
    -- Excepción §2: pos_audit_log es INMUTABLE (sel+ins, sin upd/del) — 2 basta
    or (name='pos_audit_log' and auth_policies=2)
  )
)
order by name;

-- Resumen
select 'SWEEP-SUMMARY' as tag,
  (select count(*) from _sweep_expected) as expected,
  (select count(*) from _sweep_expected e where
     coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' where c.relname=e.name),false)
     and not exists (select 1 from information_schema.role_table_grants g where g.table_schema='public' and g.table_name=e.name and g.grantee='anon')
     and ((select count(*) from pg_policies p where p.schemaname='public' and p.tablename=e.name and p.policyname in (e.name||'_sel',e.name||'_ins',e.name||'_upd',e.name||'_del') and (p.qual like '%user_has_client_access%' or p.with_check like '%user_has_client_access%'))=4
          or (e.name='pos_audit_log' and (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=e.name and p.policyname in (e.name||'_sel',e.name||'_ins') and (p.qual like '%user_has_client_access%' or p.with_check like '%user_has_client_access%'))=2))
     and exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=e.name and p.policyname=e.name||'_svc')
  ) as fully_isolated;
