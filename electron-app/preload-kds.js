const { contextBridge, ipcRenderer } = require('electron');


// Se ejecuta antes del JS de la página: el primer fetch/SUBSCRIBE ya lleva credencial.
// Main valida ventana, top frame y origen; la identidad nunca viene de la URL.
try {
  const identity = ipcRenderer.sendSync('local-network:identity');
  if (identity) for (const [key, value] of Object.entries(identity)) {
    if (value) window.localStorage.setItem(key, String(value));
    else window.localStorage.removeItem(key);
  }
} catch { /* el diagnóstico sigue disponible; Pedro falla cerrado sin credencial */ }

contextBridge.exposeInMainWorld('fullsiteApp', {
  quit: () => ipcRenderer.send('app-quit'),
  exitKiosk: () => ipcRenderer.send('exit-kiosk'),
  enterKiosk: () => ipcRenderer.send('enter-kiosk'),
  isElectron: true,
  surface: 'kds',
});
