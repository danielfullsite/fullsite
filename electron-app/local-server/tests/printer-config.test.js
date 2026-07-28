'use strict'
// ─── CFG-01: Printer Config Schema + Print Queue Tests ───────────────────────
// Run: node --test electron-app/local-server/tests/printer-config.test.js

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const os     = require('os')
const path   = require('path')
const fs     = require('fs')

const schema     = require('../adapters/printer-config-schema')
const printQueue = require('../adapters/print-queue')

// ── Fixtures ──────────────────────────────────────────────────────────────────

function validTCPPrinter(overrides = {}) {
  return {
    printer_id:    'p-aaa-111',
    name:          'Cocina',
    enabled:       true,
    connection:    { type: 'tcp', host: '10.0.0.21', port: 9100 },
    station_ids:   ['cocina'],
    document_types: ['kitchen_ticket'],
    copies:        1,
    encoding:      'cp850',
    ...overrides,
  }
}

function validV2Config(printers) {
  return {
    schema_version: 2,
    printers: printers ?? [validTCPPrinter()],
    routing: { default_station: 'cocina' },
  }
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fs-printer-test-'))
}

// ── 1. Valid configs ──────────────────────────────────────────────────────────

describe('1. Valid printer configs', () => {
  test('accepts a valid TCP printer', () => {
    const { valid, errors } = schema.validate(validV2Config())
    assert.ok(valid, `Expected valid, got: ${errors.join(', ')}`)
  })

  test('accepts a valid USB printer', () => {
    const cfg = validV2Config([{
      printer_id: 'p-usb', name: 'Caja', enabled: true,
      connection: { type: 'usb', names: ['PANADERIA', 'EC01'] },
      station_ids: ['caja', 'tickets'],
      document_types: ['receipt', 'corte'],
      copies: 1, encoding: 'cp850',
    }])
    const { valid, errors } = schema.validate(cfg)
    assert.ok(valid, errors.join(', '))
  })

  test('accepts a valid Windows printer', () => {
    const cfg = validV2Config([{
      printer_id: 'p-win', name: 'Barra', enabled: true,
      connection: { type: 'windows', names: ['BARRA TERMICA'] },
      station_ids: ['barra'],
      document_types: ['bar_ticket'],
      copies: 1, encoding: 'cp850',
    }])
    const { valid } = schema.validate(cfg)
    assert.ok(valid)
  })

  test('allows omitting optional fields (document_types, copies, encoding)', () => {
    const cfg = {
      schema_version: 2,
      printers: [{
        printer_id: 'p-min', name: 'Minima', enabled: true,
        connection: { type: 'tcp', host: '10.0.0.5', port: 9100 },
        station_ids: ['cocina'],
      }],
    }
    const { valid, errors } = schema.validate(cfg)
    assert.ok(valid, errors.join(', '))
  })

  test('allows a printer to serve multiple stations', () => {
    const { valid } = schema.validate(validV2Config([
      validTCPPrinter({ station_ids: ['cocina', 'barra', 'caja'] }),
    ]))
    assert.ok(valid)
  })

  test('allows multiple printers for one station', () => {
    const { valid } = schema.validate(validV2Config([
      validTCPPrinter({ printer_id: 'p1', name: 'Cocina Fría' }),
      validTCPPrinter({ printer_id: 'p2', name: 'Cocina Caliente', connection: { type: 'tcp', host: '10.0.0.40', port: 9100 } }),
    ]))
    assert.ok(valid)
  })
})

// ── 2. Invalid configs ────────────────────────────────────────────────────────

