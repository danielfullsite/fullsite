'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { validate: validateTerminal } = require('../../electron-app/local-server/config-schema')
const { validate: validatePrinters } = require('../../electron-app/local-server/adapters/printer-config-schema')

const VALID_ROLES = new Set(['server_pos', 'pos', 'kds', 'admin'])
const REMOTE_ROLES = new Set(['pos', 'kds'])
const CLIENT_RE = /^[a-z0-9][a-z0-9_-]{1,39}$/i

function isIPv4(value) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(value || '')) return false
  return value.split('.').every(part => Number(part) >= 0 && Number(part) <= 255)
}

function slug(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 48)
}

function validateManifest(manifest) {
  const errors = []
  if (!manifest || typeof manifest !== 'object') return { valid: false, errors: ['Manifest must be an object'] }
  if (!CLIENT_RE.test(manifest.restaurant_id || '')) errors.push('restaurant_id must match /^[a-z0-9][a-z0-9_-]{1,39}$/i')
  if (!String(manifest.display_name || '').trim()) errors.push('display_name is required')
  if (!isIPv4(manifest.server_ip)) errors.push('server_ip must be a valid IPv4 address')
  if (!['stable', 'pilot', 'development'].includes(manifest.channel || 'stable')) errors.push('channel must be stable, pilot, or development')
  if (!Array.isArray(manifest.terminals) || manifest.terminals.length === 0) errors.push('terminals must be a non-empty array')

  const ids = new Set(); const names = new Set(); let servers = 0
  for (const [index, terminal] of (manifest.terminals || []).entries()) {
    const at = `terminals[${index}]`
    if (!VALID_ROLES.has(terminal.role)) errors.push(`${at}.role is invalid`)
    if (!String(terminal.name || '').trim()) errors.push(`${at}.name is required`)
    const nameKey = String(terminal.name || '').trim().toLowerCase()
    if (names.has(nameKey)) errors.push(`${at}.name is duplicate`); names.add(nameKey)
    if (terminal.terminal_id && ids.has(terminal.terminal_id)) errors.push(`${at}.terminal_id is duplicate`)
    if (terminal.terminal_id) ids.add(terminal.terminal_id)
    if (terminal.role === 'server_pos') servers++
  }
  if (servers !== 1) errors.push(`exactly one server_pos terminal is required (got ${servers})`)

  if (!manifest.printers) errors.push('printers is required (schema v2)')
  else {
    const printerResult = validatePrinters(manifest.printers)
    errors.push(...printerResult.errors.map(error => `printers: ${error}`))
  }
  return { valid: errors.length === 0, errors }
}

function terminalConfig(manifest, terminal, now) {
  const id = terminal.terminal_id || crypto.randomUUID()
  const role = terminal.role
  const config = {
    config_version: 1,
    restaurant_id: manifest.restaurant_id,
    terminal_id: id,
    terminal_role: role,
    terminal_name: terminal.name.trim(),
    local_server_host: role === 'server_pos' ? '127.0.0.1' : manifest.server_ip,
    local_server_port: 7717,
    protocol_version: '1.0',
    provisioned_at: now,
    client_id: manifest.restaurant_id,
    channel: manifest.channel || 'stable',
    instance_name: `${manifest.display_name} · ${terminal.name.trim()}`,
  }
  if (REMOTE_ROLES.has(role)) config.pos_server_ip = manifest.server_ip
  if (role === 'kds') config.kds_only = true
  if (role === 'server_pos' && terminal.kds === true) config.kds = true
  const result = validateTerminal(config)
  if (!result.valid) throw new Error(`Generated invalid config for ${terminal.name}: ${result.errors.join('; ')}`)
  return config
}

function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex') }

function writeJson(file, value) {
  const content = Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
  fs.writeFileSync(file, content, { flag: 'wx', mode: 0o600 })
  return { file: path.basename(file), sha256: sha256(content), bytes: content.length }
}

function smokePowerShell(manifest) {
  return `# Fullsite Golden Deployment Kit v1 — smoke test\n` +
`$ErrorActionPreference = "Stop"\n` +
`$Server = "http://${manifest.server_ip}:7717"\n` +
`Write-Host "[1/4] Pedro health..."\n` +
`$health = Invoke-RestMethod -Uri "$Server/health" -TimeoutSec 5\n` +
`if (-not $health.ok) { throw "Pedro /health returned not ok" }\n` +
`if ($health.restaurant_id -ne "${manifest.restaurant_id}") { throw "Wrong restaurant_id: $($health.restaurant_id)" }\n` +
`Write-Host "[2/4] Identity..."\n` +
`$identity = Invoke-RestMethod -Uri "$Server/identity" -TimeoutSec 5\n` +
`if ($identity.restaurant_id -ne "${manifest.restaurant_id}") { throw "Identity mismatch" }\n` +
`Write-Host "[3/4] State..."\n` +
`$state = Invoke-RestMethod -Uri "$Server/state" -TimeoutSec 5\n` +
`if ($null -eq $state.sequence) { throw "State has no sequence" }\n` +
`Write-Host "[4/4] Stations..."\n` +
`$expected = @(${manifest.printers.printers.flatMap(p => p.enabled ? p.station_ids : []).filter((v,i,a)=>a.indexOf(v)===i).map(x=>`"${x}"`).join(', ')})\n` +
`foreach ($station in $expected) { if ($health.stations -notcontains $station) { throw "Missing station: $station" } }\n` +
`Write-Host "PASS — ${manifest.display_name} / ${manifest.restaurant_id}" -ForegroundColor Green\n` +
`$health | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 "smoke-health-evidence.json"\n`
}

