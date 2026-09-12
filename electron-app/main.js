const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const os   = require('os');
const fs   = require('fs');
const { execSync } = require('child_process');

// ─── Puntos de anclaje del laboratorio multi-terminal ────────────────────────
//
// Los DEFAULTS SON LOS DE PRODUCCIÓN y no cambian: una terminal instalada en un
// restaurante se comporta exactamente igual que antes de esto. Las variables sólo
// existen para poder levantar varias terminales en UNA sola máquina y apuntarlas a
// una copia local de la app.
//
// POR QUÉ HACEN FALTA. Para probar de verdad tres POS + KDS + caja hay que correr
// cinco procesos Electron a la vez, y hoy los cinco:
//   · escucharían en el mismo 7717 (sólo el primero arranca; el resto ve EADDRINUSE),
//   · compartirían userData (misma config, misma identidad, mismos eventos),
//   · cargarían https://app.fullsite.mx, es decir PRODUCCIÓN — o sea que un
//     laboratorio automatizado escribiría en los datos de un restaurante real.
//
// Ese último punto es el que las vuelve obligatorias, no cómodas: sin
// FULLSITE_POS_URL no existe forma de ejercitar la UI real sin tocar producción.
//
// Regla al usarlas: si defines una, define las cuatro. Dos terminales con puertos
// distintos pero el mismo userData comparten identidad y el laboratorio miente.
const POS_URL = process.env.FULLSITE_POS_URL || 'https://app.fullsite.mx/pos';
// KDS de Eduardo (sesión de campo Jul 21): panel de demanda, toque por item, tarjeta
// por envío, FIFO, alertas. login-less (KDS_PATHS en pos/layout) + bridge offline.
// El /kds standalone (598 líneas) es una versión simplificada sin esos cambios.
const KDS_URL = process.env.FULLSITE_KDS_URL || 'https://app.fullsite.mx/pos/cocina';

// Modo dev/desk-lab: con FULLSITE_DEV=1 las ventanas abren en modo VENTANA (no
// kiosco/fullscreen) para poder probar en una Mac/PC sin quedar atrapado. En
// producción (sin el flag) sigue en kiosco, como debe ser en una terminal real.
const DEV = process.env.FULLSITE_DEV === '1';

// userData separado por terminal. Se aplica AQUÍ, en la carga del módulo, porque
// `app.setPath` sólo surte efecto antes de que algo llame a `getPath('userData')`
// — y config.json, printers.json y el event store salen todos de ahí.
//
// Sin esto, cinco Electron en una máquina comparten config, identidad y log de
// eventos: el laboratorio parecería funcionar y estaría probando UNA terminal
// cinco veces. Un falso verde, que es peor que no probar.
//
// Si la variable no está, no se toca nada: producción usa la ruta de siempre.
if (process.env.FULLSITE_USER_DATA_DIR) {
  try {
    const dir = path.resolve(process.env.FULLSITE_USER_DATA_DIR);
    fs.mkdirSync(dir, { recursive: true });
    app.setPath('userData', dir);
    console.log('[lab] userData:', dir);
  } catch (e) {
    // Se GRITA y se sigue con el default. Fallar el arranque por una variable de
    // laboratorio dejaría una terminal sin abrir; seguir en silencio haría que
    // dos terminales compartieran estado sin que nadie lo notara.
    console.error('[lab] FULLSITE_USER_DATA_DIR inservible, uso el default:', e.message);
  }
}

// ─── LOCAL SERVER ─────────────────────────────────────────────────────────────
// Fullsite Local Server (WS hub + print bridge + mDNS + heartbeat).
// Runs inside the Electron main process — no separate Node.js process needed.
// Replaces the previous embedded print bridge.

// 7717 es el puerto de producción y sigue siéndolo. La variable sólo permite
// levantar varias terminales en una máquina: sin ella, el segundo proceso muere
// con EADDRINUSE y no hay laboratorio multi-terminal posible.
//
// Se valida el rango: un puerto basura dejaría a Pedro sin arrancar y el POS se
// quedaría sin impresión ni KDS — falla peor que ignorar la variable.
const LOCAL_SERVER_PORT   = (() => {
  const crudo = Number(process.env.FULLSITE_LOCAL_SERVER_PORT);
  return Number.isInteger(crudo) && crudo > 0 && crudo < 65536 ? crudo : 7717;
})();
const LEGACY_CONFIG_PATH  = path.join('C:\\fullsite', 'config.json');
// CFG-01: printers config lives in Electron userData (same as config.json),
// with C:\fullsite\ as a read-only migration source only.
// There are NO default stations — absence of config = PRINTER_NOT_CONFIGURED.

