const { contextBridge, ipcRenderer } = require('electron');

// Puente MÍNIMO de la ventana de arranque: recibe el hito del arranque y la
// orden de irse, y avisa de cuándo empieza su animación. No expone nada del navegador (ni ajustes, ni contraseñas),
// porque esta ventana no lo necesita y vive apenas un segundo.
contextBridge.exposeInMainWorld('navSplash', {
  onProgreso: (cb) => ipcRenderer.on('splash:progreso', (_e, pct) => cb(pct)),
  onSale: (cb) => ipcRenderer.once('splash:sale', () => cb()),
  anda: () => ipcRenderer.send('splash:anda')
});