describe('2. Invalid printer configs', () => {
  test('rejects missing schema_version', () => {
    const { valid } = schema.validate({ printers: [validTCPPrinter()] })
    assert.ok(!valid)
  })

  test('rejects invalid IP address', () => {
    const cfg = validV2Config([validTCPPrinter({ connection: { type: 'tcp', host: '999.0.0.1', port: 9100 } })])
    const { valid, errors } = schema.validate(cfg)
    assert.ok(!valid)
    assert.ok(errors.some(e => e.includes('host')), `Expected host error, got: ${errors.join(', ')}`)
  })

  test('rejects invalid port', () => {
    const cfg = validV2Config([validTCPPrinter({ connection: { type: 'tcp', host: '10.0.0.21', port: 99999 } })])
    const { valid } = schema.validate(cfg)
    assert.ok(!valid)
  })

  test('rejects duplicate printer_id', () => {
    const cfg = validV2Config([
      validTCPPrinter({ printer_id: 'same-id', name: 'Cocina A' }),
      validTCPPrinter({ printer_id: 'same-id', name: 'Cocina B', connection: { type: 'tcp', host: '10.0.0.22', port: 9100 } }),
    ])
    const { valid, errors } = schema.validate(cfg)
    assert.ok(!valid)
    assert.ok(errors.some(e => e.includes('duplicate')))
  })

  test('rejects duplicate printer name (case-insensitive)', () => {
    const cfg = validV2Config([
      validTCPPrinter({ printer_id: 'p1', name: 'Cocina' }),
      validTCPPrinter({ printer_id: 'p2', name: 'cocina', connection: { type: 'tcp', host: '10.0.0.22', port: 9100 } }),
    ])
    const { valid, errors } = schema.validate(cfg)
    assert.ok(!valid)
    assert.ok(errors.some(e => e.includes('duplicate')))
  })

  test('rejects empty station_ids', () => {
    const { valid } = schema.validate(validV2Config([validTCPPrinter({ station_ids: [] })]))
    assert.ok(!valid)
  })

  test('rejects unknown document_type', () => {
    const { valid } = schema.validate(validV2Config([validTCPPrinter({ document_types: ['magic_ticket'] })]))
    assert.ok(!valid)
  })

  test('rejects copies outside 1–5', () => {
    const { valid } = schema.validate(validV2Config([validTCPPrinter({ copies: 10 })]))
    assert.ok(!valid)
  })

  test('rejects usb connection without names', () => {
    const { valid } = schema.validate(validV2Config([{
      printer_id: 'p-usb', name: 'USB', enabled: true,
      connection: { type: 'usb', names: [] },
      station_ids: ['caja'],
    }]))
    assert.ok(!valid)
  })
})

// ── 3. v1 → v2 migration (AMALAY legacy) ─────────────────────────────────────

describe('3. v1 → v2 migration', () => {
  const AMALAY_V1 = {
    port: 7717,
    stations: {
      cocina: [
        { type: 'tcp', host: '192.168.1.21', port: 9100 },
        { type: 'tcp', host: '192.168.1.40', port: 9100 },
      ],
      barra:   { type: 'tcp', host: '192.168.1.30', port: 9100 },
      caja:    { type: 'usb', names: ['PANADERIA'] },
      tickets: { type: 'usb', names: ['EC01', 'EC TICKET'] },
    },
    default: 'tickets',
  }

  test('migrates AMALAY printers.json with 2 cocina printers → 5 printers', () => {
    const v2 = schema.fromV1(AMALAY_V1)
    assert.ok(v2, 'Migration should succeed')
    assert.strictEqual(v2.schema_version, 2)
    assert.strictEqual(v2.printers.length, 5)
    assert.ok(v2.migrated_from_v1)
    const cocinaPrinters = v2.printers.filter(p => p.station_ids.includes('cocina'))
    assert.strictEqual(cocinaPrinters.length, 2)
  })

  test('migrated AMALAY v1 config is valid v2', () => {
    const v2 = schema.fromV1(AMALAY_V1)
    const { valid, errors } = schema.validate(v2)
    assert.ok(valid, `Migrated config invalid: ${errors.join(', ')}`)
  })

  test('fromV1 returns null for empty/missing stations', () => {
    assert.strictEqual(schema.fromV1(null), null)
    assert.strictEqual(schema.fromV1({}), null)
    assert.strictEqual(schema.fromV1({ port: 7717 }), null)
  })

  test('loadAndValidate auto-migrates v1', () => {
    const v1 = {
      stations: {
        cocina: { type: 'tcp', host: '10.0.0.21', port: 9100 },
        barra:  { type: 'tcp', host: '10.0.0.30', port: 9100 },
      },
    }
    const result = schema.loadAndValidate(v1)
    assert.ok(result.valid, result.errors.join(', '))
    assert.ok(result.migrated)
    assert.strictEqual(result.config.schema_version, 2)
  })

  test('loadAndValidate accepts v2 directly (idempotent)', () => {
    const result = schema.loadAndValidate(validV2Config())
    assert.ok(result.valid)
    assert.ok(!result.migrated)
  })

  test('loadAndValidate rejects unrecognized format', () => {
    const { valid } = schema.loadAndValidate({ foo: 'bar' })
    assert.ok(!valid)
  })

  test('migration is idempotent (migrating again returns valid v2)', () => {
    const v2 = schema.fromV1(AMALAY_V1)
    const result = schema.loadAndValidate(v2)
    assert.ok(result.valid)
    assert.ok(!result.migrated)
  })
})

