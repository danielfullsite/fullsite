'use strict'
// ─── AMALAY Digital Twin — Fixture Loader ─────────────────────────────────────
// Loads tests/twin/amalay-twin-config.json (authored separately). If the file
// is absent or partial, falls back — per-field — to the built-in FALLBACK
// fixture below, and labels the result so reports never silently pretend the
// real AMALAY config was used.
//
// CONFIG CONTRACT (amalay-twin-config.json):
// {
//   "restaurantId": "amalay-monterrey",
//   "terminals":  [{ "id": "caja-1", "type": "pos"|"kds"|"barra"|"admin", "name": "Caja Principal" }],
//   "stations":   ["cocina", "barra", "caja"],
//   "printers":   [
//      // simple shape:
//      { "printer_id": "imp-cocina", "name": "Impresora Cocina", "station": "cocina", "tcp_port": 19100 },
//      // ...or local-server printer-config-schema v2 shape (station_ids/connection) — both accepted:
//      { "printer_id": "imp-barra", "name": "Impresora Barra", "enabled": true,
//        "connection": { "type": "tcp", "host": "127.0.0.1", "port": 19101 },
//        "station_ids": ["barra"], "document_types": ["bar_ticket"] }
//   ],
//   "users":      [{ "name": "Daniela Rico", "role": "gerente"|"cajero"|"mesero"|"cocina", "pin": "4321" }],
//   "mesas":      ["1", "2", ..., "J1", "J2"],
//   "menu":       [{ "id": "chilaquiles-verdes", "name": "Chilaquiles Verdes", "price": 145,
//                    "category": "CHILAQUILES & ENCHILADAS", "station": "cocina",
//                    "modifier_groups": ["proteina"] }],
//   "modifiers":  { "proteina": { "name": "Proteína", "options": [
//                     { "name": "Pollo", "price": 0 },
//                     { "name": "Huevo estrellado", "price": 10,
//                       "options": [{ "name": "Bien cocido" }] }   // nested = multilevel
//                  ] } },
//   "paymentMethods": ["efectivo", "tarjeta_credito", "tarjeta_debito", "transferencia"]
// }
// The harness requires at least one printer whose station is "cocina" and one
// whose station is "barra". Menu items must reference a station present in
// `stations`. Everything else is free-form and rides opaquely on the protocol.

const fs = require('fs')
const path = require('path')

const FALLBACK_FIXTURE = {
  restaurantId: 'amalay-twin-fallback',
  terminals: [
    { id: 'caja-1',     type: 'pos',   name: 'Caja Principal (FALLBACK)' },
    { id: 'mesero-1',   type: 'pos',   name: 'Tablet Mesero 1 (FALLBACK)' },
    { id: 'kds-cocina', type: 'kds',   name: 'KDS Cocina (FALLBACK)' },
    { id: 'barra-1',    type: 'barra', name: 'Pantalla Barra (FALLBACK)' },
  ],
  stations: ['cocina', 'barra', 'caja'],
  printers: [
    { printer_id: 'imp-cocina', name: 'Impresora Cocina (FALLBACK)', station: 'cocina', tcp_port: 19100 },
    { printer_id: 'imp-barra',  name: 'Impresora Barra (FALLBACK)',  station: 'barra',  tcp_port: 19101 },
  ],
  users: [
    { name: 'Gerente Twin',  role: 'gerente', pin: '4321' },
    { name: 'Cajero Twin',   role: 'cajero',  pin: '9999' },
    { name: 'Mesero Twin 1', role: 'mesero',  pin: '1111' },
    { name: 'Mesero Twin 2', role: 'mesero',  pin: '2222' },
  ],
  mesas: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', 'J1', 'J2', 'J3', 'J4'],
  menu: [
    { id: 'chilaquiles-verdes', name: 'Chilaquiles Verdes', price: 145, category: 'CHILAQUILES & ENCHILADAS', station: 'cocina', modifier_groups: ['proteina', 'extras-chilaquiles'] },
    { id: 'half-half',          name: 'Half & Half',        price: 155, category: 'CHILAQUILES & ENCHILADAS', station: 'cocina', modifier_groups: ['proteina'] },
    { id: 'panini-caprese',     name: 'Panini Caprese',     price: 128, category: 'PANINIS',            station: 'cocina', modifier_groups: [] },
    { id: 'bowl-proteina',      name: 'Bowl Proteína',      price: 139, category: 'BOWLS',              station: 'cocina', modifier_groups: ['proteina'] },
    { id: 'toast-aguacate',     name: 'Toast de Aguacate',  price: 115, category: 'TOAST & BAGELS',     station: 'cocina', modifier_groups: [] },
    { id: 'pancakes',           name: 'Pancakes',           price: 98,  category: 'PANCAKES & WAFFLES', station: 'cocina', modifier_groups: ['extras-dulce'] },
    { id: 'latte',              name: 'Latte',              price: 62,  category: 'COFFEE HOT/ICE',     station: 'barra',  modifier_groups: ['leche', 'temperatura'] },
    { id: 'jugo-verde',         name: 'Jugo Verde',         price: 55,  category: 'JUGOS',              station: 'barra',  modifier_groups: [] },
    { id: 'frappe-moka',        name: 'Frappe Moka',        price: 78,  category: 'FRAPPES',            station: 'barra',  modifier_groups: ['leche'] },
    { id: 'smoothie-berry',     name: 'Smoothie Berry',     price: 85,  category: 'SMOOTHIES',          station: 'barra',  modifier_groups: [] },
  ],
  modifiers: {
    proteina: {
      name: 'Proteína',
      options: [
        { name: 'Pollo', price: 0 },
        { name: 'Huevo estrellado', price: 10, options: [{ name: 'Término tierno' }, { name: 'Bien cocido' }] },
        { name: 'Arrachera', price: 35 },
      ],
    },
    'extras-chilaquiles': {
      name: 'Extras',
      options: [{ name: 'Queso extra', price: 20 }, { name: 'Sin cebolla', price: 0 }],
    },
    'extras-dulce': {
      name: 'Extras dulces',
      options: [{ name: 'Miel extra', price: 0 }, { name: 'Sin fresa', price: 0 }],
    },
    leche: {
      name: 'Leche',
      options: [
        { name: 'Entera', price: 0 },
        { name: 'Deslactosada', price: 0 },
        { name: 'Avena', price: 15, options: [{ name: 'Extra shot', price: 12 }] },
      ],
    },
    temperatura: { name: 'Temperatura', options: [{ name: 'Caliente' }, { name: 'Frío' }] },
  },
  paymentMethods: ['efectivo', 'tarjeta_credito', 'tarjeta_debito', 'transferencia'],
}

