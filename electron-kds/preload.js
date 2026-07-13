const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fullsiteApp', {
  quit: () => ipcRenderer.send('app-quit'),
  isElectron: true,
  surface: 'kds',
});