// ── 4. Station resolution ─────────────────────────────────────────────────────

describe('4. Station resolution', () => {
  const PRINTERS = [
    {
      printer_id: 'p-cocina-1', name: 'Cocina Fría', enabled: true,
      connection: { type: 'tcp', host: '10.0.0.21', port: 9100 },
      station_ids: ['cocina'], document_types: ['kitchen_ticket', 'reprint'],
    },
    {
      printer_id: 'p-cocina-2', name: 'Cocina Caliente', enabled: true,
      connection: { type: 'tcp', host: '10.0.0.40', port: 9100 },
      station_ids: ['cocina'], document_types: ['kitchen_ticket'],
    },
    {
      printer_id: 'p-barra', name: 'Barra', enabled: true,
      connection: { type: 'tcp', host: '10.0.0.30', port: 9100 },
      station_ids: ['barra'], document_types: ['bar_ticket', 'reprint'],
    },
    {
      printer_id: 'p-caja', name: 'Caja', enabled: true,
      connection: { type: 'usb', names: ['CAJA_USB'] },
      station_ids: ['caja', 'tickets'],
      document_types: ['receipt', 'invoice', 'corte', 'reprint'],
    },
    {
      printer_id: 'p-disabled', name: 'Disabled', enabled: false,
      connection: { type: 'tcp', host: '10.0.0.99', port: 9100 },
      station_ids: ['cocina'], document_types: ['kitchen_ticket'],
    },
  ]

  test('cocina → 2 enabled printers', () => {
    const { printers, diagnostic } = schema.resolveStation(PRINTERS, 'cocina')
    assert.strictEqual(printers.length, 2)
    assert.strictEqual(diagnostic, null)
  })

  test('cocina + kitchen_ticket → 2 matching printers', () => {
    const { printers } = schema.resolveStation(PRINTERS, 'cocina', 'kitchen_ticket')
    assert.strictEqual(printers.length, 2)
  })

  test('caja + receipt → caja printer only', () => {
    const { printers } = schema.resolveStation(PRINTERS, 'caja', 'receipt')
    assert.strictEqual(printers.length, 1)
    assert.strictEqual(printers[0].printer_id, 'p-caja')
  })

  test('unknown station → empty + diagnostic', () => {
    const { printers, diagnostic } = schema.resolveStation(PRINTERS, 'escondite')
    assert.strictEqual(printers.length, 0)
    assert.ok(diagnostic?.includes('station_not_configured'))
  })

  test('disabled printers are excluded', () => {
    const { printers } = schema.resolveStation(PRINTERS, 'cocina')
    assert.ok(!printers.some(p => p.printer_id === 'p-disabled'))
  })

  test('document_type with no match falls back to all station printers', () => {
    const { printers, diagnostic } = schema.resolveStation(PRINTERS, 'cocina', 'receipt')
    assert.strictEqual(printers.length, 2)
    assert.ok(diagnostic?.includes('document_type_not_configured'))
  })

  test('null printers array → no_printers_config', () => {
    const { printers, diagnostic } = schema.resolveStation(null, 'cocina')
    assert.strictEqual(printers.length, 0)
    assert.strictEqual(diagnostic, 'no_printers_config')
  })

  test('one printer for multiple stations (cocina + barra)', () => {
    const shared = [{
      printer_id: 'p-shared', name: 'Compartida', enabled: true,
      connection: { type: 'tcp', host: '10.0.0.5', port: 9100 },
      station_ids: ['cocina', 'barra'],
      document_types: ['kitchen_ticket', 'bar_ticket'],
    }]
    const { printers: r1 } = schema.resolveStation(shared, 'cocina')
    const { printers: r2 } = schema.resolveStation(shared, 'barra')
    assert.strictEqual(r1.length, 1)
    assert.strictEqual(r2.length, 1)
    assert.strictEqual(r1[0].printer_id, r2[0].printer_id)
  })

  test('getConfiguredStations returns all unique station IDs from enabled printers', () => {
    const stations = schema.getConfiguredStations(PRINTERS)
    assert.ok(stations.includes('cocina'))
    assert.ok(stations.includes('barra'))
    assert.ok(stations.includes('caja'))
    assert.ok(stations.includes('tickets'))
    assert.ok(!stations.includes('escondite'))
  })
})

// ── 5. Print queue persistence ────────────────────────────────────────────────

