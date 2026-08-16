const { contextBridge, ipcRenderer } = require('electron');

// Puente MÍNIMO de la ventana de arranque: solo recibe el avance. No expone
// nada del navegador (ni ajustes, ni contraseñas), porque esta ventana no lo
// necesita y vive apenas un segundo.
contextBridge.exposeInMainWorld('navSplash', {
  onProgreso: (cb) => ipcRenderer.on('splash:progreso', (_e, d) => cb(d))
});
