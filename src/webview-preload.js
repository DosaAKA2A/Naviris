// Preload que corre dentro de cada webview (sitio). Detecta formularios de login
// para capturar contraseñas al iniciar sesión y para autorrellenarlas después.
// Se comunica con la interfaz de Naviris (host) mediante ipcRenderer.sendToHost.
const { ipcRenderer, contextBridge } = require('electron');

// --- Identidad coherente del navegador (client hints) ---
// main ya reescribe las cabeceras Sec-CH-UA, pero eso no basta: los antifraude
// leen TAMBIÉN navigator.userAgentData desde JavaScript, y ahí Chromium seguía
// anunciándose sin la marca "Google Chrome" mientras el UA decía ser Chrome. Esa
// contradicción es lo que dejaba el Turnstile de Cloudflare girando sin fin en
// cualquier web, sin poder completar ninguna verificación.
// Va en document_start y en TODOS los sitios a propósito: la incoherencia no era
// de una web concreta. Se mantiene el objeto original para todo lo demás
// (plataforma, móvil, arquitectura) y solo se corrigen las marcas.
try {
  const hints = ipcRenderer.sendSync('ua:hints');
  if (hints && hints.lista) {
    contextBridge.executeInMainWorld({
      func: function (h) {
        try {
          var d = navigator.userAgentData;
          if (!d) return;
          var alta = d.getHighEntropyValues.bind(d);
          var falso = {
            brands: h.lista,
            mobile: d.mobile,
            platform: d.platform,
            toJSON: function () { return { brands: h.lista, mobile: d.mobile, platform: d.platform }; },
            getHighEntropyValues: function (claves) {
              return alta(claves).then(function (v) {
                if (v.brands) v.brands = h.lista;
                if (v.fullVersionList) v.fullVersionList = h.listaCompleta;
                return v;
              });
            }
          };
          Object.defineProperty(navigator, 'userAgentData', {
            configurable: true, enumerable: true, get: function () { return falso; }
          });
        } catch (e) { /* si no se puede, se queda el original */ }
      },
      args: [hints]
    });
  }
} catch (e) { /* nada */ }

