'use strict'
const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { ActorAuthority, permissionsFor } = require('../core/actor-authority')
let directory, now, mode, calls
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-actor-')); now = Date.now(); mode = 'online'; calls = [] })
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }))
const employee = { id: 'employee', name: 'Cajero de prueba', role: 'cajero' }
const login = { pin: '5678901234', deviceId: 'POS-A', restaurantId: 'lab' }
function authority(options = {}) {
  return new ActorAuthority({ directory, restaurantId: 'lab', branchId: 'branch-A', now: () => now,
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      if (mode === 'offline') throw new TypeError('Failed to fetch')
      if (mode === 'revoked') return Response.json({ error: 'PIN incorrecto' }, { status: 401 })
      if (mode === 'device-revoked') return Response.json({ code: 'terminal_not_enrolled' }, { status: 403 })
      if (mode === 'throttled') return Response.json({}, { status: 429 })
      return Response.json({ staff: { ...employee, ...(mode === 'mesero' ? { role: 'mesero' } : {}) }, shiftToken: 'synthetic-online-shift-token' })
    }, ...options })
}

test('prepared PIN survives restart/WAN outage with server-derived role and no plaintext PIN', async () => {
  const a = authority()
  const online = await a.login({ ...login, staff: { role: 'admin' } })
  assert.equal(online.staff.role, 'cajero')
  assert.equal(online.offline, false)
  assert.equal(online.shiftToken, 'synthetic-online-shift-token')
  assert.equal(a.verify(online.actor_token, 'POS-A').id, employee.id)
  assert.equal(calls[0].url, 'https://app.fullsite.mx/api/pos/pin')
  assert.equal(calls[0].init.redirect, 'error')
  assert(!fs.readFileSync(path.join(directory, 'actor-credentials.json'), 'utf8').includes(login.pin))
  assert(!fs.readFileSync(path.join(directory, 'actor-credentials.json'), 'utf8').includes(online.actor_token))
  mode = 'offline'
  const b = authority()
  const offline = await b.login(login)
  assert.equal(offline.offline, true)
  assert.equal(offline.shiftToken, undefined, 'no fake cloud token offline')
  assert(b.verify(offline.actor_token, 'POS-A').permissions.includes('pos.payments.collect'))
  assert.equal(b.status().prepared_users, 1)
})

test('new user/device cannot self-provision offline or borrow a token from another terminal', async () => {
  const a = authority(); const session = await a.login(login)
  assert.throws(() => a.verify(session.actor_token, 'POS-B'), { status: 401 })
  assert.throws(() => a.verify(session.actor_token + 'tampered', 'POS-A'), { status: 401 })
  mode = 'offline'
  await assert.rejects(a.login({ ...login, pin: '1234567890' }), { code: 'OFFLINE_USER_NOT_PREPARED' })
  await assert.rejects(a.login({ ...login, deviceId: 'POS-B' }), { code: 'OFFLINE_USER_NOT_PREPARED' })
  await assert.rejects(a.login({ ...login, restaurantId: 'other' }), { code: 'ACTOR_SCOPE_INVALID' })
})

test('a routine second online login does not invalidate a still valid issued session', async () => {
  const a = authority(); const first = await a.login(login)
  await a.login({ ...login, deviceId: 'POS-B' })
  assert.equal(a.verify(first.actor_token, 'POS-A').id, employee.id)
  mode = 'offline'
  assert.equal((await a.login({ ...login, deviceId: 'POS-B' })).offline, true)
})

test('confirmed role downgrade or PIN revocation invalidates previous authority across restarts', async () => {
  const a = authority(); const first = await a.login(login)
  mode = 'mesero'
  const downgraded = await a.login(login)
  assert.throws(() => a.verify(first.actor_token, 'POS-A'), { status: 401 })
  assert(!a.verify(downgraded.actor_token, 'POS-A').permissions.includes('pos.payments.collect'))
  mode = 'revoked'
  await assert.rejects(a.login(login), { code: 'PIN_REJECTED' })
  mode = 'offline'
  const b = authority()
  assert.throws(() => b.verify(downgraded.actor_token, 'POS-A'), { status: 401 })
  await assert.rejects(b.login(login), { code: 'OFFLINE_USER_NOT_PREPARED' })
})

