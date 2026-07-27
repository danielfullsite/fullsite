'use strict'
// ─── Printer Adapter (Windows — Phase 1) ─────────────────────────────────────
// Extracted from main.js. TCP and USB print routing.
// Future platforms (macOS, Linux): add an adapter that implements the same interface.
// The rest of the server calls printToStation() and kickDrawer() — never OS APIs directly.

const net  = require('net')
const fs   = require('fs')
const path = require('path')
const os   = require('os')
const { execSync } = require('child_process')

let _stations = {}
let _configPath = null
let _printJobsFailed = 0

// ─── Init ────────────────────────────────────────────────────────────────────

function init({ stations, configPath }) {
  _stations   = stations || {}
  _configPath = configPath || null
}

function getStations()        { return _stations }
function getPrintJobsFailed() { return _printJobsFailed }

function setStations(stations) {
  _stations = stations
  if (_configPath) {
    try { fs.writeFileSync(_configPath, JSON.stringify({ stations }, null, 2)) } catch {}
  }
}

// ─── TCP ────────────────────────────────────────────────────────────────────

function printTcp(host, port, data) {
  return new Promise((resolve, reject) => {
    const socket  = new net.Socket()
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error(`TCP timeout ${host}:${port}`)) }, 5000)
    socket.connect(port, host, () => {
      clearTimeout(timeout)
      socket.write(data, () => { socket.end(); resolve() })
    })
    socket.on('error', (err) => { clearTimeout(timeout); reject(err) })
  })
}

// ─── USB (Windows) ───────────────────────────────────────────────────────────

function printUsb(printerName, data) {
  const tmpFile = path.join(os.tmpdir(), `fs_print_${Date.now()}.bin`)
  try {
    fs.writeFileSync(tmpFile, data)
    try {
      execSync(`copy /b "${tmpFile}" "\\\\%COMPUTERNAME%\\${printerName}"`, {
        timeout: 5000, windowsHide: true, shell: 'cmd.exe',
      })
    } catch {
      execSync(
        `powershell -Command "Get-Content '${tmpFile}' -Encoding Byte -ReadCount 0 | Out-Printer '${printerName}'"`,
        { timeout: 8000, windowsHide: true }
      )
    }
  } finally {
    try { fs.unlinkSync(tmpFile) } catch {}
  }
}

// ─── Router ─────────────────────────────────────────────────────────────────

async function printToStation(station, data) {
  const cfg = _stations[station]
  if (!cfg) throw new Error(`Unknown station: ${station}. Available: ${Object.keys(_stations).join(', ')}`)

  const printers = Array.isArray(cfg) ? cfg : [cfg]
  const errors = []
  let succeeded = 0

  for (const printer of printers) {
    try {
      if (printer.type === 'usb') {
        const names = printer.names || (printer.name ? [printer.name] : [])
        let usbErr
        for (const name of names) {
          try { printUsb(name, data); usbErr = null; break } catch (e) { usbErr = e }
        }
        if (usbErr) throw usbErr
      } else {
        await printTcp(printer.host, printer.port, data)
      }
      succeeded++
    } catch (e) {
      errors.push({ printer, error: e.message })
      _printJobsFailed++
    }
  }

  if (succeeded === 0) {
    const msg = errors.map(e => e.error).join('; ')
    throw new Error(`All printers failed for ${station}: ${msg}`)
  }
}

// ESC/POS: kick cash drawer on pin 2
const DRAWER_KICK = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa])

async function kickDrawer() {
  await printToStation('caja', DRAWER_KICK)
}

// ─── Test ticket ────────────────────────────────────────────────────────────

function buildTestTicket(station, version) {
  const now = new Date().toLocaleString('es-MX', { timeZone: 'America/Monterrey' })
  return Buffer.from(
    '\x1b\x40\x1b\x61\x01\x1d\x21\x11FULLSITE LOCAL\n' +
    `\x1d\x21\x00\x1b\x61\x01--- TEST ---\n\n` +
    `\x1b\x61\x00Estacion: ${station}\nTerminal: ${os.hostname()}\n` +
    `Fecha: ${now}\nVersion: ${version}\n\n` +
    '\x1b\x61\x01Impresora OK\n\n\x1d\x56\x41\x03',
    'binary'
  )
}

module.exports = { init, getStations, setStations, getPrintJobsFailed, printToStation, kickDrawer, buildTestTicket }
