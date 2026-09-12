'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repository = path.resolve(__dirname, '..', '..', '..')
const electronRoot = path.join(repository, 'electron-app')
const pkg = JSON.parse(fs.readFileSync(path.join(electronRoot, 'package.json'), 'utf8'))
const lock = JSON.parse(fs.readFileSync(path.join(electronRoot, 'package-lock.json'), 'utf8'))
const main = fs.readFileSync(path.join(electronRoot, 'main.js'), 'utf8')

test('Electron runtime is pinned and the lockfile agrees', () => {
  assert.equal(pkg.devDependencies.electron, '44.3.0')
  assert.equal(lock.packages['node_modules/electron'].version, '44.3.0')
  assert.equal(pkg.engines.node, '>=22.12.0')
})

test('installer builder is pinned past the audited vulnerable range', () => {
  assert.equal(pkg.devDependencies['electron-builder'], '26.15.3')
  assert.equal(lock.packages['node_modules/electron-builder'].version, '26.15.3')
  assert.equal(lock.packages['node_modules/builder-util-runtime'].version, '9.7.0')
})

test('Electron workflows use a Node version supported by Electron 44', () => {
  for (const name of ['electron-build.yml', 'electron-release.yml', 'lab-multi-terminal.yml', 'offline-e2e.yml']) {
    const workflow = fs.readFileSync(path.join(repository, '.github', 'workflows', name), 'utf8')
    assert.doesNotMatch(workflow, /node-version:\s*['"]20['"]/, name)
    assert.match(workflow, /node-version:\s*['"]24['"]/, name)
  }
})

test('main process avoids Electron APIs changed before v44', () => {
  assert.doesNotMatch(main, /printer\.isDefault/)
  assert.doesNotMatch(main, /console-message',\s*\([^)]*,[^)]*,/)
})
