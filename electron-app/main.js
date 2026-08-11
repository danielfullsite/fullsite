const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const os   = require('os');
const fs   = require('fs');
const { execSync } = require('child_process');

// UI source URLs. Default = cloud (unchanged). When LOCAL_UI is enabled
// (config.local_ui or env FULLSITE_LOCAL_UI=1), resolveUiUrls() rewrites these
// to the local bridge so the POS opens offline and LAN clients avoid the
// mixed-content wall. See docs/architecture/OFFLINE-SHELL-001.md.
let POS_URL = 'https://app.fullsite.mx/pos';
let KDS_URL = 'https://app.fullsite.mx/kds';

// ─── Offline Shell (OFFLINE-SHELL-001) ────────────────────────────────────────
function isLocalUiEnabled() {
  return appConfig?.local_ui === true
    || String(appConfig?.local_ui ?? '') === '1'
    || process.env.FULLSITE_LOCAL_UI === '1';
}

// Point POS_URL/KDS_URL at the LAN bridge that serves the static bundle.
// Server (CAJA): its own 127.0.0.1. Secondary terminal / KDS: pos_server_ip.
function resolveUiUrls() {
  if (!isLocalUiEnabled()) return; // keep cloud defaults — zero change
  const host = appConfig?.pos_server_ip || '127.0.0.1';
  POS_URL = `http://${host}:${LOCAL_SERVER_PORT}/pos`;
  KDS_URL = `http://${host}:${LOCAL_SERVER_PORT}/kds`;
  console.log(`[main] LOCAL_UI on → UI served from ${POS_URL}`);
}

// Absolute path to the bundled Next export (dashboard-app/out). undefined when
// LOCAL_UI is off or the bundle is absent → the bridge won't serve static and
// cloud loading stays the default.
function resolveStaticRoot() {
  if (!isLocalUiEnabled()) return undefined;
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'out') : null, // packaged
    path.join(__dirname, '..', 'dashboard-app', 'out'),                     // dev / monorepo
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(path.join(c, 'pos.html'))) return c; } catch { /* ignore */ }
  }
  console.warn('[main] LOCAL_UI on but no out/ bundle found — bridge will not serve UI.');
  return undefined;
}

// ─── LOCAL SERVER ─────────────────────────────────────────────────────────────
// Fullsite Local Server (WS hub + print bridge + mDNS + heartbeat).
// Runs inside the Electron main process — no separate Node.js process needed.
// Replaces the previous embedded print bridge.

const LOCAL_SERVER_PORT   = 7717;
const LEGACY_CONFIG_PATH  = path.join('C:\\fullsite', 'config.json');
// CFG-01: printers config lives in Electron userData (same as config.json),
// with C:\fullsite\ as a read-only migration source only.
// There are NO default stations — absence of config = PRINTER_NOT_CONFIGURED.

// ─── CONFIG SCHEMA (CFG-02) ───────────────────────────────────────────────────
// All terminals must have a validated TerminalConfig before operational use.
// An invalid or missing config puts the terminal in NOT_PROVISIONED state,
// blocking the Local Server, POS, and KDS from starting.
const configSchema        = require('./local-server/config-schema');
const printerConfigSchema = require('./local-server/adapters/printer-config-schema');
const logger              = require('./local-server/logger');

/**
 * Return the primary config path: userData first (writable by Electron),
 * legacy C:\fullsite\ as fallback (read-only on some Windows installs).
 */
function getPrimaryConfigPath() {
  // After app.whenReady(), app.getPath('userData') is available.
  try { return path.join(app.getPath('userData'), 'config.json'); } catch { return LEGACY_CONFIG_PATH; }
}

/**
 * Load, validate, and optionally auto-migrate the terminal config.
 * Returns { valid, config, migrated, errors, sourcePath }.
 *
 * Migration strategy for existing AMALAY installs:
 *   1. Try primary path (userData/config.json) — new schema
 *   2. Try legacy path (C:\fullsite\config.json) — old schema
 *   3. If legacy has a usable restaurantId → auto-migrate to new schema
 *   4. If nothing works → NOT_PROVISIONED
 */
