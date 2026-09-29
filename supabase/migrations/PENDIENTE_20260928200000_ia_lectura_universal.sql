-- IA — LECTURA UNIVERSAL POR RESTAURANTE (estado final consolidado).
-- Aplicada en staging y PRODUCCIÓN el 2026-09-28; este archivo es el estado final
-- equivalente, idempotente. Ver docs/ai/IA-DEL-DUENO.md §3b.
--
-- Qué hace: el AI del dueño puede leer CUALQUIER tabla de public que tenga `client_id text`
-- y RLS activo — incluidas las que se agreguen después — sin código por sección.
--
-- Candados (todos en la base, no dependen del validador de texto):
--   * rol ia_lector: SELECT sólo sobre columnas NO sensibles (grants por columna);
--   * política RLS ia_lector_por_restaurante: client_id = restaurante registrado en ia._sesion,
--     tabla que el rol no puede escribir (no se puede falsificar con set_config);
--   * transacción de sólo lectura, identidad (request.jwt.claims) borrada;
--   * EXPLAIN previo: costo estimado > 1,000,000 → rechazada (54000);
--   * máx. 200 filas; tablas sin client_id o sin RLS, y la lista de ia._excluida, no se ven;
--   * permisos se re-sincronizan solos cuando cambia el esquema (firma md5).
-- Además, ia._validar_sql filtra el texto (sólo SELECT/WITH, funciones en lista blanca).
-- No crea vistas: no bloquea DROP/ALTER de tablas. Única restricción nueva: cambiar el TIPO
-- de client_id en una tabla legible requiere quitar antes su política (la política lo usa).

create schema if not exists ia;
revoke all on schema ia from public;
grant usage on schema ia to authenticated, service_role;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'ia_lector') then
    create role ia_lector nologin noinherit;
  end if;
end $$;
grant ia_lector to authenticated, service_role;
grant usage on schema public to ia_lector;
grant usage on schema ia to ia_lector;

create table if not exists ia._mapa_cache (client_id text primary key, firma text, generado timestamptz, mapa jsonb);
create table if not exists ia._permisos (id int primary key default 1, firma text, sincronizado timestamptz);
create table if not exists ia._sesion (pid int not null, inicio timestamptz not null, client_id text not null, primary key (pid, inicio));
revoke all on ia._mapa_cache, ia._permisos, ia._sesion from public, anon, authenticated, ia_lector;

create or replace function ia.es_venta(p_status text, p_payment_status text)
returns boolean language sql immutable as $$
  select p_payment_status = 'pagada' or (p_payment_status is null and p_status = 'cerrada')
$$;
grant execute on function ia.es_venta(text, text) to authenticated, service_role, ia_lector;

-- Tablas que la IA nunca ve (secretos, operación interna, colas técnicas).
create or replace function ia._excluida(p_tabla text) returns boolean language sql immutable as $$
  select p_tabla ~ '^(credentials_vault|client_users|push_subscriptions|pos_pin_throttle|pos_mutation_authority|pos_save_operations|pos_terminals|pos_staff_permissions|pos_print_jobs|pos_bridge_logs|pos_recipes_old|pos_authority_transitions|chat_logs|memories|agent_feedback|demo_generator_state|lab_issues|delivery_dlq|wansoft_data)$'
      or p_tabla ~ '^(platform_|integration_|ia_|_)'
      or p_tabla ~ '(_operations$|_respaldo|_backup|fingerprint|huella|biometr)'
$$;

-- Columnas sensibles: nunca se otorgan al rol.
create or replace function ia._columna_sensible(p_col text) returns boolean language sql immutable as $$
  select lower(p_col) ~ '((^|_)pin($|_)|pin_hash|password|passw|contrasen|token|secret|hash|api_?key|credential|signature|firma_|cert|private|clabe|cuenta_banc|card_number|numero_tarjeta|cvv|curp|(^|_)rfc($|_)|(^|_)nss($|_)|email|correo|telefono|phone|celular|whatsapp|direccion|address|(^|_)ip($|_)|fingerprint|huella|webhook|_url$|(^|_)calle($|_)|colonia|no_interior|no_exterior|num_ext|num_int|payload)'
$$;

