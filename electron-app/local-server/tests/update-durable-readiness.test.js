'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { randomUUID } = require('node:crypto')
const { RestaurantState } = require('../core/state')
const { CoreEventStore } = require('../core/event-store')
const { NdjsonEventStore } = require('../adapters/storage/ndjson')
const { BusinessOutbox } = require('../core/business-outbox')
const printQueue = require('../adapters/print-queue')
const { buildInstallSnapshot } = require('../update/snapshot')
const { puedeInstalarAhora } = require('../update/politica')
const installer = require('../../update/auto-installer')

async function fixture(t, authoritative = true) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'fullsite-update-gate-'))
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}))
  const store = new CoreEventStore(new NdjsonEventStore({eventLogPath:path.join(directory,'events.ndjson')}))
  await store.load()
  const state = new RestaurantState({localAuthorityEnabled:authoritative})
  state.apply({type:'TURN_CLOSE',result:{turno:null}})
  const config = {localAuthorityEnabled:authoritative,terminalRole:'server_pos'}
  printQueue.init({filePath:path.join(directory,'print.json')})
  const printer = {getQueue:printQueue.getAllJobs}
  const outbox = new BusinessOutbox({eventStore:store,directory,restaurantId:'lab',locationId:'branch',streamId:randomUUID(),credential:'synthetic-credential-that-is-long-enough',
    fetchImpl:async(_url,options)=>{
      const body=JSON.parse(options.body)
      return Response.json({stream_id:body.p_stream_id,sequence:body.p_event.sequence,event_id:body.p_event.id,history_hash:body.p_history_hash,materialized:true,duplicate:false})
    }})
  const snapshot = () => buildInstallSnapshot({state,eventStore:store,printer,config,
    getBusinessSyncStatus:()=>authoritative?outbox.status():{configured:false}})
  return {store,state,config,printer,outbox,snapshot}
}

test('paid and closed work waits for business receipts; cached pending zero cannot hide a newly committed event',async t=>{
  const f=await fixture(t)
  assert.equal(puedeInstalarAhora(f.snapshot()).permitido,false,'unknown initial cursor is not confirmed')
  const event=await f.store.appendInternal('STATE_SYNC',{}, {restaurantId:'lab'})
  f.state.apply({type:'FINANCIAL_PAYMENT_RESULT',result:{financial_order:{order_id:'paid',total_cents:100,balance_cents:0,reserved_cents:0,payments:[{status:'accepted'}]}}})
  await f.outbox.flush()
  assert.equal(puedeInstalarAhora(f.snapshot()).permitido,true)
  await f.store.appendInternal('STATE_SYNC',{}, {restaurantId:'lab'})
  assert.equal(f.outbox.status().pending_events,0,'cached counter remains zero until next flush')
  assert.equal(puedeInstalarAhora(f.snapshot()).permitido,false,'fresh durable sequence catches pending publication')
  await f.outbox.flush()
  assert.equal(puedeInstalarAhora(f.snapshot()).permitido,true)
  assert.equal(event.sequence,1)
})

test('real durable print jobs block until resolved, including uncertain and failed outcomes',async t=>{
  const f=await fixture(t,false)
  assert.equal(puedeInstalarAhora(f.snapshot()).permitido,true,'idle legacy without business stream remains installable')
  const id=printQueue.enqueue({station_id:'caja',printer_id:'printer',connection:{},data_b64:'dGVzdA=='})
  assert.equal(puedeInstalarAhora(f.snapshot()).permitido,false)
  for(const mark of [printQueue.markPrinting,printQueue.markRecoverable,printQueue.markRetrying,printQueue.markFailed,printQueue.markUncertain]) {
    mark(id); assert.equal(puedeInstalarAhora(f.snapshot()).permitido,false)
  }
  printQueue.resolveUncertain(id,'printed')
  assert.equal(puedeInstalarAhora(f.snapshot()).permitido,true)
  f.printer.getQueue=undefined
  assert.equal(puedeInstalarAhora(f.snapshot()).permitido,false,'missing configured local queue does not mean empty')
})

test('Caja mode requires complete queue evidence; secondaries and outstanding reservations never authorize install',async t=>{
  const f=await fixture(t)
  await f.outbox.flush()
  const ready=f.snapshot()
  assert.equal(puedeInstalarAhora({...ready,install_readiness:undefined}).permitido,false)
  assert.equal(puedeInstalarAhora({...ready,install_readiness:{...ready.install_readiness,business_sync:null}}).permitido,false)
  assert.equal(puedeInstalarAhora({...ready,financial_orders:[{balance_cents:0,reserved_cents:1,payments:[]}]}).permitido,false)
  assert.equal(puedeInstalarAhora({...ready,financial_orders:[{balance_cents:0,reserved_cents:0,payments:[{status:'unknown'}]}]}).permitido,false)
  assert.equal(puedeInstalarAhora({...ready,mesas:{1:{status:'ocupada'}}}).permitido,false)
  assert.equal(puedeInstalarAhora({...ready,salon_orders:[{mesa:null}]}).permitido,false)
  f.config.posServerIp='192.0.2.1'
  assert.equal(puedeInstalarAhora(f.snapshot()).permitido,false,'secondary mirror is not proof of primary idle')
})

test('installer rechecks durable queues after blocked-version network lookup',async t=>{
  installer._reset(); t.after(()=>installer._reset())
  const f=await fixture(t,false)
  let installs=0
  const handle=installer.iniciar({canal:'stable',getSnapshot:f.snapshot,estaBloqueada:async()=>false,
    updaterInyectado:{on(){},quitAndInstall(){installs++}}})
  t.after(()=>handle.detener())
  installer._marcarDescargada('9.0.0')
  const blocked=await installer.intentarInstalar({getSnapshot:f.snapshot,estaBloqueada:async()=>{
    printQueue.enqueue({station_id:'caja',printer_id:'printer',connection:{},data_b64:'dGVzdA=='})
    return false
  }})
  assert.equal(blocked.instalo,false); assert.equal(installs,0)
  printQueue.markPrinted(printQueue.getAllJobs()[0].job_id)
  assert.equal((await installer.intentarInstalar({getSnapshot:f.snapshot,estaBloqueada:async()=>false})).instalo,true)
  assert.equal(installs,1)
})

test('a command being prepared cannot be mistaken for a drained store',async t=>{
  const f=await fixture(t,false)
  let finish, entered
  const preparing=new Promise(resolve=>{entered=resolve})
  const operation=f.store.processCommand({command_id:'in-flight',type:'MESA_UNLOCK',restaurant_id:'lab',client_id:'terminal',payload:{}},
    {eventType:'MESA_UNLOCK',buildResult:()=>{entered();return new Promise(resolve=>{finish=resolve})}})
  await preparing
  assert.equal(puedeInstalarAhora(f.snapshot()).permitido,false)
  finish({})
  await operation
  assert.equal(puedeInstalarAhora(f.snapshot()).permitido,true)
})
