'use strict'
const { OperationalError } = require('./operational-domain')
// The station, products and quantities come from the committed domain result.
// ESC/POS controls are never accepted in operator/product text. ASCII folding is
// deliberate for the initial portable ticket; encoding/font certification remains
// part of the physical printer gate.
function text(value, max = 300) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}
function wrap(value, width = 40) {
  const words = text(value).split(' '), lines = []; let line = ''
  for (let word of words) {
    if (line.length + word.length + 1 > width && line) { lines.push(line); line = '' }
    while (word.length > width) { lines.push(word.slice(0, width)); word = word.slice(width) }
    line += (line ? ' ' : '') + word
  }
  if (line) lines.push(line)
  return lines.join('\n')
}
function ticket(order, station, items, batchId, restaurantName) {
  const batch = JSON.parse(order.comanda_batches)[batchId]
  const lines = [text(restaurantName), station.toUpperCase(), order.mesa === null ? `Cuenta: ${text(order.customer_name)}` : `Mesa ${order.mesa}`,
    `Ronda ${batch.seq + 1}`, `Orden ${text(order.order_id, 80)}`, `Mesero: ${text(order.mesero)}`, text(batch.created_at), '-'.repeat(40)]
  if (order.notas) lines.push(wrap(`NOTA: ${order.notas}`), '-'.repeat(40))
  for (const item of items) {
    lines.push(wrap(`${item.cantidad} x ${item.nombre}`))
    if (item.silla) lines.push(`Silla ${item.silla}`)
    for (const mod of item.modificadores) lines.push(wrap(`  ${mod}`))
    if (item.notas) lines.push(wrap(`NOTA: ${item.notas}`))
    lines.push('')
  }
  lines.push(`Envio ${text(batchId, 100)}`)
  // No cash drawer opcode is emitted by a kitchen send.
  return Buffer.from('\x1b\x40' + lines.join('\n') + '\n\n\n\x1d\x56\x41\x03', 'ascii')
}
function prepareOrderPrintEffects(result, commandId, catalogEnvelope, printer) {
  if (!catalogEnvelope?.ready) throw new OperationalError('CATALOG_NOT_READY', 'Prepara el catálogo y las salidas de cocina antes de enviar')
  const catalog = catalogEnvelope.catalog, noPrint = catalog.settings['pos.no_print_stations']
  if (!Array.isArray(noPrint) || noPrint.some(s => !['cocina', 'barra', 'caja'].includes(s))) throw new OperationalError('PRINT_POLICY_NOT_READY', 'Declara las estaciones que operan sin papel antes de enviar')
  const order = result.operational_order
  const groups = new Map()
  for (const item of order.kitchen_items.filter(i => i.comanda_batch_id === commandId)) {
    const group = groups.get(item.station) || []; group.push(item); groups.set(item.station, group)
  }
  const printJobs = [], deliveries = []
  for (const [station, items] of groups) {
    if (noPrint.includes(station)) { deliveries.push({ station, paper: 'disabled_by_configuration' }); continue }
    if (!printer?.prepareJobs) throw new OperationalError('PRINTER_NOT_CONFIGURED', `Falta impresora para ${station}`)
    let jobs
    try { jobs = printer.prepareJobs(station, ticket(order, station, items, commandId, catalog.config.display_name), station === 'barra' ? 'bar_ticket' : 'kitchen_ticket', { commandId: `${commandId}:station:${station}` }) }
    catch (error) { throw new OperationalError(error.code || 'PRINTER_NOT_CONFIGURED', `No se preparó impresión de ${station}: ${error.message}`) }
    if (!Array.isArray(jobs) || !jobs.length) throw new OperationalError('PRINTER_NOT_CONFIGURED', `No hay salida para ${station}`)
    for (const job of jobs) printJobs.push({ ...job, command_id: commandId })
    deliveries.push({ station, paper: 'durable_intent', job_ids: jobs.map(j => j.job_id) })
  }
  result.preparation_delivery = deliveries
  return { print_jobs: printJobs }
}
module.exports = { prepareOrderPrintEffects }
