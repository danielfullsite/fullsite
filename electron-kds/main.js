const { app, BrowserWindow, globalShortcut } = require('electron');
const path = require('path');

const KDS_URL = 'https://app.fullsite.mx/pos/cocina';

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

  // Listen for quit request from renderer (via preload bridge)
  const { ipcMain } = require('electron');
  ipcMain.on('app-quit', () => { allowClose = true; app.quit(); });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDesc) => {
    console.error(`Load failed: ${errorCode} ${errorDesc}`);
    mainWindow.loadFile('offline.html');
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer crashed:', details.reason);
    setTimeout(() => mainWindow.loadURL(KDS_URL), 2000);
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
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
