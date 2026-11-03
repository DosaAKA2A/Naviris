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

module.exports = { creaGestos, activa, clavePermiso, creaPendientes, codigoAbrir, VIGENCIA, PERMISO, TOPE_PENDIENTES };
