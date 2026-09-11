'use strict'
const {spawnSync,spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
const socket=process.argv[2],bin=process.env.FULLSITE_TEST_PSQL
if(!/^\/tmp\/fullsite-provision-pg-[a-zA-Z0-9]+$/.test(socket||'')||!fs.existsSync(socket+'/data/PG_VERSION'))throw new Error('Private disposable cluster required')
const args=['-X','-qAt','-h',socket,'-p','5432','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],q=v=>"'"+String(v).replaceAll("'","''")+"'"
function sql(statement){const r=spawnSync(bin,args,{input:statement,encoding:'utf8'});if(r.status)throw new Error(r.stderr);return r.stdout.trim()}
function concurrent(statement){return new Promise(resolve=>{const child=spawn(bin,args);let output='',error='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>error+=x);child.on('close',code=>resolve({code,output,error}));child.stdin.end(statement)})}
let policyId=1
function seed(id){sql(`insert into clients(id,display_name,active,provisioning_state,mesas) values(${q(id)},'Fixture',false,'pending',0);
 insert into client_locations(id,client_id,name) values(${q(id+'-loc')},${q(id)},'Principal');
 insert into pos_menu_categories(id,client_id,name) values(${q(id+'-cat')},${q(id)},'Category');
 insert into pos_menu_items(id,client_id,category_id,name) values(${q(id+'-item')},${q(id)},${q(id+'-cat')},'Item');
 insert into pos_payment_methods(id,client_id,name) values(${q(id+'-pm')},${q(id)},'Cash');
 insert into pos_staff(id,client_id,name,pin,role,active) values(${q(id+'-staff')},${q(id)},'Inactive template','1234567890','gerente',false);
 insert into pos_mutation_authority(client_id,sale_authority) values(${q(id)},'r1');
 insert into pos_item_inventory_policy(id,client_id,menu_item_id,inventory_mode,approved_at,approved_by) values(${policyId++},${q(id)},${q(id+'-item')},'non_inventory',now(),'fixture');`)}
const activate=(id,owner,service)=>`select pos_activate_provisioned_tenant(${q(id)},${q(owner)}::uuid,${service?q(service)+'::uuid':'null'});`
const ready=id=>sql(`set role service_role; select pos_mark_tenant_provisioned(${q(id)});`)
async function main(){
 const owner=randomUUID(),service=randomUUID(),other=randomUUID();sql(`insert into auth.users values(${q(owner)}),(${q(service)}),(${q(other)});`)
 seed('first')
 assert.throws(()=>sql(activate('first',owner,service)),/TENANT_NOT_READY/)
 assert.equal(sql("select count(*) from client_users where client_id='first'"),'0');assert.equal(sql("select active from clients where id='first'"),'f')
 ready('first');sql("delete from pos_payment_methods where client_id='first'")
 assert.throws(()=>sql(activate('first',owner,service)),/TENANT_SKELETON_INCOMPLETE/)
 assert.equal(sql("select count(*) from client_users where client_id='first'"),'0')
 sql("insert into pos_payment_methods(id,client_id,name) values('first-pm','first','Cash')")
 const committed=JSON.parse(sql('set role service_role; '+activate('first',owner,service)));assert.deepEqual(committed,{activated:true,active:true,provisioning_state:'complete',staff_setup_required:true})
 assert.equal(sql("select count(*) from client_users where client_id='first'"),'2')
 const retry=JSON.parse(sql(activate('first',owner,service)));assert.equal(retry.activated,false);assert.equal(retry.staff_setup_required,true)
 assert.equal(sql("select count(*) from pos_staff where client_id='first' and active"),'0')
 sql("insert into pos_staff(id,client_id,name,pin,role,active) values('first-real','first','Real cashier','5678','cajero',true)")
 assert.equal(JSON.parse(sql(activate('first',owner,service))).staff_setup_required,false)
 console.log('PASS readiness and memberships commit with activation; lost ACK retry remains exact')
 seed('conflict');ready('conflict');sql(`insert into client_users(user_id,client_id,role) values(${q(service)},'conflict','mesero')`)
 assert.throws(()=>sql(activate('conflict',owner,service)),/PROVISION_MEMBERSHIP_ROLE_CONFLICT/)
 assert.equal(sql(`select count(*) from client_users where client_id='conflict' and user_id=${q(owner)}`),'0')
 assert.equal(sql("select active from clients where id='conflict'"),'f');assert.equal(sql("select role from client_users where client_id='conflict'"),'mesero')
 assert.throws(()=>sql(activate('conflict',randomUUID())),/PROVISION_USER_INVALID/)
 console.log('PASS role conflict/unknown Auth user cannot leave partial memberships or activation')
 for(const state of ['complete',null]){
  const id=state||'legacy';sql(`insert into clients(id,display_name,active,provisioning_state) values(${q(id)},'Suspended',false,${state?q(state):'null'})`)
  const suspended=JSON.parse(sql(activate(id,other)));assert.equal(suspended.active,false);assert.equal(suspended.staff_setup_required,true)
  assert.equal(sql(`select count(*) from client_users where client_id=${q(id)}`),'0')
 }
 console.log('PASS suspended complete and legacy tenants stay suspended without new memberships')
 seed('race');ready('race');const raced=await Promise.all([concurrent(activate('race',owner,service)),concurrent(activate('race',owner,service))])
 assert(raced.every(r=>r.code===0),JSON.stringify(raced));assert.equal(raced.filter(r=>JSON.parse(r.output).activated).length,1)
 assert.equal(sql("select count(*) from client_users where client_id='race'"),'2')
 console.log('PASS concurrent activation creates one owner/service membership pair')
 for(const role of ['anon','authenticated']){
  assert.throws(()=>sql(`set role ${role};`+activate('race',owner,service)),/permission denied/)
  assert.throws(()=>sql(`set role ${role};select pos_mark_tenant_provisioned('race');`),/permission denied/)
 }
 console.log('PASS only service role can mark readiness or activate')
 sql(`drop index client_users_user_tenant_identity;insert into client_users(user_id,client_id,role) values(${q(owner)},'race','dueño')`)
 const migration=fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/PENDIENTE_20260910070000_tenant_provisioning_atomic.sql'),'utf8')
 assert.throws(()=>sql(migration),/could not create unique index|duplicated/)
 assert.equal(sql(`select count(*) from client_users where client_id='race' and user_id=${q(owner)}`),'2')
 console.log('PASS pending migration stops on duplicate memberships without deleting history')
}
main().catch(error=>{console.error(error);process.exitCode=1})
