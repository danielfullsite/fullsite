#!/usr/bin/env node
'use strict'
// Own disposable PostgreSQL cluster only. No database URL/host/credentials accepted.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net')
const { spawnSync, spawn } = require('node:child_process')
const assert = require('node:assert/strict')
const ROOT = path.resolve(__dirname, '../..')
const bin = process.env.FULLSITE_TEST_PG_BIN || spawnSync('pg_config', ['--bindir'], { encoding: 'utf8' }).stdout?.trim()
if (!bin || !fs.existsSync(path.join(bin, 'initdb'))) throw new Error('PostgreSQL binaries required (FULLSITE_TEST_PG_BIN)')
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-inventory-pg-'))
const output = path.join(ROOT, 'output/closure/inventory-atomic')
fs.mkdirSync(output, { recursive: true })
let started = false, port, passed = 0
const evidence = []
function run(binary, args, input) {
  const r = spawnSync(path.join(bin, binary), args, { encoding: 'utf8', input, cwd: ROOT })
  if (r.status !== 0) throw new Error(r.stderr || r.error?.message || `${binary} failed`)
  return r.stdout
}
const quote = s => "'" + String(s).replaceAll("'", "''") + "'"
const json = o => quote(JSON.stringify(o)) + '::jsonb'
const pgArgs = () => ['-X', '-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq']
function sql(s) { return run('psql', pgArgs(), s).trim() }
function concurrent(s) {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(bin, 'psql'), pgArgs(), { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', x => { stdout += x }); child.stderr.on('data', x => { stderr += x })
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve(JSON.parse(stdout.trim())) : reject(new Error(stderr)))
    child.stdin.end(s)
  })
}
const actor = { client_id: 'inventory-lab', id: 'manager-lab', name: 'Synthetic manager', role: 'gerente', auth_type: 'shift_token' }
const request = (key, lines, extra = {}) => ({ client_id: actor.client_id, movement_type: 'entry', actor: 'Dashboard label', idempotency_key: key, lines, ...extra })
const callSql = (r, a = actor) => `set role service_role; select public.record_inventory_movement_atomic(${json(r)},${json(a)});`
const rpc = (r, a) => JSON.parse(sql(callSql(r, a)))
const stock = id => Number(sql(`select stock from public.pos_inventory where client_id='inventory-lab' and ingredient_id=${quote(id)};`))
const cost = id => Number(sql(`select cost_per_unit from public.pos_ingredients where id=${quote(id)};`))
const rows = key => Number(sql(`select count(*) from public.pos_inventory_operation_receipts where idempotency_key=${quote(key)};`))
function seed(id, s = 10, c = 2, tenant = 'inventory-lab') {
  sql(`insert into public.pos_ingredients(id,client_id,name,unit,cost_per_unit) values(${quote(id)},${quote(tenant)},${quote(id)},'kg',${c});
    insert into public.pos_inventory(client_id,ingredient_id,stock) values(${quote(tenant)},${quote(id)},${s});`)
}
async function check(name, fn) { await fn(); passed++; evidence.push({ name, passed: true }); process.stdout.write(`PASS ${name}\n`) }

