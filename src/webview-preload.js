// Preload que corre dentro de cada webview (sitio). Detecta formularios de login
// para capturar contraseñas al iniciar sesión y para autorrellenarlas después.
// Se comunica con la interfaz de Naviris (host) mediante ipcRenderer.sendToHost.
const { ipcRenderer } = require('electron');

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
      if (btn) { btn.click(); lastPoints = Date.now(); claims++; ipcRenderer.sendToHost('cobalt-twitch', { type: 'claim', kind: 'points', count: claims }); }
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
          if (RE.test(txt) || RE.test(aria)) { el.__navClaimed = true; el.click(); clicked++; ipcRenderer.sendToHost('cobalt-twitch', { type: 'claim', kind: 'drop' }); }
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
  // Baja la calidad desde el MENÚ del propio reproductor de Twitch. Es fiable
  // (el truco de localStorage solo se leía al arrancar el player y a veces no
  // llegaba a tiempo) y aplica solo a ESTA pestaña, sin afectar a las demás.
  function pickLowestQuality() {
    try {
      var gear = document.querySelector('[data-a-target="player-settings-button"]');
      if (!gear) return false;
      gear.click();
      var qItem = document.querySelector('[data-a-target="player-settings-menu-item-quality"]');
      if (!qItem) { gear.click(); return false; }
      qItem.click();
      // La lista es Auto, 1080p, 720p… la última opción es la más baja
      var opts = document.querySelectorAll('[data-a-target="player-settings-submenu-quality-option"]');
      if (!opts.length) { gear.click(); return false; }
      var last = opts[opts.length - 1];
      var clickable = last.querySelector('input[type="radio"]') || last.querySelector('label') || last;
      clickable.click();
      return true;
    } catch (e) { return false; }
  }
  // Reintenta hasta que el reproductor exista y acepte la calidad baja
  function lowResThisTabOnly() {
    try {
      localStorage.setItem('video-quality', JSON.stringify({ default: '160p30' }));
      // CLAVE: esta bandera de Twitch anulaba lo anterior forzando la calidad más alta.
      // Sin ponerla en false, el reproductor ignoraba el 160p y se quedaba en 720p.
      localStorage.setItem('video-quality-highest-available', 'false');
    } catch (e) { /* respaldo para la carga */ }
    var tries = 0;
    var t = setInterval(function () {
      if (pickLowestQuality() || ++tries > 40) clearInterval(t); // hasta ~40s
    }, 1000);
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
