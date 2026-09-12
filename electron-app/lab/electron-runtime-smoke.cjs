'use strict'

// Local migration smoke: exercises APIs used by main.js in the installed
// Electron runtime. It opens no visible UI, signs nothing and publishes nothing.
const assert = require('node:assert/strict')
const { app, BrowserWindow } = require('electron')
const pkg = require('../package.json')

const timeout = setTimeout(() => {
  console.error('[electron-runtime-smoke] timed out')
  app.exit(1)
}, 15_000)

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  const consoleMessages = []
  window.webContents.on('console-message', event => { consoleMessages.push(event.message) })
  await window.loadURL('data:text/html,<meta http-equiv="Content-Security-Policy" content="default-src %27none%27; script-src %27unsafe-inline%27"><script>console.log("fullsite-runtime-ready")</script>')
  const printers = await window.webContents.getPrintersAsync()

  assert.equal(process.versions.electron, pkg.devDependencies.electron)
  assert.ok(consoleMessages.includes('fullsite-runtime-ready'))
  assert.ok(Array.isArray(printers))
  assert.ok(printers.every(printer => typeof printer.name === 'string'))

  console.log(JSON.stringify({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    console_event: true,
    printer_enumeration: true,
  }))
  window.destroy()
  clearTimeout(timeout)
  app.quit()
}).catch(error => {
  console.error(error)
  clearTimeout(timeout)
  app.exit(1)
})