// --- Piezas de Chromium que Electron no trae y que delatan al navegador ---
// Comparado señal a señal con el Chrome instalado en la misma máquina, quedaban
// cuatro diferencias. No son cosmética: un navegador que dice ser Chrome y no se
// comporta como tal falla en webs que husmean el entorno, y una de ellas era un
// fallo de verdad (lo de las notificaciones, abajo).
//   1. window.chrome estaba VACÍO. En Chrome trae app, csi y loadTimes; es la
//      comprobación más conocida para distinguir un navegador embebido.
//   2. screen.colorDepth daba 32; Chrome en Windows siempre dice 24.
//   3. navigator.languages iba al revés ("es,es-ES" en vez de "es-ES,es").
//   4. Notification.permission decía "denied" cuando en realidad estaba SIN
//      decidir: Naviris pregunta al usuario, pero la web leía "denegado" y ni
//      lo intentaba, así que el diálogo no salía nunca. Ahora dice la verdad
//      ('prompt' mientras no haya decisión guardada para ese sitio).
// Repaso del 2026-08-24, midiendo otra vez contra Chrome 151 y Opera GX 134 en
// la misma máquina (169 señales; quedaban 12 diferencias reales). Lo que se
// corrige aquí, además de lo de arriba:
//   5. permissions.query() decía "denied" para cámara, micrófono, ubicación,
//      portapapeles y MIDI cuando en realidad estaban SIN decidir. Es el mismo
//      fallo del punto 4, que solo se había arreglado para las notificaciones,
//      y tiene el mismo precio: la web ve "denegado" y ni pide el permiso, así
//      que el diálogo de Naviris no sale y no hay forma de concederlo.
//   6. window.chrome tenía las claves en otro orden que Chrome (app, csi,
//      loadTimes en vez de loadTimes, csi, app) y a chrome.app le faltaban
//      installState y runningState en minúscula, que son funciones.
//   7. storage.estimate() devolvía el hueco libre del disco entero (197 GB
//      aquí); Chrome y Opera GX topan en 10 GB. Además de ser una diferencia,
//      es una fuga de información del equipo.
const PERMISOS_WEB = {
  'notifications': 'notifications',
  'geolocation': 'geolocation',
  'camera': 'media',
  'microphone': 'media',
  'midi': 'midi',
  'clipboard-read': 'clipboard-read',
  'clipboard-write': 'clipboard-sanitized-write',
  'background-sync': 'background-sync',
  'idle-detection': 'idle-detection',
  'screen-wake-lock': 'wake-lock'
};
try {
  const idiomas = ipcRenderer.sendSync('ua:idiomas') || [];
  const permisos = {};
  for (const nombreWeb of Object.keys(PERMISOS_WEB)) {
    const estado = ipcRenderer.sendSync('perm:estado', PERMISOS_WEB[nombreWeb]);
    permisos[nombreWeb] = estado === 'allow' ? 'granted' : estado === 'block' ? 'denied' : 'prompt';
  }
  contextBridge.executeInMainWorld({
    func: function (permisos, idiomas) {
      try {
        var t0 = Date.now();
        var estadoNotif = permisos.notifications;
        if (!window.chrome || !window.chrome.loadTimes) {
          // El ORDEN de las claves de window.chrome se ve desde JavaScript, y
          // en Chrome es loadTimes, csi, app. Se asignan en ese mismo orden.
          var chrome = window.chrome || {};
          if (!chrome.loadTimes) chrome.loadTimes = function () {
            var t = performance.timing || {}, s = (t.navigationStart || t0) / 1000;
            return { requestTime: s, startLoadTime: s, commitLoadTime: s, finishDocumentLoadTime: s, finishLoadTime: s, firstPaintTime: s, firstPaintAfterLoadTime: 0, navigationType: 'Other', wasFetchedViaSpdy: false, wasNpnNegotiated: true, npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false, connectionInfo: 'h2' };
          };
          if (!chrome.csi) chrome.csi = function () { return { startE: t0, onloadT: t0, pageT: Date.now() - t0, tran: 15 }; };
          if (!chrome.app) chrome.app = {
            isInstalled: false,
            getDetails: function () { return null; },
            getIsInstalled: function () { return false; },
            installState: function (cb) { if (typeof cb === 'function') cb('not_installed'); },
            runningState: function () { return 'cannot_run'; },
            InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
            RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
          };
          try { Object.defineProperty(window, 'chrome', { configurable: true, enumerable: true, writable: true, value: chrome }); } catch (e) { window.chrome = chrome; }
        }
        try {
          // Chrome topa la cuota que informa; Electron soltaba el disco real.
          var TOPE = 10 * 1024 * 1024 * 1024;
          if (navigator.storage && navigator.storage.estimate) {
            var estimar = navigator.storage.estimate.bind(navigator.storage);
            navigator.storage.estimate = function () {
              return estimar().then(function (r) {
                var o = {};
                for (var k in r) o[k] = r[k];
                if (typeof o.quota === 'number') o.quota = Math.min(o.quota, TOPE);
                return o;
              });
            };
          }
        } catch (e) { /* nada */ }
        try {
          Object.defineProperty(screen, 'colorDepth', { configurable: true, get: function () { return 24; } });
          Object.defineProperty(screen, 'pixelDepth', { configurable: true, get: function () { return 24; } });
        } catch (e) { /* nada */ }
        try {
          // Los idiomas los manda main, que es quien construye la cabecera
          // Accept-Language: así navigator.language, navigator.languages y la
          // cabecera cuentan los tres la misma historia. Antes language decía
          // "es" mientras languages decía "es-ES,es".
          var orden = (idiomas && idiomas.length) ? idiomas.slice() : (navigator.languages || []).slice();
          if (orden.length) {
            Object.defineProperty(navigator, 'languages', { configurable: true, get: function () { return Object.freeze(orden.slice()); } });
            Object.defineProperty(navigator, 'language', { configurable: true, get: function () { return orden[0]; } });
          }
        } catch (e) { /* nada */ }
        if (estadoNotif && typeof Notification !== 'undefined') {
          var real = estadoNotif === 'granted' ? 'granted' : estadoNotif === 'denied' ? 'denied' : 'default';
          try { Object.defineProperty(Notification, 'permission', { configurable: true, get: function () { return real; } }); } catch (e) { /* nada */ }
        }
        try {
          // Un PermissionStatus de verdad hereda de EventTarget: hay webs que
          // le enganchan onchange y explotarían con un objeto plano.
          var q = navigator.permissions.query.bind(navigator.permissions);
          navigator.permissions.query = function (d) {
            var nombre = d && d.name;
            if (nombre && Object.prototype.hasOwnProperty.call(permisos, nombre)) {
              var et = new EventTarget();
              et.name = nombre;
              et.state = permisos[nombre];
              et.onchange = null;
              return Promise.resolve(et);
            }
            return q(d);
          };
        } catch (e) { /* nada */ }
      } catch (e) { /* si algo falla, se queda como estaba */ }
    },
    args: [permisos, idiomas]
  });
} catch (e) { /* nada */ }