test('device rejection revokes that device without revoking the employee on other prepared terminals', async () => {
  const a = authority(); const first = await a.login(login)
  const second = await a.login({ ...login, deviceId: 'POS-B' })
  mode = 'device-revoked'
  await assert.rejects(a.login({ ...login, deviceId: 'POS-B' }), { code: 'terminal_not_enrolled' })
  assert.equal(a.verify(first.actor_token, 'POS-A').id, employee.id)
  assert.throws(() => a.verify(second.actor_token, 'POS-B'), { status: 401 })
  mode = 'offline'
  const b = authority()
  await assert.rejects(b.login({ ...login, deviceId: 'POS-B' }), { code: 'terminal_not_enrolled' })
  assert.equal((await b.login(login)).offline, true)
})

test('concurrent guesses share a durable throttle budget; restart cannot reset it', async () => {
  mode = 'revoked'
  const a = authority()
  const results = await Promise.allSettled(Array.from({ length: 15 }, (_, i) => a.login({ ...login, pin: String(1000 + i) })))
  assert.equal(calls.length, 10)
  assert.equal(results.filter(r => r.reason?.code === 'PIN_RATE_LIMITED').length, 5)
  mode = 'offline'
  await assert.rejects(authority().login(login), { code: 'PIN_RATE_LIMITED' })
  now += 600001
  await assert.rejects(authority().login(login), { code: 'OFFLINE_USER_NOT_PREPARED' })
})

test('sessions expire, prepared credentials expire, and clock rollback fails closed', async () => {
  const a = authority({ credentialTtlMs: 10000 }); const session = await a.login(login)
  mode = 'offline'; now += 10001
  assert.throws(() => a.verify(session.actor_token, 'POS-A'), { status: 401 })
  await assert.rejects(a.login(login), { code: 'OFFLINE_USER_NOT_PREPARED' })
  now -= 120000
  assert.throws(() => authority().verify(session.actor_token, 'POS-A'), { code: 'ACTOR_CLOCK_INVALID' })
})

test('disk failure never issues authority from a credential that was only saved in memory', async t => {
  const a = authority()
  const mock = t.mock.method(fs, 'writeSync', () => { throw new Error('ENOSPC') })
  await assert.rejects(a.login(login), { code: 'ACTOR_STORAGE_UNAVAILABLE' })
  mock.mock.restore()
  await assert.rejects(a.login(login), { code: 'ACTOR_STORAGE_UNAVAILABLE' })
  mode = 'offline'
  await assert.rejects(authority().login(login), { code: 'OFFLINE_USER_NOT_PREPARED' })
})

test('stored credentials cannot be reused after changing tenant or branch', async () => {
  await authority().login(login)
  assert.throws(() => authority({ restaurantId: 'other' }), /otra instalación/)
  assert.throws(() => authority({ branchId: 'branch-B' }), /otra instalación/)
})

test('employee roles never grant trusted-provider privileges and minRole cannot promote a cashier', async () => {
  const a = authority()
  for (const role of ['mesero', 'cajero', 'capitan', 'gerente', 'admin']) assert(!permissionsFor(role).includes('pos.payments.external_result'))
  await assert.rejects(a.login({ ...login, minRole: 'gerente' }), { code: 'PERMISSION_DENIED' })
  await assert.rejects(a.login({ ...login, minRole: 'made-up' }), { code: 'INVALID_ROLE' })
})

test('Caja uses the existing granular profiles: captain cannot cancel and waiter cannot move or collect', () => {
  assert(!permissionsFor('capitan').includes('pos.orders.cancel'))
  assert(!permissionsFor('gerente').includes('pos.orders.cancel'))
  assert(!permissionsFor('mesero').includes('pos.orders.move'))
  assert(!permissionsFor('mesero').includes('pos.payments.collect'))
  assert(permissionsFor('admin').includes('pos.orders.cancel'))
  assert.deepEqual(permissionsFor('dueño'), permissionsFor('admin'))
  assert.deepEqual(permissionsFor('staff'), permissionsFor('mesero'))
  assert.deepEqual(permissionsFor('unrecognized'), [])
})
