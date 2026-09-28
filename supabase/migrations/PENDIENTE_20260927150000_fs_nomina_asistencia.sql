-- Asistencia / horas trabajadas desde el CHECADOR y los TURNOS de Fullsite (no Wansoft).
-- Mismo shape que el legacy wansoft_labor.data: [{empleado, entrada, salida, horas}] por día.
--   1) pos_attendance: cada 'entrada' se empareja con la siguiente 'salida' de esa persona.
--   2) pos_staff_shifts: completa a quien no checó ese día (clock_in / clock_out).
-- Una entrada sin salida (o con la salida >16 h después: olvidó checar) se reporta con
-- salida '' y horas 0 — no se inventan horas.
create or replace function public.fs_asistencia(p_client_id text, p_desde date, p_hasta date)
returns table (fecha date, labor jsonb)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
begin
  if not fs_puede_leer(p_client_id) then
    raise exception 'sin acceso a %', p_client_id using errcode = '42501';
  end if;
  select coalesce(c.timezone, 'America/Monterrey') into v_tz from clients c where c.id = p_client_id;
  v_tz := coalesce(v_tz, 'America/Monterrey');
  return query
  with marcas as (
    select a.staff_id, a.staff_name, a.type, a.registered_at,
           lead(a.type) over w as sig_tipo, lead(a.registered_at) over w as sig_ts
    from pos_attendance a
    where a.client_id = p_client_id
      and a.registered_at >= (p_desde - 1)::timestamp and a.registered_at < (p_hasta + 2)::timestamp
    window w as (partition by coalesce(a.staff_id::text, a.staff_name) order by a.registered_at)
  ),
  checadas as (
    select (m.registered_at at time zone v_tz)::date as dia, m.staff_name as empleado,
           m.registered_at as ent,
           case when m.sig_tipo = 'salida' and m.sig_ts - m.registered_at <= interval '16 hours' then m.sig_ts end as sal
    from marcas m where m.type = 'entrada'
  ),
  turnos as (
    select (s.clock_in at time zone v_tz)::date as dia, s.staff_name as empleado, s.clock_in as ent,
           case when s.clock_out - s.clock_in <= interval '16 hours' then s.clock_out end as sal,
           s.hours_worked
    from pos_staff_shifts s
    where s.client_id = p_client_id
      and s.clock_in >= (p_desde - 1)::timestamp and s.clock_in < (p_hasta + 2)::timestamp
  ),
  todo as (
    select c.dia, c.empleado, c.ent, c.sal, null::numeric as horas_decl from checadas c
    union all
    select t.dia, t.empleado, t.ent, t.sal, t.hours_worked from turnos t
    where not exists (select 1 from checadas c where c.dia = t.dia and lower(c.empleado) = lower(t.empleado))
  ),
  filas as (
    select t.dia, jsonb_build_object(
      'empleado', t.empleado,
      'entrada', to_char(t.ent at time zone v_tz, 'HH24:MI'),
      'salida', coalesce(to_char(t.sal at time zone v_tz, 'HH24:MI'), ''),
      'horas', round(coalesce(case when t.sal is not null then extract(epoch from (t.sal - t.ent)) / 3600 end, t.horas_decl, 0)::numeric, 2)
    ) as j, t.ent
    from todo t where t.dia between p_desde and p_hasta and coalesce(t.empleado, '') <> ''
  )
  select f.dia, jsonb_agg(f.j order by f.ent) from filas f group by f.dia order by f.dia desc;
end $$;
revoke all on function public.fs_asistencia(text, date, date) from public, anon;
grant execute on function public.fs_asistencia(text, date, date) to authenticated, service_role;
