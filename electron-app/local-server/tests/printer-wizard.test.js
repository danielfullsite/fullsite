'use strict'
// ─── Printer Wizard Logic — Unit Tests ───────────────────────────────────────
// 17 scenarios: form validation, ID generation, routing checks, migration.
// Runner: node:test  (same as printer-config.test.js)
// Run:    node --test electron-app/local-server/tests/printer-wizard.test.js

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')

const {
  validatePrinterForm,
  buildPrinterFromForm,
  checkDuplicateId,
  checkDuplicateRouting,
  deriveRoutingTable,
  buildV2Config,
  slugifyId,
  generatePrinterId,
  parseNames,
  MAX_PRINTER_ID_LENGTH,
} = require('../adapters/printer-wizard-logic')

const { validate } = require('../adapters/printer-config-schema')

// ── Fixtures ──────────────────────────────────────────────────────────────────

function tcpForm(overrides = {}) {
  return {
    name:            'Epson Cocina',
    printer_id:      'epson-cocina',
    connection_type: 'tcp',
    host:            '192.168.1.21',
    port:            9100,
    station_ids:     ['cocina'],
    document_types:  ['kitchen_ticket'],
    copies:          1,
    encoding:        'cp850',
    enabled:         true,
    ...overrides,
  }
}

function winForm(overrides = {}) {
  return {
    name:            'EC Caja',
    printer_id:      'ec-caja',
    connection_type: 'windows',
    names_raw:       'TICKET\nEC TICKET\nEC01',
    station_ids:     ['caja'],
    document_types:  ['receipt', 'corte'],
    copies:          1,
    encoding:        'cp850',
    enabled:         true,
    ...overrides,
  }
}

// ── TC-01 → TC-08: form validation ────────────────────────────────────────────

test('TC-01 validatePrinterForm — valid TCP config', () => {
  const { valid, errors } = validatePrinterForm(tcpForm())
  assert.equal(valid, true, `unexpected errors: ${errors.join('; ')}`)
})

test('TC-02 validatePrinterForm — valid Windows USB config', () => {
  const { valid, errors } = validatePrinterForm(winForm())
  assert.equal(valid, true, `unexpected errors: ${errors.join('; ')}`)
})

test('TC-03 validatePrinterForm — empty host fails', () => {
  const { valid, errors } = validatePrinterForm(tcpForm({ host: '' }))
  assert.equal(valid, false)
  assert.ok(errors.some(e => /host/i.test(e)), `expected host error, got: ${errors.join('; ')}`)
})

test('TC-04 validatePrinterForm — invalid IP octets fails', () => {
  const { valid, errors } = validatePrinterForm(tcpForm({ host: '999.0.0.1' }))
  assert.equal(valid, false)
  assert.ok(errors.some(e => /host|ip/i.test(e)), `expected host error, got: ${errors.join('; ')}`)
})

test('TC-05 validatePrinterForm — port 0 fails', () => {
  const { valid, errors } = validatePrinterForm(tcpForm({ port: 0 }))
  assert.equal(valid, false)
  assert.ok(errors.some(e => /puerto/i.test(e)), `expected port error, got: ${errors.join('; ')}`)
})

test('TC-06 validatePrinterForm — port 99999 fails', () => {
  const { valid, errors } = validatePrinterForm(tcpForm({ port: 99999 }))
  assert.equal(valid, false)
  assert.ok(errors.some(e => /puerto/i.test(e)), `expected port error, got: ${errors.join('; ')}`)
})

test('TC-07 validatePrinterForm — missing name fails', () => {
  const { valid, errors } = validatePrinterForm(tcpForm({ name: '' }))
  assert.equal(valid, false)
  assert.ok(errors.some(e => /nombre/i.test(e)), `expected name error, got: ${errors.join('; ')}`)
})

test('TC-08 validatePrinterForm — missing printer_id fails', () => {
  const { valid, errors } = validatePrinterForm(tcpForm({ printer_id: '' }))
  assert.equal(valid, false)
  assert.ok(errors.some(e => /id/i.test(e)), `expected id error, got: ${errors.join('; ')}`)
})

// ── TC-09 → TC-12: duplicate checks ──────────────────────────────────────────

test('TC-09 checkDuplicateId — detects existing ID', () => {
  const printers = [{ printer_id: 'cocina-1' }, { printer_id: 'barra-1' }]
  assert.equal(checkDuplicateId(printers, 'cocina-1'), true,  'should detect cocina-1 as duplicate')
  assert.equal(checkDuplicateId(printers, 'nuevo-id'), false, 'nuevo-id should not be a duplicate')
})

test('TC-10 checkDuplicateId — excludeIndex skips own entry during edit', () => {
  const printers = [{ printer_id: 'cocina-1' }, { printer_id: 'barra-1' }]
  assert.equal(checkDuplicateId(printers, 'cocina-1', 0), false, 'should skip self at index 0')
  assert.equal(checkDuplicateId(printers, 'cocina-1', 1), true,  'index 1 is not cocina-1, so still duplicate')
})