function loadAndValidateConfig() {
  const primaryPath = getPrimaryConfigPath();

  // 1. Try primary (new schema)
  try {
    if (fs.existsSync(primaryPath)) {
      const data = JSON.parse(fs.readFileSync(primaryPath, 'utf8'));
      const { valid, errors } = configSchema.validate(data);
      if (valid) {
        console.log('[config] Valid config loaded from', primaryPath);
        configSchema.touchValidatedAt(data);
        return { valid: true, config: data, migrated: false, errors: [], sourcePath: primaryPath };
      }
      console.warn('[config] Primary config invalid:', errors);
    }
  } catch (e) {
    console.warn('[config] Error reading primary config:', e.message);
  }

  // 2. Try legacy path
  let legacy = null;
  try {
    if (fs.existsSync(LEGACY_CONFIG_PATH)) {
      legacy = JSON.parse(fs.readFileSync(LEGACY_CONFIG_PATH, 'utf8'));
      console.log('[config] Legacy config found at', LEGACY_CONFIG_PATH);

      // 2a. If legacy is already new schema (migrated manually), validate it
      const { valid, errors } = configSchema.validate(legacy);
      if (valid) {
        console.log('[config] Legacy config is already valid new schema');
        return { valid: true, config: legacy, migrated: false, errors: [], sourcePath: LEGACY_CONFIG_PATH };
      }

      // 2b. Auto-migrate legacy to new schema
      const migrated = configSchema.fromLegacy(legacy);
      if (migrated) {
        console.log('[config] Auto-migrated legacy config:', JSON.stringify({ restaurant_id: migrated.restaurant_id, terminal_id: migrated.terminal_id }));
        // Save migrated config to primary path so future boots use it
        try {
          fs.mkdirSync(path.dirname(primaryPath), { recursive: true });
          fs.writeFileSync(primaryPath, JSON.stringify(migrated, null, 2), 'utf8');
          console.log('[config] Migrated config saved to', primaryPath);
        } catch (e2) {
          console.warn('[config] Could not save migrated config:', e2.message);
        }
        return { valid: true, config: migrated, migrated: true, errors: [], sourcePath: primaryPath };
      }
      console.warn('[config] Legacy config could not be migrated (missing restaurantId)');
    }
  } catch (e) {
    console.warn('[config] Error reading legacy config:', e.message);
  }

  // 3. NOT_PROVISIONED
  return {
    valid: false,
    config: null,
    migrated: false,
    errors: legacy ? ['Legacy config found but lacks a valid restaurant_id'] : ['No config.json found'],
    sourcePath: primaryPath,
    legacy,
  };
}

/**
 * Return the path where printers.json is stored for this installation.
 * Primary: Electron userData (writable, per-install)
 * Legacy migration source: C:\fullsite\printers.json (read-only fallback)
 */
function getPrinterConfigPath() {
  try { return path.join(app.getPath('userData'), 'printers.json'); } catch { return null; }
}
const LEGACY_PRINTERS_PATH = path.join('C:\\fullsite', 'printers.json');

/**
 * CFG-01: Load printer config from disk. Never uses hardcoded defaults.
 *
 * Strategy:
 *   1. Try userData/printers.json (primary, writable)
 *   2. Try C:\fullsite\printers.json (legacy AMALAY install — auto-migrate v1→v2)
 *   3. No config → { state: 'not_configured' }
 *
 * Returns { state, config, migrated, errors, sourcePath }
 * state: 'configured' | 'not_configured' | 'invalid'
 */
function loadPrinters() {
  const primaryPath = getPrinterConfigPath();

  // 1. Try primary path
  if (primaryPath) {
    try {
      if (fs.existsSync(primaryPath)) {
        const raw = JSON.parse(fs.readFileSync(primaryPath, 'utf8'));
        const result = printerConfigSchema.loadAndValidate(raw);
        if (result.valid) {
          if (result.migrated) {
            try { fs.writeFileSync(primaryPath, JSON.stringify(result.config, null, 2)); } catch {}
            console.log('[config] Printers: auto-migrated v1→v2 and saved to', primaryPath);
          } else {
            console.log('[config] Printers: loaded v2 config from', primaryPath);
          }
          return { state: 'configured', config: result.config, migrated: result.migrated, errors: [], sourcePath: primaryPath };
        }
        console.warn('[config] Printers: invalid config at', primaryPath, result.errors);
        return { state: 'invalid', config: null, migrated: false, errors: result.errors, sourcePath: primaryPath };
      }
    } catch (e) {
      console.warn('[config] Printers: error reading', primaryPath, e.message);
    }
  }

  // 2. Try legacy path (AMALAY v1 migration source)
  try {
    if (fs.existsSync(LEGACY_PRINTERS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(LEGACY_PRINTERS_PATH, 'utf8'));
      const result = printerConfigSchema.loadAndValidate(raw);
      if (result.valid) {
        // Save migrated config to primary path so future boots skip legacy
        if (primaryPath) {
          try {
            fs.mkdirSync(path.dirname(primaryPath), { recursive: true });
            fs.writeFileSync(primaryPath, JSON.stringify(result.config, null, 2));
            console.log('[config] Printers: migrated legacy config to', primaryPath);
          } catch (e2) {
            console.warn('[config] Printers: could not save migrated config:', e2.message);
          }
        }
        return { state: 'configured', config: result.config, migrated: true, errors: [], sourcePath: LEGACY_PRINTERS_PATH };
      }
      console.warn('[config] Printers: legacy printers.json invalid:', result.errors);
    }
  } catch (e) {
    console.warn('[config] Printers: error reading legacy path:', e.message);
  }

  // 3. No config found — PRINTER_NOT_CONFIGURED
  // CFG-01: do NOT fall back to hardcoded IPs. The absence of configuration
  // must be visible and recoverable, not silently wrong.
  console.log('[config] Printers: no printers.json found — PRINTER_NOT_CONFIGURED state. Use the setup wizard to configure printers.');
  return { state: 'not_configured', config: null, migrated: false, errors: ['No printers.json found'], sourcePath: primaryPath };
}

