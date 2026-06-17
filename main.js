const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// --- Preload script (inline dans le même fichier via un fichier séparé) ---
function createWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 720,
        fullscreen: true,
        icon: path.join(__dirname, 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    // Masque la barre de menu Windows
    win.setMenuBarVisibility(false);

    // Charge l'interface locale
    win.loadFile(path.join(__dirname, 'public', 'index.html'));
}

// Écoute la demande de fermeture du renderer
ipcMain.on('quit-app', () => {
    app.quit();
});

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
