-- Transferencia de platillos — reproducible demo on staging (tenant lacosta).
-- Mirrors dashboard-app/src/app/api/pos/transfer-item/route.ts (atomic OCC move between orders).
-- STAGING jkcnxfbbuyyfhwfjizgw ONLY. Idempotent. Leaves a demo-ready state at the end.
-- SETUP: open turno + two open orders (Mesa 3 = Ceviche+Limonada, Mesa 5 = Pescado).
do $$
declare cid text := 'lacosta';
  itemsA jsonb := jsonb_build_array(
    jsonb_build_object('id','A-ceviche','menuItemId','lacosta-item-ceviche','nombre','Ceviche de la casa','precio',145,'cantidad',1,'modificadores','[]'::jsonb,'notas','','precioExtra',0,'subtotal',145),
    jsonb_build_object('id','A-limonada','menuItemId','lacosta-item-limonada','nombre','Limonada natural','precio',55,'cantidad',1,'modificadores','[]'::jsonb,'notas','','precioExtra',0,'subtotal',55));
  itemsB jsonb := jsonb_build_array(
    jsonb_build_object('id','B-pescado','menuItemId','lacosta-item-pescado','nombre','Pescado a la talla','precio',285,'cantidad',1,'modificadores','[]'::jsonb,'notas','','precioExtra',0,'subtotal',285));
begin
  delete from pos_orders where client_id=cid and id in ('lacosta-A','lacosta-B');
  delete from pos_turnos where client_id=cid and id='lacosta-t2';
  insert into pos_turnos (id, client_id, opened_by, fondo_inicial, opened_at) values ('lacosta-t2', cid, 'Ana Dueña', 1000, now());
  perform r1_save_order(cid,'lacosta-A',0,3,'Mesa 3','Diego Mesero',2,'enviada',200,32,232,0,0,null,null,'lacosta-t2',null,itemsA,null);
  perform r1_save_order(cid,'lacosta-B',0,5,'Mesa 5','Diego Mesero',2,'enviada',285,45.6,330.6,0,0,null,null,'lacosta-t2',null,itemsB,null);
end $$;

-- TRANSFER: move 'A-ceviche' from order A (Mesa 3) to Mesa 5's open order, with OCC on updated_at.
do $$
declare cid text := 'lacosta';
  src_items jsonb; tgt_items jsonb; src_ts timestamptz; tgt_ts timestamptz; moved jsonb; new_src jsonb; new_tgt jsonb; n int;
begin
  select items::jsonb, updated_at into src_items, src_ts from pos_orders where client_id=cid and id='lacosta-A';
  select x into moved from jsonb_array_elements(src_items) x where x->>'id'='A-ceviche';
  if moved is null then raise exception 'ITEM_NOT_IN_SOURCE';  -- replay-safe: item already moved
  end if;
  select items::jsonb, updated_at into tgt_items, tgt_ts from pos_orders where client_id=cid and mesa=5 and status in ('abierta','enviada','preparando','lista') order by created_at desc limit 1;
  select jsonb_agg(x) into new_src from jsonb_array_elements(src_items) x where x->>'id' <> 'A-ceviche';
  new_tgt := coalesce(tgt_items,'[]'::jsonb) || jsonb_build_array(moved);
  update pos_orders set items=new_src, updated_at=now() where client_id=cid and id='lacosta-A' and updated_at=src_ts;
  get diagnostics n = row_count; if n=0 then raise exception 'SOURCE_CONFLICT'; end if;   -- OCC guard
  update pos_orders set items=new_tgt, updated_at=now() where client_id=cid and id='lacosta-B' and updated_at=tgt_ts;
  get diagnostics n = row_count; if n=0 then raise exception 'TARGET_CONFLICT'; end if;   -- OCC guard + rollback in route
  insert into pos_audit_log (client_id, action, actor) values (cid, 'item_transferred', 'Ana Dueña');
end $$;

-- VERIFY conservation (expect A=1[A-limonada], B=2[B-pescado,A-ceviche], ceviche_occurrences=1, total=3, still_in_source=false):
with a as (select items::jsonb i from pos_orders where id='lacosta-A'), b as (select items::jsonb i from pos_orders where id='lacosta-B')
select (select jsonb_array_length(i) from a) a_count,
  (select jsonb_agg(x->>'id') from a,jsonb_array_elements(i) x) a_ids,
  (select jsonb_array_length(i) from b) b_count,
  (select jsonb_agg(x->>'id') from b,jsonb_array_elements(i) x) b_ids,
  (select count(*) from (select x->>'id' id from a,jsonb_array_elements(i) x union all select x->>'id' from b,jsonb_array_elements(i) x) u where u.id='A-ceviche') ceviche_occurrences,
  ((select jsonb_array_length(i) from a)+(select jsonb_array_length(i) from b)) total_items_after;

-- RESET to demo-ready (Ceviche back on Mesa 3, Mesa 5 = Pescado) so the founder transfers it live:
update pos_orders set items=jsonb_build_array(
    jsonb_build_object('id','A-ceviche','menuItemId','lacosta-item-ceviche','nombre','Ceviche de la casa','precio',145,'cantidad',1,'modificadores','[]'::jsonb,'notas','','precioExtra',0,'subtotal',145),
    jsonb_build_object('id','A-limonada','menuItemId','lacosta-item-limonada','nombre','Limonada natural','precio',55,'cantidad',1,'modificadores','[]'::jsonb,'notas','','precioExtra',0,'subtotal',55)), updated_at=now()
  where client_id='lacosta' and id='lacosta-A';
update pos_orders set items=jsonb_build_array(
    jsonb_build_object('id','B-pescado','menuItemId','lacosta-item-pescado','nombre','Pescado a la talla','precio',285,'cantidad',1,'modificadores','[]'::jsonb,'notas','','precioExtra',0,'subtotal',285)), updated_at=now()
  where client_id='lacosta' and id='lacosta-B';