// Validated config — set in app.whenReady() after provisioning check.
let appConfig = {};
let localServer = null; // { httpServer, close, serverId, lanIp, wsHub }

/**
 * Start the Local Server.
 * Requires appConfig to have a valid restaurant_id — will throw if not provisioned.
 */
async function startLocalServer() {
  const restaurantId = appConfig.restaurant_id || appConfig.restaurantId || appConfig.clientId || appConfig.client_id;
  if (!restaurantId || restaurantId === 'unknown') {
    throw new Error('[CFG-02] Cannot start Local Server: restaurant_id is missing or "unknown". Run the provisioning wizard.');
  }

  const { startLocalServer: start } = require('./local-server');
  const dataDir = app.getPath('userData');
  const printersResult = loadPrinters();
  const printerConfigPath = getPrinterConfigPath();
  const queueFilePath = path.join(dataDir, 'print-queue.json');

  if (printersResult.state === 'not_configured') {
    console.warn('[main] PRINTER_NOT_CONFIGURED — printing will fail safely until configured via wizard.');
  } else if (printersResult.state === 'invalid') {
    console.warn('[main] Printer config invalid:', printersResult.errors);
  }

  const cfg = {
    restaurantId,
    channel:            appConfig.channel        || process.env.FULLSITE_CHANNEL    || 'stable',
    instanceName:       appConfig.instance_name  || appConfig.instanceName          || `Fullsite POS — ${os.hostname()}`,
    supabaseUrl:        appConfig.supabaseUrl    || process.env.SUPABASE_URL        || '',
    supabaseKey:        appConfig.supabaseAnonKey || process.env.SUPABASE_ANON_KEY  || '',
    printersConfig:     printersResult.config,    // null when not_configured — adapter handles safely
    printerConfigPath,
    queueFilePath,
    clientId:           appConfig.client_id      || appConfig.clientId,
    terminalId:         appConfig.terminal_id    || appConfig.terminalId,
    staticRoot:         resolveStaticRoot(),      // Offline Shell: bridge serves out/ when LOCAL_UI on
  };

  try {
    localServer = await start({ dataDir, port: LOCAL_SERVER_PORT, config: cfg });
    console.log('[main] Local server started.');
  } catch (e) {
    if (e.code === 'EADDRINUSE') {
      console.log('[main] Port 7717 already in use — another server running, skipping.');
    } else {
      console.error('[main] Local server failed to start:', e.message);
    }
  }
}

// ─── IPC: Provisioning handlers ──────────────────────────────────────────────

