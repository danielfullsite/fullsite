'use strict'
// Diagnostic reproduction only. No remote requests; candidate sources are read-only.
const fs = require('fs')
const os = require('os')
const path = require('path')
const vm = require('vm')
const assert = require('node:assert/strict')
const SOURCE = '/Users/danielrg/fullsite/.codex/worktrees/architecture-source-de904d71'
if (require('node:child_process').execFileSync('git', ['-C', SOURCE, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== 'de904d71ed0288375bd3a752579d2e2929df61c0') throw new Error('Candidate SHA changed; revalidate before running this diagnostic.')
const ts = require(path.join(SOURCE, 'dashboard-app/node_modules/typescript'))
const { NdjsonEventStore } = require(path.join(SOURCE, 'electron-app/local-server/adapters/storage/ndjson.js'))
const { CoreEventStore } = require(path.join(SOURCE, 'electron-app/local-server/core/event-store.js'))

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-audit-durable-'))
  try {
    const opts = { eventLogPath: path.join(tmp, 'events.ndjson'), processedCommandsPath: path.join(tmp, 'commands.ndjson') }
    const backing = new NdjsonEventStore(opts)
    const first = new CoreEventStore(backing)
    await first.load()
    const cmd = { command_id: 'audit-command-one', client_id: 'synthetic-terminal', restaurant_id: 'synthetic-tenant', payload: { order_id: 'synthetic-order', mesa: 7, items: [] } }
    // Simulate crash boundary: append survived, dedup-index commit did not.
    backing.saveProcessedCommand = async () => { throw new Error('injected failure after event append, before dedup-index persistence') }
    await assert.rejects(first.processCommand(cmd, { eventType: 'ORDER_SENT' }), /injected failure/)
    const restarted = new CoreEventStore(new NdjsonEventStore(opts))
    await restarted.load()
    const retry = await restarted.processCommand(cmd, { eventType: 'ORDER_SENT' })
    const events = await restarted.readAfter(0)
    assert.equal(events.filter(e => e.id === cmd.command_id).length, 2)
    assert.equal(retry.duplicate, false)
    console.log('REPRODUCED: same command_id survives twice after failed dedup-index write and restart; sequences=' + events.map(e => e.sequence).join(','))
    console.log('LIMIT: injected process boundary, not a physical power cut; no printer or payment provider was invoked.')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }

  const source = fs.readFileSync(path.join(SOURCE, 'dashboard-app/src/lib/liquidacion-de-orden.ts'), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const context = { exports: {} }
  vm.runInNewContext(compiled, context)
  const lib = context.exports
  const page = fs.readFileSync(path.join(SOURCE, 'dashboard-app/src/app/pos/page.tsx'), 'utf8')
  const start = page.indexOf('      const cuentasDelSplit = splitPayingCuenta > 0')
  const end = page.indexOf('      if (liquidacion.debeEmitirCierre)', start)
  assert(start > 0 && end > start)
  // Run the actual page's liquidation calculation, not a hand-written substitute.
  const calculation = ts.transpileModule(page.slice(start, end) + '\nglobalThis.resultado = liquidacion', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const ctx = { ...lib, orderId: 'synthetic-order', opId: 'synthetic-op', splitPayingCuenta: 2, splitCount: 2, splitMode: 'items', splitParejoN: 0 }
  vm.runInNewContext(calculation, ctx)
  assert.equal(ctx.resultado.debeEmitirCierre, true)
  assert.equal(ctx.resultado.totalDeLaOrden, 0)
  assert.equal(ctx.resultado.totalPagado, 0)
  const actual = lib.evaluarLiquidacion({ order_id: 'synthetic-order', cuentas: [{ account_id: 'a', total: 100 }, { account_id: 'b', total: 200 }], pagos: [{ payment_id: 'p', account_id: 'a', monto: 100, estado: 'aceptado' }] })
  assert.equal(actual.debeEmitirCierre, false)
  console.log('REPRODUCED: actual page calculation emits closure using zero account totals and zero accepted payments; domain with real unpaid balance correctly refuses closure.')
  console.log('LIMIT: isolated real TypeScript logic; not an end-to-end UI payment test. Offline branch unconditional closure is separately evidenced in page.tsx:3513-3541.')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
