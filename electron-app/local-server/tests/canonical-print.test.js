'use strict'
const {test,beforeEach,afterEach}=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const domain=require('../core/canonical-print'),queue=require('../adapters/print-queue')
let dir
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'fullsite-print-doc-'));queue.init({filePath:path.join(dir,'queue.json')})})
afterEach(()=>fs.rmSync(dir,{recursive:true,force:true}))
const job={job_id:'job',command_id:'original',station_id:'caja',printer_id:'p',printer_name:'Caja',connection:{type:'tcp',host:'secret-host'},document_type:'receipt',data_b64:Buffer.from('original').toString('base64'),copies:2}
function fixture(){
 const order={order_id:'order',authority:'caja',created_by:'manager',order_revision:2,mesa:1,subtotal_cents:1500,iva_cents:240,total_cents:1740,items:JSON.stringify([{nombre:'Cafe\x1bp',cantidad:1,precio:10,precioExtra:5,total_cents:1500}])}
 const fin={order_id:'order',order_revision:2,revision:4,paid_cents:500,reserved_cents:200,balance_cents:1240,payments:[{payment_id:'accepted',status:'accepted',method:'cash',amount_cents:500,evidence:{received_cents:1000},change_cents:500},{payment_id:'unknown',status:'unknown',amount_cents:200}]}
 const docs=[];const context={state:{getPrintResolution:()=>null,getOrder:()=>order,getFinancialOrder:()=>fin,getPrintDocuments:()=>docs,getPrintResolution:()=>null,getCanonicalPrintJob:()=>({command_id:job.command_id}),getPrintDocument:id=>docs.find(d=>d.document_id===id)},actor:{id:'manager',expires_at:Date.now()+100000,permissions:['imprimir_cuentas','reimpresion_preticket','gerente']},catalogEnvelope:{catalog:{config:{display_name:'Cafe'}}},printer:{prepareJobs:(station,bytes,type,opts)=>[{...job,job_id:opts.commandId,command_id:opts.commandId,data_b64:bytes.toString('base64'),document_type:type}],getJob:queue.getJob}}
 const payload={command_type:'ORDER_PRECHECK_PRINT',command_id:'doc1',order_id:'order',expected_revision:2,expected_financial_revision:4}
 return {order,fin,docs,context,payload}
}
test('precheck freezes canonical modifiers, abonos/reservations and safe bytes without money mutation',()=>{
 const f=fixture(),before=JSON.stringify([f.order,f.fin]);const prepared=domain.prepare({...f.payload,total_cents:1},f.context)
 assert.equal(prepared.result.print_document.content.items[0].total_cents,1500)
 const bytes=Buffer.from(prepared.effects.print_jobs[0].data_b64,'base64')
 assert.match(bytes.toString(),/NO ACREDITA PAGO/);assert.match(bytes.toString(),/15.00/);assert.match(bytes.toString(),/Saldo 12.40/)
 assert(!bytes.includes(Buffer.from([0x1b,0x70])));assert.equal(JSON.stringify([f.order,f.fin]),before)
 assert.equal(queue.getAllJobs().length,0)
})
test('receipt accepts an abono but rejects unknown payment, stale revisions and expired actor',()=>{
 const f=fixture(),p={...f.payload,command_type:'PAYMENT_RECEIPT_PRINT',payment_id:'accepted'}
 const result=domain.prepare(p,f.context).result.print_document
 assert.equal(result.content.payment.change_cents,500);assert.equal(result.content.balance_cents,1240)
 assert.throws(()=>domain.prepare({...p,payment_id:'unknown'},f.context),/aceptado/)
 assert.throws(()=>domain.prepare({...p,expected_financial_revision:3},f.context),/cambió/)
 f.context.actor.expires_at=0;assert.throws(()=>domain.authorize(p,f.context),/sesión/)
})
test('new original is rejected; explicit copy preserves historical amounts after later consumption',()=>{
 const f=fixture();const original=domain.prepare(f.payload,f.context).result.print_document;f.docs.push(original)
 assert.throws(()=>domain.prepare({...f.payload,command_id:'other'},f.context),/copia explícita/)
 f.order.total_cents=9000;f.fin.revision++
 const copy=domain.prepare({...f.payload,command_id:'copy',original_document_id:'doc1',reason:'Cliente solicita'},f.context)
 assert.deepEqual(copy.result.print_document.content,original.content)
 assert.match(Buffer.from(copy.effects.print_jobs[0].data_b64,'base64').toString(),/COPIA/)
 f.context.actor.permissions=['imprimir_cuentas'];assert.throws(()=>domain.prepare({...f.payload,original_document_id:'doc1',reason:'copy'},f.context),/autorizada/)
})
test('configuration and foreign-order permissions fail before effects',()=>{
 const f=fixture();f.order.created_by='other';assert.throws(()=>domain.prepare(f.payload,f.context),/otro empleado/)
 f.context.actor.permissions.push('ver_todas_cuentas');f.context.printer.prepareJobs=()=>[]
 assert.throws(()=>domain.prepare(f.payload,f.context),/salida/)
})
test('uncertain decisions are pure preparation and reauthorize duplicates without requiring old episode state',()=>{
 queue.enqueue(job);queue.markUncertain('job','lost');const episode=queue.getJob('job').uncertain_episode_id
 const f=fixture(),p={command_type:'PRINT_UNCERTAIN_RESOLVE',command_id:'resolve',job_id:'job',uncertain_episode_id:episode,resolution:'printed',reason:'Papel verificado'}
 const result=domain.prepare(p,f.context);assert.equal(queue.getJob('job').status,'uncertain')
 queue.applyPreparedResolution(result.effects.print_resolutions[0]);assert.equal(queue.getJob('job').status,'printed')
 assert.doesNotThrow(()=>domain.authorize(p,f.context));assert.throws(()=>domain.prepare({...p,command_id:'new'},f.context),/episodio/)
})
test('resolution survives restart; replay cannot resolve next uncertain episode or enqueue another original',()=>{
 queue.enqueue(job);queue.markPrinting('job');queue.markCopyPrinted('job');queue.markUncertain('job','lost')
 const episode=queue.getJob('job').uncertain_episode_id,effect={job_id:'job',command_id:'resolve1',uncertain_episode_id:episode,resolution:'reprint',reason:'Papel faltante',recorded_by:'manager'}
 queue.applyPreparedResolution(effect);queue.init({filePath:path.join(dir,'queue.json')})
 assert.equal(queue.applyPreparedResolution(effect).duplicate,true)
 assert.equal(queue.getJob('job').copies_printed,1)
 assert.match(Buffer.from(queue.getJob('job').reprint_data_b64,'base64').toString(),/COPIA/)
 queue.enqueue(job);assert.equal(queue.getAllJobs().length,1)
 queue.markPrinting('job');queue.init({filePath:path.join(dir,'queue.json')})
 const newer=queue.getJob('job').uncertain_episode_id;assert.notEqual(newer,episode)
 assert.equal(queue.applyPreparedResolution(effect).duplicate,true);assert.equal(queue.getJob('job').status,'uncertain')
 assert.throws(()=>queue.applyPreparedResolution({...effect,command_id:'new'}),/EPISODE_CONFLICT/)
 assert.throws(()=>queue.applyPreparedResolution({...effect,resolution:'printed'}),/ID_REUSED/)
 const dto=queue.getUncertainJobSummaries()[0];assert(!('data_b64'in dto));assert(!('connection'in dto));assert.equal(dto.uncertain_episode_id,newer)
})
test('failed queue persistence cannot acknowledge or forget resolution',()=>{
 queue.enqueue(job);queue.markUncertain('job','lost');const effect={job_id:'job',command_id:'resolution',uncertain_episode_id:queue.getJob('job').uncertain_episode_id,resolution:'printed',reason:'verified',recorded_by:'manager'}
 const rename=fs.renameSync;fs.renameSync=()=>{throw new Error('ENOSPC')}
 try {assert.throws(()=>queue.applyPreparedResolution(effect),/ENOSPC/)}finally{fs.renameSync=rename}
 assert.equal(queue.getJob('job').status,'uncertain')
 queue.init({filePath:path.join(dir,'queue.json')});assert.equal(queue.applyPreparedResolution(effect).duplicate,false)
})
test('real TCP recovery sends COPIA only for remaining copies and duplicate resolution sends nothing', {timeout:10000}, async()=>{
 const net=require('node:net'),{once}=require('node:events'),printer=require('../adapters/printer'),received=[]
 const server=net.createServer(socket=>{let data='';socket.on('data',b=>data+=b.toString());socket.on('end',()=>{received.push(data);socket.end()});socket.on('error',()=>{})})
 server.listen(0,'127.0.0.1');await once(server,'listening')
 try {
  queue.enqueue({...job,connection:{type:'tcp',host:'127.0.0.1',port:server.address().port}})
  queue.markPrinting('job');queue.markCopyPrinted('job');queue.markUncertain('job','partial')
  const effect={job_id:'job',command_id:'tcp-resolution',uncertain_episode_id:queue.getJob('job').uncertain_episode_id,resolution:'reprint',reason:'One copy missing',recorded_by:'manager'}
  printer.applyPreparedResolution(effect)
  for(let i=0;i<200&&(queue.getJob('job').status!=='printed'||received.length===0);i++) await new Promise(r=>setTimeout(r,10))
  assert.equal(queue.getJob('job').status,'printed');assert.equal(received.length,1);assert.match(received[0],/COPIA.*\noriginal/)
  printer.applyPreparedResolution(effect);await new Promise(r=>setTimeout(r,30));assert.equal(received.length,1)
 } finally {await new Promise(r=>server.close(r))}
})
test('cancelled order only permits explicit historical copy; discounts and external references use canonical values',()=>{
 const f=fixture();f.order.total_cents=1640;f.fin.balance_cents=1140
 const original=domain.prepare(f.payload,f.context);f.docs.push(original.result.print_document)
 assert.equal(original.result.print_document.content.discount_cents,100)
 assert.match(Buffer.from(original.effects.print_jobs[0].data_b64,'base64').toString(),/Descuento 1.00/)
 f.order.status='cancelada';assert.throws(()=>domain.prepare({...f.payload,command_id:'new'},f.context),/cancelada/)
 assert.doesNotThrow(()=>domain.prepare({...f.payload,command_id:'copy',original_document_id:'doc1',reason:'Consulta histórica'},f.context))
 f.fin.payments[0]={payment_id:'accepted',status:'accepted',method:'external',amount_cents:500,provider:'terminal',evidence:{reference:'AUTH-123'}}
 const receipt=domain.prepare({...f.payload,command_id:'receipt',command_type:'PAYMENT_RECEIPT_PRINT',payment_id:'accepted'},f.context)
 assert.match(Buffer.from(receipt.effects.print_jobs[0].data_b64,'base64').toString(),/Referencia AUTH-123/)
 assert.equal(receipt.result.print_document.content.payment.provider,'terminal')
 f.order.status='abierta';f.order.total_cents=9999
 assert.throws(()=>domain.prepare({...f.payload,command_id:'invalid',expected_financial_revision:4,command_type:'PAYMENT_RECEIPT_PRINT',payment_id:'accepted'},f.context),/Importe canónico/)
})
test('real TCP full-copy confirmation crash prints an explicitly authorized full copy set once', {timeout:10000}, async()=>{
 const net=require('node:net'),{once}=require('node:events'),printer=require('../adapters/printer'),received=[]
 const server=net.createServer(socket=>{let data='';socket.on('data',b=>data+=b.toString());socket.on('end',()=>{received.push(data);socket.end()});socket.on('error',()=>{})})
 server.listen(0,'127.0.0.1');await once(server,'listening')
 try {
  queue.enqueue({...job,connection:{type:'tcp',host:'127.0.0.1',port:server.address().port}})
  queue.markPrinting('job');queue.markCopyPrinted('job');queue.markCopyPrinted('job')
  // All transport receipts persisted; terminal markPrinted never happened.
  queue.init({filePath:path.join(dir,'queue.json')})
  assert.equal(queue.getJob('job').status,'uncertain');assert.equal(queue.getJob('job').copies_printed,2)
  const effect={job_id:'job',command_id:'tcp-resolution',uncertain_episode_id:queue.getJob('job').uncertain_episode_id,resolution:'reprint',reason:'One copy missing',recorded_by:'manager'}
  printer.applyPreparedResolution(effect)
  for(let i=0;i<200&&(queue.getJob('job').status!=='printed'||received.length<2);i++) await new Promise(r=>setTimeout(r,10))
  assert.equal(queue.getJob('job').status,'printed');assert.equal(received.length,2);assert(received.every(bytes=>/COPIA.*\noriginal/.test(bytes)))
  assert.equal(queue.getJob('job').resolution_receipts[0].copies_printed_before,2)
  queue.init({filePath:path.join(dir,'queue.json')})
  printer.applyPreparedResolution(effect);await new Promise(r=>setTimeout(r,30));assert.equal(received.length,2)
 } finally {await new Promise(r=>server.close(r))}
})
