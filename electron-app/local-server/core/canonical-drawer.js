'use strict'
const {OperationalError}=require('./operational-domain')
const DRAWER_COMMANDS=new Set(['PAYMENT_DRAWER_OPEN','DRAWER_OPEN','DRAWER_UNCERTAIN_RESOLVE'])
const fail=(code,message)=>{throw new OperationalError(code,message)}
const required=(value,name)=>{if(typeof value!=='string'||!value.trim()||value.length>200)fail('INVALID_DRAWER_REQUEST',`${name} requerido`);return value}
function authorize(payload,{state,actor,printer}) {
  if(!actor?.id||!Array.isArray(actor.permissions)||!Number.isFinite(actor.expires_at)||actor.expires_at<=Date.now())fail('ACTOR_REQUIRED','Inicia sesión de empleado en Caja')
  const permission=payload.command_type==='DRAWER_UNCERTAIN_RESOLVE'?'gerente':payload.command_type==='PAYMENT_DRAWER_OPEN'?'pos.payments.collect':'cajero'
  if(!actor.permissions.includes(permission))fail('PERMISSION_DENIED',`Permiso requerido: ${permission}`)
  if(payload.command_type==='PAYMENT_DRAWER_OPEN') {
    const order=state.getOrder(payload.order_id)
    if(!order||order.authority!=='caja')fail('DRAWER_ORDER_SCOPE','Cuenta canónica inexistente')
    if(order.created_by!==actor.id&&!actor.permissions.includes('ver_todas_cuentas'))fail('PERMISSION_DENIED','No puedes abrir el cajón por la cuenta de otro empleado')
  }
  if(payload.command_type==='DRAWER_UNCERTAIN_RESOLVE') {
    const job=printer?.getJob?.(payload.job_id)
    const operation=state.getDrawerOperations?.().find(o=>o.job_id===payload.job_id)
    if(!job||job.document_type!=='drawer_pulse'||!operation||operation.operation_id!==job.command_id||
      state.getDrawerOperation?.(operation.operation_id)?.job_id!==job.job_id)fail('DRAWER_JOB_SCOPE','No existe una apertura canónica para este trabajo')
  }
}
function prepare(payload,context) {
  const {state,actor,printer}=context
  if(!DRAWER_COMMANDS.has(payload.command_type))fail('INVALID_DRAWER_REQUEST','Comando no soportado')
  required(payload.command_id,'command_id');authorize(payload,context)
  if(typeof state.getDrawerOperations!=='function'||typeof state.getDrawerOperation!=='function')fail('DRAWER_PROJECTION_UNAVAILABLE','Falta historial de aperturas')
  if(payload.command_type==='DRAWER_UNCERTAIN_RESOLVE') {
    required(payload.uncertain_episode_id,'uncertain_episode_id');required(payload.reason,'reason')
    if(!['opened','retry_pulse'].includes(payload.resolution))fail('INVALID_DRAWER_REQUEST','Resolución inválida')
    if(typeof state.getDrawerResolution!=='function')fail('DRAWER_PROJECTION_UNAVAILABLE','Falta historial de decisiones')
    if(state.getDrawerResolution(payload.job_id,payload.uncertain_episode_id))fail('DRAWER_EPISODE_ALREADY_RESOLVED','Recupera la decisión ya confirmada para este episodio')
    const job=printer.getJob(payload.job_id)
    if(job.status!=='uncertain'||job.uncertain_episode_id!==payload.uncertain_episode_id)fail('DRAWER_EPISODE_CONFLICT','El episodio incierto cambió; actualiza el estado')
    const resolution={job_id:job.job_id,uncertain_episode_id:payload.uncertain_episode_id,resolution:payload.resolution,reason:payload.reason,recorded_by:actor.id}
    return {result:{drawer_resolution:resolution},effects:{drawer_resolutions:[{...resolution,command_id:payload.command_id}]}}
  }
  const turno=state.getTurno?.()
  if(!turno||turno.authority!=='caja'||turno.closed_at)fail('DRAWER_TURN_REQUIRED','Abre un turno en Caja antes de solicitar el cajón')
  if(payload.turno_id!==undefined&&payload.turno_id!==turno.id)fail('DRAWER_TURN_CONFLICT','El turno cambió')
  let operation={operation_id:payload.command_id,kind:'manual',turno_id:turno.id,recorded_by:actor.id,reason:payload.reason,created_at:new Date().toISOString()}
  if(payload.command_type==='PAYMENT_DRAWER_OPEN') {
    required(payload.payment_id,'payment_id')
    const order=state.getOrder(payload.order_id),fin=state.getFinancialOrder?.(payload.order_id),payment=fin?.payments.find(p=>p.payment_id===payload.payment_id)
    if(order.turno_id!==turno.id||fin?.turno_id!==turno.id)fail('DRAWER_TURN_CONFLICT','El pago pertenece a otro turno')
    if(payment?.method!=='cash'||payment.status!=='accepted'||!Number.isSafeInteger(payment.amount_cents)||payment.amount_cents<=0)fail('DRAWER_CASH_PAYMENT_REQUIRED','Se requiere pago en efectivo aceptado')
    if(state.getDrawerOperations().some(o=>o.kind==='payment'&&o.order_id===order.order_id&&o.payment_id===payment.payment_id))fail('DRAWER_PAYMENT_ALREADY_OPENED','Recupera la apertura original de este pago; otra apertura requiere motivo manual')
    operation={...operation,kind:'payment',order_id:order.order_id,payment_id:payment.payment_id,amount_cents:payment.amount_cents,reason:'Pago en efectivo confirmado'}
  } else {required(payload.turno_id,'turno_id');required(payload.reason,'reason')}
  if(!printer?.prepareDrawerJobs)fail('DRAWER_NOT_CONFIGURED','Falta destino explícito del cajón')
  const jobs=printer.prepareDrawerJobs({commandId:payload.command_id})
  if(!Array.isArray(jobs)||jobs.length!==1||jobs[0].copies!==1||jobs[0].document_type!=='drawer_pulse')fail('INVALID_DRAWER_JOB','La apertura requiere exactamente un pulso')
  operation.job_id=jobs[0].job_id;operation.printer_id=jobs[0].printer_id
  return {result:{drawer_operation:operation},effects:{print_jobs:jobs}}
}
module.exports={DRAWER_COMMANDS,authorize,prepare}
