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
  return sql(`set role service_role; select public.apply_pos_caja_event(${quote(args.p_stream_id)}::uuid,${quote(args.p_credential)},
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
    return handler.handle({ restaurant_id: tenant, payload: { command_type: type, command_id: randomUUID(), turno_id: turnoId, order_id: orderId, ...fields } }, 'synthetic-caja', { actor })
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
  const options = { eventStore: storage, directory: temporary, materializeUrl: 'https://local-test.invalid/api/pos/caja/materialize',
    restaurantId: tenant, locationId: branch, streamId, credential, fetchImpl: async (url, init) => {
      assert.equal(url, 'https://local-test.invalid/api/pos/caja/materialize')
      assert.equal(init.headers.apikey, undefined)
      assert.equal(init.headers.Authorization, undefined)
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
    const order = scalar(`select row_to_json(o) from (select id,order_number,total,saldo,payment_status,preparation_status,items,financial_revision,caja_financial_snapshot from public.pos_orders where id=${quote(orderId)}) o;`)
    assert.equal(order.order_number, 1)
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
  await check('Dual save/send commit both revisions, preserve accepted/unknown attempts, and reject divergent projections atomically', async () => {
    const row = scalar(`select row_to_json(o) from (select caja_operational_snapshot as op,caja_financial_snapshot as fin from pos_orders where id=${quote(orderId)}) o`)
    const stream = scalar(`select row_to_json(s) from (select last_sequence,last_history_hash from pos_caja_streams where stream_id=${quote(streamId)}) s`)
    const paymentRows = scalar(`select jsonb_agg(to_jsonb(p) order by payment_id) from pos_payment_attempts p where order_id=${quote(orderId)}`)
    const op = structuredClone(row.op), fin = structuredClone(row.fin)
    op.order_revision++; op.subtotal_cents+=5000;op.iva_cents+=800;op.total_cents+=5800
    fin.revision++;fin.order_revision=op.order_revision;fin.total_cents+=5800;fin.balance_cents+=5800
    fin.accounts[1].total_cents+=5800;fin.accounts[1].balance_cents+=5800
    const event = {id:randomUUID(),sequence:stream.last_sequence+1,type:'ORDER_SAVE',restaurant_id:tenant,
      payload:{expected_financial_revision:row.fin.revision,account_id:accounts[1]},result:{operational_order:op,financial_order:fin,financial_allocation:{account_id:accounts[1],amount_cents:5800,lines:[]}}}
    const envelope = e => ({p_stream_id:streamId,p_credential:credential,p_previous_history_hash:stream.last_history_hash,p_history_hash:historyHash(stream.last_history_hash,e),p_event:e})
    for (const [mutate, error] of [
      [e=>delete e.result.financial_order,/DUAL_FINANCIAL_REQUIRED/],
      [e=>e.payload.expected_financial_revision--,/DUAL_REVISION_CONFLICT/],
      [e=>e.result.financial_order.order_revision--,/DUAL_REVISION_CONFLICT/],
      [e=>e.result.financial_order.payments[1].status='rejected',/DUAL_PAYMENT_CHANGED/],
      [e=>e.result.financial_order.accounts[0].total_cents++,/DUAL_ACCOUNT_CHANGED/],
      [e=>e.payload.account_id='missing',/DUAL_ACCOUNT_REQUIRED/],
      [e=>e.type='ORDER_SEND',/DUAL_TOTAL_DECREASE/],
      [e=>e.result.operational_order.order_number=2,/ORDER_NUMBER_CHANGED/],
      [e=>delete e.result.operational_order.order_number,/ORDER_NUMBER_CHANGED/],
      [e=>e.result.operational_order.order_number=0,/INVALID_ORDER_NUMBER/],
      [e=>e.result.financial_order.balance_cents++,/FINANCIAL_SUM_MISMATCH/],
      [e=>e.result.financial_allocation.amount_cents++,/DUAL_ALLOCATION_MISMATCH/],
      [e=>e.result.financial_order.turno_id=randomUUID(),/DUAL_ORDER_SCOPE/],
      [e=>e.result.financial_order.opened_by='forged',/DUAL_METADATA_CHANGED/],
      [e=>e.result.financial_order.settled_at='2026-09-10',/DUAL_METADATA_CHANGED/],
      [e=>e.result.financial_order.currency='USD',/DUAL_METADATA_CHANGED/],
    ]) {
      const bad=structuredClone(event);mutate(bad);assert.match(rpc(envelope(bad),true),error)
      assert.equal(Number(sql(`select last_sequence from pos_caja_streams where stream_id=${quote(streamId)}`)),stream.last_sequence)
      assert.deepEqual(scalar(`select caja_financial_snapshot from pos_orders where id=${quote(orderId)}`),row.fin)
      assert.deepEqual(scalar(`select caja_operational_snapshot from pos_orders where id=${quote(orderId)}`),row.op)
    }
    const send=structuredClone(event);send.id=randomUUID();send.sequence++;send.type='ORDER_SEND'
    delete send.result.financial_allocation
    send.payload={expected_financial_revision:fin.revision};send.result.operational_order.order_revision++
    send.result.financial_order.revision++;send.result.financial_order.order_revision++
    const invoke=(e,previous)=>`select apply_pos_caja_event(${quote(streamId)}::uuid,${quote(credential)},${quote(previous)},${quote(historyHash(previous,e))},${json(e)});`
    const otherOrder=randomUUID(), createOther=structuredClone(event)
    createOther.id=randomUUID();createOther.payload={};createOther.result={operational_order:structuredClone(op)}
    createOther.result.operational_order.order_number=2;createOther.result.operational_order.order_id=otherOrder;createOther.result.operational_order.order_revision=1;createOther.result.operational_order.mesa=3
    const cross=structuredClone(event);cross.id=randomUUID();cross.sequence++;cross.result.financial_order.order_id=otherOrder
    const crossed=sql('begin;'+invoke(createOther,stream.last_history_hash)+invoke(cross,historyHash(stream.last_history_hash,createOther))+'rollback;', {allowError:true})
    assert.match(crossed,/DUAL_ORDER_SCOPE/)
    assert.equal(Number(sql(`select count(*) from pos_orders where id=${quote(otherOrder)}`)),0)
    assert.deepEqual(scalar(`select caja_financial_snapshot from pos_orders where id=${quote(orderId)}`),row.fin)
    // Exercise real atomic commits inside one disposable transaction; roll back
    // the fixture so the existing settlement/close scenarios keep their amounts.
    const output=sql('begin;'+invoke(event,stream.last_history_hash)+invoke(send,historyHash(stream.last_history_hash,event))+
      `select jsonb_build_object('fin',caja_financial_snapshot,'op',caja_operational_snapshot,'total',total,'saldo',saldo,'revisions',jsonb_build_array(order_revision,financial_revision),'attempts',(select jsonb_agg(to_jsonb(p) order by payment_id) from pos_payment_attempts p where order_id=${quote(orderId)})) from pos_orders where id=${quote(orderId)};rollback;`).split('\n')
    const dual=JSON.parse(output.at(-1));assert.equal(dual.total,174);assert.equal(dual.saldo,145)
    assert.deepEqual(dual.attempts,paymentRows)
    assert.deepEqual(dual.fin.payments,row.fin.payments);assert.deepEqual(dual.revisions,[row.op.order_revision+2,row.fin.revision+2])
    assert.equal(dual.fin.accounts[0].total_cents,row.fin.accounts[0].total_cents)
    assert.equal(dual.fin.accounts[1].total_cents,row.fin.accounts[1].total_cents+5800)
  })
  await check('Paper documents, abono receipt, explicit copy and uncertain resolution audit without business mutations', async () => {
    const printing=require('../local-server/core/canonical-print'),docs=[]
    const op=state.getOrder(orderId),fin=state.getFinancialOrder(orderId)
    const printState={getOrder:()=>op,getFinancialOrder:()=>fin,getPrintDocuments:()=>docs,getPrintDocument:id=>docs.find(d=>d.document_id===id)}
    const context={state:printState,actor,catalogEnvelope:catalog.read(),printer:{prepareJobs:(_station,_bytes,_type,opts)=>[{job_id:opts.commandId+'-job'}]}}
    const current=scalar(`select row_to_json(s) from (select last_sequence,last_history_hash from pos_caja_streams where stream_id=${quote(streamId)}) s`)
    let seq=current.last_sequence,previous=current.last_history_hash
    const make=(type,extra={})=>{
      const payload={command_type:type,command_id:randomUUID(),order_id:orderId,expected_revision:op.order_revision,expected_financial_revision:fin.revision,...extra}
      const result=printing.prepare(payload,context).result;if(result.print_document)docs.push(result.print_document)
      const event={id:randomUUID(),sequence:++seq,type,restaurant_id:tenant,payload,result}
      const args={p_stream_id:streamId,p_credential:credential,p_previous_history_hash:previous,p_history_hash:historyHash(previous,event),p_event:event};previous=args.p_history_hash;return args
    }
    const pre=make('ORDER_PRECHECK_PRINT'),receipt=make('PAYMENT_RECEIPT_PRINT',{payment_id:paymentId})
    assert.equal(receipt.p_event.result.print_document.content.balance_cents,8700)
    const copy=make('ORDER_PRECHECK_PRINT',{original_document_id:pre.p_event.result.print_document.document_id,reason:'Customer copy'})
    const decision={job_id:pre.p_event.result.print_document.job_ids[0],uncertain_episode_id:'synthetic-episode',resolution:'printed',reason:'Paper verified',recorded_by:actor.id}
    const resolutionEvent={id:randomUUID(),sequence:++seq,type:'PRINT_UNCERTAIN_RESOLVE',restaurant_id:tenant,
      payload:{command_type:'PRINT_UNCERTAIN_RESOLVE',command_id:randomUUID(),...Object.fromEntries(Object.entries(decision).filter(([k])=>k!=='recorded_by'))},result:{print_resolution:decision}}
    const resolution={p_stream_id:streamId,p_credential:credential,p_previous_history_hash:previous,p_history_hash:historyHash(previous,resolutionEvent),p_event:resolutionEvent}
    const statement=a=>`select apply_pos_caja_event(${quote(a.p_stream_id)}::uuid,${quote(a.p_credential)},${quote(a.p_previous_history_hash)},${quote(a.p_history_hash)},${json(a.p_event)});`
    const business=`select jsonb_build_object('orders',(select jsonb_agg(to_jsonb(o) order by id) from pos_orders o),'accounts',(select jsonb_agg(to_jsonb(a) order by account_id) from pos_order_accounts a),'payments',(select jsonb_agg(to_jsonb(p) order by payment_id) from pos_payment_attempts p))`
    const before=scalar(business)
    const output=sql('begin;'+[pre,receipt,copy,resolution,pre].map(statement).join('')+business+';rollback;').split('\n').map(JSON.parse)
    assert(output.slice(0,4).every(r=>r.materialized===false));assert.equal(output[4].duplicate,true);assert.deepEqual(output[5],before)
    for(const [modify,error] of [
      [a=>a.p_event.result.print_document.content.total_cents++,/PRINT_AMOUNT_MISMATCH/],
      [a=>a.p_event.result.print_document.order_revision++,/PRINT_REVISION_CONFLICT/],
      [a=>a.p_event.result.print_document.content.items[0].quantity++,/PRINT_ITEMS_MISMATCH/],
    ]){const bad=structuredClone(pre);modify(bad);assert.match(rpc(bad,true),error)}
    const foreign=randomUUID();seedStream(foreign,'paper-other-branch')
    const other=structuredClone(pre);other.p_stream_id=foreign;other.p_event.sequence=1;other.p_previous_history_hash=INITIAL_HASH
    assert.match(rpc(other,true),/PRINT_ORDER_SCOPE/)
    const foreignJob=structuredClone(resolution);foreignJob.p_stream_id=foreign;foreignJob.p_event.sequence=1;foreignJob.p_previous_history_hash=INITIAL_HASH
    assert.match(sql('begin;'+statement(pre)+statement(foreignJob)+'rollback;',{allowError:true}),/PRINT_JOB_SCOPE/)
    const invalidCopy=structuredClone(copy);invalidCopy.p_event.result.print_document.content.total_cents++
    assert.match(sql('begin;'+statement(pre)+statement(receipt)+statement(invalidCopy)+'rollback;',{allowError:true}),/PRINT_ORIGINAL_SCOPE/)
    const invalidPayment=structuredClone(receipt);invalidPayment.p_event.result.print_document.payment_id='other';invalidPayment.p_event.payload.payment_id='other'
    assert.match(sql('begin;'+statement(pre)+statement(invalidPayment)+'rollback;',{allowError:true}),/PRINT_PAYMENT_SCOPE/)
    const repeatResolution=structuredClone(resolution);repeatResolution.p_event.sequence++;repeatResolution.p_event.id=randomUUID()
    repeatResolution.p_event.payload.command_id=randomUUID();repeatResolution.p_previous_history_hash=resolution.p_history_hash
    assert.match(sql('begin;'+[pre,receipt,copy,resolution,repeatResolution].map(statement).join('')+'rollback;',{allowError:true}),/PRINT_EPISODE_ALREADY_RESOLVED/)
    assert.deepEqual(scalar(business),before)
    assert.equal(Number(sql(`select last_sequence from pos_caja_streams where stream_id=${quote(streamId)}`)),current.last_sequence)
  })
  await check('Drawer payment/manual/episode receipts enforce provenance and never mutate money', async () => {
    const drawer=require('../local-server/core/canonical-drawer'),printer=require('../local-server/adapters/printer'),queue=require('../local-server/adapters/print-queue')
    const operations=[],resolutions=[],op=state.getOrder(orderId),fin=state.getFinancialOrder(orderId)
    printer.init({printersConfig:{schema_version:2,drawer_printer_id:'drawer',printers:[{printer_id:'drawer',name:'Drawer',enabled:true,station_ids:['caja'],copies:3,connection:{type:'tcp',host:'127.0.0.1',port:1}}]}})
    queue.init({filePath:path.join(temporary,'drawer-fixture.json')})
    const drawerState={getTurno:()=>state.getTurno(),getOrder:()=>op,getFinancialOrder:()=>fin,getDrawerOperations:()=>operations,
      getDrawerOperation:id=>operations.find(o=>o.operation_id===id),getDrawerResolution:()=>null}
    const context={state:drawerState,actor,printer}
    const current=scalar(`select row_to_json(s) from (select last_sequence,last_history_hash from pos_caja_streams where stream_id=${quote(streamId)}) s`)
    const envelope=(type,payload,result,sequence,previous)=>{const event={id:randomUUID(),sequence,type,restaurant_id:tenant,payload,result};return {p_stream_id:streamId,p_credential:credential,p_previous_history_hash:previous,p_history_hash:historyHash(previous,event),p_event:event}}
    const build=(type,fields,sequence,previous)=>{const payload={command_type:type,command_id:randomUUID(),...fields};const prepared=drawer.prepare(payload,context);if(prepared.result.drawer_operation){operations.push(prepared.result.drawer_operation);queue.enqueueMany(prepared.effects.print_jobs)}return envelope(type,payload,prepared.result,sequence,previous)}
    const manual=build('DRAWER_OPEN',{turno_id:turnoId,reason:'Supply change'},current.last_sequence+1,current.last_history_hash)
    const paid=build('PAYMENT_DRAWER_OPEN',{order_id:orderId,payment_id:paymentId,turno_id:turnoId},manual.p_event.sequence+1,manual.p_history_hash)
    const job=paid.p_event.result.drawer_operation.job_id;queue.markUncertain(job,'Synthetic outcome')
    const resolution=build('DRAWER_UNCERTAIN_RESOLVE',{job_id:job,uncertain_episode_id:queue.getJob(job).uncertain_episode_id,resolution:'retry_pulse',reason:'Drawer checked closed'},paid.p_event.sequence+1,paid.p_history_hash)
    const statement=a=>`select apply_pos_caja_event(${quote(a.p_stream_id)}::uuid,${quote(a.p_credential)},${quote(a.p_previous_history_hash)},${quote(a.p_history_hash)},${json(a.p_event)});`
    const business=`select jsonb_build_object('orders',(select jsonb_agg(to_jsonb(o) order by id) from pos_orders o),'accounts',(select jsonb_agg(to_jsonb(a) order by account_id) from pos_order_accounts a),'payments',(select jsonb_agg(to_jsonb(p) order by payment_id) from pos_payment_attempts p))`
    const before=scalar(business)
    const rows=sql('begin;'+[manual,paid,resolution,paid].map(statement).join('')+business+';rollback;').split('\n').map(JSON.parse)
    assert(rows.slice(0,3).every(r=>r.materialized===false));assert.equal(rows[3].duplicate,true);assert.deepEqual(rows[4],before)
    const repeated=structuredClone(paid);repeated.p_event.sequence++;repeated.p_previous_history_hash=paid.p_history_hash;repeated.p_event.id=randomUUID();repeated.p_event.payload.command_id=randomUUID();repeated.p_event.result.drawer_operation.operation_id=repeated.p_event.payload.command_id;repeated.p_event.result.drawer_operation.job_id=randomUUID()
    assert.match(sql('begin;'+[manual,paid,repeated].map(statement).join('')+'rollback;',{allowError:true}),/DRAWER_PAYMENT_ALREADY_OPENED/)
    const repeatDecision=structuredClone(resolution);repeatDecision.p_event.sequence++;repeatDecision.p_previous_history_hash=resolution.p_history_hash;repeatDecision.p_event.id=randomUUID();repeatDecision.p_event.payload.command_id=randomUUID()
    assert.match(sql('begin;'+[manual,paid,resolution,repeatDecision].map(statement).join('')+'rollback;',{allowError:true}),/DRAWER_EPISODE_ALREADY_RESOLVED/)
    const paper=structuredClone(resolution);paper.p_event.type='PRINT_UNCERTAIN_RESOLVE';paper.p_event.payload.command_type=paper.p_event.type;paper.p_event.payload.resolution='reprint';paper.p_event.result={print_resolution:{...resolution.p_event.result.drawer_resolution,resolution:'reprint'}}
    assert.match(sql('begin;'+[manual,paid,paper].map(statement).join('')+'rollback;',{allowError:true}),/PRINT_JOB_SCOPE/)
    const foreign=randomUUID();seedStream(foreign,'drawer-other-branch')
    const wrong=structuredClone(manual);wrong.p_stream_id=foreign;wrong.p_event.sequence=1;wrong.p_previous_history_hash=INITIAL_HASH;assert.match(rpc(wrong,true),/DRAWER_TURN_SCOPE/)
    const wrongDecision=structuredClone(resolution);wrongDecision.p_stream_id=foreign;wrongDecision.p_event.sequence=1;wrongDecision.p_previous_history_hash=INITIAL_HASH
    assert.match(sql('begin;'+[manual,paid,wrongDecision].map(statement).join('')+'rollback;',{allowError:true}),/DRAWER_JOB_SCOPE/)
    const noReason=structuredClone(manual);noReason.p_event.result.drawer_operation.reason='';assert.match(rpc(noReason,true),/INVALID_DRAWER_OPERATION/)
    // Materialize a genuine accepted external attempt in this disposable transaction.
    const {FinancialDomain}=require('../local-server/core/financial-domain'),financial=new FinancialDomain();financial.hydrate([fin]);const card=randomUUID()
    const startPayload={command_id:randomUUID(),command_type:'FINANCIAL_PAYMENT_START',order_id:orderId,expected_revision:fin.revision,payment_id:card,account_id:accounts[1],amount_cents:100,method:'external',provider:'terminal'}
    const startResult=financial.prepare(startPayload,{order:op,turno:state.getTurno(),actor});financial.hydrate([startResult.financial_order])
    const acceptedPayload={command_id:randomUUID(),command_type:'FINANCIAL_PAYMENT_RESULT',order_id:orderId,expected_revision:startResult.financial_order.revision,payment_id:card,status:'accepted',evidence:{kind:'provider_result',provider:'terminal',status:'accepted',reference:'isolated-card',currency:'MXN',amount_cents:100}}
    const acceptedResult=financial.prepare(acceptedPayload,{order:op,turno:state.getTurno(),actor})
    const start=envelope(startPayload.command_type,startPayload,startResult,current.last_sequence+1,current.last_history_hash)
    const accepted=envelope(acceptedPayload.command_type,acceptedPayload,acceptedResult,start.p_event.sequence+1,start.p_history_hash)
    const cardDrawer=structuredClone(paid);cardDrawer.p_event.sequence=accepted.p_event.sequence+1;cardDrawer.p_previous_history_hash=accepted.p_history_hash;cardDrawer.p_event.payload.payment_id=card;cardDrawer.p_event.result.drawer_operation.payment_id=card;cardDrawer.p_event.result.drawer_operation.amount_cents=100
    assert.match(sql('begin;'+[start,accepted,cardDrawer].map(statement).join('')+'rollback;',{allowError:true}),/DRAWER_CASH_PAYMENT_REQUIRED/)
    assert.deepEqual(scalar(business),before)
    assert.equal(Number(sql(`select last_sequence from pos_caja_streams where stream_id=${quote(streamId)}`)),current.last_sequence)
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
    const projected=scalar(`select jsonb_build_object('operational_order',caja_operational_snapshot,'financial_order',caja_financial_snapshot) from pos_orders where id=${quote(orderId)}`)
    const current=scalar(`select row_to_json(s) from (select last_sequence,last_history_hash from pos_caja_streams where stream_id=${quote(streamId)}) s`)
    projected.operational_order.order_revision++;projected.financial_order.revision++;projected.financial_order.order_revision++
    const reopen={id:randomUUID(),sequence:current.last_sequence+1,type:'ORDER_SEND',restaurant_id:tenant,
      payload:{expected_financial_revision:projected.financial_order.revision-1},result:projected}
    assert.match(rpc({p_stream_id:streamId,p_credential:credential,p_previous_history_hash:current.last_history_hash,
      p_history_hash:historyHash(current.last_history_hash,reopen),p_event:reopen},true),/DUAL_FINANCIAL_REQUIRED/)

    assert.equal(Number(sql(`select sum(monto) from public.pos_payment_attempts where order_id=${quote(orderId)} and estado='aceptado';`)), 116)
  })
  await check('Cash movements materialize exactly once and reconcile the same Z close', async () => {
    await command('CASH_MOVEMENT', { movement_id:'withdrawal',type:'retiro',amount_cents:2000,reason:'Safe deposit' })
    await command('CASH_MOVEMENT', { movement_id:'deposit',type:'deposito',amount_cents:500,reason:'Change supplied' })
    assert.equal((await worker.flush()).confirmed,2)
    assert.equal((await worker.flush()).confirmed,0)
    assert.equal(Number(sql(`select count(*) from public.pos_cash_movements where turno_id=${quote(turnoId)};`)),2)
    assert.equal(Number(sql(`select sum(case when type='deposito' then amount else -amount end) from public.pos_cash_movements where turno_id=${quote(turnoId)};`)),-15)
  })
  await check('Kitchen delivery and counted cash closure persist independently of settlement', async () => {
    const operational = state.getOrder(orderId)
    await command('KITCHEN_SET', { expected_kitchen_revision: operational.kitchen_revision,
      item_ids: operational.kitchen_items.map(item => item.id), status: 'entregada' })
    await command('TURN_CLOSE', { counted_cash_cents: 60100, notes: 'Synthetic closure' })
    assert.equal((await worker.flush()).confirmed, 2)
    const closed = scalar(`select row_to_json(t) from (select fondo_final,efectivo_sistema,diferencia,closed_at from public.pos_turnos where id=${quote(turnoId)}) t;`)
    assert.equal(closed.fondo_final, 601); assert.equal(closed.efectivo_sistema, 601); assert.equal(closed.diferencia, 0)
    assert(closed.closed_at)
    assert.equal(sql(`select preparation_status from public.pos_orders where id=${quote(orderId)};`), 'entregada')
  })
  await check('Z resets the canonical ordinal in the same business day with the real daily trigger and index', async () => {
    const nextTurn = randomUUID(), nextOrder = randomUUID()
    const opening = await command('TURN_OPEN', { turno_id: nextTurn, opening_cash_cents: 0, opening_reason: 'Resguardo después del corte' })
    assert.ok(opening.result)
    assert.ok((await command('ORDER_SAVE', { turno_id: nextTurn, order_id: nextOrder, expected_revision: 0,
      catalog_revision: catalog.read().revision, mesa: 1, items: [{ line_id: 'next-coffee', product_id: 'coffee', quantity: 1 }] })).result)
    assert.equal((await worker.flush()).confirmed, 2)
    assert.deepEqual(scalar(`select caja_snapshot->'opening_reconciliation' from pos_turnos where id=${quote(nextTurn)}`), opening.result.turno.opening_reconciliation)
    const rows = scalar(`select json_agg(o order by id) from (select id,order_number,dia_venta from pos_orders where id in (${quote(orderId)},${quote(nextOrder)})) o`)
    assert.equal(rows.length, 2)
    assert(rows.every(o => o.order_number === 1))
    assert.equal(rows[0].dia_venta, rows[1].dia_venta)
  })
  await check('Old Caja receipts with absent or previously inferred ordinals do not block canonical numbering or exact retries', async () => {
    const current = scalar(`select row_to_json(s) from (select last_sequence,last_history_hash from pos_caja_streams where stream_id=${quote(streamId)}) s`)
    const template = committedEnvelope((await storage.readAfter(current.last_sequence - 1))[0])
    const fn = file => {
      const source = fs.readFileSync(path.join(ROOT, 'supabase/migrations', file), 'utf8')
      const start = source.indexOf('create or replace function public.set_pos_order_number()')
      return source.slice(start, source.indexOf('$$;', start) + 3)
    }
    const oldFn = fn('20260901180000_folio_por_dia_de_venta.sql')
    const newFn = fn('PENDIENTE_20260910080000_caja_folio_por_turno.sql')
    const invoke = (event, previous) => `select apply_pos_caja_event(${quote(streamId)}::uuid,${quote(credential)},${quote(previous)},${quote(historyHash(previous,event))},${json(event)});`
    for (const previouslyMaterialized of [false, true]) {
      const old = structuredClone(template), next = structuredClone(template)
      old.id=randomUUID();old.sequence=current.last_sequence+1;old.payload.command_id=randomUUID()
      old.result.operational_order.id=old.result.operational_order.order_id=randomUUID()
      old.result.operational_order.mesa=2
      delete old.result.operational_order.order_number
      next.id=randomUUID();next.sequence=old.sequence+1;next.payload.command_id=randomUUID()
      next.result.operational_order.id=next.result.operational_order.order_id=randomUUID()
      next.result.operational_order.mesa=3;next.result.operational_order.order_number=2
      const oldHash=historyHash(current.last_history_hash,old)
      const result=sql('begin;'+(previouslyMaterialized?oldFn:'')+invoke(old,current.last_history_hash)+newFn+invoke(next,oldHash)+invoke(old,current.last_history_hash)+
        `select json_build_object('old',(select order_number from pos_orders where id=${quote(old.result.operational_order.order_id)}),'new',(select order_number from pos_orders where id=${quote(next.result.operational_order.order_id)}));rollback;`).split('\n')
      const row=result.map(line=>{try{return JSON.parse(line)}catch{return null}}).find(value=>value&&Object.hasOwn(value,'old'))
      assert.equal(row.new,2)
      assert.equal(row.old,previouslyMaterialized?2:null)
    }
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
