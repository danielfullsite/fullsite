#!/usr/bin/env node
/**
 * generate_terminal_config.mjs — Provisioning de terminales desde manifest
 * (gate R2-G04 / CLON-TERMINALS).
 *
 * Lee un manifest de cliente (scripts/manifests/*.json, sección §terminals y
 * §printers) y emite, por terminal, los artefactos de config que consumen las
 * apps Electron SIN editar código:
 *
 *   <outdir>/<terminal_id>/config.json    — TerminalConfig
 *       (contrato: electron-app/local-server/config-schema.js)
 *   <outdir>/<terminal_id>/printers.json  — Printer Config Schema v2, solo
 *       roles server_pos/pos (contrato:
 *       electron-app/local-server/adapters/printer-config-schema.js)
 *
 * Cada artefacto generado se valida contra el validador REAL del Electron app
 * (via createRequire) antes de escribirse: si el generador y la app divergen,
 * la generación falla en vez de producir una terminal NOT_PROVISIONED en campo.
 *
 * Determinismo: mismo manifest + mismo --provisioned-at ⇒ bytes idénticos.
 * Ningún UUID ni timestamp se genera dentro de la función pura.
 *
 * Uso:
 *   node scripts/manifests/generate_terminal_config.mjs <manifest.json> <outdir> [--provisioned-at ISO8601]
 *
 * Exit codes: 0 = artefactos generados y válidos · 1 = manifest inválido o
 * artefacto rechazado por los validadores del app.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateManifest, loadSchema } from './validate_manifest.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// Validadores reales de las apps Electron — única fuente de verdad del contrato.
const configSchema = require(join(HERE, '../../electron-app/local-server/config-schema.js'))
const printerConfigSchema = require(join(HERE, '../../electron-app/local-server/adapters/printer-config-schema.js'))

// Roles que corren el local-server con impresión (reciben printers.json)
const PRINTING_ROLES = new Set(['server_pos', 'pos'])

/**
 * Genera los artefactos de provisioning para todas las terminales del manifest.
 * Función pura: no toca disco, no genera UUIDs ni timestamps.
 *
 * @param {object} manifest — manifest de cliente ya parseado
 * @param {{ provisionedAt: string }} opts — timestamp ISO 8601 inyectado
 * @returns {{ ok: boolean, errors: string[], artifacts: Array<{terminal_id: string, files: Record<string, object>}> }}
 */