/** Normalize a printers[] entry (simple or v2 shape) → { printer_id, name, station, tcp_port } */
function normalizePrinter(p, i, warnings) {
  if (!p || typeof p !== 'object') return null
  const station = p.station || (Array.isArray(p.station_ids) ? p.station_ids[0] : null)
  const tcpPort = p.tcp_port || (p.connection && p.connection.type === 'tcp' ? p.connection.port : null)
  if (!station || !tcpPort) {
    warnings.push(`printers[${i}] missing station/tcp_port — entry ignored`)
    return null
  }
  return {
    printer_id: p.printer_id || `imp-${station}`,
    name:       p.name || `Impresora ${station}`,
    station,
    tcp_port:   tcpPort,
  }
}

/**
 * Adapt the rich AMALAY config shape (as authored in amalay-twin-config.json,
 * see AMALAY-CONFIG-PROVENANCE.md) into the canonical simple fixture shape the
 * harness consumes. Detected by markers: menu.categories / printers_config /
 * mesas.count. Returns null if the raw object is already canonical.
 */
function adaptRichConfig(raw, warnings) {
  const isRich = (raw.menu && !Array.isArray(raw.menu) && Array.isArray(raw.menu.categories)) ||
    raw.printers_config || (raw.mesas && !Array.isArray(raw.mesas) && typeof raw.mesas.count === 'number')
  if (!isRich) return null
  warnings.push('rich AMALAY config shape detected — adapted to canonical fixture shape')
  const out = { restaurantId: raw.restaurantId }

  // terminals: TerminalConfig-style entries → { id, type, name }
  if (Array.isArray(raw.terminals)) {
    out.terminals = raw.terminals.map((t, i) => ({
      id:   t.terminal_id || t.id || `terminal-${i}`,
      type: (t.terminal_role === 'server_pos' ? 'pos' : t.terminal_role) || t.type || 'pos',
      name: t.terminal_name || t.name || t.instance_name || `Terminal ${i}`,
    }))
  }

  // stations: [{id,label,...}] → [id]
  if (Array.isArray(raw.stations)) {
    out.stations = raw.stations.map(s => (typeof s === 'string' ? s : s.id)).filter(Boolean)
  }

  // printers: printers_config is already local-server v2 — normalizePrinter handles it
  if (raw.printers_config && Array.isArray(raw.printers_config.printers)) {
    out.printers = raw.printers_config.printers
  }

  // users: already { name, role, pin } (+extras)
  if (Array.isArray(raw.users)) {
    out.users = raw.users.filter(u => u.active !== false).map(u => ({ name: u.name, role: u.role, pin: u.pin }))
  }

  // mesas: { count: N } → ['1'..'N']
  if (raw.mesas && typeof raw.mesas.count === 'number') {
    out.mesas = Array.from({ length: raw.mesas.count }, (_, i) => String(i + 1))
  } else if (Array.isArray(raw.mesas)) {
    out.mesas = raw.mesas
  }

  // menu: { categories: [{id,name,station,items:[{id,name,price}]}] } → flat items.
  // Modifier groups attach by station heuristic (level-1 quitar + level-2 extras
  // for cocina; coffee/drink extras for barra) — mirrors the app's category routing.
  const groups = (raw.modifier_groups && Array.isArray(raw.modifier_groups.groups)) ? raw.modifier_groups.groups : []
  const groupIds = groups.map(g => g.id)
  const cocinaGroups = groupIds.filter(id => /quitar|food/.test(id))
  const barraGroups  = groupIds.filter(id => /coffee|drink/.test(id))
  const noModCats = new Set((raw.modifier_groups && raw.modifier_groups.no_modifier_categories) || [])
  if (raw.menu && Array.isArray(raw.menu.categories)) {
    out.menu = []
    for (const cat of raw.menu.categories) {
      for (const item of cat.items || []) {
        out.menu.push({
          id: item.id, name: item.name, price: item.price,
          category: cat.name || cat.id,
          station: cat.station || 'cocina',
          modifier_groups: noModCats.has(cat.id) ? [] : (cat.station === 'barra' ? barraGroups : cocinaGroups),
        })
      }
    }
  }

  // modifiers: groups[] → { id: { name, options: [{name, price}] } }
  if (groups.length) {
    out.modifiers = {}
    for (const g of groups) {
      out.modifiers[g.id] = {
        name: g.name || g.id,
        options: (g.modifiers || g.options || []).map(m => ({ name: m.name, price: m.price || 0, ...(m.options ? { options: m.options } : {}) })),
      }
    }
  }

  // paymentMethods: [{name,type}] → [name]
  const pm = raw.payment_methods || raw.paymentMethods
  if (Array.isArray(pm)) {
    out.paymentMethods = pm.map(p => (typeof p === 'string' ? p : p.name)).filter(Boolean)
  }

  return out
}

