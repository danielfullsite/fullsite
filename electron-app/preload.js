const { contextBridge, ipcRenderer } = require('electron');

// ── P1-1 fix: fijar el bridge a localhost ANTES de que monte React ──────────────
// Para el POS secundario (rol 'pos'), server-discovery lee 'pos_bridge_host' al
// montar; si quedó una IP vieja de la caja, intenta ws://<caja> PRIMERO → mixed-
// content bloqueado → "print bridge offline" → no reenvía (peor offline). La
// inyección de main.js corre en did-finish-load, DESPUÉS del montaje → tarde.
// preload corre antes de cualquier script de página, así que aquí llega a tiempo.
// El rol viene de la URL (?terminal_role=pos, agregado por main.js). Espeja
// preload-kds.js.
try {
  const role = new URLSearchParams(window.location.search).get('terminal_role');
  if (role === 'pos') {
    window.localStorage.setItem('FULLSITE_BRIDGE_URL', 'http://127.0.0.1:7717');
    window.localStorage.removeItem('pos_bridge_host');
  }
} catch (e) { /* localStorage aún no lista tan temprano — la inyección de main.js es el respaldo */ }

contextBridge.exposeInMainWorld('fullsiteApp', {
  quit: () => ipcRenderer.send('app-quit'),
  exitKiosk: () => ipcRenderer.send('exit-kiosk'),
  enterKiosk: () => ipcRenderer.send('enter-kiosk'),
  isElectron: true,
  // Trigger reprovisioning from the running POS (backs up config → wizard on relaunch)
  startProvisioning: () => ipcRenderer.invoke('provision:reset'),
});
