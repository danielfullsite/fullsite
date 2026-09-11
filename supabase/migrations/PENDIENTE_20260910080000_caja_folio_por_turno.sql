-- Candidato, NO aplicado. Requiere folio_por_dia_de_venta y caja_business_materializer.
-- Instrucción Daniel/Eduardo 2026-09-09: reiniciar el número visible tras Z.
-- Caja asigna por turno; UUID de orden/documento conserva identidad histórica.
-- No renumera filas antiguas ni elimina ventas. Legacy mantiene su regla diaria.
begin;
drop index if exists public.pos_orders_folio_unico_por_dia;
create unique index pos_orders_folio_unico_por_dia
  on public.pos_orders(client_id, dia_venta, order_number)
  where dia_venta >= date '2026-09-02' and order_number is not null and caja_stream_id is null;
create unique index if not exists pos_caja_order_number_per_turn
  on public.pos_orders(client_id, location_id, turno_id, order_number)
  where caja_stream_id is not null and caja_operational_snapshot ? 'order_number';
-- La fecha comercial sigue alimentando los reportes. Un recibo Caja histórico
-- sin número no recibe uno inventado por la nube; sólo la autoridad lo asigna.
create or replace function public.set_pos_order_number()
returns trigger
language plpgsql
as $$
declare
  v_tz     text;
  v_inicio time;
begin
  -- Config del tenant. Si el cliente no existe o no declara nada, se usan los
  -- defaults del producto (mismos que provision-tenant.ts). Nunca se aborta el
  -- insert por configuracion faltante: perder la orden es peor que un folio con
  -- default.
  select coalesce(c.timezone, 'America/Monterrey'),
         coalesce(c.business_day_start_local, '05:00:00'::time)
    into v_tz, v_inicio
    from public.clients c
   where c.id = new.client_id;

  if v_tz is null then
    v_tz := 'America/Monterrey';
    v_inicio := '05:00:00'::time;
  end if;

  -- El dia de venta se calcula SIEMPRE, aunque el folio venga dado: es lo que
  -- sostiene el indice unico y los reportes por dia.
  if new.dia_venta is null then
    new.dia_venta :=
      ((coalesce(new.created_at, now()) at time zone v_tz) - v_inicio)::date;
  end if;

  if new.order_number is null and new.caja_stream_id is null then
    -- Se serializa por (cliente, dia de venta). Antes la llave era (cliente, turno),
    -- que es justo lo que permitia dos series el mismo dia.
    perform pg_advisory_xact_lock(
      hashtextextended(coalesce(new.client_id, '') || ':' || new.dia_venta::text, 0)
    );

    select coalesce(max(order_number), 0) + 1
      into new.order_number
      from public.pos_orders
     where client_id = new.client_id
       and dia_venta = new.dia_venta;
  end if;

  return new;
end;
$$;
commit;