/**
 * Load the twin fixture.
 * @param {string} configPath
 * @returns {{ fixture: object, source: 'file'|'FALLBACK'|'file+fallback-fill', warnings: string[] }}
 */
function loadFixture(configPath) {
  const warnings = []
  let raw = null

  if (configPath && fs.existsSync(configPath)) {
    try {
      raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    } catch (e) {
      warnings.push(`amalay-twin-config.json exists but is not valid JSON (${e.message}) — using FALLBACK fixture`)
      raw = null
    }
  }

  if (!raw) {
    return {
      fixture: JSON.parse(JSON.stringify(FALLBACK_FIXTURE)),
      source: 'FALLBACK',
      warnings: warnings.length ? warnings : [`config file not found at ${configPath} — using built-in FALLBACK fixture`],
    }
  }

  // Rich AMALAY shape → canonical shape (no-op if already canonical)
  const adapted = adaptRichConfig(raw, warnings)
  if (adapted) raw = adapted

  // Per-field merge with fallback
  const fx = {}
  let filled = false
  const fields = ['restaurantId', 'terminals', 'stations', 'printers', 'users', 'mesas', 'menu', 'modifiers', 'paymentMethods']
  for (const f of fields) {
    const v = raw[f]
    const empty = v === undefined || v === null ||
      (Array.isArray(v) && v.length === 0) ||
      (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) ||
      (typeof v === 'string' && v.trim() === '')
    if (empty) {
      fx[f] = JSON.parse(JSON.stringify(FALLBACK_FIXTURE[f]))
      warnings.push(`field "${f}" missing/empty in config — filled from FALLBACK`)
      filled = true
    } else {
      fx[f] = v
    }
  }

  // Normalize printers and guarantee cocina + barra devices
  fx.printers = fx.printers.map((p, i) => normalizePrinter(p, i, warnings)).filter(Boolean)
  for (const station of ['cocina', 'barra']) {
    if (!fx.printers.some(p => p.station === station)) {
      const fb = FALLBACK_FIXTURE.printers.find(p => p.station === station)
      fx.printers.push({ ...fb })
      warnings.push(`no "${station}" printer in config — added FALLBACK ${station} printer on port ${fb.tcp_port}`)
      filled = true
    }
  }

  // Menu items must have valid stations; coerce unknowns to cocina with a warning
  for (const item of fx.menu) {
    if (!item.station || !fx.stations.includes(item.station)) {
      warnings.push(`menu item "${item.id || item.name}" has station "${item.station}" not in stations[] — coerced to "cocina"`)
      item.station = 'cocina'
    }
    if (typeof item.price !== 'number') item.price = 0
  }

  // Mesas as strings
  fx.mesas = fx.mesas.map(String)

  return { fixture: fx, source: filled ? 'file+fallback-fill' : 'file', warnings }
}

module.exports = { loadFixture, FALLBACK_FIXTURE }
