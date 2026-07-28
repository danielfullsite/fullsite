'use strict'
// ─── Printer Config Schema v2 ─────────────────────────────────────────────────
// Declarative printer configuration for any restaurant installation.
//
// Contract: a print job references { station_id, document_type }.
//   The adapter resolves this to a list of physical printers via resolveStation().
//   No IP or printer name ever appears in application logic — only in this config.
//
// Schema version 1 (legacy): { stations: { cocina: [...], barra: {...} } }
// Schema version 2 (current): { schema_version: 2, printers: [...] }
//
// Migration: fromV1() converts v1 → v2. Idempotent, no data loss.
// AMALAY migration: handled automatically via loadAndValidate() if printers.json
//   exists on C:\fullsite\ — migrated config is written to userData on success.

const { randomUUID } = require('crypto')

// ── Constants ─────────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 2

/**
 * Maximum length for a printer_id.
 *
 * Why 50:
 *   - slugifyId() auto-generates IDs ≤ 40 chars (.slice(0, 40)).
 *     The manual-edit limit must be ≥ 40 or auto-generated IDs would fail validation.
 *   - 40 + 10 = 50: gives manual editors a 10-char margin above the auto-slug baseline
 *     (e.g. "epson-cocina" → "epson-cocina-norte-v2" = 22 chars, well within limit).
 *   - 50 < 63 (DNS label RFC 1035) and < 64 (PostgreSQL identifier limit):
 *     IDs can serve as subdomain parts or DB column values without truncation.
 *   - Fits in a routing-table cell at monospace 12px without overflow.
 *
 * All consumers of printer_id (print-queue.js, printer.js) treat it as an opaque
 * string — no consumer hardcodes a length assumption.
 */
const MAX_PRINTER_ID_LENGTH = 50

const VALID_CONNECTION_TYPES = ['tcp', 'usb', 'windows']

// These are the document types the system can route.
// Station IDs are free-form strings — defined per restaurant in their printers.json.
const VALID_DOCUMENT_TYPES = [
  'kitchen_ticket',   // comanda para cocina
  'bar_ticket',       // comanda para barra
  'receipt',          // recibo de caja / ticket de cobro
  'pre_ticket',       // pre-cuenta antes de cobro
  'invoice',          // factura CFDI
  'corte',            // corte de caja (X o Z)
  'reprint',          // reimpresión manual de cualquier documento
]

const VALID_ENCODINGS = ['cp850', 'cp858', 'utf-8']

// ── Validation ────────────────────────────────────────────────────────────────

function validateConnection(conn, index) {
  const errors = []
  if (!conn || typeof conn !== 'object') {
    return [`printers[${index}].connection must be an object`]
  }
  if (!VALID_CONNECTION_TYPES.includes(conn.type)) {
    errors.push(`printers[${index}].connection.type must be one of: ${VALID_CONNECTION_TYPES.join(', ')}`)
  }
  if (conn.type === 'tcp') {
    if (!conn.host || typeof conn.host !== 'string' || !conn.host.trim()) {
      errors.push(`printers[${index}].connection.host is required for type tcp`)
    } else if (!isValidHost(conn.host)) {
      errors.push(`printers[${index}].connection.host "${conn.host}" is not a valid IP or hostname`)
    }
    if (!conn.port || typeof conn.port !== 'number' || conn.port < 1 || conn.port > 65535) {
      errors.push(`printers[${index}].connection.port must be 1–65535 for type tcp`)
    }
  }
  if (conn.type === 'usb' || conn.type === 'windows') {
    if (!Array.isArray(conn.names) || conn.names.length === 0) {
      errors.push(`printers[${index}].connection.names must be a non-empty array for type ${conn.type}`)
    }
  }
  return errors
}

function isValidHost(host) {
  if (!host) return false
  // IPv4
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
    const parts = host.split('.').map(Number)
    return parts.every(p => p >= 0 && p <= 255)
  }
  // Hostname or IP v6
  return /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/.test(host)
}

function isValidPort(port) {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535
}