// ─── CONFIG SCHEMA (CFG-02) ───────────────────────────────────────────────────
// All terminals must have a validated TerminalConfig before operational use.
// An invalid or missing config puts the terminal in NOT_PROVISIONED state,
// blocking the Local Server, POS, and KDS from starting.
let autoInstaller = null;   // handle del auto-update; null si no arranco
const configSchema        = require('./local-server/config-schema');
const { loadTerminalConfig } = require('./local-server/config-loader');
const printerConfigSchema = require('./local-server/adapters/printer-config-schema');

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
  return loadTerminalConfig({
    fs,
    path,
    schema: configSchema,
    primaryPath: getPrimaryConfigPath(),
    legacyPath: LEGACY_CONFIG_PATH,
    logger: console,
  });
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
    // Where the /kds page should read /state from: the caja's LAN IP for a dedicated
    // KDS/POS terminal, or same-origin ('') for the caja itself (server_pos).
    posServerIp:        appConfig.pos_server_ip  || null,
    // El PUERTO de la caja. Sin esto, `cajaPort` cae a `port` — el puerto PROPIO
    // de la terminal— y el secundario se reenvia A SI MISMO. En una instalacion
    // normal los dos son 7717 y funciona por accidente; con puertos distintos
    // (laboratorio multi-terminal, dos Pedros en una maquina, un despliegue con
    // el puerto cambiado) la comanda nunca sale de la terminal.
    //
    // Lo encontro el laboratorio de procesos reales: las pruebas en proceso le
    // pasaban `posServerPort` explicitamente y no podian ver el hueco.
    posServerPort:      appConfig.pos_server_port || null,
    terminalRole:       appConfig.terminal_role  || null,
    localAuthorityEnabled: appConfig.localAuthorityEnabled === true,
    branchId:           appConfig.location_id || appConfig.branch_id || appConfig.branchId || null,
    lanSecret:          appConfig.lan_secret     || appConfig.lanSecret || null,
  };

  try {
    localServer = await start({ dataDir, port: LOCAL_SERVER_PORT, config: cfg,
      // Dedicated cloud credential stays in main, outside renderer identity.
      businessSync: appConfig.business_sync || null });
    // Incluye el secreto que Caja acaba de generar/persistir, no sólo config.json.
    appConfig.lan_secret = localServer.lanSecret || null;
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
  ipcMain.handle('provision:get-info', async () => {
    let legacy = null;
    try {
      if (fs.existsSync(LEGACY_CONFIG_PATH)) legacy = JSON.parse(fs.readFileSync(LEGACY_CONFIG_PATH, 'utf8'));
    } catch {}
    const network_interfaces = [];
    for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
      for (const address of addresses || []) {
        if (address.family === 'IPv4' && !address.internal) {
          network_interfaces.push({ name, address: address.address, netmask: address.netmask });
        }
      }
    }
    let system_printers = [];
    try {
      if (setupWindow && !setupWindow.isDestroyed()) {
        system_printers = (await setupWindow.webContents.getPrintersAsync()).map(printer => ({
          name: printer.name,
          displayName: printer.displayName || printer.name,
          isDefault: !!printer.isDefault,
        }));
      }
    } catch (error) {
      console.warn('[provision] Could not enumerate system printers:', error.message);
    }
    return {
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      network_interfaces,
      system_printers,
      fingerprint: {
        service_installed: fs.existsSync('C:\\fullsite\\fingerprint-service.exe'),
        driver_installed: fs.existsSync('C:\\fullsite\\DPUruNet.dll'),
      },
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
      const req = http.get(`http://${ip}:${LOCAL_SERVER_PORT}/identity`, { timeout: 500 }, res => {
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
      const req = http.get(`http://${host}:${p}/identity`, { timeout: 3000 }, res => {
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

  // AUTO-INSTALAR EL SERVICIO DESDE EL PAQUETE. Es lo que hace clonable la huella.
  //
  // Esta rama habia perdido este bloque y el `extraResources` que lo alimenta; los dos
  // siguen vivos en la linea instalada en AMALAY (1.3.12). Sin ellos la huella depende de
  // que alguien haya copiado a mano `fingerprint-service.exe` y `DPUruNet.dll` a
  // C:\fullsite\ en esa caja — o sea que funciona donde ya funcionaba y en ninguna caja
  // nueva. Daniel lo dijo sin margen: la huella es indispensable.
  //
  // Los binarios NO se commitean (DLL propietario del SDK DigitalPersona U.are.U). El
  // instalador solo los empaqueta si estan presentes al correr electron-builder; si no,
  // este bloque no encuentra nada, no rompe, y el arranque sigue como antes.
  if (!fs.existsSync(fpExe) || !fs.existsSync(fpDll)) {
    try {
      const bundledDir = path.join(process.resourcesPath || __dirname, 'fingerprint');
      const bExe = path.join(bundledDir, 'fingerprint-service.exe');
      const bDll = path.join(bundledDir, 'DPUruNet.dll');
      if (fs.existsSync(bExe) && fs.existsSync(bDll)) {
        fs.mkdirSync('C:\\fullsite', { recursive: true });
        if (!fs.existsSync(fpExe)) fs.copyFileSync(bExe, fpExe);
        if (!fs.existsSync(fpDll)) fs.copyFileSync(bDll, fpDll);
        console.log('[fingerprint] Servicio instalado desde el paquete a C:\\fullsite\\');
      }
    } catch (e) {
      console.warn('[fingerprint] No se pudo auto-instalar desde el paquete:', e.message);
    }
  }

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

const { rendererIdentity } = require('./local-server/core/renderer-identity');
const { withLocalBridgeCsp } = require('./local-server/core/bridge-csp');
const lanCspSessions = new WeakSet();
let installedUiRevision = '';
function identityForUrl(url) {
  const identity = rendererIdentity({ url, config: appConfig, port: LOCAL_SERVER_PORT, dev: DEV, posUrl: POS_URL });
  if (!identity) return null;
  // Preload writes this before any application script. Empty removes a stale
  // marker when a developer intentionally returns to the remote UI.
  return { ...identity, FULLSITE_UI_PACKAGE: installedUiRevision };
}
function configureLocalBridgeCsp(session) {
  if (lanCspSessions.has(session)) return;
  lanCspSessions.add(session);
  // POS and KDS share a session. Electron retains only one listener per event;
  // installing a separate KDS listener used to replace the POS configuration.
  session.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders || {};
    callback({ responseHeaders: identityForUrl(details.url)
      ? withLocalBridgeCsp(headers, LOCAL_SERVER_PORT) : headers });
  });
}
ipcMain.on('local-network:identity', (event) => {
  event.returnValue = null;
  const ownWindow = [mainWindow, kdsWindow].some(w => w && !w.isDestroyed() && w.webContents === event.sender);
  const frame = event.senderFrame;
  const mainFrame = event.sender.mainFrame;
  if (!ownWindow || !frame || !mainFrame || frame.routingId !== mainFrame.routingId || frame.processId !== mainFrame.processId) return;
  event.returnValue = identityForUrl(frame.url);
});


function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Fullsite POS',
    icon: path.join(__dirname, 'icon.png'),
    kiosk: !DEV,
    fullscreen: !DEV,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // Secondary POS (role 'pos') reach the caja's Local Server over the LAN via
      // ws://<lan-ip>:7717 — blocked as mixed content from an https page. Relax it only
      // for LAN-bridge terminals; the caja (server_pos) uses localhost and stays locked.
      webSecurity: !(appConfig && appConfig.terminal_role === 'pos'),
      allowRunningInsecureContent: !!(appConfig && appConfig.terminal_role === 'pos'),
    },
  });

  mainWindow.setMenu(null);
  configureLocalBridgeCsp(mainWindow.webContents.session);
  mainWindow.loadURL(POS_URL);

  // Save last successful boot time for offline.html display
  mainWindow.webContents.on('did-finish-load', () => {
    loadFailCount = 0; // Reset on successful load
    const bootTime = new Date().toISOString();
    const scripts = [`localStorage.setItem('pos_last_boot', ${JSON.stringify(bootTime)})`];
    const identity = identityForUrl(mainWindow.webContents.getURL());
    if (!identity) return;
    for (const [key, value] of Object.entries(identity)) {
      scripts.push(value ? `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(String(value))})` : `localStorage.removeItem(${JSON.stringify(key)})`);
    }
    mainWindow.webContents.executeJavaScript(scripts.join('; ')).catch(() => {});
  });

  // Window-specific IPC from renderer (via preload bridge).
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
  // (shortcuts de recuperacion se registran en app.whenReady — QW11 — para cubrir kds_only)
  mainWindow.on('closed', () => { mainWindow = null; });
}

function setupOfflineRetry() {
  if (!mainWindow) return;
  setInterval(() => {
    if (!mainWindow) return;
    const url = mainWindow.webContents.getURL();
    // QW9: offline.html (file://) gestiona sus PROPIOS reintentos; si aqui tambien
    // recargamos POS_URL, ambos compiten -> parpadeo/ping-pong. No tocar file://.
    if (!url.startsWith('https://') && !url.startsWith('file://') && !identityForUrl(url)) mainWindow.loadURL(POS_URL);
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
    kiosk: !DEV,
    fullscreen: !DEV,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload-kds.js'),
      // KDS connects to the caja's Local Server over the LAN via ws://<lan-ip>:7717.
      // A ws:// to a non-localhost host from an https page is blocked as mixed content,
      // so the bridge never connects and no orders arrive (clients_connected stays 0).
      // This window only loads our own origin (app.fullsite.mx/pos/cocina) + the trusted
      // LAN bridge → relaxing web security here is scoped and safe for a kitchen kiosk.
      webSecurity: false,
      allowRunningInsecureContent: true,
    },
  });
  configureLocalBridgeCsp(kdsWindow.webContents.session);

  const targetUrl = urlOverride || KDS_URL;
  kdsWindow.setMenu(null);
  const localKds = targetUrl === `http://127.0.0.1:${LOCAL_SERVER_PORT}/kds`;
  const kdsHeaders = localKds ? require('./local-server/core/credencial-lan').cabecerasDeCredencial({
    secreto: appConfig.lan_secret || appConfig.lanSecret,
    restaurantId: appConfig.restaurant_id || appConfig.restaurantId || appConfig.client_id || appConfig.clientId,
    terminalId: appConfig.terminal_id || appConfig.terminalId,
    branchId: appConfig.location_id || appConfig.branch_id || appConfig.branchId,
  }) : {};
  const loadKds = () => kdsWindow.loadURL(targetUrl, { extraHeaders: Object.entries(kdsHeaders).map(([key, value]) => `${key}: ${value}`).join('\r\n') });
  loadKds();

  // Inject provisioned identity into the KDS window (mirror of mainWindow).
  // Essential: getKitchenOrders() filters by localStorage 'fullsite_client_id',
  // and the KDS route never does a Supabase login to set it. Without this the
  // KDS shows 0 orders even though they exist in pos_orders for this tenant.
  kdsWindow.webContents.on('did-finish-load', () => {
    const identity = identityForUrl(kdsWindow.webContents.getURL());
    if (!identity) return;
    const scripts = Object.entries(identity).map(([key, value]) => value ? `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(String(value))})` : `localStorage.removeItem(${JSON.stringify(key)})`);
    if (scripts.length) kdsWindow.webContents.executeJavaScript(scripts.join('; ')).catch(() => {});
    // TEMP DIAG
    kdsWindow.webContents.executeJavaScript(`JSON.stringify({cid: localStorage.getItem('fullsite_client_id'), bh: localStorage.getItem('pos_bridge_host'), tid: localStorage.getItem('pos_terminal_id'), electron: navigator.userAgent.includes('Electron'), url: location.href})`).then(v => console.log('[kds-diag]', v)).catch(e => console.log('[kds-diag ERR]', e.message));
  });
  // TEMP DIAG: pipe renderer console to main stdout
  kdsWindow.webContents.on('console-message', (_e, _level, message) => {
    if (/bridge|discover|ws|socket|identity|client|7717|\bSW\b|CACHE_VERSION|v2\d|activat/i.test(message)) console.log('[kds-console]', message);
  });

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
        if (kdsWindow && !kdsWindow.isDestroyed()) loadKds();
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
      sandbox: false,
      preload: path.join(__dirname, 'preload-setup.js'),
    },
  });
  setupWindow.loadFile('setup.html');
  setupWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[setup] Preload failed:', preloadPath, error.message);
  });
  setupWindow.on('closed', () => { setupWindow = null; });
  console.log('[main] NOT_PROVISIONED — setup window opened');
}

