'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildHttpRouter, isLoopbackAddress, prepareBiometricDeviceIdentity } = require('../index')
const { ActorAuthority } = require('../core/actor-authority')
const cred = require('../core/credencial-lan')

const restaurantId = 'fingerprint-lab'
const branchId = 'branch-A'
const lanSecret = cred.generarSecreto()
const ipcSecret = 'a'.repeat(64)

async function lab(t, { role = 'server_pos', posServerIp = null, posServerPort = null,
  identified = { ok: true, staffId: 'admin-1' }, ipc = ipcSecret, actor: actorOverride } = {}) {
  const fingerprintCalls = []
  const biometricCalls = []
  const pinCalls = []
  const actorAuthority = actorOverride === undefined ? {
    async login(input) {
      pinCalls.push(input)
      return { staff: { id: 'admin-1', name: 'Gerente', role: 'admin' }, actor_token: 'pin-signed', expires_at: Date.now() + 60000, offline: false }
    },
    async loginBiometric(input) {
      biometricCalls.push(input)
      return { staff: { id: input.staffId, name: 'Gerente', role: 'admin' }, actor_token: 'signed', expires_at: Date.now() + 60000, offline: true }
    },
  } : actorOverride
  const identityDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-biometric-route-'))
  t.after(() => fs.rmSync(identityDirectory, { recursive: true, force: true }))
  const biometricDeviceIdentity = role === 'kds' ? null : prepareBiometricDeviceIdentity({ dataDir: identityDirectory })
  const router = buildHttpRouter({
    state: { toSnapshot: () => ({ write_authority: 'caja' }) },
    actorAuthority,
    restaurantId,
    branchId,
    posServerIp,
    posServerPort,
    config: { lanSecret, terminalId: role === 'pos' ? 'POS-2' : 'CAJA-CONFIG', terminalRole: role,
      fingerprintIpcSecret: ipc, biometricDeviceIdentity },
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
  const pin = (body, terminalId = 'CLIENT-SPOOF') => fetch(`http://127.0.0.1:${server.address().port}/auth/pin`, {
    method: 'POST', headers: { ...headers, 'x-fullsite-terminal': terminalId }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000),
  })
  return { request, status, pin, fingerprintCalls, biometricCalls, pinCalls, port: server.address().port, biometricDeviceIdentity }
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
  assert.equal(f.biometricCalls.length, 1)
  assert.deepEqual({ ...f.biometricCalls[0], deviceProof: undefined }, {
    staffId: 'admin-1', deviceId: 'CAJA-CONFIG', restaurantId, minRole: 'gerente', deviceProof: undefined,
  })
  assert.equal(f.biometricCalls[0].deviceProof.assertion.staff_id, 'admin-1')
  assert.equal(f.biometricCalls[0].deviceProof.assertion.terminal_id, 'CAJA-CONFIG')
  assert.match(f.biometricCalls[0].deviceProof.signature, /^[A-Za-z0-9_-]+$/)
})

test('fingerprint login fails closed without secure IPC and is never enabled on KDS', async t => {
  const missing = await lab(t, { ipc: null })
  assert.equal((await missing.request({})).status, 503)
  assert.equal(missing.fingerprintCalls.length, 0)

  const kds = await lab(t, { role: 'kds', posServerIp: '127.0.0.2', actor: null })
  assert.deepEqual(await (await kds.status()).json(), { available: false, reason: 'La huella no está disponible en KDS ni en terminales sin rol POS' })
  const response = await kds.request({})
  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'BIOMETRIC_KDS_DISABLED')
  assert.equal(kds.fingerprintCalls.length, 0)
})

