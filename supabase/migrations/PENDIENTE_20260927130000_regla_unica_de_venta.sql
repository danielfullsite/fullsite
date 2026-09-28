-- UNA sola definición de "esto es una venta" para todo Fullsite.
--
-- La canónica vive en el lector del dashboard (lib/data.ts getDashboardFromPosOrders):
--   cuenta si payment_status = 'pagada', o si no hay payment_status y status = 'cerrada'
--   (canceladas, void y divididas nunca cuentan).
-- Las funciones fs_* usaban status in (cerrada,pagada,cobrada,entregada): dos
-- definiciones de venta = dos números distintos para la misma pregunta. Se alinean.
--
-- NOTA: cuando se aplique la migración de Caja (parent_order_id / caja_stream_id),
-- esta función debe excluir también los hijos de una orden de caja y los padres
-- divididos — igual que el lector del dashboard.

create or replace function public.fs_es_venta(p_status text, p_payment_status text) returns boolean
language sql immutable as $$
  select coalesce(p_payment_status = 'pagada', false)
      or (p_payment_status is null and p_status = 'cerrada')
$$;

do $$
declare
  r record;
  def text;
begin
  for r in select * from (values
      ('public.fs_ventas_diarias(text,date,date)', 'fs_es_venta(x.status)', 'fs_es_venta(x.status, x.payment_status)'),
      ('public.fs_frescura(text,text)', 'fs_es_venta(o.status)', 'fs_es_venta(o.status, o.payment_status)'),
      ('public.fs_ventas_producto(text,date,date,text,text)', 'fs_es_venta(o.status)', 'fs_es_venta(o.status, o.payment_status)'),
      ('public.ventas_por_franja(text,date,date,jsonb,text,time)', 'o.status in (''cerrada'', ''pagada'', ''cobrada'', ''entregada'')', 'fs_es_venta(o.status, o.payment_status)')
    ) as t(fn, antes, despues)
  loop
    def := pg_get_functiondef(r.fn::regprocedure);
    if position(r.antes in def) = 0 and position(r.despues in def) = 0 then
      raise exception 'regla de venta: % no contiene el patrón esperado', r.fn;
    end if;
    execute replace(def, r.antes, r.despues);
  end loop;
end $$;

-- La versión de un argumento queda sin usos: se elimina para que nadie la vuelva a usar.
drop function if exists public.fs_es_venta(text);