// --- X/Twitter: muro de verificación de edad ("contenido no apto para menores") ---
// X decide si taparlo con el interruptor rweb_age_assurance_flow_enabled, que viaja en
// el window.__INITIAL_STATE__ del HTML; su lector es `customOverrides[clave] ??
// user.config[clave].value`, así que basta fijar la clave en customOverrides ANTES de
// que corra el script inline de X (después, X ya ha borrado __INITIAL_STATE__).
// Aquí NO sirve el truco del <script> que usa YouTube más abajo: la CSP de x.com lleva
// nonce y lo rechaza. Y tampoco el depurador de Electron desde el proceso principal:
// con el Modo agente encendido el depurador es del agente externo y el parche se
// quedaba sin aplicar (era justo el fallo de v2.7.3-dev.9). executeInMainWorld evalúa
// en el mundo principal en document_start sin tocar la CSP ni el depurador: funciona
// siempre. La consulta del ajuste es síncrona a propósito — a document_start no hay
// tiempo para un ida y vuelta asíncrono — y solo ocurre en x.com/twitter.com.
if (/(^|\.)(x\.com|twitter\.com)$/.test(location.hostname)) {
  try {
    if (ipcRenderer.sendSync('x:age-gate-on')) {
      contextBridge.executeInMainWorld({
        func: function () {
          var v;
          try {
            Object.defineProperty(window, '__INITIAL_STATE__', {
              configurable: true,
              enumerable: true,
              get: function () { return v; },
              set: function (n) {
                try { n.featureSwitch.customOverrides['rweb_age_assurance_flow_enabled'] = false; } catch (e) {}
                v = n;
              }
            });
          } catch (e) { /* nada */ }
        }
      });
    }
  } catch (e) { /* nada */ }
}

// --- MOOVIN: pase de la biblioteca ---
// La biblioteca de iris.it.com/moovin es privada: su worker no suelta ni el catálogo
// ni un solo archivo sin pase. Naviris lo recuerda a nivel de navegador y lo pone
// ANTES de que corra la página (de ahí executeInMainWorld en document_start), así
// que aquí la pantalla del pase no llega a verse. Si la persona lo escribe a mano
// en la página, se guarda solo para las próximas veces, incluso si luego borra los
// datos del sitio. El pase no llega a ningún otro dominio: main.js solo lo entrega
// y solo lo acepta desde iris.it.com.
if (/(^|\.)iris\.it\.com$/.test(location.hostname) && location.pathname.indexOf('/moovin') === 0) {
  try {
    const pase = ipcRenderer.sendSync('moovin:pase');
    // La clave de la app entra sola aunque esta persona no haya escrito nunca
    // el pase: es lo que hace que MOOVIN se abra directo en cualquier Naviris.
    // Si el build no lleva clave, viaja vacía y la página pide el pase.
    const claveApp = ipcRenderer.sendSync('moovin:clave-app');
    if (pase || claveApp) {
      contextBridge.executeInMainWorld({
        func: function (p, c) {
          if (p) window.__navMoovinPase = p;
          if (c) window.__navMoovinApp = c;
        },
        args: [pase, claveApp]
      });
    }
    window.addEventListener('load', () => {
      try {
        const puesto = localStorage.getItem('moovinPase') || '';
        if (puesto && puesto !== pase) ipcRenderer.send('moovin:pase-set', puesto);
      } catch (e) { /* nada */ }
    });
  } catch (e) { /* nada */ }
}