/**
 * Validate a v2 printers config object.
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validate(config) {
  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Printers config must be an object'] }
  }

  const errors = []

  if (config.schema_version !== SCHEMA_VERSION) {
    errors.push(`schema_version must be ${SCHEMA_VERSION} (got ${config.schema_version})`)
  }

  if (!Array.isArray(config.printers)) {
    return { valid: false, errors: [...errors, 'printers must be an array'] }
  }

  const ids = new Set()
  const names = new Set()

  for (let i = 0; i < config.printers.length; i++) {
    const p = config.printers[i]

    if (!p || typeof p !== 'object') {
      errors.push(`printers[${i}] must be an object`)
      continue
    }

    // printer_id
    if (!p.printer_id || typeof p.printer_id !== 'string') {
      errors.push(`printers[${i}].printer_id is required`)
    } else if (p.printer_id.length > MAX_PRINTER_ID_LENGTH) {
      errors.push(`printers[${i}].printer_id exceeds ${MAX_PRINTER_ID_LENGTH} characters (got ${p.printer_id.length})`)
    } else if (ids.has(p.printer_id)) {
      errors.push(`printers[${i}].printer_id "${p.printer_id}" is duplicate`)
    } else {
      ids.add(p.printer_id)
    }

    // name
    if (!p.name || typeof p.name !== 'string' || !p.name.trim()) {
      errors.push(`printers[${i}].name must be a non-empty string`)
    } else if (names.has(p.name.toLowerCase())) {
      errors.push(`printers[${i}].name "${p.name}" is duplicate`)
    } else {
      names.add(p.name.toLowerCase())
    }

    // enabled
    if (typeof p.enabled !== 'boolean') {
      errors.push(`printers[${i}].enabled must be a boolean`)
    }

    // connection
    errors.push(...validateConnection(p.connection, i))

    // station_ids
    if (!Array.isArray(p.station_ids) || p.station_ids.length === 0) {
      errors.push(`printers[${i}].station_ids must be a non-empty array`)
    } else {
      for (const sid of p.station_ids) {
        if (typeof sid !== 'string' || !sid.trim()) {
          errors.push(`printers[${i}].station_ids contains invalid entry: "${sid}"`)
        }
      }
    }

    // document_types — optional, but if present must be valid
    if (p.document_types !== undefined) {
      if (!Array.isArray(p.document_types)) {
        errors.push(`printers[${i}].document_types must be an array`)
      } else {
        for (const dt of p.document_types) {
          if (!VALID_DOCUMENT_TYPES.includes(dt)) {
            errors.push(`printers[${i}].document_types["${dt}"] is not a valid document type. Valid: ${VALID_DOCUMENT_TYPES.join(', ')}`)
          }
        }
      }
    }

    // copies
    if (p.copies !== undefined) {
      if (typeof p.copies !== 'number' || !Number.isInteger(p.copies) || p.copies < 1 || p.copies > 5) {
        errors.push(`printers[${i}].copies must be an integer 1–5`)
      }
    }

    // encoding
    if (p.encoding !== undefined && !VALID_ENCODINGS.includes(p.encoding)) {
      errors.push(`printers[${i}].encoding must be one of: ${VALID_ENCODINGS.join(', ')}`)
    }
  }

  // routing
  if (config.routing !== undefined) {
    if (typeof config.routing !== 'object') {
      errors.push('routing must be an object')
    }
  }

  return { valid: errors.length === 0, errors }
}

// ── Migration v1 → v2 ─────────────────────────────────────────────────────────

/**
 * Convert a v1 printers.json to v2.
 * V1 format: { port?, stations: { name: cfg | cfg[] }, default?: string }
 *
 * Each station entry becomes a printer.
 * station_ids: [station_name]
 * document_types: inferred from station name heuristics.
 *
 * @param {object} v1
 * @returns {object|null} v2 config, or null if v1 is not parseable
 */
function fromV1(v1) {
  if (!v1 || typeof v1 !== 'object') return null

  const stations = v1.stations || (v1.cocina || v1.barra || v1.caja ? v1 : null)
  if (!stations || typeof stations !== 'object') return null

  const printers = []
  const stationNames = Object.keys(stations)

  for (const stationName of stationNames) {
    const entries = Array.isArray(stations[stationName])
      ? stations[stationName]
      : [stations[stationName]]

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      if (!entry || typeof entry !== 'object') continue

      const printer = {
        printer_id:    randomUUID(),
        name:          entries.length > 1
          ? `${toDisplayName(stationName)} ${i + 1}`
          : toDisplayName(stationName),
        enabled:       true,
        connection:    buildConnection(entry),
        station_ids:   [stationName],
        document_types: inferDocumentTypes(stationName),
        copies:        1,
        encoding:      'cp850',
      }

      // Only add if connection is parseable
      if (printer.connection) printers.push(printer)
    }
  }

  if (printers.length === 0) return null

  return {
    schema_version:   SCHEMA_VERSION,
    printers,
    routing: {
      default_station: v1.default || null,
    },
    migrated_from_v1: true,
  }
}

function buildConnection(entry) {
  if (entry.type === 'tcp') {
    if (!entry.host || !entry.port) return null
    return { type: 'tcp', host: entry.host, port: entry.port }
  }
  if (entry.type === 'usb') {
    const names = entry.names || (entry.name ? [entry.name] : [])
    if (!names.length) return null
    return { type: 'usb', names }
  }
  if (entry.type === 'windows') {
    const names = entry.names || (entry.name ? [entry.name] : [])
    if (!names.length) return null
    return { type: 'windows', names }
  }
  return null
}

