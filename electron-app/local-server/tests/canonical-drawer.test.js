'use strict'
const {test,beforeEach,afterEach}=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),{once}=require('node:events'),{spawn}=require('node:child_process')
const domain=require('../core/canonical-drawer'),printer=require('../adapters/printer'),queue=require('../adapters/print-queue'),schema=require('../adapters/printer-config-schema')
const PULSE=Buffer.from([0x1b,0x70,0,0x19,0xfa])
let dir
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'fullsite-drawer-'));queue.init({filePath:path.join(dir,'queue.json')})})
afterEach(()=>fs.rmSync(dir,{recursive:true,force:true}))
const config=(port=1)=>({schema_version:2,drawer_printer_id:'one',printers:['one','two'].map((id,index)=>({printer_id:id,name:id,enabled:true,station_ids:['caja'],document_types:['receipt'],copies:index+3,connection:{type:'tcp',host:'127.0.0.1',port}}))})
function fixture(){
 const operations=[],resolutions=[]
 const order={order_id:'order',turno_id:'turn',authority:'caja',created_by:'actor'}
 const fin={turno_id:'turn',payments:[{payment_id:'cash',method:'cash',status:'accepted',amount_cents:200}]}
 const state={getTurno:()=>({id:'turn',authority:'caja'}),getOrder:()=>order,getFinancialOrder:()=>fin,getDrawerOperations:()=>operations,getDrawerOperation:id=>operations.find(o=>o.operation_id===id),getDrawerResolution:(job,episode)=>resolutions.find(r=>r.job_id===job&&r.uncertain_episode_id===episode)}
 const actor={id:'actor',permissions:['pos.payments.collect','cajero','gerente'],expires_at:Date.now()+100000}
 printer.init({printersConfig:config()})
 return {state,actor,order,fin,operations,resolutions,printer}
}
const payload={command_id:'operation',command_type:'PAYMENT_DRAWER_OPEN',order_id:'order',payment_id:'cash'}
async function receiver(){const received=[];const server=net.createServer(socket=>{const chunks=[];socket.on('data',b=>chunks.push(b));socket.on('end',()=>{received.push(Buffer.concat(chunks));socket.end()});socket.on('error',()=>{})});server.listen(0,'127.0.0.1');await once(server,'listening');return {server,received,port:server.address().port}}
async function waitFor(predicate){for(let i=0;i<400;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10))}assert.fail('Timed out waiting for drawer transport')}
test('explicit configuration selects one drawer despite replicated receipt printers and copies',()=>{
 const f=fixture(),before=JSON.stringify(f.fin),prepared=domain.prepare(payload,f)
 assert.equal(prepared.effects.print_jobs.length,1);assert.equal(prepared.effects.print_jobs[0].copies,1);assert.equal(prepared.effects.print_jobs[0].printer_id,'one')
 assert.deepEqual(Buffer.from(prepared.effects.print_jobs[0].data_b64,'base64'),PULSE);assert.equal(queue.getAllJobs().length,0);assert.equal(JSON.stringify(f.fin),before)
 assert.throws(()=>printer.prepareJobs('caja',PULSE,'drawer_pulse',{commandId:'bad'}),/CONTROLLED_DRAWER/)
 for(const cfg of [{...config(),drawer_printer_id:'missing'},{...config(),drawer_printer_id:9},{...config(),printers:config().printers.map(p=>({...p,enabled:false}))},{...config(),printers:config().printers.map(p=>({...p,station_ids:['barra']}))}]){assert.equal(schema.validate(cfg).valid,false);printer.init({printersConfig:cfg});assert.throws(()=>printer.prepareDrawerJobs({commandId:'bad'}),/DRAWER_NOT_CONFIGURED/)}
 const missing=config();delete missing.drawer_printer_id;assert(schema.validate(missing).valid);printer.init({printersConfig:missing});assert.throws(()=>printer.prepareDrawerJobs({commandId:'bad'}),/DRAWER_NOT_CONFIGURED/)
})
test('cash acceptance, turn, actor scope and original payment identity are checked without mutating money',()=>{
 const f=fixture(),prepared=domain.prepare(payload,f);f.operations.push(prepared.result.drawer_operation)
 assert.throws(()=>domain.prepare({...payload,command_id:'another'},f),/apertura original/)
 f.state.getTurno=()=>null;assert.doesNotThrow(()=>domain.authorize(payload,f));assert.throws(()=>domain.prepare({...payload,command_id:'another'},f),/turno/)
 f.state.getTurno=()=>({id:'turn',authority:'caja'});f.operations.length=0
 for(const values of [{method:'external'},{status:'unknown'},{status:'pending'},{status:'rejected'}]){const prev={...f.fin.payments[0]};Object.assign(f.fin.payments[0],values);assert.throws(()=>domain.prepare(payload,f),/efectivo aceptado/);f.fin.payments[0]=prev}
 f.order.created_by='other';assert.throws(()=>domain.authorize(payload,f),/otro empleado/);f.actor.permissions.push('ver_todas_cuentas');assert.doesNotThrow(()=>domain.prepare(payload,f))
 f.actor.expires_at=0;assert.throws(()=>domain.authorize(payload,f),/sesión/)
})
test('manual opening needs cashier permission, explicit current turn and reason',()=>{
 const f=fixture(),p={command_type:'DRAWER_OPEN',command_id:'manual',turno_id:'turn',reason:'Cambio para caja'}
 assert.equal(domain.prepare(p,f).result.drawer_operation.kind,'manual')
 assert.throws(()=>domain.prepare({...p,reason:''},f),/reason/);assert.throws(()=>domain.prepare({...p,turno_id:'other'},f),/turno cambió/)
 f.actor.permissions=['pos.payments.collect'];assert.throws(()=>domain.prepare(p,f),/cajero/)
})
test('resolution requires canonical drawer job, manager and unreserved current episode',()=>{
 const f=fixture(),prepared=domain.prepare(payload,f);f.operations.push(prepared.result.drawer_operation);queue.enqueueMany(prepared.effects.print_jobs)
 const id=prepared.result.drawer_operation.job_id;queue.markUncertain(id,'unknown')
 const p={command_type:'DRAWER_UNCERTAIN_RESOLVE',command_id:'decision',job_id:id,uncertain_episode_id:queue.getJob(id).uncertain_episode_id,resolution:'retry_pulse',reason:'Cajón no abrió'}
 const decision=domain.prepare(p,f);assert.equal(queue.getJob(id).status,'uncertain')
 f.resolutions.push(decision.result.drawer_resolution);assert.throws(()=>domain.prepare({...p,command_id:'other'},f),/decisión ya confirmada/)
 assert.doesNotThrow(()=>domain.authorize(p,f))
 assert.throws(()=>queue.applyPreparedResolution({...decision.effects.drawer_resolutions[0],resolution:'reprint'}),/TYPE_CONFLICT/)
 assert.throws(()=>queue.resolveUncertain(id,'reprint'),/CONTROLLED_DRAWER/)
 f.actor.permissions=['cajero'];assert.throws(()=>domain.authorize(p,f),/gerente/)
})
test('real TCP sends exactly one pulse and replay/config changes never duplicate it', {timeout:10000},async()=>{
 const target=await receiver(),other=await receiver()
 try{
  printer.init({printersConfig:config(target.port)});const jobs=printer.prepareDrawerJobs({commandId:'pulse'})
  printer.enqueuePreparedJobs(jobs);await waitFor(()=>target.received.length===1&&queue.getJob(jobs[0].job_id).status==='printed')
  assert.deepEqual(target.received[0],PULSE)
  printer.init({printersConfig:config(other.port),queueFilePath:path.join(dir,'queue.json')});printer.enqueuePreparedJobs(jobs)
  await new Promise(r=>setTimeout(r,40));assert.equal(target.received.length,1);assert.equal(other.received.length,0)
 }finally{await Promise.all([new Promise(r=>target.server.close(r)),new Promise(r=>other.server.close(r))])}
})
test('SIGKILL after real pulse stays uncertain; explicit retry uses original destination once without COPIA bytes', {timeout:10000},async()=>{
 const target=await receiver(),other=await receiver(),file=path.join(dir,'crash-queue.json')
 try{
  const script=`const p=require(${JSON.stringify(require.resolve('../adapters/printer'))});const q=require(${JSON.stringify(require.resolve('../adapters/print-queue'))});p.init({printersConfig:${JSON.stringify(config(target.port))},queueFilePath:process.argv[1]});q.markCopyPrinted=()=>process.kill(process.pid,'SIGKILL');p.enqueuePreparedJobs(p.prepareDrawerJobs({commandId:'crashed'}));`
  const child=spawn(process.execPath,['-e',script,file],{stdio:['ignore','pipe','pipe']});const [code,signal]=await once(child,'exit');assert(code!==0||signal)
  await waitFor(()=>target.received.length===1)
  printer.init({printersConfig:config(other.port),queueFilePath:file});const job=queue.getAllJobs()[0];assert.equal(job.status,'uncertain')
  await new Promise(r=>setTimeout(r,30));assert.equal(target.received.length,1)
  const effect={job_id:job.job_id,command_id:'resolve-crash',uncertain_episode_id:job.uncertain_episode_id,resolution:'retry_pulse',reason:'Inspección física',recorded_by:'manager'}
  printer.applyPreparedDrawerResolution(effect);await waitFor(()=>target.received.length===2&&queue.getJob(job.job_id).status==='printed')
  assert(target.received.every(bytes=>bytes.equals(PULSE)));assert.equal(other.received.length,0)
  queue.init({filePath:file});printer.applyPreparedDrawerResolution(effect);await new Promise(r=>setTimeout(r,30));assert.equal(target.received.length,2)
 }finally{await Promise.all([new Promise(r=>target.server.close(r)),new Promise(r=>other.server.close(r))])}
})
test('all-copy receipt crash still allows one explicit pulse; opened verification emits none and replay ignores later episode',async()=>{
 const target=await receiver()
 try{
  printer.init({printersConfig:config(target.port)});const job=printer.prepareDrawerJobs({commandId:'receipt-crash'})[0];queue.enqueue(job);queue.markPrinting(job.job_id);queue.markCopyPrinted(job.job_id);queue.init({filePath:path.join(dir,'queue.json')})
  const effect={job_id:job.job_id,command_id:'decision',uncertain_episode_id:queue.getJob(job.job_id).uncertain_episode_id,resolution:'retry_pulse',reason:'Verified closed',recorded_by:'manager'}
  printer.applyPreparedDrawerResolution(effect);await waitFor(()=>target.received.length===1&&queue.getJob(job.job_id).status==='printed')
  assert.deepEqual(target.received[0],PULSE);assert.equal(queue.getJob(job.job_id).resolution_receipts[0].copies_printed_before,1)
  queue.markUncertain(job.job_id,'another episode');printer.applyPreparedDrawerResolution(effect);await new Promise(r=>setTimeout(r,30));assert.equal(queue.getJob(job.job_id).status,'uncertain');assert.equal(target.received.length,1)
  const verification={...effect,command_id:'verified',uncertain_episode_id:queue.getJob(job.job_id).uncertain_episode_id,resolution:'opened'}
  printer.applyPreparedDrawerResolution(verification);assert.equal(queue.getJob(job.job_id).status,'printed');assert.equal(target.received.length,1)
 }finally{await new Promise(r=>target.server.close(r))}
})