// --- YouTube: bloqueo de anuncios a nivel del player, en document_start ---
// El preload corre ANTES que los scripts de la página: vaciamos los campos de anuncio
// de la respuesta del player (adPlacements/playerAds/adSlots) ANTES de que el player
// la lea. Se cubren las TRES vías por las que llega esa respuesta:
//   1. ytInitialPlayerResponse embebido en el HTML (primera carga, con URL directa).
//   2. fetch(...).json()  -> Response.prototype.json.
//   3. XHR + JSON.parse   -> buena parte de /youtubei/v1/player viaja así.
// Cubrir solo la 2 era el fallo de antes: abrir un vídeo por URL directa iba limpio,
// pero navegar dentro de YouTube (SPA) traía anuncios, porque esa vía no pasa por
// Response.json. El hook de JSON.parse lleva una guarda barata (mira la cadena antes
// de tocar nada) para no pagar el coste en los miles de parseos de YouTube, que es
// justo por lo que se había quitado.
// Se inyecta con contextBridge.executeInMainWorld, no con un <script> inline: el
// <script> dependía de que main.js borrase la CSP de YouTube entera (un debilitamiento
// real de seguridad) y aun así podía fallar en silencio. Ver el bloque de X arriba.
if (/(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname)) {
  try {
    if (ipcRenderer.sendSync('yt-adblock-on', location.href)) {
      contextBridge.executeInMainWorld({
        func: function () {
          if (window.__navYT) return; window.__navYT = 1;
          var AD = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams', 'adParams'];
          // Poda acotada en profundidad. Antes solo miraba la raíz y un nivel
          // (o.playerResponse, y solo si era objeto), así que las respuestas donde
          // el player response viene anidado —o como CADENA JSON, que es como lo
          // sirven las rutas de Shorts— no se tocaban.
          function prune(o, prof) {
            try {
              if (!o || typeof o !== 'object' || prof > 4) return o;
              for (var i = 0; i < AD.length; i++) if (AD[i] in o) delete o[AD[i]];
              if (typeof o.playerResponse === 'string' && o.playerResponse.indexOf('adPlacements') !== -1) {
                try { o.playerResponse = JSON.stringify(prune(JSON.parse(o.playerResponse), prof + 1)); } catch (e) { /* nada */ }
              }
              var claves = ['playerResponse', 'playerResponses', 'watchNextResponse', 'contents', 'onResponseReceivedEndpoints'];
              for (var k = 0; k < claves.length; k++) {
                var v = o[claves[k]];
                if (v && typeof v === 'object') {
                  if (Array.isArray(v)) { for (var j = 0; j < v.length; j++) prune(v[j], prof + 1); }
                  else prune(v, prof + 1);
                }
              }
            } catch (e) { /* nada */ }
            return o;
          }
          // Huele a respuesta de player antes de gastar un JSON.parse/stringify.
          function sospechosa(s) {
            return typeof s === 'string' && s.length > 3000 &&
              (s.indexOf('adPlacements') !== -1 || s.indexOf('playerAds') !== -1 || s.indexOf('adSlots') !== -1);
          }
          try {
            var _j = Response.prototype.json;
            Response.prototype.json = function () { return _j.apply(this, arguments).then(function (d) { return prune(d, 0); }); };
          } catch (e) { /* nada */ }
          try {
            var _p = JSON.parse;
            JSON.parse = function (s) {
              var r = _p.apply(this, arguments);
              try { if (sospechosa(s)) return prune(r, 0); } catch (e) { /* nada */ }
              return r;
            };
          } catch (e) { /* nada */ }
          // No hace falta hookear XMLHttpRequest: la vía XHR acaba en
          // JSON.parse(xhr.responseText), que ya está cubierto arriba. Parchear
          // además el propio XHR obligaría a registrar un listener en send(), que
          // corre DESPUÉS del onreadystatechange que la página haya asignado antes:
          // llegaríamos tarde justo en el caso que queríamos cubrir.
          // Respuesta embebida: se poda la que YA esté puesta (puede haberse asignado
          // antes que nosotros) y se deja el setter para la que venga.
          try {
            var _v;
            try { if (window.ytInitialPlayerResponse) _v = prune(window.ytInitialPlayerResponse, 0); } catch (e) { /* nada */ }
            Object.defineProperty(window, 'ytInitialPlayerResponse', {
              configurable: true,
              get: function () { return _v; },
              set: function (n) { _v = prune(n, 0); }
            });
          } catch (e) { /* nada */ }
        }
      });
    }
  } catch (e) { /* nada */ }
}

function findLogin() {
  const pass = document.querySelector('input[type="password"]:not([disabled])');
  if (!pass) return null;
  const scope = pass.form || document;
  let user = scope.querySelector('input[autocomplete="username"], input[autocomplete="email"], input[type="email"], input[name*="user" i], input[name*="email" i], input[id*="user" i], input[id*="email" i]');
  if (!user) {
    // El input de texto que precede al campo de contraseña
    const texts = Array.from(scope.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input:not([type])'));
    user = texts.filter((t) => pass.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_PRECEDING).pop() || texts[0] || null;
  }
  return { pass, user };
}

// --- Captura al enviar el formulario ---
function tryCapture(root) {
  try {
    const pass = (root.querySelector ? root.querySelector('input[type="password"]') : null) || document.querySelector('input[type="password"]');
    if (!pass || !pass.value) return;
    const l = findLogin();
    ipcRenderer.sendToHost('cobalt-capture', {
      url: location.href,
      username: (l && l.user && l.user.value) || '',
      password: pass.value
    });
  } catch (e) { /* nada */ }
}
document.addEventListener('submit', (e) => tryCapture(e.target), true);
// Muchos logins son botones sin submit: capturar también al pulsar un botón si hay contraseña escrita
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('button, input[type="submit"], [role="button"]');
  if (b) setTimeout(() => tryCapture(document), 0);
}, true);

// --- Aviso de formulario de login (para ofrecer autorrelleno) ---
let announced = false;
function announce() {
  if (announced) return;
  if (findLogin()) { announced = true; ipcRenderer.sendToHost('cobalt-loginform', { url: location.href }); }
}
if (document.readyState !== 'loading') announce();
document.addEventListener('DOMContentLoaded', announce);
// Reintentos para SPAs que montan el formulario después
[600, 1500, 3000].forEach((ms) => setTimeout(announce, ms));
try {
  const obs = new MutationObserver(() => announce());
  obs.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => obs.disconnect(), 8000);
} catch (e) { /* nada */ }

