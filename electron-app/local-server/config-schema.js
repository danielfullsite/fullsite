'use strict'
// ─── Provisioning Config Schema ───────────────────────────────────────────────
// Every Fullsite terminal must have a validated config before operational use.
// A missing or invalid config puts the terminal in NOT_PROVISIONED state.
// This module is the single source of truth for what constitutes a valid config.

const CURRENT_CONFIG_VERSION = 1
const VALID_ROLES = ['server_pos', 'pos', 'kds', 'admin']
const PROTOCOL_VERSION = '1.0'

/**
 * @typedef {Object} TerminalConfig
 * @property {number}  config_version      — must be CURRENT_CONFIG_VERSION
 * @property {string}  restaurant_id       — Supabase client_id for this restaurant
 * @property {string}  terminal_id         — stable UUID for this physical terminal
 * @property {string}  terminal_role       — 'server_pos' | 'pos' | 'kds' | 'admin'
 * @property {string}  terminal_name       — human label (e.g. "Caja Principal")
 * @property {string}  local_server_host   — '127.0.0.1' for server_pos; caja LAN host for pos/kds/admin
 * @property {number}  local_server_port   — typically 7717
 * @property {string}  protocol_version    — e.g. '1.0'
 * @property {string}  provisioned_at      — ISO 8601
 * @property {string}  [last_validated_at] — ISO 8601, updated each successful startup
 * @property {string}  [client_id]         — alias for restaurant_id (legacy compat)
 * @property {string}  [channel]           — 'stable' | 'pilot' | 'development'
 * @property {string}  [instance_name]     — display name for mDNS advertisement
 * @property {boolean} [kds]               — open KDS window on second display (server_pos only)
 * @property {boolean} [kds_only]          — this machine is a dedicated KDS terminal
 * @property {string}  [pos_server_ip]     — LAN IP of the server_pos (pos/kds/admin machines)
 * @property {string}  [supabaseUrl]       — override Supabase URL
 * @property {string}  [supabaseAnonKey]   — override Supabase anon key
 */

/**
 * Validate a config object against the terminal provisioning schema.
 * Returns { valid: boolean, errors: string[] }.
 * This is the gate: if valid === false, refuse to start operational services.
 *
 * @param {unknown} config
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validate(config) {
  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Config is null, undefined, or not an object'] }
  }

  const errors = []

  const required = [
    'config_version', 'restaurant_id', 'terminal_id', 'terminal_role',
    'terminal_name', 'local_server_host', 'local_server_port',
    'protocol_version', 'provisioned_at',
  ]
  for (const f of required) {
    if (config[f] === undefined || config[f] === null || config[f] === '') {
      errors.push(`Missing required field: ${f}`)
    }
  }
  if (errors.length > 0) return { valid: false, errors }

  // restaurant_id
  if (config.restaurant_id === 'unknown') {
    errors.push('restaurant_id must not be "unknown" — run the provisioning wizard')
  } else if (typeof config.restaurant_id !== 'string' || config.restaurant_id.trim().length < 2) {
    errors.push('restaurant_id must be a non-empty string (min 2 chars)')
  }

  // terminal_id
  if (config.terminal_id === 'unknown') {
    errors.push('terminal_id must not be "unknown"')
  } else if (typeof config.terminal_id !== 'string' || config.terminal_id.trim().length < 4) {
    errors.push('terminal_id must be a non-empty string (min 4 chars)')
  }

  // terminal_role
  if (!VALID_ROLES.includes(config.terminal_role)) {
    errors.push(`terminal_role must be one of: ${VALID_ROLES.join(', ')} (got "${config.terminal_role}")`)
  }

  // local_server_port
  const port = config.local_server_port
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push(`local_server_port must be an integer between 1 and 65535 (got ${port})`)
  }

  // local_server_host
  if (typeof config.local_server_host !== 'string' || config.local_server_host.trim().length === 0) {
    errors.push('local_server_host must be a non-empty string')
  }

  // provisioned_at — must parse as a date
  if (config.provisioned_at && isNaN(Date.parse(config.provisioned_at))) {
    errors.push('provisioned_at must be a valid ISO 8601 timestamp')
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Attempt to migrate a legacy config.json (pre-provisioning-schema) to TerminalConfig.
 * Legacy configs had: restaurantId, clientId, terminalId, instanceName, kds, kds_only, channel.
 * Returns null if the legacy config lacks a usable restaurant_id.
 *
 * @param {object} legacy
 * @returns {TerminalConfig | null}
 */
function fromLegacy(legacy) {
  if (!legacy || typeof legacy !== 'object') return null

  const restaurantId = legacy.restaurantId || legacy.clientId || legacy.restaurant_id
  if (!restaurantId || restaurantId === 'unknown') return null

  const { randomUUID } = require('crypto')
  const terminalId   = legacy.terminalId || legacy.terminal_id || randomUUID()
  const rawRole      = legacy.terminal_role || (legacy.kds_only ? 'kds' : 'server_pos')
  const role         = VALID_ROLES.includes(rawRole) ? rawRole : 'server_pos'
  const now          = new Date().toISOString()

  const migrated = {
    config_version:    CURRENT_CONFIG_VERSION,
    restaurant_id:     restaurantId,
    terminal_id:       terminalId,
    terminal_role:     role,
    terminal_name:     legacy.instanceName || legacy.terminal_name || `Terminal ${terminalId.slice(0, 8)}`,
    local_server_host: legacy.pos_server_ip || '127.0.0.1',
    local_server_port: 7717,
    protocol_version:  PROTOCOL_VERSION,
    provisioned_at:    now,
    last_validated_at: now,
    // Preserve pass-through fields
    client_id:      legacy.clientId || restaurantId,
    channel:        legacy.channel || 'stable',
    instance_name:  legacy.instanceName || null,
    kds:            legacy.kds || false,
    kds_only:       legacy.kds_only || false,
    pos_server_ip:  legacy.pos_server_ip || null,
    supabaseUrl:    legacy.supabaseUrl || null,
    supabaseAnonKey: legacy.supabaseAnonKey || null,
  }

  const { valid, errors } = validate(migrated)
  if (!valid) {
    console.warn('[config-schema] Migration produced invalid config:', errors)
    return null
  }
  return migrated
}

/**
 * Update last_validated_at on a valid config object (in-place mutation).
 * @param {TerminalConfig} config
 */
function touchValidatedAt(config) {
  config.last_validated_at = new Date().toISOString()
}

module.exports = {
  validate,
  fromLegacy,
  touchValidatedAt,
  VALID_ROLES,
  CURRENT_CONFIG_VERSION,
  PROTOCOL_VERSION,
}