create or replace function ia._firma_esquema() returns text language sql stable as $$
  select md5(coalesce(string_agg(c.relname || ':' || c.relrowsecurity::text || ':' || a.attname || ':' || a.atttypid::text, ',' order by c.relname, a.attnum), ''))
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where c.relkind in ('r','v','p','m')
    and exists (select 1 from pg_attribute k where k.attrelid = c.oid and k.attname = 'client_id' and not k.attisdropped)
$$;

-- Sólo tablas reales con RLS (las vistas corren como su dueño y saltarían la política).
create or replace function ia.tablas_legibles()
returns table (tabla text, columnas text[], descripcion text)
language sql stable security definer set search_path = pg_catalog as $$
  select c.relname::text,
         array_agg(a.attname::text order by a.attnum) filter (where not ia._columna_sensible(a.attname)),
         obj_description(c.oid, 'pg_class')
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname = 'public'
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where c.relkind in ('r','p') and c.relrowsecurity
    and exists (select 1 from pg_attribute k where k.attrelid = c.oid and k.attname = 'client_id'
                and not k.attisdropped and k.atttypid = 'text'::regtype)
    and not ia._excluida(c.relname)
  group by c.oid, c.relname
$$;
revoke all on function ia.tablas_legibles() from public, anon;
grant execute on function ia.tablas_legibles() to authenticated, service_role;

-- Filtro de texto (primera capa): UNA consulta de lectura, funciones en lista blanca.
create or replace function ia._validar_sql(p_sql text) returns text
language plpgsql immutable as $$
declare s text := btrim(p_sql); sin_texto text; f text;
  permitidas text[] := array[
    'select','from','where','in','exists','any','all','some','values','over','filter','and','or','not','as','on',
    'using','when','then','else','case','join','lateral','by','having','group','distinct','between','like','ilike',
    'is','union','intersect','except','limit','offset','with','array','row','partition','within',
    'numeric','decimal','varchar','char','timestamp','timestamptz','time','date','interval','int','integer','bigint','text','boolean','float','real',
    'count','sum','avg','min','max','round','floor','ceil','ceiling','abs','coalesce','nullif','greatest','least',
    'date_trunc','extract','date_part','to_char','to_date','to_number','now','lower','upper','trim','btrim','ltrim','rtrim',
    'length','substring','substr','replace','concat','concat_ws','split_part','position','left','right','initcap',
    'regexp_replace','jsonb_array_elements','jsonb_array_elements_text','jsonb_each','jsonb_each_text',
    'jsonb_array_length','jsonb_typeof','jsonb_build_object','jsonb_agg','json_agg','string_agg','array_agg',
    'row_number','rank','dense_rank','ntile','lag','lead','first_value','last_value','nth_value','percentile_cont',
    'percentile_disc','mode','stddev','stddev_pop','stddev_samp','variance','bool_or','bool_and','every',
    'generate_series','cast','timezone','make_date','make_interval','age','trunc','sign','mod','power','sqrt',
    'exp','ln','es_venta','unnest','cardinality','array_length','isfinite','justify_interval','date_bin'];
begin
  if s is null or s = '' then raise exception 'consulta vacía' using errcode = '22023'; end if;
  s := regexp_replace(s, ';\s*$', '');
  if length(s) > 4000 then raise exception 'consulta demasiado larga' using errcode = '22023'; end if;
  if s !~* '^(select|with)\s' then raise exception 'sólo se permiten consultas SELECT' using errcode = '42501'; end if;
  if s ~ '(;|--|/\*|\$|")' then raise exception 'caracteres no permitidos en la consulta' using errcode = '42501'; end if;
  sin_texto := regexp_replace(s, '''([^'']|'''')*''', '''''', 'g');
  if sin_texto ~* '(pg_|information_schema|\m(public|ia|auth|storage|extensions|vault|realtime|graphql|net|cron|supabase_\w*)\s*\.|set_config|current_setting|dblink|\mlo_|\mcopy\M|\minto\M|for\s+(update|share|no\s+key|key)|\mcreate\M|\minsert\M|\mupdate\M|\mdelete\M|\mdrop\M|\malter\M|\mtruncate\M|\mgrant\M|\mrevoke\M|\mcall\M|\mdo\M|\mexecute\M|\mlisten\M|\mnotify\M|\mvacuum\M|\manalyze\M|\mreindex\M|\mcluster\M|\mlock\M|\mrefresh\M|\mimport\M|\msecurity\M|\mrecursive\M)' then
    raise exception 'la consulta usa algo no permitido' using errcode = '42501';
  end if;
  for f in select lower(m[1]) from regexp_matches(sin_texto, '([A-Za-z_][A-Za-z0-9_]*)\s*\(', 'g') as m loop
    if not (f = any(permitidas)) then
      raise exception 'función no permitida: %', f using errcode = '42501';
    end if;
  end loop;
  return s;