// --- Formularios de pago: detectar y autorrellenar tarjeta (como Opera/Brave) ---
function findCardForm() {
  const q = (sel) => document.querySelector(sel);
  const number = q('input[autocomplete="cc-number"]:not([disabled])')
    || q('input[name*="cardnumber" i]:not([disabled]), input[name*="card-number" i]:not([disabled]), input[name*="card_number" i]:not([disabled]), input[id*="cardnumber" i]:not([disabled]), input[id*="card-number" i]:not([disabled]), input[name="pan" i]:not([disabled])');
  if (!number) return null;
  const scope = number.form || document;
  const s = (sel) => scope.querySelector(sel);
  return {
    number,
    holder: s('input[autocomplete="cc-name"], input[name*="cardholder" i], input[name*="card-holder" i], input[name*="holdername" i], input[id*="cardholder" i]'),
    exp: s('input[autocomplete="cc-exp"], input[name*="expiry" i]:not([name*="month" i]):not([name*="year" i]), input[id*="expiry" i], input[name*="exp-date" i], input[placeholder*="MM" i][placeholder*="AA" i], input[placeholder*="MM" i][placeholder*="YY" i]'),
    expMonth: s('input[autocomplete="cc-exp-month"], select[autocomplete="cc-exp-month"], input[name*="exp" i][name*="month" i], select[name*="exp" i][name*="month" i]'),
    expYear: s('input[autocomplete="cc-exp-year"], select[autocomplete="cc-exp-year"], input[name*="exp" i][name*="year" i], select[name*="exp" i][name*="year" i]')
  };
}
let cardAnnounced = false;
function announceCard() {
  if (cardAnnounced) return;
  if (findCardForm()) { cardAnnounced = true; ipcRenderer.sendToHost('cobalt-cardform', { url: location.href }); }
}
if (document.readyState !== 'loading') announceCard();
document.addEventListener('DOMContentLoaded', announceCard);
[600, 1500, 3000, 6000].forEach((ms) => setTimeout(announceCard, ms));

