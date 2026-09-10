'use strict'
const { spawnSync, spawn } = require('node:child_process')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const socket = process.argv[2]
if (!/^\/tmp\/fullsite-scoped-pg-[a-zA-Z0-9]+$/.test(socket || '') || !fs.existsSync(socket + '/data/PG_VERSION')) throw new Error('private disposable cluster socket required')
const args = ['-X', '-h', socket, '-p', '5432', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At']
const bin = process.env.FULLSITE_TEST_PSQL
const quote = x => "'" + String(x).replaceAll("'", "''") + "'"
function sql(query) {
  const r = spawnSync(bin, args, { input: query, encoding: 'utf8' })
  if (r.status) throw new Error(r.stderr)
  return r.stdout.trim()
}
function concurrent(query) {
  return new Promise(resolve => {
    const child = spawn(bin,args); let output = '', error = ''
    child.stdout.on('data', x => output += x); child.stderr.on('data', x => error += x)
    child.on('close', code => resolve({ code, output, error })); child.stdin.end(query)
  })
}
const call = (rows, client = 'a', table = 'pos_sessions', keys = ['id']) =>
  `select public.pos_scoped_upsert(${quote(table)},${quote(client)},${quote(JSON.stringify(rows))}::jsonb,array[${keys.map(quote).join(',')}]::text[]);`
async function main() {
  const created = JSON.parse(sql(call({ id:'own',name:'session', client_id:'forged' })))[0]
  assert.equal(created.client_id,'a'); assert.equal(created.count,0)
  assert.equal(JSON.parse(sql(call({ id:'own',name:'updated',count:2 })))[0].count,2)
  assert.equal(JSON.parse(sql(call({ id:'own' })))[0].name,'updated')
  assert.equal(JSON.parse(sql('set role service_role; ' + call({id:'role',name:'role'})).split('\n').at(-1))[0].client_id,'a')
  console.log('PASS own create, update, defaults, identity-only retry and service role')
  sql(call({id:'foreign',name:'victim',count:9},'b'))
  assert.throws(()=>sql(call({id:'foreign',name:'stolen',count:0})),/SCOPE_CONFLICT/)
  assert.equal(sql("select client_id||':'||name||':'||count from pos_sessions where id='foreign'"),'b:victim:9')
  assert.throws(()=>sql(call([{id:'batch-new',name:'new'},{id:'own',name:'changed'},{id:'foreign',name:'stolen'}])),/SCOPE_CONFLICT/)
  assert.equal(sql("select count(*) from pos_sessions where id='batch-new'"),'0')
  assert.equal(sql("select name from pos_sessions where id='own'"),'updated')
  console.log('PASS cross-tenant conflict and batch rollback preserve all rows')
  assert.equal(JSON.parse(sql(call({id:'unused',name:'updated',count:4},'a','pos_sessions',['client_id','name'])))[0].id,'own')
  assert.throws(()=>sql(call({id:'x'},'a','pos_sessions',['name'])),/INVALID_CONFLICT_KEYS/)
  assert.throws(()=>sql(call({id:'x'},'a','pos_sessions',['id','id'])),/INVALID_CONFLICT_KEYS/)
  assert.throws(()=>sql(call({id:'x'},'a','pos_sessions',['id); drop table pos_sessions;--'])),/INVALID_CONFLICT_KEYS/)
  assert.throws(()=>sql(call({id:'x'},'a','pos_sessions',['client_id','count'])),/no unique or exclusion constraint/)
  assert.throws(()=>sql(call({id:'x'},'a','pos_purchase_order_items')),/UNSUPPORTED_TABLE/)
  assert.throws(()=>sql(call({id:'x'},'a','pos_sessions; drop table pos_sessions')),/UNSUPPORTED_TABLE/)
  assert.throws(()=>sql(call([])),/INVALID_ROWS/)
  assert.throws(()=>sql(call([null])),/INVALID_ROWS/)
  assert.throws(()=>sql(call({id:'x',unknown_column:'value'})),/INVALID_COLUMN/)
  for(const role of ['anon','authenticated']) assert.throws(()=>sql(`set role ${role}; `+call({id:'x'})),/permission denied/)
  console.log('PASS composite tenant conflicts, identifier validation, unsupported tables and browser grants')
  for(const table of ['pos_print_jobs','pos_turnos']) {
    const field = table==='pos_turnos' ? {closed_at:'2026-09-10T12:00:00Z'} : {status:'done'}
    sql(call({id:table},'a',table)); const row=JSON.parse(sql(call({id:table,...field},'a',table)))[0]
    assert.equal(row.client_id,'a'); assert(row[Object.keys(field)[0]])
  }
  console.log('PASS genuine same-tenant print and shift updates')
  const raced=await Promise.all(['a','b'].map(client=>concurrent(call({id:'race',name:'race'},client))))
  assert.equal(raced.filter(r=>r.code===0).length,1)
  assert(raced.some(r=>r.error.includes('SCOPE_CONFLICT')))
  assert.equal(sql("select count(*) from pos_sessions where id='race'"),'1')
  console.log('PASS simultaneous cross-tenant inserts cannot adopt the winner identity')
  childTests()
}
main().catch(error=>{console.error(error);process.exitCode=1})

function childTests() {
  sql(`insert into pos_purchase_orders(id,client_id,supplier,created_by) values('pa','a','Supplier','actor'),('pb','b','Supplier','actor');
    insert into pos_sub_recipes(id,client_id,name) values('sa','a','Own'),('sa2','a','Nested'),('sb','b','Foreign');
    insert into pos_ingredients(id,client_id,name,unit) values('ia','a','Own','KG'),('ib','b','Foreign','KG');`)
  const rpc = (table,method,rows=null,id=null,parent=null,client='a') => {
    const nullable = x => x===null ? 'null' : quote(x)
    return `select public.pos_scoped_child(${quote(table)},${quote(client)},${quote(method)},${nullable(id)},${nullable(parent)},${rows===null?'null':quote(JSON.stringify(rows))+'::jsonb'});`
  }
  for (const table of ['pos_purchase_order_items','pos_sub_recipe_ingredients']) {
    const purchase=table==='pos_purchase_order_items'
    const parent=purchase?'order_id':'sub_recipe_id', own=purchase?'pa':'sa', foreign=purchase?'pb':'sb'
    const fields=purchase?{ingredient_name:'Own',quantity_ordered:1,unit:'KG'}:{quantity:1}
    const ownRow={[parent]:own,ingredient_id:'ia',...fields}
    const row=JSON.parse(sql(rpc(table,'POST',ownRow))).rows[0]
    assert.equal(row[parent],own)
    assert.equal(JSON.parse(sql(rpc(table,'GET',null,null,own))).total,1)
    assert.equal(JSON.parse(sql(rpc(table,'GET',null,String(row.id),null,'b'))).total,0)
    assert.throws(()=>sql(rpc(table,'POST',{...ownRow,[parent]:foreign})),/SCOPE_CONFLICT/)
    assert.throws(()=>sql(rpc(table,'POST',{...ownRow,ingredient_id:'ib'})),/SCOPE_CONFLICT/)
    assert.throws(()=>sql(rpc(table,'POST',[ownRow,{...ownRow,[parent]:foreign}])),/SCOPE_CONFLICT/)
    assert.equal(JSON.parse(sql(rpc(table,'GET',null,null,own))).total,1)
    const update=purchase?{quantity_received:1}:{quantity:2}
    assert.equal(JSON.parse(sql(rpc(table,'PATCH',update,String(row.id)))).rows[0][Object.keys(update)[0]],Object.values(update)[0])
    assert.deepEqual(JSON.parse(sql(rpc(table,'PATCH',update,String(row.id),null,'b'))).rows,[])
    assert.throws(()=>sql(rpc(table,'PATCH',{[parent]:foreign},String(row.id))),/IMMUTABLE_IDENTITY/)
    const foreignIngredient=purchase?{ingredient_id:'ib'}:{ingredient_id:'ib',ingredient_type:'ingredient'}
    assert.throws(()=>sql(rpc(table,'PATCH',foreignIngredient,String(row.id))),/SCOPE_CONFLICT/)
    if(!purchase) {
      assert.throws(()=>sql(rpc(table,'PATCH',{ingredient_type:'sub_recipe'},String(row.id))),/INGREDIENT_REQUIRED/)
      assert.throws(()=>sql(rpc(table,'PATCH',{ingredient_id:'sb',ingredient_type:'sub_recipe'},String(row.id))),/SCOPE_CONFLICT/)
      assert.equal(JSON.parse(sql(rpc(table,'PATCH',{ingredient_id:'sa2',ingredient_type:'sub_recipe'},String(row.id)))).rows[0].ingredient_id,'sa2')
    }
    assert.deepEqual(JSON.parse(sql(rpc(table,'DELETE',null,String(row.id),null,'b'))).rows,[])
    assert.equal(JSON.parse(sql(rpc(table,'DELETE',null,String(row.id)))).rows.length,1)
    assert.equal(JSON.parse(sql(rpc(table,'GET',null,null,own))).total,0)
    for(const role of ['anon','authenticated']) assert.throws(()=>sql(`set role ${role}; `+rpc(table,'GET')),/permission denied/)
  }
  console.log('PASS both baseline child schemas: tenant reads, parent/ingredient checks, batch rollback, immutable PATCH and scoped DELETE')
}