describe('5. Print queue persistence', () => {
  let dir, queuePath

  function setupQueue() {
    dir = tmpDir()
    queuePath = path.join(dir, 'print-queue.json')
    printQueue.init({ filePath: queuePath })
  }

  function teardownQueue() {
    fs.rmSync(dir, { recursive: true, force: true })
  }

  function enqueueBasic(opts = {}) {
    return printQueue.enqueue({
      station_id:    opts.station_id    || 'cocina',
      printer_id:    opts.printer_id    || 'p-test',
      printer_name:  opts.printer_name  || 'Test',
      connection:    opts.connection    || { type: 'tcp', host: '10.0.0.21', port: 9100 },
      document_type: opts.document_type || 'kitchen_ticket',
      data_b64:      opts.data_b64      || 'AABB==',
      copies:        opts.copies        || 1,
      reprint:       opts.reprint       || false,
    })
  }

  test('job is persisted to disk before returning', () => {
    setupQueue()
    try {
      const jobId = enqueueBasic()
      const raw = JSON.parse(fs.readFileSync(queuePath, 'utf8'))
      assert.ok(raw.some(j => j.job_id === jobId))
    } finally { teardownQueue() }
  })

  test('status: pending → printing → printed', () => {
    setupQueue()
    try {
      const jobId = enqueueBasic()
      assert.strictEqual(printQueue.getJob(jobId).status, 'pending')
      printQueue.markPrinting(jobId)
      assert.strictEqual(printQueue.getJob(jobId).status, 'printing')
      assert.strictEqual(printQueue.getJob(jobId).attempts, 1)
      printQueue.markPrinted(jobId)
      assert.strictEqual(printQueue.getJob(jobId).status, 'printed')
    } finally { teardownQueue() }
  })

  test('pending jobs survive restart', () => {
    setupQueue()
    try {
      const jobId = enqueueBasic()
      printQueue.init({ filePath: queuePath })  // simulate restart
      const pending = printQueue.getPendingJobs()
      assert.ok(pending.some(j => j.job_id === jobId), 'Job must survive restart')
    } finally { teardownQueue() }
  })

  test('markFailed persists error message', () => {
    setupQueue()
    try {
      const jobId = enqueueBasic()
      printQueue.markFailed(jobId, 'TCP timeout 10.0.0.21:9100')
      const job = printQueue.getJob(jobId)
      assert.strictEqual(job.status, 'failed')
      assert.ok(job.last_error.includes('TCP timeout'))
      const raw = JSON.parse(fs.readFileSync(queuePath, 'utf8'))
      const persisted = raw.find(j => j.job_id === jobId)
      assert.ok(persisted.last_error.includes('TCP timeout'))
    } finally { teardownQueue() }
  })

  test('canRetry returns false after MAX_ATTEMPTS', () => {
    setupQueue()
    try {
      const jobId = enqueueBasic()
      for (let i = 0; i < printQueue.MAX_ATTEMPTS; i++) {
        printQueue.markPrinting(jobId)
        printQueue.markRetrying(jobId, `Attempt ${i + 1}`)
      }
      assert.ok(!printQueue.canRetry(jobId))
    } finally { teardownQueue() }
  })

  test('cancelled job cannot be retried', () => {
    setupQueue()
    try {
      const jobId = enqueueBasic()
      printQueue.markCancelled(jobId)
      assert.ok(!printQueue.canRetry(jobId))
    } finally { teardownQueue() }
  })

  test('reprint flag is preserved across status transitions', () => {
    setupQueue()
    try {
      const jobId = enqueueBasic({ reprint: true })
      printQueue.markPrinting(jobId)
      printQueue.markPrinted(jobId)
      assert.ok(printQueue.getJob(jobId).reprint)
    } finally { teardownQueue() }
  })

  test('job_id is stable — retries do not create new job IDs', () => {
    setupQueue()
    try {
      const jobId = enqueueBasic()
      printQueue.markPrinting(jobId)
      printQueue.markRetrying(jobId, 'Network error')
      printQueue.markPrinting(jobId)
      printQueue.markPrinted(jobId)
      assert.strictEqual(printQueue.getJob(jobId).job_id, jobId)
      assert.strictEqual(printQueue.getAllJobs().length, 1)
    } finally { teardownQueue() }
  })

  test('IP change: job retains original connection snapshot', () => {
    setupQueue()
    try {
      const jobId = enqueueBasic({ connection: { type: 'tcp', host: '10.0.0.21', port: 9100 } })
      // IP changes in the printer config, but job must retain original
      const job = printQueue.getJob(jobId)
      assert.strictEqual(job.connection.host, '10.0.0.21')
    } finally { teardownQueue() }
  })
})

