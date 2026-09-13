'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { buildHttpRouter, isLoopbackAddress } = require('../index')
const cred = require('../core/credencial-lan')

const restaurantId = 'fingerprint-lab'
const branchId = 'branch-A'
const lanSecret = cred.generarSecreto()
const ipcSecret = 'a'.repeat(64)

async function lab(t, { secondary = false, identified = { ok: true, staffId: 'admin-1' }, ipc = ipcSecret } = {}) {
  const fingerprintCalls = []
  const biometricCalls = []
  const actorAuthority = {
    async loginBiometric(input) {
      biometricCalls.push(input)
      return { staff: { id: input.staffId, name: 'Gerente', role: 'admin' }, actor_token: 'signed', expires_at: Date.now() + 60000, offline: true }
    },
  }
  const router = buildHttpRouter({
    state: { toSnapshot: () => ({ write_authority: 'caja' }) },
    actorAuthority,
    restaurantId,
    branchId,
    posServerIp: secondary ? '127.0.0.2' : null,
    config: { lanSecret, terminalId: 'CAJA-CONFIG', fingerprintIpcSecret: ipc },
    printer: {},
    fingerprintRequest: async request => {
      fingerprintCalls.push(request)
      if (request.path === '/health') return { statusCode: 200, body: JSON.stringify({ ok: true, ipc_auth_required: true, ipc_auth_scheme: 'hmac-sha256-v1' }), contentType: 'application/json' }
      return { statusCode: identified.ok ? 200 : 401, body: JSON.stringify(identified), contentType: 'application/json' }
    },
  })
  const server = http.createServer(router)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const headers = {
    ...cred.cabecerasDeCredencial({ secreto: lanSecret, restaurantId, branchId, terminalId: 'CLIENT-SPOOF' }),
    'Content-Type': 'application/json',
  }
  const request = body => fetch(`http://127.0.0.1:${server.address().port}/auth/fingerprint`, {
    method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(3000),
  })
  const status = () => fetch(`http://127.0.0.1:${server.address().port}/auth/fingerprint/status`, { headers, signal: AbortSignal.timeout(3000) })
  return { request, status, fingerprintCalls, biometricCalls }
}

test('fingerprint login takes identity only from the authenticated local reader', async t => {
  const f = await lab(t)
  const status = await f.status()
  assert.deepEqual(await status.json(), { available: true })
  f.fingerprintCalls.length = 0
  for (const forged of [{ staffId: 'admin-1' }, { fingerprint_id: 'admin-1' }, { actor_id: 'admin-1' }]) {
    const response = await f.request(forged)
    assert.equal(response.status, 400)
    assert.equal((await response.json()).code, 'BIOMETRIC_IDENTITY_FORBIDDEN')
  }
  assert.equal(f.fingerprintCalls.length, 0)

  const response = await f.request({ min_role: 'gerente' })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).actor_token, 'signed')
  assert.deepEqual(f.fingerprintCalls, [{ method: 'GET', path: '/identify', ipcSecret }])
  assert.deepEqual(f.biometricCalls, [{ staffId: 'admin-1', deviceId: 'CAJA-CONFIG', restaurantId, minRole: 'gerente' }])
})

test('fingerprint login fails closed without secure IPC or on a secondary terminal', async t => {
  const missing = await lab(t, { ipc: null })
  assert.equal((await missing.request({})).status, 503)
  assert.equal(missing.fingerprintCalls.length, 0)

  const secondary = await lab(t, { secondary: true })
  assert.equal((await secondary.status()).status, 200)
  const response = await secondary.request({})
  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'BIOMETRIC_CAJA_ONLY')
  assert.equal(secondary.fingerprintCalls.length, 0)
  assert.equal(secondary.biometricCalls.length, 0)
})

test('only loopback addresses qualify for Caja-local biometric authority', () => {
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(isLoopbackAddress(address), true)
  for (const address of ['192.168.1.10', '10.0.0.2', undefined]) assert.equal(isLoopbackAddress(address), false)
})
