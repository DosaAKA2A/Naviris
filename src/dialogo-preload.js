/* Preload del aviso de una ventanita (dialogo.html): lee lo que hay que
   preguntar y devuelve la respuesta. main solo atiende a la capa que creó para
   ese aviso (ver 'ventanita:dialogo-*' en main.js). */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('naviDialogo', {
  datos: () => ipcRenderer.sendSync('ventanita:dialogo-datos'),
  responde: (r) => ipcRenderer.send('ventanita:dialogo-respuesta', r)
});
