'use strict'
// ─── Preload script for the provisioning setup window ─────────────────────────
// Exposes a minimal IPC bridge so setup.html can communicate with the main process.
// Only provisioning-related channels are exposed — no POS functionality.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('setupBridge', {
  /** Get system info + any legacy config for pre-filling the wizard */
  getInfo: () => ipcRenderer.invoke('provision:get-info'),

  /** List only HID devices the user has already authorized for Fullsite. */
  getHidDevices: async () => {
    if (!navigator.hid || typeof navigator.hid.getDevices !== 'function') {
      return { supported: false, devices: [] }
    }
    try {
      const devices = await navigator.hid.getDevices()
      return {
        supported: true,
        devices: devices.map(device => ({
          productName: device.productName || 'Dispositivo HID',
          vendorId: device.vendorId,
          productId: device.productId,
          opened: !!device.opened,
        })),
      }
    } catch (error) {
      return { supported: true, devices: [], error: error.message }
    }
  },

  /**
   * Probe the local subnet (and 127.0.0.1) for Fullsite Local Servers.
   * Returns Array<{ host, port, restaurant_id, instance_name, version, protocol_version }>
   */
  scanLan: () => ipcRenderer.invoke('provision:scan-lan'),

  /**
   * Test connectivity to a specific host:port.
   * Returns { ok, restaurant_id, instance_name, version, protocol_version, error? }
   */
  testServer: (host, port) => ipcRenderer.invoke('provision:test-server', host, port),

  /**
   * Save the provisioned config to disk and relaunch the app.
   * @param {object} config — TerminalConfig object
   * @returns {{ ok: boolean, error?: string }}
   */
  save: (config) => ipcRenderer.invoke('provision:save', config),

  /**
   * Open a file picker to load a config.json backup from disk.
   * Returns { ok: true, config } or { ok: false, error } (error='canceled' if dismissed).
   */
  importConfig: () => ipcRenderer.invoke('provision:import-config'),

  // ── CFG-01: Printer configuration ──────────────────────────────────────────

  /** Load current printers config from disk (includes legacy v1 detection). */
  loadPrinters: () => ipcRenderer.invoke('provision:load-printers'),

  /**
   * Validate and atomically save a v2 printers config.
   * @param {{ schema_version: 2, printers: object[], routing: object }} config
   * @returns {{ ok: boolean, error?: string, path?: string }}
   */
  savePrinters: (config) => ipcRenderer.invoke('provision:save-printers', config),

  /**
   * Test TCP connectivity to a printer. USB/Windows printers return ok:null (untestable).
   * @param {{ type: string, host?: string, port?: number, names?: string[] }} connection
   * @returns {{ ok: boolean|null, message?: string, error?: string, code?: string }}
   */
  testPrinter: (connection) => ipcRenderer.invoke('provision:test-printer', connection),

  /**
   * Open a file picker to load a printers.json backup (v1 or v2).
   * Returns { ok: true, config, migrated } or { ok: false, error }.
   */
  importPrinters: () => ipcRenderer.invoke('provision:import-printers'),
})