async function main() {
  const listener = net.createServer()
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  port = String(listener.address().port); await new Promise(resolve => listener.close(resolve))
  run('initdb', ['-D', path.join(base, 'data'), '-A', 'trust', '-U', 'postgres'])
  run('pg_ctl', ['-D', path.join(base, 'data'), '-l', path.join(base, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, 'start'])
  started = true
  const baseline = fs.readFileSync(path.join(ROOT, 'supabase/migrations/00000000000000_baseline_esquema.sql'), 'utf8')
  let schema = 'create role anon; create role authenticated; create role service_role;\n'
  for (const table of ['client_locations', 'pos_ingredients', 'pos_inventory', 'pos_inventory_movements', 'pos_orders', 'pos_turnos', 'pos_cash_movements']) {
    const start = baseline.indexOf(`CREATE TABLE IF NOT EXISTS "public"."${table}"`)
    const end = baseline.indexOf('\n);', start)
    assert(start >= 0 && end > start, 'Canonical baseline table ' + table)
    schema += baseline.slice(start, end + 3) + `\nalter table public.${table} add primary key(id);\n`
  }
  // These sequences/defaults/unique constraints live outside baseline CREATE TABLE.
  for (const table of ['pos_inventory', 'pos_inventory_movements']) schema += `create sequence public.${table}_id_seq; alter table public.${table} alter column id set default nextval('public.${table}_id_seq');\n`
  schema += 'alter table public.pos_inventory add unique(client_id,ingredient_id);\n'
  for (const file of ['PENDIENTE_20260904000000_cuentas_divididas_modelo_durable.sql', 'PENDIENTE_20260905010000_caja_business_materializer.sql', 'PENDIENTE_20260908010000_inventory_movement_atomic.sql']) {
    schema += fs.readFileSync(path.join(ROOT, 'supabase/migrations', file), 'utf8') + '\n'
  }
  sql(schema)
  sql("insert into public.client_locations(id,client_id,name) values('lab-location','inventory-lab','Synthetic'),('other-location','other-tenant','Synthetic other');")

  await check('Ledger, stock, weighted cost and exact receipt commit together', () => {
    seed('coffee')
    const r = request('receipt-1', [{ ingredient_id: 'coffee', quantity: 10, unit_cost: 4 }], { location_id: 'lab-location', metadata: { warehouse: 'Main' } })
    const receipt = rpc(r)
    assert.equal(stock('coffee'), 20); assert.equal(cost('coffee'), 3)
    assert.deepEqual(receipt.request_echo, r); assert.equal(receipt.stock_scope, 'tenant'); assert.equal(receipt.committed, true)
    assert.equal(receipt.movements_created, 1); assert.equal(receipt.stock_updates, 1); assert.equal(receipt.cost_updates, 1)
    assert.equal(receipt.details[0].stock_before, 10); assert.equal(receipt.details[0].stock_after, 20)
    assert.equal(Number(sql(`select count(*) from public.pos_inventory_movements where inventory_operation_id=${quote(receipt.operation_id)};`)), 1)
    fs.writeFileSync(path.join(output, 'receipt-example.json'), JSON.stringify(receipt, null, 2) + '\n')
  })
  await check('Duplicate ingredient lines consume the updated balance and cost in line order', () => {
    seed('duplicate')
    const r = rpc(request('duplicate-lines', [{ ingredient_id: 'duplicate', quantity: 2, unit_cost: 4 }, { ingredient_id: 'duplicate', quantity: 3, unit_cost: 6 }]))
    assert.equal(stock('duplicate'), 15); assert(Math.abs(cost('duplicate') - 46 / 15) < 1e-10)
    assert.equal(r.details[1].stock_before, 12); assert.equal(r.movements_created, 2); assert.equal(r.stock_updates, 1)
  })
  await check('Failure after ledger insert and stock update rolls back cost, stock, ledger and receipt', () => {
    seed('fail-cost')
    sql("create function public.inventory_test_cost_failure() returns trigger language plpgsql as $$ begin if new.id='fail-cost' then raise exception 'LAB_AFTER_STOCK'; end if; return new; end $$; create trigger inventory_test_cost_failure before update on public.pos_ingredients for each row execute function public.inventory_test_cost_failure();")
    const r = request('rollback-cost', [{ ingredient_id: 'fail-cost', quantity: 5, unit_cost: 8 }])
    assert.throws(() => rpc(r), /LAB_AFTER_STOCK/)
    assert.equal(stock('fail-cost'), 10); assert.equal(cost('fail-cost'), 2); assert.equal(rows(r.idempotency_key), 0)
    assert.equal(Number(sql("select count(*) from public.pos_inventory_movements where ingredient_id='fail-cost';")), 0)
    sql('drop trigger inventory_test_cost_failure on public.pos_ingredients; drop function public.inventory_test_cost_failure();')
    assert.equal(rpc(r).was_duplicate, false); assert.equal(stock('fail-cost'), 15)
  })
  await check('Failure at final receipt insert rolls back every prior step', () => {
    seed('fail-receipt')
    sql("create function public.inventory_test_receipt_failure() returns trigger language plpgsql as $$ begin if new.idempotency_key='rollback-receipt' then raise exception 'LAB_AFTER_ALL_WRITES'; end if; return new; end $$; create trigger inventory_test_receipt_failure before insert on public.pos_inventory_operation_receipts for each row execute function public.inventory_test_receipt_failure();")
    assert.throws(() => rpc(request('rollback-receipt', [{ ingredient_id: 'fail-receipt', quantity: 4, unit_cost: 8 }])), /LAB_AFTER_ALL_WRITES/)
    assert.equal(stock('fail-receipt'), 10); assert.equal(cost('fail-receipt'), 2); assert.equal(rows('rollback-receipt'), 0)
    assert.equal(Number(sql("select count(*) from public.pos_inventory_movements where ingredient_id='fail-receipt';")), 0)
    sql('drop trigger inventory_test_receipt_failure on public.pos_inventory_operation_receipts; drop function public.inventory_test_receipt_failure();')
  })
  await check('Concurrent distinct commands serialize without losing stock or weighted cost', async () => {
    seed('concurrent')
    const result = await Promise.all(Array.from({ length: 12 }, (_, n) => concurrent(callSql(request('concurrent-' + n, [{ ingredient_id: 'concurrent', quantity: 1, unit_cost: 5 }])))))
    assert.equal(stock('concurrent'), 22); assert(Math.abs(cost('concurrent') - 80 / 22) < 1e-10)
    assert.equal(result.filter(x => !x.was_duplicate).length, 12)
  })
  await check('Concurrent identical commands return one durable receipt and one stock change', async () => {
    seed('same-key'); const r = request('same-key', [{ ingredient_id: 'same-key', quantity: 2, unit_cost: 3 }])
    const result = await Promise.all(Array.from({ length: 8 }, () => concurrent(callSql(r))))
    assert.equal(stock('same-key'), 12); assert.equal(rows('same-key'), 1)
    assert.equal(new Set(result.map(x => x.operation_id)).size, 1); assert.equal(result.filter(x => !x.was_duplicate).length, 1)
  })
  await check('Opposite ingredient order in concurrent commands does not deadlock', async () => {
    seed('lock-a'); seed('lock-b')
    await Promise.all([
      concurrent(callSql(request('lock-a-b', [{ ingredient_id: 'lock-a', quantity: 1 }, { ingredient_id: 'lock-b', quantity: 2 }]))),
      concurrent(callSql(request('lock-b-a', [{ ingredient_id: 'lock-b', quantity: 3 }, { ingredient_id: 'lock-a', quantity: 4 }]))),
    ])
    assert.equal(stock('lock-a'), 15); assert.equal(stock('lock-b'), 15)
  })
  await check('Exact retry survives PostgreSQL restart and rejects altered payload or actor', () => {
    seed('restart'); const r = request('restart-exact', [{ ingredient_id: 'restart', quantity: 7 }]); const first = rpc(r)
    // Simulates losing the response after real COMMIT, then restarting the database.
    run('pg_ctl', ['-D', path.join(base, 'data'), '-m', 'fast', '-l', path.join(base, 'postgres.log'), 'restart'])
    const retry = rpc(r); assert.deepEqual(retry, { ...first, was_duplicate: true }); assert.equal(stock('restart'), 17)
    assert.throws(() => rpc({ ...r, lines: [{ ingredient_id: 'restart', quantity: 8 }] }), /INVENTORY_IDEMPOTENCY_CONFLICT/)
    assert.throws(() => rpc(r, { ...actor, id: 'another-manager' }), /INVENTORY_IDEMPOTENCY_CONFLICT/)
    assert.equal(rows('restart-exact'), 1)
  })
  await check('Keys are exact rather than LIKE substrings; historical receipt is unchanged by later stock', () => {
    seed('key-substring'); const r = request('key', [{ ingredient_id: 'key-substring', quantity: 1 }]); const first = rpc(r)
    rpc(request('prefix-key-suffix', [{ ingredient_id: 'key-substring', quantity: 2 }]))
    assert.equal(stock('key-substring'), 13); assert.deepEqual(rpc(r), { ...first, was_duplicate: true })
  })
  await check('Read-only recovery returns an exact old receipt and never executes an unrecorded intent', () => {
    seed('lookup')
    const r = request('lookup', [{ ingredient_id: 'lookup', quantity: 4 }])
    const lookup = (command, a = actor) => JSON.parse(sql(`set role service_role;select public.get_inventory_movement_receipt(${json(command)},${json(a)});`))
    assert.equal(lookup(r).found, false); assert.equal(stock('lookup'), 10); assert.equal(rows('lookup'), 0)
    const committed = rpc(r)
    assert.deepEqual(lookup(r), { ...committed, was_duplicate: true }); assert.equal(stock('lookup'), 14)
    assert.throws(() => lookup({ ...r, lines: [{ ingredient_id: 'lookup', quantity: 9 }] }), /INVENTORY_IDEMPOTENCY_CONFLICT/)
    assert.throws(() => lookup(r, { ...actor, id: 'another-manager' }), /INVENTORY_IDEMPOTENCY_CONFLICT/)
  })
  await check('The same CFDI cannot enter twice through different screens, actors or key formats', async () => {
    seed('cfdi')
    const uuid = 'A1111111-1111-4111-8111-111111111111'
    const first = request('cfdi_' + uuid, [{ ingredient_id: 'cfdi', quantity: 3 }], { movement_type: 'invoice_entry', metadata: { cfdi_uuid: uuid } })
    const second = { ...first, idempotency_key: 'cfdi-' + uuid.toLowerCase(), metadata: { cfdi_uuid: uuid.toLowerCase() } }
    const result = await Promise.allSettled([concurrent(callSql(first)), concurrent(callSql(second, { ...actor, id: 'second-manager' }))])
    assert.equal(result.filter(x => x.status === 'fulfilled').length, 1)
    assert.match(result.find(x => x.status === 'rejected').reason.message, /INVENTORY_SOURCE_ALREADY_RECORDED/)
    assert.equal(stock('cfdi'), 13)
    assert.equal(Number(sql("select count(*) from public.pos_inventory_movements where ingredient_id='cfdi';")), 1)
  })
  await check('Underflow on later line rejects the complete batch instead of clamping stock', () => {
    seed('enough'); seed('not-enough', 1)
    assert.throws(() => rpc(request('underflow', [{ ingredient_id: 'enough', quantity: -2 }, { ingredient_id: 'not-enough', quantity: -2 }], { movement_type: 'waste' })), /INVENTORY_INSUFFICIENT_STOCK/)
    assert.equal(stock('enough'), 10); assert.equal(stock('not-enough'), 1); assert.equal(rows('underflow'), 0)
  })
  await check('Tenant, ingredient, location and authenticated actor boundaries fail closed', () => {
    seed('other-stock', 20, 3, 'other-tenant')
    const r = request('scope', [{ ingredient_id: 'coffee', quantity: 1 }])
    assert.throws(() => rpc(r, { ...actor, client_id: 'other-tenant' }), /INVENTORY_ACTOR_REQUIRED/)
    assert.throws(() => rpc(r, { ...actor, role: 'mesero' }), /INVENTORY_ACTOR_REQUIRED/)
    assert.throws(() => rpc({ ...r, lines: [{ ingredient_id: 'other-stock', quantity: 1 }] }), /INVENTORY_INGREDIENT_SCOPE_MISMATCH/)
    assert.throws(() => rpc({ ...r, location_id: 'other-location' }), /INVENTORY_LOCATION_SCOPE_MISMATCH/)
    assert.throws(() => sql(`set role authenticated;select public.record_inventory_movement_atomic(${json(r)},${json(actor)});`), /permission denied/)
    assert.throws(() => sql('set role service_role;delete from public.pos_inventory_operation_receipts;'), /permission denied/)
    assert.equal(rows('scope'), 0)
  })
  await check('Manual endpoint rejects invented sale, transfer, direction and order authority', () => {
    const r = request('bad-kind', [{ ingredient_id: 'coffee', quantity: 1 }])
    for (const movement_type of ['deduction', 'reversal', 'transfer_in', 'transfer_out', 'underflow_prevented']) assert.throws(() => rpc({ ...r, movement_type }), /INVENTORY_SOURCE_RECEIPT_REQUIRED/)
    assert.throws(() => rpc({ ...r, movement_type: 'waste' }), /INVENTORY_INVALID_DIRECTION/)
    assert.throws(() => rpc({ ...r, order_id: 'invented-order' }), /INVENTORY_INVALID_REQUEST/)
    assert.throws(() => rpc({ ...r, lines: [{ ingredient_id: 'coffee', quantity: 1, unit_cost: -1 }] }), /INVENTORY_INVALID_COST/)
    assert.equal(rows('bad-kind'), 0)
  })
  await check('Missing stock row is created atomically; zero purchase price preserves existing cost', () => {
    sql("insert into public.pos_ingredients(id,client_id,name,unit,cost_per_unit) values('new-stock','inventory-lab','New','kg',9);")
    const r = rpc(request('new-stock', [{ ingredient_id: 'new-stock', quantity: 2, unit_cost: 0 }]))
    assert.equal(stock('new-stock'), 2); assert.equal(cost('new-stock'), 9); assert.equal(r.cost_updates, 0)
  })
  await check('Existing broad REST grants cannot forge, change or delete a canonical ledger row', () => {
    sql('grant select,insert,update,delete on public.pos_inventory_movements to authenticated; grant usage on sequence public.pos_inventory_movements_id_seq to authenticated;')
    const operation = sql("select operation_id from public.pos_inventory_operation_receipts where idempotency_key='receipt-1';")
    assert.throws(() => sql(`set role authenticated;update public.pos_inventory_movements set quantity=900 where inventory_operation_id=${quote(operation)};`), /INVENTORY_LEDGER_IMMUTABLE/)
    assert.throws(() => sql(`set role authenticated;delete from public.pos_inventory_movements where inventory_operation_id=${quote(operation)};`), /INVENTORY_LEDGER_IMMUTABLE/)
    assert.throws(() => sql(`set role authenticated;insert into public.pos_inventory_movements(client_id,ingredient_id,movement_type,quantity,inventory_operation_id,inventory_operation_line) values('inventory-lab','coffee','entry',900,${quote(operation)},2);`), /INVENTORY_CANONICAL_RPC_REQUIRED/)
  })
  await check('Manual stock works with Caja writer active without weakening its order fence', () => {
    sql("insert into public.pos_caja_streams(stream_id,client_id,location_id,caja_terminal_id,credential_hash,active,writer_authority,baseline_sequence,baseline_history_hash,last_sequence,last_history_hash,activated_at,reconciliation_reference) values(gen_random_uuid(),'inventory-lab','lab-location','lab-caja',repeat('a',64),true,true,0,repeat('0',64),0,repeat('0',64),now(),'synthetic-cutover');")
    seed('caja-active'); assert.equal(rpc(request('caja-active', [{ ingredient_id: 'caja-active', quantity: 1 }])).committed, true)
    assert.throws(() => sql("insert into public.pos_orders(id,client_id,location_id,total) values('forged-order','inventory-lab','lab-location',1);"), /CAJA_WRITE_FENCE/)
    assert.equal(Number(sql('select count(*) from public.pos_orders;')), 0)
  })
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed, total: evidence.length, database: 'disposable PostgreSQL; canonical baseline + pending migrations', remote_writes: false, evidence }, null, 2) + '\n')
  process.stdout.write(`${passed}/${evidence.length} inventory PostgreSQL checks passed\n`)
}
main().catch(error => { console.error(error.stack); process.exitCode = 1 }).finally(() => {
  if (started) {
    try { run('pg_ctl', ['-D', path.join(base, 'data'), '-m', 'immediate', 'stop']) }
    catch (error) { console.error(error.message); process.exitCode = 1; return }
  }
  fs.rmSync(base, { recursive: true, force: true })
})
