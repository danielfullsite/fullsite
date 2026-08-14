'use strict'
// Tests for config-schema.js — provisioning gate (CFG-02)
// Run: node --test electron-app/local-server/tests/config-schema.test.js

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { validate, fromLegacy, VALID_ROLES, CURRENT_CONFIG_VERSION } = require('../config-schema')

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_CONFIG = {
  config_version:    CURRENT_CONFIG_VERSION,
  restaurant_id:     'amalay-mty',
  terminal_id:       'a1b2c3d4-0000-0000-0000-000000000001',
  terminal_role:     'server_pos',
  terminal_name:     'Caja Principal',
  local_server_host: '127.0.0.1',
  local_server_port: 7717,
  protocol_version:  '1.0',
  provisioned_at:    '2026-07-27T12:00:00.000Z',
}

const LEGACY_POS = {
  restaurantId:  'amalay-mty',
  clientId:      'amalay-mty',
  terminalId:    'legacy-term-001',
  instanceName:  'AMALAY Sucursal Principal',
  channel:       'stable',
  kds:           false,
  kds_only:      false,
}

const LEGACY_KDS = {
  restaurantId:  'amalay-mty',
  clientId:      'amalay-mty',
  kds_only:      true,
  pos_server_ip: '192.168.1.71',
  channel:       'stable',
}

// ─── validate() ───────────────────────────────────────────────────────────────

describe('validate()', () => {
  test('accepts a fully-valid config', () => {
    const { valid, errors } = validate(VALID_CONFIG)
    assert.equal(valid, true)
    assert.deepEqual(errors, [])
  })

  test('accepts all valid roles', () => {
    for (const role of VALID_ROLES) {
      const { valid } = validate({ ...VALID_CONFIG, terminal_role: role })
      assert.equal(valid, true, `role "${role}" should be valid`)
    }
  })

  test('accepts extra fields (forward-compat)', () => {
    const { valid } = validate({ ...VALID_CONFIG, future_field: 'ok', kds: true })
    assert.equal(valid, true)
  })

  test('rejects null', () => {
    const { valid } = validate(null)
    assert.equal(valid, false)
  })

  test('rejects non-object string', () => {
    const { valid } = validate('bad config')
    assert.equal(valid, false)
  })

  test('rejects empty object — lists all missing required fields', () => {
    const { valid, errors } = validate({})
    assert.equal(valid, false)
    assert.ok(errors.some(e => e.includes('restaurant_id')), 'should mention restaurant_id')
    assert.ok(errors.some(e => e.includes('terminal_id')),  'should mention terminal_id')
    assert.ok(errors.some(e => e.includes('terminal_role')), 'should mention terminal_role')
    assert.ok(errors.some(e => e.includes('provisioned_at')), 'should mention provisioned_at')
  })

  test('rejects restaurant_id === "unknown"', () => {
    const { valid, errors } = validate({ ...VALID_CONFIG, restaurant_id: 'unknown' })
    assert.equal(valid, false)
    assert.ok(errors.some(e => e.includes('"unknown"')))
  })

  test('rejects empty restaurant_id', () => {
    const { valid } = validate({ ...VALID_CONFIG, restaurant_id: '' })
    assert.equal(valid, false)
  })

  test('rejects terminal_id === "unknown"', () => {
    const { valid, errors } = validate({ ...VALID_CONFIG, terminal_id: 'unknown' })
    assert.equal(valid, false)
    assert.ok(errors.some(e => e.includes('terminal_id')))
  })

  test('rejects terminal_id shorter than 4 chars', () => {
    const { valid } = validate({ ...VALID_CONFIG, terminal_id: 'ab' })
    assert.equal(valid, false)
  })

  test('rejects invalid terminal_role', () => {
    const { valid, errors } = validate({ ...VALID_CONFIG, terminal_role: 'cashier' })
    assert.equal(valid, false)
    assert.ok(errors.some(e => e.includes('terminal_role')))
  })

  test('rejects port 0', () => {
    const { valid } = validate({ ...VALID_CONFIG, local_server_port: 0 })
    assert.equal(valid, false)
  })

  test('rejects port 99999', () => {
    const { valid } = validate({ ...VALID_CONFIG, local_server_port: 99999 })
    assert.equal(valid, false)
  })

  test('rejects string port', () => {
    const { valid } = validate({ ...VALID_CONFIG, local_server_port: '7717' })
    assert.equal(valid, false)
  })

  test('rejects empty local_server_host', () => {
    const { valid } = validate({ ...VALID_CONFIG, local_server_host: '' })
    assert.equal(valid, false)
  })

  test('rejects corrupted provisioned_at', () => {
    const { valid } = validate({ ...VALID_CONFIG, provisioned_at: 'not-a-date' })
    assert.equal(valid, false)
  })

  // ── Operational safety ──────────────────────────────────────────────────────

  test('restaurant_id "unknown" is never valid (operational safety)', () => {
    assert.equal(validate({ ...VALID_CONFIG, restaurant_id: 'unknown' }).valid, false)
  })

  test('config without terminal_id cannot operate', () => {
    const { terminal_id, ...noTerminal } = VALID_CONFIG
    assert.equal(validate(noTerminal).valid, false)
  })

  test('terminal_id persists across serialize/deserialize (restart simulation)', () => {
    const saved  = JSON.stringify(VALID_CONFIG)
    const loaded = JSON.parse(saved)
    assert.equal(loaded.terminal_id, VALID_CONFIG.terminal_id)
    assert.equal(validate(loaded).valid, true)
  })

  test('two configs for different restaurants are both valid (no mutual exclusion)', () => {
    const a = { ...VALID_CONFIG, restaurant_id: 'restaurant-a' }
    const b = { ...VALID_CONFIG, restaurant_id: 'restaurant-b' }
    assert.equal(validate(a).valid, true)
    assert.equal(validate(b).valid, true)
    assert.notEqual(a.restaurant_id, b.restaurant_id)
  })
})