test('TC-11 checkDuplicateRouting — detects overlap between two printers', () => {
  const printers = [
    { printer_id: 'p1', enabled: true, station_ids: ['cocina'], document_types: ['kitchen_ticket'] },
    { printer_id: 'p2', enabled: true, station_ids: ['barra'],  document_types: ['bar_ticket'] },
  ]
  assert.equal(checkDuplicateRouting(printers, 'cocina', 'kitchen_ticket'), true,  'cocina+kitchen_ticket already covered')
  assert.equal(checkDuplicateRouting(printers, 'cocina', 'receipt'),        false, 'cocina+receipt not covered')
  assert.equal(checkDuplicateRouting(printers, 'barra',  'kitchen_ticket'), false, 'barra+kitchen_ticket not covered')
})

test('TC-12 checkDuplicateRouting — disabled printers are not counted', () => {
  const printers = [
    { printer_id: 'p1', enabled: false, station_ids: ['cocina'], document_types: ['kitchen_ticket'] },
  ]
  assert.equal(checkDuplicateRouting(printers, 'cocina', 'kitchen_ticket'), false, 'disabled printer should not block')
})

// ── TC-13 → TC-14: form → object conversion ───────────────────────────────────

test('TC-13 buildPrinterFromForm — TCP printer', () => {
  const p = buildPrinterFromForm(tcpForm())
  assert.equal(p.printer_id,      'epson-cocina')
  assert.equal(p.name,            'Epson Cocina')
  assert.equal(p.connection.type, 'tcp')
  assert.equal(p.connection.host, '192.168.1.21')
  assert.equal(p.connection.port, 9100)
  assert.deepEqual(p.station_ids, ['cocina'])
  assert.equal(p.enabled, true)
})

test('TC-14 buildPrinterFromForm — Windows USB parses multi-line names', () => {
  const p = buildPrinterFromForm(winForm())
  assert.equal(p.connection.type, 'windows')
  assert.deepEqual(p.connection.names, ['TICKET', 'EC TICKET', 'EC01'])
})

// ── TC-15: routing display ────────────────────────────────────────────────────

test('TC-15 deriveRoutingTable — disabled printer excluded from routing', () => {
  const printers = [
    { printer_id: 'p1', name: 'Enabled',  enabled: true,  station_ids: ['cocina'], document_types: ['kitchen_ticket'] },
    { printer_id: 'p2', name: 'Disabled', enabled: false, station_ids: ['barra'],  document_types: ['bar_ticket'] },
  ]
  const rows = deriveRoutingTable(printers)
  assert.equal(rows.length, 1,          'only 1 row from enabled printer')
  assert.equal(rows[0].station_id, 'cocina')
  assert.equal(rows[0].document_type, 'kitchen_ticket')
  assert.equal(rows[0].printer_name, 'Enabled')
})

// ── TC-16: full config assembly ───────────────────────────────────────────────

test('TC-16 buildV2Config — produces schema-valid v2 config', () => {
  const printer = buildPrinterFromForm(tcpForm())
  const config  = buildV2Config([printer])
  const { valid, errors } = validate(config)
  assert.equal(valid, true,       `schema validation failed: ${errors.join('; ')}`)
  assert.equal(config.schema_version, 2)
  assert.equal(config.printers.length, 1)
})

// ── TC-17: slugify ────────────────────────────────────────────────────────────

test('TC-17 slugifyId — normalizes names to valid IDs', () => {
  assert.equal(slugifyId('Epson Cocina'),   'epson-cocina')
  assert.equal(slugifyId('Bar & Grill 2'), 'bar-grill-2')
  assert.equal(slugifyId(''),               'printer')
  // ID must start with letter or number
  const result = slugifyId('--inicio')
  assert.ok(/^[a-z0-9]/.test(result), `ID should start with letter or number, got: ${result}`)
})

// ── TC-18: printer_id length limit ───────────────────────────────────────────

test('TC-18 validatePrinterForm — printer_id exceeding MAX_PRINTER_ID_LENGTH fails', () => {
  const longId = 'a'.repeat(MAX_PRINTER_ID_LENGTH + 1)
  const { valid, errors } = validatePrinterForm(tcpForm({ printer_id: longId }))
  assert.equal(valid, false)
  assert.ok(
    errors.some(e => /superar|exceed|length|largo/i.test(e)),
    `expected length error, got: ${errors.join('; ')}`
  )
})

test('TC-19 validatePrinterForm — printer_id at exactly MAX_PRINTER_ID_LENGTH passes', () => {
  const exactId = 'a'.repeat(MAX_PRINTER_ID_LENGTH)
  const { valid, errors } = validatePrinterForm(tcpForm({ printer_id: exactId }))
  assert.equal(valid, true, `unexpected errors: ${errors.join('; ')}`)
})

test('TC-20 MAX_PRINTER_ID_LENGTH is exported from wizard-logic and matches schema', () => {
  const schemaConst = require('../adapters/printer-config-schema').MAX_PRINTER_ID_LENGTH
  assert.equal(MAX_PRINTER_ID_LENGTH, schemaConst,
    `wizard-logic exports ${MAX_PRINTER_ID_LENGTH} but schema defines ${schemaConst}`)
})
