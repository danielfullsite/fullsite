const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fullsiteApp', {
  quit: () => ipcRenderer.send('app-quit'),
  exitKiosk: () => ipcRenderer.send('exit-kiosk'),
  enterKiosk: () => ipcRenderer.send('enter-kiosk'),
  isElectron: true,
});