// ── 6. Absence of config → safe failure ──────────────────────────────────────

describe('6. No config → PRINTER_NOT_CONFIGURED', () => {
  test('loadAndValidate returns invalid for null', () => {
    const result = schema.loadAndValidate(null)
    assert.ok(!result.valid)
    assert.ok(!result.config)
  })

  test('resolveStation with null config → no_printers_config', () => {
    const { printers, diagnostic } = schema.resolveStation(null, 'cocina')
    assert.strictEqual(printers.length, 0)
    assert.strictEqual(diagnostic, 'no_printers_config')
  })

  test('resolveStation with [] → station_not_configured', () => {
    const { printers, diagnostic } = schema.resolveStation([], 'cocina')
    assert.strictEqual(printers.length, 0)
    assert.ok(diagnostic?.includes('station_not_configured'))
  })
})

// ── 7. isValidHost ────────────────────────────────────────────────────────────

describe('7. isValidHost', () => {
  test('accepts valid IPv4 addresses', () => {
    assert.ok(schema.isValidHost('192.168.1.100'))
    assert.ok(schema.isValidHost('10.0.0.1'))
    assert.ok(schema.isValidHost('172.16.0.1'))
  })

  test('rejects out-of-range IPv4', () => {
    assert.ok(!schema.isValidHost('256.0.0.1'))
    assert.ok(!schema.isValidHost('999.999.999.999'))
  })

  test('accepts hostnames', () => {
    assert.ok(schema.isValidHost('printer.local'))
    assert.ok(schema.isValidHost('cocina-hp'))
  })

  test('rejects empty or null', () => {
    assert.ok(!schema.isValidHost(''))
    assert.ok(!schema.isValidHost(null))
  })
})

// ── 8. No hardcoded AMALAY IPs in production modules ─────────────────────────

describe('8. No hardcoded AMALAY IPs in production code', () => {
  const AMALAY_IPS = ['192.168.1.21', '192.168.1.30', '192.168.1.40']

  const PRODUCTION_FILES = [
    path.join(__dirname, '../adapters/printer-config-schema.js'),
    path.join(__dirname, '../adapters/printer.js'),
    path.join(__dirname, '../adapters/print-queue.js'),
  ]

  for (const filePath of PRODUCTION_FILES) {
    test(`${path.basename(filePath)} contains no AMALAY IPs`, () => {
      const content = fs.readFileSync(filePath, 'utf8')
      for (const ip of AMALAY_IPS) {
        assert.ok(!content.includes(ip),
          `Found AMALAY IP ${ip} in ${path.basename(filePath)}`)
      }
    })
  }

  test('printer-config-schema.js has no hardcoded IPs at all', () => {
    const content = fs.readFileSync(
      path.join(__dirname, '../adapters/printer-config-schema.js'), 'utf8'
    )
    const match = content.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/)
    assert.ok(!match,
      match ? `Found IP ${match[1]} in printer-config-schema.js` : '')
  })

  test('validate rejects printer_id exceeding MAX_PRINTER_ID_LENGTH', () => {
    const { MAX_PRINTER_ID_LENGTH } = schema
    const longId = 'a'.repeat(MAX_PRINTER_ID_LENGTH + 1)
    const cfg = validV2Config([validTCPPrinter({ printer_id: longId })])
    const { valid, errors } = schema.validate(cfg)
    assert.equal(valid, false)
    assert.ok(errors.some(e => /exceed|length|characters/i.test(e)),
      `expected length error, got: ${errors.join('; ')}`)
  })

  test('validate accepts printer_id at exactly MAX_PRINTER_ID_LENGTH', () => {
    const { MAX_PRINTER_ID_LENGTH } = schema
    const exactId = 'a'.repeat(MAX_PRINTER_ID_LENGTH)
    const cfg = validV2Config([validTCPPrinter({ printer_id: exactId })])
    const { valid, errors } = schema.validate(cfg)
    assert.equal(valid, true, `unexpected errors: ${errors.join('; ')}`)
  })

  test('MAX_PRINTER_ID_LENGTH is exported and is a positive integer', () => {
    const { MAX_PRINTER_ID_LENGTH } = schema
    assert.ok(typeof MAX_PRINTER_ID_LENGTH === 'number' && MAX_PRINTER_ID_LENGTH > 0,
      `expected positive number, got ${MAX_PRINTER_ID_LENGTH}`)
  })
})
