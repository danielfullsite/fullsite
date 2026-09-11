'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {CoreEventStore}=require('../core/event-store'),{NdjsonEventStore}=require('../adapters/storage/ndjson'),{RestaurantState}=require('../core/state'),{CommandHandler}=require('../core/command-handler')
const {permissionsFor}=require('../core/actor-authority'),queue=require('../adapters/print-queue')
const actor={id:'operator',permissions:permissionsFor('admin'),expires_at:Date.now()+3600000}
async function setup(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fullsite-drawer-runtime-'))
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  let fail=false,route='original',count=0
  const printer={getJob:queue.getJob,prepareDrawerJobs:({commandId})=>[{job_id:commandId,command_id:commandId,printer_id:route,station_id:'caja',
    connection:{type:'tcp',host:'127.0.0.1',port:9100},document_type:'drawer_pulse',copies:1,data_b64:Buffer.from([0x1b,0x70,0,0x19,0xfa]).toString('base64')}],
    enqueuePreparedJobs(jobs){if(fail)throw new Error('queue disk full');return queue.enqueueMany(jobs)},
    applyPreparedDrawerResolution(effect){if(fail)throw new Error('queue disk full');return queue.applyPreparedDrawerResolution(effect)}}
  async function restart() {
    queue.init({filePath:path.join(dir,'queue.json')})
    const store=new CoreEventStore(new NdjsonEventStore({eventLogPath:path.join(dir,'events.ndjson')}));await store.load()
    const state=new RestaurantState({localAuthorityEnabled:true});for(const event of await store.readAfter(0))state.apply(event)
    const handler=new CommandHandler({eventStore:store,state,wsHub:{async broadcast(){}},restaurantId:'lab',localAuthorityEnabled:true,printer})
    const send=(type,fields={},who=actor)=>handler.handle({restaurant_id:'lab',payload:{command_type:type,command_id:`cmd-${++count}`,...fields}},'terminal',{actor:who})
    return {store,state,handler,send,restart,fail:value=>{fail=value},route:value=>{route=value}}
  }
  const s=await restart();assert.ok((await s.send('TURN_OPEN',{turno_id:'turn',opening_cash_cents:0})).event)
  const order={id:'order',order_id:'order',authority:'caja',turno_id:'turn',created_by:actor.id,order_revision:1,mesa:1,status:'abierta',payment_status:'pagada',total_cents:10000,total:100,saldo:0,items:'[]'}
  const fin={order_id:'order',turno_id:'turn',currency:'MXN',revision:3,order_revision:1,total_cents:10000,paid_cents:10000,reserved_cents:0,balance_cents:0,status:'settled',
    accounts:[{account_id:'full',total_cents:10000,paid_cents:10000,reserved_cents:0,balance_cents:0}],payments:[{payment_id:'paid',account_id:'full',status:'accepted',method:'cash',amount_cents:10000,evidence:{kind:'cash_received',received_by:actor.id,received_cents:10000},change_cents:0}]}
  const seed=await s.store.processCommand({command_id:'seed',type:'ORDER_SAVE',restaurant_id:'lab',payload:{command_id:'seed'}},{eventType:'ORDER_SAVE',buildResult:()=>({operational_order:order,financial_order:fin})});s.state.apply(seed.event)
  return s
}
const payment={order_id:'order',payment_id:'paid',turno_id:'turn'}
test('payment drawer is once per accepted cash payment; recovery after closed shift preserves original pulse and financial state',async t=>{
  let s=await setup(t);const before=s.state.getFinancialOrder('order')
  s.fail(true);await assert.rejects(s.send('PAYMENT_DRAWER_OPEN',{...payment,command_id:'pulse'}),/disk full/)
  assert.equal(s.state.getDrawerOperations().length,1);assert.equal(queue.getAllJobs().length,0)
  const seq=await s.store.getLastSequence()
  assert.equal((await s.send('PAYMENT_DRAWER_OPEN',payment)).code,'DRAWER_PAYMENT_ALREADY_OPENED');assert.equal(await s.store.getLastSequence(),seq)
  assert.ok((await s.send('TURN_CLOSE',{turno_id:'turn',counted_cash_cents:10000})).event)
  s.fail(false);s.route('changed');s=await s.restart();await s.handler.recoverPendingEffects()
  assert.equal((await s.send('PAYMENT_DRAWER_OPEN',{...payment,command_id:'pulse'})).duplicate,true)
  assert.equal(queue.getAllJobs().length,1);assert.equal(queue.getJob('pulse').printer_id,'original')
  assert.deepEqual(s.state.getFinancialOrder('order'),before)
  const mirror=new RestaurantState();mirror.hidratarDesdeSnapshot(s.state.toSnapshot());assert.deepEqual(mirror.getDrawerOperations(),s.state.getDrawerOperations())
})
test('drawer resolution reserves episode before queue effect; another decision cannot poison replay',async t=>{
  let s=await setup(t);await s.send('DRAWER_OPEN',{command_id:'manual',turno_id:'turn',reason:'Cambio'})
  queue.markUncertain('manual','interrupted pulse')
  const episode=queue.getJob('manual').uncertain_episode_id,decision={command_id:'decision',job_id:'manual',uncertain_episode_id:episode,resolution:'retry_pulse',reason:'Encargado verificó que sigue cerrado'}
  s.fail(true);await assert.rejects(s.send('DRAWER_UNCERTAIN_RESOLVE',decision),/disk full/)
  assert.equal((await s.send('DRAWER_UNCERTAIN_RESOLVE',{...decision,command_id:'different',resolution:'opened'})).code,'DRAWER_EPISODE_ALREADY_RESOLVED')
  s.fail(false);s=await s.restart();await s.handler.recoverPendingEffects();assert.equal(queue.getJob('manual').status,'pending')
  queue.markUncertain('manual','second interruption');const next=queue.getJob('manual').uncertain_episode_id
  s=await s.restart();await s.handler.recoverPendingEffects();assert.equal((await s.send('DRAWER_UNCERTAIN_RESOLVE',decision)).duplicate,true)
  assert.equal(queue.getJob('manual').status,'uncertain');assert.equal(queue.getJob('manual').uncertain_episode_id,next)
  assert.equal(s.state.getDrawerResolution('manual',episode).command_id,'decision')
})
test('drawer transport requires actor and duplicate requests still require current permissions',async t=>{
  const s=await setup(t),command={command_id:'manual',turno_id:'turn',reason:'Cambio'}
  for(const type of ['DRAWER_OPEN','PAYMENT_DRAWER_OPEN','DRAWER_UNCERTAIN_RESOLVE'])assert.equal(s.handler.requiresActor(type),true)
  assert.equal((await s.send('DRAWER_OPEN',command,{...actor,permissions:[]})).code,'PERMISSION_DENIED')
  assert.ok((await s.send('DRAWER_OPEN',command)).event)
  assert.equal((await s.send('DRAWER_OPEN',command,{...actor,permissions:[]})).code,'PERMISSION_DENIED')
  assert.equal(queue.getAllJobs().length,1)
  queue.markUncertain('manual','lost')
  assert.equal((await s.send('PRINT_UNCERTAIN_RESOLVE',{job_id:'manual',uncertain_episode_id:queue.getJob('manual').uncertain_episode_id,resolution:'reprint',reason:'Wrong route'})).code,'PRINT_LEGACY_RECONCILIATION_REQUIRED')
})