ipcRenderer.on('cobalt-fill-card', (_e, card) => {
  const f = findCardForm();
  if (!f) return;
  const set = (el, val) => {
    if (!el || val == null) return;
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
    try { setter ? setter.call(el, String(val)) : (el.value = String(val)); } catch (e) { el.value = String(val); }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const mm = String(card.expMonth).padStart(2, '0');
  const yy = String(card.expYear).slice(-2);
  set(f.number, card.number);
  if (f.holder) set(f.holder, card.holder);
  if (f.exp) set(f.exp, mm + '/' + yy);
  if (f.expMonth) set(f.expMonth, f.expMonth.tagName === 'SELECT' ? String(card.expMonth) : mm);
  if (f.expYear) {
    // Los <select> de año a veces listan 2027 y a veces 27: probar el largo y si no, el corto
    if (f.expYear.tagName === 'SELECT') { set(f.expYear, String(card.expYear)); if (f.expYear.value !== String(card.expYear)) set(f.expYear, yy); }
    else set(f.expYear, String(card.expYear));
  }
});

// --- Twitch: AutoLoot por pestaña. Lo activa/para la interfaz con 'cobalt-autoloot'. ---
if (/(^|\.)twitch\.tv$/.test(location.hostname)) {
  let claims = 0, lastPoints = 0, timer = null;
  function clickChest() {
    try {
      if (Date.now() - lastPoints < 5000) return; // evita doble conteo del mismo cofre
      // Selectores en orden de robustez. El del contenedor de resumen es
      // idioma-agnóstico (el cofre es el 2º hijo) y es el más fiable.
      var sum = document.querySelector('.community-points-summary');
      var btn = (sum && (sum.querySelector(':scope > *:nth-child(2) button')
                      || sum.querySelector('button[aria-label="Claim Bonus"]')))
              || (document.querySelector('.claimable-bonus__icon') || {}).closest
                 && document.querySelector('.claimable-bonus__icon').closest('button');
      if (btn) {
        btn.click(); lastPoints = Date.now(); claims++;
        var bal = null; // saldo de puntos del canal, para el historial
        try { var ps = document.querySelector('.community-points-summary'); if (ps) { var digs = (ps.textContent || '').replace(/[^\d]/g, ''); if (digs) bal = parseInt(digs, 10); } } catch (e) { /* nada */ }
        ipcRenderer.sendToHost('cobalt-twitch', { type: 'claim', kind: 'points', count: claims, balance: bal });
      }
    } catch (e) { /* nada */ }
  }
  // Visible según dimensiones (el toast de reclamo de drop es position:fixed y
  // su offsetParent es null, por eso NO se puede filtrar por offsetParent).
  function isVisible(el) { var r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4; }
  function claimDrops() {
    try {
      var RE = /^(claim( now| drop| your drop)?|reclamar( ahora| drop| recompensa)?)$/;
      document.querySelectorAll('button, a[role="button"], [role="button"]').forEach(function (el) {
        if (!isVisible(el)) return;
        var txt = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        var aria = (el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().toLowerCase();
        // Texto EXACTO (anclado) para no pulsar "claim your channel points" (los
        // puntos los reclama clickChest) ni otros botones que contengan "claim".
        if (RE.test(txt) || RE.test(aria)) {
          el.click(); claims++; ipcRenderer.sendToHost('cobalt-twitch', { type: 'claim', kind: 'drop', count: claims });
        }
      });
    } catch (e) { /* nada */ }
  }
  // --- Detección de drops pendientes por la API de inventario de Twitch ---
  // OJO: el reclamo DIRECTO por GraphQL lo rechaza Twitch con "failed integrity check"
  // (la mutación exige la cabecera Client-Integrity que genera su script anti-bot Kasada
  // y una llamada cruda no puede producir). Verificado en vivo. Por eso aquí SOLO
  // detectamos si hay algún drop ganado sin reclamar (la LECTURA sí pasa sin integrity)
  // y avisamos al host. El reclamo real lo hace un webview OCULTO que carga
  // /drops/inventory y pulsa el botón propio de Twitch (ese sí viaja con integrity).
  var GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
  var GQL_HASH_INVENTORY = 'd86775d0ef16a63a33ad52e80eaff963b2d5b72fada7c991504a57496e1d8e4b';
  // Consulta cruda de respaldo por si el hash del inventario caduca.
  var GQL_INVENTORY_QUERY =
    'query Inventory($fetchRewardCampaigns: Boolean = false) {' +
    ' currentUser { inventory {' +
    ' dropCampaignsInProgress { timeBasedDrops { id self { dropInstanceID isClaimed } } } } } }';
  var lastDropCheck = 0, lastPendingPing = 0;
  // Con sesión iniciada, la cookie auth-token se lee con document.cookie y se manda como
  // Authorization: OAuth. NADA de credentials:'include' (gql responde ACAO:* y el
  // navegador prohíbe el comodín con credenciales -> rompe por CORS). Sin token no hay
  // sesión, así que no hay nada que mirar.
  function twitchToken() {
    try { var m = document.cookie.match(/(?:^|;\s*)auth-token=([a-z0-9]+)/i); return m ? m[1] : null; } catch (e) { return null; }
  }
  function gql(payload) {
    var tok = twitchToken();
    if (!tok) return Promise.reject(new Error('no-auth'));
    return fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: { 'Client-Id': GQL_CLIENT_ID, 'Authorization': 'OAuth ' + tok },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); });
  }
  function fetchInventory() {
    return gql({
      operationName: 'Inventory',
      variables: { fetchRewardCampaigns: true },
      extensions: { persistedQuery: { version: 1, sha256Hash: GQL_HASH_INVENTORY } }
    }).then(function (res) {
      var stale = res && res.errors && res.errors.some(function (e) { return e && /PersistedQueryNotFound/i.test(e.message || ''); });
      if (stale) return gql({ operationName: 'Inventory', variables: { fetchRewardCampaigns: true }, query: GQL_INVENTORY_QUERY });
      return res;
    });
  }
  function countClaimable(res) {
    var inv = res && res.data && res.data.currentUser && res.data.currentUser.inventory;
    var camps = (inv && inv.dropCampaignsInProgress) || [];
    var n = 0;
    camps.forEach(function (c) { ((c && c.timeBasedDrops) || []).forEach(function (d) {
      var s = d && d.self; if (s && s.dropInstanceID && !s.isClaimed) n++;
    }); });
    return n;
  }
  // Detección: si hay drops pendientes, avisa al host para que abra el webview-claimer.
  function checkPendingDrops(force) {
    if (!force && Date.now() - lastDropCheck < 20000) return; // cada ~20s (antes 60s): recorta la espera del reclamo
    lastDropCheck = Date.now();
    fetchInventory().then(function (res) {
      if (countClaimable(res) > 0 && Date.now() - lastPendingPing > 30000) {
        lastPendingPing = Date.now();
        ipcRenderer.sendToHost('cobalt-twitch', { type: 'drops-pending' });
      }
    }).catch(function () { /* sin sesión o red caída: nada */ });
  }
  // Rol "claimer": en /drops/inventory pulsa los botones "Reclamar/Claim" reales de la
  // página (van por la maquinaria de Twitch, que sí firma con Client-Integrity). Lo
  // dispara el host con 'cobalt-claim-inventory' sobre el webview oculto.
  var claimerRan = false;
  function runInventoryClaimer() {
    if (claimerRan) return; claimerRan = true;
    var RE = /^(claim( now| drop| your drop)?|reclamar( ahora| drop| recompensa)?)$/;
    var tries = 0, clicked = 0;
    var iv = setInterval(function () {
      try {
        document.querySelectorAll('button, a[role="button"], [role="button"]').forEach(function (el) {
          if (el.__navClaimed) return;
          var r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return;
          var txt = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
          var aria = (el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().toLowerCase();
          if (RE.test(txt) || RE.test(aria)) {
            el.__navClaimed = true;
            // Nombre de la recompensa: sube al contenedor-tarjeta y coge el texto más
            // destacado (heading). Best-effort; se afina con la prueba en dev.
            var name = '';
            try {
              var card = el.closest('.inventory-max-width, [data-test-selector*="DropsGrantedCard"], [class*="card" i]') || el.parentElement;
              var h = card && (card.querySelector('h3, h4, p[class*="bold" i], strong') || card.querySelector('p'));
              name = ((h && h.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 90);
            } catch (e) { /* nada */ }
            el.click(); clicked++;
            ipcRenderer.sendToHost('cobalt-twitch', { type: 'claim', kind: 'drop', name: name });
          }
        });
      } catch (e) { /* nada */ }
      if (++tries >= 8) { clearInterval(iv); ipcRenderer.sendToHost('cobalt-twitch', { type: 'claim-done', clicked: clicked }); }
    }, 1500); // ~12s: la SPA de inventario tarda en pintar los botones
  }
  ipcRenderer.on('cobalt-claim-inventory', function () { runInventoryClaimer(); });
  // Mantiene el stream vivo en segundo plano: reanuda el vídeo y cierra el "¿sigues ahí?".
  function keepAlive() {
    try {
      var v = document.querySelector('video');
      if (v && v.paused) { try { v.play(); } catch (e) { /* nada */ } }
      document.querySelectorAll('button').forEach(function (el) {
        if (el.offsetParent === null) return;
        var t = (el.textContent || '').trim().toLowerCase();
        if (/(seguir viendo|continuar viendo|still watching|continue watching|sigo aqu|i'?m still here)/.test(t)) el.click();
      });
    } catch (e) { /* nada */ }
  }
  // Engaña a la API de visibilidad: Twitch solo cuenta el TIEMPO de visualización
  // de los drops si cree que la pestaña está visible. En segundo plano dejaría de
  // avanzar el progreso (los puntos sí caían porque los reclamamos nosotros, pero
  // los drops necesitan ese tiempo). Esto lo mantiene contando siempre.
  let visSpoofed = false;
  function spoofVisible() {
    if (visSpoofed) return; visSpoofed = true;
    try {
      Object.defineProperty(document, 'hidden', { get: function () { return false; }, configurable: true });
      Object.defineProperty(document, 'visibilityState', { get: function () { return 'visible'; }, configurable: true });
      Object.defineProperty(document, 'webkitHidden', { get: function () { return false; }, configurable: true });
      Object.defineProperty(document, 'webkitVisibilityState', { get: function () { return 'visible'; }, configurable: true });
      var block = function (e) { e.stopImmediatePropagation(); };
      document.addEventListener('visibilitychange', block, true);
      window.addEventListener('visibilitychange', block, true);
      document.addEventListener('webkitvisibilitychange', block, true);
      window.addEventListener('webkitvisibilitychange', block, true);
      document.dispatchEvent(new Event('visibilitychange')); // notifica el nuevo estado "visible"
    } catch (e) { /* nada */ }
  }
  // Baja la calidad desde el MENÚ del reproductor de Twitch: cambio EN VIVO (sin
  // recargar) y solo de ESTA pestaña. Asíncrono con esperas porque el menú de React
  // tarda en pintarse tras abrirlo; si consultas al instante, no encuentra las opciones
  // (ese era el fallo). Llama cb(true) si logró pulsar la opción más baja.
  function applyLowQualityViaMenu(cb) {
    try {
      var gear = document.querySelector('[data-a-target="player-settings-button"]');
      if (!gear) { cb(false); return; }
      gear.click();
      setTimeout(function () {
        var qItem = document.querySelector('[data-a-target="player-settings-menu-item-quality"]');
        if (!qItem) { try { gear.click(); } catch (e) { /* nada */ } cb(false); return; }
        qItem.click();
        setTimeout(function () {
          var opts = document.querySelectorAll('[data-a-target="player-settings-submenu-quality-option"]');
          if (!opts.length) { try { gear.click(); } catch (e) { /* nada */ } cb(false); return; }
          var last = opts[opts.length - 1]; // Auto, 1080p, 720p… → la última es la más baja (160p)
          try { (last.querySelector('input[type="radio"]') || last.querySelector('label') || last).click(); cb(true); }
          catch (e) { cb(false); }
        }, 450);
      }, 450);
    } catch (e) { cb(false); }
  }
  var qualityHandled = false;
  function lowResThisTabOnly() {
    if (qualityHandled) return; qualityHandled = true;
    // Baja SOLO esta pestaña a 160p por el menú (en vivo, sin recargar). Seleccionar por
    // menú escribe video-quality GLOBAL en localStorage; lo guardamos y lo restauramos al
    // final para que las pestañas/streams NUEVOS sigan en Automática (no heredan el 160p).
    var savedLS = null;
    try { savedLS = localStorage.getItem('video-quality'); } catch (e) { /* nada */ }
    function restoreLS() {
      try { if (savedLS == null) localStorage.removeItem('video-quality'); else localStorage.setItem('video-quality', savedLS); } catch (e) { /* nada */ }
    }
    var tries = 0;
    function attempt() {
      var v = document.querySelector('video');
      if (v && v.videoHeight && v.videoHeight <= 200) { restoreLS(); return; } // confirmado bajo
      if (++tries > 20) { restoreLS(); return; } // no se pudo: al menos no dejamos el LS sucio
      applyLowQualityViaMenu(function () { setTimeout(attempt, 1800); }); // reintenta y re-verifica la altura
    }
    attempt();
  }
  let obs = null;
  function tick() { clickChest(); claimDrops(); checkPendingDrops(false); keepAlive(); }
  ipcRenderer.on('cobalt-autoloot', function (_e, opt) {
    if (opt && opt.on) {
      spoofVisible(); // sin esto, los drops no acumulan tiempo en segundo plano
      if (opt.lowRes) lowResThisTabOnly();
      if (!timer) {
        ipcRenderer.sendToHost('cobalt-twitch', { type: 'active' });
        checkPendingDrops(true); // comprobación inmediata: si ya hay drops pendientes, dispara el claimer
        tick();
        timer = setInterval(tick, 8000);
        // Reacción inmediata: al aparecer el cofre o un botón de drop, reclama enseguida (con debounce)
        try {
          let deb = null;
          obs = new MutationObserver(function () { if (deb) return; deb = setTimeout(function () { deb = null; clickChest(); claimDrops(); }, 800); });
          obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
        } catch (e) { /* nada */ }
      }
    } else {
      if (timer) { clearInterval(timer); timer = null; }
      if (obs) { obs.disconnect(); obs = null; }
    }
  });
}

// --- Botones 4 y 5 del ratón dentro de la página ---
// Con el foco en la web, el mouseup lo recibe la página y la interfaz nunca se
// entera: por eso "atrás/adelante" del ratón no respondían navegando.
window.addEventListener('mouseup', function (e) {
  if (e.button === 3 || e.button === 4) {
    e.preventDefault();
    try { ipcRenderer.sendToHost('cobalt-mouse-nav', e.button === 3 ? 'back' : 'forward'); } catch (err) { /* nada */ }
  }
}, true);
window.addEventListener('auxclick', function (e) { if (e.button === 3 || e.button === 4) e.preventDefault(); }, true);

// --- Rellenar cuando el host lo pida (tras verificación de Windows) ---
ipcRenderer.on('cobalt-fill', (_e, cred) => {
  const l = findLogin();
  if (!l) return;
  const set = (el, val) => {
    if (!el || val == null) return;
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
    try { setter ? setter.call(el, val) : (el.value = val); } catch { el.value = val; }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  if (cred.username && l.user) set(l.user, cred.username);
  set(l.pass, cred.password);
});

// --- Señal de "pestaña controlada por un agente" (indicador tipo Chrome) ---
// Un agente externo (p. ej. Claude por CDP) marca la pestaña que usa poniendo el
// atributo data-naviris-agent en <html>. El preload lo relee (corre en mundo aislado,
// pero el DOM se comparte entre mundos) y avisa a la interfaz para pintar el distintivo.
// Al quitar el atributo, se apaga. Así el usuario ve SIEMPRE qué pestañas mueve el agente.
(function () {
  function report() {
    try {
      var de = document.documentElement;
      var v = de ? de.getAttribute('data-naviris-agent') : null;
      var on = v != null && v !== '' && v !== '0' && v !== 'false';
      ipcRenderer.sendToHost('cobalt-agent', { on: on, label: on ? v : '' });
    } catch (e) { /* nada */ }
  }
  try {
    // Observa 'document' (siempre existe en el preload) con subtree, para captar el
    // atributo en <html> aunque documentElement todavía no exista al arrancar el
    // preload. Observar directamente documentElement fallaba: era null en ese instante.
    new MutationObserver(report).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-naviris-agent'] });
  } catch (e) { /* nada */ }
  if (document.documentElement && document.documentElement.hasAttribute('data-naviris-agent')) report();
})();
