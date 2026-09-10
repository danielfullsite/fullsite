'use strict'
const { spawnSync, spawn } = require('node:child_process')
const assert = require('node:assert/strict'), fs = require('node:fs')
const socket=process.argv[2]
if(!/^\/tmp\/fullsite-inventory-pg-[a-zA-Z0-9]+$/.test(socket||'') || !fs.existsSync(socket+'/data/PG_VERSION')) throw new Error('private disposable cluster required')
const bin=process.env.FULLSITE_TEST_PSQL
const args=['-X','-h',socket,'-p','5432','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At']
const quote=x=>"'"+String(x).replaceAll("'","''")+"'"
function sql(query){const r=spawnSync(bin,args,{input:query,encoding:'utf8'});if(r.status)throw new Error(r.stderr);return r.stdout.trim()}
function concurrent(query){return new Promise(resolve=>{const child=spawn(bin,args);let output='',error='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>error+=x);child.on('close',code=>resolve({code,output,error}));child.stdin.end(query)})}
const call=(key,lines,type='entry',client='a')=>`select public.pos_record_inventory_movement(${quote(client)},'verified-manager',${quote(type)},${quote(JSON.stringify(lines))}::jsonb,${quote(key)});`
const line=(id,quantity,unit_cost)=>({ingredient_id:id,quantity,...(unit_cost===undefined?{}:{unit_cost})})
const balance=id=>Number(sql(`select stock from pos_inventory where ingredient_id=${quote(id)}`))
async function main(){
  sql(`insert into pos_ingredients(id,client_id,name,unit,cost_per_unit) values('a1','a','One','KG',2),('a2','a','Two','KG',5),('b1','b','Other','KG',9);
    insert into pos_inventory(client_id,ingredient_id,stock) values('a','a1',10),('a','a2',10),('b','b1',10);`)
  // Ignore the committed first response to model an ACK lost on the network.
  sql(call('lost-response',[line('a1',10,4)]))
  const replay=JSON.parse(sql(call('lost-response',[line('a1',10,4)])))
  assert.equal(JSON.parse(sql(call('lost-response',[line('a1',10,4)]).replace("'verified-manager'","'replacement-manager'"))).was_duplicate,true)
  assert.equal(sql("select actor from pos_inventory_movements where movement_operation_key='lost-response' and client_id='a'"),'verified-manager')
  assert.equal(replay.was_duplicate,true);assert.equal(balance('a1'),20);assert.equal(replay.details[0].cost_after,3)
  assert.equal(sql("select count(*) from pos_inventory_movements where movement_operation_key='lost-response'"),'1')
  assert.throws(()=>sql(call('lost-response',[line('a1',11,4)])),/MOVEMENT_KEY_REUSED/)
  sql(call('lost-response-long',[line('a1',1,0)]))
  sql(call('lost-response',[line('b1',1,1)],'entry','b'))
  assert.equal(balance('a1'),21);assert.equal(balance('b1'),11)
  console.log('PASS exact tenant/key replay, lost response and changed intent')
  sql("insert into pos_inventory_movements(client_id,ingredient_id,movement_type,quantity,notes) values('a','a1','entry',0,'legacy [key:legacy%_key]'),('a','a1','entry',0,'legacy [key:cfdi_ABC-123]');")
  assert.throws(()=>sql(call('legacy%_key',[line('a1',1)])),/LEGACY_MOVEMENT_REQUIRES_RECONCILIATION/)
  assert.throws(()=>sql(call('cfdi:abc-123',[line('a1',1)])),/LEGACY_MOVEMENT_REQUIRES_RECONCILIATION/)
  assert.equal(balance('a1'),21)
  assert.equal(sql("select count(*) from pos_inventory_movement_operations where idempotency_key in ('legacy%_key','cfdi:abc-123')"),'0')
  // No prefix match, no LIKE wildcards, and no other-tenant false positive.
  sql(call('legacy%_key-extra',[line('a2',1)]))
  sql(call('legacy%Xkey',[line('a2',1)]))
  sql(call('legacy%_key',[line('b1',1)],'entry','b'))
  console.log('PASS legacy exact delimiters, literal metacharacters, CFDI aliases and tenant isolation')

  const repeated=JSON.parse(sql(call('invoice-lines',[line('a1',2,4),line('a1',3,6)])))
  assert.equal(repeated.movements_created,2);assert.equal(balance('a1'),26)
  assert(Math.abs(repeated.details[1].cost_after-(21*3+2*4+3*6)/26)<1e-10)
  assert.equal(repeated.details[1].stock_before,23)
  assert.equal(sql("select count(*) from pos_inventory_movements where movement_operation_key='invoice-lines'"),'2')
  console.log('PASS repeated invoice ingredients preserve each line and weighted-average cost')
  sql("insert into pos_ingredients(id,client_id,name,unit,cost_per_unit) values('empty','a','Empty','KG',99); insert into pos_inventory(client_id,ingredient_id,stock) values('a','empty',0);")
  assert.equal(JSON.parse(sql(call('empty-entry',[line('empty',0.5,4)]))).details[0].cost_after,4)
  assert.equal(JSON.parse(sql(call('unpriced-entry',[line('empty',1.25,0)]))).details[0].cost_after,4)
  assert.equal(balance('empty'),1.75)
  console.log('PASS empty-stock adoption, fractional quantities and zero-price cost preservation')
  const before=balance('a1'),ledger=sql('select count(*) from pos_inventory_movements')
  assert.throws(()=>sql(call('insufficient',[line('a1',-1),line('a2',-100)],'waste')),/INSUFFICIENT_STOCK/)
  assert.equal(balance('a1'),before);assert.equal(balance('a2'),12);assert.equal(sql('select count(*) from pos_inventory_movements'),ledger)
  assert.equal(sql("select count(*) from pos_inventory_movement_operations where idempotency_key='insufficient'"),'0')
  sql(`create function reject_inventory_cost() returns trigger language plpgsql as $$begin raise exception 'simulated cost write failure'; end$$;
    create trigger fail_cost before update on pos_ingredients for each row execute function reject_inventory_cost();`)
  assert.throws(()=>sql(call('cost-failure',[line('a1',1,100)])),/simulated cost write failure/)
  assert.equal(balance('a1'),before);assert.equal(sql('select count(*) from pos_inventory_movements'),ledger)
  sql('drop trigger fail_cost on pos_ingredients; drop function reject_inventory_cost();')
  console.log('PASS insufficient stock and late cost failures roll back ledger, stock and receipt')
  for(const lines of [[line('a1',-1,2)],[line('a1',1,-1)],[line('a1',0)],[{ingredient_id:'a1',quantity:'1'}]]) assert.throws(()=>sql(call('invalid',lines)),/INVALID_/)
  assert.throws(()=>sql(call('foreign',[line('b1',1)])),/INGREDIENT_SCOPE_CONFLICT/)
  for(const role of ['anon','authenticated']) assert.throws(()=>sql(`set role ${role}; `+call('role',[line('a1',1)])),/permission denied/)
  assert(sql('set role service_role; '+call('service',[line('a1',1)])).includes('"success": true'))
  console.log('PASS quantities, costs, tenant ingredients and direct browser roles validated')
  const raceBefore=balance('a2')
  const race=await Promise.all([concurrent(call('race-one',[line('a2',2)])),concurrent(call('race-two',[line('a2',3)]))])
  assert(race.every(r=>r.code===0),JSON.stringify(race));assert.equal(balance('a2'),raceBefore+5)
  const same=await Promise.all([concurrent(call('race-same',[line('a2',1)])),concurrent(call('race-same',[line('a2',1)]))])
  assert(same.every(r=>r.code===0));assert.equal(same.filter(r=>JSON.parse(r.output).was_duplicate).length,1)
  assert.equal(balance('a2'),raceBefore+6)
  const reverse=await Promise.all([concurrent(call('batch-ab',[line('a1',1),line('a2',1)])),concurrent(call('batch-ba',[line('a2',1),line('a1',1)]))])
  assert(reverse.every(r=>r.code===0),JSON.stringify(reverse))
  assert.equal(sql("select stock=10+(select sum(quantity) from pos_inventory_movements where ingredient_id='a1') from pos_inventory where ingredient_id='a1'"),'t')
  console.log('PASS concurrent deltas, same-key races, reversed batch lock ordering and ledger-stock conservation')
}
main().catch(error=>{console.error(error);process.exitCode=1})
