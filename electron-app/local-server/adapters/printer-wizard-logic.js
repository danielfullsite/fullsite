'use strict'
// ─── Printer Wizard Logic ─────────────────────────────────────────────────────
// UI-facing pure logic for the setup wizard's printer configuration step.
// No I/O, no DOM. Wraps printer-config-schema for testability.

const schema = require('./printer-config-schema')

// ── Labels ────────────────────────────────────────────────────────────────────

const STATION_LABELS = {
  cocina:     'Cocina',
  barra:      'Barra',
  caja:       'Caja',
  expedicion: 'Expedición',
  bar:        'Bar',
  tickets:    'Tickets',
}

const DOC_TYPE_LABELS = {
  kitchen_ticket: 'Comanda de cocina',
  bar_ticket:     'Comanda de barra',
  receipt:        'Ticket de cliente',
  pre_ticket:     'Pre-cuenta',
  invoice:        'Factura',
  corte:          'Corte de caja',
  reprint:        'Reimpresión',
}

// ── ID helpers ────────────────────────────────────────────────────────────────

function slugifyId(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'printer'
}

function generatePrinterId(name, existingIds = []) {
  const base = slugifyId(name)
  if (!existingIds.includes(base)) return base
  for (let i = 2; i <= 99; i++) {
    const id = `${base}-${i}`
    if (!existingIds.includes(id)) return id
  }
  return `${base}-x`
}

// ── Form utilities ────────────────────────────────────────────────────────────

function parseNames(raw) {
  if (!raw) return []
  return String(raw).split('\n').map(s => s.trim()).filter(Boolean)
}

// ── Form validation ───────────────────────────────────────────────────────────

/**
 * Validate a single-printer form submission.
 * @param {{ name, printer_id, connection_type, host?, port?, names_raw?,
 *           copies?, encoding? }} form
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validatePrinterForm(form) {
  const errors = []

  if (!form.name || !String(form.name).trim()) {
    errors.push('El nombre es requerido.')
  }

  const pid = String(form.printer_id || '').trim()
  if (!pid) {
    errors.push('El ID lógico es requerido.')
  } else if (!/^[a-z0-9][a-z0-9-]*$/.test(pid)) {
    errors.push('El ID solo puede contener letras minúsculas, números y guiones, y debe comenzar con letra o número.')
  }

  const connType = form.connection_type
  if (!schema.VALID_CONNECTION_TYPES.includes(connType)) {
    errors.push(`Tipo de conexión inválido. Valores válidos: ${schema.VALID_CONNECTION_TYPES.join(', ')}.`)
  } else if (connType === 'tcp') {
    const host = String(form.host || '').trim()
    if (!host) {
      errors.push('El host es requerido para conexión TCP.')
    } else if (!schema.isValidHost(host)) {
      errors.push(`Host inválido: "${host}". Debe ser una IPv4 o hostname válido.`)
    }
    const port = Number(form.port)
    if (!schema.isValidPort(port)) {
      errors.push(`Puerto inválido: "${form.port}". Debe ser un número entre 1 y 65535.`)
    }
  } else {
    const names = parseNames(form.names_raw)
    if (!names.length) {
      errors.push('Se requiere al menos un nombre de impresora de Windows.')
    }
  }

  if (form.copies !== undefined && form.copies !== '') {
    const c = Number(form.copies)
    if (!Number.isInteger(c) || c < 1 || c > 5) {
      errors.push('Las copias deben ser un número entre 1 y 5.')
    }
  }

  if (form.encoding && !schema.VALID_ENCODINGS.includes(form.encoding)) {
    errors.push(`Encoding inválido: "${form.encoding}".`)
  }

  return { valid: errors.length === 0, errors }
}

// ── Form → printer object ─────────────────────────────────────────────────────

function buildPrinterFromForm(form) {
  const connType = form.connection_type || 'tcp'
  const connection = connType === 'tcp'
    ? { type: 'tcp', host: String(form.host || '').trim(), port: Number(form.port) }
    : { type: connType, names: parseNames(form.names_raw) }

  return {
    printer_id:     String(form.printer_id || '').trim(),
    name:           String(form.name || '').trim(),
    enabled:        form.enabled !== false,
    connection,
    station_ids:    Array.isArray(form.station_ids)    ? [...form.station_ids]    : [],
    document_types: Array.isArray(form.document_types) ? [...form.document_types] : [],
    copies:         Number(form.copies)  || 1,
    encoding:       form.encoding        || 'cp850',
  }
}

// ── Duplicate checks ──────────────────────────────────────────────────────────

/** True if any printer other than excludeIndex has the same printer_id. */
function checkDuplicateId(printers, printer_id, excludeIndex = -1) {
  return printers.some((p, i) => i !== excludeIndex && p.printer_id === printer_id)
}

/**
 * True if any enabled printer other than excludeIndex already handles
 * the same stationId + docType combination.
 */
function checkDuplicateRouting(printers, stationId, docType, excludeIndex = -1) {
  return printers.some((p, i) => {
    if (i === excludeIndex || !p.enabled) return false
    return (
      Array.isArray(p.station_ids)    && p.station_ids.includes(stationId) &&
      Array.isArray(p.document_types) && p.document_types.includes(docType)
    )
  })
}

// ── Routing display ───────────────────────────────────────────────────────────

/**
 * Expand enabled printers into (station, docType, printer) rows for UI display.
 * Disabled printers are excluded.
 */
function deriveRoutingTable(printers) {
  if (!Array.isArray(printers)) return []
  const rows = []
  for (const p of printers) {
    if (!p.enabled) continue
    const stations = p.station_ids || []
    const docTypes = p.document_types && p.document_types.length > 0
      ? p.document_types
      : ['(todos los documentos)']
    for (const sid of stations) {
      for (const dt of docTypes) {
        rows.push({
          station_id:    sid,
          station_label: STATION_LABELS[sid] || sid,
          document_type: dt,
          doc_label:     DOC_TYPE_LABELS[dt]  || dt,
          printer_id:    p.printer_id,
          printer_name:  p.name,
        })
      }
    }
  }
  return rows
}

// ── Config assembly ───────────────────────────────────────────────────────────

function buildV2Config(printers) {
  return { schema_version: 2, printers, routing: {} }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  STATION_LABELS,
  DOC_TYPE_LABELS,
  slugifyId,
  generatePrinterId,
  parseNames,
  validatePrinterForm,
  buildPrinterFromForm,
  checkDuplicateId,
  checkDuplicateRouting,
  deriveRoutingTable,
  buildV2Config,
}
