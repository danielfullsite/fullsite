# Snapshot de policies de PROD (qjiomlvudfmzuvqvhwpk) — pre BUG-019

Capturado read-only 2026-08-07 inmediatamente antes del deploy autorizado.
Estado: SUPERFICIE INSEGURA (decenas de policies anon `using(true)` + grants anon
CRUD en ~93 tablas tenant; `agent_events` con scoping por header x-client-id
controlable por cliente; 6 tablas con RLS OFF; 6 views anon-readable).

## Regenerar el snapshot exacto (read-only) antes de migrar:

```sql
select json_agg(row_to_json(t)) from (
  select schemaname, tablename, policyname, cmd, roles::text, qual, with_check
  from pg_policies where schemaname='public'
    and exists(select 1 from information_schema.columns c
      where c.table_schema='public' and c.table_name=pg_policies.tablename and c.column_name='client_id')
  order by tablename, policyname) t;
```

Guardar la salida como artefacto antes de aplicar `BUG-019-tenant-rls-fix.sql`.

## Rollback
`BUG-019-ROLLBACK.sql` restaura genéricamente el estado permisivo (re-grant anon
+ policies using(true)) — probado (fix→rollback→reapply). Si se usa: BUG-019
vuelve a P0 OPEN, MARKET READY = NO, detener rollout multi-tenant.
