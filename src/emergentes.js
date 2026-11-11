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
   los permisos guardados ('origen|popups') y lo bloqueado se abre en ese momento.
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

/* Lo bloqueado, para abrirlo al pulsar «Permitir en este sitio», como Chrome:
   se guarda cada intento de la pestaña (hasta 25, su kMaximumNumberOfPopups) y
   al permitir se abren TODOS, en el orden en que se bloquearon (lo que hace su
   ShowAllBlockedPopups). Se olvidan cuando la página que los pidió navega a
   otro documento o se cierra (Chrome los borra en esa misma navegación): ya no
   es la página que los quería abrir.
   Solo se guardan los que se pueden repetir: direcciones http(s) sin cuerpo.
   Un formulario con target=_blank (POST) no se repite: mandarlo otra vez podría
   hacer dos veces lo que hiciera. Un about:blank tampoco: la página lo abre
   vacío para escribir en él con lo que le devuelve window.open, y eso ya lo
   recibió nulo. `desde` es el id del webContents donde se bloqueó (la pestaña
   o una ventana suya). */
const TOPE_PENDIENTES = 25;
const repetible = (d) => !!d && /^https?:/i.test(d.url || '') && !d.postBody;

function creaPendientes() {
  const porPestana = new Map();   // id de la pestaña -> [{ desde, origen, url, nombre, rasgos }]
  const deja = (pestana, l) => { if (l.length) porPestana.set(pestana, l); else porPestana.delete(pestana); };
  return {
    apunta(pestana, desde, origen, d) {
      const l = porPestana.get(pestana) || [];
      if (!repetible(d) || l.length >= TOPE_PENDIENTES) return;
      l.push({ desde, origen, url: d.url, nombre: d.frameName || '', rasgos: d.features || '' });
      porPestana.set(pestana, l);
    },
    // Los de ese sitio en esa pestaña, que salen de la lista.
    saca(pestana, origen) {
      const l = porPestana.get(pestana) || [];
      deja(pestana, l.filter((p) => p.origen !== origen));
      return l.filter((p) => p.origen === origen);
    },
    // La página de ese webContents ya no está (navegó o se cerró).
    olvida(desde) {
      for (const [pestana, l] of porPestana) deja(pestana, l.filter((p) => p.desde !== desde));
    }
  };
}

/* El window.open que se repite en la página que lo pidió, con la misma
   dirección, nombre y características: sale como habría salido (ventana con su
   window.opener, o pestaña) y pasa por el mismo setWindowOpenHandler, ya con el
   sitio permitido. Va en un mundo aislado, para que no lo frene un window.open
   que la web haya cambiado; `void` porque la ventana no se puede devolver. */
const codigoAbrir = (p) => `void window.open(${JSON.stringify(p.url)}, ${JSON.stringify(p.nombre || '_blank')}, ${JSON.stringify(p.rasgos)});`;

/* CÓMO ES LA VENTANA (2026-11-04). Electron pasa a la BrowserWindow lo que la
   página escribe en el tercer argumento de window.open. Medido: con
   frame=no,alwaysOnTop=yes,closable=no,movable=no,skipTaskbar=yes salía una
   ventana sin barra, siempre encima y que no se cierra; con opacity=0, invisible
   encima de otras (para robar clics); con show=no, oculta; con x=-5000, fuera de
   la pantalla; con minWidth=3000, más grande que la pantalla. Es lo que usan las
   estafas de «soporte técnico».

   Lo que gana es lo que devuelve esto, así que aquí va fijo todo lo que su
   parseFeatures deja pasar (menos lo que solo existe en Mac) y un poco más por si
   la lista crece. De lo que escribe la página solo cuentan el tamaño y el sitio,
   que los inicios de sesión de Google o X usan para su ventanita, y dentro de la
   pantalla. Después, resizeTo y moveTo ya los limita Chromium a la pantalla (medido).
   Con fullscreenable: false, el requestFullscreen de la página (medido: tapaba hasta
   la barra de tareas, sin aviso de que Esc sale) llena solo la ventana; Esc sigue
   saliendo. Quien quiera un video a pantalla completa tiene la pestaña. */
const VENTANA_FIJA = {
  frame: true, thickFrame: true, titleBarStyle: 'default', backgroundMaterial: 'auto', roundedCorners: true, hasShadow: true,
  show: true, paintWhenInitiallyHidden: true, opacity: 1, transparent: false, backgroundColor: '#ffffff', title: 'Naviris',
  alwaysOnTop: false, skipTaskbar: false, modal: false, focusable: true, autoHideMenuBar: false,
  closable: true, minimizable: true, maximizable: true, movable: true, resizable: true,
  fullscreen: false, fullscreenable: false, kiosk: false, enableLargerThanScreen: false,
  center: false, useContentSize: false, minWidth: 0, minHeight: 0, maxWidth: 0, maxHeight: 0
};
const TAMANO_NORMAL = { ancho: 800, alto: 600 };
const TAMANO_MINIMO = { ancho: 200, alto: 150 };   // lo bastante para ver que hay una ventana
const entre = (n, min, max) => Math.min(Math.max(n, min), Math.max(min, max));

// Un número de los rasgos, como los lee Electron; null si no está o no lo es.
function numeroDe(rasgos, ...claves) {
  for (const k of claves) {
    const m = new RegExp('(?:^|,)\\s*' + k + '\\s*=\\s*([^,]*)', 'i').exec(rasgos);
    const n = m ? parseInt(m[1], 10) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/* `zonaDe(punto)` da la zona útil de la pantalla donde cae ese punto o, sin punto,
   la de la ventana que abre. Sin sitio pedido, centrada en esa pantalla. */
function opcionesDeVentana(rasgos, zonaDe) {
  const texto = String(rasgos || '');
  const x = numeroDe(texto, 'left', 'x'), y = numeroDe(texto, 'top', 'y');
  const zona = zonaDe(x === null && y === null ? null : { x: x ?? 0, y: y ?? 0 });
  const width = entre(numeroDe(texto, 'width') ?? TAMANO_NORMAL.ancho, TAMANO_MINIMO.ancho, zona.width);
  const height = entre(numeroDe(texto, 'height') ?? TAMANO_NORMAL.alto, TAMANO_MINIMO.alto, zona.height);
  const finX = zona.x + zona.width - width, finY = zona.y + zona.height - height;
  return {
    ...VENTANA_FIJA,
    width, height,
    x: x === null ? zona.x + Math.round((zona.width - width) / 2) : entre(x, zona.x, finX),
    y: y === null ? zona.y + Math.round((zona.height - height) / 2) : entre(y, zona.y, finY)
  };
}

module.exports = { creaGestos, activa, clavePermiso, creaPendientes, codigoAbrir, opcionesDeVentana, VIGENCIA, PERMISO, TOPE_PENDIENTES };
