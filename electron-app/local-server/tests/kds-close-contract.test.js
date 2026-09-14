'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { handleAuthenticatedCommand } = require('../core/command-authority')

const electronRoot = path.resolve(__dirname, '..', '..')

test('dedicated KDS registers native quit before the kds_only branch', () => {
  const main = fs.readFileSync(path.join(electronRoot, 'main.js'), 'utf8')
  const registration = main.indexOf("ipcMain.on('app-quit'")
  const kdsOnlyBranch = main.indexOf('if (appConfig.kds_only)')

  assert.notEqual(registration, -1)
  assert.notEqual(kdsOnlyBranch, -1)
  assert.ok(registration < kdsOnlyBranch, 'app-quit must exist before kds_only returns')
})

test('offline KDS close button prefers the native preload bridge', () => {
  const html = fs.readFileSync(path.join(electronRoot, 'local-server', 'kds-ui.html'), 'utf8')

  assert.match(html, /window\.fullsiteApp\.quit\(\)/)
  assert.match(html, /window\.close\(\)/, 'browser fallback remains available')
})
test('Golden Skeleton KDS ships compact, operation, and expo views', () => {
  const html = fs.readFileSync(path.join(electronRoot, 'local-server', 'kds-ui.html'), 'utf8')

  for (const view of ['compact', 'operation', 'expo']) {
    assert.match(html, new RegExp(`data-view="${view}"`))
    assert.match(html, new RegExp(`v-${view}`))
  }
  assert.match(html, /view:VIEW/, 'selected view must persist with KDS settings')
})

test('an installation-authenticated screen gets only the kitchen permission and needs no employee PIN', async () => {
  let received
  const result = await handleAuthenticatedCommand({
    cmdHandler: {
      requiresActor: () => true,
      handle: async (_msg, _clientId, context) => { received = context.actor; return { ok: true } },
    },
    msg: { payload: { command_type: 'KITCHEN_SET' } },
    clientId: 'KDS-1', terminalId: 'KDS-1', installationAuthenticated: true,
  })
  assert.deepEqual(result, { ok: true })
  assert.equal(received.id, 'installation:kitchen')
  assert.equal(received.device_id, undefined)
  assert.deepEqual(received.permissions, ['actualizar_estatus_orden'])
  assert.ok(received.expires_at > Date.now())
})

test('installation kitchen authority never invents terminal attribution', async () => {
  let received
  const result = await handleAuthenticatedCommand({
    cmdHandler: {
      requiresActor: () => true,
      handle: async (_msg, _clientId, context) => { received = context.actor; return { ok: true } },
    },
    msg: { payload: { command_type: 'KITCHEN_SET' } },
    clientId: 'rest-api', installationAuthenticated: true,
  })
  assert.deepEqual(result, { ok: true })
  assert.equal(received.id, 'installation:kitchen')
  assert.equal(received.device_id, undefined)
})

test('installation authentication never bypasses employee authority for any other command', async () => {
  const result = await handleAuthenticatedCommand({
    cmdHandler: { requiresActor: () => true, handle: async () => ({ unsafe: true }) },
    msg: { payload: { command_type: 'ORDER_VOID' } },
    clientId: 'KDS-1', terminalId: 'KDS-1', installationAuthenticated: true,
  })
  assert.equal(result.code, 'ACTOR_REQUIRED')
  assert.equal(result.unsafe, undefined)
})
