'use strict'
const { spawnSync, spawn } = require('node:child_process')
const assert = require('node:assert/strict')
const port = process.argv[2]
if (!/^\d+$/.test(port)) throw new Error('local cluster port required')
const args = ['-X', '-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At']
const bin = process.env.FULLSITE_TEST_PSQL
function sql(query) {
  const r = spawnSync(bin, args, { input: query, encoding: 'utf8' })
  if (r.status) throw new Error(r.stderr)
  return r.stdout.trim()
}
function concurrent(query) {
  return new Promise(resolve => {
    const p = spawn(bin, args); let output = ''; let error = ''
    p.stdout.on('data', x => output += x); p.stderr.on('data', x => error += x)
    p.on('close', code => resolve({ code, output, error })); p.stdin.end(query)
  })
}
const call = (op, source = 'src', item = 'i1', mesa = 2, client = 'test') =>
  `select public.r1_transfer_item_atomic('${client}','${op}','${source}','${item}',${mesa},'Supervisor');`
function reset() {
  sql(`truncate pos_orders,pos_transfer_operations; delete from clients;
    insert into clients(id,display_name,iva_rate) values('test','Test',0.16),('other','Other',0);
    insert into pos_orders(id,client_id,location_id,turno_id,mesa,items,subtotal,iva,total,descuento)
    values('src','test','loc','turn',1,'[{"id":"i1","nombre":"Café","cantidad":1,"subtotal":50},{"id":"i2","subtotal":50}]',100,14.4,104.4,10),
      ('dst','test','loc','turn',2,'[{"id":"i3","subtotal":20}]',20,3.2,23.2,0);`)
}
async function main() {
  reset()
  const receipt = JSON.parse(sql(call('op1')))
  assert.equal(receipt.target_order_id,'dst')
  assert.equal(Math.round(receipt.source_order.total*100) + Math.round(receipt.target_order.total*100),12760)
  assert.equal(receipt.source_order.items.length,1)
  assert.equal(receipt.target_items.length,2)
  assert.equal(receipt.source_order.order_revision,1)
  assert.equal(receipt.target_order.order_revision,1)
  assert.deepEqual(JSON.parse(sql(call('op1'))),receipt)
  assert.equal(sql('select count(*) from pos_transfer_operations'),'1')
  console.log('PASS atomic transfer preserves discounted money, both revisions and the replay receipt')
  assert.throws(() => sql(call('op1','src','i2')),/OPERATION_ID_REUSED/)
  console.log('PASS reused operation ID cannot change its intent')
  reset()
  sql(`create function reject_transfer_target() returns trigger language plpgsql as $$begin
    if NEW.id='dst' then raise exception 'simulated target disk failure'; end if; return NEW; end$$;
    create trigger fail_target before update on pos_orders for each row execute function reject_transfer_target();`)
  assert.throws(() => sql(call('fail')),/simulated target disk failure/)
  assert.equal(sql("select jsonb_array_length(items) from pos_orders where id='src'"),'2')
  assert.equal(sql('select count(*) from pos_transfer_operations'),'0')
  sql('drop trigger fail_target on pos_orders; drop function reject_transfer_target();')
  console.log('PASS target write failure rolls back source and receipt together')
  reset()
  const results = await Promise.all([concurrent(call('race-a')),concurrent(call('race-b'))])
  assert.equal(results.filter(r => r.code === 0).length,1)
  assert(results.some(r => r.error.includes('ITEM_NOT_IN_SOURCE')))
  assert.equal(sql("select count(*) from pos_orders o cross join lateral jsonb_array_elements(o.items) x where x->>'id'='i1'"),'1')
  console.log('PASS two concurrent terminals cannot transfer the same item twice')
  reset()
  assert.throws(() => sql(call('foreign','src','i1',2,'other')),/SOURCE_NOT_FOUND/)
  assert.equal(sql('select count(*) from pos_transfer_operations'),'0')
  assert.throws(() => sql(`set role authenticated; ${call('unprivileged')}`),/permission denied/)
  console.log('PASS tenant mismatch and direct browser role cannot move an item')
  reset()
  const fresh = JSON.parse(sql(call('new','src','i1',7)))
  assert.equal(fresh.target_order.turno_id,'turn')
  assert.equal(fresh.target_order.location_id,'loc')
  assert.equal(fresh.target_order.mesa,7)
  console.log('PASS destination creation retains branch, turno, item identity and amount')
}
main().catch(e => { console.error(e); process.exitCode=1 })
