const { app, BrowserWindow, globalShortcut } = require('electron');
const path = require('path');
const http = require('http');
const net = require('net');
const os = require('os');

const POS_URL = 'https://app.fullsite.mx/pos';

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
    mainWindow.webContents.executeJavaScript(
      `localStorage.setItem('pos_last_boot', '${new Date().toISOString()}')`
    ).catch(() => {});
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

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDesc) => {
    console.error(`Load failed: ${errorCode} ${errorDesc}`);
    mainWindow.loadFile('offline.html');
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

  mainWindow.on('close', (e) => { if (!allowClose) e.preventDefault(); });
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
  createWindow();            // Then open POS
  setupOfflineRetry();
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
