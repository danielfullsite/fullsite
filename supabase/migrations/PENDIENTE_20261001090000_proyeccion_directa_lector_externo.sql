-- Proyección inmediata, opt-in y de sólo espejo para lectores externos.
--
-- No habilita ningún cliente por sí sola. La configuración debe crearse en un LAB
-- después de comprobar que el cliente no tiene órdenes nativas. Mantiene el cron
-- fs_sync_pos_orders_desde_historico como reconciliación de respaldo.
--
-- Este archivo es PENDIENTE: no se aplica automáticamente en producción.

begin;

create table if not exists public.ingesta_pos_projection_configs (
  client_id text not null references public.clients(id),
  fuente text not null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (client_id, fuente),
  constraint ingesta_pos_projection_configs_fuente_no_vacia
    check (length(btrim(fuente)) > 0)
);

alter table public.ingesta_pos_projection_configs enable row level security;
revoke all on table public.ingesta_pos_projection_configs from public, anon, authenticated;

create or replace function public.fs_proyectar_historico_tickets_directo(
  p_client_id text,
  p_fuente text,
  p_ticket_ids bigint[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proyectados integer := 0;
begin
  -- Sólo un administrador puede habilitar una fuente concreta. No se deduce por
  -- nombre de cliente ni por el token del lector.
  if not exists (
    select 1
    from public.ingesta_pos_projection_configs c
    where c.client_id = p_client_id
      and c.fuente = p_fuente
      and c.enabled
  ) then
    return 0;
  end if;

  -- Una fuente externa nunca puede escribir encima de una orden nativa.
  if exists (
    select 1
    from public.pos_orders o
    where o.client_id = p_client_id
      and o.id not like 'wh-%'
  ) then
    raise exception 'cliente % contiene órdenes nativas; proyección externa bloqueada', p_client_id
      using errcode = 'integrity_constraint_violation';
  end if;

  with loc as (
    select distinct on (cl.client_id) cl.client_id, cl.id as location_id
    from public.client_locations cl
    where cl.client_id = p_client_id
    order by cl.client_id, cl.active desc nulls last, cl.id
  ), fuente as (
    select
      ht.ticket_id,
      ('wh-' || ht.ticket_id)::text as id,
      ht.client_id,
      loc.location_id,
      ht.fecha as dia_venta,
      ('wt-' || to_char(ht.fecha, 'YYYYMMDD'))::text as turno_id,
      greatest(coalesce(ht.mesa, '0')::integer, 0) as mesa,
      ht.mesero,
      case when ht.cancelado then 'cancelada' else 'cerrada' end as status,
      ht.total,
      ht.subtotal,
      ht.iva,
      ht.descuento,
      coalesce(pg.propina, 0) as propina,
      ht.personas,
      pg.metodo_pago,
      (ht.cerrado_local at time zone c.timezone) as cerrado_en,
      coalesce(it.items, '[]'::jsonb) as items,
      coalesce(pg.pagos, '[]'::jsonb) as pagos
    from public.historico_tickets ht
    join public.clients c on c.id = ht.client_id and c.timezone is not null
    left join loc on loc.client_id = ht.client_id
    left join lateral (
      select jsonb_agg(
        jsonb_build_object('nombre', i.platillo, 'precio', i.precio_unitario, 'cantidad', i.cantidad)
        order by i.renglon_id
      ) as items
      from public.historico_ticket_items i
      where i.client_id = ht.client_id
        and i.fuente = ht.fuente
        and i.ticket_id = ht.ticket_id
    ) it on true
    left join lateral (
      select
        sum(p.propina) as propina,
        (array_agg(p.forma_pago order by p.pago_id))[1] as metodo_pago,
        jsonb_agg(jsonb_build_object('monto', p.monto, 'metodo', p.forma_pago) order by p.pago_id) as pagos
      from public.historico_pagos p
      where p.client_id = ht.client_id
        and p.fuente = ht.fuente
        and p.ticket_id = ht.ticket_id
    ) pg on true
    where ht.client_id = p_client_id
      and ht.fuente = p_fuente
      and ht.ticket_id = any(p_ticket_ids)
      and ht.cerrado_local is not null
  ), escritos as (
    insert into public.pos_orders (
      id, client_id, location_id, dia_venta, turno_id, mesa, mesero,
      status, payment_status, total, subtotal, iva, descuento, propina,
      personas, metodo_pago, created_at, closed_at, items, pagos, order_revision
    )
    select
      f.id, f.client_id, f.location_id, f.dia_venta, f.turno_id, f.mesa, f.mesero,
      f.status, null, f.total, f.subtotal, f.iva, f.descuento, f.propina,
      f.personas, f.metodo_pago, f.cerrado_en, f.cerrado_en, f.items, f.pagos, 0
    from fuente f
    on conflict (id) do update set
      status = excluded.status,
      total = excluded.total,
      subtotal = excluded.subtotal,
      iva = excluded.iva,
      descuento = excluded.descuento,
      propina = excluded.propina,
      personas = excluded.personas,
      mesero = excluded.mesero,
      metodo_pago = excluded.metodo_pago,
      closed_at = excluded.closed_at,
      items = excluded.items,
      pagos = excluded.pagos,
      updated_at = now()
    where public.pos_orders.client_id = excluded.client_id
      and public.pos_orders.id like 'wh-%'
      and (
        public.pos_orders.status,
        public.pos_orders.total,
        public.pos_orders.subtotal,
        public.pos_orders.iva,
        public.pos_orders.descuento,
        public.pos_orders.propina,
        public.pos_orders.personas,
        public.pos_orders.mesero,
        public.pos_orders.metodo_pago,
        public.pos_orders.closed_at,
        public.pos_orders.items,
        public.pos_orders.pagos
      ) is distinct from (
        excluded.status,
        excluded.total,
        excluded.subtotal,
        excluded.iva,
        excluded.descuento,
        excluded.propina,
        excluded.personas,
        excluded.mesero,
        excluded.metodo_pago,
        excluded.closed_at,
        excluded.items,
        excluded.pagos
      )
    returning 1
  )
  select count(*) into v_proyectados from escritos;

  return v_proyectados;
end;
$$;

revoke all on function public.fs_proyectar_historico_tickets_directo(text, text, bigint[]) from public, anon, authenticated;
grant execute on function public.fs_proyectar_historico_tickets_directo(text, text, bigint[]) to service_role;

commit;

-- ROLLBACK (sólo cuando no exista una función posterior dependiente):
-- begin;
-- drop function if exists public.fs_proyectar_historico_tickets_directo(text, text, bigint[]);
-- drop table if exists public.ingesta_pos_projection_configs;
-- commit;
