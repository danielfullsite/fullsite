const { app, BrowserWindow, globalShortcut } = require('electron');
const path = require('path');
const http = require('http');
const net = require('net');
const os = require('os');

const POS_URL = 'https://app.fullsite.mx/pos';
const KDS_URL = 'https://app.fullsite.mx/pos/cocina';

// ─── PRINT BRIDGE (embedded) ──────────────────────────────────────────────
// HTTP server on 127.0.0.1:7717 that receives ESC/POS from the POS web app
// and routes to thermal printers via TCP. No separate CMD window needed.

const BRIDGE_PORT = 7717;
const BRIDGE_HOST = '127.0.0.1';

const fs = require('fs');
const { execSync } = require('child_process');

// Station config: loaded from C:\fullsite\printers.json if exists, otherwise defaults
const DEFAULT_STATIONS = {
  cocina: { type: 'tcp', host: '192.168.1.21', port: 9100 },
  barra:  { type: 'tcp', host: '192.168.1.30', port: 9100 },
  caja:   { type: 'usb', names: ['TICKET', 'EC01', 'EC TICKET'] },
};

const PRINTERS_CONFIG_PATH = path.join('C:\\fullsite', 'printers.json');
const APP_CONFIG_PATH = path.join('C:\\fullsite', 'config.json');

// ─── APP CONFIG ───────────────────────────────────────────────────────────────
// C:\fullsite\config.json — optional, controls which surfaces open at startup.
// Example: { "kds": true }
//   kds: true  → open KDS window on second display (if connected)

function loadAppConfig() {
  try {
    if (fs.existsSync(APP_CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(APP_CONFIG_PATH, 'utf8'));
      console.log('[config] Loaded config.json:', JSON.stringify(data));
      return data;
    }
  } catch (e) {
    console.warn('[config] Error loading config.json:', e.message);
  }
  return {};
}

function loadStations() {
  try {
    if (fs.existsSync(PRINTERS_CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(PRINTERS_CONFIG_PATH, 'utf8'));
      console.log('[bridge] Loaded printers.json');
      return data.stations || data;
    }
  } catch (e) {
    console.warn('[bridge] Error loading printers.json:', e.message);
  }
  console.log('[bridge] Using default stations (no printers.json)');
  return { ...DEFAULT_STATIONS };
}

let STATIONS = loadStations();
let appConfig = {}; // loaded in app.whenReady before createWindow

function printTcp(host, port, data) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error(`Timeout ${host}:${port}`)); }, 5000);
    socket.connect(port, host, () => {
      clearTimeout(timeout);
      socket.write(data, () => { socket.end(); resolve(); });
    });
    socket.on('error', (err) => { clearTimeout(timeout); reject(err); });
  });
}

function printUsb(printerName, data) {
  const tmpFile = path.join(os.tmpdir(), `fullsite_print_${Date.now()}.bin`);
  try {
    fs.writeFileSync(tmpFile, data);
    // Try shared printer name first, then direct port
    try {
      execSync(`copy /b "${tmpFile}" "\\\\%COMPUTERNAME%\\${printerName}"`, {
        timeout: 5000, windowsHide: true, shell: 'cmd.exe',
      });
    } catch {
      // Fallback: try via PowerShell raw print
      execSync(`powershell -Command "Get-Content '${tmpFile}' -Encoding Byte -ReadCount 0 | Out-Printer '${printerName}'"`, {
        timeout: 8000, windowsHide: true,
      });
    }
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

async function printToStation(station, data) {
  const cfg = STATIONS[station];
  if (!cfg) throw new Error(`Unknown station: ${station}`);
  // Array of printers: send to ALL (e.g., cocina fria + cocina caliente)
  if (Array.isArray(cfg)) {
    const errors = [];
    for (const printer of cfg) {
      try {
        if (printer.type === 'usb') { printUsb((printer.names || [printer.name])[0], data); }
        else { await printTcp(printer.host, printer.port, data); }
      } catch (e) { errors.push(e); }
    }
    if (errors.length === cfg.length) throw errors[0]; // all failed
    return; // at least one succeeded
  }
  if (cfg.type === 'usb') {
    const names = cfg.names || [cfg.name];
    let lastErr;
    for (const name of names) {
      try { printUsb(name, data); return; } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('No USB printer found');
  } else {
    await printTcp(cfg.host, cfg.port, data);
  }
}

// ESC/POS cash drawer kick command
const DRAWER_KICK = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
  });
}

