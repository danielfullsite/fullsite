'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { buildHttpRouter } = require('../index')
const cred = require('../core/credencial-lan')

const restaurantId = 'fp-lab'
const branchId = 'branch-A'
const terminalId = 'POS-A'
const lanSecret = cred.generarSecreto()
const ipcSecret = 'f'.repeat(64)

async function lab(t, { permissions = ['configurar_huella_digital'], ipc = ipcSecret } = {}) {
  const forwarded = []
  const fingerprintRequest = async request => {
    forwarded.push(request)
    return { statusCode: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }
  }
  const actorAuthority = {
    verify(token, deviceId) {
      if (token !== 'signed-admin') throw Object.assign(new Error('Sesión inválida'), { status: 401, code: 'ACTOR_REQUIRED' })
      assert.equal(deviceId, terminalId)
      return { id: 'admin', role: 'admin', permissions }
    },
  }
  const router = buildHttpRouter({
    state: { toSnapshot: () => ({ write_authority: 'caja' }) },
    actorAuthority,
    restaurantId,
    branchId,
    config: { lanSecret, fingerprintIpcSecret: ipc },
    printer: {},
    fingerprintRequest,
  })
  const server = http.createServer(router)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const base = `http://127.0.0.1:${server.address().port}`
  const headers = {
    ...cred.cabecerasDeCredencial({ secreto: lanSecret, restaurantId, branchId, terminalId }),
    'x-fullsite-actor': 'signed-admin',
  }
  const request = (path, init = {}) => fetch(base + path, { ...init, headers: { ...headers, ...(init.headers || {}) } })
  return { forwarded, request }
}

test('health is the only anonymous fingerprint read and never forwards arbitrary query', async t => {
  const { forwarded, request } = await lab(t)
  const ok = await request('/fp/health', { headers: { 'x-fullsite-actor': '' } })
  assert.equal(ok.status, 200)
  assert.deepEqual(forwarded[0], { method: 'GET', path: '/health', ipcSecret })

  const query = await request('/fp/health?probe=identify')
  assert.equal(query.status, 400)
  assert.equal(forwarded.length, 1)

  const wrongMethod = await request('/fp/health', { method: 'POST' })
  assert.equal(wrongMethod.status, 405)
  assert.equal(forwarded.length, 1)
})

test('identify and unknown native routes are never exposed to the renderer, even with an admin actor', async t => {
  const { forwarded, request } = await lab(t)
  const identify = await request('/fp/identify')
  assert.equal(identify.status, 403)
  assert.equal((await identify.json()).code, 'BIOMETRIC_INTERNAL_ONLY')

  for (const path of ['/fp/auth', '/fp/capture', '/fp/%2e%2e/identify', '/fpevil']) {
    const response = await request(path)
    assert.equal(response.status, 404, path)
  }
  assert.equal(forwarded.length, 0)
})

test('list, enroll and delete require a signed actor with configurar_huella_digital', async t => {
  const denied = await lab(t, { permissions: [] })
  for (const path of ['/fp/list', '/fp/enroll?id=staff-1', '/fp/delete?id=staff-1']) {
    const noActor = await denied.request(path, { headers: { 'x-fullsite-actor': '' } })
    assert.equal(noActor.status, 401, `${path} without actor`)
    const noPermission = await denied.request(path)
    assert.equal(noPermission.status, 403, `${path} without permission`)
  }
  assert.equal(denied.forwarded.length, 0)
})

test('protected fingerprint routes fail closed without the configured IPC secret', async t => {
  const { forwarded, request } = await lab(t, { ipc: null })
  for (const path of ['/fp/list', '/fp/enroll?id=staff-1', '/fp/delete?id=staff-1']) {
    const response = await request(path)
    assert.equal(response.status, 503, path)
    assert.equal((await response.json()).code, 'FINGERPRINT_IPC_NOT_CONFIGURED')
  }
  assert.equal(forwarded.length, 0)
})

test('enroll/delete validate one safe target and the actor-bound installation scope', async t => {
  const { forwarded, request } = await lab(t)
  for (const path of [
    '/fp/enroll',
    '/fp/enroll?id=../manager',
    '/fp/enroll?id=staff-1&id=staff-2',
    '/fp/delete?id=staff%5C..%5Cmanager',
  ]) {
    const response = await request(path)
    assert.equal(response.status, 400, path)
  }
  for (const path of [
    '/fp/enroll?id=staff-1&client_id=other',
    '/fp/delete?id=staff-1&location_id=branch-B',
  ]) {
    const response = await request(path)
    assert.equal(response.status, 403, path)
  }
  assert.equal(forwarded.length, 0)

  assert.equal((await request('/fp/list')).status, 200)
  assert.equal((await request('/fp/enroll?id=staff-1')).status, 200)
  assert.equal((await request('/fp/delete?id=staff-1')).status, 200)
  assert.deepEqual(forwarded, [
    { method: 'GET', path: '/list', ipcSecret },
    { method: 'GET', path: '/enroll?id=staff-1', ipcSecret },
    { method: 'GET', path: '/delete?id=staff-1', ipcSecret },
  ])
})
