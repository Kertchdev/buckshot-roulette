const { contextBridge, ipcRenderer } = require('electron');

// Expose une API sécurisée au renderer (public/app.js)
contextBridge.exposeInMainWorld('electronAPI', {
    quitApp: () => ipcRenderer.send('quit-app')
});
