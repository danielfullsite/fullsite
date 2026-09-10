'use strict'
const { OperationalError } = require('./operational-domain')
const PRINT_COMMANDS = new Set(['ORDER_PRECHECK_PRINT','PAYMENT_RECEIPT_PRINT','PRINT_UNCERTAIN_RESOLVE'])
const clone = value => JSON.parse(JSON.stringify(value))
const fail = (code,message) => { throw new OperationalError(code,message) }
const text = value => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7e]/g,' ').replace(/\s+/g,' ').trim().slice(0,300)
const money = cents => { if (!Number.isSafeInteger(cents) || cents < 0) fail('INVALID_PRINT_MONEY','Importe canónico inválido');return (cents/100).toFixed(2) }
const required = (value,name) => { if (typeof value !== 'string' || !value.trim() || value.length>200) fail('INVALID_PRINT_REQUEST',`${name} requerido`);return value }
function authorize(payload,{state,actor,printer}) {
  if (!actor?.id || !Array.isArray(actor.permissions) || (!Number.isFinite(actor.expires_at)||!(actor.expires_at>Date.now()))) fail('ACTOR_REQUIRED','Inicia sesión de empleado en Caja')
  const permission=payload.command_type==='PRINT_UNCERTAIN_RESOLVE'?'gerente':'imprimir_cuentas'
  if (!actor.permissions.includes(permission)) fail('PERMISSION_DENIED',`Permiso requerido: ${permission}`)
  if (payload.original_document_id && !actor.permissions.includes('reimpresion_preticket')) fail('PERMISSION_DENIED','Reimpresión no autorizada')
  if (payload.command_type==='PRINT_UNCERTAIN_RESOLVE') {
    const job=printer?.getJob?.(payload.job_id)
    if (!job?.command_id) fail('PRINT_JOB_NOT_FOUND','Trabajo durable inexistente')
    if(state.getCanonicalPrintJob?.(payload.job_id)?.command_id!==job.command_id) fail('PRINT_LEGACY_RECONCILIATION_REQUIRED','Este trabajo anterior requiere conciliación de la transición; no se puede resolver como documento de Caja')
    if (payload.resolution==='reprint' && !actor.permissions.includes('reimpresion_preticket')) fail('PERMISSION_DENIED','Reimpresión no autorizada')
    return
  }
  const order=state.getOrder(payload.order_id)
  if (!order || order.authority!=='caja') fail('PRINT_ORDER_NOT_FOUND','Cuenta canónica inexistente')
  if (order.created_by!==actor.id && !actor.permissions.includes('ver_todas_cuentas')) fail('PERMISSION_DENIED','No puedes imprimir la cuenta de otro empleado')
}
function encodeDocument(doc) {
  const c=doc.content, lines=[c.restaurant_name,doc.original_document_id?'COPIA — '+doc.kind:doc.kind==='precheck'?'PRECUENTA — NO ACREDITA PAGO':'RECIBO DE PAGO',
    ...(c.order_number ? [`Orden #${c.order_number}`] : []), `Orden ${doc.order_id}`,c.mesa==null?`Cuenta ${c.customer_name||''}`:`Mesa ${c.mesa}`,`Documento ${doc.document_id}`,doc.created_at,'-'.repeat(40)]
  if (doc.original_document_id) lines.push(`Original ${doc.original_document_id}`,`Motivo ${doc.reason}`)
  for(const item of c.items||[]) {
    lines.push(`${item.quantity} x ${item.name}  ${money(item.total_cents)}`)
    for(const modifier of item.modifiers||[]) lines.push(`  ${modifier}`)
    if(item.notes) lines.push(`Nota: ${item.notes}`)
  }
  lines.push(`Subtotal ${money(c.subtotal_cents)}`,`IVA ${money(c.iva_cents)}`,`Descuento ${money(c.discount_cents??0)}`,`Total ${money(c.total_cents)}`)
  if(c.payment) {
    lines.push(`Pago ${c.payment.payment_id}`,`Metodo ${c.payment.method}`,`Importe recibido ${money(c.payment.amount_cents)}`)
    if(c.payment.provider) lines.push(`Proveedor ${c.payment.provider}`)
    if(c.payment.reference) lines.push(`Referencia ${c.payment.reference}`)
    if(c.payment.received_cents!==undefined) lines.push(`Efectivo entregado ${money(c.payment.received_cents)}`,`Cambio ${money(c.payment.change_cents)}`)
  }
  lines.push(`Abonos aceptados ${money(c.paid_cents)}`,`Pagos por aclarar ${money(c.reserved_cents)}`,`Saldo ${money(c.balance_cents)}`)
  return Buffer.from('\x1b\x40'+lines.map(text).join('\n')+'\n\n\n\x1d\x56\x41\x03','ascii')
}
function prepare(payload,context) {
  const {state,actor,catalogEnvelope,printer}=context
  if(!PRINT_COMMANDS.has(payload.command_type)) fail('INVALID_PRINT_REQUEST','Comando no soportado')
  required(payload.command_id,'command_id');authorize(payload,context)
  if(payload.command_type==='PRINT_UNCERTAIN_RESOLVE') {
    const job=printer.getJob(payload.job_id)
    required(payload.reason,'reason');required(payload.uncertain_episode_id,'uncertain_episode_id')
    if(typeof state.getPrintResolution!=='function') fail('PRINT_PROJECTION_UNAVAILABLE','Falta historial de verificaciones de impresión')
    if(state.getPrintResolution(payload.job_id,payload.uncertain_episode_id)) fail('PRINT_EPISODE_ALREADY_RESOLVED','Caja ya confirmó una decisión para este episodio; recupera el intento original')
    if(!['printed','reprint'].includes(payload.resolution)) fail('INVALID_PRINT_REQUEST','Resolución inválida')
    if(job.status!=='uncertain'||job.uncertain_episode_id!==payload.uncertain_episode_id) fail('PRINT_UNCERTAIN_EPISODE_CONFLICT','El episodio incierto cambió; vuelve a consultarlo')
    const decision={job_id:job.job_id,uncertain_episode_id:payload.uncertain_episode_id,resolution:payload.resolution,reason:payload.reason,recorded_by:actor.id}
    return {result:{print_resolution:decision},effects:{print_resolutions:[{...decision,command_id:payload.command_id}]}}
  }
  if(typeof state.getPrintDocuments!=='function'||typeof state.getPrintDocument!=='function') fail('PRINT_PROJECTION_UNAVAILABLE','Falta historial de documentos')
  const order=state.getOrder(payload.order_id),fin=state.getFinancialOrder(payload.order_id)
  const kind=payload.command_type==='ORDER_PRECHECK_PRINT'?'precheck':'payment_receipt'
  let doc
  if(payload.original_document_id) {
    const original=state.getPrintDocument(payload.original_document_id)
    required(payload.reason,'reason')
    if(!original||original.order_id!==order.order_id||original.kind!==kind||original.original_document_id||
      (kind==='payment_receipt'&&original.payment_id!==payload.payment_id)) fail('PRINT_ORIGINAL_MISMATCH','Documento original inválido')
    doc={...clone(original),original_document_id:original.document_id,reason:payload.reason}
  } else {
    if(kind==='precheck'&&order.status==='cancelada') fail('PRINT_ORDER_CANCELLED','No se emite precuenta nueva de una cuenta cancelada')
    if(payload.expected_revision!==order.order_revision || (fin ? payload.expected_financial_revision!==fin.revision : payload.expected_financial_revision!==undefined && payload.expected_financial_revision!==0)) fail('PRINT_REVISION_CONFLICT','La cuenta cambió; actualiza antes de imprimir')
    if(fin && fin.order_revision!==order.order_revision) fail('PRINT_REVISION_CONFLICT','Las revisiones de consumo y dinero no coinciden')
    const payment=kind==='payment_receipt'?fin?.payments.find(p=>p.payment_id===payload.payment_id):null
    if(kind==='payment_receipt'&&payment?.status!=='accepted') fail('PRINT_PAYMENT_NOT_ACCEPTED','Sólo se imprime un pago aceptado')
    if(state.getPrintDocuments().some(d=>!d.original_document_id&&d.kind===kind&&d.order_id===order.order_id&&
      (kind==='payment_receipt'?d.payment_id===payment.payment_id:d.order_revision===order.order_revision&&d.financial_revision===(fin?.revision||0)))) fail('PRINT_COPY_REQUIRED','Ya existe documento; solicita una copia explícita')
    const items=typeof order.items==='string'?JSON.parse(order.items):order.items
    doc={kind,order_id:order.order_id,payment_id:payment?.payment_id,order_revision:order.order_revision,financial_revision:fin?.revision||0,original_document_id:null,
      content:{order_number:order.order_number??null,restaurant_name:text(catalogEnvelope?.catalog?.config?.display_name||'Fullsite'),mesa:order.mesa,customer_name:text(order.customer_name),
        items:(items||[]).map(i=>({name:text(i.nombre),quantity:i.cantidad,total_cents:i.total_cents,modifiers:(i.modificadores||[]).map(text),notes:text(i.notas)})),
        subtotal_cents:order.subtotal_cents,iva_cents:order.iva_cents,total_cents:order.total_cents,discount_cents:order.subtotal_cents+order.iva_cents-order.total_cents,
        paid_cents:fin?.paid_cents||0,reserved_cents:fin?.reserved_cents||0,balance_cents:fin?.balance_cents??order.total_cents,
        ...(payment?{payment:{payment_id:payment.payment_id,method:payment.method,amount_cents:payment.amount_cents,
          ...(payment.provider?{provider:text(payment.provider)}:{}),...(payment.evidence?.reference?{reference:text(payment.evidence.reference)}:{}),
          ...(payment.method==='cash'?{received_cents:payment.evidence.received_cents,change_cents:payment.change_cents}: {})}}:{})}}
  }
  doc={...doc,document_id:payload.command_id,created_at:new Date().toISOString(),recorded_by:actor.id}
  if(!printer?.prepareJobs) fail('PRINTER_NOT_CONFIGURED','Falta impresora de Caja')
  const jobs=printer.prepareJobs('caja',encodeDocument(doc),kind==='precheck'?'pre_ticket':'receipt',{commandId:payload.command_id,reprint:!!doc.original_document_id})
  if(!Array.isArray(jobs)||!jobs.length) fail('PRINTER_NOT_CONFIGURED','No hay salida de impresión')
  doc.job_ids=jobs.map(j=>j.job_id)
  return {result:{print_document:doc},effects:{print_jobs:jobs}}
}
module.exports={PRINT_COMMANDS,authorize,prepare,encodeDocument}