export function generateTerminalConfigs(manifest, opts = {}) {
  const errors = []
  const artifacts = []

  const { provisionedAt } = opts
  if (!provisionedAt || isNaN(Date.parse(provisionedAt))) {
    return { ok: false, errors: ['opts.provisionedAt debe ser un timestamp ISO 8601'], artifacts }
  }

  // 1. El manifest completo debe pasar el schema estricto (R2-G03)
  const schemaResult = validateManifest(manifest, loadSchema())
  if (!schemaResult.valid) {
    return { ok: false, errors: schemaResult.errors.map((e) => `manifest: ${e}`), artifacts }
  }

  const terminals = manifest.terminals
  if (!Array.isArray(terminals) || terminals.length === 0) {
    return { ok: false, errors: ['manifest sin sección "terminals" — nada que provisionar'], artifacts }
  }

  const printers = Array.isArray(manifest.printers) ? manifest.printers : []
  const printerIds = new Set(printers.map((p) => p.printer_id))
  const seenTerminalIds = new Set()

  for (const t of terminals) {
    // 2. Validaciones cruzadas que el JSON Schema no puede expresar
    if (seenTerminalIds.has(t.terminal_id)) {
      errors.push(`terminals: terminal_id "${t.terminal_id}" duplicado`)
      continue
    }
    seenTerminalIds.add(t.terminal_id)

    if (t.role === 'kds' && !t.pos_server_ip) {
      errors.push(`terminals[${t.terminal_id}]: role kds requiere pos_server_ip (IP LAN del server_pos)`)
      continue
    }
    for (const pid of t.printer_ids ?? []) {
      if (!printerIds.has(pid)) {
        errors.push(`terminals[${t.terminal_id}]: printer_ids referencia "${pid}" que no existe en manifest.printers`)
      }
    }
    if (PRINTING_ROLES.has(t.role) && printers.length === 0) {
      errors.push(`terminals[${t.terminal_id}]: role ${t.role} requiere sección "printers" en el manifest`)
      continue
    }

    // 3. TerminalConfig — espejo exacto de lo que valida config-schema.js
    const isKds = t.role === 'kds'
    const config = {
      config_version: configSchema.CURRENT_CONFIG_VERSION,
      restaurant_id: manifest.client_id,
      terminal_id: t.terminal_id,
      terminal_role: t.role,
      terminal_name: t.name,
      local_server_host: isKds ? t.pos_server_ip : '127.0.0.1',
      local_server_port: t.local_server_port ?? 7717,
      protocol_version: configSchema.PROTOCOL_VERSION,
      provisioned_at: provisionedAt,
      client_id: manifest.client_id,
      channel: t.channel ?? 'stable',
      instance_name: t.name,
      kds: t.kds ?? false,
      kds_only: isKds,
      pos_server_ip: isKds ? t.pos_server_ip : null,
    }

    const configCheck = configSchema.validate(config)
    if (!configCheck.valid) {
      errors.push(...configCheck.errors.map((e) => `terminals[${t.terminal_id}] config.json: ${e}`))
      continue
    }

    const files = { 'config.json': config }

    // 4. printers.json v2 — solo terminales que imprimen
    if (PRINTING_ROLES.has(t.role)) {
      const assigned = t.printer_ids
        ? printers.filter((p) => t.printer_ids.includes(p.printer_id))
        : printers

      const printersConfig = {
        schema_version: printerConfigSchema.SCHEMA_VERSION,
        printers: assigned.map((p) => ({
          printer_id: p.printer_id,
          name: p.name,
          enabled: p.enabled ?? true,
          connection: p.connection,
          station_ids: p.station_ids,
          document_types: p.document_types ?? [],
          copies: p.copies ?? 1,
          encoding: p.encoding ?? 'cp850',
        })),
        routing: { default_station: null },
      }

      const printersCheck = printerConfigSchema.validate(printersConfig)
      if (!printersCheck.valid) {
        errors.push(...printersCheck.errors.map((e) => `terminals[${t.terminal_id}] printers.json: ${e}`))
        continue
      }
      files['printers.json'] = printersConfig
    }

    artifacts.push({ terminal_id: t.terminal_id, files })
  }

  return { ok: errors.length === 0, errors, artifacts }
}

/** Serialización canónica — misma entrada, mismos bytes. */
export function serialize(obj) {
  return JSON.stringify(obj, null, 2) + '\n'
}

function main(argv) {
  const positional = argv.filter((a) => !a.startsWith('--'))
  const provisionedAtFlag = argv.find((a) => a.startsWith('--provisioned-at='))
  const [manifestPath, outDir] = positional

  if (!manifestPath || !outDir) {
    console.error('Uso: node generate_terminal_config.mjs <manifest.json> <outdir> [--provisioned-at=ISO8601]')
    return 1
  }

  let manifest
  try {
    manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'))
  } catch (e) {
    console.error(`✗ ${manifestPath}: JSON inválido — ${e.message}`)
    return 1
  }

  const provisionedAt = provisionedAtFlag
    ? provisionedAtFlag.split('=')[1]
    : new Date().toISOString()

  const { ok, errors, artifacts } = generateTerminalConfigs(manifest, { provisionedAt })
  if (!ok) {
    console.error(`✗ ${manifestPath}:`)
    for (const err of errors) console.error(`    ${err}`)
    return 1
  }

  for (const { terminal_id, files } of artifacts) {
    const dir = join(resolve(outDir), terminal_id)
    mkdirSync(dir, { recursive: true })
    for (const [filename, content] of Object.entries(files)) {
      writeFileSync(join(dir, filename), serialize(content))
      console.log(`✓ ${terminal_id}/${filename}`)
    }
  }
  console.log(`${artifacts.length} terminales provisionadas desde ${manifestPath}`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)))
}