function toDisplayName(stationName) {
  return stationName.charAt(0).toUpperCase() + stationName.slice(1)
}

function inferDocumentTypes(stationName) {
  const name = stationName.toLowerCase()
  if (name.includes('cocina') || name.includes('kitchen') || name.includes('cook')) {
    return ['kitchen_ticket', 'reprint']
  }
  if (name.includes('barra') || name.includes('bar')) {
    return ['bar_ticket', 'reprint']
  }
  if (name.includes('caja') || name.includes('ticket') || name.includes('receipt')) {
    return ['receipt', 'pre_ticket', 'invoice', 'corte', 'reprint']
  }
  // Unknown station — assign all document types so it can be used
  return [...VALID_DOCUMENT_TYPES]
}

// ── Load + validate (with auto-migration) ────────────────────────────────────

/**
 * Parse raw JSON from disk, detect v1/v2, validate, optionally migrate.
 * @param {unknown} raw — parsed JSON from printers.json
 * @returns {{ valid: boolean, config: object|null, migrated: boolean, errors: string[] }}
 */
function loadAndValidate(raw) {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, config: null, migrated: false, errors: ['Not a valid JSON object'] }
  }

  // Already v2
  if (raw.schema_version === SCHEMA_VERSION) {
    const { valid, errors } = validate(raw)
    return { valid, config: valid ? raw : null, migrated: false, errors }
  }

  // Looks like v1 — try to migrate
  if (raw.stations || raw.cocina || raw.barra || raw.caja) {
    const migrated = fromV1(raw)
    if (!migrated) {
      return { valid: false, config: null, migrated: false, errors: ['Could not parse v1 printers.json — no recognizable stations'] }
    }
    const { valid, errors } = validate(migrated)
    return { valid, config: valid ? migrated : null, migrated: true, errors }
  }

  return { valid: false, config: null, migrated: false, errors: ['Unrecognized printers.json format (not v1 or v2)'] }
}

// ── Station resolution ────────────────────────────────────────────────────────

/**
 * Given a station_id (and optional document_type), return the list of enabled
 * printers assigned to that station.
 *
 * If document_type is provided, filters to printers that handle that type.
 * If no printer handles the document_type, falls back to all station printers.
 *
 * @param {object[]} printers — v2 printers array
 * @param {string}   station_id
 * @param {string}   [document_type]
 * @returns {{ printers: object[], diagnostic: string|null }}
 */
function resolveStation(printers, station_id, document_type) {
  if (!Array.isArray(printers) || !station_id) {
    return { printers: [], diagnostic: 'no_printers_config' }
  }

  const stationPrinters = printers.filter(
    p => p.enabled && Array.isArray(p.station_ids) && p.station_ids.includes(station_id)
  )

  if (stationPrinters.length === 0) {
    return { printers: [], diagnostic: `station_not_configured:${station_id}` }
  }

  if (document_type) {
    const typed = stationPrinters.filter(
      p => !p.document_types || p.document_types.length === 0 || p.document_types.includes(document_type)
    )
    if (typed.length > 0) {
      return { printers: typed, diagnostic: null }
    }
    // No printer handles this document type — fall back to all station printers
    return { printers: stationPrinters, diagnostic: `document_type_not_configured:${document_type}:using_all_station_printers` }
  }

  return { printers: stationPrinters, diagnostic: null }
}

/**
 * Return all station_ids referenced by any enabled printer.
 * Useful for UI to show which stations have routing.
 */
function getConfiguredStations(printers) {
  if (!Array.isArray(printers)) return []
  const stations = new Set()
  for (const p of printers) {
    if (p.enabled && Array.isArray(p.station_ids)) {
      for (const sid of p.station_ids) stations.add(sid)
    }
  }
  return [...stations].sort()
}

// ── Template for a new printer ────────────────────────────────────────────────

/**
 * Return a blank printer object with defaults, ready to fill in.
 */
function newPrinterTemplate(stationId) {
  return {
    printer_id:    randomUUID(),
    name:          '',
    enabled:       true,
    connection:    { type: 'tcp', host: '', port: 9100 },
    station_ids:   stationId ? [stationId] : [],
    document_types: [],
    copies:        1,
    encoding:      'cp850',
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  SCHEMA_VERSION,
  MAX_PRINTER_ID_LENGTH,
  VALID_CONNECTION_TYPES,
  VALID_DOCUMENT_TYPES,
  VALID_ENCODINGS,
  validate,
  validateConnection,
  isValidHost,
  isValidPort,
  fromV1,
  loadAndValidate,
  resolveStation,
  getConfiguredStations,
  newPrinterTemplate,
}