// ─── APP LIFECYCLE ────────────────────────────────────────────────────────

// Enable WebAuthn (Windows Hello + DigitalPersona 4500 fingerprint reader)
app.commandLine.appendSwitch('enable-features', 'WebAuthenticationWin10');
app.commandLine.appendSwitch('enable-web-authentication');
// Allow the trusted https POS/KDS shell to reach its own Local Server.
// Electron 33 embeds Chromium 130: webSecurity:false and
// BlockInsecurePrivateNetworkRequests alone are insufficient there. Chromium
// still sends/enforces a PNA retry and fails localhost before the request
// reaches Pedro. Disable only the three legacy PNA gates; do not use the global
// --disable-web-security switch.
app.commandLine.appendSwitch(
  'disable-features',
  'BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults',
);

app.whenReady().then(async () => {
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

  // Register quit before branching into POS or kds_only. When this lived inside
  // createWindow(), a dedicated KDS never installed the channel exposed by
  // preload-kds.js, so its visible close button could not reliably quit Electron.
  ipcMain.on('app-quit', () => { allowClose = true; app.quit(); });

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
  // A provisioned KDS role and the dedicated build both open the kitchen UI.
  if (app.getName() === 'Fullsite KDS' || appConfig.terminal_role === 'kds') appConfig.kds_only = true;
  console.log(`[main] Provisioned: restaurant_id=${appConfig.restaurant_id} terminal_id=${appConfig.terminal_id} role=${appConfig.terminal_role}`);

  // QW11: shortcuts de recuperacion registrados AQUI (no dentro de createWindow, que
  // NO corre en kds_only) -> una maquina de cocina colgada ya puede abrir DevTools/salir.
  // F12 apunta a la ventana ENFOCADA (en kds_only mainWindow es null).
  try { globalShortcut.register('CommandOrControl+Shift+Q', () => { allowClose = true; app.quit(); }); } catch {}
  try { globalShortcut.register('F12', () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.toggleDevTools(); }); } catch {}

  await startLocalServer();   // Local server starts first (provides WS hub for KDS events)

  // Install a complete public-code package only at process startup. Keeping the
  // app.fullsite.mx origin preserves existing browser identity and order drafts;
  // API requests still use the network and operational commands still use Pedro.
  // Dedicated /kds remains on its own local HTTP server.
  if (new URL(POS_URL).origin === 'https://app.fullsite.mx') {
    const { PackageStore } = require('./offline-ui/package-store');
    const { installProtocol } = require('./offline-ui/protocol');
    const store = new PackageStore(path.join(app.getPath('userData'), 'ui-packages'));
    const bundledPath = DEV && process.env.FULLSITE_UI_BUNDLE_DIR
      ? path.resolve(process.env.FULLSITE_UI_BUNDLE_DIR) : path.join(__dirname, 'ui-bundle');
    let bundle = null;
    try {
      bundle = fs.existsSync(bundledPath) ? store.install(bundledPath) : store.load();
    } catch (error) {
      console.error('[offline-ui] Candidate rejected:', error.message);
      try { bundle = store.load(); } catch (recoveryError) {
        console.error('[offline-ui] No verified recovery package:', recoveryError.message);
      }
    }
    if (bundle) {
      await installProtocol(defaultSession, bundle, LOCAL_SERVER_PORT);
      installedUiRevision = bundle.manifest.revision;
      console.log(`[offline-ui] Serving verified revision ${installedUiRevision}${bundle.recovered ? ' (recovered)' : ''}`);
    } else {
      console.warn('[offline-ui] No installed UI package; cold boot without internet is unavailable.');
    }
  }

  // ── Auto-update (Fase 2) ──────────────────────────────────────────────────
  // Descarga en segundo plano; instala SOLO cuando el restaurante esta en reposo.
  // Instalar reinicia Electron, y Pedro muere con Electron (regla dura #4): un
  // reinicio a media operacion deja sin imprimir y sin KDS. En la practica esto
  // instala DESPUES DEL CORTE, que es cuando un restaurante quiere que pase.
  //
  // Todo el bloque va en try/catch: un fallo del updater JAMAS puede impedir que
  // el POS arranque.
  try {
    const { iniciar } = require('./update/auto-installer');
    const supabaseUrl = appConfig.supabaseUrl || process.env.SUPABASE_URL || '';
    const supabaseKey = appConfig.supabaseAnonKey || process.env.SUPABASE_ANON_KEY || '';

    autoInstaller = iniciar({
      canal: appConfig.channel || process.env.FULLSITE_CHANNEL || 'stable',
      requiredStoreFormat: 'fullsite-command-transactions-v1',
      // Estado VIVO del restaurante. Si el servidor local no arranco, devuelve null
      // y la politica falla CERRADO — no instala.
      // El proveedor incluye las colas durables y el cursor confirmado de negocio;
      // una copia del salón no prueba que sea seguro reiniciar.
      getSnapshot: () => localServer?.getInstallSnapshot?.() || null,
      // Freno de emergencia. Falla CERRADO a proposito: si no se puede consultar,
      // no se instala. Una cosa es dejar OPERAR sin Supabase, otra instalar a ciegas.
      estaBloqueada: async (version) => {
        if (!supabaseUrl || !supabaseKey) throw new Error('sin config de Supabase');
        const res = await fetch(
          `${supabaseUrl}/rest/v1/local_server_blocked_versions?version=eq.${encodeURIComponent(version)}&select=version`,
          { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }, signal: AbortSignal.timeout(5000) }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const filas = await res.json();
        return Array.isArray(filas) && filas.length > 0;
      },
      onEvento: (info) => { try { localServer?.wsHub?.broadcastUpdateAvailable?.(info) } catch {} },
    });
  } catch (e) {
    console.warn('[main] Auto-update no se pudo iniciar (no fatal):', e.message);
  }

  // ── kds_only mode: dedicated kitchen display machine ──────────────────────
  // config.json: { "kds_only": true, "pos_server_ip": "192.168.1.71" }
  // Skips the POS window entirely. Opens the KDS fullscreen on the primary display.
  // The local server still runs to receive ORDER_SENT events from the POS over LAN.
  if (appConfig.kds_only) {
    const { screen } = require('electron');
    const primary = screen.getPrimaryDisplay();
    const { bounds } = primary;
    // OFFLINE-NATIVE KDS: load the self-contained kitchen page served by the caja's
    // local server over HTTP (http://<caja>:7717/kds). An http page can fetch the
    // bridge's /state over the LAN without the https mixed-content wall, so it works
    // fully offline — no internet needed to load the screen OR receive new orders.
    // pos_server_ip points at the caja (the data source); a KDS running on the caja
    // itself falls back to 127.0.0.1.
    // Load from THIS machine's own local server (127.0.0.1) so the page always loads
    // even at cold boot / brief LAN blips. That local server injects the caja's IP as
    // bridge_base (from config.pos_server_ip), so the page reads the caja's /state.
    const kdsUrl = `http://127.0.0.1:${LOCAL_SERVER_PORT}/kds`;
    createKdsWindow(bounds.x, bounds.y, bounds.width, bounds.height, kdsUrl);
    console.log(`[main] kds_only mode — loading local KDS UI (${kdsUrl}), data from ${appConfig.pos_server_ip || '127.0.0.1'}`);
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
      // Second-screen KDS on the caja itself → local server is on this machine.
      createKdsWindow(bounds.x, bounds.y, bounds.width, bounds.height, `http://127.0.0.1:${LOCAL_SERVER_PORT}/kds`);
    } else {
      console.log('[kds] config.kds=true but no second display found — connect a second screen and restart');
    }
  }
});

app.on('window-all-closed', () => app.quit());

app.on('will-quit', () => {
  // globalShortcut solo existe tras 'ready' — si salimos antes (ej. no obtuvimos el
  // single-instance lock) unregisterAll() truena con "cannot be used before the app is ready".
  if (app.isReady()) { try { globalShortcut.unregisterAll(); } catch {} }
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
