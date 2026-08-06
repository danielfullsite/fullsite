'use strict'
// Regression test: GET /identity against the REAL server (not a mock).
// A ReferenceError in buildHttpRouter (/identity referenced config/instanceName
// not passed into scope) crashed the whole Node process on first request —
// CERT-CAPTURE.ps1 queries /identity during field diagnostics.
// Run: node --test electron-app/local-server/tests/identity-route.test.js
// NOTE: when running the whole tests/ glob, add --test-force-exit — the
// bonjour mDNS socket can linger after close() and hold the runner open.

const { test, describe, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { startLocalServer } = require('../index')

const PORT = 7919 // non-default to avoid clashing with a live Bridge

describe('REST /identity (real server)', () => {
  let server

  before(async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-test-'))
    server = await startLocalServer({
      dataDir,
      port: PORT,
      config: { restaurantId: 'r-test', branchId: 'b-test' },
    })
  })

  after(() => {
    if (server) server.close()
  })

  test('GET /identity responds 200 and does not kill the process', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/identity`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(typeof body, 'object')
  })

  test('server still alive afterwards — /health answers', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
  })
})
