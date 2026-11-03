/* ===== VENTANAS EMERGENTES SIN GESTO (2026-11-03) =====
   El <webview> lleva allowpopups y Electron no trae el bloqueador de Chrome:
   cualquier página podía abrir ventanas o pestañas nada más cargar, sin que la
   persona tocara nada (las de los anuncios que se abren solas). Medido con la
   página de prueba del bloqueador: dos window.open sin clic, dos pestañas.

   Ahora vale la regla de Chrome: una web solo abre una ventana o una pestaña
   nueva justo después de que la persona haga clic, toque o pulse una tecla en
   ella (la «activación transitoria» de Chromium, que dura 5 s), y cada gesto
   vale para UNA. Los gestos se cuentan en main con los eventos de entrada del
   webContents, que la página no puede fingir y que incluyen los clics dentro
   de sus iframes (el botón de «Iniciar sesión con Google» suele ir en uno).
   Lo bloqueado se avisa en la barra y se puede permitir en ese sitio; queda en
   los permisos guardados ('origen|popups').
   Va aparte de main.js para poder probarlo sin Electron (test/emergentes.test.js). */
const VIGENCIA = 5000;
// Los eventos que activan una página según el estándar HTML (keydown salvo
// Escape, mousedown, pointerup y touchend), con los nombres de Electron.
const ACTIVAN = new Set(['mouseDown', 'rawKeyDown', 'keyDown', 'touchEnd', 'gestureTap']);
const PERMISO = 'popups';

function activa(ev) {
  if (!ev || !ACTIVAN.has(ev.type)) return false;
  return !(ev.type !== 'mouseDown' && ev.key === 'Escape');
}

// Gestos de UN webContents: apunta lo que activa y gasta uno al abrir.
function creaGestos(reloj = Date.now) {
  let ultimo = 0;
  return {
    apunta(ev) { if (activa(ev)) ultimo = reloj(); },
    gasta() {
      const vale = ultimo > 0 && reloj() - ultimo <= VIGENCIA;
      ultimo = 0;
      return vale;
    }
  };
}

// Clave del permiso guardado para el sitio de esa URL ('' si no es una web).
function clavePermiso(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.origin + '|' + PERMISO : '';
  } catch { return ''; }
}

module.exports = { creaGestos, activa, clavePermiso, VIGENCIA, PERMISO };
