'use strict'

// Regression: ISSUE-001 — the default Windows workflow produced a dedicated
// KDS installer instead of the POS update used by AMALAY.
// Found by /qa on 2026-08-27.
// Report: .gstack/qa-reports/qa-report-electron-amalay-2026-08-27.md

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const appDir = path.resolve(__dirname, '..', '..')
const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'))
const lock = JSON.parse(fs.readFileSync(path.join(appDir, 'package-lock.json'), 'utf8'))

test('default Electron build remains the Fullsite POS update used by AMALAY', () => {
  assert.equal(pkg.build.productName, 'Fullsite POS')
  assert.equal(pkg.build.appId, 'mx.fullsite.pos')
})

test('package and lockfile advertise the same installer version', () => {
  assert.equal(lock.version, pkg.version)
  assert.equal(lock.packages[''].version, pkg.version)
})

test('dedicated KDS build stays available only through its explicit config', () => {
  const kds = JSON.parse(fs.readFileSync(path.join(appDir, 'electron-builder-kds.json'), 'utf8'))
  assert.equal(kds.productName, 'Fullsite KDS')
  assert.equal(kds.appId, 'mx.fullsite.kds')
})

test('macOS packages use the source icon format supported by builder v26', () => {
  const pos = JSON.parse(fs.readFileSync(path.join(appDir, 'electron-builder-pos.json'), 'utf8'))
  const kds = JSON.parse(fs.readFileSync(path.join(appDir, 'electron-builder-kds.json'), 'utf8'))
  for (const config of [pkg.build, pos, kds]) assert.equal(config.mac.icon, 'icon.png')
})
