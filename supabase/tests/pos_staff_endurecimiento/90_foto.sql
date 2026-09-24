-- Foto estructural (solo catálogo) de lo que las migraciones cambian. Una línea `clave=valor`.
-- Se compara entre estados para probar rollback exacto y reaplicación idempotente.
select 'acl_tabla_pos_staff=' || coalesce(string_agg(pg_get_userbyid(a.grantee) || ':' || a.privilege_type, ',' order by pg_get_userbyid(a.grantee) || ':' || a.privilege_type), '')
from pg_class c, aclexplode(c.relacl) a
where c.oid = 'public.pos_staff'::regclass and pg_get_userbyid(a.grantee) in ('anon','authenticated');

select 'acl_columnas_pos_staff=' || coalesce(string_agg(att.attname || '>' || pg_get_userbyid(a.grantee) || ':' || a.privilege_type, ',' order by att.attname || '>' || pg_get_userbyid(a.grantee) || ':' || a.privilege_type), '')
from pg_attribute att, aclexplode(att.attacl) a
where att.attrelid = 'public.pos_staff'::regclass and att.attnum > 0 and not att.attisdropped
  and pg_get_userbyid(a.grantee) in ('anon','authenticated');

select 'politicas_pos_staff=' || string_agg(polname || '/' || polcmd::text, ',' order by polname)
from pg_policy where polrelid = 'public.pos_staff'::regclass;

select 'triggers_pos_staff=' || coalesce(string_agg(tgname, ',' order by tgname), '')
from pg_trigger where tgrelid = 'public.pos_staff'::regclass and not tgisinternal;

select 'acl_pos_staff_audit=' || coalesce(string_agg(pg_get_userbyid(a.grantee) || ':' || a.privilege_type, ',' order by pg_get_userbyid(a.grantee) || ':' || a.privilege_type), '')
from pg_class c, aclexplode(c.relacl) a
where c.oid = 'public.pos_staff_audit'::regclass and pg_get_userbyid(a.grantee) in ('anon','authenticated');

select 'acl_secuencia_audit=' || coalesce(string_agg(pg_get_userbyid(a.grantee) || ':' || a.privilege_type, ',' order by pg_get_userbyid(a.grantee) || ':' || a.privilege_type), '')
from pg_class c, aclexplode(c.relacl) a
where c.oid = 'public.pos_staff_audit_id_seq'::regclass and pg_get_userbyid(a.grantee) in ('anon','authenticated');

select 'truncate_ventas=' || coalesce(string_agg(pg_get_userbyid(a.grantee), ',' order by pg_get_userbyid(a.grantee)), '')
from pg_class c, aclexplode(c.relacl) a
where c.oid = 'public.ventas_sinteticas'::regclass and a.privilege_type = 'TRUNCATE'
  and pg_get_userbyid(a.grantee) in ('anon','authenticated');

select 'default_truncate=' || coalesce(string_agg(pg_get_userbyid(a.grantee), ',' order by pg_get_userbyid(a.grantee)), '')
from pg_default_acl d, aclexplode(d.defaclacl) a
where d.defaclobjtype = 'r' and a.privilege_type = 'TRUNCATE'
  and pg_get_userbyid(a.grantee) in ('anon','authenticated');

select 'funciones_private=' || coalesce(string_agg(p.proname, ',' order by p.proname), '')
from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'pos_staff%';

select 'columna_origen=' || exists (select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'pos_staff_audit' and column_name = 'origen');

select 'huella_user_has_client_access=' || md5(pg_get_functiondef('private.user_has_client_access(text)'::regprocedure));
