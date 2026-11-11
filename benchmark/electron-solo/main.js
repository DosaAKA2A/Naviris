// Control del benchmark: el mismo Electron de Naviris sin nada de Naviris.
// Una ventana de 1280x800 con una página en blanco; las medidas la navegan por CDP.
const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => {
  const w = new BrowserWindow({ width: 1280, height: 800, webPreferences: { sandbox: true, contextIsolation: true } });
  w.loadURL('about:blank');
});
app.on('window-all-closed', () => app.quit());