function registerProvisioningIpc() {
  const { randomUUID } = require('crypto');

  /** Return system info + any legacy config raw data for the wizard. */
  ipcMain.handle('provision:get-info', () => {
    let legacy = null;
    try {
      if (fs.existsSync(LEGACY_CONFIG_PATH)) legacy = JSON.parse(fs.readFileSync(LEGACY_CONFIG_PATH, 'utf8'));
    } catch {}
    return {
      hostname: os.hostname(),
      platform: process.platform,
      legacy,
      schemaConstants: { MAX_PRINTER_ID_LENGTH: printerConfigSchema.MAX_PRINTER_ID_LENGTH },
    };
  });

  /**
   * Probe the local subnet for Fullsite Local Servers.
   * Returns Array<{ host, port, restaurant_id, instance_name, version, protocol_version }>.
   */
  ipcMain.handle('provision:scan-lan', async () => {
    const interfaces = os.networkInterfaces();
    const subnets = new Set(['127.0.0.1']);
    for (const iface of Object.values(interfaces)) {
      for (const addr of iface) {
        if (addr.family === 'IPv4' && !addr.internal) {
          // Extract the subnet and probe .1–.254
          const parts = addr.address.split('.');
          const base = parts.slice(0, 3).join('.');
          for (let i = 1; i <= 254; i++) subnets.add(`${base}.${i}`);
        }
      }
    }
    const results = [];
    const probes = [...subnets].map(ip => new Promise(resolve => {
      const req = http.get(`http://${ip}:${LOCAL_SERVER_PORT}/state`, { timeout: 500 }, res => {
        let body = '';
        res.on('data', d => { body += d; if (body.length > 4096) req.destroy(); });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.server_id || data.restaurant_id) {
              results.push({
                host:             ip,
                port:             LOCAL_SERVER_PORT,
                restaurant_id:    data.restaurant_id || null,
                instance_name:    data.instance_name || null,
                version:          data.version       || null,
                protocol_version: data.protocol_version || null,
              });
            }
          } catch {}
          resolve();
        });
      });
      req.on('error', () => resolve());
      req.on('timeout', () => { req.destroy(); resolve(); });
    }));
    await Promise.all(probes);
    return results;
  });

  /** Test connectivity to a specific host:port. */
  ipcMain.handle('provision:test-server', async (_, host, port) => {
    const p = port || LOCAL_SERVER_PORT;
    return new Promise(resolve => {
      const req = http.get(`http://${host}:${p}/state`, { timeout: 3000 }, res => {
        let body = '';
        res.on('data', d => { body += d; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve({
              ok:               true,
              restaurant_id:    data.restaurant_id    || null,
              instance_name:    data.instance_name    || null,
              version:          data.version          || null,
              protocol_version: data.protocol_version || null,
              protocol_ok:      data.protocol_version === configSchema.PROTOCOL_VERSION,
              ws_ok:            true, // HTTP probe succeeded = WS likely available
            });
          } catch {
            resolve({ ok: false, error: 'Invalid response from server' });
          }
        });
      });
      req.on('error', e => resolve({ ok: false, error: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }); });
    });
  });

  /**
   * Reset this terminal to NOT_PROVISIONED (reprovisioning flow).
   * Backs up the current config then deletes it, then relaunches into the wizard.
   * Called from the running POS via window.fullsiteApp.startProvisioning().
   */
  ipcMain.handle('provision:reset', async () => {
    const primaryPath = getPrimaryConfigPath()
    try {
      if (fs.existsSync(primaryPath)) {
        const backup = primaryPath.replace('.json', `.reset-${Date.now()}.json`)
        try { fs.copyFileSync(primaryPath, backup) } catch {}
        fs.unlinkSync(primaryPath)
        console.log('[provision] Config deleted for reprovisioning. Backup at', backup)
      }
      setTimeout(() => { app.relaunch(); app.exit(0); }, 500)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  /**
   * Open a file picker and load a config JSON from a backup file.
   * Returns { ok, config } on success or { ok: false, error } on failure.
   * Used by setup.html "Importar desde respaldo" button.
   */
  ipcMain.handle('provision:import-config', async () => {
    const { dialog } = require('electron')
    const result = await dialog.showOpenDialog({
      title: 'Seleccionar respaldo de configuración',
      filters: [{ name: 'Configuración Fullsite', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths.length) return { ok: false, error: 'canceled' }
    try {
      const data = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'))
      const { valid, errors } = configSchema.validate(data)
      if (!valid) return { ok: false, error: errors.join('; '), data }
      return { ok: true, config: data }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  // ── CFG-01: Printer configuration IPC ──────────────────────────────────────

  /** Load current printers.json state (includes legacy v1 detection for UI banner). */
  ipcMain.handle('provision:load-printers', () => {
    const result = loadPrinters()
    // Also surface raw v1 data if the file exists but wasn't auto-migrated
    let legacyV1 = null
    try {
      if (fs.existsSync(LEGACY_PRINTERS_PATH)) {
        const raw = JSON.parse(fs.readFileSync(LEGACY_PRINTERS_PATH, 'utf8'))
        if (!raw.schema_version || raw.schema_version < 2) legacyV1 = raw
      }
    } catch {}
    return { ...result, legacyV1 }
  })

  /**
   * Validate and atomically save a v2 printers config.
   *
   * Flow:
   *   1. validate(memory)   — fail fast, no disk I/O
   *   2. write tmp          — original configPath untouched
   *   3. validate(tmp)      — protective pre-rename check; on failure: unlink tmp, return error
   *   4. rename(tmp→path)   — point of no return; content already verified in step 3
   *   5. read(path)         — observability only; no rollback on failure
   */
  ipcMain.handle('provision:save-printers', async (_, config) => {
    // Step 1 — in-memory validation
    const { valid, errors } = printerConfigSchema.validate(config)
    if (!valid) return { ok: false, error: errors.join('; ') }

    const configPath = getPrinterConfigPath()
    if (!configPath) return { ok: false, error: 'No se puede determinar la ruta de configuración.' }

    const tmpPath = configPath + '.tmp'
    try {
      // Step 2 — write to tmp (configPath not yet touched)
      fs.mkdirSync(path.dirname(configPath), { recursive: true })
      fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf8')

      // Step 3 — validate tmp from disk before rename (protective)
      let preRead
      try {
        preRead = JSON.parse(fs.readFileSync(tmpPath, 'utf8'))
      } catch (e) {
        try { fs.unlinkSync(tmpPath) } catch {}
        return { ok: false, error: 'Pre-rename read-back failed: ' + e.message }
      }
      const { valid: preValid, errors: preErrors } = printerConfigSchema.validate(preRead)
      if (!preValid) {
        try { fs.unlinkSync(tmpPath) } catch {}
        return { ok: false, error: 'Pre-rename validation failed: ' + preErrors.join('; ') }
      }

      // Step 4 — atomic rename; content already verified in step 3
      fs.renameSync(tmpPath, configPath)

      // Step 5 — post-rename observability only; no rollback
      try {
        const canonical = JSON.parse(fs.readFileSync(configPath, 'utf8'))
        if (canonical.schema_version !== 2) {
          console.error('[provision] CRITICAL: post-rename schema_version mismatch — filesystem anomaly suspected at', configPath)
        } else {
          console.log('[provision] Printers saved to', configPath)
        }
      } catch (e) {
        console.error('[provision] CRITICAL: post-rename read failed (filesystem anomaly):', e.message)
      }

      return { ok: true, path: configPath }
    } catch (e) {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath) } catch {}
      return { ok: false, error: e.message }
    }
  })

  /**
   * Test TCP connectivity to a printer connection.
   * USB/Windows printers return ok:null — they can't be probed without printing.
   */
  ipcMain.handle('provision:test-printer', async (_, connection) => {
    if (!connection) return { ok: false, error: 'Sin datos de conexión.', code: 'NO_CONNECTION' }

    if (connection.type !== 'tcp') {
      return {
        ok:      null,
        message: 'Las impresoras Windows/USB no pueden probarse sin imprimir. Guarda y usa "Imprimir prueba" desde el POS.',
        code:    'UNTESTABLE',
      }
    }

    const { host, port } = connection
    if (!host) return { ok: false, error: 'Host requerido.', code: 'INVALID_HOST' }
    const p = Number(port)
    if (!p || p < 1 || p > 65535) return { ok: false, error: 'Puerto inválido.', code: 'INVALID_PORT' }

    const net = require('net')
    return new Promise(resolve => {
      const socket  = new net.Socket()
      const timeout = setTimeout(() => {
        socket.destroy()
        resolve({ ok: false, error: `Timeout conectando a ${host}:${p}`, code: 'TIMEOUT' })
      }, 4000)

      socket.connect(p, host, () => {
        clearTimeout(timeout)
        socket.destroy()
        resolve({ ok: true, message: `Conexión exitosa a ${host}:${p}` })
      })

      socket.on('error', e => {
        clearTimeout(timeout)
        const code = e.code === 'ECONNREFUSED' ? 'PORT_CLOSED'
                   : e.code === 'ENOTFOUND'    ? 'HOST_NOT_FOUND'
                   : e.code === 'ENETUNREACH'  ? 'NETWORK_UNREACHABLE'
                   : 'UNKNOWN'
        resolve({ ok: false, error: e.message, code })
      })
    })
  })

  /** Import a printers.json backup (v1 or v2) via file dialog. */
  ipcMain.handle('provision:import-printers', async () => {
    const { dialog } = require('electron')
    const result = await dialog.showOpenDialog({
      title:      'Seleccionar respaldo de impresoras',
      filters:    [{ name: 'Configuración de Impresoras', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths.length) return { ok: false, error: 'canceled' }
    try {
      const raw       = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'))
      const validated = printerConfigSchema.loadAndValidate(raw)
      if (!validated.valid) return { ok: false, error: validated.errors.join('; ') }
      return { ok: true, config: validated.config, migrated: validated.migrated }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  /**
   * Validate and save the provisioned config, then relaunch the app.
   */
  ipcMain.handle('provision:save', async (_, config) => {
    const { valid, errors } = configSchema.validate(config);
    if (!valid) return { ok: false, error: errors.join('; ') };
    const primaryPath = getPrimaryConfigPath();
    try {
      // Backup the old config if it exists
      if (fs.existsSync(primaryPath)) {
        const backup = primaryPath.replace('.json', `.backup-${Date.now()}.json`);
        try { fs.copyFileSync(primaryPath, backup); } catch {}
      }
      fs.mkdirSync(path.dirname(primaryPath), { recursive: true });
      fs.writeFileSync(primaryPath, JSON.stringify(config, null, 2), 'utf8');
      console.log('[provision] Config saved to', primaryPath);
      // Relaunch after a short delay so the renderer can show the success state
      setTimeout(() => { app.relaunch(); app.exit(0); }, 1200);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

// ─── FINGERPRINT SERVICE (embedded) ───────────────────────────────────────
// Spawns fingerprint-service.exe as a child process. The exe + DPUruNet.dll
// must be in C:\fullsite\ on each terminal.

const { spawn } = require('child_process');
let fingerprintProcess = null;
let fingerprintRestartCount = 0;

function startFingerprintService() {
  const fpExe = 'C:\\fullsite\\fingerprint-service.exe';
  const fpDll = 'C:\\fullsite\\DPUruNet.dll';

  // Check if files exist
  if (!fs.existsSync(fpExe) || !fs.existsSync(fpDll)) {
    console.log('[fingerprint] fingerprint-service.exe or DPUruNet.dll not found in C:\\fullsite\\');
    console.log('[fingerprint] Fingerprint login will not be available');
    return;
  }

  // Check if already running on port 7718
  const testReq = http.get('http://127.0.0.1:7718/health', (res) => {
    if (res.statusCode === 200) {
      console.log('[fingerprint] Service already running on port 7718');
    }
  });
  testReq.on('error', () => {
    // Not running, start it
    console.log('[fingerprint] Starting fingerprint-service.exe...');
    fingerprintProcess = spawn(fpExe, [], {
      cwd: 'C:\\fullsite',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    fingerprintProcess.stdout.on('data', (data) => {
      console.log('[fingerprint] ' + data.toString().trim());
    });
    fingerprintProcess.stderr.on('data', (data) => {
      console.error('[fingerprint] ' + data.toString().trim());
    });
    fingerprintProcess.on('exit', (code) => {
      console.log('[fingerprint] Service exited with code ' + code);
      fingerprintProcess = null;
      if (code !== 0 && fingerprintRestartCount < 5) {
        fingerprintRestartCount++;
        console.log('[fingerprint] Restarting... attempt ' + fingerprintRestartCount + '/5');
        setTimeout(startFingerprintService, 3000);
      } else if (code === 0) {
        fingerprintRestartCount = 0;
      }
    });
  });
  testReq.setTimeout(1000, () => testReq.destroy());
}

// ─── MAIN WINDOW ──────────────────────────────────────────────────────────

let mainWindow = null;
let kdsWindow = null;
let allowClose = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Fullsite POS',
    icon: path.join(__dirname, 'icon.png'),
    kiosk: true,
    fullscreen: true,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  mainWindow.setMenu(null);
  mainWindow.loadURL(POS_URL);

  // Save last successful boot time for offline.html display
  mainWindow.webContents.on('did-finish-load', () => {
    loadFailCount = 0; // Reset on successful load
    const bootTime = new Date().toISOString();
    const scripts = [`localStorage.setItem('pos_last_boot', ${JSON.stringify(bootTime)})`];
    // Inject validated identity from provisioned config into localStorage.
    // Both new schema keys (restaurant_id, terminal_id) and legacy keys (clientId, terminalId) are supported.
    const clientId   = (appConfig.restaurant_id || appConfig.client_id   || appConfig.restaurantId || appConfig.clientId || '').toLowerCase().trim();
    const terminalId = appConfig.terminal_id   || appConfig.terminalId;
    if (clientId) {
      scripts.push(`localStorage.setItem('fullsite_client_id', ${JSON.stringify(String(clientId))})`);
    }
    if (terminalId) {
      scripts.push(`localStorage.setItem('pos_terminal_id', ${JSON.stringify(String(terminalId))})`);
    }
    mainWindow.webContents.executeJavaScript(scripts.join('; ')).catch(() => {});
  });

  // Listen for IPC from renderer (via preload bridge)
  ipcMain.on('app-quit', () => { allowClose = true; app.quit(); });
  ipcMain.on('exit-kiosk', () => {
    if (mainWindow) { mainWindow.setKiosk(false); mainWindow.setFullScreen(false); }
  });
  ipcMain.on('enter-kiosk', () => {
    if (mainWindow) { mainWindow.setKiosk(true); mainWindow.setFullScreen(true); }
  });

  // Retry counter for offline SW activation timing.
  // When offline, DNS fails immediately and did-fail-load fires before the SW
  // activates from the previous session. Retrying 2-3 times gives the SW time
  // to activate and serve /pos from cache without network.
  let loadFailCount = 0;
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDesc) => {
    if (errorCode === -3) return; // ERR_ABORTED: SW or redirect intercepted — not a real failure

    // If the device is definitively offline, skip retries — offline.html handles recovery.
    // net.online mirrors navigator.onLine: false = no network interface at all.
    const { net } = require('electron');
    if (!net.online) {
      console.log(`[main] Device offline (${errorCode}) → loading offline.html immediately`);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadFile('offline.html', { query: { target: POS_URL } });
      return;
    }

    // Online but slow / transient failure — retry with progressive backoff
    loadFailCount++;
    console.error(`[main] Load failed (${loadFailCount}): ${errorCode} ${errorDesc}`);
    if (loadFailCount <= 3) {
      // Give SW progressively more time to activate from the previous session
      setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(POS_URL); }, loadFailCount * 800);
    } else {
      loadFailCount = 0;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadFile('offline.html', { query: { target: POS_URL } });
    }
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer crashed:', details.reason);
    setTimeout(() => mainWindow.loadURL(POS_URL), 2000);
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('context-menu', (e) => e.preventDefault());

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.control && input.key.toLowerCase() === 'w') _event.preventDefault();
  });

  mainWindow.on('close', (e) => {
    if (!allowClose) {
      e.preventDefault();
      // Let the web app handle close via IPC (Salir button, Ctrl+Shift+Q)
      // But also allow taskbar "Close window" to work
      const { dialog } = require('electron');
      dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Cancelar', 'Cerrar Fullsite'],
        defaultId: 0,
        title: 'Cerrar Fullsite POS',
        message: '¿Cerrar la aplicación?',
      }).then(({ response }) => {
        if (response === 1) { allowClose = true; app.quit(); }
      });
    }
  });
  try { globalShortcut.register('CommandOrControl+Shift+Q', () => { allowClose = true; app.quit(); }); } catch {}
  try { globalShortcut.register('F12', () => { if (mainWindow) mainWindow.webContents.toggleDevTools(); }); } catch {}
  mainWindow.on('closed', () => { mainWindow = null; });
}

function setupOfflineRetry() {
  if (!mainWindow) return;
  setInterval(() => {
    if (!mainWindow) return;
    const url = mainWindow.webContents.getURL();
    if (!url.startsWith('https://')) mainWindow.loadURL(POS_URL);
  }, 10000);
}

// ─── KDS WINDOW ───────────────────────────────────────────────────────────
// Second window for kitchen display. Uses preload-kds.js which sets
// window.fullsiteApp.surface = 'kds', triggering KDS-specific behavior in the web app.
// Both windows share the default Electron session → same IndexedDB → offline orders
// cached by the POS are immediately visible to the KDS, even without internet.

function createKdsWindow(x, y, width, height, urlOverride) {
  kdsWindow = new BrowserWindow({
    title: 'Fullsite KDS',
    x, y, width, height,
    kiosk: true,
    fullscreen: true,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload-kds.js'),
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  const targetUrl = urlOverride || KDS_URL;
  kdsWindow.setMenu(null);
  kdsWindow.loadURL(targetUrl);

  let kdsFailCount = 0;
  kdsWindow.webContents.on('did-fail-load', (_event, errorCode) => {
    if (errorCode === -3) return; // ERR_ABORTED: SW or redirect intercepted
    const { net } = require('electron');
    if (!net.online) {
      kdsFailCount = 0;
      kdsWindow.loadFile('offline.html', { query: { target: targetUrl } });
      return;
    }
    kdsFailCount++;
    if (kdsFailCount <= 3) {
      // Give SW time to activate from previous session (progressive backoff)
      setTimeout(() => {
        if (kdsWindow && !kdsWindow.isDestroyed()) kdsWindow.loadURL(targetUrl);
      }, kdsFailCount * 800);
    } else {
      kdsFailCount = 0;
      kdsWindow.loadFile('offline.html', { query: { target: targetUrl } });
    }
  });

  kdsWindow.webContents.on('did-finish-load', () => { kdsFailCount = 0; });
  kdsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  kdsWindow.on('closed', () => { kdsWindow = null; });
  console.log('[kds] KDS window opened on', `${x},${y} ${width}x${height}`);
}

// ─── SETUP WINDOW (NOT_PROVISIONED) ─────────────────────────────────────────

let setupWindow = null;

function createSetupWindow() {
  setupWindow = new BrowserWindow({
    title: 'Fullsite POS — Configuración',
    width: 640, height: 720,
    resizable: false, frame: true,
    backgroundColor: '#0c1117',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload-setup.js'),
    },
  });
  setupWindow.loadFile('setup.html');
  setupWindow.on('closed', () => { setupWindow = null; });
  console.log('[main] NOT_PROVISIONED — setup window opened');
}

// ─── APP LIFECYCLE ────────────────────────────────────────────────────────

// Enable WebAuthn (Windows Hello + DigitalPersona 4500 fingerprint reader)
app.commandLine.appendSwitch('enable-features', 'WebAuthenticationWin10');
app.commandLine.appendSwitch('enable-web-authentication');

app.whenReady().then(async () => {
  // Initialize file logger and redirect all console.* calls to rotating log files.
  // Must happen before any other startup code so every log line is captured.
  try {
    logger.init(path.join(app.getPath('userData'), 'logs'));
    logger.patchConsole();
  } catch {}

  // Grant WebAuthn/HID permissions automatically (no popup)
  const defaultSession = require('electron').session.defaultSession;
  defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });

  // Auto-start on Windows login (creates startup shortcut)
  if (process.platform === 'win32') {
    app.setLoginItemSettings({ openAtLogin: true, path: process.execPath });
  }

  // ── CFG-02: Provisioning gate ─────────────────────────────────────────────
  // Validate config BEFORE starting any operational services.
  // NOT_PROVISIONED = show setup wizard, block POS/KDS/Local Server.
  registerProvisioningIpc();

  const configResult = loadAndValidateConfig();
  if (!configResult.valid) {
    console.error('[main] NOT_PROVISIONED:', configResult.errors.join('; '));
    createSetupWindow();
    return; // Do NOT start Local Server or POS window
  }

  if (configResult.migrated) {
    console.log('[main] Config auto-migrated from legacy format.');
  }

  appConfig = configResult.config;
  // Dedicated KDS build always opens in kds_only mode regardless of saved config
  if (app.getName() === 'Fullsite KDS') appConfig.kds_only = true;
  console.log(`[main] Provisioned: restaurant_id=${appConfig.restaurant_id} terminal_id=${appConfig.terminal_id} role=${appConfig.terminal_role}`);

  resolveUiUrls();            // Offline Shell: rewrite POS_URL/KDS_URL to local bridge if LOCAL_UI on
  await startLocalServer();   // Local server starts first (provides WS hub for KDS events)

  // ── kds_only mode: dedicated kitchen display machine ──────────────────────
  // config.json: { "kds_only": true, "pos_server_ip": "192.168.1.71" }
  // Skips the POS window entirely. Opens the KDS fullscreen on the primary display.
  // The local server still runs to receive ORDER_SENT events from the POS over LAN.
  if (appConfig.kds_only) {
    const { screen } = require('electron');
    const primary = screen.getPrimaryDisplay();
    const { bounds } = primary;
    // Inject the POS server LAN IP so the KDS bridge connects cross-device
    const kdsUrlWithBridge = appConfig.pos_server_ip
      ? `${KDS_URL}?bridge=${appConfig.pos_server_ip}`
      : KDS_URL;
    createKdsWindow(bounds.x, bounds.y, bounds.width, bounds.height, kdsUrlWithBridge);
    console.log('[main] kds_only mode — POS window skipped');
    return;
  }

  // ── Normal POS mode ───────────────────────────────────────────────────────
  startFingerprintService();
  createWindow();
  setupOfflineRetry();

  // Open KDS window on second display if configured
  if (appConfig.kds) {
    const { screen } = require('electron');
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    const secondary = displays.find(d => d.id !== primary.id);
    if (secondary) {
      const { bounds } = secondary;
      createKdsWindow(bounds.x, bounds.y, bounds.width, bounds.height);
    } else {
      console.log('[kds] config.kds=true but no second display found — connect a second screen and restart');
    }
  }
});

app.on('window-all-closed', () => app.quit());

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (localServer) { try { localServer.close(); } catch {} }
  if (fingerprintProcess) { fingerprintProcess.kill(); fingerprintProcess = null; }
});

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { mainWindow.restore(); mainWindow.focus(); }
  });
}
