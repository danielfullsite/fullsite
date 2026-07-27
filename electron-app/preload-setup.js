'use strict'
// ─── Preload script for the provisioning setup window ─────────────────────────
// Exposes a minimal IPC bridge so setup.html can communicate with the main process.
// Only provisioning-related channels are exposed — no POS functionality.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('setupBridge', {
  /** Get system info + any legacy config for pre-filling the wizard */
  getInfo: () => ipcRenderer.invoke('provision:get-info'),

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
})
