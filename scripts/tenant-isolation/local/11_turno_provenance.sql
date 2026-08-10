-- BUG-019-C · Pruebas negativas/positivas de procedencia del turno (tras la migración real).
-- Corren DESPUÉS de 10_assertions. Patrón: la vía esperada imprime 'PASS' (notice); una
-- desviación lanza 'FAIL' (excepción) que aborta con ON_ERROR_STOP y marca el gate.
-- Cubre el contrato BUG-019-C: la excepción de turno es la MÁS ESTRECHA posible.
\echo '===== BUG-019-C — procedencia del turno (borrador QR server-owned) ====='

-- P1 — Orden POS NORMAL (id no-qr) con turno NULL → RECHAZADA por el CHECK.
--      Como service_role (bypassrls) para aislar el CHECK, no la RLS.
set role service_role;
do $$ begin
  begin
    insert into public.pos_orders(id,client_id,status,turno_id) values('normal-nullturno','amalay','abierta',null);
    raise exception 'P1 normal-null-turno FAIL: se permitió una orden NORMAL con turno NULL';
  exception when check_violation then raise notice 'P1 PASS (CHECK rechazó orden normal turno-null)';
  end;
end $$;
reset role;

-- P2 — Procedencia QR FORJADA por un usuario AUTENTICADO → RECHAZADA por RLS.
--      Aunque forje el id 'qr-', la policy authenticated exige turno_id NOT NULL en el
--      with-check → un cliente autenticado NUNCA puede persistir un borrador turno-null.
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111111')::text, false);
do $$ begin
  begin
    insert into public.pos_orders(id,client_id,status,turno_id) values('qr-forged','amalay','abierta',null);
    raise exception 'P2 forged-qr FAIL: authenticated pudo forjar un borrador QR turno-null';
  exception when insufficient_privilege then raise notice 'P2 PASS (RLS bloqueó la procedencia QR forjada)';
  end;
end $$;
reset role;

-- P3 — Borrador QR AUTÉNTICO (abierta, turno NULL) por service_role (el endpoint) → PERMITIDO.
set role service_role;
do $$ begin
  insert into public.pos_orders(id,client_id,status,turno_id,total) values('qr-real123','amalay','abierta',null,116);
  raise notice 'P3 PASS (service_role creó el borrador QR auténtico turno-null)';
exception when others then raise exception 'P3 FAIL: service_role no pudo crear el borrador QR: %', sqlerrm;
end $$;
reset role;

-- P4 — Enviar/cobrar/imprimir SIN turno → RECHAZADO. Transición fuera de 'abierta' con turno NULL.
set role service_role;
do $$ begin
  begin
    update public.pos_orders set status='enviada' where id='qr-real123';   -- turno sigue NULL
    raise exception 'P4 send-without-turno FAIL: se permitió salir de abierta sin turno';
  exception when check_violation then raise notice 'P4 PASS (CHECK rechazó la transición sin turno)';
  end;
end $$;
reset role;

-- P5 — Aceptación del staff: asigna el turno y transiciona ATÓMICAMENTE (mismo UPDATE).
--      Modela el efecto del server-mediated adopt (turno resuelto server-side + status).
set role service_role;
do $$ begin
  update public.pos_orders set status='enviada', turno_id='t-amalay' where id='qr-real123';
  if (select turno_id from public.pos_orders where id='qr-real123')='t-amalay'
     and (select status from public.pos_orders where id='qr-real123')='enviada'
  then raise notice 'P5 PASS (aceptación asignó turno y transicionó atómicamente)';
  else raise exception 'P5 FAIL: turno/status no quedaron correctamente asignados';
  end if;
end $$;
reset role;

-- P6 — Replay del mismo submission (mismo id, ON CONFLICT DO NOTHING como el endpoint):
--      NO duplica ni sobrescribe la orden ya enviada/editada.
set role service_role;
do $$
declare cnt int; st text;
begin
  insert into public.pos_orders(id,client_id,status,turno_id,total)
    values('qr-real123','amalay','abierta',null,999)
    on conflict (id) do nothing;
  select count(*), max(status) into cnt, st from public.pos_orders where id='qr-real123';
  if cnt=1 and st='enviada'
  then raise notice 'P6 PASS (replay no duplicó ni sobrescribió la orden ya enviada)';
  else raise exception 'P6 FAIL: replay duplicó/sobrescribió (cnt=%, status=%)', cnt, st;
  end if;
end $$;
reset role;

\echo '===== procedencia del turno: 6/6 evaluadas ====='
