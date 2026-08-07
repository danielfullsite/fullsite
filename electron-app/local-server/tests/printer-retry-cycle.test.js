'use strict'
// BUG-015 regression — hot retry cycle for parked print jobs.
//
// Historical field case (AMALAY, EC TICKET jam): a printer down at emit time
// parked the job in 'retrying' forever; only a Bridge restart revived it.
// Required behavior: while the app keeps running, parked jobs drain
// automatically when the printer comes back — exactly one physical print per
// job, no restart, no duplicates, independent per printer.
//
// Uses a real TCP listener as the printer (bytes captured), the real adapter
// and the real queue. The 60s timer is not awaited: the drain is driven via
// the test hook (same function the interval calls).

const { test, before, after, beforeEach } = require('node:test')
const assert = require('node:assert')
const net    = require('net')
const fs     = require('fs')
const os     = require('os')
const path   = require('path')

const printer    = require('../adapters/printer')
const printQueue = require('../adapters/print-queue')
const settle = () => new Promise(r => setTimeout(r, 150))

const PORT_A = 19310
const PORT_B = 19311

function makeConfig() {
  return {
    version: 2,
    printers: [
      { printer_id: 'pA', name: 'Cocina-1-test', enabled: true, station_ids: ['cocina'],
        connection: { type: 'tcp', host: '127.0.0.1', port: PORT_A }, copies: 1 },
      { printer_id: 'pB', name: 'Barra-test', enabled: true, station_ids: ['barra'],
        connection: { type: 'tcp', host: '127.0.0.1', port: PORT_B }, copies: 1 },
    ],
  }
}

function fakePrinter(port) {
  const captured = []
  const server = net.createServer(sock => {
    const chunks = []
    sock.on('data', c => chunks.push(c))
    // 'close' fires for both graceful end and destroy — printers only consume bytes
    sock.on('close', () => { if (chunks.length) captured.push(Buffer.concat(chunks)) })
    sock.on('error', () => {})
  })
  return {
    captured,
    listen: () => new Promise(res => server.listen(port, '127.0.0.1', res)),
    close:  () => new Promise(res => server.close(() => res())),
  }
}