// ─── fromLegacy() ─────────────────────────────────────────────────────────────

describe('fromLegacy()', () => {
  test('migrates a legacy POS config with restaurantId + clientId', () => {
    const m = fromLegacy(LEGACY_POS)
    assert.ok(m, 'should return a config')
    assert.equal(m.restaurant_id, 'amalay-mty')
    assert.equal(m.terminal_role, 'server_pos')
    assert.equal(m.config_version, CURRENT_CONFIG_VERSION)
    assert.ok(m.terminal_id, 'should have terminal_id')
    assert.ok(m.provisioned_at, 'should have provisioned_at')
  })

  test('migrated config passes validate()', () => {
    const m = fromLegacy(LEGACY_POS)
    const { valid, errors } = validate(m)
    assert.equal(valid, true, `errors: ${errors.join('; ')}`)
  })

  test('migrates kds_only config — role=kds, host=pos_server_ip', () => {
    const m = fromLegacy(LEGACY_KDS)
    assert.ok(m)
    assert.equal(m.terminal_role, 'kds')
    assert.equal(m.local_server_host, '192.168.1.71')
  })

  test('kds_only migrated config passes validate()', () => {
    const m = fromLegacy(LEGACY_KDS)
    const { valid, errors } = validate(m)
    assert.equal(valid, true, `errors: ${errors.join('; ')}`)
  })

  test('PRESERVA local_ui — sin esto el Offline Shell se apaga al migrar (pantalla negra)', () => {
    const withUi = fromLegacy({ ...LEGACY_POS, local_ui: true })
    assert.equal(withUi.local_ui, true, 'local_ui:true debe sobrevivir la migración')
    const withUiStr = fromLegacy({ ...LEGACY_KDS, local_ui: '1' })
    assert.equal(withUiStr.local_ui, true, 'local_ui:"1" también')
    const withoutUi = fromLegacy(LEGACY_POS)
    assert.equal(withoutUi.local_ui, false, 'sin local_ui → false (nube), no undefined')
  })

  test('returns null when restaurantId is "unknown"', () => {
    const result = fromLegacy({ restaurantId: 'unknown', clientId: 'unknown' })
    assert.equal(result, null)
  })

  test('returns null when restaurantId is missing entirely', () => {
    const { restaurantId, clientId, ...noId } = LEGACY_POS
    assert.equal(fromLegacy(noId), null)
  })

  test('returns null for null input', () => {
    assert.equal(fromLegacy(null), null)
  })

  test('returns null for non-object input', () => {
    assert.equal(fromLegacy('bad'), null)
  })

  test('preserves explicit terminalId from legacy (stable terminal_id)', () => {
    const m = fromLegacy({ ...LEGACY_POS, terminalId: 'stable-id-123' })
    assert.equal(m.terminal_id, 'stable-id-123')
  })

  test('reprovisioning with same terminalId produces same terminal_id', () => {
    const tid = 'term-caja-001'
    const m1 = fromLegacy({ ...LEGACY_POS, terminalId: tid })
    const m2 = fromLegacy({ ...LEGACY_POS, terminalId: tid })
    assert.ok(m1, 'first migration should succeed')
    assert.ok(m2, 'second migration should succeed')
    assert.equal(m1.terminal_id, tid)
    assert.equal(m1.terminal_id, m2.terminal_id)
  })

  test('auto-generates terminal_id if not in legacy (unique per call)', () => {
    const m1 = fromLegacy({ restaurantId: 'r1' })
    const m2 = fromLegacy({ restaurantId: 'r1' })
    assert.ok(typeof m1.terminal_id === 'string' && m1.terminal_id.length >= 8)
    assert.notEqual(m1.terminal_id, m2.terminal_id, 'each call generates a unique UUID')
  })

  test('cold-start: migrated config validates after round-trip through JSON', () => {
    const m = fromLegacy(LEGACY_POS)
    const restored = JSON.parse(JSON.stringify(m))
    assert.equal(validate(restored).valid, true)
  })

  test('migration preserves restaurant_id across restarts', () => {
    const tid = 'term-caja-002'
    const m1 = fromLegacy({ ...LEGACY_POS, terminalId: tid })
    const m2 = fromLegacy({ ...LEGACY_POS, terminalId: tid })
    assert.ok(m1); assert.ok(m2)
    assert.equal(m1.restaurant_id, m2.restaurant_id)
    assert.equal(m1.terminal_id,   m2.terminal_id)
  })

  test('NOT_PROVISIONED: missing config + no legacy = null', () => {
    assert.equal(fromLegacy(null), null)
    assert.equal(fromLegacy(undefined), null)
    assert.equal(fromLegacy({}), null)
  })

  test('cannot operate without provisioning: validate({}) is invalid', () => {
    assert.equal(validate({}).valid, false)
    assert.equal(validate(null).valid, false)
  })
})
