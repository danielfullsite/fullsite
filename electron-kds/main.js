const { app, BrowserWindow, globalShortcut, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// ─── CONFIG ───────────────────────────────────────────────────────────────
// kds.config.json is created by the bootstrap script during installation.
// It is never committed to git. The app refuses to start without it.

let kdsConfig = {};
try {
  const configPath = path.join(__dirname, 'kds.config.json');
  kdsConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch {
  // Show error before app is ready — use synchronous dialog
  app.whenReady().then(() => {
    dialog.showErrorBox(
      'KDS no configurado',
      'Falta kds.config.json. Ejecuta el script de instalación o contacta soporte.'
    );
    app.quit();
  });
}

const KDS_URL = kdsConfig.dashboard_url || 'https://app.fullsite.mx/pos/cocina';
const SUPABASE_URL = kdsConfig.supabase_url;
const SUPABASE_ANON_KEY = kdsConfig.supabase_anon_key;
const KDS_EMAIL = kdsConfig.kds_email;
const KDS_PASSWORD = kdsConfig.kds_password;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !KDS_EMAIL || !KDS_PASSWORD) {
  app.whenReady().then(() => {
    dialog.showErrorBox(
      'KDS config incompleto',
      'kds.config.json requiere: supabase_url, supabase_anon_key, kds_email, kds_password'
    );
    app.quit();
  });
}

// ─── ROUTE GUARD ──────────────────────────────────────────────────────────
// KDS must never navigate away from the cocina page.
// Validate origin AND exact pathname — no startsWith to prevent /pos/cocina-foo.

const KDS_ORIGIN = new URL(KDS_URL).origin;
const KDS_ALLOWED_PATHNAMES = ['/pos/cocina', '/pos', '/login'];

function isAllowedKdsUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === KDS_ORIGIN && KDS_ALLOWED_PATHNAMES.includes(parsed.pathname);
  } catch {
    return false;
  }
}

// ─── MAIN WINDOW ──────────────────────────────────────────────────────────

let mainWindow = null;
let allowClose = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Fullsite KDS',
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
  mainWindow.loadURL(KDS_URL);

  // Auto-login: if redirected to /login, inject credentials and submit
  mainWindow.webContents.on('did-navigate', (_event, url) => {
    if (url.includes('/login')) {
      console.log('[kds] Redirected to login — auto-authenticating...');
      mainWindow.webContents.executeJavaScript(`
        (async function() {
          // Wait for Supabase auth to be available
          await new Promise(r => setTimeout(r, 2000));
          // Set session directly via Supabase REST
          const res = await fetch(${JSON.stringify(SUPABASE_URL + '/auth/v1/token?grant_type=password')}, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': ${JSON.stringify(SUPABASE_ANON_KEY)} },
            body: JSON.stringify({ email: ${JSON.stringify(KDS_EMAIL)}, password: ${JSON.stringify(KDS_PASSWORD)} })
          });
          if (res.ok) {
            const data = await res.json();
            // Store tokens so AuthContext picks them up
            localStorage.setItem('sb-auth-token', JSON.stringify({
              access_token: data.access_token,
              refresh_token: data.refresh_token,
              expires_at: Math.floor(Date.now()/1000) + data.expires_in
            }));
            // Also set cookie for server-side
            document.cookie = 'fs-at=' + data.access_token + '; path=/; max-age=' + data.expires_in;
            // Navigate to cocina
            window.location.href = '/pos/cocina';
          }
        })();
      `).catch(e => console.error('[kds] Auto-login failed:', e));
    }
  });

  // Listen for quit request from renderer (via preload bridge)
  const { ipcMain } = require('electron');
  ipcMain.on('app-quit', () => { allowClose = true; app.quit(); });

  // Inject close button after page loads
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`
      if (!document.getElementById('kds-close-btn')) {
        const btn = document.createElement('button');
        btn.id = 'kds-close-btn';
        btn.innerHTML = '✕';
        btn.style.cssText = 'position:fixed;top:8px;right:8px;z-index:99999;width:36px;height:36px;border-radius:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.4);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.2s;';
        btn.onmouseenter = function() { this.style.background='rgba(239,68,68,0.3)'; this.style.color='#fff'; };
        btn.onmouseleave = function() { this.style.background='rgba(255,255,255,0.08)'; this.style.color='rgba(255,255,255,0.4)'; };
        btn.onclick = function() { if(window.fullsiteApp && window.fullsiteApp.quit) { window.fullsiteApp.quit(); } else { window.close(); } };
        document.body.appendChild(btn);
      }
    `).catch(() => {});
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDesc) => {
    console.error(`Load failed: ${errorCode} ${errorDesc}`);
    mainWindow.loadFile('offline.html');
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer crashed:', details.reason);
    setTimeout(() => mainWindow.loadURL(KDS_URL), 2000);
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Route guard: block navigation to any URL outside the KDS allowlist
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedKdsUrl(url)) {
      console.log(`[kds-guard] Blocked navigation to: ${url}`);
      event.preventDefault();
    }
  });

  // SPA guard: if client-side routing changes the path, restore KDS
  mainWindow.webContents.on('did-navigate-in-page', (_event, url) => {
    if (!isAllowedKdsUrl(url)) {
      console.log(`[kds-guard] SPA navigated to ${url}, restoring KDS`);
      mainWindow.loadURL(KDS_URL);
    }
  });

  mainWindow.webContents.on('context-menu', (e) => e.preventDefault());

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.control && input.key.toLowerCase() === 'w') _event.preventDefault();
  });

  mainWindow.on('close', (e) => { if (!allowClose) e.preventDefault(); });
  globalShortcut.register('CommandOrControl+Shift+Q', () => { allowClose = true; app.quit(); });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function setupOfflineRetry() {
  if (!mainWindow) return;
  setInterval(() => {
    if (!mainWindow) return;
    const url = mainWindow.webContents.getURL();
    if (!url.startsWith('https://')) mainWindow.loadURL(KDS_URL);
  }, 10000);
}

// ─── APP LIFECYCLE ────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // Auto-start on Windows login
  if (process.platform === 'win32') {
    app.setLoginItemSettings({ openAtLogin: true, path: process.execPath });
  }

  createWindow();
  setupOfflineRetry();
});

app.on('window-all-closed', () => app.quit());

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
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