let tmpDir

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bug015-'))
})
after(() => {
  printer._forTesting.stopRecoveryInterval()
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
})
beforeEach(() => {
  // Fresh queue file per test
  const qf = path.join(tmpDir, `queue-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  printer.init({ printersConfig: makeConfig(), configPath: null, queueFilePath: qf })
  printer._forTesting.stopRecoveryInterval()
})

test('BUG-015: retrying job drains when printer returns — no restart, exactly one print', async () => {
  // Printer DOWN at emit: real ECONNREFUSED
  await assert.rejects(
    () => printer.printToStation('cocina', Buffer.from('CORTE-X-NONCE-1'), 'corte'),
    /ALL_PRINTERS_FAILED/
  )
  let job = printQueue.getAllJobs().find(j => j.document_type === 'corte')
  assert.ok(job, 'job persisted')
  assert.strictEqual(job.status, 'retrying', 'parked as retrying (not lost, not failed)')

  // Printer comes BACK — drive the same drain the 60s interval runs
  const p = fakePrinter(PORT_A)
  await p.listen()
  await printer._forTesting.retryPendingJobs()

  await settle()
  job = printQueue.getAllJobs().find(j => j.job_id === job.job_id)
  assert.strictEqual(job.status, 'printed', 'job printed WITHOUT restart')
  assert.strictEqual(p.captured.length, 1, 'exactly one physical print')
  assert.ok(p.captured[0].toString().includes('CORTE-X-NONCE-1'), 'real bytes on the wire')

  // A second cycle must NOT reprint a printed job
  await printer._forTesting.retryPendingJobs()
  await settle()
  assert.strictEqual(p.captured.length, 1, 'no duplicate print on next cycle')
  await p.close()
})

test('BUG-015: attempts exhausted on infra error parks as recoverable (retried forever), not failed', async () => {
  await assert.rejects(() => printer.printToStation('cocina', Buffer.from('N2'), 'kitchen_ticket'))
  const id = printQueue.getAllJobs().find(j => j.status === 'retrying').job_id

  // Drain twice with printer down: attempts exhaust (MAX=3) → parks recoverable
  await printer._forTesting.retryPendingJobs()
  await printer._forTesting.retryPendingJobs()
  let job = printQueue.getAllJobs().find(j => j.job_id === id)
  assert.strictEqual(job.status, 'recoverable',
    'infra failure past max attempts parks as recoverable, never terminal-failed')
  // Next cycle re-queues it (attempts reset) — the indefinite Wansoft-like loop
  await printer._forTesting.retryPendingJobs()
  job = printQueue.getAllJobs().find(j => j.job_id === id)
  assert.ok(['retrying', 'recoverable', 'pending'].includes(job.status),
    `stays in the retry cycle, never terminal-failed (got ${job.status})`)

  // Printer returns → recoverable is re-queued (attempts reset) and prints
  const p = fakePrinter(PORT_A)
  await p.listen()
  await printer._forTesting.retryPendingJobs()
  await settle()
  job = printQueue.getAllJobs().find(j => j.job_id === id)
  assert.strictEqual(job.status, 'printed', 'recoverable job printed after printer return')
  assert.strictEqual(p.captured.length, 1, 'exactly one print after long outage')
  await p.close()
})

test('BUG-015: one printer down does not block the other; independent recovery', async () => {
  const pB = fakePrinter(PORT_B)
  await pB.listen()

  // Barra up, cocina down: barra prints now; cocina parks
  await printer.printToStation('barra', Buffer.from('BARRA-OK'), 'kitchen_ticket')
  await assert.rejects(() => printer.printToStation('cocina', Buffer.from('COCINA-LATER'), 'kitchen_ticket'))
  await settle()
  assert.strictEqual(pB.captured.length, 1, 'healthy printer unaffected')

  // Cocina returns; cycle drains ONLY the parked cocina job
  const pA = fakePrinter(PORT_A)
  await pA.listen()
  await printer._forTesting.retryPendingJobs()
  await settle()
  assert.strictEqual(pA.captured.length, 1, 'parked cocina job printed on recovery')
  assert.strictEqual(pB.captured.length, 1, 'no duplicate on the healthy printer')
  await pA.close(); await pB.close()
})

test('BUG-015: concurrent drain calls do not double-print (overlap guard)', async () => {
  await assert.rejects(() => printer.printToStation('cocina', Buffer.from('GUARD-1'), 'kitchen_ticket'))
  const p = fakePrinter(PORT_A)
  await p.listen()
  await Promise.all([
    printer._forTesting.retryPendingJobs(),
    printer._forTesting.retryPendingJobs(),
    printer._forTesting.retryPendingJobs(),
  ])
  // Let a possible second pass settle
  await printer._forTesting.retryPendingJobs()
  await settle()
  assert.strictEqual(p.captured.length, 1, 'exactly one print despite concurrent cycles')
  await p.close()
})

test('BUG-015: new job while backlog exists — both print once each on recovery', async () => {
  await assert.rejects(() => printer.printToStation('cocina', Buffer.from('BACKLOG-1'), 'kitchen_ticket'))
  await assert.rejects(() => printer.printToStation('cocina', Buffer.from('BACKLOG-2'), 'kitchen_ticket'))
  const p = fakePrinter(PORT_A)
  await p.listen()
  await printer.printToStation('cocina', Buffer.from('LIVE-3'), 'kitchen_ticket')  // live job prints direct
  await printer._forTesting.retryPendingJobs()                                     // backlog drains
  await settle()
  const all = p.captured.map(b => b.toString()).join('|')
  assert.ok(all.includes('LIVE-3') && all.includes('BACKLOG-1') && all.includes('BACKLOG-2'), 'all three printed')
  assert.strictEqual(p.captured.length, 3, 'exactly three prints, no duplicates')
  await p.close()
})
