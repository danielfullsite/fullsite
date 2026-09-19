#!/usr/bin/env node
'use strict'
// PostgreSQL must be an isolated local cluster containing only the baseline
// pos_orders/pos_turnos definitions and the two pending migrations. No remote URL.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { spawnSync } = require('node:child_process')
const { randomUUID, createHash } = require('node:crypto')
const assert = require('node:assert/strict')
const { CoreEventStore } = require('../local-server/core/event-store')
const { NdjsonEventStore } = require('../local-server/adapters/storage/ndjson')
const { RestaurantState } = require('../local-server/core/state')
const { CommandHandler } = require('../local-server/core/command-handler')
const { CatalogStore } = require('../local-server/core/catalog-store')
const { permissionsFor } = require('../local-server/core/actor-authority')
const { BusinessOutbox, INITIAL_HASH, committedEnvelope, historyHash } = require('../local-server/core/business-outbox')
const ROOT = path.resolve(__dirname, '../..')
const output = path.join(ROOT, 'output/closure/materializer')
const port = process.argv[2] || '55439'
if (!/^\d{4,5}$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error('Expected isolated local PostgreSQL port')
const psql = process.env.FULLSITE_TEST_PSQL || '/opt/homebrew/opt/postgresql@16/bin/psql'
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-materializer-'))
const tenant = 'materializer-' + randomUUID(), branch = 'branch-a', streamId = randomUUID(), credential = 'synthetic-' + randomUUID()
const quote = text => "'" + String(text).replaceAll("'", "''") + "'"
const json = value => quote(JSON.stringify(value)) + '::jsonb'
const results = []
function sql(statement, { allowError = false } = {}) {
  const result = spawnSync(psql, ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', 'postgres'], { input: statement, encoding: 'utf8' })
  if (result.status !== 0 && !allowError) throw new Error(result.stderr)
  return result.status === 0 ? result.stdout.trim() : result.stderr.trim()
}
const scalar = statement => JSON.parse(sql(statement))
async function check(name, run) { await run(); results.push({ name, passed: true }); console.log('PASS', name) }
function seedStream(id, location, active = true) {
  sql(`insert into public.pos_caja_streams(stream_id,client_id,location_id,caja_terminal_id,credential_hash,active,writer_authority,
    baseline_sequence,baseline_history_hash,last_sequence,last_history_hash,activated_at,reconciliation_reference)
    values(${quote(id)},${quote(tenant)},${quote(location)},'synthetic-caja',${quote(createHash('sha256').update(credential).digest('hex'))},${active},true,0,
      ${quote(INITIAL_HASH)},0,${quote(INITIAL_HASH)},now(),'local-test-reconciled');`)
}
function rpc(args, allowError = false) {
  return sql(`set role anon; select public.apply_pos_caja_event(${quote(args.p_stream_id)}::uuid,${quote(args.p_credential)},
    ${quote(args.p_previous_history_hash)},${quote(args.p_history_hash)},${json(args.p_event)});`, { allowError })
}
async function main() {
  const storage = new CoreEventStore(new NdjsonEventStore({ eventLogPath: path.join(temporary, 'events.ndjson') }))
  await storage.load()
  const state = new RestaurantState({ localAuthorityEnabled: true })
  const catalog = new CatalogStore({ directory: path.join(temporary, 'catalog'), restaurantId: tenant,
    fetchImpl: async () => Response.json({ schema_version: 1, complete: true, catalog_scope: 'restaurant', restaurant_id: tenant,
      refreshed_at: new Date().toISOString(), config: { id: tenant, display_name: 'Synthetic', timezone: 'America/Monterrey', mesas: 3, iva_rate: 0.16 },
      categories: [{ id: 'drinks', name: 'Bebidas', items: [{ id: 'coffee', name: 'Coffee', price: 50, station: 'barra' }] }],
      settings: { 'pos.station_routing': { barra: ['drinks'] }, 'pos.no_print_stations': ['barra', 'cocina', 'caja'] },
      modifiers: { groups: [], mods: [], item_links: [], category_links: [] }, payment_methods: [{ id: 'cash', name: 'Cash', type: 'cash' }] }) })
  await catalog.refresh('synthetic')
  const actor = { id: 'operator', name: 'Operador', permissions: permissionsFor('admin'), expires_at: Date.now() + 3600000 }
  const handler = new CommandHandler({ eventStore: storage, state, wsHub: { broadcast: async () => {} }, restaurantId: tenant, catalogStore: catalog, localAuthorityEnabled: true })
  const turnoId = randomUUID(), orderId = randomUUID()
  async function command(type, fields) {
    return handler.handle({ restaurant_id: tenant, payload: { command_type: type, command_id: randomUUID(), turno_id: turnoId,
      ...(type !== 'CASH_MOVEMENT' ? { order_id: orderId } : {}), ...fields } }, 'synthetic-caja', { actor })
  }
  await command('TURN_OPEN', { opening_cash_cents: 50000 })
  await command('ORDER_SAVE', { expected_revision: 0, catalog_revision: catalog.read().revision, mesa: 1,
    items: [{ line_id: 'line-coffee', product_id: 'coffee', quantity: 2 }] })
  await command('ORDER_SEND', { expected_revision: 1 })
  await command('FINANCIAL_OPEN', { expected_revision: 0, expected_order_revision: 2, total_cents: 11600, currency: 'MXN' })
  // Domain permits retaining the full account ID with a smaller split amount.
  const accounts = [orderId + ':full', randomUUID()]
  await command('FINANCIAL_SPLIT', { expected_revision: 1, accounts: accounts.map(account_id => ({ account_id, total_cents: 5800 })) })
  const paymentId = randomUUID()
  await command('FINANCIAL_PAYMENT_START', { expected_revision: 2, payment_id: paymentId, account_id: accounts[0], amount_cents: 2900, method: 'cash' })
  await command('FINANCIAL_PAYMENT_RESULT', { expected_revision: 3, payment_id: paymentId, status: 'accepted', evidence: { kind: 'cash_received', received_by: actor.id, received_cents: 3000 } })
  const events = await storage.readAfter(0)
  let hash = INITIAL_HASH
  const args = events.map(event => {
    const previous = hash; hash = historyHash(hash, event)
    return { p_stream_id: streamId, p_credential: credential, p_previous_history_hash: previous, p_history_hash: hash, p_event: committedEnvelope(event) }
  })
  seedStream(streamId, branch)
  await check('Wrong credential and out-of-order event never create a business receipt', async () => {
    assert.match(rpc({ ...args[0], p_credential: 'invalid-' + randomUUID() }, true), /SYNC_UNAUTHORIZED/)
    assert.match(rpc(args[1], true), /STREAM_SEQUENCE_GAP/)
    assert.equal(Number(sql(`select count(*) from public.pos_caja_business_receipts where stream_id=${quote(streamId)};`)), 0)
  })
  let calls = 0, loseFirstResponse = true
  const options = { eventStore: storage, directory: temporary, supabaseUrl: 'https://local-test.invalid', anonKey: 'synthetic-anon',
    restaurantId: tenant, locationId: branch, streamId, credential, fetchImpl: async (_url, init) => {
      calls++
      const data = JSON.parse(rpc(JSON.parse(init.body)))
      if (loseFirstResponse) { loseFirstResponse = false; throw new TypeError('Response lost after actual PostgreSQL COMMIT') }
      return Response.json(data)
    } }
  let worker = new BusinessOutbox(options)
  await check('Commit with lost HTTP response retries safely and materializes complete operational and financial results', async () => {
    await assert.rejects(worker.flush(), /Response lost/)
    assert.equal(worker.status().last_sequence, 0)
    const result = await worker.flush()
    assert.equal(result.confirmed, 7)
    const order = scalar(`select row_to_json(o) from (select id,total,saldo,payment_status,preparation_status,items,financial_revision,caja_financial_snapshot from public.pos_orders where id=${quote(orderId)}) o;`)
    assert.equal(order.total, 116); assert.equal(order.saldo, 87)
    assert.equal(order.payment_status, 'pendiente'); assert.equal(order.preparation_status, 'enviada')
    assert.equal(order.items[0].cantidad, 2); assert.equal(order.financial_revision, 4)
    assert.equal(order.caja_financial_snapshot.payments[0].change_cents, 100)
    assert.equal(Number(sql(`select count(*) from public.pos_order_accounts where order_id=${quote(orderId)};`)), 2)
    assert.equal(Number(sql(`select count(*) from public.pos_payment_attempts where order_id=${quote(orderId)};`)), 1)
    assert((await storage.readAfter(0)).every(event => !event.synced), 'business receipt does not rewrite shadow synced flags')
  })
  await check('Exact retries are receipts while altered history and reused command IDs are rejected', async () => {
    assert.equal(JSON.parse(rpc(args[6])).duplicate, true)
    const different = structuredClone(args[6]); different.p_event.payload.changed = true
    assert.match(rpc(different, true), /STREAM_HISTORY_CONFLICT/)
    const reused = structuredClone(args[6]); reused.p_event.sequence = 8; reused.p_previous_history_hash = hash
    assert.match(rpc(reused, true), /duplicate key|unique constraint/)
    assert.equal(Number(sql(`select count(*) from public.pos_caja_business_receipts where stream_id=${quote(streamId)};`)), 7)
  })
  await check('Restart verifies local history before using checkpoint; divergent restored history cannot send', async () => {
    const previousCalls = calls
    worker = new BusinessOutbox(options)
    assert.equal((await worker.flush()).confirmed, 0)
    assert.equal(calls, previousCalls)
    const divergent = structuredClone(events); divergent[0].result.turno.opening_cash_cents = 1
    const bad = new BusinessOutbox({ ...options, eventStore: { readAfter: async () => divergent } })
    await assert.rejects(bad.flush(), /LOCAL_STREAM_HISTORY_CONFLICT/)
    assert.equal(calls, previousCalls)
    const removed = new BusinessOutbox({ ...options, eventStore: { readAfter: async () => events.slice(1) } })
    await assert.rejects(removed.flush(), /LOCAL_STREAM_HISTORY_CONFLICT/)
  })
  await check('Database fence rejects legacy writes, forged transaction markers and cross-branch adoption', async () => {
    assert.match(sql(`update public.pos_orders set total=1 where id=${quote(orderId)};`, { allowError: true }), /CAJA_WRITE_FENCE/)
    assert.match(sql(`begin;select set_config('fullsite.caja_stream',${quote(streamId)},true);select set_config('fullsite.caja_sequence','7',true);update public.pos_orders set total=1 where id=${quote(orderId)};commit;`, { allowError: true }), /CAJA_WRITE_FENCE/)
    assert.match(sql(`update public.pos_orders set location_id='other' where id=${quote(orderId)};`, { allowError: true }), /CAJA_WRITE_FENCE/)
    assert.match(sql(`insert into public.pos_cash_movements(id,client_id,turno_id,type,amount,reason,actor,approved_by)
      values(1,${quote(tenant)},${quote(turnoId)},'retiro',100,'legacy','operator','manager');`, { allowError: true }), /CAJA_WRITE_FENCE/)
    assert.match(sql(`insert into public.pos_order_closures(order_id,client_id) values(${quote(orderId)},${quote(tenant)});`, { allowError: true }), /CAJA_WRITE_FENCE/)
    assert.equal(Number(sql(`select total from public.pos_orders where id=${quote(orderId)};`)), 116)
    assert.match(sql(`set role anon;select credential_hash from public.pos_caja_streams;`, { allowError: true }), /permission denied/)
  })
  await check('A second branch has its own sequence; globally reused order identity cannot cross branch scope', async () => {
    const other = randomUUID(); seedStream(other, 'branch-b')
    assert.match(rpc({ ...args[0], p_stream_id: other }, true), /TURNO_SCOPE_CONFLICT/)
    const observation = { id: randomUUID(), sequence: 1, type: 'STATE_SYNC', ts: Date.now(), restaurant_id: tenant, payload: {}, result: null }
    const receipt = JSON.parse(rpc({ p_stream_id: other, p_credential: credential, p_previous_history_hash: INITIAL_HASH,
      p_history_hash: historyHash(INITIAL_HASH, observation), p_event: observation }))
    assert.equal(receipt.sequence, 1); assert.equal(receipt.materialized, false)
  })
  await command('FINANCIAL_PAYMENT_START', { expected_revision: 4, payment_id: randomUUID(), account_id: accounts[0], amount_cents: 2900, method: 'cash' })
  const eighth = (await storage.readAfter(7))[0]
  const eighthArgs = { p_stream_id: streamId, p_credential: credential, p_previous_history_hash: hash,
    p_history_hash: historyHash(hash, eighth), p_event: committedEnvelope(eighth) }
  await check('Invalid projection rolls back receipt and stream progress in the same transaction', async () => {
    const invalid = structuredClone(eighthArgs); invalid.p_event.result.financial_order.reserved_cents = 9000
    assert.match(rpc(invalid, true), /FINANCIAL_SUM_MISMATCH/)
    assert.equal(Number(sql(`select last_sequence from public.pos_caja_streams where stream_id=${quote(streamId)};`)), 7)
    assert.equal(Number(sql(`select count(*) from public.pos_caja_business_receipts where stream_id=${quote(streamId)};`)), 7)
    assert.equal((await worker.flush()).confirmed, 1)
  })
  await check('Unknown cash attempt reserves balance without counting a sale and is retained in cloud', async () => {
    const reservedPayment = eighth.result.financial_order.payments.at(-1)
    await command('FINANCIAL_PAYMENT_RESULT', { expected_revision: 5, payment_id: reservedPayment.payment_id, status: 'unknown', evidence: { kind: 'operator_record', recorded_by: actor.id, reason: 'Verify drawer' } })
    assert.equal((await worker.flush()).confirmed, 1)
    const row = scalar(`select row_to_json(p) from (select estado,monto from public.pos_payment_attempts where payment_id=${quote(reservedPayment.payment_id)}) p;`)
    assert.equal(row.estado, 'desconocido'); assert.equal(row.monto, 29)
    assert.equal(Number(sql(`select saldo from public.pos_orders where id=${quote(orderId)};`)), 87)
  })
  await check('Full settlement materializes once and preserves pending kitchen work', async () => {
    const reservedPayment = eighth.result.financial_order.payments.at(-1)
    await command('FINANCIAL_PAYMENT_RESULT', { expected_revision: state.getFinancialOrder(orderId).revision,
      payment_id: reservedPayment.payment_id, status: 'accepted', evidence: { kind: 'cash_received', received_by: actor.id, received_cents: 2900 } })
    const finalPayment = randomUUID()
    await command('FINANCIAL_PAYMENT_START', { expected_revision: state.getFinancialOrder(orderId).revision,
      payment_id: finalPayment, account_id: accounts[1], amount_cents: 5800, method: 'cash' })
    await command('FINANCIAL_PAYMENT_RESULT', { expected_revision: state.getFinancialOrder(orderId).revision,
      payment_id: finalPayment, status: 'accepted', evidence: { kind: 'cash_received', received_by: actor.id, received_cents: 5800 } })
    assert.equal((await worker.flush()).confirmed, 3)
    const row = scalar(`select row_to_json(o) from (select saldo,payment_status,preparation_status,status,kitchen_items from public.pos_orders where id=${quote(orderId)}) o;`)
    assert.equal(row.saldo, 0); assert.equal(row.payment_status, 'pagada')
    assert.equal(row.preparation_status, 'enviada'); assert.equal(row.status, 'enviada')
    assert.equal(row.kitchen_items.length, 1)
    assert.equal(Number(sql(`select sum(monto) from public.pos_payment_attempts where order_id=${quote(orderId)} and estado='aceptado';`)), 116)
  })
  const manualOrderId = randomUUID(), manualPaymentId = randomUUID()
  const manualCommand = (type, fields) => command(type, { ...fields, order_id: manualOrderId })
  const latestArgs = async () => {
    const all = await storage.readAfter(0)
    let previous = INITIAL_HASH
    for (const event of all.slice(0, -1)) previous = historyHash(previous, event)
    return { p_stream_id: streamId, p_credential: credential, p_previous_history_hash: previous,
      p_history_hash: historyHash(previous, all.at(-1)), p_event: committedEnvelope(all.at(-1)) }
  }
  await check('Independent card payment persists its verified reference and tip separately from sale and cash', async () => {
    await manualCommand('ORDER_SAVE', { expected_revision: 0, catalog_revision: catalog.read().revision, mesa: 2,
      items: [{ line_id: 'manual-coffee', product_id: 'coffee', quantity: 2 }] })
    await manualCommand('ORDER_SEND', { expected_revision: 1 })
    await manualCommand('FINANCIAL_OPEN', { expected_revision: 0, expected_order_revision: 2, total_cents: 11600, currency: 'MXN' })
    await manualCommand('FINANCIAL_PAYMENT_START', { expected_revision: 1, payment_id: manualPaymentId,
      account_id: manualOrderId + ':full', amount_cents: 2900, tip_cents: 290, method: 'manual', tender: 'card' })
    assert.equal((await worker.flush()).confirmed, 4)
    await manualCommand('FINANCIAL_PAYMENT_RESULT', { expected_revision: 2, payment_id: manualPaymentId, status: 'accepted',
      evidence: { kind: 'manual_received', received_by: actor.id, source: 'Synthetic bank terminal', reference: 'CARD-LAB-01', tender: 'card', currency: 'MXN', amount_cents: 3190 } })
    const original = await latestArgs()
    const missingTender = structuredClone(original); delete missingTender.p_event.result.financial_order.payments[0].tender
    assert.match(rpc(missingTender, true), /INVALID_MANUAL_PAYMENT/)
    const alteredTip = structuredClone(original)
    const forged = alteredTip.p_event.result.financial_order
    forged.tip_cents = 300; forged.payments[0].tip_cents = 300; forged.payments[0].evidence.amount_cents = 3200
    assert.match(rpc(alteredTip, true), /PAYMENT_ID_CONFLICT/)
    assert.equal((await worker.flush()).confirmed, 1)
    const row = scalar(`select row_to_json(o) from (select total,saldo,propina,pagos,caja_financial_snapshot,updated_at from public.pos_orders where id=${quote(manualOrderId)}) o;`)
    assert.equal(row.total, 116); assert.equal(row.saldo, 87); assert.equal(row.propina, 2.9)
    assert.equal(row.pagos[0].metodo, 'card'); assert.equal(row.pagos[0].monto, 29); assert.equal(row.pagos[0].propina, 2.9)
    assert.equal(row.caja_financial_snapshot.payments[0].accepted_at, state.getFinancialOrder(manualOrderId).payments[0].accepted_at)
    assert(Date.parse(row.updated_at) >= Date.parse(row.caja_financial_snapshot.payments[0].accepted_at))
    assert.equal(JSON.parse(rpc(original)).duplicate, true)
  })
  await check('Adding consumption and keeping a partial payment updates operational and financial rows atomically', async () => {
    await manualCommand('ORDER_SAVE', { expected_revision: 2, catalog_revision: catalog.read().revision, mesa: 2,
      items: [{ line_id: 'manual-coffee', product_id: 'coffee', quantity: 3 }] })
    const edit = await latestArgs()
    const missing = structuredClone(edit); delete missing.p_event.result.financial_order
    assert.match(rpc(missing, true), /COUPLED_FINANCIAL_RESULT_REQUIRED/)
    const invalid = structuredClone(edit); invalid.p_event.result.financial_order.balance_cents++
    assert.match(rpc(invalid, true), /FINANCIAL_SUM_MISMATCH/)
    assert.equal(Number(sql(`select total from public.pos_orders where id=${quote(manualOrderId)};`)), 116)
    assert.equal((await worker.flush()).confirmed, 1)
    let row = scalar(`select row_to_json(o) from (select total,saldo,propina,financial_revision,caja_financial_snapshot from public.pos_orders where id=${quote(manualOrderId)}) o;`)
    assert.equal(row.total, 174); assert.equal(row.saldo, 145); assert.equal(row.propina, 2.9)
    assert.equal(row.caja_financial_snapshot.payments.length, 1); assert.equal(row.caja_financial_snapshot.payments[0].payment_id, manualPaymentId)
    assert.equal(Number(sql(`select total from public.pos_order_accounts where order_id=${quote(manualOrderId)};`)), 174)
    await manualCommand('ORDER_SEND', { expected_revision: 3 })
    assert.equal((await worker.flush()).confirmed, 1)
    row = scalar(`select caja_financial_snapshot from public.pos_orders where id=${quote(manualOrderId)};`)
    assert.equal(row.order_revision, 4); assert.equal(row.revision, 5)
    worker = new BusinessOutbox(options)
    assert.equal((await worker.flush()).confirmed, 0)
    assert.equal(JSON.parse(rpc(edit)).duplicate, true)
    assert.equal(Number(sql(`select total from public.pos_orders where id=${quote(manualOrderId)};`)), 174)
  })
  await check('Transfer completes consumption plus tips without increasing drawer cash or resurrecting delivered food', async () => {
    const payment = randomUUID()
    await manualCommand('FINANCIAL_PAYMENT_START', { expected_revision: 5, payment_id: payment,
      account_id: manualOrderId + ':full', amount_cents: 14500, tip_cents: 1450, method: 'manual', tender: 'transfer' })
    assert.equal((await worker.flush()).confirmed, 1)
    await manualCommand('FINANCIAL_PAYMENT_RESULT', { expected_revision: 6, payment_id: payment, status: 'accepted',
      evidence: { kind: 'manual_received', received_by: actor.id, source: 'Synthetic transfer bank', reference: 'TRANSFER-LAB-02', tender: 'transfer', currency: 'MXN', amount_cents: 15950 } })
    const accepted = await latestArgs()
    const duplicateReference = structuredClone(accepted)
    const forged = duplicateReference.p_event.result.financial_order.payments.at(-1)
    forged.tender = 'card'; forged.evidence.tender = 'card'; forged.evidence.source = ' SYNTHETIC BANK TERMINAL '; forged.evidence.reference = 'card-lab-01'
    assert.match(rpc(duplicateReference, true), /MANUAL_REFERENCE_REUSED/)
    assert.equal((await worker.flush()).confirmed, 1)
    assert.equal(Number(sql(`select propina from public.pos_orders where id=${quote(manualOrderId)};`)), 17.4)
    assert.equal(Number(sql(`select saldo from public.pos_orders where id=${quote(manualOrderId)};`)), 0)
    const operational = state.getOrder(manualOrderId)
    await manualCommand('KITCHEN_SET', { expected_kitchen_revision: operational.kitchen_revision,
      item_ids: operational.kitchen_items.map(item => item.id), status: 'entregada' })
    assert.equal((await worker.flush()).confirmed, 1)
    const row = scalar(`select row_to_json(o) from (select payment_status,preparation_status from public.pos_orders where id=${quote(manualOrderId)}) o;`)
    assert.equal(row.payment_status, 'pagada'); assert.equal(row.preparation_status, 'entregada')
  })
  await check('Cash movement commits once with its drawer summary and rejects forged totals atomically', async () => {
    assert.ok((await command('CASH_MOVEMENT', { movement_id: randomUUID(), type: 'deposito', amount_cents: 10000, reason: 'Synthetic change fund' })).event)
    assert.equal((await worker.flush()).confirmed, 1)
    assert.ok((await command('CASH_MOVEMENT', { movement_id: randomUUID(), type: 'retiro', amount_cents: 5000, reason: 'Synthetic safe withdrawal' })).event)
    const withdrawal = await latestArgs()
    const invalid = structuredClone(withdrawal); invalid.p_event.result.cash_summary.expected_cash_cents++
    assert.match(rpc(invalid, true), /CASH_MOVEMENT_SUM_MISMATCH/)
    assert.equal(Number(sql(`select count(*) from public.pos_cash_movements where caja_stream_id=${quote(streamId)};`)), 1)
    assert.equal((await worker.flush()).confirmed, 1)
    assert.equal(JSON.parse(rpc(withdrawal)).duplicate, true)
    assert.equal(Number(sql(`select count(*) from public.pos_cash_movements where caja_stream_id=${quote(streamId)};`)), 2)
    assert.match(sql(`update public.pos_cash_movements set amount=1 where caja_stream_id=${quote(streamId)};`, { allowError: true }), /CAJA_WRITE_FENCE/)
    worker = new BusinessOutbox(options)
    assert.equal((await worker.flush()).confirmed, 0)
  })
  await check('Kitchen delivery and counted cash closure persist independently of settlement', async () => {
    const operational = state.getOrder(orderId)
    await command('KITCHEN_SET', { expected_kitchen_revision: operational.kitchen_revision,
      item_ids: operational.kitchen_items.map(item => item.id), status: 'entregada' })
    await command('TURN_CLOSE', { counted_cash_cents: 66600, notes: 'Synthetic closure' })
    assert.equal((await worker.flush()).confirmed, 2)
    const closed = scalar(`select row_to_json(t) from (select fondo_final,efectivo_sistema,diferencia,closed_at from public.pos_turnos where id=${quote(turnoId)}) t;`)
    assert.equal(closed.fondo_final, 666); assert.equal(closed.efectivo_sistema, 666); assert.equal(closed.diferencia, 0)
    assert(closed.closed_at)
    assert.equal(sql(`select preparation_status from public.pos_orders where id=${quote(orderId)};`), 'entregada')
  })
  await check('Revoking a stream blocks later synchronization and preserves pending local events', async () => {
    const previousSequence = worker.status().last_sequence
    await storage.appendInternal('STATE_SYNC', {}, { restaurantId: tenant })
    sql(`update public.pos_caja_streams set active=false where stream_id=${quote(streamId)};`)
    await assert.rejects(worker.flush(), /SYNC_UNAUTHORIZED/)
    assert.equal(worker.status().last_sequence, previousSequence)
    assert.equal((await storage.readAfter(previousSequence)).length, 1)
    assert.match(sql(`update public.pos_orders set total=1 where id=${quote(orderId)};`, { allowError: true }), /CAJA_WRITE_FENCE/, 'credential revocation cannot reopen a legacy writer')
  })
}
main().catch(error => { results.push({ name: 'Execution', passed: false, error: error.stack }); console.error(error.stack); process.exitCode = 1 })
  .finally(() => { fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ tenant, streamId, temporary, results }, null, 2)) })
