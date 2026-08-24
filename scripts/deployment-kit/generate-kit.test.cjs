'use strict'

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { describe, test } = require('node:test')
const { generateKit, validateManifest } = require('./generate-kit.cjs')
const { validate: validateTerminal } = require('../../electron-app/local-server/config-schema')

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'example.monclova.json'), 'utf8'))

describe('Golden Deployment Kit v1', () => {
  test('example manifest is valid', () => {
    assert.deepEqual(validateManifest(fixture), { valid: true, errors: [] })
  })

  test('requires exactly one server and rejects bad IPs', () => {
    const noServer = { ...fixture, server_ip: '999.1.1.1', terminals: fixture.terminals.filter(t => t.role !== 'server_pos') }
    const result = validateManifest(noServer)
    assert.equal(result.valid, false)
    assert.ok(result.errors.some(e => e.includes('server_ip')))
    assert.ok(result.errors.some(e => e.includes('exactly one server_pos')))
  })

  test('generates isolated configs, printers, checksums, guide and smoke test', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-kit-'))
    const out = path.join(root, 'package')
    const result = generateKit(fixture, out, { now: '2026-08-24T08:00:00.000Z' })
    assert.equal(result.terminals.length, 3)
    assert.equal(new Set(result.terminals.map(t => t.terminal_id)).size, 3)
    assert.ok(fs.existsSync(path.join(out, 'INSTALL.md')))
    assert.ok(fs.existsSync(path.join(out, 'smoke-test.ps1')))
    assert.ok(fs.existsSync(path.join(out, 'package-manifest.json')))

    for (const file of result.files) {
      const content = fs.readFileSync(path.join(out, file.path))
      assert.equal(require('crypto').createHash('sha256').update(content).digest('hex'), file.sha256)
      assert.equal(content.length, file.bytes)
    }

    for (const terminal of result.terminals) {
      const config = JSON.parse(fs.readFileSync(path.join(out, terminal.folder, 'config.json')))
      assert.equal(validateTerminal(config).valid, true)
      assert.equal(config.restaurant_id, fixture.restaurant_id)
      if (terminal.role === 'server_pos') {
        assert.equal(config.local_server_host, '127.0.0.1')
        assert.ok(fs.existsSync(path.join(out, terminal.folder, 'printers.json')))
      } else {
        assert.equal(config.pos_server_ip, fixture.server_ip)
        assert.equal(fs.existsSync(path.join(out, terminal.folder, 'printers.json')), false)
      }
    }
    fs.rmSync(root, { recursive: true })
  })

  test('refuses to overwrite an existing package', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-kit-existing-'))
    assert.throws(() => generateKit(fixture, root), /already exists/)
    fs.rmSync(root, { recursive: true })
  })
})