end $$;

-- Restaurante de la consulta en curso: tabla que ia_lector no puede escribir.
create or replace function ia._fijar_tenant(p_client_id text) returns void
language plpgsql security definer set search_path = pg_catalog as $$
begin
  delete from ia._sesion where pid = pg_backend_pid() or inicio < now() - interval '1 hour';
  insert into ia._sesion (pid, inicio, client_id) values (pg_backend_pid(), now(), p_client_id);
end $$;
revoke all on function ia._fijar_tenant(text) from public, anon, ia_lector;
grant execute on function ia._fijar_tenant(text) to authenticated, service_role;

create or replace function ia.tenant_sesion() returns text
language sql stable security definer set search_path = pg_catalog as $$
  select client_id from ia._sesion where pid = pg_backend_pid() and inicio = now()
$$;
revoke all on function ia.tenant_sesion() from public;
grant execute on function ia.tenant_sesion() to ia_lector;

-- Grants por columna + política por restaurante. Idempotente.
create or replace function ia.sincronizar_permisos() returns int
language plpgsql security definer set search_path = public, pg_catalog as $$
declare r record; n int := 0;
begin
  for r in select distinct table_name from information_schema.role_table_grants
           where grantee = 'ia_lector' and table_schema = 'public'
           union select distinct table_name from information_schema.column_privileges
           where grantee = 'ia_lector' and table_schema = 'public' loop
    execute format('revoke all on public.%I from ia_lector', r.table_name);
  end loop;
  for r in select pol.polname, c.relname from pg_policy pol join pg_class c on c.oid = pol.polrelid
           join pg_namespace ns on ns.oid = c.relnamespace
           where ns.nspname = 'public' and pol.polname = 'ia_lector_por_restaurante' loop
    execute format('drop policy %I on public.%I', r.polname, r.relname);
  end loop;
  for r in select * from ia.tablas_legibles() loop
    continue when r.columnas is null;
    execute format('grant select (%s) on public.%I to ia_lector',
                   (select string_agg(format('%I', c), ', ') from unnest(r.columnas) c), r.tabla);
    execute format('create policy ia_lector_por_restaurante on public.%I for select to ia_lector using (client_id = (select ia.tenant_sesion()))', r.tabla);
    n := n + 1;
  end loop;
  insert into ia._permisos (id, firma, sincronizado) values (1, ia._firma_esquema(), now())
  on conflict (id) do update set firma = excluded.firma, sincronizado = excluded.sincronizado;
  return n;
end $$;
revoke all on function ia.sincronizar_permisos() from public, anon, authenticated;

create or replace function ia.asegurar_permisos() returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if coalesce((select firma from ia._permisos where id = 1), '') <> ia._firma_esquema() then
    perform ia.sincronizar_permisos();
  end if;
end $$;
grant execute on function ia.asegurar_permisos() to authenticated, service_role;

