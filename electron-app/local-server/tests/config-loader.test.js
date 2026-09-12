'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { loadTerminalConfig } = require('../config-loader')

const PRIMARY = '/user/config.json'
const LEGACY = '/legacy/config.json'
const logger = { log() {}, warn() {} }

function fakeFs(files) {
  const store = new Map(Object.entries(files))
  const reads = []
  const writes = []
  return {
    reads,
    writes,
    existsSync(file) { return store.has(file) },
    readFileSync(file) { reads.push(file); return store.get(file) },
    mkdirSync() {},
    writeFileSync(file, value) { writes.push(file); store.set(file, value) },
  }
}

const schema = {
  validate(config) {
    return config?.schema === 2
      ? { valid: true, errors: [] }
      : { valid: false, errors: ['schema inválido'] }
  },
  touchValidatedAt() {},
  fromLegacy(config) {
    return config?.restaurantId
      ? { schema: 2, restaurant_id: config.restaurantId, terminal_id: 'migrada' }
      : null
  },
}

describe('terminal config precedence', () => {
  test('a corrupt primary config fails closed and never reads legacy identity', () => {
    const fs = fakeFs({
      [PRIMARY]: '{truncated',
      [LEGACY]: JSON.stringify({ restaurantId: 'otro-restaurante' }),
    })

    const result = loadTerminalConfig({ fs, path, schema, primaryPath: PRIMARY, legacyPath: LEGACY, logger })

    assert.equal(result.valid, false)
    assert.deepEqual(fs.reads, [PRIMARY])
    assert.deepEqual(fs.writes, [])
  })

  test('an invalid primary schema cannot be replaced by valid legacy config', () => {
    const fs = fakeFs({
      [PRIMARY]: JSON.stringify({ schema: 1, restaurant_id: 'actual' }),
      [LEGACY]: JSON.stringify({ schema: 2, restaurant_id: 'anterior' }),
    })

    const result = loadTerminalConfig({ fs, path, schema, primaryPath: PRIMARY, legacyPath: LEGACY, logger })

    assert.equal(result.valid, false)
    assert.deepEqual(result.errors, ['schema inválido'])
    assert.deepEqual(fs.reads, [PRIMARY])
  })

  test('legacy migration remains available when primary truly does not exist', () => {
    const fs = fakeFs({ [LEGACY]: JSON.stringify({ restaurantId: 'restaurante-correcto' }) })

    const result = loadTerminalConfig({ fs, path, schema, primaryPath: PRIMARY, legacyPath: LEGACY, logger })

    assert.equal(result.valid, true)
    assert.equal(result.config.restaurant_id, 'restaurante-correcto')
    assert.equal(result.migrated, true)
    assert.deepEqual(fs.writes, [PRIMARY])
  })
})