test('a secondary POS identifies locally and Caja alone issues the actor token', async t => {
  const caja = await lab(t)
  const secondary = await lab(t, { role: 'pos', posServerIp: '127.0.0.1', posServerPort: caja.port, actor: null })
  const pin = await secondary.pin({ pin: '1234567890', biometric_device_public_key: 'forged-by-renderer' })
  assert.equal(pin.status, 200)
  assert.equal(caja.pinCalls.length, 1)
  assert.equal(caja.pinCalls[0].deviceId, 'POS-2')
  assert.equal(caja.pinCalls[0].biometricDevicePublicKey, secondary.biometricDeviceIdentity.publicKey)
  assert.deepEqual(await (await secondary.status()).json(), { available: true })
  const response = await secondary.request({ min_role: 'cajero' })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).actor_token, 'signed')
  assert.equal(secondary.fingerprintCalls.filter(call => call.path === '/identify').length, 1)
  assert.equal(caja.fingerprintCalls.length, 0, 'Caja must not use its own USB for the secondary POS')
  assert.equal(caja.biometricCalls.length, 1)
  assert.equal(caja.biometricCalls[0].deviceId, 'POS-2')
  assert.equal(caja.biometricCalls[0].deviceProof.assertion.staff_id, 'admin-1')
})

test('Caja ignores a renderer key when PIN belongs to its configured local terminal', async t => {
  const caja = await lab(t)
  const response = await caja.pin({ pin: '1234567890', biometric_device_public_key: 'forged-by-renderer' }, 'CAJA-CONFIG')
  assert.equal(response.status, 200)
  assert.equal(caja.pinCalls.length, 1)
  assert.equal(caja.pinCalls[0].deviceId, 'CAJA-CONFIG')
  assert.equal(caja.pinCalls[0].biometricDevicePublicKey, caja.biometricDeviceIdentity.publicKey)
})

test('Caja verifies the enrolled POS key and rejects forgery and replay', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-biometric-authority-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const identity = prepareBiometricDeviceIdentity({ dataDir: path.join(directory, 'device') })
  const attacker = prepareBiometricDeviceIdentity({ dataDir: path.join(directory, 'attacker') })
  const authority = new ActorAuthority({ directory: path.join(directory, 'authority'), restaurantId, branchId,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body)
      if (body.pin) return Response.json({ staff: { id: 'admin-1', name: 'Gerente', role: 'admin' }, biometricProof: 'cloud-proof' })
      assert.equal(init.headers.Authorization, 'Bearer cloud-proof')
      return Response.json({ staff: { id: body.fingerprint_id, name: 'Gerente', role: 'admin' } })
    } })
  await authority.login({ pin: '1234567890', deviceId: 'POS-2', restaurantId,
    biometricDevicePublicKey: identity.publicKey })

  const fields = { restaurantId, branchId, terminalId: 'POS-2', staffId: 'admin-1' }
  const proof = identity.createProof(fields)
  const accepted = await authority.loginBiometric({ staffId: 'admin-1', deviceId: 'POS-2', restaurantId, deviceProof: proof })
  assert.equal(authority.verify(accepted.actor_token, 'POS-2').id, 'admin-1')
  await assert.rejects(authority.loginBiometric({ staffId: 'admin-1', deviceId: 'POS-2', restaurantId, deviceProof: proof }),
    { code: 'BIOMETRIC_DEVICE_PROOF_REPLAY' })
  await assert.rejects(authority.loginBiometric({ staffId: 'admin-1', deviceId: 'POS-2', restaurantId,
    deviceProof: attacker.createProof(fields) }), { code: 'BIOMETRIC_DEVICE_PROOF_INVALID' })
  await assert.rejects(authority.login({ pin: '1234567890', deviceId: 'POS-2', restaurantId,
    biometricDevicePublicKey: attacker.publicKey }), { code: 'BIOMETRIC_DEVICE_KEY_MISMATCH' })
  await assert.rejects(authority.loginBiometric({ staffId: 'admin-1', deviceId: 'POS-2', restaurantId }),
    { code: 'BIOMETRIC_DEVICE_PROOF_INVALID' })
  await assert.rejects(authority.loginBiometric({ staffId: 'admin-1', deviceId: 'POS-2', restaurantId,
    deviceProof: identity.createProof({ ...fields, timestamp: Date.now() - 31_000 }) }),
  { code: 'BIOMETRIC_DEVICE_PROOF_INVALID' })
})

test('only loopback addresses qualify for Caja-local biometric authority', () => {
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(isLoopbackAddress(address), true)
  for (const address of ['192.168.1.10', '10.0.0.2', undefined]) assert.equal(isLoopbackAddress(address), false)
})
