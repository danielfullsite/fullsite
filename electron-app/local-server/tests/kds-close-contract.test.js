'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

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
