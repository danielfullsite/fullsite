'use strict'
// Tests for print-queue crash recovery (PRR-04): jobs stuck in 'printing'
// when the bridge dies must be revived on startup, never stranded.
// Run: node --test electron-app/local-server/tests/print-queue-recovery.test.js

const { test, describe, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const queue = require('../adapters/print-queue')

function tmpQueueFile(jobs) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pq-test-')), 'print-queue.json')
  fs.writeFileSync(file, JSON.stringify(jobs, null, 2), 'utf8')
  return file
}

function makeJob(overrides = {}) {
  return {
    job_id: `job-${Math.random().toString(36).slice(2)}`,
    station_id: 'cocina',
    printer_id: 'p1',
    printer_name: 'Kitchen',
    connection: { type: 'network', host: '192.168.1.50' },
    document_type: 'kitchen',
    data_b64: 'dGVzdA==',
    copies: 1,
    reprint: false,
    status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    attempts: 0,
    last_error: null,
    ...overrides,
  }
}

describe('Crash recovery on init (PRR-04)', () => {
  test('job stuck in printing is revived as retrying', () => {
    const file = tmpQueueFile([makeJob({ status: 'printing', attempts: 1 })])
    queue.init({ filePath: file })
    const jobs = queue.getAllJobs()
    assert.equal(jobs.length, 1)
    assert.equal(jobs[0].status, 'retrying')
    assert.match(jobs[0].last_error, /revived on startup/)
  })

  test('revived job appears in pending queue for the retry loop', () => {
    const file = tmpQueueFile([makeJob({ status: 'printing', attempts: 1 })])
    queue.init({ filePath: file })
    assert.equal(queue.getPendingJobs().length, 1)
  })

  test('printing job out of attempts goes to recoverable, not retrying', () => {
    const file = tmpQueueFile([makeJob({ status: 'printing', attempts: queue.MAX_ATTEMPTS })])
    queue.init({ filePath: file })
    const jobs = queue.getAllJobs()
    assert.equal(jobs[0].status, 'recoverable')
    // recoverable jobs are revived by retryRecoverableJobs() on health restore
    const revived = queue.retryRecoverableJobs()
    assert.equal(revived.length, 1)
    assert.equal(queue.getAllJobs()[0].status, 'pending')
  })

  test('recovery is persisted to disk immediately', () => {
    const file = tmpQueueFile([makeJob({ status: 'printing', attempts: 1 })])
    queue.init({ filePath: file })
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.equal(onDisk[0].status, 'retrying')
  })

  test('non-printing jobs are untouched', () => {
    const jobs = [
      makeJob({ job_id: 'a', status: 'pending' }),
      makeJob({ job_id: 'b', status: 'printed' }),
      makeJob({ job_id: 'c', status: 'recoverable' }),
      makeJob({ job_id: 'd', status: 'cancelled' }),
    ]
    const file = tmpQueueFile(jobs)
    queue.init({ filePath: file })
    const byId = Object.fromEntries(queue.getAllJobs().map(j => [j.job_id, j.status]))
    assert.equal(byId.a, 'pending')
    assert.equal(byId.b, 'printed')
    assert.equal(byId.c, 'recoverable')
    assert.equal(byId.d, 'cancelled')
  })

  test('clean queue with no printing jobs does not rewrite the file', () => {
    const file = tmpQueueFile([makeJob({ status: 'pending' })])
    const mtimeBefore = fs.statSync(file).mtimeMs
    queue.init({ filePath: file })
    assert.equal(fs.statSync(file).mtimeMs, mtimeBefore)
  })
})
