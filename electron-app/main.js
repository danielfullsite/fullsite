const { app, BrowserWindow, globalShortcut } = require('electron');
const path = require('path');
const http = require('http');
const os   = require('os');
const fs   = require('fs');
const { execSync } = require('child_process');

const POS_URL = 'https://app.fullsite.mx/pos';
const KDS_URL = 'https://app.fullsite.mx/pos/cocina';

// ─── LOCAL SERVER ─────────────────────────────────────────────────────────────
// Fullsite Local Server (WS hub + print bridge + mDNS + heartbeat).
// Runs inside the Electron main process — no separate Node.js process needed.
// Replaces the previous embedded print bridge.

const LOCAL_SERVER_PORT = 7717;
const APP_CONFIG_PATH   = path.join('C:\\fullsite', 'config.json');
const PRINTERS_CONFIG_PATH = path.join('C:\\fullsite', 'printers.json');

// ─── APP CONFIG ───────────────────────────────────────────────────────────────
// C:\fullsite\config.json — optional, controls startup behavior.
// Keys:
//   kds:          true  → open KDS window on second display
//   restaurantId: uuid  → identifies this installation (required for multi-tenant)
//   channel:      'pilot' | 'stable' | 'development'
//   instanceName: 'AMALAY Sucursal Principal'
//   supabaseUrl / supabaseAnonKey: override env if needed
//   clientId / terminalId: injected into localStorage on boot

const DEFAULT_STATIONS = {
  cocina: { type: 'tcp', host: '192.168.1.21', port: 9100 },
  barra:  { type: 'tcp', host: '192.168.1.30', port: 9100 },
  caja:   { type: 'usb', names: ['TICKET', 'EC01', 'EC TICKET'] },
};

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
      const raw = JSON.parse(fs.readFileSync(PRINTERS_CONFIG_PATH, 'utf8'));
      console.log('[config] Loaded printers.json');
      return raw.stations || raw;
    }
  } catch (e) {
    console.warn('[config] Error loading printers.json:', e.message);
  }
  console.log('[config] Using default stations');
  return { ...DEFAULT_STATIONS };
}

let appConfig = {};
let localServer = null; // { httpServer, close, serverId, lanIp, wsHub }

async function startLocalServer() {
  const { startLocalServer: start } = require('./local-server');
  const dataDir = app.getPath('userData');

  const stations = loadStations();
  const cfg = {
    restaurantId:      appConfig.restaurantId || appConfig.clientId || process.env.FULLSITE_RESTAURANT_ID || 'unknown',
    channel:           appConfig.channel || process.env.FULLSITE_CHANNEL || 'stable',
    instanceName:      appConfig.instanceName || `Fullsite POS — ${require('os').hostname()}`,
    supabaseUrl:       appConfig.supabaseUrl   || process.env.SUPABASE_URL       || '',
    supabaseKey:       appConfig.supabaseAnonKey || process.env.SUPABASE_ANON_KEY || '',
    stations,
    printersConfigPath: PRINTERS_CONFIG_PATH,
    clientId:          appConfig.clientId,
    terminalId:        appConfig.terminalId,
  };

  try {
    localServer = await start({ dataDir, port: LOCAL_SERVER_PORT, config: cfg });
    console.log('[main] Local server started.');

    // Wire diagnostic endpoints that need access to Electron windows
    // (kiosk/exit and devtools are handled via IPC now — see ipcMain handlers below)
  } catch (e) {
    if (e.code === 'EADDRINUSE') {
      console.log('[main] Port 7717 already in use — another server running, skipping.');
    } else {
      console.error('[main] Local server failed to start:', e.message);
    }
  }
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

    // If the device is definitively offline, skip retries — offline.html handles recovery.
    // net.online mirrors navigator.onLine: false = no network interface at all.
    const { net } = require('electron');
    if (!net.online) {
      console.log(`[main] Device offline (${errorCode}) → loading offline.html immediately`);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadFile('offline.html');
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

app.whenReady().then(async () => {
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

  appConfig = loadAppConfig(); // Load before startLocalServer — config feeds server init
  startFingerprintService(); // Fingerprint service starts FIRST
  await startLocalServer();  // Local server (replaces embedded bridge) starts SECOND
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