create or replace function public.ia_consulta(p_client_id text, p_sql text)
returns jsonb language plpgsql volatile security invoker set search_path = ia, pg_catalog as $$
declare s text; sin_texto text; ctes text := ''; t record; res jsonb; n int; cuerpo text; plan jsonb; costo numeric;
begin
  if not public.fs_puede_leer(p_client_id) then
    raise exception 'sin acceso a %', p_client_id using errcode = '42501';
  end if;
  perform ia.asegurar_permisos();
  s := ia._validar_sql(p_sql);
  sin_texto := lower(regexp_replace(s, '''([^'']|'''')*''', '''''', 'g'));
  for t in select * from ia.tablas_legibles() loop
    if t.columnas is not null and sin_texto ~ ('\m' || t.tabla || '\M') then
      ctes := ctes || case when ctes = '' then '' else ', ' end
        || format('%I as not materialized (select %s from public.%I x where x.client_id = %L)',
                  t.tabla, (select string_agg(format('%I', c), ', ') from unnest(t.columnas) c), t.tabla, p_client_id);
    end if;
  end loop;
  if ctes = '' then
    raise exception 'la consulta no usa ninguna tabla del restaurante' using errcode = '22023';
  end if;
  if s ~* '^with\s' then
    cuerpo := 'with ' || ctes || ', ' || regexp_replace(s, '^with\s+', '', 'i');
  else
    cuerpo := 'with ' || ctes || ' ' || s;
  end if;
  cuerpo := format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from (%s) q limit 201) t', cuerpo);
  -- Candados de la base (no dependen del validador): restaurante fijado en tabla no
  -- escribible por el rol, sólo lectura, identidad borrada, rol sin privilegios.
  perform ia._fijar_tenant(p_client_id);
  perform set_config('transaction_read_only', 'on', true);
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('role', 'ia_lector', true);
  execute 'explain (format json) ' || cuerpo into plan;
  costo := (plan -> 0 -> 'Plan' ->> 'Total Cost')::numeric;
  if costo > 1000000 then
    raise exception 'consulta demasiado pesada (costo estimado %); acota fechas o agrupa', round(costo) using errcode = '54000';
  end if;
  execute cuerpo into res;
  n := jsonb_array_length(res);
  if n > 200 then res := res - 200; end if;
  return jsonb_build_object('filas', res, 'n', least(n, 200), 'truncado', n > 200);
end $$;
revoke all on function public.ia_consulta(text, text) from public, anon;
grant execute on function public.ia_consulta(text, text) to authenticated, service_role;

-- Mapa de lo que existe para el restaurante: tablas, columnas seguras, filas y fechas.
create or replace function public.ia_mapa(p_client_id text)
returns jsonb language plpgsql volatile security definer set search_path = ia, public, pg_catalog as $$
declare t record; cnt bigint; fcol text; rango jsonb; cols jsonb; salida jsonb := '[]'::jsonb; firma text; cache record;
begin
  if not public.fs_puede_leer(p_client_id) then
    raise exception 'sin acceso a %', p_client_id using errcode = '42501';
  end if;
  firma := ia._firma_esquema();
  select * into cache from ia._mapa_cache m where m.client_id = p_client_id;
  if found and cache.firma = firma and cache.generado > now() - interval '30 minutes' then
    return cache.mapa;
  end if;
  for t in select * from ia.tablas_legibles() order by tabla loop
    execute format('select count(*) from (select 1 from public.%I where client_id = %L limit 100001) x', t.tabla, p_client_id) into cnt;
    continue when cnt = 0;
    select jsonb_agg(jsonb_build_object('c', a.attname, 't', format_type(a.atttypid, a.atttypmod)) order by a.attnum)
      into cols from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relname = t.tabla and a.attnum > 0 and not a.attisdropped and a.attname = any(t.columnas);
    select a.attname into fcol from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relname = t.tabla and a.attnum > 0 and not a.attisdropped and a.attname = any(t.columnas)
        and a.atttypid in ('date'::regtype, 'timestamptz'::regtype, 'timestamp'::regtype)
      order by case a.attname when 'dia_venta' then 0 when 'fecha' then 1 when 'created_at' then 2 else 3 end, a.attnum limit 1;
    rango := null;
    if fcol is not null then
      execute format('select jsonb_build_object(''columna'', %L, ''desde'', min(%I)::date, ''hasta'', max(%I)::date) from public.%I where client_id = %L',
                     fcol, fcol, fcol, t.tabla, p_client_id) into rango;
    end if;
    salida := salida || jsonb_build_object('tabla', t.tabla, 'filas', case when cnt > 100000 then '100000+' else cnt::text end,
      'fechas', rango, 'columnas', cols, 'descripcion', nullif(t.descripcion, ''));
  end loop;
  insert into ia._mapa_cache (client_id, firma, generado, mapa) values (p_client_id, firma, now(), salida)
  on conflict (client_id) do update set firma = excluded.firma, generado = excluded.generado, mapa = excluded.mapa;
  return salida;
end $$;
revoke all on function public.ia_mapa(text) from public, anon;
grant execute on function public.ia_mapa(text) to authenticated, service_role;

select ia.sincronizar_permisos();
