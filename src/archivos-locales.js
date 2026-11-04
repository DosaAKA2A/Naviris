/* ===== PÁGINAS LOCALES EN UNA PESTAÑA (2026-11-04) =====
   Electron trae encendida la fuse GrantFileProtocolExtraPrivileges y una página
   file:// tiene más poder que en Chrome. Medido en una pestaña con un .html
   abierto desde descargas: leía C:\Windows\win.ini con fetch y con XHR, leía el
   contenido de un iframe de cualquier archivo y los píxeles de cualquier imagen
   (canvas), y lo mandaba a un servidor. Ese .html lo puede bajar cualquier web.

   Apagar la fuse no es la salida: la interfaz también se carga por file:// y sin
   ella pierde el localStorage (medido: SecurityError), o sea marcadores,
   historial y ajustes. Hasta que la interfaz viva en un protocolo propio, se
   corta aquí, en las sesiones de las webs (la interfaz va en otra y no pasa por
   esto), con lista blanca:

   · Un documento file: solo se abre en una pestaña. En una ventanita no, porque
     quien la abrió se queda con su window.opener y leería el documento.
   · Una página solo carga de file: imágenes, audio, video, fuentes, estilos y
     scripts, y solo de su carpeta o de las que cuelgan de ella. Nada de fetch,
     XHR, iframes ni <object>: abrir el archivo y ver lo que lleva sigue igual,
     leer el disco no. Tampoco de otro equipo (file://servidor/...), que le daría
     a ese servidor las credenciales de Windows.

   La carpeta se apunta al pedir el documento y no se saca de la dirección de la
   pestaña, porque esa la puede cambiar la página con history.pushState. */
const path = require('node:path');

const SUBRECURSOS = new Set(['image', 'media', 'font', 'stylesheet', 'script']);
const esFile = (url) => url.startsWith('file:');

// La ruta real en minúsculas y con el equipo delante, como la abrirá Windows:
// `%5c` y `%2e` se deshacen antes de comparar. null si no se puede saber.
function rutaDe(url) {
  try {
    const u = new URL(url);
    const ruta = decodeURIComponent(u.pathname).replace(/^\/(?=[a-z]:)/i, '');
    return (u.hostname + '|' + path.win32.normalize(ruta)).toLowerCase();
  } catch { return null; }
}

function carpetaDe(url) {
  const ruta = rutaDe(url);
  return ruta && ruta.slice(0, ruta.lastIndexOf('\\') + 1);
}

function dentroDe(url, carpeta) {
  const ruta = rutaDe(url);
  return !!carpeta && !!ruta && ruta.startsWith(carpeta);
}

const carpetas = new WeakMap();   // webContents -> carpeta de su documento local

// ¿Hay que cortar esta petición? `details` es el de webRequest.onBeforeRequest.
function corta({ url, resourceType, webContents }) {
  const wc = webContents && !webContents.isDestroyed() ? webContents : null;
  if (resourceType === 'mainFrame') {
    if (!esFile(url)) { if (wc) carpetas.delete(wc); return false; }
    if (!wc || wc.getType() !== 'webview') return true;
    carpetas.set(wc, carpetaDe(url));
    return false;
  }
  if (!esFile(url)) return false;
  return !(SUBRECURSOS.has(resourceType) && wc && dentroDe(url, carpetas.get(wc)));
}

module.exports = { corta, carpetaDe, dentroDe };
