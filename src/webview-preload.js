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
  // --- Reclamo de drops por la API GraphQL de Twitch ---
  // El botón de "reclamar drop" es un toast fugaz: si la pestaña no lo pilla en el
  // acto, el drop solo queda en twitch.tv/drops/inventory y claimDrops() (arriba)
  // nunca vuelve a verlo. Por eso los puntos caían y los drops no. Aquí barremos el
  // inventario y reclamamos con dropInstanceID, funcione o no el toast y esté la
  // pestaña en primer o segundo plano. Mismos hashes/cliente que TwitchDropsMiner.
  var GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
  var GQL_HASH_INVENTORY = 'd86775d0ef16a63a33ad52e80eaff963b2d5b72fada7c991504a57496e1d8e4b';
  var GQL_HASH_CLAIM = 'a455deea71bdc9015b78eb49f4acfbce8baa7ccbedd28e549bb025bd0f751930';
  // Consulta cruda de respaldo: el hash del inventario cambia de vez en cuando; el
  // de la mutación de reclamo lleva años estable, así que ese no necesita respaldo.
  var GQL_INVENTORY_QUERY =
    'query Inventory($fetchRewardCampaigns: Boolean = false) {' +
    ' currentUser { inventory {' +
    ' dropCampaignsInProgress { timeBasedDrops { id self { dropInstanceID isClaimed } } } } } }';
  var lastDropSweep = 0;
  // Autenticación: con sesión iniciada, la cookie auth-token de Twitch se lee con
  // document.cookie y la mandamos como cabecera Authorization: OAuth (igual que
  // TwitchDropsMiner). CLAVE: NADA de credentials:'include'. gql.twitch.tv responde
  // Access-Control-Allow-Origin:*, y el navegador prohíbe el comodín '*' en peticiones
  // con credenciales, así que credentials:'include' rompe la llamada por CORS (lo
  // verifiqué en la consola real). El token en la cabecera autentica y no dispara ese
  // conflicto. Sin token (sin sesión) no hay nada que reclamar, así que ni lo intentamos.
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
      // Si el hash caducó, Twitch responde PersistedQueryNotFound: reintenta crudo.
      var stale = res && res.errors && res.errors.some(function (e) {
        return e && /PersistedQueryNotFound/i.test(e.message || '');
      });
      if (stale) {
        return gql({ operationName: 'Inventory', variables: { fetchRewardCampaigns: true }, query: GQL_INVENTORY_QUERY });
      }
      return res;
    });
  }
  function claimDrop(id) {
    return gql({
      operationName: 'DropsPage_ClaimDropRewards',
      variables: { input: { dropInstanceID: id } },
      extensions: { persistedQuery: { version: 1, sha256Hash: GQL_HASH_CLAIM } }
    });
  }
  function sweepDrops(force) {
    if (!force && Date.now() - lastDropSweep < 60000) return; // no martillear el inventario
    lastDropSweep = Date.now();
    fetchInventory().then(function (res) {
      var inv = res && res.data && res.data.currentUser && res.data.currentUser.inventory;
      var camps = (inv && inv.dropCampaignsInProgress) || [];
      var ids = [];
      camps.forEach(function (c) {
        ((c && c.timeBasedDrops) || []).forEach(function (d) {
          var s = d && d.self;
          // dropInstanceID solo es no-nulo cuando el drop ya se ganó y espera reclamo
          if (s && s.dropInstanceID && !s.isClaimed && ids.indexOf(s.dropInstanceID) === -1) ids.push(s.dropInstanceID);
        });
      });
      ids.forEach(function (id) {
        claimDrop(id).then(function (r) {
          var ok = r && r.data && r.data.claimDropRewards && !((r.errors || []).length);
          if (ok) { claims++; ipcRenderer.sendToHost('cobalt-twitch', { type: 'claim', kind: 'drop', count: claims }); }
        }).catch(function () { /* red: se reintenta en el próximo barrido */ });
      });
    }).catch(function () { /* sin sesión de Twitch o red caída: el respaldo DOM sigue activo */ });
  }
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
    try { localStorage.setItem('video-quality', JSON.stringify({ default: '160p30' })); } catch (e) { /* respaldo para la carga */ }
    var tries = 0;
    var t = setInterval(function () {
      if (pickLowestQuality() || ++tries > 40) clearInterval(t); // hasta ~40s
    }, 1000);
  }
  let obs = null;
  function tick() { clickChest(); claimDrops(); sweepDrops(false); keepAlive(); }
  ipcRenderer.on('cobalt-autoloot', function (_e, opt) {
    if (opt && opt.on) {
      spoofVisible(); // sin esto, los drops no acumulan tiempo en segundo plano
      if (opt.lowRes) lowResThisTabOnly();
      if (!timer) {
        ipcRenderer.sendToHost('cobalt-twitch', { type: 'active' });
        sweepDrops(true); // barrido inmediato: reclama lo que ya estuviera pendiente en el inventario
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
