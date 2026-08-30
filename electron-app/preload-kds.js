const { contextBridge, ipcRenderer } = require('electron');

// ── Inject provisioned identity from URL params BEFORE the page's React mounts ──
// useBridgeClient() reads localStorage 'fullsite_client_id' on mount and bails
// PERMANENTLY (it never retries) if it's missing → the KDS WebSocket to the local
// server never connects → orders pushed over LAN while offline never arrive
// (online polling of Supabase masks this). The main-process injection
// (did-finish-load) runs AFTER the page mounts — too late for that gate. Preload
// runs before any page script, so setting these here guarantees they're present
// in time. Values come from the KDS URL (?client=&bridge=, added by main.js).
try {
  const params = new URLSearchParams(window.location.search);
  const client = params.get('client');
  const bridge = params.get('bridge');
  if (client) window.localStorage.setItem('fullsite_client_id', String(client).toLowerCase().trim());
  if (bridge) window.localStorage.setItem('pos_bridge_host', String(bridge));
} catch (e) { /* localStorage not ready this early — main-process injection is the fallback */ }

contextBridge.exposeInMainWorld('fullsiteApp', {
  quit: () => ipcRenderer.send('app-quit'),
  exitKiosk: () => ipcRenderer.send('exit-kiosk'),
  enterKiosk: () => ipcRenderer.send('enter-kiosk'),
  isElectron: true,
  surface: 'kds',
});
