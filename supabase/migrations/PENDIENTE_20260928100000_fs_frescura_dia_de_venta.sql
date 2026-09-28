-- "Hoy" = DÍA DE VENTA (zona e inicio del restaurante; default 05:00), igual que pos_orders.dia_venta.
-- Antes usaba la fecha de calendario: a las 00:30 decía "0 ventas hoy" con el turno de noche vendiendo.
-- Aplicada en staging y prod el 2026-09-28.
create or replace function public.fs_frescura(p_client_id text, p_tz text default 'America/Monterrey')
returns table (ultima_orden_pos timestamptz, ordenes_pos_hoy bigint, venta_pos_hoy numeric)
language sql stable security definer set search_path = public as $$
  with cfg as (
    select coalesce(nullif(c.timezone, ''), p_tz, 'America/Monterrey') as tz,
           coalesce(c.business_day_start_local, time '05:00') as ini
    from (select 1) x left join clients c on c.id = p_client_id
  ),
  hoy as (select ((now() at time zone cfg.tz) - cfg.ini::interval)::date as d, cfg.tz, cfg.ini from cfg),
  v as (
    select o.total, coalesce(o.dia_venta, ((o.created_at at time zone hoy.tz) - hoy.ini::interval)::date) as dia
    from pos_orders o, hoy
    where o.client_id = p_client_id and fs_es_venta(o.status, o.payment_status)
      and o.created_at >= now() - interval '3 days'
  )
  select
    (select max(coalesce(o.closed_at, o.created_at)) from pos_orders o where o.client_id = p_client_id and fs_es_venta(o.status, o.payment_status)),
    (select count(*) from v, hoy where v.dia = hoy.d),
    (select coalesce(sum(v.total), 0) from v, hoy where v.dia = hoy.d)
$$;