function installGuide(manifest, terminalEntries) {
  const rows = terminalEntries.map(entry => `| ${entry.name} | ${entry.role} | \`${entry.folder}\\config.json\` |`).join('\n')
  return `# ${manifest.display_name} — paquete de instalación\n\n` +
`**Restaurant ID:** \`${manifest.restaurant_id}\`  \n**Caja/Pedro:** \`${manifest.server_ip}:7717\`  \n**Canal:** \`${manifest.channel || 'stable'}\`\n\n` +
`## Archivos por terminal\n\n| Terminal | Rol | Config a importar |\n|---|---|---|\n${rows}\n\n` +
`## Procedimiento en sitio\n\n1. Reserva la IP ${manifest.server_ip} para la caja en el router.\n2. Instala Fullsite POS x64 en la caja e importa su config.json.\n3. Importa printers.json únicamente en la caja y prueba cada estación.\n4. Instala POS/KDS secundarios e importa el config.json de su carpeta.\n5. En la caja ejecuta PowerShell: \`powershell -ExecutionPolicy Bypass -File .\\smoke-test.ps1\`.\n6. Ejecuta una orden online y una con WAN apagada: mesa → producto → enviar → impresión → KDS.\n7. Reconecta y confirma cola a cero. Guarda los JSON de evidencia.\n\n` +
`## Reglas\n\n- No copies configs entre máquinas: cada terminal_id es único.\n- No edites restaurant_id, pos_server_ip o terminal_role en sitio. Regenera el paquete.\n- Este paquete no contiene contraseñas, PINs, service keys ni datos de huellas.\n- TeamViewer es soporte con WAN; la prueba offline se valida localmente.\n`
}

function generateKit(manifest, outputDir, options = {}) {
  const checked = validateManifest(manifest)
  if (!checked.valid) throw new Error(`Invalid deployment manifest:\n- ${checked.errors.join('\n- ')}`)
  if (fs.existsSync(outputDir)) throw new Error(`Output already exists: ${outputDir}`)
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 })
  const now = options.now || new Date().toISOString()
  const files = []; const terminalEntries = []

  for (const terminal of manifest.terminals) {
    const config = terminalConfig(manifest, terminal, now)
    const folder = `${String(manifest.terminals.indexOf(terminal) + 1).padStart(2, '0')}-${slug(terminal.name)}`
    const dir = path.join(outputDir, folder); fs.mkdirSync(dir, { mode: 0o700 })
    const saved = writeJson(path.join(dir, 'config.json'), config)
    files.push({ path: `${folder}/${saved.file}`, sha256: saved.sha256, bytes: saved.bytes })
    terminalEntries.push({ name: terminal.name, role: terminal.role, terminal_id: config.terminal_id, folder })
    if (terminal.role === 'server_pos') {
      const printers = writeJson(path.join(dir, 'printers.json'), manifest.printers)
      files.push({ path: `${folder}/${printers.file}`, sha256: printers.sha256, bytes: printers.bytes })
    }
  }

  const smoke = Buffer.from(smokePowerShell(manifest)); fs.writeFileSync(path.join(outputDir, 'smoke-test.ps1'), smoke, { flag: 'wx', mode: 0o600 })
  files.push({ path: 'smoke-test.ps1', sha256: sha256(smoke), bytes: smoke.length })
  const guide = Buffer.from(installGuide(manifest, terminalEntries)); fs.writeFileSync(path.join(outputDir, 'INSTALL.md'), guide, { flag: 'wx', mode: 0o600 })
  files.push({ path: 'INSTALL.md', sha256: sha256(guide), bytes: guide.length })
  const packageManifest = {
    kit_version: '1.0', generated_at: now, restaurant_id: manifest.restaurant_id,
    display_name: manifest.display_name, server_ip: manifest.server_ip,
    channel: manifest.channel || 'stable', terminals: terminalEntries, files,
  }
  writeJson(path.join(outputDir, 'package-manifest.json'), packageManifest)
  return packageManifest
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--manifest') args.manifest = argv[++i]
    else if (argv[i] === '--out') args.out = argv[++i]
    else if (argv[i] === '--validate-only') args.validateOnly = true
    else throw new Error(`Unknown argument: ${argv[i]}`)
  }
  if (!args.manifest) throw new Error('Usage: node generate-kit.js --manifest <deployment.json> [--out <dir>] [--validate-only]')
  return args
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2))
    const manifestPath = path.resolve(args.manifest)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const result = validateManifest(manifest)
    if (!result.valid) throw new Error(`Invalid deployment manifest:\n- ${result.errors.join('\n- ')}`)
    if (args.validateOnly) { console.log(`VALID — ${manifest.restaurant_id}`); process.exit(0) }
    const out = path.resolve(args.out || path.join(process.cwd(), 'deployment-packages', `${manifest.restaurant_id}-${Date.now()}`))
    const generated = generateKit(manifest, out)
    console.log(`GENERATED — ${generated.terminals.length} terminal(s) — ${out}`)
  } catch (error) { console.error(`ERROR — ${error.message}`); process.exit(1) }
}

module.exports = { generateKit, validateManifest, terminalConfig, isIPv4, slug }