let bridgeServer = null;

function startBridge() {
  bridgeServer = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const url = req.url?.split('?')[0];

    if (url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true, hostname: os.hostname(), app: 'Fullsite POS',
        stations: Object.entries(STATIONS).map(([name, cfg]) => ({ name, target: `${cfg.host}:${cfg.port}` })),
      }));
      return;
    }

    if (url === '/print' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        const station = body.station || 'caja';
        if (!body.data) { res.writeHead(400); res.end('{"error":"Missing data"}'); return; }
        const bytes = Buffer.from(body.data, 'base64');
        await printToStation(station, bytes);
        console.log(`[bridge] ${bytes.length} bytes → ${station}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, station, bytes: bytes.length }));
      } catch (e) {
        console.error('[bridge] Print error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    if (url === '/drawer' && req.method === 'POST') {
      try {
        await printToStation('caja', DRAWER_KICK);
        console.log('[bridge] Drawer kicked');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    if (url === '/test' && req.method === 'POST') {
      const results = {};
      for (const [name, cfg] of Object.entries(STATIONS)) {
        try {
          const now = new Date().toLocaleString('es-MX', { timeZone: 'America/Monterrey' });
          const ticket = Buffer.from(
            '\x1b\x40\x1b\x61\x01\x1d\x21\x11FULLSITE POS\n\x1d\x21\x00\x1b\x61\x01--- TEST ---\n\n' +
            `\x1b\x61\x00Estacion: ${name}\nTerminal: ${os.hostname()}\nFecha: ${now}\n\n` +
            '\x1b\x61\x01Impresora OK\n\n\x1d\x56\x41\x03', 'binary'
          );
          await printTcp(cfg.host, cfg.port, ticket);
          results[name] = 'ok';
        } catch (e) { results[name] = e.message; }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, results }));
      return;
    }

    // ── Fingerprint proxy: forward /fp/* to fingerprint service on port 7718 ──
    if (url && url.startsWith('/fp/')) {
      const fpPath = url.replace('/fp', '');
      const fpUrl = `http://127.0.0.1:7718${fpPath}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`;
      try {
        const fpReq = http.request(fpUrl, { method: req.method, timeout: 30000 }, (fpRes) => {
          res.writeHead(fpRes.statusCode || 200, fpRes.headers);
          fpRes.pipe(res);
        });
        fpReq.on('error', (e) => {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Fingerprint service not available: ' + e.message }));
        });
        req.pipe(fpReq);
      } catch (e) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // ── Printer config: read/update station config without rebuild ──
    if (url === '/config' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ stations: STATIONS, configPath: PRINTERS_CONFIG_PATH, fromFile: fs.existsSync(PRINTERS_CONFIG_PATH) }));
      return;
    }

    if (url === '/config' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        if (body.stations) {
          STATIONS = { ...STATIONS, ...body.stations };
          fs.writeFileSync(PRINTERS_CONFIG_PATH, JSON.stringify(STATIONS, null, 2));
          console.log('[bridge] Printer config updated and saved to', PRINTERS_CONFIG_PATH);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, stations: STATIONS }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // ── Kiosk exit (diagnostic only — NOT an operational POS capability) ────
    // Exits fullscreen kiosk so DevTools and other windows become visible.
    // Trigger from Caja PowerShell: Invoke-WebRequest -Uri "http://127.0.0.1:7717/kiosk/exit" -Method POST
    if (url === '/kiosk/exit' && req.method === 'POST') {
      const remoteAddr = req.socket?.remoteAddress || ''
      if (!remoteAddr.includes('127.0.0.1') && !remoteAddr.includes('::1')) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end('{"error":"Forbidden — localhost only"}')
        return
      }
      if (!mainWindow) {
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end('{"error":"Window not ready"}')
        return
      }
      mainWindow.setKiosk(false)
      mainWindow.setFullScreen(false)
      console.log('[devtools] Kiosk exited for diagnostics at', new Date().toISOString())
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
      return
    }

    // ── DevTools (diagnostic only — NOT an operational POS capability) ──────
    // Opens Chromium DevTools in undocked mode for field diagnostics.
    // Only reachable from 127.0.0.1 (bridge already binds to loopback only).
    // Trigger from Caja PowerShell: Invoke-WebRequest -Uri "http://127.0.0.1:7717/devtools" -Method POST
    if (url === '/devtools' && req.method === 'POST') {
      const remoteAddr = req.socket?.remoteAddress || ''
      if (!remoteAddr.includes('127.0.0.1') && !remoteAddr.includes('::1')) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end('{"error":"Forbidden — localhost only"}')
        return
      }
      if (!mainWindow) {
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end('{"error":"Window not ready"}')
        return
      }
      mainWindow.webContents.openDevTools({ mode: 'undocked' })
      console.log('[devtools] DevTools opened for diagnostics at', new Date().toISOString())
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
      return
    }

    res.writeHead(404); res.end('{"error":"Not found"}');
  });

  bridgeServer.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
    console.log(`[bridge] Print bridge on http://${BRIDGE_HOST}:${BRIDGE_PORT}`);
    for (const [name, cfg] of Object.entries(STATIONS)) {
      console.log(`[bridge]   ${name} → ${cfg.host}:${cfg.port}`);
    }
  });

  bridgeServer.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.log('[bridge] Port 7717 already in use — external bridge running, skipping');
    } else {
      console.error('[bridge] Error:', e.message);
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
    // Inject identity from config.json — config is authoritative for Electron installs.
    // Ensures a fresh terminal knows its client without a prior dashboard login.
    if (appConfig.clientId) {
      scripts.push(`localStorage.setItem('fullsite_client_id', ${JSON.stringify(String(appConfig.clientId))})`);
    }
    if (appConfig.terminalId) {
      scripts.push(`localStorage.setItem('pos_terminal_id', ${JSON.stringify(String(appConfig.terminalId))})`);
    }
    mainWindow.webContents.executeJavaScript(scripts.join('; ')).catch(() => {});
  });

  // Listen for IPC from renderer (via preload bridge)
  const { ipcMain } = require('electron');
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
    loadFailCount++;
    console.error(`[main] Load failed (${loadFailCount}): ${errorCode} ${errorDesc}`);
    if (loadFailCount <= 3) {
      // Give SW progressively more time to activate from the previous session
      setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(POS_URL); }, loadFailCount * 800);
    } else {
      loadFailCount = 0;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadFile('offline.html');
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

function createKdsWindow(x, y, width, height) {
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
  kdsWindow.setMenu(null);
  kdsWindow.loadURL(KDS_URL);
  kdsWindow.webContents.on('did-fail-load', () => {
    kdsWindow.loadFile('offline.html');
  });
  kdsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  kdsWindow.on('closed', () => { kdsWindow = null; });
  console.log('[kds] KDS window opened on', `${x},${y} ${width}x${height}`);
}

// ─── APP LIFECYCLE ────────────────────────────────────────────────────────

// Enable WebAuthn (Windows Hello + DigitalPersona 4500 fingerprint reader)
app.commandLine.appendSwitch('enable-features', 'WebAuthenticationWin10');
app.commandLine.appendSwitch('enable-web-authentication');

app.whenReady().then(() => {
  // Grant WebAuthn/HID permissions automatically (no popup)
  const defaultSession = require('electron').session.defaultSession;
  defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    // Allow all permissions needed for POS (notifications, clipboard, etc.)
    callback(true);
  });

  // Auto-start on Windows login (creates startup shortcut)
  if (process.platform === 'win32') {
    app.setLoginItemSettings({ openAtLogin: true, path: process.execPath });
  }

  startFingerprintService(); // Fingerprint service starts FIRST
  startBridge();             // Print bridge starts SECOND
  appConfig = loadAppConfig(); // Load before createWindow so did-finish-load can inject identity
  createWindow();            // Then open POS
  setupOfflineRetry();

  // Open KDS window if configured
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
  if (bridgeServer) bridgeServer.close();
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
