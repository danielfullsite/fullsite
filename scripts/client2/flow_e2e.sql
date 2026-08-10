-- Client #2 (lacosta) — END-TO-END flow on hosted STAGING, mirroring the app server routes.
-- turno -> order -> KDS(enviada) -> cobro(cobrada) -> corte(cerrada + cierre). Uses the SAME
-- r1_save_order RPC the app's /api/pos/save-order route calls; turno/print/cierre are table writes.
-- Idempotent. STAGING jkcnxfbbuyyfhwfjizgw ONLY.
do $$
declare cid text := 'lacosta'; v jsonb; rev bigint;
  items jsonb := jsonb_build_array(
    jsonb_build_object('id','li1','menuItemId','lacosta-item-ceviche','nombre','Ceviche de la casa','precio',145,'cantidad',1,'modificadores','[]'::jsonb,'notas','','precioExtra',0,'subtotal',145),
    jsonb_build_object('id','li2','menuItemId','lacosta-item-limonada','nombre','Limonada natural','precio',55,'cantidad',2,'modificadores','[]'::jsonb,'notas','','precioExtra',0,'subtotal',110)
  );
begin
  delete from pos_print_jobs where client_id=cid and order_id='lacosta-o1';
  delete from pos_cierres where client_id=cid and turno_id='lacosta-t1';
  delete from pos_reconciliation_results where client_id=cid and order_id='lacosta-o1';
  delete from pos_orders where client_id=cid and id='lacosta-o1';
  delete from pos_turnos where client_id=cid and id='lacosta-t1';

  -- 1) ABRIR TURNO
  insert into pos_turnos (id, client_id, opened_by, fondo_inicial, opened_at)
    values ('lacosta-t1', cid, 'Ana Dueña', 1000, now());

  -- 2) CREAR + ENVIAR A COCINA (KDS) -> status 'enviada'
  v := r1_save_order(cid,'lacosta-o1',0,3,'Cliente Mesa 3','Diego Mesero',2,'enviada',255,40.8,295.8,0,0,null,null,'lacosta-t1',null,items,null);
  rev := coalesce((v->>'revision')::bigint,1);
  begin perform r1_reconcile_order(cid,'lacosta-o1'); exception when others then null; end;
  insert into pos_print_jobs (id, client_id, order_id, station, type, status, meta, created_at, printed_at, updated_at, comanda_batch_id, reprint_seq)
    values (gen_random_uuid(), cid, 'lacosta-o1', 'cocina', 'comanda', 'done', jsonb_build_object('simulated',true), now(), now(), now(), 'cb-lacosta-1', 1);

  -- 3) COBRAR (efectivo $295.80 + propina $30) -> status 'cobrada'
  v := r1_save_order(cid,'lacosta-o1',rev,3,'Cliente Mesa 3','Diego Mesero',2,'cobrada',255,40.8,295.8,0,30,'Efectivo',
        jsonb_build_array(jsonb_build_object('metodo','Efectivo','monto',295.8)),'lacosta-t1',null,items,now());
  rev := coalesce((v->>'revision')::bigint,rev+1);
  insert into pos_print_jobs (id, client_id, order_id, station, type, status, meta, created_at, printed_at, updated_at, comanda_batch_id, reprint_seq)
    values (gen_random_uuid(), cid, 'lacosta-o1', 'caja', 'receipt', 'done', jsonb_build_object('simulated',true,'total',295.8,'propina',30), now(), now(), now(), null, 1);

  -- 4) CERRAR ORDEN + CORTE DE TURNO
  v := r1_save_order(cid,'lacosta-o1',rev,3,'Cliente Mesa 3','Diego Mesero',2,'cerrada',255,40.8,295.8,0,30,'Efectivo',
        jsonb_build_array(jsonb_build_object('metodo','Efectivo','monto',295.8)),'lacosta-t1',null,items,now());
  update pos_turnos set closed_at=now(), closed_by='Ana Dueña', fondo_final=1325.8, efectivo_sistema=295.8, diferencia=0
    where id='lacosta-t1' and client_id=cid;
  insert into pos_cierres (id, fecha, turno_id, client_id, closed_by, approved_by, sealed_at, created_at,
      total_ventas, efectivo_sistema, tarjeta_sistema, transferencias_sistema, propinas, descuentos, cancelaciones,
      fondo_inicial, total_contado, diferencia, tickets_count, ordenes_pendientes, cierre_con_ordenes_abiertas, snapshot)
    values ('lacosta-c1', current_date, 'lacosta-t1', cid, 'Ana Dueña', 'Ana Dueña', now(), now(),
      295.8, 295.8, 0, 0, 30, 0, 0, 1000, 1325.8, 0, 1, '{}'::text[], false,
      jsonb_build_object('source','client2-e2e','version','lacosta.v1','business_date',current_date::text,
        'business_date_config', jsonb_build_object('boundary','04:00:00','timezone','America/Monterrey','degraded',false)));
end $$;
