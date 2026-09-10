'use strict'
const { spawnSync, spawn } = require('node:child_process')
const assert = require('node:assert/strict'), fs = require('node:fs')
const socket=process.argv[2]
if(!/^\/tmp\/fullsite-reconcile-pg-[a-zA-Z0-9]+$/.test(socket||'') || !fs.existsSync(socket+'/data/PG_VERSION')) throw new Error('private disposable cluster required')
const bin=process.env.FULLSITE_TEST_PSQL
const args=['-X','-h',socket,'-p','5432','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At']
const quote=x=>"'"+String(x).replaceAll("'","''")+"'"
function sql(query){const r=spawnSync(bin,args,{input:query,encoding:'utf8'});if(r.status)throw new Error(r.stderr);return r.stdout.trim()}
function concurrent(query){return new Promise(resolve=>{const child=spawn(bin,args);let output='',error='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>error+=x);child.on('close',code=>resolve({code,output,error}));child.stdin.end(query)})}
const call=(id='sale',tenant='a')=>`select * from r1_reconcile_order(${quote(tenant)},${quote(id)});`
const stock=()=>Number(sql("select stock from pos_inventory where ingredient_id='flour'"))
const item={id:'line-1',menuItemId:'bread',cantidad:2,subtotal:20}
async function main(){
 sql(`insert into clients(id,display_name,iva_rate) values('a','Lab A',0);
 insert into pos_ingredients(id,client_id,name,unit) values('flour','a','Flour','kg');
 insert into pos_inventory(client_id,ingredient_id,stock,stock_unit) values('a','flour',10,'kg');
 insert into pos_mutation_authority(client_id,sale_authority) values('a','r1');
 insert into pos_item_inventory_policy(client_id,menu_item_id,inventory_mode,approved_at,approved_by) values('a','bread','recipe',now(),'manager');
 insert into pos_recipe_versions(id,client_id,menu_item_id,active,source,created_by,activated_at,activated_by) values(1,'a','bread',true,'manual','manager',now(),'manager');
 insert into pos_recipe_lines(client_id,recipe_version_id,ingredient_id,quantity,recipe_unit) values('a',1,'flour',0.25,'kg');
 insert into pos_orders(id,client_id,turno_id,items,order_revision) values('sale','a','test-turn',${quote(JSON.stringify([{id:'course',menuItemId:'__tiempo__',cantidad:1,subtotal:0},item]))}::jsonb,1);`)
 sql(call()); assert.equal(stock(),9.5)
 sql(call()); assert.equal(stock(),9.5)
 assert.equal(sql('select count(*) from pos_inventory_movements'),'1')
 console.log('PASS committed recipe consumption and exact repeat do not deduct twice')
 // Change current recipe while preserving historical pin. Cancellation must undo
 // the actual original consumption, not today's recipe quantity.
 sql("update pos_recipe_versions set active=false,deactivated_at=now(),deactivated_by='manager' where id=1;")
 sql(`update pos_orders set items=${quote(JSON.stringify([{...item,cancelled:true,inventory_disposition:'return_stock'}]))}::jsonb,order_revision=2 where id='sale';`)
 const results=await Promise.all([concurrent(call()),concurrent(call())]); assert(results.every(r=>r.code===0),JSON.stringify(results))
 assert.equal(stock(),10); assert.equal(sql('select count(*) from pos_inventory_movements'),'2')
 assert.equal(sql("select last_inventory_complete_revision from pos_orders where id='sale'"),'2')
 assert.equal(sql('select applied_consumption from pos_reconciliation_results'),'0')
 console.log('PASS cancelled flag returns original pinned consumption once across concurrent retries')
 // Historical double encoded JSONB is normalized, not mistaken for no items.
 sql(`update pos_orders set items=${quote(JSON.stringify(JSON.stringify([{...item,cancelled:true,inventory_disposition:'return_stock'}])))}::jsonb where id='sale';`)
 sql(call()); assert.equal(stock(),10)
 sql(`update pos_orders set items='{"wrong":"shape"}'::jsonb where id='sale';`)
 assert.throws(()=>sql(call()),/INVALID_ORDER_ITEMS/); assert.equal(stock(),10)
 sql(`update pos_orders set items=${quote(JSON.stringify([item,item]))}::jsonb where id='sale';`)
 assert.throws(()=>sql(call()),/DUPLICATE_ORDER_ITEM_IDENTITY/); assert.equal(stock(),10)
 assert.equal(sql('select count(*) from pos_inventory_movements'),'2')
 console.log('PASS malformed and duplicate identities cannot fabricate consumption or returns')
 assert.throws(()=>sql(call('sale','b')),/not found/)
 for(const role of ['anon','authenticated']) assert.throws(()=>sql(`set role ${role}; `+call()),/permission denied/)
 console.log('PASS reconciliation uses tenant-owned order and excludes direct browser execution')
 sql(`insert into pos_orders(id,client_id,turno_id,items,order_revision) values('blocked','a','test-turn',${quote(JSON.stringify([{id:'unknown',menuItemId:'unknown',cantidad:1}]))}::jsonb,1);`)
 assert(sql(call('blocked')).includes('BLOCKED_UNCLASSIFIED'))
 assert.equal(sql("select coalesce(last_inventory_complete_revision,0)=0 from pos_orders where id='blocked'"),'t')
 assert.equal(stock(),10)
 console.log('PASS missing classification remains explicitly blocked without stock mutation')
 sql("update pos_recipe_versions set active=true,deactivated_at=null,deactivated_by=null where id=1;")
 sql(`insert into pos_orders(id,client_id,turno_id,location_id,mesa,items,subtotal,total,order_revision) values('transfer-source','a','test-turn','lab-branch',1,${quote(JSON.stringify([item]))}::jsonb,20,20,1);`)
 sql(call('transfer-source')); assert.equal(stock(),9.5)
 const intent=sql("select id from pos_reconciliation_results where order_id='transfer-source'")
 const moved=JSON.parse(sql("select r1_transfer_item_atomic('a','transfer-1','transfer-source','line-1',2,'manager');"))
 assert.equal(stock(),9.5)
 assert.equal(sql(`select id from pos_reconciliation_results where order_id=${quote(moved.target_order_id)}`),intent)
 sql(call('transfer-source')); sql(call(moved.target_order_id)); assert.equal(stock(),9.5)
 sql(`update pos_orders set items=${quote(JSON.stringify([{...item,cancelled:true,inventory_disposition:'return_stock'}]))}::jsonb,order_revision=order_revision+1 where id=${quote(moved.target_order_id)};`)
 sql(call(moved.target_order_id)); sql(call(moved.target_order_id)); assert.equal(stock(),10)
 assert.equal(Number(sql(`select sum(quantity) from pos_inventory_movements where reconciliation_result_id=${intent}`)),0)
 console.log('PASS transfer preserves consumption provenance; source replay does not return stock and target cancellation returns once')
 sql(`insert into pos_orders(id,client_id,turno_id,items,order_revision) values('prepared','a','test-turn',${quote(JSON.stringify([item]))}::jsonb,1);`)
 sql(call('prepared')); assert.equal(stock(),9.5)
 sql(`update pos_orders set items=${quote(JSON.stringify([{...item,cancelled:true,inventory_disposition:'retain_consumption'}]))}::jsonb,order_revision=2 where id='prepared';`)
 sql(call('prepared')); assert.equal(stock(),9.5)
 sql("update pos_orders set items='[]'::jsonb,order_revision=3 where id='prepared';")
 sql(call('prepared')); assert.equal(stock(),9.5)
 assert.equal(sql("select applied_consumption from pos_reconciliation_results where order_id='prepared'"),'2')
 sql(`update pos_orders set items=${quote(JSON.stringify([{...item,cancelled:true}]))}::jsonb where id='prepared';`)
 assert.throws(()=>sql(call('prepared')),/CANCELLATION_DISPOSITION_REQUIRED/); assert.equal(stock(),9.5)
 console.log('PASS prepared cancellation retains physical consumption after removal; unspecified disposition stays pending')

 sql(`insert into pos_orders(id,client_id,turno_id,items,order_revision) values('whole-void','a','test-turn',${quote(JSON.stringify([item]))}::jsonb,1);`)
 sql(call('whole-void')); assert.equal(stock(),9)
 sql("update pos_orders set status='cancelada',order_revision=2 where id='whole-void';")
 assert.throws(()=>sql(call('whole-void')),/CANCELLATION_DISPOSITION_REQUIRED/)
 assert.equal(stock(),9)
 assert.equal(sql("select last_inventory_complete_revision from pos_orders where id='whole-void'"),'1')
 sql(`update pos_orders set items=${quote(JSON.stringify([{...item,inventory_disposition:'retain_consumption'}]))}::jsonb where id='whole-void';`)
 sql(call('whole-void')); sql(call('whole-void')); assert.equal(stock(),9)
 sql("update pos_orders set items='[]'::jsonb,order_revision=3 where id='whole-void';")
 sql(call('whole-void')); assert.equal(stock(),9)
 sql(`insert into pos_orders(id,client_id,turno_id,items,order_revision) values('whole-return','a','test-turn',${quote(JSON.stringify([item]))}::jsonb,1);`)
 sql(call('whole-return')); assert.equal(stock(),8.5)
 sql("update pos_orders set status='cancelada',items='[]'::jsonb,order_revision=2 where id='whole-return';")
 assert.throws(()=>sql(call('whole-return')),/CANCELLATION_DISPOSITION_REQUIRED/); assert.equal(stock(),8.5)
 sql(`update pos_orders set items=${quote(JSON.stringify([{...item,inventory_disposition:'return_stock'}]))}::jsonb where id='whole-return';`)
 const returns=await Promise.all([concurrent(call('whole-return')),concurrent(call('whole-return'))])
 assert(returns.every(r=>r.code===0),JSON.stringify(returns)); assert.equal(stock(),9)
 console.log('PASS whole-order void never invents a return; explicit disposition survives removal and concurrent retries')


}
main().catch(error=>{console.error(error);process.exitCode=1})
