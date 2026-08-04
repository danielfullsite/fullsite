'use strict'
// ─── Process Adapter ──────────────────────────────────────────────────────────
// Resolves platform-specific paths and system info.
// The local server never accesses C:\fullsite directly — it calls these functions.
//
// Priority for dataDir:
//  1. dataDir passed into init() from Electron (app.getPath('userData'))
//  2. FULLSITE_DATA_DIR env var (dev/support override)
//  3. ~/.fullsite/local-server (standalone fallback)

const path = require('path')
const fs   = require('fs')
const os   = require('os')

let _dataDir = null

function init({ dataDir } = {}) {
  _dataDir = dataDir
    || process.env.FULLSITE_DATA_DIR
    || path.join(os.homedir(), '.fullsite', 'local-server')

  fs.mkdirSync(_dataDir, { recursive: true })
}

function getDataDir() {
  if (!_dataDir) throw new Error('process adapter not initialized — call init() first')
  return _dataDir
}

function getEventLogPath() {
  return path.join(getDataDir(), 'events.ndjson')
}

function getProcessedCommandsPath() {
  return path.join(getDataDir(), 'processed-commands.ndjson')
}

function getConfigPath() {
  // Config is read by Electron (main.js) from C:\fullsite\config.json.
  // The local server receives its config via init(), not by reading the file directly.
  // This path is provided only for diagnostic endpoints.
  return path.join(getDataDir(), 'server-config.json')
}

function getPlatform() {
  return process.platform // 'win32' | 'darwin' | 'linux'
}

function getVersion() {
  try {
    const pkg = require(path.join(__dirname, '../../package.json'))
    return pkg.version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function getHostname() {
  return os.hostname()
}

function getDiskFreeMb() {
  try {
    // fs.statfsSync available in Node 19+; fall back to undefined for older runtimes
    const stats = fs.statfsSync ? fs.statfsSync(getDataDir()) : null
    if (!stats) return null
    return Math.floor((stats.bfree * stats.bsize) / (1024 * 1024))
  } catch {
    return null
  }
}

function getLogDir() {
  return path.join(getDataDir(), 'logs')
}

module.exports = { init, getDataDir, getEventLogPath, getProcessedCommandsPath, getConfigPath, getLogDir, getPlatform, getVersion, getHostname, getDiskFreeMb }
