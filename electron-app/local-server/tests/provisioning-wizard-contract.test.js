'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const electronRoot = path.resolve(__dirname, '..', '..')
const main = fs.readFileSync(path.join(electronRoot, 'main.js'), 'utf8')
const setup = fs.readFileSync(path.join(electronRoot, 'setup.html'), 'utf8')

test('LAN provisioning discovers and verifies servers through /identity', () => {
  const identityCalls = main.match(/http:\/\/\$\{[^}]+\}:\$\{[^}]+\}\/identity/g) || []
  assert.ok(identityCalls.length >= 2, 'scan and explicit connectivity test must use /identity')
  assert.doesNotMatch(main, /provision:scan-lan[\s\S]{0,1800}\/state/)
})

test('every non-server terminal requires a reachable matching caja', () => {
  assert.match(setup, /const needsCaja = state\.terminalRole !== 'server_pos'/)
  assert.match(setup, /const remoteReady = serverOk && checks\[3\]\.ok && checks\[4\]\.ok && checks\[5\]\.ok/)
  assert.match(setup, /!needsCaja \|\| remoteReady/)
})

test('secondary POS and KDS persist the caja address for the offline bridge', () => {
  assert.match(setup, /pos_server_ip:\s+state\.terminalRole !== 'server_pos' \? state\.serverHost : null/)
})

test('a single same-restaurant caja is selected automatically', () => {
  assert.match(setup, /servers\.filter\(s => s\.restaurant_id === state\.restaurantId\)/)
  assert.match(setup, /matching\.length === 1/)
})
