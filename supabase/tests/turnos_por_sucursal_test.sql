-- Aislamiento de turnos por sucursal — prueba repetible.
--
-- Corre contra STAGING después de aplicar 20260829_turnos_por_sucursal.sql.
-- No deja basura: cada caso borra su fila.
--
-- Lo que protege: que un turno NO pueda apuntar a la sucursal de otro cliente.
-- Con multi-sucursal, ése es el camino por el que los cortes de un restaurante
-- acabarían mezclados con los de otro — y sería silencioso.
--
-- El caso "sin sucursal acepta" NO es un descuido: los turnos viajan por la cola
-- offline (pos-data.ts) y el service worker conoce su forma. Un POS con código
-- anterior a esta columna debe poder seguir encolando y sincronizando. Ver
-- docs/pos/PIPELINE-POS-KDS-OFFLINE.md — el camino offline está congelado.
--
-- Uso:
--   psql "$STAGING_URL" -f supabase/tests/turnos_por_sucursal_test.sql

create or replace function pg_temp.probar_aislamiento_turnos()
returns table(caso text, esperado text, resultado text, ok boolean)
language plpgsql as $$
declare
  v_cliente_a text;
  v_cliente_b text;
  v_sucursal_de_b text;
begin
  -- Dos clientes distintos donde el segundo tenga al menos una sucursal.
  select l.client_id, l.id into v_cliente_b, v_sucursal_de_b
    from client_locations l
    join clients c on c.id = l.client_id
   limit 1;

  select id into v_cliente_a
    from clients
   where id <> v_cliente_b
   limit 1;

  if v_cliente_a is null or v_sucursal_de_b is null then
    return query select 'preparación'::text, 'dos clientes + una sucursal'::text,
                        'NO HAY DATOS SUFICIENTES'::text, false;
    return;
  end if;

  -- 1. Sin sucursal → acepta (compatibilidad offline y turnos previos)
  begin
    insert into pos_turnos (id, client_id, opened_by, fondo_inicial, location_id)
    values ('__t1__', v_cliente_a, 'prueba', 0, null);
    delete from pos_turnos where id = '__t1__';
    return query select 'sin sucursal'::text, 'acepta'::text, 'acepta'::text, true;
  exception when others then
    return query select 'sin sucursal'::text, 'acepta'::text, ('rechaza: '||sqlerrm)::text, false;
  end;

  -- 2. Sucursal de OTRO cliente → rechaza. Éste es el caso que importa.
  begin
    insert into pos_turnos (id, client_id, opened_by, fondo_inicial, location_id)
    values ('__t2__', v_cliente_a, 'prueba', 0, v_sucursal_de_b);
    delete from pos_turnos where id = '__t2__';
    return query select ('sucursal ajena: '||v_sucursal_de_b||' es de '||v_cliente_b)::text,
                        'rechaza'::text, 'ACEPTÓ — FUGA ENTRE CLIENTES'::text, false;
  exception when foreign_key_violation then
    return query select ('sucursal ajena: '||v_sucursal_de_b||' es de '||v_cliente_b)::text,
                        'rechaza'::text, 'rechaza'::text, true;
  end;

  -- 3. Sucursal propia → acepta
  begin
    insert into pos_turnos (id, client_id, opened_by, fondo_inicial, location_id)
    values ('__t3__', v_cliente_b, 'prueba', 0, v_sucursal_de_b);
    delete from pos_turnos where id = '__t3__';
    return query select 'sucursal propia'::text, 'acepta'::text, 'acepta'::text, true;
  exception when others then
    return query select 'sucursal propia'::text, 'acepta'::text, ('rechaza: '||sqlerrm)::text, false;
  end;

  -- 4. Sucursal inexistente → rechaza
  begin
    insert into pos_turnos (id, client_id, opened_by, fondo_inicial, location_id)
    values ('__t4__', v_cliente_b, 'prueba', 0, '__no_existe__');
    delete from pos_turnos where id = '__t4__';
    return query select 'sucursal inexistente'::text, 'rechaza'::text, 'aceptó'::text, false;
  exception when foreign_key_violation then
    return query select 'sucursal inexistente'::text, 'rechaza'::text, 'rechaza'::text, true;
  end;
end $$;

select * from pg_temp.probar_aislamiento_turnos();

-- Falla ruidosamente si algún caso no pasó.
do $$
declare v_malos int;
begin
  select count(*) into v_malos from pg_temp.probar_aislamiento_turnos() where not ok;
  if v_malos > 0 then
    raise exception 'aislamiento de turnos: % casos FALLARON', v_malos;
  end if;
  raise notice 'aislamiento de turnos: 4/4 ok';
end $$;

-- Nada debe quedar.
select count(*) as basura from pos_turnos where id like '\_\_t_\_\_';
