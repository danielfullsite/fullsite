#!/usr/bin/env node
'use strict'
// Disposable local PostgreSQL only. Never accepts a remote database URL.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net')
const { spawnSync } = require('node:child_process')
const assert = require('node:assert/strict')
const ROOT = path.resolve(__dirname, '../..')
const bin = process.env.FULLSITE_TEST_PG_BIN || spawnSync('pg_config', ['--bindir'], { encoding: 'utf8' }).stdout?.trim()
if (!bin || !fs.existsSync(path.join(bin, 'initdb'))) throw new Error('PostgreSQL binaries required')
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-security-pg-'))
let started = false, port, passed = 0
const evidence = []
function run(binary, args, input, allowedFailure = false) {
  const result = spawnSync(path.join(bin, binary), args, { cwd: ROOT, input, encoding: 'utf8' })
  if (result.status !== 0 && !allowedFailure) throw new Error(result.stderr || result.error?.message)
  return result
}
const pgArgs = () => ['-X', '-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq']
const sql = text => run('psql', pgArgs(), text).stdout.trim()
const ids = { manager: '00000000-0000-0000-0000-000000000001', waiter: '00000000-0000-0000-0000-000000000002' }
const asUser = (user, text) => `set role authenticated; set request.jwt.claim.sub='${ids[user]}'; ${text}`
const denied = (text, pattern = /denied|H09_|row-level security/) => {
  const result = run('psql', pgArgs(), text, true)
  assert.notEqual(result.status, 0, 'Expected rejection'); assert.match(result.stderr, pattern)
}
async function check(name, fn) { await fn(); passed++; evidence.push({ name, passed: true }); process.stdout.write(`PASS ${name}\n`) }
async function main() {
  const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  port = String(listener.address().port); await new Promise(resolve => listener.close(resolve))
  run('initdb', ['-D', path.join(base, 'data'), '-A', 'trust', '-U', 'postgres'])
  run('pg_ctl', ['-D', path.join(base, 'data'), '-l', path.join(base, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, 'start']); started = true
  const baseline = fs.readFileSync(path.join(ROOT, 'supabase/migrations/00000000000000_baseline_esquema.sql'), 'utf8')
  const tables = ['client_users','client_locations','pos_menu_items','pos_menu_categories','pos_ingredients','pos_inventory','pos_inventory_movements','pos_purchase_orders','pos_purchase_order_items','pos_sub_recipes','pos_sub_recipe_ingredients']
  let schema = `create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;\n`
  for (const table of tables) {
    const start = baseline.indexOf(`CREATE TABLE IF NOT EXISTS "public"."${table}"`), end = baseline.indexOf('\n);', start)
    assert(start >= 0 && end > start, 'Missing baseline table '+table)
    schema += baseline.slice(start, end + 3) + `\nalter table public.${table} add primary key(id);\n`
    // Worst-case legacy grants and permissive RLS: H09 must constrain these.
    schema += `grant all on public.${table} to authenticated,service_role;
      alter table public.${table} enable row level security;
      create policy fixture_legacy_open on public.${table} for all to authenticated using(true) with check(true);\n`
  }
  for (const table of ['pos_inventory','pos_inventory_movements','pos_purchase_order_items','pos_sub_recipe_ingredients']) schema += `create sequence public.${table}_id_seq; alter table public.${table} alter column id set default nextval('public.${table}_id_seq'); grant usage on sequence public.${table}_id_seq to authenticated,service_role;\n`
  schema += 'alter table public.pos_inventory add unique(client_id,ingredient_id);\n'
  sql(schema)
  for (const file of ['PENDIENTE_20260908010000_inventory_movement_atomic.sql','PENDIENTE_20260908020000_pos_identity_and_write_guards.sql']) sql(fs.readFileSync(path.join(ROOT,'supabase/migrations',file),'utf8'))
  sql(`insert into public.client_users(user_id,client_id,role) values('${ids.manager}','tenant-a','gerente'),('${ids.waiter}','tenant-a','mesero');
    insert into public.client_locations(id,client_id,name) values('a-main','tenant-a','Own'),('b-main','tenant-b','Other');
    insert into public.pos_menu_categories(id,client_id,name) values('cat-a','tenant-a','A'),('cat-b','tenant-b','B');
    insert into public.pos_menu_items(id,client_id,category_id,name,price) values('item-a','tenant-a','cat-a','Own',50),('item-b','tenant-b','cat-b','Other',60);
    insert into public.pos_ingredients(id,client_id,name,unit,cost_per_unit) values('ingredient-a','tenant-a','Own','kg',2),('ingredient-b','tenant-b','Other','kg',3);
    insert into public.pos_inventory(client_id,ingredient_id,stock) values('tenant-a','ingredient-a',10),('tenant-b','ingredient-b',10);
    insert into public.pos_purchase_orders(id,client_id,supplier,created_by,status) values('po-a','tenant-a','Synthetic','Fixture','borrador'),('po-b','tenant-b','Synthetic','Fixture','borrador');
    insert into public.pos_purchase_order_items(order_id,ingredient_id,ingredient_name,quantity_ordered,unit) values('po-a','ingredient-a','Own',1,'kg'),('po-b','ingredient-b','Other',1,'kg');`)
  await check('Authenticated sees own catalog and own child rows only', () => {
    assert.equal(sql(asUser('waiter','select string_agg(id,\',\') from public.pos_menu_items;')), 'item-a')
    assert.equal(sql(asUser('waiter','select string_agg(order_id,\',\') from public.pos_purchase_order_items;')), 'po-a')
  })
  await check('Waiter cannot alter catalog and cannot promote membership', () => {
    assert.equal(sql(asUser('waiter',"update public.pos_menu_items set price=1 where id='item-a' returning id;")), '')
    denied(asUser('waiter',`update public.client_users set role='gerente' where user_id='${ids.waiter}';`))
    assert.equal(sql("select price from public.pos_menu_items where id='item-a';"), '50')
  })
  await check('Manager can edit own price and create a zero-cost ingredient', () => {
    assert.equal(sql(asUser('manager',"update public.pos_menu_items set price=55 where id='item-a' returning price;")), '55')
    sql(asUser('manager',"insert into public.pos_ingredients(id,client_id,name,unit,cost_per_unit) values('created','tenant-a','Created','kg',0);"))
    denied(asUser('manager',"insert into public.pos_ingredients(id,client_id,name,unit,cost_per_unit) values('invented','tenant-a','Fake','kg',99);"))
    denied(asUser('manager',"update public.pos_ingredients set cost_per_unit=99 where id='created';"))
  })
  await check('Service-role upsert and PATCH cannot move tenant or parent identity', () => {
    denied("set role service_role; insert into public.pos_menu_items(id,client_id,category_id,name,price) values('item-a','tenant-b','cat-b','Attack',1) on conflict(id) do update set client_id=excluded.client_id,category_id=excluded.category_id;", /H09_/)
    denied("set role service_role; update public.pos_purchase_order_items set order_id='po-b' where order_id='po-a';", /H09_IMMUTABLE_PARENT/)
    assert.equal(sql("select client_id from public.pos_menu_items where id='item-a';"),'tenant-a')
  })
  await check('Foreign category/ingredient links and foreign child insertion are rejected', () => {
    denied(asUser('manager',"insert into public.pos_menu_items(id,client_id,category_id,name,price) values('bad-link','tenant-a','cat-b','Attack',1);"), /H09_FOREIGN_REFERENCE/)
    denied(asUser('manager',"insert into public.pos_purchase_order_items(order_id,ingredient_id,ingredient_name,quantity_ordered,unit) values('po-b','ingredient-b','Attack',1,'kg');"))
    denied(asUser('manager',"insert into public.pos_purchase_order_items(order_id,ingredient_id,ingredient_name,quantity_ordered,unit) values('po-a','ingredient-b','Attack',1,'kg');"), /H09_FOREIGN_REFERENCE/)
  })
  await check('Neither JWT nor service-role REST can write stock/ledger directly', () => {
    for (const role of ['authenticated','service_role']) {
      denied(`set role ${role}; update public.pos_inventory set stock=999 where ingredient_id='ingredient-a';`)
      denied(`set role ${role}; insert into public.pos_inventory_movements(client_id,ingredient_id,movement_type,quantity) values('tenant-a','ingredient-a','entry',999);`)
    }
    assert.equal(sql("select stock from public.pos_inventory where ingredient_id='ingredient-a';"),'10')
  })
  await check('Canonical inventory RPC still atomically adjusts own stock/cost', () => {
    const request = {client_id:'tenant-a',movement_type:'entry',actor:'Fixture',idempotency_key:'h09-entry',lines:[{ingredient_id:'ingredient-a',quantity:10,unit_cost:4}]}
    const actor = {client_id:'tenant-a',id:ids.manager,name:'Manager',role:'gerente',auth_type:'supabase_session'}
    const query = `set role service_role; select public.record_inventory_movement_atomic('${JSON.stringify(request)}'::jsonb,'${JSON.stringify(actor)}'::jsonb);`
    const receipt = JSON.parse(sql(query)); assert.equal(receipt.committed,true)
    assert.equal(sql("select stock from public.pos_inventory where ingredient_id='ingredient-a';"),'20')
    assert.equal(Number(sql("select cost_per_unit from public.pos_ingredients where id='ingredient-a';")),3)
    const replay = JSON.parse(sql(query))
    assert.equal(replay.was_duplicate, true)
    assert.deepEqual({ ...replay, was_duplicate: false }, receipt)
    assert.equal(sql("select stock from public.pos_inventory where ingredient_id='ingredient-a';"),'20')
  })
  const output = path.join(ROOT,'output/closure/pos-security'); fs.mkdirSync(output,{recursive:true})
  fs.writeFileSync(path.join(output,'postgres-results.json'),JSON.stringify({passed,evidence,scope:'disposable PostgreSQL fixture; no production/schema-wide certification'},null,2))
  process.stdout.write(`${passed}/${passed} PostgreSQL security checks passed\n`)
}
main().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1}).finally(()=>{
  if(started) try{run('pg_ctl',['-D',path.join(base,'data'),'-m','immediate','stop'])}catch{}
  fs.rmSync(base,{recursive:true,force:true})
})
